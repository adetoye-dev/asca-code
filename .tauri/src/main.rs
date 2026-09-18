//! main.rs — Tauri Native Desktop Entry Point
//!
//! Launches the ACSA Code desktop application. The Python engine is the
//! backend: the frontend talks to it over IPC via `engine_call`, and the
//! Rust layer only owns host-level concerns such as windowing, the engine
//! sidecar, and local credential storage.
//!
//! 1. `engine_call` — Invokes a Python engine subcommand and returns its result.
//! 2. `fetch_system_metrics` — Samples host CPU/memory usage via the `sysinfo`
//!    crate to guard against thermal throttling during sandbox stress tests.

// Prevent the console window from appearing on Windows release builds
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex};
use sysinfo::System;
use tauri::{Emitter, Manager, State};

// ── Data Structures ─────────────────────────────────────────────────────────



/// Single line of output from the orchestrator, streamed to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineOutputLine {
    pub line_number: usize,
    pub content: String,
    pub stream: String, // "stdout" or "stderr"
    pub is_json: bool,
}


/// Host system metrics snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct SystemMetrics {
    pub cpu_usage_percent: f32,
    pub cpu_count_physical: usize,
    pub cpu_count_logical: usize,
    pub memory_total_mb: f64,
    pub memory_used_mb: f64,
    pub memory_usage_percent: f64,
    /// Free/total/used for the volume the app is running from. The status bar
    /// showed `Disk: --` because nothing ever filled these in.
    pub disk_usage_percent: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub disk_free_gb: f64,
    pub is_thermal_risk: bool,
    pub thermal_warning: String,
    pub timestamp_ms: u64,
}

/// Managed state: wraps sysinfo::System behind a mutex.
pub struct AppState {
    sys: Mutex<System>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub children: Option<Vec<FileNode>>,
}

fn build_file_tree(dir: &std::path::Path, max_depth: usize) -> Vec<FileNode> {
    if max_depth == 0 || !dir.is_dir() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Ignore hidden and heavy build dirs
            if name.starts_with('.')
                || name == "node_modules"
                || name == "__pycache__"
                || name == "target"
                || name == "dist"
                || name == ".venv"
                || name == "venv"
            {
                continue;
            }

            let is_dir = path.is_dir();
            let size_bytes = if is_dir {
                0
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            };

            let children = if is_dir {
                Some(build_file_tree(&path, max_depth - 1))
            } else {
                None
            };

            entries.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                size_bytes,
                children,
            });
        }
    }

    // Sort: directories first, then alphabetical by name
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    entries
}

// ── Tauri Commands: File & Project Management ───────────────────────────────

fn canonicalize_project_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root);
    let absolute_root = if root.is_absolute() {
        root
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve current directory: {}", e))?
            .join(root)
    };

    Ok(absolute_root.canonicalize().unwrap_or(absolute_root))
}

fn resolve_project_path(project_root: &str, target_path: &str) -> Result<PathBuf, String> {
    let root = canonicalize_project_root(project_root)?;
    let target = PathBuf::from(target_path);
    let absolute_target = if target.is_absolute() {
        target
    } else {
        root.join(target)
    };

    if absolute_target
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "Refusing to resolve path outside the active project root: {}",
            target_path
        ));
    }

    let resolved = if absolute_target.exists() {
        absolute_target
            .canonicalize()
            .unwrap_or_else(|_| absolute_target.clone())
    } else {
        // Canonicalize the closest existing ancestor, then re-append the tail.
        let mut existing = absolute_target.clone();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        while !existing.exists() {
            match existing.file_name() {
                Some(name) => tail.push(name.to_os_string()),
                None => break,
            }
            if !existing.pop() {
                break;
            }
        }
        let mut base = existing.canonicalize().unwrap_or(existing);
        for name in tail.into_iter().rev() {
            base.push(name);
        }
        base
    };

    if !resolved.starts_with(&root) {
        return Err(format!(
            "Refusing to access target outside the active project root: {}",
            target_path
        ));
    }

    Ok(resolved)
}

#[tauri::command]
fn list_project_files(project_path: String) -> Result<Vec<FileNode>, String> {
    let path = canonicalize_project_root(&project_path)?;
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", project_path));
    }
    Ok(build_file_tree(&path, 5))
}

