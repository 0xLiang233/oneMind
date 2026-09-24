//! Floating palette lifecycle. All native mutations use one off-UI-thread lane.
use crate::{append_debug_log, append_global_log, runtime::SerialExecutor};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const LABEL: &str = "float-note";
const FLOAT_NOTE_WIDTH: f64 = 724.0;
const FLOAT_NOTE_MIN_HEIGHT: f64 = 150.0;
const FLOAT_NOTE_SCREEN_MARGIN: f64 = 24.0;
const BLUR_DELAY: Duration = Duration::from_millis(180);

#[derive(Default)]
pub(crate) struct FloatNoteState {
    lane: SerialExecutor,
    generation: AtomicU64,
    pub(crate) float_note_shortcut: Mutex<Option<String>>,
    float_note_suspended_shortcut: Mutex<Option<String>>,
    last_press: Mutex<Option<Instant>>,
}

fn generation(app: &AppHandle) -> u64 {
    app.state::<FloatNoteState>()
        .generation
        .load(Ordering::SeqCst)
}

fn invalidate_pending(app: &AppHandle) -> u64 {
    app.state::<FloatNoteState>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1
}

async fn run<T: Send + 'static>(
    app: AppHandle,
    name: &'static str,
    task: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let lane = app.state::<FloatNoteState>().lane.clone();
    lane.run(name, move || task(&app)).await
}

fn ensure_float_note_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    // Never call this builder from a synchronous command or WebView callback.
    let window =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/float-note".into()))
            .title("OneMind Float Note")
            .inner_size(FLOAT_NOTE_WIDTH, FLOAT_NOTE_MIN_HEIGHT)
            .min_inner_size(520.0, FLOAT_NOTE_MIN_HEIGHT)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|e| format!("failed to create float note window: {e}"))?;
    let app = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            // Return to the WebView message pump before issuing focus/eval calls.
            let app = app.clone();
            let expected = generation(&app);
            tauri::async_runtime::spawn(async move {
                let _ = run(app, "float_note_focused", move |app| {
                    if generation(app) == expected {
                        if let Some(window) = app.get_webview_window(LABEL) {
                            focus_input(&window)?;
                        }
                    }
                    Ok(())
                })
                .await;
            });
        }
        WindowEvent::Focused(false) => {
            // Invalidate old focus retries immediately, even while a show is finishing.
            let expected = invalidate_pending(&app);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(BLUR_DELAY).await;
                let _ = run(app, "float_note_blur", move |app| {
                    if generation(app) != expected {
                        return Ok(());
                    }
                    if let Some(window) = app.get_webview_window(LABEL) {
                        // A child WebView focus change is not an application switch.
                        // Never steal focus just because the pointer is still over us.
                        if window.is_visible().unwrap_or(false) && !is_active(&window) {
                            hide_float_note_window(app, &window, "blur")?;
                        }
                    }
                    Ok(())
                })
                .await;
            });
        }
        WindowEvent::Destroyed => {
            invalidate_pending(&app);
        }
        _ => {}
    });
    Ok(window)
}

fn is_active(window: &WebviewWindow) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    #[cfg(windows)]
    {
        crate::float_note_focus::is_window_foreground(window).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        window.is_focused().unwrap_or(false)
    }
}

fn focus_input(window: &WebviewWindow) -> Result<(), String> {
    if !is_active(window) {
        return Ok(());
    }
    // Focus notifications may be raised by set_focus itself. Only update DOM
    // here: resetting native focus in this callback causes a focus-event loop.
    window
        .emit("float-note-focus-ready", ())
        .map_err(|e| e.to_string())?;
    window
        .eval(
            r#"(() => {
      if (!document.hasFocus()) return;
      const input = document.querySelector('.float-note-text-input');
      if (!input || input.disabled || document.activeElement === input) return;
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(end, end);
    })()"#,
        )
        .map_err(|e| e.to_string())
}

// Only explicit activation may move native focus. Delayed retries and Focused
// callbacks must use focus_input instead, or they recursively generate events.
fn activate_input(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    if !is_active(window) {
        return Ok(());
    }
    // Use the supported runtime API, never another process's input queue/HWNDs.
    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_focus().map_err(|e| e.to_string())?;
    }
    focus_input(window)
}

pub(crate) fn hide_float_note_window(
    app: &AppHandle,
    window: &WebviewWindow,
    source: &str,
) -> Result<(), String> {
    invalidate_pending(app);
    append_debug_log(app, "float_note_hide", Some(source));
    window.hide().map_err(|e| e.to_string())
}

