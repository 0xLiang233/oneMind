use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[derive(Clone, Serialize)]
pub struct PreviewDocument {
    source: String,
    theme: String,
}

#[derive(Default)]
pub struct PreviewStore(Mutex<HashMap<String, PreviewDocument>>);
static NEXT_PREVIEW: AtomicU64 = AtomicU64::new(1);

fn require_preview(window: &WebviewWindow) -> Result<(), String> {
    if window.label().starts_with("mermaid-preview-") {
        Ok(())
    } else {
        Err("This command is only available to diagram preview windows".into())
    }
}

#[tauri::command]
pub async fn mermaid_preview_open(
    app: AppHandle,
    window: WebviewWindow,
    source: String,
    theme: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main editor can open diagram previews".into());
    }
    if source.trim().is_empty() || source.len() > 2_000_000 {
        return Err("Diagram source is empty or too large".into());
    }
    let label = format!(
        "mermaid-preview-{}",
        NEXT_PREVIEW.fetch_add(1, Ordering::Relaxed)
    );
    let document = PreviewDocument {
        source,
        theme: if theme == "dark" { "dark" } else { "light" }.into(),
    };
    app.state::<PreviewStore>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(label.clone(), document);
    let result = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("index.html#/mermaid-preview".into()),
    )
    .title("Mermaid 图表预览 · OneMind")
    .inner_size(1200.0, 800.0)
    .min_inner_size(540.0, 360.0)
    .resizable(true)
    .fullscreen(true)
    .build();
    match result {
        Ok(preview) => {
            preview.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    if let Ok(mut documents) = app.state::<PreviewStore>().0.lock() {
                        documents.remove(&label);
                    }
                }
            });
            Ok(())
        }
        Err(error) => {
            if let Ok(mut documents) = app.state::<PreviewStore>().0.lock() {
                documents.remove(&label);
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn mermaid_preview_read(
    window: WebviewWindow,
    state: State<'_, PreviewStore>,
) -> Result<PreviewDocument, String> {
    require_preview(&window)?;
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(window.label())
        .cloned()
        .ok_or_else(|| "Diagram preview has expired".into())
}

#[tauri::command]
pub fn mermaid_preview_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    require_preview(&window)?;
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mermaid_preview_close(window: WebviewWindow) -> Result<(), String> {
    require_preview(&window)?;
    window.close().map_err(|e| e.to_string())
}