#[tauri::command]
fn read_file_content(file_path: String, project_root: String) -> Result<String, String> {
    let path = resolve_project_path(&project_root, &file_path)?;
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    // Cap at 2MB to prevent freezing
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("File exceeds 2MB limit for direct editing".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file_content(file_path: String, content: String, project_root: String) -> Result<(), String> {
    let path = resolve_project_path(&project_root, &file_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn read_file_base64(file_path: String, project_root: String) -> Result<String, String> {
    let path = resolve_project_path(&project_root, &file_path)?;
    if !path.is_file() {
        return Err(format!("File not found: {}", file_path));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        other => match other {
            "ttf" | "otf" | "woff" | "woff2" => "font/ttf",
            _ => "application/octet-stream",
        },
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64_encode(&bytes)
    ))
}

/// Standard base64. Hand-rolled because the alternative is another crate for
/// twenty lines, and this is only ever used to inline a preview asset.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[tauri::command]
fn create_file_or_folder(path: String, is_dir: bool, project_root: String) -> Result<(), String> {
    let p = resolve_project_path(&project_root, &path)?;
    if is_dir {
        std::fs::create_dir_all(&p).map_err(|e| format!("Failed to create directory: {}", e))
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        std::fs::write(&p, "").map_err(|e| format!("Failed to create file: {}", e))
    }
}

#[tauri::command]
fn delete_project_file(path: String, project_root: String) -> Result<(), String> {
    let p = resolve_project_path(&project_root, &path)?;
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        std::fs::remove_file(&p).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select Project Directory:\")")
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(s.trim_end_matches('/').to_string()))
                }
            }
            _ => Ok(None),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn create_project_template(
    name: String,
    template: String,
    parent_dir: Option<String>,
) -> Result<String, String> {
    let clean_name = name.trim().replace(
        |c: char| !c.is_alphanumeric() && c != '-' && c != '_',
        "_",
    );
    if clean_name.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    let base = match parent_dir {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => {
            if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
            {
                PathBuf::from(home).join("AutonomousProjects")
            } else {
                PathBuf::from("projects")
            }
        }
    };

    let project_dir = base.join(&clean_name);
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;

    match template.to_lowercase().as_str() {
        "fastapi" => {
            let _ = std::fs::write(
                project_dir.join("main.py"),
                format!(
                    "from fastapi import FastAPI\n\napp = FastAPI(title=\"{}\")\n\n@app.get(\"/\")\ndef root():\n    return {{\"status\": \"online\", \"project\": \"{}\"}}\n",
                    clean_name, clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("models.py"),
                "from pydantic import BaseModel\n\nclass Item(BaseModel):\n    name: str\n    description: str | None = None\n",
            );
            let _ = std::fs::write(
                project_dir.join("requirements.txt"),
                "fastapi>=0.110.0\nuvicorn>=0.28.0\npydantic>=2.0.0\n",
            );
            let _ = std::fs::write(
                project_dir.join("README.md"),
                format!("# {}\n\nFastAPI service created with ACSA Code.\n", clean_name),
            );
        }
        "express" => {
            let _ = std::fs::write(
                project_dir.join("server.js"),
                format!(
                    "const express = require('express');\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/', (req, res) => {{\n  res.json({{ status: 'online', project: '{}' }});\n}});\n\napp.listen(port, () => console.log(`Server running on port ${{port}}`));\n",
                    clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("package.json"),
                format!(
                    "{{\n  \"name\": \"{}\",\n  \"version\": \"0.1.0\",\n  \"main\": \"server.js\",\n  \"dependencies\": {{\n    \"express\": \"^4.19.2\"\n  }}\n}}\n",
                    clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("README.md"),
                format!("# {}\n\nExpress service created with ACSA Code.\n", clean_name),
            );
        }
        "typescript" => {
            let src_dir = project_dir.join("src");
            let _ = std::fs::create_dir_all(&src_dir);
            let _ = std::fs::write(
                src_dir.join("index.ts"),
                format!(
                    "export function greet(name: string): string {{\n  return `Hello ${{name}}!`;\n}}\n\nconsole.log(greet('{}'));\n",
                    clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("tsconfig.json"),
                "{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\",\n    \"strict\": true,\n    \"esModuleInterop\": true\n  }\n}\n",
            );
            let _ = std::fs::write(
                project_dir.join("package.json"),
                format!(
                    "{{\n  \"name\": \"{}\",\n  \"version\": \"0.1.0\",\n  \"type\": \"module\"\n}}\n",
                    clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("README.md"),
                format!("# {}\n\nTypeScript project created with ACSA Code.\n", clean_name),
            );
        }
        _ => {
            let _ = std::fs::write(
                project_dir.join("main.py"),
                format!(
                    "def main():\n    print(\"Hello from {}\")\n\nif __name__ == '__main__':\n    main()\n",
                    clean_name
                ),
            );
            let _ = std::fs::write(
                project_dir.join("README.md"),
                format!("# {}\n\nACSA Code Project.\n", clean_name),
            );
        }
    }

    Ok(project_dir.to_string_lossy().to_string())
}

// ── Helper: Resolve the core-engine path ────────────────────────────────────

/// Name of the frozen engine executable shipped as a Tauri sidecar.
///
/// Tauri strips the target-triple suffix when bundling, so at runtime it sits
/// next to the app executable under this plain name.
const ENGINE_BIN_NAME: &str = "acsa-engine";

/// Locate the frozen engine binary, if this build shipped one.
fn resolve_engine_bin(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Where Tauri places external binaries on macOS and Linux.
            candidates.push(dir.join(ENGINE_BIN_NAME));
        }
    }
    if let Some(resources) = resource_dir {
        // Packaged: the engine ships as a resource directory (`--onedir`), because a
        // onefile sidecar writes a new executable on every launch and macOS scans it
        // again each time — 8.5s per call versus 0.06s for a stable binary.
        candidates.push(
            resources
                .join("engine")
                .join(ENGINE_BIN_NAME)
                .join(ENGINE_BIN_NAME),
        );
        candidates.push(resources.join("engine").join(ENGINE_BIN_NAME));
        candidates.push(resources.join(ENGINE_BIN_NAME));
        candidates.push(resources.join("binaries").join(ENGINE_BIN_NAME));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// How to run an engine subcommand: the frozen binary when present, otherwise
/// the source tree through the system interpreter.
///
/// Returning `(program, leading_args)` keeps both paths identical at the call
/// site — the fallback simply prepends `python3 <entry point>`.
fn engine_invocation(resource_dir: Option<&Path>, subcommand: &str) -> (PathBuf, Vec<String>) {
    if let Some(bin) = resolve_engine_bin(resource_dir) {
        return (bin, vec![subcommand.to_string()]);
    }
    let entry = resolve_engine_dir(resource_dir).join("acsa_engine.py");
    (
        PathBuf::from("python3"),
        vec![entry.to_string_lossy().to_string(), subcommand.to_string()],
    )
}

/// Locate the bundled Python engine.
///
/// Order matters: a packaged app must read the copy shipped in its own resource
/// directory. The previous candidates were all build-machine paths
/// (`CARGO_MANIFEST_DIR`, a CWD-relative `core-engine`, an exe-relative dir),
/// none of which exist on a user's machine — so an installed build could not
/// find the engine at all and every AI action failed.
fn resolve_engine_dir(resource_dir: Option<&Path>) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Production: bundled as a Tauri resource.
    if let Some(resources) = resource_dir {
        candidates.push(resources.join("core-engine"));
    }

    // 2. Development: from .tauri/src/ → ../../core-engine
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("core-engine"),
    );
    // 3. Development: relative to the working directory.
    candidates.push(PathBuf::from("core-engine"));
    // 4. Last resort: next to the executable.
    candidates.push(
        std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("core-engine"),
    );

    for candidate in &candidates {
        let manager = candidate.join("manager.py");
        if manager.exists() {
            return candidate.canonicalize().unwrap_or(candidate.clone());
        }
    }

    // Return the first candidate as default (will produce a clear error downstream)
    candidates[0].clone()
}

// ── Tauri Command: fetch_system_metrics ─────────────────────────────────────

/// Samples current host CPU and memory usage to detect thermal throttling.
/// Should be polled periodically by the frontend during sandbox stress tests.
#[tauri::command]
fn fetch_system_metrics(state: State<'_, AppState>) -> Result<SystemMetrics, String> {
    let mut sys = state
        .sys
        .lock()
        .map_err(|e| format!("Failed to acquire system lock: {}", e))?;

    // Refresh CPU and memory data
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpus = sys.cpus();
    let cpu_count_logical = cpus.len();

    // Calculate average CPU usage across all cores
    let cpu_usage: f32 = if cpu_count_logical > 0 {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpu_count_logical as f32
    } else {
        0.0
    };

    let physical_cores = sys.physical_core_count().unwrap_or(cpu_count_logical);
    let mem_total = sys.total_memory() as f64 / (1024.0 * 1024.0);
    let mem_used = sys.used_memory() as f64 / (1024.0 * 1024.0);
    let mem_percent = if mem_total > 0.0 {
        (mem_used / mem_total) * 100.0
    } else {
        0.0
    };

    // Thermal risk heuristic: CPU > 85% sustained OR memory > 90%
    let is_thermal_risk = cpu_usage > 85.0 || mem_percent > 90.0;
    let thermal_warning = if cpu_usage > 85.0 {
        format!(
            "CPU usage at {:.1}% — risk of thermal throttling. Consider reducing concurrency.",
            cpu_usage
        )
    } else if mem_percent > 90.0 {
        format!(
            "Memory usage at {:.1}% — risk of OOM. Consider closing other applications.",
            mem_percent
        )
    } else {
        String::new()
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // The boot volume: what "Disk:" in a status bar means to a reader.
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (disk_total, disk_free) = disks
        .list()
        .first()
        .map(|d| (d.total_space(), d.available_space()))
        .unwrap_or((0, 0));
    let gib = 1024.0 * 1024.0 * 1024.0;
    let disk_total_gb = round1(disk_total as f64 / gib);
    let disk_free_gb = round1(disk_free as f64 / gib);
    let disk_used_gb = round1(disk_total_gb - disk_free_gb);
    let disk_usage_percent = if disk_total_gb > 0.0 {
        round1((disk_used_gb / disk_total_gb) * 100.0)
    } else {
        0.0
    };

    Ok(SystemMetrics {
        cpu_usage_percent: (cpu_usage * 10.0).round() / 10.0,
        cpu_count_physical: physical_cores,
        cpu_count_logical,
        memory_total_mb: (mem_total * 10.0).round() / 10.0,
        memory_used_mb: (mem_used * 10.0).round() / 10.0,
        memory_usage_percent: (mem_percent * 10.0).round() / 10.0,
        disk_usage_percent,
        disk_used_gb,
        disk_total_gb,
        disk_free_gb,
        is_thermal_risk,
        thermal_warning,
        timestamp_ms: timestamp,
    })
}

// ── Tauri Commands: storage, processes, cleanup ─────────────────────────────
//
// These lived only in `vite-fs-bridge.ts`, so the Health & Performance page
// showed its defaults in a packaged build. Worse, its process list was
// hardcoded — invented CPU and memory numbers, including a row for a gauntlet
// that no longer exists. Real numbers come from `sysinfo` instead.

const MB: f64 = 1024.0 * 1024.0;

/// Total bytes under a directory, skipping the trees that must never be walked.
fn dir_size_bytes(dir: &Path) -> u64 {
    // `node_modules` and `.git` are huge and are never what is being cleaned;
    // walking them made the storage panel take seconds on a real project.
    let skip = ["node_modules", ".git", "target"];
    let mut total = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if path.is_dir() {
                if skip.contains(&name.as_ref()) {
                    continue;
                }
                stack.push(path);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Every directory named in `names` under `dir`, and what they add up to.
fn scan_named_dirs(dir: &Path, names: &[&str]) -> (usize, u64) {
    let mut count = 0usize;
    let mut size = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if names.contains(&name.as_ref()) {
                count += 1;
                size += dir_size_bytes(&path);
            } else if name != "node_modules" && name != ".git" {
                stack.push(path);
            }
        }
    }
    (count, size)
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageCategory {
    pub id: String,
    pub name: String,
    pub objects: usize,
    pub size_mb: f64,
    pub reclaimable_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageMetrics {
    pub total_gb: f64,
    pub free_gb: f64,
    pub used_gb: f64,
    pub used_percent: f64,
    pub build_artifacts_mb: f64,
    pub cache_reclaimable_mb: f64,
    pub categories: Vec<StorageCategory>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunningProcessItem {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub status: String,
    /// True for processes this app owns, so the panel can separate "what this
    /// app costs me" from whatever else the machine is doing.
    pub is_ours: bool,
}

/// Disk usage for the volume holding the project, plus what its caches occupy.
#[tauri::command]
fn fetch_system_storage(project_root: String) -> Result<StorageMetrics, String> {
    let root = PathBuf::from(if project_root.trim().is_empty() {
        ".".to_string()
    } else {
        project_root
    });
    let root = root.canonicalize().unwrap_or(root);

    let disks = sysinfo::Disks::new_with_refreshed_list();
    // The volume the project lives on, not simply the boot disk — they differ
    // whenever someone works from an external drive.
    let disk = disks
        .list()
        .iter()
        .filter(|d| root.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .or_else(|| disks.list().first());
    let (total_bytes, free_bytes) = disk
        .map(|d| (d.total_space(), d.available_space()))
        .unwrap_or((0, 0));
    let total_gb = round1(total_bytes as f64 / (1024.0 * 1024.0 * 1024.0));
    let free_gb = round1(free_bytes as f64 / (1024.0 * 1024.0 * 1024.0));
    let used_gb = round1(total_gb - free_gb);
    let used_percent = if total_gb > 0.0 {
        round1((used_gb / total_gb) * 100.0)
    } else {
        0.0
    };

    let dist = root.join("dist");
    let vite_cache = root.join("node_modules").join(".vite");
    let logs_temp = root.join("logs-temp");
    let (pycache_count, pycache_bytes) =
        scan_named_dirs(&root, &["__pycache__", ".pytest_cache", ".mypy_cache"]);

    let dist_bytes = if dist.is_dir() { dir_size_bytes(&dist) } else { 0 };
    let vite_bytes = if vite_cache.is_dir() {
        dir_size_bytes(&vite_cache)
    } else {
        0
    };
    let logs_bytes = if logs_temp.is_dir() {
        dir_size_bytes(&logs_temp)
    } else {
        0
    };
    let dist_objects = std::fs::read_dir(&dist).map(|it| it.count()).unwrap_or(0);

    let categories = vec![
        StorageCategory {
            id: "build-artifacts".into(),
            name: "Build Output (dist)".into(),
            objects: dist_objects,
            size_mb: round1(dist_bytes as f64 / MB),
            reclaimable_mb: round1(dist_bytes as f64 / MB),
        },
        StorageCategory {
            id: "vite-cache".into(),
            name: "Vite Cache".into(),
            objects: usize::from(vite_bytes > 0),
            size_mb: round1(vite_bytes as f64 / MB),
            reclaimable_mb: round1(vite_bytes as f64 / MB),
        },
        StorageCategory {
            id: "pycache".into(),
            name: "Python Bytecode (__pycache__)".into(),
            objects: pycache_count,
            size_mb: round1(pycache_bytes as f64 / MB),
            reclaimable_mb: round1(pycache_bytes as f64 / MB),
        },
        StorageCategory {
            id: "logs-temp".into(),
            name: "Logs & Temp Buffers".into(),
            objects: 0,
            size_mb: round1(logs_bytes as f64 / MB),
            reclaimable_mb: round1(logs_bytes as f64 / MB),
        },
    ];

    Ok(StorageMetrics {
        total_gb,
        free_gb,
        used_gb,
        used_percent,
        build_artifacts_mb: round1(dist_bytes as f64 / MB),
        cache_reclaimable_mb: round1(
            (dist_bytes + vite_bytes + pycache_bytes + logs_bytes) as f64 / MB,
        ),
        categories,
    })
}

/// The heaviest processes on the host, with this app's own children marked.
#[tauri::command]
fn fetch_system_processes(state: State<'_, AppState>) -> Result<Vec<RunningProcessItem>, String> {
    let mut sys = state
        .sys
        .lock()
        .map_err(|e| format!("Failed to acquire system lock: {}", e))?;
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut items: Vec<RunningProcessItem> = sys
        .processes()
        .values()
        .map(|p| {
            let cmdline = p
                .cmd()
                .iter()
                .map(|c| c.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            let exe = p
                .exe()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let haystack = format!("{} {}", exe, cmdline);
            let name = p.name().to_string_lossy().to_string();
            RunningProcessItem {
                pid: p.pid().as_u32(),
                name: if name.is_empty() {
                    cmdline.chars().take(40).collect()
                } else {
                    name
                },
                cpu_percent: round1(f64::from(p.cpu_usage())),
                memory_mb: round1(p.memory() as f64 / MB),
                status: p.status().to_string(),
                is_ours: haystack.contains("acsa-engine")
                    || haystack.contains("engine-codex")
                    || haystack.contains("pty_bridge")
                    || haystack.contains("ACSA Code"),
            }
        })
        .collect();

    // Ours first, then the machine's heaviest.
    items.sort_by(|a, b| {
        b.is_ours.cmp(&a.is_ours).then(
            b.memory_mb
                .partial_cmp(&a.memory_mb)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    items.truncate(10);
    Ok(items)
}

/// Delete regenerable caches inside the project and report what came back.
#[tauri::command]
fn system_cleanup(project_root: String) -> Result<serde_json::Value, String> {
    let root = PathBuf::from(project_root.trim());
    if !root.is_dir() {
        return Err("The project folder is not open, so there is nothing to clean.".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    // Refuse a filesystem root: this deletes directories, and "clean everything
    // under /" is not a thing anyone means.
    if root.parent().is_none() {
        return Err("Refusing to clean a filesystem root.".into());
    }

    let mut reclaimed = 0u64;
    let mut removed: Vec<String> = Vec::new();
    for (label, path) in [
        ("dist", root.join("dist")),
        ("node_modules/.vite", root.join("node_modules").join(".vite")),
        ("logs-temp", root.join("logs-temp")),
    ] {
        if path.is_dir() {
            let size = dir_size_bytes(&path);
            if std::fs::remove_dir_all(&path).is_ok() {
                reclaimed += size;
                removed.push(label.to_string());
            }
        }
    }

    // `__pycache__` has no single parent, so it is cleared by walking. Anything
    // else under the root is left exactly where it is.
    let mut stack = vec![root.clone()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if matches!(name.as_ref(), "__pycache__" | ".pytest_cache" | ".mypy_cache") {
                let size = dir_size_bytes(&path);
                if std::fs::remove_dir_all(&path).is_ok() {
                    reclaimed += size;
                    removed.push(name.to_string());
                }
            } else if name != "node_modules" && name != ".git" && name != "target" {
                stack.push(path);
            }
        }
    }

    let reclaimed_mb = round1(reclaimed as f64 / MB);
    Ok(serde_json::json!({
        "success": true,
        "reclaimedMb": reclaimed_mb,
        "removed": removed,
        "message": format!(
            "Reclaimed {:.1} MB of regenerable caches — build output, bytecode and temporary buffers only.",
            reclaimed_mb
        ),
    }))
}

// ── Tauri Command: engine_call ──────────────────────────────────────────────

/// Run an engine subcommand and return its JSON envelope.
///
/// Everything the UI read from `/api/app/*` and `/api/ollama/*` was implemented
/// in `vite-fs-bridge.ts`, a Vite dev-server middleware. `configureServer` never
/// runs in a build, so a packaged app had no way to reach the database or Ollama
/// at all — it fell back to built-in defaults, which showed up as an unconfigured
/// provider list and "Ollama is not installed" on a machine where Ollama was
/// running. This exposes the same engine surface over IPC instead.
///
/// Whitelisted on purpose: this is a bridge to the bundled engine, not a general
/// command runner.
/// How long an engine subcommand may run before it is treated as wedged.
///
/// Generous on purpose: a full index of a large project and a cloud model call
/// both legitimately take a while. What this bounds is the case with no upper
/// bound at all — verified on a real machine: with a macOS file-access prompt
/// waiting to be answered, the engine sat inside a single `open()` syscall for
/// minutes, so the UI spun forever and every hanging call left a live process
/// behind it.
const ENGINE_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Run a command to completion, draining both pipes, or kill it at the deadline.
///
/// The pipes are drained on their own threads rather than polled: several
/// subcommands emit more than a pipe buffer's worth of JSON (`index` returns the
/// whole symbol table), and a child blocked writing to a full pipe looks exactly
/// like a hung one if nobody is reading.
fn run_with_timeout(
    program: &Path,
    args: &[String],
    timeout: std::time::Duration,
) -> Result<std::process::Output, String> {
    use std::io::Read;

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run the engine: {}", e))?;

    let stdout = child.stdout.take().ok_or("could not capture engine output")?;
    let stderr = child.stderr.take().ok_or("could not capture engine errors")?;
    let stdout_thread = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = std::io::BufReader::new(stdout).read_to_end(&mut buffer);
        buffer
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = std::io::BufReader::new(stderr).read_to_end(&mut buffer);
        buffer
    });

    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "the engine did not respond within {}s and was stopped",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("could not wait for the engine: {}", e)),
        }
    };

    Ok(std::process::Output {
        status,
        stdout: stdout_thread.join().unwrap_or_default(),
        stderr: stderr_thread.join().unwrap_or_default(),
    })
}

#[tauri::command]
async fn engine_call(
    app_handle: tauri::AppHandle,
    subcommand: String,
    args: Vec<String>,
) -> Result<String, String> {
    const ALLOWED: [&str; 10] = [
        "db", "ollama", "index", "git", "indexer", "skills", "mcp", "ai", "project", "fs",
    ];
    if !ALLOWED.contains(&subcommand.as_str()) {
        return Err(format!("engine subcommand not allowed: {}", subcommand));
    }

    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut argv) = engine_invocation(resource_dir.as_deref(), &subcommand);
    argv.extend(args);

    let output = tauri::async_runtime::spawn_blocking(move || {
        run_with_timeout(&program, &argv, ENGINE_CALL_TIMEOUT)
    })
    .await
    .map_err(|e| format!("engine task failed: {}", e))?
    ?;

    // The engine writes structured log lines before its result, so the envelope
    // is the last non-empty line — the same rule the dev bridge uses.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::to_string);

    match last {
        Some(line) => Ok(line),
        None => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(if stderr.trim().is_empty() {
                format!("engine {} produced no output", subcommand)
            } else {
                stderr.trim().to_string()
            })
        }
    }
}

// ── Interactive terminal (PTY) ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct TerminalChunk {
    /// Which shell this came from. Restarting kills the previous child, whose reader
    /// thread then reports exit — without this the new session is marked dead by the
    /// old one's parting message, and the terminal only works after a full reload.
    pid: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    pid: u32,
}

/// The PTY child backing the integrated terminal.
///
/// The dev bridge owned this: it spawned `scripts/pty_bridge.py` and pushed the
/// byte stream to the browser over server-sent events. A packaged app has no Node
/// process, so the child is spawned here and its output is emitted as Tauri
/// events instead. `pty_bridge.py` itself is unchanged — it already speaks
/// newline-delimited JSON on stdin and a raw byte stream on stdout.
pub struct TerminalState {
    child: Mutex<Option<std::process::Child>>,
}

impl TerminalState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Minimal JSON string escaping for the PTY control channel. Keeps the terminal
/// off a JSON dependency for one small message shape.
fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn pty_send(child: &mut std::process::Child, message: &str) -> Result<(), String> {
    use std::io::Write;
    let stdin = child.stdin.as_mut().ok_or("terminal stdin is closed")?;
    stdin
        .write_all(format!("{}\n", message).as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not write to the terminal: {}", e))
}

/// Start (or restart) the shell. Mirrors `/api/terminal/spawn`.
#[tauri::command]
fn terminal_spawn(
    app_handle: tauri::AppHandle,
    state: State<'_, TerminalState>,
    cwd: String,
    cols: u32,
    rows: u32,
) -> Result<u32, String> {
    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut previous) = guard.take() {
            let _ = pty_send(&mut previous, "{\"action\":\"kill\"}");
            let _ = previous.kill();
        }
    }

    let working_dir = if Path::new(&cwd).is_dir() {
        cwd
    } else {
        std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
    };

    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut argv) = engine_invocation(resource_dir.as_deref(), "pty");
    argv.extend([
        "--cwd".to_string(),
        working_dir,
        "--cols".to_string(),
        cols.max(10).to_string(),
        "--rows".to_string(),
        rows.max(4).to_string(),
    ]);

    let mut child = Command::new(&program)
        .args(&argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start the terminal: {}", e))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "could not capture terminal output".to_string())?;

    let pid = child.id();
    *state.child.lock().map_err(|e| e.to_string())? = Some(child);

    // Raw PTY bytes are forwarded as they arrive; the reader thread owns stdout.
    let app_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buffer = [0u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let _ = app_for_reader.emit("terminal:data", TerminalChunk { pid, data });
                }
            }
        }
        let _ = app_for_reader.emit("terminal:exit", TerminalExit { pid });
    });

    let _ = app_handle.emit(
        "terminal:data",
        TerminalChunk {
            pid,
            data: "\r\n\u{1b}[38;5;39m[Interactive PTY Shell Connected]\u{1b}[0m\r\n".to_string(),
        },
    );

    Ok(pid)
}

