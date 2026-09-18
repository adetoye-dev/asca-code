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

/// Standard base64 decode, the counterpart to `base64_encode`.
///
/// Attachments arrive from the webview as `data:` URLs, and the agent runtime
/// wants files, so this is the bridge. Hand-rolled for the same reason as the
/// encoder: one crate for twenty lines is not worth it, and a wrong decoder
/// would write corrupt images rather than fail loudly.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for ch in input.bytes() {
        let value = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return Err(format!("invalid base64 character: {}", ch as char)),
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    Ok(output)
}

/// Write a `data:` URL into the runtime's own home and return the file.
///
/// Kept per app home rather than in the project, so an attachment never becomes
/// an untracked file in the user's repository.
fn write_attachment(codex_home: &Path, data_url: &str, index: usize) -> Option<PathBuf> {
    let (header, payload) = data_url.split_once(',')?;
    if !header.contains("base64") {
        return None;
    }
    let mime = header
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("image/png");
    let extension = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        _ => "png",
    };
    let bytes = base64_decode(payload).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let dir = codex_home.join("attachments");
    std::fs::create_dir_all(&dir).ok()?;

    // A cheap content hash keeps repeat attachments from piling up, and gives the
    // name some stability when the same screenshot is sent twice.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in &bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    let path = dir.join(format!("{:016x}-{}.{}", hash, index, extension));
    if !path.exists() {
        std::fs::write(&path, &bytes).ok()?;
    }
    Some(path)
}

/// Keep the attachments directory bounded: it is screenshots, and they are big.
fn prune_attachments(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((modified, e.path()))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
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

/// Escape a string for use inside an AppleScript double-quoted literal.
#[cfg(target_os = "macos")]
fn applescript_literal(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// The user's home directory, read from the same variables the rest of the app
/// uses (`HOME` here, `USERPROFILE` on Windows).
fn user_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Expand a leading `~` to the home directory.
///
/// Rust expands nothing: `~` is a shell feature. But the New Project dialog seeds
/// its destination with `~/AcsaProjects` and its placeholder suggests
/// `~/Desktop`, so without this the default path is read as *relative* to the
/// process working directory — `/` for a bundle launched from Finder — the write
/// is denied, and scaffolding from the default location fails for every user.
fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        if let Some(home) = user_home() {
            return home;
        }
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = user_home() {
            return home.join(rest);
        }
    }
    // An absolute path, a relative path, and `~someone` are all left alone —
    // expanding another user's home is not ours to guess.
    PathBuf::from(trimmed)
}

/// Ask the user where to write a file that does not exist yet.
///
/// Separate from `pick_folder` because `choose folder` can only ever return a
/// directory, and a backup the user cannot name is a backup they cannot find
/// again. `choose file name` returns the path *without* creating anything, so
/// the write — and its owner-only mode — stays in our hands.
#[tauri::command]
fn pick_save_file(default_name: String, prompt: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // Start at the Desktop instead of whatever folder the app last touched.
        // The panel otherwise opens inside the project directory, and a backup or
        // support bundle dropped into a repository is a file the user can commit
        // by accident — observed, not hypothetical: the first bundle written
        // through this path landed in a checked-out repo.
        let script = format!(
            "POSIX path of (choose file name with prompt \"{}\" default name \"{}\" default location (path to desktop folder))",
            applescript_literal(&prompt),
            applescript_literal(&default_name)
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();
        match output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(if s.is_empty() { None } else { Some(s) })
            }
            // Cancelling is a choice, not a failure worth reporting.
            _ => Ok(None),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (default_name, prompt);
        Ok(None)
    }
}

/// Ask the user for an existing file to read — the import half of a backup.
#[tauri::command]
fn pick_open_file(prompt: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // Same starting point as the save panel, so a backup exported to the
        // Desktop is where the next import looks for it.
        let script = format!(
            "POSIX path of (choose file with prompt \"{}\" default location (path to desktop folder))",
            applescript_literal(&prompt)
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();
        match output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(if s.is_empty() { None } else { Some(s) })
            }
            _ => Ok(None),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        Ok(None)
    }
}

/// Show a file or folder in the OS file manager, so "where is my data?" has an
/// answer that does not require the user to read a path out of a text box.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("no such path: {}", path));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&target);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", target.display()));
        c
    };
    // Linux has no portable "reveal in file manager"; opening the containing
    // directory is the closest honest equivalent.
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let directory = if target.is_dir() {
            target.clone()
        } else {
            target.parent().map(Path::to_path_buf).unwrap_or_else(|| target.clone())
        };
        let mut c = std::process::Command::new("xdg-open");
        c.arg(directory);
        c
    };

    command
        .spawn()
        .map_err(|e| format!("could not open the file manager: {}", e))?;
    Ok(())
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
        Some(p) if !p.trim().is_empty() => expand_home(&p),
        // Named after the app: this folder is created in the user's home and is
        // the first thing they see if they scaffold without choosing a location.
        _ => match user_home() {
            Some(home) => home.join("ACSA Projects"),
            None => PathBuf::from("projects"),
        },
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

/// Words that introduce a credential. Ordered longest-first so `client_secret`
/// wins over `secret`.
const SECRET_KEYS: &[&str] = &[
    "acsa_codex_api_key",
    "acsa_secret_",
    "client_secret",
    "private_key",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "api-key",
    "apikey",
    "password",
    "passwd",
    "env_key",
    "secret",
    "bearer",
    "token",
];

/// Shortest value worth masking. Below this, the "value" is prose — `token: 42`.
const MIN_SECRET_LEN: usize = 6;

const MASK: &str = "***";

