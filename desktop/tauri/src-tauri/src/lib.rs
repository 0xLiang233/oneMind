use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus as SetWin32Focus;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, SetForegroundWindow, ShowWindow, SW_SHOW,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellReport {
    app_name: String,
    app_version: String,
    runtime_target: String,
    platform: String,
    arch: String,
    dev: bool,
    log_file: String,
    data_dir: String,
    generated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugModeReport {
    enabled: bool,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMeta {
    workspace_path: String,
    notes_path: String,
    assets_path: String,
    inbox_path: String,
    sources_path: String,
    app_data_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteTreeNode {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<NoteTreeNode>>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickNote {
    id: String,
    content: String,
    created_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MiniappSource {
    id: String,
    name: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
struct MiniappInput {
    name: String,
    url: String,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct ViewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    theme: String,
    accent: String,
    sidebar_position: String,
    startup_page: String,
    language: String,
    editor_font_size: u16,
    editor_default_mode: String,
    float_note_shortcut: String,
}

#[derive(Default)]
struct ShortcutStateStore {
    float_note_shortcut: Mutex<Option<String>>,
    float_note_is_pressed: Mutex<bool>,
    float_note_last_press: Mutex<Option<Instant>>,
}

fn now_iso_like() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn now_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn default_preferences() -> AppPreferences {
    AppPreferences {
        theme: "system".to_string(),
        accent: "purple".to_string(),
        sidebar_position: "left".to_string(),
        startup_page: "last".to_string(),
        language: "zh-CN".to_string(),
        editor_font_size: 15,
        editor_default_mode: "edit".to_string(),
        float_note_shortcut: "Alt+Space".to_string(),
    }
}

fn default_miniapps() -> Vec<MiniappSource> {
    vec![
        MiniappSource {
            id: "preset-chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com/".to_string(),
            icon: Some("https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64".to_string()),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-claude".to_string(),
            name: "Claude".to_string(),
            url: "https://claude.ai/".to_string(),
            icon: Some("https://www.google.com/s2/favicons?domain=claude.ai&sz=64".to_string()),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-gemini".to_string(),
            name: "Gemini".to_string(),
            url: "https://gemini.google.com/".to_string(),
            icon: Some(
                "https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64".to_string(),
            ),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-perplexity".to_string(),
            name: "Perplexity".to_string(),
            url: "https://www.perplexity.ai/".to_string(),
            icon: Some(
                "https://www.google.com/s2/favicons?domain=www.perplexity.ai&sz=64".to_string(),
            ),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-v0".to_string(),
            name: "v0".to_string(),
            url: "https://v0.dev/".to_string(),
            icon: Some("https://www.google.com/s2/favicons?domain=v0.dev&sz=64".to_string()),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-cursor".to_string(),
            name: "Cursor".to_string(),
            url: "https://cursor.com/".to_string(),
            icon: Some("https://www.google.com/s2/favicons?domain=cursor.com&sz=64".to_string()),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
    ]
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn safe_storage_key(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

fn get_default_workspace_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "failed to resolve home directory".to_string())?;
    Ok(home.join("OneMindWorkspace"))
}

fn ensure_workspace_structure(workspace_path: PathBuf) -> Result<WorkspaceMeta, String> {
    let notes_path = workspace_path.join("notes");
    let assets_path = workspace_path.join("assets");
    let inbox_path = workspace_path.join("inbox");
    let sources_path = workspace_path.join("sources");
    let app_data_path = workspace_path.join(".onemind");

    for dir in [
        &notes_path,
        &assets_path,
        &inbox_path,
        &sources_path,
        &app_data_path.join("logs"),
        &app_data_path.join("cache"),
        &app_data_path.join("snapshots"),
    ] {
        fs::create_dir_all(dir).map_err(|e| format!("failed to create workspace dir: {e}"))?;
    }

    let settings_file = app_data_path.join("settings.json");
    if !settings_file.exists() {
        let settings = serde_json::json!({
            "workspacePath": path_to_string(&workspace_path),
            "createdAt": now_iso_like(),
            "version": 1,
        });
        fs::write(
            &settings_file,
            serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("failed to write workspace settings: {e}"))?;
    }

    Ok(WorkspaceMeta {
        workspace_path: path_to_string(&workspace_path),
        notes_path: path_to_string(&notes_path),
        assets_path: path_to_string(&assets_path),
        inbox_path: path_to_string(&inbox_path),
        sources_path: path_to_string(&sources_path),
        app_data_path: path_to_string(&app_data_path),
    })
}

fn read_note_tree(dir_path: &Path, root_path: &Path) -> Result<Vec<NoteTreeNode>, String> {
    let mut entries = fs::read_dir(dir_path)
        .map_err(|e| format!("failed to read notes directory: {e}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    entries.retain(|entry| {
        entry.path().is_dir()
            || entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    });
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        b_is_dir.cmp(&a_is_dir).then_with(|| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        })
    });

    entries
        .into_iter()
        .map(|entry| {
            let full_path = entry.path();
            let relative_path = full_path
                .strip_prefix(root_path)
                .unwrap_or(&full_path)
                .to_string_lossy()
                .to_string();
            let name = entry.file_name().to_string_lossy().to_string();

            if full_path.is_dir() {
                Ok(NoteTreeNode {
                    id: if relative_path.is_empty() {
                        name.clone()
                    } else {
                        relative_path
                    },
                    name,
                    path: path_to_string(&full_path),
                    node_type: "directory".to_string(),
                    children: Some(read_note_tree(&full_path, root_path)?),
                })
            } else {
                Ok(NoteTreeNode {
                    id: relative_path,
                    name,
                    path: path_to_string(&full_path),
                    node_type: "file".to_string(),
                    children: None,
                })
            }
        })
        .collect()
}

fn read_note_directories(
    dir_path: &Path,
    root_path: &Path,
    result: &mut Vec<String>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(dir_path).map_err(|e| format!("failed to read notes directory: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let full_path = entry.path();
        if !full_path.is_dir() {
            continue;
        }

        let relative_path = full_path
            .strip_prefix(root_path)
            .unwrap_or(&full_path)
            .to_string_lossy()
            .replace('\\', "/");
        result.push(relative_path);
        read_note_directories(&full_path, root_path, result)?;
    }
    Ok(())
}

fn get_quick_notes_file(workspace_path: &str) -> Result<PathBuf, String> {
    let inbox_path = Path::new(workspace_path).join("inbox");
    fs::create_dir_all(&inbox_path).map_err(|e| e.to_string())?;
    Ok(inbox_path.join("quick-notes.json"))
}

fn read_quick_notes_file(workspace_path: &str) -> Result<Vec<QuickNote>, String> {
    let file_path = get_quick_notes_file(workspace_path)?;
    let raw = fs::read_to_string(file_path).unwrap_or_else(|_| "[]".to_string());
    let mut notes = serde_json::from_str::<Vec<QuickNote>>(&raw).unwrap_or_default();
    notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(notes)
}

fn get_preferences_file(workspace_path: &str) -> Result<PathBuf, String> {
    let app_data_path = Path::new(workspace_path).join(".onemind");
    fs::create_dir_all(&app_data_path).map_err(|e| e.to_string())?;
    Ok(app_data_path.join("preferences.json"))
}

fn read_preferences_file(workspace_path: &str) -> Result<AppPreferences, String> {
    let file_path = get_preferences_file(workspace_path)?;
    if let Ok(raw) = fs::read_to_string(&file_path) {
        if let Ok(preferences) = serde_json::from_str::<AppPreferences>(&raw) {
            return Ok(preferences);
        }
    }

    let preferences = default_preferences();
    fs::write(
        file_path,
        serde_json::to_string_pretty(&preferences).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(preferences)
}

fn get_miniapps_file(workspace_path: &str) -> Result<PathBuf, String> {
    let sources_path = Path::new(workspace_path).join("sources");
    fs::create_dir_all(&sources_path).map_err(|e| e.to_string())?;
    Ok(sources_path.join("miniapps.json"))
}

fn read_miniapps_file(workspace_path: &str) -> Result<Vec<MiniappSource>, String> {
    let file_path = get_miniapps_file(workspace_path)?;
    if let Ok(raw) = fs::read_to_string(&file_path) {
        if let Ok(miniapps) = serde_json::from_str::<Vec<MiniappSource>>(&raw) {
            let normalized = miniapps
                .into_iter()
                .map(normalize_miniapp_source)
                .collect::<Vec<_>>();
            fs::write(
                &file_path,
                serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            return Ok(normalized);
        }
    }

    let miniapps = default_miniapps();
    fs::write(
        file_path,
        serde_json::to_string_pretty(&miniapps).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(miniapps)
}

fn normalize_timestamp(value: String) -> String {
    if chrono::DateTime::parse_from_rfc3339(&value).is_ok() {
        return value;
    }

    if let Ok(seconds) = value.parse::<i64>() {
        if let Some(date) = chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0) {
            return date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        }
    }

    now_iso_like()
}

fn normalize_miniapp_source(item: MiniappSource) -> MiniappSource {
    MiniappSource {
        created_at: normalize_timestamp(item.created_at),
        ..item
    }
}

fn ensure_float_note_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("float-note") {
        append_debug_log(app, "float_note_window_reuse", None);
        return Ok(window);
    }

    append_debug_log(app, "float_note_window_create_start", None);
    let window = WebviewWindowBuilder::new(
        app,
        "float-note",
        WebviewUrl::App("index.html#/float-note".into()),
    )
    .title("OneMind Float Note")
    .inner_size(724.0, 150.0)
    .min_inner_size(520.0, 150.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create float note window: {e}"))?;

    let focus_window = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(true)) {
            append_debug_log(
                &focus_window.app_handle(),
                "float_note_window_event_focused",
                Some("focused=true"),
            );
            let _ = focus_window.emit("float-note-focus-ready", ());
            append_debug_log(
                &focus_window.app_handle(),
                "float_note_emit_focus_ready",
                Some("source=window_event"),
            );
        } else if matches!(event, WindowEvent::Focused(false)) {
            append_debug_log(
                &focus_window.app_handle(),
                "float_note_window_event_focused",
                Some("focused=false"),
            );
            append_debug_log(
                &focus_window.app_handle(),
                "float_note_close_start",
                Some("source=blur"),
            );
            let _ = focus_window.close();
            append_debug_log(
                &focus_window.app_handle(),
                "float_note_close_done",
                Some("source=blur"),
            );
        }
    });

    append_debug_log(app, "float_note_window_create_done", None);
    Ok(window)
}

fn focus_float_note_input(app: &AppHandle, window: &WebviewWindow, source: &str) {
    let script = r#"
(() => {
  const input = document.querySelector('.float-note-text-input');
  if (!input || input.disabled) return false;
  window.focus();
  input.blur();
  input.focus({ preventScroll: true });
  const end = input.value.length;
  input.setSelectionRange(end, end);
  return document.activeElement === input;
})()
"#;
    match window.eval(script) {
        Ok(()) => append_debug_log(
            app,
            "float_note_eval_focus_input",
            Some(&format!("source={source} result=ok")),
        ),
        Err(error) => append_debug_log(
            app,
            "float_note_eval_focus_input",
            Some(&format!("source={source} result=err error={error}")),
        ),
    }
}

#[cfg(windows)]
fn activate_float_note_window_native(app: &AppHandle, window: &WebviewWindow, source: &str) {
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = BringWindowToTop(hwnd);
            let foreground_result = SetForegroundWindow(hwnd).as_bool();
            let focus_result = SetWin32Focus(Some(hwnd)).is_ok();
            append_debug_log(
                app,
                "float_note_native_activate",
                Some(&format!(
                    "source={source} foreground={foreground_result} focus={focus_result}"
                )),
            );
        },
        Err(error) => append_debug_log(
            app,
            "float_note_native_activate",
            Some(&format!("source={source} result=err error={error}")),
        ),
    }
}

#[cfg(not(windows))]
fn activate_float_note_window_native(_app: &AppHandle, _window: &WebviewWindow, _source: &str) {}

fn show_float_note_window(app: &AppHandle) -> Result<bool, String> {
    append_debug_log(app, "float_note_show_start", None);
    let window = ensure_float_note_window(app)?;
    let _ = window.set_size(LogicalSize::new(724.0, 150.0));
    if let Some(main) = app.get_webview_window("main") {
        let monitor = main.current_monitor().ok().flatten();
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let area_pos = area.position;
            let area_size = area.size;
            let scale = monitor.scale_factor();
            let width = 724.0;
            let x =
                area_pos.x as f64 / scale + (area_size.width as f64 / scale / 2.0) - (width / 2.0);
            let y =
                area_pos.y as f64 / scale + ((area_size.height as f64 / scale * 0.15).max(96.0));
            let _ = window.set_position(LogicalPosition::new(x.round(), y.round()));
        } else if let Ok(main_pos) = main.outer_position() {
            if let Ok(main_size) = main.outer_size() {
                let width = 724.0;
                let x = main_pos.x as f64 + (main_size.width as f64 / 2.0) - (width / 2.0);
                let y = main_pos.y as f64 + ((main_size.height as f64 * 0.15).max(96.0));
                let _ = window.set_position(LogicalPosition::new(x.round(), y.round()));
            }
        }
    } else {
        let _ = window.center();
    }

    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    append_debug_log(app, "float_note_show_done", None);
    let _ = window.set_always_on_top(true);
    window.set_focus().map_err(|e| e.to_string())?;
    append_debug_log(app, "float_note_set_focus_done", Some("source=show"));
    activate_float_note_window_native(app, &window, "show");
    let _ = window.emit("float-note-shown", ());
    append_debug_log(app, "float_note_emit_shown", None);
    focus_float_note_input(app, &window, "show");
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(std::time::Duration::from_millis(120));
        if let Some(window) = app_handle.get_webview_window("float-note") {
            let _ = window.set_focus();
            append_debug_log(
                &app_handle,
                "float_note_set_focus_done",
                Some("source=delayed_120ms"),
            );
            activate_float_note_window_native(&app_handle, &window, "delayed_120ms");
            let _ = window.emit("float-note-focus-ready", ());
            append_debug_log(
                &app_handle,
                "float_note_emit_focus_ready",
                Some("source=delayed_120ms"),
            );
            focus_float_note_input(&app_handle, &window, "delayed_120ms");
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        if let Some(window) = app_handle.get_webview_window("float-note") {
            let _ = window.set_focus();
            append_debug_log(
                &app_handle,
                "float_note_set_focus_done",
                Some("source=delayed_320ms"),
            );
            activate_float_note_window_native(&app_handle, &window, "delayed_320ms");
            focus_float_note_input(&app_handle, &window, "delayed_320ms");
        }
    });
    Ok(true)
}