/// Forward keystrokes. Mirrors `/api/terminal/input`; a missing shell is not an
/// error, because the client fires these optimistically while a shell is starting.
#[tauri::command]
fn terminal_input(state: State<'_, TerminalState>, data: String) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    let Some(child) = guard.as_mut() else {
        return Ok(());
    };
    let message = format!("{{\"action\":\"stdin\",\"data\":\"{}\"}}", json_escape(&data));
    pty_send(child, &message)
}

/// Forward a window resize. Mirrors `/api/terminal/resize`.
#[tauri::command]
fn terminal_resize(state: State<'_, TerminalState>, cols: u32, rows: u32) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    let Some(child) = guard.as_mut() else {
        return Ok(());
    };
    let message = format!(
        "{{\"action\":\"resize\",\"cols\":{},\"rows\":{}}}",
        cols.max(10),
        rows.max(4)
    );
    pty_send(child, &message)
}

// ── Streaming chat ──────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct AiFrame {
    line: String,
}

/// The in-flight chat child, so a stream can actually be cancelled.
///
/// The dev bridge owned this and streamed server-sent events. A packaged app has no
/// server, so the engine's NDJSON frames are forwarded as Tauri events instead —
/// the same move the terminal made. Frames go out raw and the frontend parses them,
/// which keeps this side free of a JSON dependency for one message shape.
pub struct ChatState {
    child: Mutex<Option<std::process::Child>>,
}