/// Mask credential-shaped text before it reaches a panel the user may screenshot.
///
/// The runtime's stderr is forwarded verbatim, and on purpose: it is the only
/// window into a failed run. But a runtime that dumps its environment or echoes a
/// header on failure would print a live key into the OUTPUT panel, which is easy
/// to screenshot and easy to paste into a bug report. So free-text channels are
/// masked, and anything we handed the child as a credential is masked wherever it
/// appears, whatever it looks like.
///
/// `agent:event` is deliberately *not* passed through here. It is JSON-RPC the UI
/// parses and answers, and an approval has to show the command it is really
/// approving — a masked command would be worse than a visible one.
fn redact_for_display(line: &str, known: &[String]) -> String {
    let mut out = line.to_string();

    // Whatever we put in the child's environment, wherever it turns up.
    for secret in known {
        if secret.len() >= MIN_SECRET_LEN && out.contains(secret.as_str()) {
            out = out.replace(secret.as_str(), MASK);
        }
    }

    let chars: Vec<char> = out.chars().collect();
    let lowered: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    // A value follows a *strong* separator. A plain space is not one, or prose
    // like "reading token counts" gets a hole punched in it.
    let strong_separator = |c: char| matches!(c, ':' | '=' | '"' | '\'');
    let blank = |c: char| matches!(c, ' ' | '\t');
    let ends_value = |c: char| strong_separator(c) || blank(c) || matches!(c, ',' | '}' | ']' | ';');

    let mut result = String::with_capacity(out.len());
    let mut i = 0;
    while i < chars.len() {
        let key = SECRET_KEYS.iter().find(|key| {
            let k: Vec<char> = key.chars().collect();
            i + k.len() <= lowered.len() && lowered[i..i + k.len()] == k[..]
        });

        let Some(key) = key else {
            result.push(chars[i]);
            i += 1;
            continue;
        };

        let klen = key.chars().count();
        let key_end = i + klen;
        let mut j = key_end;
        let mut saw_separator = false;
        while j < chars.len() {
            // `Bearer <token>` is separated by the space, and only by that.
            if strong_separator(chars[j]) || (*key == "bearer" && blank(chars[j])) {
                saw_separator = true;
                j += 1;
            } else if saw_separator && blank(chars[j]) {
                j += 1;
            } else {
                break;
            }
        }

        let value_start = j;
        while j < chars.len() && !ends_value(chars[j]) {
            j += 1;
        }
        let value: String = chars[value_start..j].iter().collect();

        // `Authorization: Bearer <token>` — the scheme is not the credential.
        if saw_separator && matches!(value.to_ascii_lowercase().as_str(), "bearer" | "basic") {
            let mut k = j;
            while k < chars.len() && blank(chars[k]) {
                k += 1;
            }
            let token_start = k;
            while k < chars.len() && !ends_value(chars[k]) {
                k += 1;
            }
            if k - token_start >= MIN_SECRET_LEN {
                result.extend(&chars[i..j]);
                result.extend(&chars[j..token_start]);
                result.push_str(MASK);
                i = k;
                continue;
            }
        }

        if saw_separator && j - value_start >= MIN_SECRET_LEN {
            // Keep the separator, mask only the value, so the line still reads.
            result.extend(&chars[i..value_start]);
            result.push_str(MASK);
            i = j;
            continue;
        }

        result.extend(&chars[i..key_end]);
        i = key_end;
    }
    result
}

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

/// Engine subcommands the renderer is allowed to reach over IPC.
///
/// This is a security boundary rather than a convenience list: every entry is a
/// subcommand the *page* chooses, so everything here is reachable even if the
/// page is compromised. `pty` and `adapter` are deliberately absent — the
/// terminal and the local-model adapter are spawned by Rust with arguments Rust
/// picked, not with arguments the webview supplies.
const ALLOWED_ENGINE_SUBCOMMANDS: [&str; 12] = [
    "db", "ollama", "index", "git", "indexer", "skills", "mcp", "ai", "project", "fs", "backup",
    "support",
];

fn engine_subcommand_allowed(subcommand: &str) -> bool {
    ALLOWED_ENGINE_SUBCOMMANDS.contains(&subcommand)
}