fn toggle_float_note_window(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("float-note") {
        if window.is_visible().unwrap_or(false) {
            append_debug_log(app, "float_note_close_start", Some("source=toggle"));
            window.close().map_err(|e| e.to_string())?;
            append_debug_log(app, "float_note_close_done", Some("source=toggle"));
            return Ok(true);
        }
    }
    show_float_note_window(app)
}

fn handle_float_note_shortcut(app: &AppHandle, event: ShortcutState) {
    append_debug_log(
        app,
        "float_note_shortcut_event",
        Some(&format!("state={event:?}")),
    );
    let shortcut_state = app.state::<ShortcutStateStore>();

    if event == ShortcutState::Released {
        if let Ok(mut is_pressed) = shortcut_state.float_note_is_pressed.lock() {
            *is_pressed = false;
        }
        return;
    }

    if event != ShortcutState::Pressed {
        return;
    }

    if let Ok(mut is_pressed) = shortcut_state.float_note_is_pressed.lock() {
        if *is_pressed {
            append_debug_log(app, "float_note_shortcut_ignored", Some("reason=already_pressed"));
            return;
        }
        *is_pressed = true;
    }

    if let Ok(mut last_press) = shortcut_state.float_note_last_press.lock() {
        let now = Instant::now();
        if last_press
            .map(|last| now.duration_since(last) < Duration::from_millis(700))
            .unwrap_or(false)
        {
            append_debug_log(app, "float_note_shortcut_ignored", Some("reason=debounce"));
            return;
        }
        *last_press = Some(now);
    }

    if let Some(window) = app.get_webview_window("float-note") {
        if window.is_visible().unwrap_or(false) {
            append_debug_log(app, "float_note_close_start", Some("source=shortcut"));
            let _ = window.close();
            append_debug_log(app, "float_note_close_done", Some("source=shortcut"));
            return;
        }
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(std::time::Duration::from_millis(180));
        let _ = show_float_note_window(&app_handle);
    });
}