impl ChatState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

#[tauri::command]
async fn chat_stream(
    app_handle: tauri::AppHandle,
    state: State<'_, ChatState>,
    payload: String,
) -> Result<(), String> {
    if let Some(mut previous) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = previous.kill();
    }

    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut argv) = engine_invocation(resource_dir.as_deref(), "ai");
    argv.push("chat".to_string());
    argv.push(payload);

    let mut child = Command::new(&program)
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        // Name the path: if resolution is what failed, that is the whole diagnosis.
        .map_err(|e| format!("could not start the assistant ({}): {}", program.display(), e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "could not capture assistant output".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "could not capture assistant errors".to_string())?;

    *state.child.lock().map_err(|e| e.to_string())? = Some(child);

    let app_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader, Read};
        let app_for_stderr = app_for_reader.clone();
        // Errors first: a failed run prints nothing useful on stdout, and that
        // message is what the user needs to see.
        let stderr_thread = std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stderr.read_to_string(&mut buffer);
            buffer
        });

        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_for_reader.emit("ai:frame", AiFrame { line });
        }

        let stderr_text = stderr_thread.join().unwrap_or_default();
        let _ = app_for_stderr.emit("ai:exit", stderr_text.trim().to_string());
    });

    Ok(())
}

#[tauri::command]
fn chat_cancel(state: State<'_, ChatState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}

// ── Ollama model downloads ──────────────────────────────────────────────────

/// Its own slot, not the chat's: cancelling a chat must not kill a model
/// download, and cancelling a download must not kill a chat.
pub struct OllamaState {
    child: Mutex<Option<std::process::Child>>,
}

impl OllamaState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Download a model, streaming progress as `ollama:frame` events.
///
/// A download is the one Ollama action that takes minutes and can fail halfway,
/// so it needs the same streaming treatment as chat. The engine talks to
/// Ollama's own `/api/pull`; this only forwards its frames.
#[tauri::command]
async fn ollama_pull(
    app_handle: tauri::AppHandle,
    state: State<'_, OllamaState>,
    model: String,
) -> Result<(), String> {
    if let Some(mut previous) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = previous.kill();
    }

    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut argv) = engine_invocation(resource_dir.as_deref(), "ollama");
    argv.push("pull".to_string());
    argv.push(format!("{{\"model\":\"{}\"}}", model));

    let mut child = Command::new(&program)
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the download ({}): {}", program.display(), e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "could not capture download output".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "could not capture download errors".to_string())?;
    *state.child.lock().map_err(|e| e.to_string())? = Some(child);

    let app_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader, Read};
        let stderr_handle = app_for_reader.clone();
        let stderr_thread = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_for_reader.emit("ollama:frame", AiFrame { line });
        }
        let stderr_text = stderr_thread.join().unwrap_or_default();
        let _ = stderr_handle.emit("ollama:exit", stderr_text.trim().to_string());
    });

    Ok(())
}

