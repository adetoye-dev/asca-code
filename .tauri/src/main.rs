//! main.rs — Tauri Native Desktop Entry Point
//!
//! Launches the Autonomous IDE desktop application, exposing two Tauri commands
//! to the frontend:
//!
//! 1. `run_generation_pipeline` — Spawns the Python orchestrator (manager.py) as
//!    an async child process, streaming stdout line-by-line to the frontend via
//!    Tauri events.
//!
//! 2. `fetch_system_metrics` — Samples host CPU/memory usage via the `sysinfo`
//!    crate to guard against thermal throttling during sandbox stress tests.

// Prevent the console window from appearing on Windows release builds
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use sysinfo::System;
use tauri::{Manager, State};

// ── Data Structures ─────────────────────────────────────────────────────────

/// Slider configuration received from the frontend TradeOffSliders component.
/// Maps directly to the Python orchestrator's CLI flags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SliderConfig {
    /// "low" | "medium" | "high" — maps to --scale
    pub budget_vs_scale: String,
    /// "low" | "medium" | "high" — maps to --speed
    pub speed_vs_precision: String,
    /// "low" | "medium" | "high" — maps to --modularity
    pub simplicity_vs_futureproof: String,
}

impl SliderConfig {
    fn validate(&self) -> Result<(), String> {
        let valid = ["low", "medium", "high"];
        for (name, val) in [
            ("budget_vs_scale", &self.budget_vs_scale),
            ("speed_vs_precision", &self.speed_vs_precision),
            ("simplicity_vs_futureproof", &self.simplicity_vs_futureproof),
        ] {
            if !valid.contains(&val.as_str()) {
                return Err(format!(
                    "Invalid value for {}: '{}'. Must be low, medium, or high.",
                    name, val
                ));
            }
        }
        Ok(())
    }
}

/// Single line of output from the orchestrator, streamed to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineOutputLine {
    pub line_number: usize,
    pub content: String,
    pub stream: String, // "stdout" or "stderr"
    pub is_json: bool,
}

/// Final result summary after the pipeline completes.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineResult {
    pub success: bool,
    pub exit_code: i32,
    pub total_lines: usize,
    pub json_result: Option<serde_json::Value>,
    pub error_message: String,
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
    pub is_thermal_risk: bool,
    pub thermal_warning: String,
    pub timestamp_ms: u64,
}

/// Managed state: wraps sysinfo::System behind a Mutex for thread safety.
pub struct AppState {
    sys: Mutex<System>,
}

// ── Helper: Resolve the core-engine path ────────────────────────────────────

fn resolve_engine_dir() -> PathBuf {
    // In development, the engine lives relative to the Tauri project root.
    // In production, it would be bundled as a resource.
    let candidates = vec![
        // From .tauri/src/ → ../../core-engine
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("core-engine"),
        // From project root
        PathBuf::from("core-engine"),
        // Absolute fallback for bundled apps
        std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("core-engine"),
    ];

    for candidate in &candidates {
        let manager = candidate.join("manager.py");
        if manager.exists() {
            return candidate.canonicalize().unwrap_or(candidate.clone());
        }
    }

    // Return the first candidate as default (will produce a clear error downstream)
    candidates[0].clone()
}

// ── Tauri Command: run_generation_pipeline ──────────────────────────────────