fn normalize_shortcut(shortcut: &str) -> String {
    shortcut
        .trim()
        .split('+')
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(match trimmed.to_ascii_lowercase().as_str() {
                    "cmdorctrl" | "cmdorcontrol" | "commandorctrl" | "commandorcontrol" => {
                        "CommandOrControl".to_string()
                    }
                    "ctrl" | "control" => "Control".to_string(),
                    "cmd" | "command" | "super" => "Super".to_string(),
                    "alt" | "option" => "Alt".to_string(),
                    "shift" => "Shift".to_string(),
                    "esc" | "escape" => "Escape".to_string(),
                    "up" => "ArrowUp".to_string(),
                    "down" => "ArrowDown".to_string(),
                    "left" => "ArrowLeft".to_string(),
                    "right" => "ArrowRight".to_string(),
                    "space" => "Space".to_string(),
                    "tab" => "Tab".to_string(),
                    "enter" | "return" => "Enter".to_string(),
                    "delete" | "del" => "Delete".to_string(),
                    "backspace" => "Backspace".to_string(),
                    _ => trimmed.to_string(),
                })
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn miniapp_window_label(view_key: &str) -> String {
    let sanitized = view_key
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        "miniapp-window".to_string()
    } else {
        format!("miniapp-{sanitized}")
    }
}