#[tauri::command]
fn ollama_cancel(state: State<'_, OllamaState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}

// ── Codex agent runtime ─────────────────────────────────────────────────────

const CODEX_BIN_NAME: &str = "codex";

/// Locate the Codex CLI fetched by `scripts/fetch_codex_sidecar.sh`.
///
/// Packaged builds read it from their own resources; a source checkout reads the
/// git-ignored `.tauri/engine-codex/` copy, the same arrangement as the engine.
fn resolve_codex_bin(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(resources) = resource_dir {
        candidates.push(resources.join("engine-codex").join(CODEX_BIN_NAME));
        candidates.push(resources.join(CODEX_BIN_NAME));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("engine-codex")
            .join(CODEX_BIN_NAME),
    );
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(CODEX_BIN_NAME));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Resolve a provider credential through the engine.
///
/// The key must not travel over IPC: passing it down from the frontend would undo the
/// write-only property the credential migration established, and it is already in the
/// engine's database. Same server-side resolution the review and inline-edit paths use.
fn engine_resolve_key(app_handle: &tauri::AppHandle, provider: &str) -> Option<String> {
    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut argv) = engine_invocation(resource_dir.as_deref(), "db");
    argv.push("providers.resolveKey".to_string());
    argv.push(format!("{{\"id\":\"{}\"}}", provider));

    let output = Command::new(&program).args(&argv).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout.lines().rev().find(|l| !l.trim().is_empty())?;
    let parsed: serde_json::Value = serde_json::from_str(last).ok()?;
    let key = parsed.get("data")?.as_str()?.trim().to_string();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

/// Run Codex as the agent and forward its JSON stream to the UI.
///
/// This is the replacement for our own agent loop. That loop could not do native
/// tool calling: the model narrated `read_file` in prose and the harness answered
/// with a guard message, so nothing was ever edited. Codex does emit real tool
/// calls — verified by driving it headlessly against the user's provider, where it
/// edited a file correctly in ~14s and streamed `thread`/`turn`/`item` events.
///
/// `config_toml` is written to this app's own `CODEX_HOME` before launch, so the
/// provider the user configured in our settings is the one Codex uses, and we never
/// touch their personal Codex configuration.
#[tauri::command]
async fn codex_exec(
    app_handle: tauri::AppHandle,
    state: State<'_, ChatState>,
    prompt: String,
    project_root: String,
    config_toml: String,
    provider_id: String,
    catalog_json: String,
    // The model the run should use. Needed as a CLI argument for local runs,
    // where `--oss` would otherwise choose (and download) its own default.
    model: String,
    // Set for a local runtime (Ollama, LM Studio). Codex then talks to it over
    // its own adapter instead of a custom OpenAI-compatible provider — which
    // matters because Ollama does not implement the Responses API, so a
    // `wire_api = "responses"` provider entry simply cannot reach it.
    local_provider: Option<String>,
) -> Result<(), String> {
    let resource_dir = app_handle.path().resource_dir().ok();
    let program = resolve_codex_bin(resource_dir.as_deref()).ok_or_else(|| {
        "The agent runtime is not installed. Run scripts/fetch_codex_sidecar.sh.".to_string()
    })?;

    // Its own home, beside our data: config and auth stay ours, not the user's CLI setup.
    let codex_home = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {}", e))?
        .join("codex");
    std::fs::create_dir_all(&codex_home).map_err(|e| format!("could not create {}: {}", codex_home.display(), e))?;
    if !config_toml.trim().is_empty() {
        // `model_catalog_json` is a *path* to a catalog file, not inline JSON — verified
        // against a working Codex install, after an inline attempt parsed without error and
        // silently did nothing. Without the catalog Codex warns that it is "defaulting to
        // fallback metadata" for our provider's models, which is the error the UI showed.
        let config = if catalog_json.trim().is_empty() {
            config_toml.clone()
        } else {
            let dir = codex_home.join("model-catalogs");
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("could not create {}: {}", dir.display(), e))?;
            let path = dir.join(format!("{}.json", provider_id));
            std::fs::write(&path, &catalog_json)
                .map_err(|e| format!("could not write the model catalog: {}", e))?;
            // Prepended, because TOML tables come last — a top-level key written after the
            // provider table would land inside it and be rejected.
            format!(
                "model_catalog_json = \"{}\"\n{}",
                path.to_string_lossy(),
                config_toml
            )
        };
        std::fs::write(codex_home.join("config.toml"), config)
            .map_err(|e| format!("could not write Codex config: {}", e))?;
    }

    if let Some(mut previous) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = previous.kill();
    }

    let working_dir = if Path::new(&project_root).is_dir() {
        project_root.clone()
    } else {
        ".".to_string()
    };

    let mut command = Command::new(&program);
    command
        .arg("exec")
        .arg("--json")
        // The project may not be a git repo; Codex refuses to start otherwise.
        .arg("--skip-git-repo-check");
    if let Some(local) = local_provider.as_deref().filter(|p| !p.trim().is_empty()) {
        // `-m` is not optional here. `--oss` has its own default model and will go
        // and download it — verified the hard way: without this, a run against the
        // installed 1.5b model started fetching a 12.85 GB one instead of using
        // what the user had. Pinning the model makes it run on the chosen model, or
        // fail, rather than quietly pulling gigabytes.
        command
            .arg("--oss")
            .arg("--local-provider")
            .arg(local)
            .arg("-m")
            .arg(&model);
    }
    // The prompt is positional, so it goes last.
    command
        .arg(&prompt)
        .current_dir(&working_dir)
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Codex reads the key from the environment named by `env_key`, so it is set here
    // rather than accepted from the caller — the credential stays on this side.
    if !provider_id.trim().is_empty() {
        if let Some(key) = engine_resolve_key(&app_handle, provider_id.trim()) {
            command.env("ACSA_CODEX_API_KEY", key);
        }
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start the agent ({}): {}", program.display(), e))?;

    let stdout = child.stdout.take().ok_or("could not capture agent output")?;
    let mut stderr = child.stderr.take().ok_or("could not capture agent errors")?;
    *state.child.lock().map_err(|e| e.to_string())? = Some(child);

    let app_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader, Read};
        let stderr_handle = app_for_reader.clone();
        let stderr_thread = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });

        // Token counts ride on `turn.completed`, one per turn, so a run's total is
        // their sum. Verified against a live run:
        //   {"type":"turn.completed","usage":{"input_tokens":2050,…,"output_tokens":2,…}}
        // They are collected here because the UI is the only other reader of this
        // stream, and it does not need to do arithmetic on tokens.
        let mut prompt_tokens: u64 = 0;
        let mut completion_tokens: u64 = 0;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if line.contains("\"turn.completed\"") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(usage) = value.get("usage") {
                        let field = |key: &str| {
                            usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
                        };
                        prompt_tokens += field("input_tokens");
                        completion_tokens += field("output_tokens");
                    }
                }
            }
            // Each line is one JSON event; the UI decides what to show.
            let _ = app_for_reader.emit("codex:event", AiFrame { line });
        }
        // Emitted before `codex:exit` so the UI has the numbers by the time it
        // considers the run over.
        if prompt_tokens > 0 || completion_tokens > 0 {
            let _ = app_for_reader.emit(
                "codex:usage",
                AiFrame {
                    line: format!(
                        "{{\"promptTokens\":{},\"completionTokens\":{}}}",
                        prompt_tokens, completion_tokens
                    ),
                },
            );
        }
        let stderr_text = stderr_thread.join().unwrap_or_default();
        let _ = stderr_handle.emit("codex:exit", stderr_text.trim().to_string());
    });

    Ok(())
}