#[tauri::command]
async fn engine_call(
    app_handle: tauri::AppHandle,
    subcommand: String,
    args: Vec<String>,
) -> Result<String, String> {
    if !engine_subcommand_allowed(&subcommand) {
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
/// The runtime binary and its private home, with our config and model catalog in place.
///
/// Shared by both transports: `exec` and `app-server` read the same home, so the
/// provider, the model catalog, the approval policy and the MCP servers are
/// configured once and behave identically either way.
fn prepare_agent_home(
    app_handle: &tauri::AppHandle,
    config_toml: &str,
    provider_id: &str,
    catalog_json: &str,
) -> Result<(PathBuf, PathBuf), String> {
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
    std::fs::create_dir_all(&codex_home)
        .map_err(|e| format!("could not create {}: {}", codex_home.display(), e))?;

    if !config_toml.trim().is_empty() {
        // `model_catalog_json` is a *path* to a catalog file, not inline JSON — verified
        // against a working Codex install, after an inline attempt parsed without error and
        // silently did nothing. Without the catalog Codex warns that it is "defaulting to
        // fallback metadata" for our provider's models, which is the error the UI showed.
        let config = if catalog_json.trim().is_empty() {
            config_toml.to_string()
        } else {
            let dir = codex_home.join("model-catalogs");
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("could not create {}: {}", dir.display(), e))?;
            let path = dir.join(format!("{}.json", provider_id));
            std::fs::write(&path, catalog_json)
                .map_err(|e| format!("could not write the model catalog: {}", e))?;
            // Prepended, because TOML tables come last — a top-level key written after the
            // provider table would land inside it and be rejected.
            format!("model_catalog_json = \"{}\"\n{}", path.to_string_lossy(), config_toml)
        };
        std::fs::write(codex_home.join("config.toml"), config)
            .map_err(|e| format!("could not write Codex config: {}", e))?;
    }

    Ok((program, codex_home))
}

/// A live `codex app-server` process.
///
/// The alternative is one `exec` process per turn, which cannot do the things
/// this can: answer an approval request (there is no channel to answer on), steer
/// a turn that is already running, or stream the answer token by token. The cost
/// is that the process outlives a turn, so its lifecycle is ours to manage.
///
/// Where a session's events go. Production emits Tauri events for the UI; a test
/// collects them. Being able to drive the session without an `AppHandle` is the
/// point: this layer was only reachable through the GUI, which is why its bugs
/// took a rebuild-and-click cycle to find and I could not reproduce the failure
/// that mattered.
pub type AgentEmitter = std::sync::Arc<dyn Fn(&str, String) + Send + Sync + 'static>;

pub struct AgentSession {
    child: std::process::Child,
    emitter: AgentEmitter,
    stdin: std::sync::Mutex<std::process::ChildStdin>,
    next_id: std::sync::atomic::AtomicU64,
    /// Replies waiting to arrive, keyed by the request id we sent. Shared with
    /// the reader thread, which is the only thing that can complete them.
    pending: std::sync::Arc<
        std::sync::Mutex<std::collections::HashMap<u64, std::sync::mpsc::Sender<serde_json::Value>>>,
    >,
    thread_id: std::sync::Mutex<Option<String>>,
    /// The turn currently running.
    ///
    /// `turn/interrupt` requires `threadId` *and* `turnId` (the schema marks both
    /// as required), so an interrupt that names only the thread is rejected. The
    /// id arrives in the `turn/start` reply and again in the `turn/started`
    /// notification; the reply is stored synchronously, the notification by the
    /// reader thread, so a turn that is running is always nameable.
    turn_id: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

impl AgentSession {
    /// Spawn a runtime and start reading it.
    ///
    /// Everything after this is transport: `request` writes a line and waits for
    /// the reply with the same id, and anything that is not a reply is forwarded
    /// to the emitter for the UI (or a test) to interpret.
    ///
    /// `env` carries the provider credential. It has to: `exec` resolves the key
    /// and puts it in the child's environment, and the first version of this did
    /// not, so every turn died on "Missing environment variable:
    /// `ACSA_CODEX_API_KEY`" — a run that reported success having done nothing.
    pub fn spawn(
        program: &Path,
        codex_home: &Path,
        working_dir: &str,
        env: &[(String, String)],
        emitter: AgentEmitter,
    ) -> Result<AgentSession, String> {
        let mut child = Command::new(program)
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .current_dir(working_dir)
            .env("CODEX_HOME", codex_home)
            .envs(env.iter().map(|(k, v)| (k.clone(), v.clone())))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start the agent runtime ({}): {}", program.display(), e))?;

        let stdin = child.stdin.take().ok_or("could not open the agent's input")?;
        let stdout = child.stdout.take().ok_or("could not capture agent output")?;
        let stderr = child.stderr.take().ok_or("could not capture agent errors")?;

        let pending: std::sync::Arc<
            std::sync::Mutex<std::collections::HashMap<u64, std::sync::mpsc::Sender<serde_json::Value>>>,
        > = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let turn_id: std::sync::Arc<std::sync::Mutex<Option<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(None));

        // The session id marks this session as current; a superseded one stays
        // quiet rather than announcing its shutdown into the next run.
        let session_id = SESSION_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

        let reader_pending = pending.clone();
        let reader_emitter = emitter.clone();
        let reader_turn = turn_id.clone();
        // Whatever we are about to hand the child as a credential, masked if it
        // comes back out. Built here because `env` does not outlive the spawn.
        let known_secrets: Vec<String> = env
            .iter()
            .map(|(_, value)| value.clone())
            .filter(|value| value.len() >= MIN_SECRET_LEN)
            .collect();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};

            let stderr_emitter = reader_emitter.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if !line.trim().is_empty() {
                        stderr_emitter("agent:stderr", redact_for_display(&line, &known_secrets));
                    }
                }
            });

            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                // A reply to something we asked: hand it to the waiting caller.
                if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
                    if let Some(tx) = reader_pending.lock().ok().and_then(|mut p| p.remove(&id)) {
                        let _ = tx.send(value);
                        continue;
                    }
                }
                // Remember the live turn, so an interrupt can name it. The
                // `turn/start` reply sets this synchronously too; this covers a
                // turn that was started by someone else (a steered or resumed
                // one) and keeps the two paths from disagreeing.
                if value.get("method").and_then(|m| m.as_str()) == Some("turn/started") {
                    if let Some(id) = value.pointer("/params/turn/id").and_then(|v| v.as_str()) {
                        if let Ok(mut slot) = reader_turn.lock() {
                            *slot = Some(id.to_string());
                        }
                    }
                }
                // Everything else is for the UI: notifications, and the requests
                // the runtime sends *us* (approvals), which the UI answers.
                reader_emitter("agent:event", line);
            }
            // stdout reached EOF: the process is gone. The real exit signal —
            // but only while this session is still the current one.
            if SESSION_SEQ.load(std::sync::atomic::Ordering::SeqCst) == session_id {
                reader_emitter("agent:exit", String::new());
            }
        });

        Ok(AgentSession {
            child,
            emitter,
            stdin: std::sync::Mutex::new(stdin),
            next_id: std::sync::atomic::AtomicU64::new(1),
            pending,
            thread_id: std::sync::Mutex::new(None),
            turn_id,
        })
    }

    /// Send one JSON-RPC request and wait for its reply.
    fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: std::time::Duration,
    ) -> Result<serde_json::Value, String> {
        use std::io::Write;

        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (tx, rx) = std::sync::mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, tx);

        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            writeln!(stdin, "{}", message).map_err(|e| format!("could not write to the agent: {}", e))?;
            stdin.flush().map_err(|e| e.to_string())?;
        }
        (self.emitter)("agent:request", message.to_string());

        match rx.recv_timeout(timeout) {
            Ok(reply) => {
                if let Some(error) = reply.get("error") {
                    return Err(format!("{}: {}", method, error));
                }
                Ok(reply)
            }
            Err(_) => {
                let _ = self
                    .pending
                    .lock()
                    .map(|mut p| p.remove(&id));
                Err(format!("{} did not answer in time", method))
            }
        }
    }

    /// Answer a request the runtime sent *us* — an approval, in practice.
    ///
    /// The decision is the runtime's own vocabulary and is written through as-is;
    /// see `ApprovalDecision` on the TypeScript side for the values the schema
    /// accepts. Kept here rather than only in the Tauri command so the same path
    /// the UI uses is the one a test drives.
    fn respond(
        &self,
        request_id: serde_json::Value,
        decision: serde_json::Value,
    ) -> Result<(), String> {
        use std::io::Write;
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": decision,
        });
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", message).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }
}

/// Managed state: the live app-server session, if one is running.
#[derive(Default)]
pub struct AgentState {
    session: std::sync::Mutex<Option<AgentSession>>,
}