fn clamp_view_bounds(bounds: ViewBounds) -> ViewBounds {
    ViewBounds {
        x: bounds.x.max(0.0),
        y: bounds.y.max(0.0),
        width: bounds.width.max(1.0),
        height: bounds.height.max(1.0),
    }
}

fn resolve_fallback_log_file() -> PathBuf {
    env::temp_dir().join("onemind-tauri.log")
}

fn append_global_log(level: &str, message: &str, context: Option<&str>) {
    let fallback = resolve_fallback_log_file();
    append_line(&fallback, level, message, context);
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
        "debug-build".to_string()
    } else if is_debug_mode_enabled() {
        "ONEMIND_TAURI_DEBUG".to_string()
    } else {
        "disabled".to_string()
    }
}

fn append_debug_log(app: &AppHandle, message: &str, context: Option<&str>) {
    if !is_debug_mode_enabled() {
        return;
    }

    let fallback = resolve_fallback_log_file();
    append_line(&fallback, "debug", message, context);

    if let Ok(file_path) = resolve_log_file(app) {
        append_line(&file_path, "debug", message, context);
    }
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

fn resolve_diagnostics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let dir = base.join("diagnostics");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create probe dir: {e}"))?;
    Ok(dir)
}

fn resolve_log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_diagnostics_dir(app)?.join("shell-log.jsonl"))
}