// ── Application Entry Point ─────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
        })
        .manage(TerminalState::new())
        .manage(ChatState::new())
        .manage(OllamaState::new())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            fetch_system_metrics,
            fetch_system_storage,
            fetch_system_processes,
            system_cleanup,
            list_project_files,
            read_file_content,
            read_file_base64,
            write_file_content,
            create_file_or_folder,
            delete_project_file,
            create_project_template,
            pick_folder,
            engine_call,
            terminal_spawn,
            terminal_input,
            terminal_resize,
            chat_stream,
            chat_cancel,
            ollama_pull,
            ollama_cancel,
            codex_exec,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            println!(
                "[ACSA Code] started. Engine dir: {:?}",
                resolve_engine_dir(app.path().resource_dir().ok().as_deref())
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to launch ACSA Code");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_reference_encoder() {
        // A preview that decodes wrong is a broken image, so the padding and the
        // partial-chunk cases are the whole point of this test.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0xff, 0x00, 0xfe]), "/wD+");
    }

    #[test]
    fn run_with_timeout_kills_a_wedged_child() {
        // The real failure this exists for: the engine sat inside one `open()`
        // for minutes while a permission prompt went unanswered, so the request
        // never returned and the process never exited.
        let started = std::time::Instant::now();
        let result = run_with_timeout(
            &PathBuf::from("/bin/sleep"),
            &["30".to_string()],
            std::time::Duration::from_millis(300),
        );
        assert!(result.is_err(), "a wedged child must not be reported as success");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "the deadline was measured in tenths of a second, not respected"
        );
    }

    #[test]
    fn run_with_timeout_drains_output_larger_than_a_pipe_buffer() {
        // `index` returns the whole symbol table. A child that fills the pipe
        // blocks until someone reads it, which looks identical to a hang.
        let args: Vec<String> = vec![
            "-c".into(),
            "head -c 300000 /dev/zero | tr '\\0' 'x'".into(),
        ];
        let out = run_with_timeout(
            &PathBuf::from("/bin/sh"),
            &args,
            std::time::Duration::from_secs(20),
        )
        .expect("large output must not time out");
        assert_eq!(out.stdout.len(), 300_000);
    }

    #[test]
    fn run_with_timeout_returns_the_exit_status() {
        let out = run_with_timeout(
            &PathBuf::from("/bin/sh"),
            &["-c".into(), "exit 3".into()],
            std::time::Duration::from_secs(20),
        )
        .expect("a failing command still runs");
        assert_eq!(out.status.code(), Some(3));
    }

    #[test]
    fn dir_size_skips_node_modules() {
        let root = std::env::temp_dir().join("acsa-dir-size-test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("a.txt"), b"12345").unwrap();
        std::fs::write(root.join("node_modules").join("big.bin"), vec![0u8; 4096]).unwrap();
        assert_eq!(dir_size_bytes(&root), 5);
        let _ = std::fs::remove_dir_all(&root);
    }
}