/// Which session is current.
///
/// Events are emitted on one channel with no identity, so a replaced session's
/// stdout EOF announced itself into the *next* run's listener and ended it the
/// moment it started — a run that reported success and did nothing. The counter
/// lets a dying session stay quiet once it has been superseded.
static SESSION_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Start (or restart) the app-server session and open a thread.
///
/// Returns the thread id. `resume_thread_id` continues an existing one.
#[tauri::command]
async fn agent_start(
    app_handle: tauri::AppHandle,
    state: State<'_, AgentState>,
    project_root: String,
    config_toml: String,
    provider_id: String,
    catalog_json: String,
    model: String,
    resume_thread_id: Option<String>,
    approval_policy: String,
    approvals_reviewer: String,
    sandbox_mode: String,
) -> Result<String, String> {
    let (program, codex_home) = prepare_agent_home(&app_handle, &config_toml, &provider_id, &catalog_json)?;

    let working_dir = if Path::new(&project_root).is_dir() {
        project_root.clone()
    } else {
        ".".to_string()
    };

    // One session at a time; a second run replaces the first the way the exec
    // path always has.
    //
    // Supersede *before* killing. `spawn` also bumps the counter, but it runs
    // after this: in between, the outgoing process is dead and still counts as
    // current, so its stdout EOF would be emitted as *this* run's exit. The
    // listener is already attached by now, so the new run ended the moment it
    // began — "turn finished in 0s", an empty answer, on the second message of
    // every session and never the first. Superseding first closes the window.
    SESSION_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    {
        let mut guard = state.session.lock().map_err(|e| e.to_string())?;
        if let Some(mut previous) = guard.take() {
            let _ = previous.child.kill();
        }
    }

    let app_for_events = app_handle.clone();
    let emitter: AgentEmitter = std::sync::Arc::new(move |event: &str, line: String| {
        let _ = app_for_events.emit(event, AiFrame { line });
    });

    // Same server-side resolution the exec path uses, so the credential never
    // travels over IPC and the runtime gets it the way its config expects.
    let mut env: Vec<(String, String)> = Vec::new();
    if !provider_id.trim().is_empty() {
        if let Some(key) = engine_resolve_key(&app_handle, provider_id.trim()) {
            env.push(("ACSA_CODEX_API_KEY".to_string(), key));
        }
    }
    let session = AgentSession::spawn(&program, &codex_home, &working_dir, &env, emitter)?;

    {
        let mut guard = state.session.lock().map_err(|e| e.to_string())?;
        *guard = Some(session);
    }

    // Hold the reader's pending map for the lifetime of the session.
    let session_guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = session_guard.as_ref().ok_or("session vanished")?;

    session.request(
        "initialize",
        serde_json::json!({
            "clientInfo": { "name": "acsa-code", "version": env!("CARGO_PKG_VERSION") }
        }),
        std::time::Duration::from_secs(20),
    )?;

    let resuming = resume_thread_id.as_deref().map(str::trim).unwrap_or("").to_string();
    let mut thread_params = serde_json::json!({
        "model": model,
        "modelProvider": provider_id,
        "cwd": working_dir,
        "approvalPolicy": approval_policy,
        "approvalsReviewer": approvals_reviewer,
        "sandbox": sandbox_mode,
    });
    let method = if resuming.is_empty() {
        "thread/start"
    } else {
        // `thread/resume` takes the id; the rest of the context carries over.
        thread_params["threadId"] = serde_json::Value::String(resuming.clone());
        "thread/resume"
    };
    let reply = session.request(
        method,
        thread_params,
        std::time::Duration::from_secs(60),
    )?;

    let thread_id = reply
        .get("result")
        .and_then(|r| r.get("thread"))
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("thread/start answered without a thread id: {}", reply))?
        .to_string();
    if let Ok(mut slot) = session.thread_id.lock() {
        *slot = Some(thread_id.clone());
    }
    Ok(thread_id)
}

/// Send one turn to the open thread. Events stream as `agent:event`.
#[tauri::command]
async fn agent_turn(
    state: State<'_, AgentState>,
    text: String,
) -> Result<(), String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("no agent session is running")?;
    let thread_id = session
        .thread_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no thread is open")?;

    let reply = session.request(
        "turn/start",
        serde_json::json!({
            "threadId": thread_id,
            "input": [{ "type": "text", "text": text }],
        }),
        std::time::Duration::from_secs(30),
    )?;
    // The reply names the turn it just started. Storing it here is synchronous,
    // so an interrupt issued the instant the turn begins still has an id to name
    // — waiting for the `turn/started` notification would race that.
    if let Some(id) = reply.pointer("/result/turn/id").and_then(|v| v.as_str()) {
        if let Ok(mut slot) = session.turn_id.lock() {
            *slot = Some(id.to_string());
        }
    }
    Ok(())
}

/// Answer a request the runtime sent us — an approval, in practice.
#[tauri::command]
async fn agent_respond(
    app_handle: tauri::AppHandle,
    request_id: serde_json::Value,
    decision: serde_json::Value,
) -> Result<(), String> {
    let state = app_handle.state::<AgentState>();
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("no agent session is running")?;
    session.respond(request_id, decision)
}

/// Stop the running turn, keeping the session and its thread.
#[tauri::command]
async fn agent_interrupt(
    state: State<'_, AgentState>,
) -> Result<(), String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("no agent session is running")?;
    let thread_id = session
        .thread_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_default();
    let turn_id = session
        .turn_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .filter(|id| !id.is_empty())
        // The schema requires a turn id, so sending only the thread id would be
        // rejected. Saying so beats sending a request the runtime discards.
        .ok_or("no turn is running to interrupt")?;
    session.request(
        "turn/interrupt",
        serde_json::json!({ "threadId": thread_id, "turnId": turn_id }),
        std::time::Duration::from_secs(10),
    )?;
    Ok(())
}

/// A local-model tool adapter, if one is running.
///
/// It speaks the Responses API to the runtime and Ollama's native `/api/chat` to
/// the model. That indirection is the whole point: the runtime requires
/// `wire_api = "responses"`, and Ollama's implementation of that accepts `tools`
/// and ignores them — which is why a local model used to read and reply and
/// never act.
#[derive(Default)]
pub struct LocalAdapterState {
    server: std::sync::Mutex<Option<LocalAdapter>>,
}

struct LocalAdapter {
    child: std::process::Child,
    port: u16,
    provider_id: String,
}

/// A port nothing is listening on, offered by the OS and released for the child.
fn free_local_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
}

/// Start (or reuse) the adapter for one provider and return its Responses base URL.
#[tauri::command]
async fn local_adapter_start(
    app_handle: tauri::AppHandle,
    state: State<'_, LocalAdapterState>,
    provider_id: String,
) -> Result<String, String> {
    {
        let guard = state.server.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.as_ref() {
            if existing.provider_id == provider_id {
                return Ok(format!("http://127.0.0.1:{}/v1", existing.port));
            }
        }
    }
    {
        let mut guard = state.server.lock().map_err(|e| e.to_string())?;
        if let Some(mut previous) = guard.take() {
            let _ = previous.child.kill();
            let _ = previous.child.wait();
        }
    }

    let port = free_local_port().ok_or("could not find a free local port")?;
    let resource_dir = app_handle.path().resource_dir().ok();
    let (program, mut args) = engine_invocation(resource_dir.as_deref(), "adapter");
    args.push("--port".to_string());
    args.push(port.to_string());

    let mut child = Command::new(&program)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        // Discarded rather than piped: nothing drains a piped stderr, and a full
        // pipe buffer would block the adapter mid-turn.
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            format!(
                "could not start the local tool adapter ({}): {}",
                program.display(),
                e
            )
        })?;

    // Wait until it accepts connections. Without this the first turn races the
    // listener and dies with a connection error that reads like a provider fault.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "the local tool adapter exited before it was ready ({})",
                status
            ));
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err("the local tool adapter did not start within 20s".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    }

    let url = format!("http://127.0.0.1:{}/v1", port);
    let mut guard = state.server.lock().map_err(|e| e.to_string())?;
    *guard = Some(LocalAdapter {
        child,
        port,
        provider_id,
    });
    Ok(url)
}