#[tauri::command]
fn get_shell_report(app: AppHandle) -> Result<ShellReport, String> {
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
fn write_shell_log(
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

#[tauri::command]
fn diagnostics_get_debug_mode() -> DebugModeReport {
    DebugModeReport {
        enabled: is_debug_mode_enabled(),
        source: debug_mode_source(),
    }
}

#[tauri::command]
fn diagnostics_open_devtools(app: AppHandle, label: Option<String>) -> Result<bool, String> {
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

#[tauri::command]
fn workspace_get_default_path() -> Result<String, String> {
    Ok(path_to_string(&get_default_workspace_path()?))
}

#[tauri::command]
fn workspace_init_default() -> Result<WorkspaceMeta, String> {
    ensure_workspace_structure(get_default_workspace_path()?)
}

#[tauri::command]
fn workspace_select(window: WebviewWindow) -> Result<Option<WorkspaceMeta>, String> {
    let selected = window
        .dialog()
        .file()
        .set_title("选择 OneMind Workspace")
        .blocking_pick_folder();

    match selected {
        Some(path) => {
            let path_buf = path
                .into_path()
                .map_err(|_| "selected folder path is not available".to_string())?;
            ensure_workspace_structure(path_buf).map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn notes_list(workspace_path: String) -> Result<Vec<NoteTreeNode>, String> {
    let notes_path = Path::new(&workspace_path).join("notes");
    fs::create_dir_all(&notes_path).map_err(|e| e.to_string())?;
    read_note_tree(&notes_path, &notes_path)
}

#[tauri::command]
fn notes_list_directories(workspace_path: String) -> Result<Vec<String>, String> {
    let notes_path = Path::new(&workspace_path).join("notes");
    fs::create_dir_all(&notes_path).map_err(|e| e.to_string())?;
    let mut directories = Vec::new();
    read_note_directories(&notes_path, &notes_path, &mut directories)?;
    directories.sort();
    Ok(directories)
}

#[tauri::command]
fn notes_read(file_path: String) -> Result<String, String> {
    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn notes_write(file_path: String, content: String) -> Result<bool, String> {
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn notes_create_file(
    workspace_path: String,
    relative_dir: String,
    name: String,
) -> Result<String, String> {
    let notes_path = Path::new(&workspace_path).join("notes");
    let target_dir = notes_path.join(relative_dir);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let trimmed = name.trim();
    let normalized_name = if trimmed.to_lowercase().ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };
    let file_path = target_dir.join(&normalized_name);
    let title = normalized_name.trim_end_matches(".md");
    let markdown = format!("# {title}\n\n");

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
        .and_then(|mut file| file.write_all(markdown.as_bytes()))
        .map_err(|e| e.to_string())?;

    Ok(path_to_string(&file_path))
}

#[tauri::command]
fn notes_create_from_quick_note(
    workspace_path: String,
    relative_dir: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let notes_path = Path::new(&workspace_path).join("notes");
    let target_dir = notes_path.join(relative_dir);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let trimmed = name.trim();
    let normalized_name = if trimmed.to_lowercase().ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };
    let file_path = target_dir.join(&normalized_name);
    let title = normalized_name.trim_end_matches(".md");
    let markdown = format!("# {title}\n\n{}\n", content.trim());

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
        .and_then(|mut file| file.write_all(markdown.as_bytes()))
        .map_err(|e| e.to_string())?;

    Ok(path_to_string(&file_path))
}

#[tauri::command]
fn notes_create_folder(
    workspace_path: String,
    relative_dir: String,
    name: String,
) -> Result<String, String> {
    let target_dir = Path::new(&workspace_path)
        .join("notes")
        .join(relative_dir)
        .join(name.trim());
    fs::create_dir(&target_dir).map_err(|e| e.to_string())?;
    Ok(path_to_string(&target_dir))
}

#[tauri::command]
fn notes_rename(old_path: String, new_name: String) -> Result<String, String> {
    let old_path_buf = PathBuf::from(old_path);
    let parent = old_path_buf
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?;
    let new_path = parent.join(new_name);
    fs::rename(&old_path_buf, &new_path).map_err(|e| e.to_string())?;
    Ok(path_to_string(&new_path))
}

#[tauri::command]
fn notes_move(
    old_path: String,
    workspace_path: String,
    relative_dir: String,
) -> Result<String, String> {
    let notes_path = Path::new(&workspace_path).join("notes");
    let target_dir = notes_path.join(relative_dir);
    let resolved_notes = fs::canonicalize(&notes_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let resolved_target_dir = fs::canonicalize(&target_dir).map_err(|e| e.to_string())?;

    if !resolved_target_dir.starts_with(&resolved_notes) {
        return Err("Target directory is outside notes workspace.".to_string());
    }

    let old_path_buf = PathBuf::from(&old_path);
    let target_path = target_dir.join(
        old_path_buf
            .file_name()
            .ok_or_else(|| "target has no file name".to_string())?,
    );

    if old_path_buf == target_path {
        return Ok(old_path);
    }

    fs::rename(&old_path_buf, &target_path).map_err(|e| e.to_string())?;
    Ok(path_to_string(&target_path))
}

#[tauri::command]
fn notes_delete(target_path: String) -> Result<bool, String> {
    let path = PathBuf::from(target_path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
fn quick_notes_list(workspace_path: String) -> Result<Vec<QuickNote>, String> {
    read_quick_notes_file(&workspace_path)
}

#[tauri::command]
fn quick_notes_create(workspace_path: String, content: String) -> Result<QuickNote, String> {
    let next_content = content.trim();
    if next_content.is_empty() {
        return Err("Quick note content cannot be empty.".to_string());
    }

    let file_path = get_quick_notes_file(&workspace_path)?;
    let mut notes = read_quick_notes_file(&workspace_path)?;
    let item = QuickNote {
        id: format!("qn-{}", now_id()),
        content: next_content.to_string(),
        created_at: now_iso_like(),
    };
    notes.insert(0, item.clone());
    fs::write(
        file_path,
        serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
fn quick_notes_delete(workspace_path: String, id: String) -> Result<bool, String> {
    let file_path = get_quick_notes_file(&workspace_path)?;
    let notes = read_quick_notes_file(&workspace_path)?;
    let original_len = notes.len();
    let next_notes: Vec<QuickNote> = notes.into_iter().filter(|item| item.id != id).collect();

    if next_notes.len() == original_len {
        return Ok(false);
    }

    fs::write(
        file_path,
        serde_json::to_string_pretty(&next_notes).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn preferences_read(workspace_path: String) -> Result<AppPreferences, String> {
    read_preferences_file(&workspace_path)
}

#[tauri::command]
fn preferences_write(
    workspace_path: String,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    let file_path = get_preferences_file(&workspace_path)?;
    fs::write(
        file_path,
        serde_json::to_string_pretty(&preferences).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(preferences)
}

#[tauri::command]
fn miniapps_list(workspace_path: String) -> Result<Vec<MiniappSource>, String> {
    read_miniapps_file(&workspace_path)
}

#[tauri::command]
fn miniapps_create(workspace_path: String, input: MiniappInput) -> Result<MiniappSource, String> {
    let file_path = get_miniapps_file(&workspace_path)?;
    let mut miniapps = read_miniapps_file(&workspace_path)?;
    let item = MiniappSource {
        id: format!("miniapp-{}", now_id()),
        name: input.name,
        url: input.url,
        icon: None,
        created_at: now_iso_like(),
    };
    miniapps.push(item.clone());
    fs::write(
        file_path,
        serde_json::to_string_pretty(&miniapps).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
fn miniapps_update(
    workspace_path: String,
    id: String,
    input: MiniappInput,
) -> Result<Option<MiniappSource>, String> {
    let file_path = get_miniapps_file(&workspace_path)?;
    let mut miniapps = read_miniapps_file(&workspace_path)?;
    let mut updated = None;
    for item in &mut miniapps {
        if item.id == id {
            item.name = input.name.clone();
            item.url = input.url.clone();
            item.icon = None;
            updated = Some(item.clone());
            break;
        }
    }
    fs::write(
        file_path,
        serde_json::to_string_pretty(&miniapps).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
fn miniapps_delete(workspace_path: String, id: String) -> Result<bool, String> {
    let file_path = get_miniapps_file(&workspace_path)?;
    let miniapps = read_miniapps_file(&workspace_path)?
        .into_iter()
        .filter(|item| item.id != id)
        .collect::<Vec<_>>();
    fs::write(
        file_path,
        serde_json::to_string_pretty(&miniapps).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn float_note_show(app: AppHandle) -> Result<bool, String> {
    show_float_note_window(&app)
}

#[tauri::command]
fn float_note_toggle(app: AppHandle) -> Result<bool, String> {
    toggle_float_note_window(&app)
}

#[tauri::command]
fn float_note_hide(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("float-note") {
        append_debug_log(&app, "float_note_close_start", Some("source=command"));
        window.close().map_err(|e| e.to_string())?;
        append_debug_log(&app, "float_note_close_done", Some("source=command"));
    }
    Ok(true)
}

#[tauri::command]
fn float_note_set_height(app: AppHandle, height: u32) -> Result<bool, String> {
    let window = ensure_float_note_window(&app)?;
    let next_height = height.clamp(150, 560);
    window
        .set_size(LogicalSize::new(724.0, next_height as f64))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn float_note_open_route(app: AppHandle, route: String) -> Result<bool, String> {
    if let Some(main) = app.get_webview_window("main") {
        main.emit("app-navigate", route)
            .map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn float_note_register_shortcut(app: AppHandle, shortcut: String) -> Result<bool, String> {
    let next_shortcut = if shortcut.trim().is_empty() {
        "Alt+Space".to_string()
    } else {
        normalize_shortcut(&shortcut)
    };
    let state = app.state::<ShortcutStateStore>();
    let mut active_shortcut = state
        .float_note_shortcut
        .lock()
        .map_err(|_| "failed to lock shortcut state".to_string())?;

    if let Some(current) = active_shortcut.take() {
        let _ = app.global_shortcut().unregister(current.as_str());
    }

    let register_result =
        app.global_shortcut()
            .on_shortcut(next_shortcut.as_str(), |app, _shortcut, event| {
                handle_float_note_shortcut(app, event.state());
            });

    match register_result {
        Ok(()) => {
            *active_shortcut = Some(next_shortcut);
            Ok(true)
        }
        Err(err) => {
            append_global_log("shortcut", "register_failed", Some(&err.to_string()));
            Ok(false)
        }
    }
}

#[tauri::command]
async fn miniapp_view_show(
    app: AppHandle,
    view_key: String,
    url: String,
    partition: String,
    bounds: ViewBounds,
) -> Result<bool, String> {
    let label = miniapp_window_label(&view_key);
    let bounds = clamp_view_bounds(bounds);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(true);
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let external_url = url
        .parse()
        .map_err(|e| format!("invalid miniapp url: {e}"))?;
    let webview = main
        .add_child(
            WebviewBuilder::new(label, WebviewUrl::External(external_url)).data_directory(
                app.path()
                    .app_data_dir()
                    .map_err(|e| e.to_string())?
                    .join("miniapp-profiles")
                    .join(safe_storage_key(&partition)),
            ),
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| format!("failed to create miniapp view: {e}"))?;
    webview.show().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn miniapp_view_set_bounds(
    app: AppHandle,
    view_key: String,
    bounds: ViewBounds,
) -> Result<bool, String> {
    let label = miniapp_window_label(&view_key);
    let bounds = clamp_view_bounds(bounds);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
fn miniapp_view_hide(app: AppHandle, view_key: Option<String>) -> Result<bool, String> {
    if let Some(view_key) = view_key {
        let label = miniapp_window_label(&view_key);
        if let Some(webview) = app.get_webview(&label) {
            webview.hide().map_err(|e| e.to_string())?;
        }
        return Ok(true);
    }

    for (label, webview) in app.webviews() {
        if label.starts_with("miniapp-") {
            let _ = webview.hide();
        }
    }
    Ok(true)
}

#[tauri::command]
fn miniapp_view_reload(app: AppHandle, view_key: String, url: String) -> Result<bool, String> {
    let label = miniapp_window_label(&view_key);
    if let Some(webview) = app.get_webview(&label) {
        let parsed_url = url
            .parse()
            .map_err(|e| format!("invalid miniapp url: {e}"))?;
        webview
            .navigate(parsed_url)
            .map_err(|e| format!("failed to reload miniapp window: {e}"))?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn miniapp_view_close(app: AppHandle, view_key: String) -> Result<bool, String> {
    let label = miniapp_window_label(&view_key);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    append_global_log("boot", "run_entered", None);

    let builder = tauri::Builder::default();
    append_global_log("boot", "builder_created", None);

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(ShortcutStateStore::default())
        .setup(|app| {
            append_boot_log_line(app.handle(), "tauri_setup_entered");
            if let Some(main_window) = app.get_webview_window("main") {
                append_boot_log_line(app.handle(), "main_window_exists_from_config");
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        for (label, window) in app_handle.webview_windows() {
                            if label != "main" {
                                let _ = window.close();
                            }
                        }
                        for (label, webview) in app_handle.webviews() {
                            if label != "main" {
                                let _ = webview.close();
                            }
                        }
                        app_handle.exit(0);
                    }
                });
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
        .invoke_handler(tauri::generate_handler![
            get_shell_report,
            write_shell_log,
            diagnostics_get_debug_mode,
            diagnostics_open_devtools,
            workspace_get_default_path,
            workspace_select,
            workspace_init_default,
            notes_list,
            notes_list_directories,
            notes_read,
            notes_write,
            notes_create_file,
            notes_create_from_quick_note,
            notes_create_folder,
            notes_rename,
            notes_move,
            notes_delete,
            quick_notes_list,
            quick_notes_create,
            quick_notes_delete,
            preferences_read,
            preferences_write,
            miniapps_list,
            miniapps_create,
            miniapps_update,
            miniapps_delete,
            float_note_show,
            float_note_toggle,
            float_note_hide,
            float_note_set_height,
            float_note_open_route,
            float_note_register_shortcut,
            miniapp_view_show,
            miniapp_view_set_bounds,
            miniapp_view_hide,
            miniapp_view_reload,
            miniapp_view_close
        ]);

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
