use serde::Serialize;
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeReport {
    app_name: String,
    app_version: String,
    tauri_target: String,
    platform: String,
    arch: String,
    dev: bool,
    log_file: String,
    data_dir: String,
    generated_at: String,
}

fn now_iso_like() -> String {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{since_epoch}")
}

fn resolve_fallback_log_file() -> PathBuf {
    env::temp_dir().join("onemind-tauri-probe.log")
}

fn append_global_log(level: &str, message: &str, context: Option<&str>) {
    let fallback = resolve_fallback_log_file();
    append_line(&fallback, level, message, context);
}

fn append_line(file_path: &PathBuf, level: &str, message: &str, context: Option<&str>) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(file_path) {
        let entry = serde_json::json!({
            "timestamp": now_iso_like(),
            "level": level,
            "message": message,
            "context": context,
        });
        let _ = writeln!(file, "{entry}");
        let _ = file.flush();
    }
}

fn append_boot_log_line(app: &AppHandle, message: &str) {
    let fallback = resolve_fallback_log_file();
    append_line(&fallback, "boot", message, None);

    if let Ok(file_path) = resolve_log_file(app) {
        append_line(&file_path, "boot", message, None);
    }
}

fn append_boot_log_line_with_context(app: &AppHandle, message: &str, context: &str) {
    let fallback = resolve_fallback_log_file();
    append_line(&fallback, "boot", message, Some(context));

    if let Ok(file_path) = resolve_log_file(app) {
        append_line(&file_path, "boot", message, Some(context));
    }
}

fn resolve_probe_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let dir = base.join("probe");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create probe dir: {e}"))?;
    Ok(dir)
}

fn resolve_log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_probe_dir(app)?.join("probe-log.jsonl"))
}

#[tauri::command]
fn get_probe_report(app: AppHandle) -> Result<ProbeReport, String> {
    let log_file = resolve_log_file(&app)?;
    let data_dir = resolve_probe_dir(&app)?;

    Ok(ProbeReport {
        app_name: app.package_info().name.clone(),
        app_version: app.package_info().version.to_string(),
        tauri_target: env::consts::FAMILY.to_string(),
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        dev: cfg!(debug_assertions),
        log_file: log_file.display().to_string(),
        data_dir: data_dir.display().to_string(),
        generated_at: now_iso_like(),
    })
}

#[tauri::command]
fn write_probe_log(
    app: AppHandle,
    level: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let fallback = resolve_fallback_log_file();
    append_line(&fallback, &level, &message, context.as_deref());

    let file_path = resolve_log_file(&app)?;
    append_line(&file_path, &level, &message, context.as_deref());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    append_global_log("boot", "run_entered", None);

    let builder = tauri::Builder::default();
    append_global_log("boot", "builder_created", None);

    let builder = builder
        .setup(|app| {
            append_boot_log_line(app.handle(), "tauri_setup_entered");
            if app.get_webview_window("main").is_some() {
                append_boot_log_line(app.handle(), "main_window_exists_from_config");
            } else {
                append_boot_log_line(app.handle(), "main_window_missing_in_setup");
            }
            Ok(())
        })
        .on_page_load(|window, payload| {
            append_boot_log_line_with_context(
                &window.app_handle(),
                "page_load",
                &format!("label={} url={}", window.label(), payload.url()),
            );
        })
        .invoke_handler(tauri::generate_handler![get_probe_report, write_probe_log]);

    append_global_log("boot", "builder_configured", None);

    let app = builder.build(tauri::generate_context!());
    append_global_log(
        "boot",
        "builder_build_returned",
        Some(if app.is_ok() { "ok" } else { "err" }),
    );

    let app = app.expect("error while building tauri application");
    append_global_log("boot", "app_built", None);

    append_global_log("boot", "before_app_run", None);
    app.run(|_app_handle, _event| {});
    append_global_log("boot", "after_app_run", None);
}