fn show_float_note_window(app: &AppHandle) -> Result<bool, String> {
    let window = ensure_float_note_window(app)?;
    let expected = invalidate_pending(app);
    window
        .set_size(LogicalSize::new(FLOAT_NOTE_WIDTH, FLOAT_NOTE_MIN_HEIGHT))
        .map_err(|e| e.to_string())?;
    position_float_note_window(app, &window, FLOAT_NOTE_MIN_HEIGHT, true, "show");
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window
        .emit("float-note-shown", ())
        .map_err(|e| e.to_string())?;
    activate_input(app, &window)?;
    append_debug_log(app, "float_note_shown", None);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for delay in [120, 200] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            let current = app.clone();
            let result = run(current, "float_note_focus_retry", move |app| {
                if generation(app) != expected {
                    return Ok(false);
                }
                if let Some(window) = app.get_webview_window(LABEL) {
                    if !is_active(&window) {
                        return Ok(false);
                    }
                    focus_input(&window)?;
                    return Ok(true);
                }
                Ok(false)
            })
            .await;
            if result != Ok(true) {
                break;
            }
        }
    });
    Ok(true)
}

fn toggle_float_note_window(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        if is_active(&window) {
            hide_float_note_window(app, &window, "toggle")?;
            return Ok(true);
        }
    }
    show_float_note_window(app)
}

fn position_float_note_window(
    app: &AppHandle,
    window: &WebviewWindow,
    height: f64,
    prefer_cursor_monitor: bool,
    source: &str,
) {
    let monitor = if prefer_cursor_monitor {
        app.cursor_position()
            .ok()
            .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
            .or_else(|| window.current_monitor().ok().flatten())
    } else {
        window.current_monitor().ok().flatten()
    };

    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let area_pos = area.position;
        let area_size = area.size;
        let scale = monitor.scale_factor();
        let area_x = area_pos.x as f64 / scale;
        let area_y = area_pos.y as f64 / scale;
        let area_width = area_size.width as f64 / scale;
        let area_height = area_size.height as f64 / scale;
        let next_height = height.max(FLOAT_NOTE_MIN_HEIGHT);
        let min_x = area_x + FLOAT_NOTE_SCREEN_MARGIN;
        let max_x = area_x + area_width - FLOAT_NOTE_WIDTH - FLOAT_NOTE_SCREEN_MARGIN;
        let x =
            (area_x + (area_width / 2.0) - (FLOAT_NOTE_WIDTH / 2.0)).clamp(min_x, max_x.max(min_x));
        let center_y = area_y + (area_height / 3.0);
        let min_y = area_y + FLOAT_NOTE_SCREEN_MARGIN;
        let max_y = area_y + area_height - next_height - FLOAT_NOTE_SCREEN_MARGIN;
        let y = (center_y - (next_height / 2.0)).clamp(min_y, max_y.max(min_y));
        let _ = window.set_position(LogicalPosition::new(x.round(), y.round()));
        append_debug_log(
            app,
            "float_note_positioned",
            Some(&format!(
                "source={source} monitor={}x{}@{},{} scale={} x={} y={} height={}",
                area_size.width,
                area_size.height,
                area_pos.x,
                area_pos.y,
                scale,
                x.round(),
                y.round(),
                next_height
            )),
        );
        return;
    }

    if let Some(main) = app.get_webview_window("main") {
        if let Ok(main_pos) = main.outer_position() {
            if let Ok(main_size) = main.outer_size() {
                let next_height = height.max(FLOAT_NOTE_MIN_HEIGHT);
                let x =
                    main_pos.x as f64 + (main_size.width as f64 / 2.0) - (FLOAT_NOTE_WIDTH / 2.0);
                let center_y = main_pos.y as f64 + (main_size.height as f64 / 3.0);
                let y = center_y - (next_height / 2.0);
                let _ = window.set_position(LogicalPosition::new(x.round(), y.round()));
                append_debug_log(
                    app,
                    "float_note_positioned",
                    Some(&format!(
                        "source={source} fallback=main x={} y={} height={}",
                        x.round(),
                        y.round(),
                        next_height
                    )),
                );
                return;
            }
        }
    }

    let _ = window.center();
    append_debug_log(
        app,
        "float_note_positioned",
        Some(&format!("source={source} fallback=center")),
    );
}

fn keep_float_note_window_inside_current_monitor(
    app: &AppHandle,
    window: &WebviewWindow,
    source: &str,
) {
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };

    let area = monitor.work_area();
    let area_pos = area.position;
    let area_size = area.size;
    let margin = (FLOAT_NOTE_SCREEN_MARGIN * monitor.scale_factor()).round() as i32;
    let min_x = area_pos.x + margin;
    let max_x = area_pos.x + area_size.width as i32 - size.width as i32 - margin;
    let min_y = area_pos.y + margin;
    let max_y = area_pos.y + area_size.height as i32 - size.height as i32 - margin;
    let next_x = position.x.clamp(min_x, max_x.max(min_x));
    let next_y = position.y.clamp(min_y, max_y.max(min_y));

    if next_x == position.x && next_y == position.y {
        return;
    }

    let _ = window.set_position(PhysicalPosition::new(next_x, next_y));
    append_debug_log(
        app,
        "float_note_position_clamped",
        Some(&format!(
            "source={source} from={},{} to={},{} size={}x{} monitor={}x{}@{},{}",
            position.x,
            position.y,
            next_x,
            next_y,
            size.width,
            size.height,
            area_size.width,
            area_size.height,
            area_pos.x,
            area_pos.y
        )),
    );
}

