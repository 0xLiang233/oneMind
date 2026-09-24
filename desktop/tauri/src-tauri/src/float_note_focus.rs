//! The only native query needed for palette activation.
//! Do not attach input queues or manipulate WebView2's private child HWNDs.
#[cfg(windows)]
pub fn is_window_foreground(window: &tauri::WebviewWindow) -> Result<bool, String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    Ok(unsafe { GetForegroundWindow() == hwnd })
}
