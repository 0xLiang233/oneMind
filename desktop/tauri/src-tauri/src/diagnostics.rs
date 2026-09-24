//! Bounded, rotating, off-thread diagnostic logging. Never wait for disk from UI callbacks.
use crate::{now_iso_like, DebugModeReport, ShellReport};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, SyncSender},
        OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const LOG_BACKUPS: usize = 3;
const MAX_FIELD_BYTES: usize = 8192;
static WRITER: OnceLock<SyncSender<LogMessage>> = OnceLock::new();
static APP_LOG_FILE: OnceLock<PathBuf> = OnceLock::new();
static DROPPED: AtomicUsize = AtomicUsize::new(0);
enum LogMessage {
    Line(PathBuf, String),
    Flush(SyncSender<()>),
}

fn writer() -> &'static SyncSender<LogMessage> {
    WRITER.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel(512);
        let started = std::thread::Builder::new().name("onemind-log".into()).spawn(move || {
            while let Ok(message) = receiver.recv() {
                match message {
                    LogMessage::Line(path, line) => {
                        let dropped = DROPPED.swap(0, Ordering::Relaxed);
                        if dropped > 0 {
                            let notice = serde_json::json!({"timestamp": now_iso_like(), "level": "warn",
                                "message": "diagnostic_queue_full", "context": format!("dropped={dropped}")}).to_string();
                            let _ = write_rotating(&path, &notice, MAX_LOG_BYTES);
                        }
                        let _ = write_rotating(&path, &line, MAX_LOG_BYTES);
                    }
                    LogMessage::Flush(reply) => { let _ = reply.try_send(()); }
                }
            }
        });
        if let Err(error) = started {
            // Diagnostics must never turn a resource shortage into an app crash.
            eprintln!("failed to start diagnostics writer: {error}");
        }
        sender
    })
}

fn bounded(value: &str) -> &str {
    let mut end = value.len().min(MAX_FIELD_BYTES);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn append_line(path: &Path, level: &str, message: &str, context: Option<&str>) {
    let line = serde_json::json!({"timestamp": now_iso_like(), "level": bounded(level),
        "message": bounded(message), "context": context.map(bounded)})
    .to_string();
    if writer()
        .try_send(LogMessage::Line(path.to_path_buf(), line))
        .is_err()
    {
        DROPPED.fetch_add(1, Ordering::Relaxed);
    }
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn write_rotating(path: &Path, line: &str, limit: u64) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::metadata(path)
        .map(|m| m.len() + line.len() as u64 + 1 > limit)
        .unwrap_or(false)
    {
        let oldest = backup_path(path, LOG_BACKUPS);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..LOG_BACKUPS).rev() {
            let source = backup_path(path, index);
            if source.exists() {
                fs::rename(source, backup_path(path, index + 1))?;
            }
        }
        fs::rename(path, backup_path(path, 1))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

pub(crate) fn flush() {
    let (reply, received) = mpsc::sync_channel(1);
    if writer().try_send(LogMessage::Flush(reply)).is_ok() {
        let _ = received.recv_timeout(Duration::from_secs(2));
    }
}

fn resolve_fallback_log_file() -> PathBuf {
    env::temp_dir().join("onemind-tauri.log")
}
pub(crate) fn append_global_log(level: &str, message: &str, context: Option<&str>) {
    append_line(&resolve_fallback_log_file(), level, message, context);
    if let Some(path) = APP_LOG_FILE.get() {
        append_line(path, level, message, context);
    }
}
fn is_debug_mode_enabled() -> bool {
    cfg!(debug_assertions)
        || matches!(
            env::var("ONEMIND_TAURI_DEBUG").as_deref(),
            Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
        )
}
fn debug_mode_source() -> String {
    if cfg!(debug_assertions) {
        "debug-build"
    } else if is_debug_mode_enabled() {
        "ONEMIND_TAURI_DEBUG"
    } else {
        "disabled"
    }
    .into()
}
pub(crate) fn append_debug_log(app: &AppHandle, message: &str, context: Option<&str>) {
    if is_debug_mode_enabled() {
        append_app_log(app, "debug", message, context);
    }
}
fn append_app_log(app: &AppHandle, level: &str, message: &str, context: Option<&str>) {
    if let Ok(path) = resolve_log_file(app) {
        let _ = APP_LOG_FILE.set(path);
    }
    append_global_log(level, message, context);
}
pub(crate) fn append_boot_log_line(app: &AppHandle, message: &str) {
    append_app_log(app, "boot", message, None);
}
pub(crate) fn append_boot_log_line_with_context(app: &AppHandle, message: &str, context: &str) {
    append_app_log(app, "boot", message, Some(context));
}
fn resolve_diagnostics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("diagnostics"))
        .map_err(|e| e.to_string())
}
fn resolve_log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_diagnostics_dir(app)?.join("shell-log.jsonl"))
}

#[tauri::command]
pub fn get_shell_report(app: AppHandle) -> Result<ShellReport, String> {
    let log_file = resolve_log_file(&app)?;
    let data_dir = resolve_diagnostics_dir(&app)?;

    Ok(ShellReport {
        app_name: app.package_info().name.clone(),
        app_version: app.package_info().version.to_string(),
        runtime_target: "tauri".to_string(),
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        dev: cfg!(debug_assertions),
        log_file: log_file.display().to_string(),
        data_dir: data_dir.display().to_string(),
        generated_at: now_iso_like(),
    })
}

#[tauri::command]
pub fn write_shell_log(
    app: AppHandle,
    level: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    if level == "renderer-debug" && !is_debug_mode_enabled() {
        return Ok(());
    }
    append_app_log(&app, &level, &message, context.as_deref());
    Ok(())
}

#[tauri::command]
pub fn diagnostics_get_debug_mode() -> DebugModeReport {
    DebugModeReport {
        enabled: is_debug_mode_enabled(),
        source: debug_mode_source(),
    }
}

#[tauri::command]
pub fn diagnostics_open_devtools(app: AppHandle, label: Option<String>) -> Result<bool, String> {
    let window_label = label.unwrap_or_else(|| "float-note".to_string());
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("window not found: {window_label}"))?;
    window.open_devtools();
    append_debug_log(
        &app,
        "diagnostics_open_devtools",
        Some(&format!("label={window_label}")),
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_multibyte_log_fields_are_safely_bounded() {
        let value = "中".repeat(5000);
        let output = bounded(&value);
        assert!(output.len() <= MAX_FIELD_BYTES);
        assert!(output.ends_with('中'));
    }
    #[test]
    fn rotation_bounds_disk_usage_and_preserves_whole_json_lines() {
        let dir = env::temp_dir().join(format!(
            "onemind-logs-test-{}-{}",
            std::process::id(),
            crate::now_id()
        ));
        let path = dir.join("test.jsonl");
        for n in 0..100 {
            write_rotating(&path, &format!("{{\"number\":{n}}}"), 80).unwrap();
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), LOG_BACKUPS + 1);
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            assert!(fs::metadata(&path).unwrap().len() <= 80);
            for line in fs::read_to_string(path).unwrap().lines() {
                serde_json::from_str::<serde_json::Value>(line).unwrap();
            }
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