pub(crate) fn normalize_shortcut(shortcut: &str) -> String {
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

pub(crate) fn register_float_note_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let state = app.state::<FloatNoteState>();
            if let Ok(mut last) = state.last_press.lock() {
                let now = Instant::now();
                if last.is_some_and(|last| now.duration_since(last) < Duration::from_millis(220)) {
                    return;
                }
                *last = Some(now);
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = float_note_toggle(app).await {
                    append_global_log("error", "float_note_shortcut_failed", Some(&error));
                }
            });
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn float_note_show(app: AppHandle) -> Result<bool, String> {
    run(app, "float_note_show", show_float_note_window).await
}

#[tauri::command]
pub async fn float_note_toggle(app: AppHandle) -> Result<bool, String> {
    run(app, "float_note_toggle", toggle_float_note_window).await
}

#[tauri::command]
pub async fn float_note_hide(app: AppHandle) -> Result<bool, String> {
    run(app, "float_note_hide", |app| {
        if let Some(window) = app.get_webview_window(LABEL) {
            hide_float_note_window(app, &window, "command")?;
        }
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn float_note_focus(app: AppHandle) -> Result<bool, String> {
    run(app, "float_note_focus", |app| {
        let Some(window) = app.get_webview_window(LABEL) else {
            return Ok(false);
        };
        if !window.is_visible().unwrap_or(false) {
            return Ok(false);
        }
        window.set_focus().map_err(|e| e.to_string())?;
        activate_input(app, &window)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn float_note_set_height(app: AppHandle, height: u32) -> Result<bool, String> {
    run(app, "float_note_set_height", move |app| {
        // A stale renderer resize must not create a new palette after it closes.
        let Some(window) = app.get_webview_window(LABEL) else {
            return Ok(false);
        };
        window
            .set_size(LogicalSize::new(
                FLOAT_NOTE_WIDTH,
                height.clamp(150, 560) as f64,
            ))
            .map_err(|e| e.to_string())?;
        keep_float_note_window_inside_current_monitor(app, &window, "set_height");
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn float_note_open_route(app: AppHandle, route: String) -> Result<bool, String> {
    run(app, "float_note_open_route", move |app| {
        let Some(main) = app.get_webview_window("main") else {
            return Ok(false);
        };
        main.emit("app-navigate", route)
            .map_err(|e| e.to_string())?;
        main.unminimize().map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn float_note_register_shortcut(
    app: AppHandle,
    shortcut: String,
) -> Result<bool, String> {
    run(app, "float_note_register_shortcut", move |app| {
        let next = if shortcut.trim().is_empty() {
            "Alt+Space".to_string()
        } else {
            normalize_shortcut(&shortcut)
        };
        let state = app.state::<FloatNoteState>();
        let current = state
            .float_note_shortcut
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if current.as_ref() == Some(&next) {
            return Ok(true);
        }
        // Register first: an invalid/unavailable shortcut must not disable the old one.
        if register_float_note_shortcut(app, &next).is_err() {
            return Ok(false);
        }
        if let Some(current) = current {
            if let Err(error) = app.global_shortcut().unregister(current.as_str()) {
                let _ = app.global_shortcut().unregister(next.as_str());
                return Err(error.to_string());
            }
        }
        *state
            .float_note_shortcut
            .lock()
            .map_err(|e| e.to_string())? = Some(next);
        *state
            .float_note_suspended_shortcut
            .lock()
            .map_err(|e| e.to_string())? = None;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn float_note_set_shortcut_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    run(app, "float_note_set_shortcut_enabled", move |app| {
        let state = app.state::<FloatNoteState>();
        if enabled {
            if state
                .float_note_shortcut
                .lock()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Ok(true);
            }
            let suspended = state
                .float_note_suspended_shortcut
                .lock()
                .map_err(|e| e.to_string())?
                .clone();
            if let Some(shortcut) = suspended {
                register_float_note_shortcut(app, &shortcut)?;
                *state
                    .float_note_shortcut
                    .lock()
                    .map_err(|e| e.to_string())? = Some(shortcut);
                *state
                    .float_note_suspended_shortcut
                    .lock()
                    .map_err(|e| e.to_string())? = None;
            }
        } else {
            let active = state
                .float_note_shortcut
                .lock()
                .map_err(|e| e.to_string())?
                .clone();
            if let Some(shortcut) = active {
                app.global_shortcut()
                    .unregister(shortcut.as_str())
                    .map_err(|e| e.to_string())?;
                *state
                    .float_note_shortcut
                    .lock()
                    .map_err(|e| e.to_string())? = None;
                *state
                    .float_note_suspended_shortcut
                    .lock()
                    .map_err(|e| e.to_string())? = Some(shortcut);
            }
        }
        Ok(true)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_normalization_remains_compatible() {
        assert_eq!(normalize_shortcut(" alt + space "), "Alt+Space");
        assert_eq!(normalize_shortcut("ctrl+shift+k"), "Control+Shift+k");
    }
}