/// Spawns the Python orchestrator as an async child process. Streams each line
/// of stdout/stderr back to the frontend via the `pipeline:output` Tauri event.
/// Returns a PipelineResult when the process completes.
#[tauri::command]
async fn run_generation_pipeline(
    app_handle: tauri::AppHandle,
    prompt: String,
    sliders: SliderConfig,
    project_root: String,
    language: Option<String>,
    skip_performance: Option<bool>,
    dry_run: Option<bool>,
) -> Result<PipelineResult, String> {
    // Validate inputs
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".to_string());
    }
    sliders.validate()?;

    let engine_dir = resolve_engine_dir();
    let manager_path = engine_dir.join("manager.py");

    if !manager_path.exists() {
        return Err(format!(
            "Orchestrator not found at: {}. Ensure core-engine is properly installed.",
            manager_path.display()
        ));
    }

    // Build the command
    let mut cmd = Command::new("python3");
    cmd.arg(&manager_path)
        .arg(&prompt)
        .arg("--project-root")
        .arg(&project_root)
        .arg("--scale")
        .arg(&sliders.budget_vs_scale)
        .arg("--speed")
        .arg(&sliders.speed_vs_precision)
        .arg("--modularity")
        .arg(&sliders.simplicity_vs_futureproof)
        .arg("--json");

    if let Some(lang) = &language {
        cmd.arg("--language").arg(lang);
    }

    if skip_performance.unwrap_or(false) {
        cmd.arg("--skip-performance");
    }

    if dry_run.unwrap_or(false) {
        cmd.arg("--dry-run");
    }

    // Configure stdio for streaming
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory to project root
    let project_path = PathBuf::from(&project_root);
    if project_path.exists() {
        cmd.current_dir(&project_path);
    }

    // Spawn the child process
    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn orchestrator process: {}. Is Python 3 installed?",
            e
        )
    })?;

    // ── Stream stdout ──
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stdout_handle = app_handle.clone();
    let stderr_handle = app_handle.clone();

    let mut all_lines: Vec<String> = Vec::new();
    let mut json_result: Option<serde_json::Value> = None;
    let mut line_count: usize = 0;

    // Read stdout line by line
    let stdout_reader = BufReader::new(stdout);
    for line in stdout_reader.lines() {
        match line {
            Ok(content) => {
                line_count += 1;
                let is_json =
                    content.trim_start().starts_with('{') || content.trim_start().starts_with('[');

                let output = PipelineOutputLine {
                    line_number: line_count,
                    content: content.clone(),
                    stream: "stdout".to_string(),
                    is_json,
                };

                // Emit to frontend
                let _ = stdout_handle.emit("pipeline:output", &output);

                // Try to parse the last JSON line as the final result
                if is_json {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                        json_result = Some(parsed);
                    }
                }

                all_lines.push(content);
            }
            Err(e) => {
                let output = PipelineOutputLine {
                    line_number: line_count + 1,
                    content: format!("[read error: {}]", e),
                    stream: "stderr".to_string(),
                    is_json: false,
                };
                let _ = stdout_handle.emit("pipeline:output", &output);
            }
        }
    }

    // Read stderr
    let stderr_reader = BufReader::new(stderr);
    for line in stderr_reader.lines() {
        if let Ok(content) = line {
            line_count += 1;
            let output = PipelineOutputLine {
                line_number: line_count,
                content: content.clone(),
                stream: "stderr".to_string(),
                is_json: false,
            };
            let _ = stderr_handle.emit("pipeline:output", &output);
            all_lines.push(content);
        }
    }

    // Wait for process to finish
    let status = child
        .wait()
        .map_err(|e| format!("Process wait failed: {}", e))?;
    let exit_code = status.code().unwrap_or(-1);

    let success = exit_code == 0;
    let error_message = if success {
        String::new()
    } else {
        format!("Pipeline exited with code {}", exit_code)
    };

    let result = PipelineResult {
        success,
        exit_code,
        total_lines: line_count,
        json_result,
        error_message,
    };

    // Emit completion event
    let _ = app_handle.emit("pipeline:complete", &result);

    Ok(result)
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

    Ok(SystemMetrics {
        cpu_usage_percent: (cpu_usage * 10.0).round() / 10.0,
        cpu_count_physical: physical_cores,
        cpu_count_logical,
        memory_total_mb: (mem_total * 10.0).round() / 10.0,
        memory_used_mb: (mem_used * 10.0).round() / 10.0,
        memory_usage_percent: (mem_percent * 10.0).round() / 10.0,
        is_thermal_risk,
        thermal_warning,
        timestamp_ms: timestamp,
    })
}

// ── Application Entry Point ─────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
        })
        .invoke_handler(tauri::generate_handler![
            run_generation_pipeline,
            fetch_system_metrics,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            println!(
                "[IDE] Autonomous IDE started. Engine dir: {:?}",
                resolve_engine_dir()
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to launch Autonomous IDE");
}