/// Stop the adapter. Safe to call when none is running.
#[tauri::command]
fn local_adapter_stop(state: State<'_, LocalAdapterState>) -> Result<(), String> {
    let mut guard = state.server.lock().map_err(|e| e.to_string())?;
    if let Some(mut adapter) = guard.take() {
        let _ = adapter.child.kill();
        let _ = adapter.child.wait();
    }
    Ok(())
}

/// Relaunch the app, so an installed update takes effect.
///
/// `@tauri-apps/plugin-process` exists for this, and pulling in a whole plugin —
/// plus a capability entry — for one call is not worth it, so it is a command.
#[tauri::command]
fn app_restart(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

/// End the session entirely.
#[tauri::command]
fn agent_stop(state: State<'_, AgentState>) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

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
    // Continue an existing thread instead of starting a new one. The id comes
    // from the previous run's `thread.started` event; an unknown or stale id
    // fails before any work happens, which is what makes the retry safe.
    resume_thread_id: Option<String>,
    // Attachments as `data:` URLs, straight from the composer. They are written
    // into the runtime's own home and handed over as files, which is what the
    // runtime takes (`-i`).
    images: Vec<String>,
    // Set for a local runtime (Ollama, LM Studio). Codex then talks to it over
    // its own adapter instead of a custom OpenAI-compatible provider — which
    // matters because Ollama does not implement the Responses API, so a
    // `wire_api = "responses"` provider entry simply cannot reach it.
    local_provider: Option<String>,
) -> Result<(), String> {
    let (program, codex_home) = prepare_agent_home(
        &app_handle,
        &config_toml,
        &provider_id,
        &catalog_json,
    )?;

    if let Some(mut previous) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = previous.kill();
    }

    let working_dir = if Path::new(&project_root).is_dir() {
        project_root.clone()
    } else {
        ".".to_string()
    };

    let mut command = Command::new(&program);
    command.arg("exec");
    // A follow-up continues the same thread, so the agent still has everything it
    // read and did. Without this each turn is a fresh process that only knows
    // what we paste back into the prompt.
    let resuming = resume_thread_id.as_deref().map(str::trim).unwrap_or("");
    if !resuming.is_empty() {
        command.arg("resume");
    }
    command
        .arg("--json")
        // The project may not be a git repo; Codex refuses to start otherwise.
        .arg("--skip-git-repo-check");
    if !resuming.is_empty() {
        // `resume` rejects `--oss` / `--local-provider` ("unexpected argument"),
        // because a resumed thread keeps the model it was created with. The
        // provider still has to be named or it falls back to OpenAI — verified:
        // without this the resumed thread went to api.openai.com and 401'd. A
        // config override is accepted here, and for the cloud providers the same
        // name is already the `[model_providers.*]` table we write.
        command
            .arg("-c")
            .arg(format!("model_provider=\"{}\"", provider_id.trim()));
    } else if let Some(local) = local_provider.as_deref().filter(|p| !p.trim().is_empty()) {
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
    // Attachments are files to this runtime, so they go in before the prompt.
    //
    // `--image=<path>`, not `-i <path>`: the flag is variadic, so a separate
    // argument form swallows the positional prompt — verified, the run then
    // reported "Reading prompt from stdin... No prompt provided via stdin".
    let attachment_dir = codex_home.join("attachments");
    for (index, image) in images.iter().enumerate() {
        if let Some(path) = write_attachment(&codex_home, image, index) {
            command.arg(format!("--image={}", path.to_string_lossy()));
        }
    }
    prune_attachments(&attachment_dir, 20);
    // `resume [OPTIONS] [SESSION_ID] [PROMPT]`
    if !resuming.is_empty() {
        command.arg(resuming);
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
    let mut known_secrets: Vec<String> = Vec::new();
    if !provider_id.trim().is_empty() {
        if let Some(key) = engine_resolve_key(&app_handle, provider_id.trim()) {
            if key.len() >= MIN_SECRET_LEN {
                known_secrets.push(key.clone());
            }
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
        let _ = stderr_handle.emit(
            "codex:exit",
            redact_for_display(stderr_text.trim(), &known_secrets),
        );
    });

    Ok(())
}

// ── Application Entry Point ─────────────────────────────────────────────────

/// This build's version, taken from `.tauri/Cargo.toml` — the same value the
/// updater compares against, so a crash report and a release are talking about
/// the same number.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
        })
        .manage(TerminalState::new())
        .manage(ChatState::new())
        .manage(OllamaState::new())
        .manage(AgentState::default())
        .manage(LocalAdapterState::default())
        // Updates: the app checks a manifest, verifies the artifact against the
        // public key in tauri.conf.json, and installs it on restart. Nothing here
        // talks to a server the user did not ask for — the check is on by default
        // because a security fix nobody receives is worse than a version ping, but
        // it is a visible setting, and the install always waits for a click.
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            pick_save_file,
            pick_open_file,
            reveal_path,
            engine_call,
            terminal_spawn,
            terminal_input,
            terminal_resize,
            chat_stream,
            chat_cancel,
            ollama_pull,
            ollama_cancel,
            codex_exec,
            agent_start,
            agent_turn,
            agent_respond,
            agent_interrupt,
            agent_stop,
            local_adapter_start,
            local_adapter_stop,
            app_restart,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            // The engine stamps this into every crash-log entry and support
            // bundle, and nothing ever set it — so every report read
            // `"version": ""`, which is the one field that says whether the bug
            // was fixed three releases ago. Set once here and every child the
            // app spawns inherits it.
            std::env::set_var("ACSA_APP_VERSION", APP_VERSION);
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
    fn base64_round_trips_through_the_decoder() {
        // Every length mod 3, so each padding case is exercised, including the
        // awkward ones a hand-rolled decoder gets wrong.
        for len in 0..40usize {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let decoded = base64_decode(&base64_encode(&bytes)).expect("must decode");
            assert_eq!(decoded, bytes, "round trip failed at length {}", len);
        }
        // Known vectors, including the ones with padding.
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("/wD+").unwrap(), &[0xff, 0x00, 0xfe]);
    }

    #[test]
    fn base64_decoder_rejects_junk_and_ignores_whitespace() {
        assert!(base64_decode("not*base64").is_err());
        // A data URL payload wraps at 76 columns in some encoders.
        assert_eq!(base64_decode("Zm9v\nYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn attachments_are_written_where_the_runtime_can_read_them() {
        let home = std::env::temp_dir().join("acsa-attach-test");
        let _ = std::fs::remove_dir_all(&home);
        // One pixel PNG, enough to prove the pipeline decodes real image bytes.
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let path = write_attachment(&home, data_url, 0).expect("must write");
        assert!(path.starts_with(home.join("attachments")));
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG on disk");
        // A non-image or a non-data URL is skipped rather than written blindly.
        assert!(write_attachment(&home, "https://example.com/x.png", 1).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A stand-in for `codex app-server`: JSON-RPC on stdin/stdout, the same
    /// framing the real one uses. Tests the session layer's own behaviour —
    /// id correlation, notification forwarding, approval requests, and the
    /// superseded-session guard — without a network or a model.
    ///
    /// It is executable and shebang-led on purpose: `spawn` takes a program, not
    /// a command line, so the only way to drive it through the real code path is
    /// to run it as a program. A script that is simply written (not chmod'd) made
    /// an earlier version of this test pass while exercising nothing.
    fn fake_app_server() -> PathBuf {
        // One file per call: cargo runs these tests in parallel threads of one
        // process, so a shared name means one test's cleanup deletes another
        // test's runtime mid-run.
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("acsa-fake-appserver-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("fake_app_server_{}.py", n));
        // A permissions probe and a denial are both legal: this is a fake, not a
        // model, so it answers deterministically.
        std::fs::write(
            &path,
            r#"#!/usr/bin/env python3
import json, sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def note(method, params):
    send({"method": method, "params": params})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")
    rid = msg.get("id")
    # A reply (no method) is the client answering us. Report the approval answer
    # so a test can prove the decision made it across the pipe intact.
    if method is None:
        if rid == 900:
            note("acsa/test/approvalAnswer", {"result": msg.get("result")})
        continue
    if method == "initialize":
        send({"id": rid, "result": {"userAgent": "fake", "codexHome": "/tmp"}})
    elif method == "thread/start":
        thread = {"id": "fake-thread-1"}
        send({"id": rid, "result": {"thread": thread}})
        note("thread/started", {"thread": thread})
    elif method == "turn/start":
        turn = {"id": "fake-turn-1"}
        send({"id": rid, "result": {"turn": turn}})
        note("turn/started", {"threadId": "fake-thread-1", "turn": turn})
        # A request the client must answer before the turn can continue.
        # The method name is the one the real runtime uses (the schema lists
        # `execCommandApproval` only as a legacy spelling).
        send({"id": 900, "method": "item/commandExecution/requestApproval",
              "params": {"itemId": "c1", "command": "echo hi", "cwd": "/tmp",
                         "threadId": "fake-thread-1", "turnId": "fake-turn-1",
                         "startedAtMs": 0}})
        note("item/completed", {"item": {"type": "agentMessage", "text": "done", "id": "m1"}})
        note("turn/completed", {"threadId": "fake-thread-1", "turn": turn})
    elif method == "turn/interrupt":
        send({"id": rid, "result": {}})
"#,
        )
        .expect("write fake server");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path)
                .expect("stat the fake server")
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).expect("make the fake server runnable");
        }
        path
    }

    #[test]
    fn agent_session_correlates_replies_and_forwards_the_rest() {
        let script = fake_app_server();
        let events: std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let emitter: AgentEmitter = std::sync::Arc::new(move |name: &str, line: String| {
            sink.lock().unwrap().push((name.to_string(), line));
        });

        let mut session = AgentSession::spawn(&script, &std::env::temp_dir(), ".", &[], emitter)
            .expect("spawn the fake runtime");

        // A request gets *its own* reply, matched by id. Two in a row proves the
        // ids advance and that a reply is not handed to the wrong caller — the
        // failure mode that made every request look like a timeout.
        let hello = session
            .request("initialize", serde_json::json!({}), std::time::Duration::from_secs(5))
            .expect("initialize answers");
        assert_eq!(hello["result"]["userAgent"], "fake");
        let thread = session
            .request("thread/start", serde_json::json!({}), std::time::Duration::from_secs(5))
            .expect("thread/start answers");
        assert_eq!(thread["result"]["thread"]["id"], "fake-thread-1");

        // `turn/start` makes the server emit a *request* (the approval) and two
        // notifications. The request must reach the UI rather than be mistaken
        // for a reply; the notifications must be forwarded; and the turn id must
        // be remembered so an interrupt can name it.
        session
            .request("turn/start", serde_json::json!({}), std::time::Duration::from_secs(5))
            .expect("turn/start answers");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let saw = |needle: &str| {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|(name, line)| name == "agent:event" && line.contains(needle))
        };
        while !saw("turn/completed") && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(
            saw("item/commandExecution/requestApproval"),
            "the approval request must reach the UI, not be swallowed as a reply"
        );
        assert!(saw("turn/started"), "the turn-start notification is forwarded");
        assert!(saw("turn/completed"), "the turn-complete notification is forwarded");
        assert_eq!(
            session.turn_id.lock().unwrap().clone().as_deref(),
            Some("fake-turn-1"),
            "the live turn id is remembered, so turn/interrupt can name it"
        );

        // The answer travels back over the same pipe. This is the direction that
        // was wrong once — the runtime expects a decision *string*, and an
        // unrecognised value fails its deserialization, hanging the turn.
        session
            .respond(serde_json::json!(900), serde_json::json!({"decision": "accept"}))
            .expect("the answer is written");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !saw("acsa/test/approvalAnswer") && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let answered = events
            .lock()
            .unwrap()
            .iter()
            .find(|(_, line)| line.contains("acsa/test/approvalAnswer"))
            .map(|(_, line)| line.clone())
            .expect("the fake runtime reports the answer it received");
        assert!(
            answered.contains("accept"),
            "the decision reaches the runtime intact: {answered}"
        );

        let _ = session.child.kill();
        let _ = std::fs::remove_file(&script);
    }

    /// The integration test that needs real infrastructure.
    ///
    /// Ignored by default because it needs two things the suite cannot assume: a
    /// reachable model provider (a local Ollama serving `qwen2.5-coder:1.5b`),
    /// and a sandbox that permits localhost. Run it deliberately:
    ///
    /// ```text
    /// cargo test --manifest-path .tauri/Cargo.toml \
    ///   a_turn_completes_over_the_real_runtime -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs a reachable model provider and localhost access"]
    fn a_turn_completes_over_the_real_runtime() {
        // Opt-in by construction: without the fetched runtime there is nothing to
        // test, and the suite should say so rather than fail.
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let program = repo.join(".tauri").join("engine-codex").join("codex");
        if !program.exists() {
            eprintln!("skipping: {} not fetched", program.display());
            return;
        }
        let home = std::env::temp_dir().join("acsa-agent-session-home");
        let _ = std::fs::create_dir_all(&home);
        std::fs::write(
            home.join("config.toml"),
            "approval_policy = \"on-request\"\napprovals_reviewer = \"auto_review\"\nsandbox_mode = \"workspace-write\"\n",
        )
        .unwrap();

        let seen: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = seen.clone();
        let emitter: AgentEmitter = std::sync::Arc::new(move |name: &str, line: String| {
            sink.lock().unwrap().push(format!("{} {}", name, line));
        });

        let env: Vec<(String, String)> = match std::env::var("ACSA_CODEX_API_KEY") {
            Ok(key) => vec![("ACSA_CODEX_API_KEY".to_string(), key)],
            Err(_) => Vec::new(),
        };
        let mut session =
            AgentSession::spawn(&program, &home, ".", &env, emitter).expect("spawn runtime");
        session
            .request(
                "initialize",
                serde_json::json!({"clientInfo": {"name": "acsa-test", "version": "0"}}),
                std::time::Duration::from_secs(30),
            )
            .expect("initialize");

        let started = session.request(
            "thread/start",
            serde_json::json!({
                "model": "qwen2.5-coder:1.5b",
                "modelProvider": "ollama",
                "cwd": ".",
                "approvalPolicy": "on-request",
                "approvalsReviewer": "auto_review",
                "sandbox": "workspace-write",
            }),
            std::time::Duration::from_secs(60),
        );
        let started = match started {
            Ok(reply) => reply,
            Err(error) => {
                // No local model running is not a defect in this layer.
                eprintln!("skipping: no local provider ({})", error);
                return;
            }
        };
        let thread_id = started["result"]["thread"]["id"].as_str().unwrap().to_string();

        session
            .request(
                "turn/start",
                serde_json::json!({
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": "Reply with just: ready"}],
                }),
                std::time::Duration::from_secs(30),
            )
            .expect("turn/start");

        // The whole point: a turn must finish. This is the failure that took a
        // rebuild-and-click cycle to see, and it is invisible to the compiler.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        loop {
            {
                let log = seen.lock().unwrap();
                if log.iter().any(|entry| entry.contains("turn/completed")) {
                    break;
                }
                if log.iter().any(|entry| entry.contains("turn/failed")) {
                    panic!("the runtime reported the turn failed: {:?}", *log);
                }
                // Transport trouble the runtime is retrying — an unreachable
                // provider, or a sandbox that forbids localhost. Neither is a
                // defect in this layer, and paying three minutes to discover it
                // is not useful. Say so and stop.
                if log.iter().any(|entry| entry.contains("\"willRetry\":true")) {
                    eprintln!(
                        "skipping: the model provider is unreachable (is Ollama running, and does this sandbox allow localhost?)"
                    );
                    let _ = session.child.kill();
                    return;
                }
            }
            if std::time::Instant::now() > deadline {
                let log = seen.lock().unwrap().clone();
                panic!("no turn/completed within 180s; events seen: {:#?}", log);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let _ = session.child.kill();
    }

    /// A replaced session must not announce its own death into the next run.
    ///
    /// This is the ordering bug behind "turn finished in 0s" — an empty answer on
    /// the *second* message of a session and never the first. The outgoing
    /// process was killed before the current-session counter moved, so its dying
    /// stdout EOF was read as the new run's exit and the run ended the moment it
    /// began. The fix is to supersede before killing; this holds it in place.
    #[test]
    fn a_superseded_session_exits_quietly_and_the_current_one_does_not() {
        let script = fake_app_server();
        let events: std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let emitter: AgentEmitter = std::sync::Arc::new(move |name: &str, line: String| {
            sink.lock().unwrap().push((name.to_string(), line));
        });
        let exits = || {
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|(name, _)| name == "agent:exit")
                .count()
        };

        let mut superseded = AgentSession::spawn(
            &script,
            &std::env::temp_dir(),
            ".",
            &[],
            emitter.clone(),
        )
        .expect("spawn the outgoing session");
        // The order the fix enforces: mark it superseded first, *then* kill it.
        SESSION_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _ = superseded.child.kill();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(
            exits(),
            0,
            "a superseded session must stay quiet, or the next run ends instantly"
        );

        // The current session is the opposite case: its exit *is* the run's exit.
        let mut current =
            AgentSession::spawn(&script, &std::env::temp_dir(), ".", &[], emitter).expect("spawn");
        let _ = current.child.kill();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while exits() == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(exits() >= 1, "the current session's exit must be emitted");

        let _ = std::fs::remove_file(&script);
    }

    /// The approval round-trip against the real runtime.
    ///
    /// This is the one thing the scripted test cannot prove: that the runtime
    /// *accepts* the decision we send and carries on. `approvals_reviewer =
    /// "user"` makes it ask before it runs anything, so a prompt that asks for a
    /// command produces a real `item/commandExecution/requestApproval`. Ignored
    /// for the same reason as the test above; run it with `--ignored`.
    #[test]
    #[ignore = "needs a reachable model provider and localhost access"]
    fn a_real_approval_is_answered_and_the_turn_continues() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let program = repo.join(".tauri").join("engine-codex").join("codex");
        if !program.exists() {
            eprintln!("skipping: {} not fetched", program.display());
            return;
        }
        let home = std::env::temp_dir().join("acsa-agent-approval-home");
        let _ = std::fs::create_dir_all(&home);
        std::fs::write(
            home.join("config.toml"),
            "approval_policy = \"on-request\"\napprovals_reviewer = \"user\"\nsandbox_mode = \"workspace-write\"\n",
        )
        .unwrap();

        let seen: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = seen.clone();
        let emitter: AgentEmitter = std::sync::Arc::new(move |name: &str, line: String| {
            sink.lock().unwrap().push(format!("{} {}", name, line));
        });
        let env: Vec<(String, String)> = match std::env::var("ACSA_CODEX_API_KEY") {
            Ok(key) => vec![("ACSA_CODEX_API_KEY".to_string(), key)],
            Err(_) => Vec::new(),
        };
        let mut session =
            AgentSession::spawn(&program, &home, ".", &env, emitter).expect("spawn runtime");
        session
            .request(
                "initialize",
                serde_json::json!({"clientInfo": {"name": "acsa-test", "version": "0"}}),
                std::time::Duration::from_secs(30),
            )
            .expect("initialize");

        let started = session.request(
            "thread/start",
            serde_json::json!({
                "model": "qwen2.5-coder:1.5b",
                "modelProvider": "ollama",
                "cwd": ".",
                "approvalPolicy": "on-request",
                "approvalsReviewer": "user",
                "sandbox": "workspace-write",
            }),
            std::time::Duration::from_secs(60),
        );
        let started = match started {
            Ok(reply) => reply,
            Err(error) => {
                eprintln!("skipping: no local provider ({})", error);
                return;
            }
        };
        let thread_id = started["result"]["thread"]["id"].as_str().unwrap().to_string();
        session
            .request(
                "turn/start",
                serde_json::json!({
                    "threadId": thread_id,
                    "input": [{"type": "text", "text":
                        "Use the terminal to run exactly this command: echo acsa-approved"}],
                }),
                std::time::Duration::from_secs(30),
            )
            .expect("turn/start");

        // Walk the stream: answer the first approval with `accept`, then require
        // the turn to reach `turn/completed` — i.e. the runtime accepted the
        // answer and continued rather than stalling on a malformed decision.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(150);
        let mut answered = false;
        while std::time::Instant::now() < deadline {
            // Once answered, stop scanning: the request stays in the log, and
            // answering it twice would be a bug the test caused itself.
            let pending: Option<(serde_json::Value, String)> = if answered {
                None
            } else {
                let log = seen.lock().unwrap();
                if log.iter().any(|e| e.contains("\"willRetry\":true")) {
                    eprintln!("skipping: the model provider is unreachable");
                    let _ = session.child.kill();
                    return;
                }
                if log.iter().any(|e| e.contains("turn/completed")) {
                    // The model chose not to call a tool, so there was nothing to
                    // approve. That is the model, not the transport — say so and
                    // stop rather than pass, which would prove nothing.
                    if !answered {
                        eprintln!(
                            "skipping: the model answered without asking for approval, so the round-trip was not exercised"
                        );
                    }
                    let _ = session.child.kill();
                    return;
                }
                log.iter()
                    .filter(|e| e.contains("requestApproval"))
                    .find_map(|e| {
                        let json = e.split_once('{').map(|(_, rest)| format!("{{{rest}"))?;
                        let value: serde_json::Value = serde_json::from_str(&json).ok()?;
                        Some((value.get("id")?.clone(), e.clone()))
                    })
            };
            if let Some((id, raw)) = pending {
                eprintln!("answering approval: {}", &raw[..raw.len().min(200)]);
                session
                    .respond(id, serde_json::json!({"decision": "accept"}))
                    .expect("the approval answer is written");
                answered = true;
                // Let the runtime act on it and finish.
                std::thread::sleep(std::time::Duration::from_secs(20));
                continue;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let log = seen.lock().unwrap().clone();
        panic!(
            "no turn/completed within 150s (answered={}); events: {:#?}",
            answered, log
        );
    }

    /// The OUTPUT panel is carried verbatim from the runtime, so it is also the
    /// most likely place for a live credential to end up on screen.
    #[test]
    fn credentials_are_masked_before_they_reach_the_panel() {
        let none: Vec<String> = Vec::new();
        let cases = [
            ("Authorization: Bearer sk-live-abcdef123456", "sk-live-abcdef123456"),
            ("api_key=sk-abcdef123456", "sk-abcdef123456"),
            (r#"{"apiKey":"sk-abcdef123456"}"#, "sk-abcdef123456"),
            ("ACSA_CODEX_API_KEY=abcdef123456", "abcdef123456"),
            ("client_secret: abcdef123456", "abcdef123456"),
            ("password=hunter2hunter2", "hunter2hunter2"),
        ];
        for (line, secret) in cases {
            let masked = redact_for_display(line, &none);
            assert!(!masked.contains(secret), "not masked: {masked}");
            assert!(masked.contains(MASK), "nothing masked: {masked}");
        }
    }

    #[test]
    fn a_credential_we_handed_over_is_masked_wherever_it_appears() {
        // Whatever it looks like — a key with no recognisable prefix still goes.
        let known = vec!["zz9-plainvalue-noprefix".to_string()];
        let masked = redact_for_display("failed to authenticate with zz9-plainvalue-noprefix (401)", &known);
        assert!(!masked.contains("zz9-plainvalue-noprefix"), "{masked}");
        assert!(masked.contains("(401)"), "the diagnosis survived: {masked}");
    }

    #[test]
    fn ordinary_log_lines_are_left_alone() {
        // Masking is display-only, so a false positive costs real information:
        // a turn id, a token count and a commit sha all stay readable.
        let none: Vec<String> = Vec::new();
        for line in [
            r#"{"type":"turn.completed","usage":{"input_tokens":2050,"output_tokens":2}}"#,
            r#"{"sha":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"}"#,
            "no secrets are logged here",
            "reading token counts from turn.completed",
            "héllo wörld — ünchanged",
        ] {
            assert_eq!(redact_for_display(line, &none), line, "changed: {line}");
        }
    }

    #[test]
    fn redaction_survives_non_ascii_around_the_secret() {
        let none: Vec<String> = Vec::new();
        let masked = redact_for_display("clé — secret: abcdef123456 — fin", &none);
        assert!(masked.contains("clé"), "text before kept: {masked}");
        assert!(masked.contains("fin"), "text after kept: {masked}");
        assert!(!masked.contains("abcdef123456"), "value masked: {masked}");
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

    /// The IPC allowlist is the boundary between "the page can ask the engine
    /// something" and "the page can run anything". It is worth a test because
    /// the failure mode is silent in both directions: an entry that is missing
    /// breaks a feature, and one that should not be there hands a compromised
    /// webview a process spawn.
    #[test]
    fn only_the_intended_engine_subcommands_are_reachable_from_the_page() {
        // Used by the UI, and reached through `engine_call` with page-supplied
        // arguments — including the two added for Data & backups.
        for allowed in [
            "db", "ollama", "index", "git", "indexer", "skills", "mcp", "ai", "project", "fs",
            "backup", "support",
        ] {
            assert!(engine_subcommand_allowed(allowed), "{allowed} must be reachable");
        }

        for blocked in ["pty", "adapter", "selftest", "", "rm -rf"] {
            assert!(
                !engine_subcommand_allowed(blocked),
                "{blocked} must not be reachable from the page"
            );
        }
    }

    /// The New Project dialog hands us `~/AcsaProjects` by default. Rust does not
    /// expand `~`, so until this existed the default destination was a *relative*
    /// path and every scaffold from the default location failed — silently, since
    /// the modal closes before the write is attempted.
    #[test]
    fn a_leading_tilde_expands_to_the_home_directory() {
        let home = user_home().expect("the test environment has a home directory");

        assert_eq!(expand_home("~/AcsaProjects"), home.join("AcsaProjects"));
        assert_eq!(expand_home("~"), home);
        assert_eq!(expand_home("  ~/Desktop  "), home.join("Desktop"));

        // Not a home shorthand: left exactly as given.
        assert_eq!(expand_home("/tmp/absolute"), PathBuf::from("/tmp/absolute"));
        assert_eq!(expand_home("relative/dir"), PathBuf::from("relative/dir"));
        assert_eq!(expand_home("~someone-else"), PathBuf::from("~someone-else"));
        assert_eq!(expand_home("~/"), home);
    }
}
