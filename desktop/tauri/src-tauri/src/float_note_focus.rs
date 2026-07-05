#[derive(Debug)]
pub struct ChildFocusReport {
    pub result: Option<bool>,
    pub target_thread: Option<u32>,
    pub attached_target: Option<bool>,
    pub children: String,
}

#[derive(Debug)]
pub struct ActivationReport {
    pub foreground_result: bool,
    pub focus_result: bool,
    pub child_focus_result: bool,
    pub foreground_match: bool,
    pub current_thread: u32,
    pub foreground_thread: u32,
    pub window_thread: u32,
    pub attached_foreground: bool,
    pub attached_window: bool,
    pub child_focus: ChildFocusReport,
}

#[cfg(windows)]
mod platform {
    use super::{ActivationReport, ChildFocusReport};
    use tauri::WebviewWindow;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SetActiveWindow, SetFocus as SetWin32Focus,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumChildWindows, GetClassNameW, GetForegroundWindow,
        GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow,
        HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNORMAL,
    };

    // These class markers are WebView2/WRY implementation details on Windows.
    // Keep them isolated here so future WebView runtime changes touch one place.
    const WEBVIEW_CHILD_CLASS_MARKERS: &[&str] = &[
        "Chrome_WidgetWin",
        "WebView",
        "Internet Explorer_Server",
    ];

    pub fn activate_window(window: &WebviewWindow) -> Result<ActivationReport, String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let foreground_before = GetForegroundWindow();
            let current_thread = GetCurrentThreadId();
            let foreground_thread = GetWindowThreadProcessId(foreground_before, None);
            let window_thread = GetWindowThreadProcessId(hwnd, None);
            let attached_foreground = attach_thread_input(current_thread, foreground_thread);
            let attached_window = attach_thread_input(current_thread, window_thread);

            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = BringWindowToTop(hwnd);
            let _ = SetActiveWindow(hwnd);
            let foreground_result = SetForegroundWindow(hwnd).as_bool();
            let focus_result = SetWin32Focus(Some(hwnd)).is_ok();
            let child_focus = focus_webview_child(hwnd);
            let foreground_after = GetForegroundWindow();

            detach_thread_input(current_thread, window_thread, attached_window);
            detach_thread_input(current_thread, foreground_thread, attached_foreground);

            Ok(ActivationReport {
                foreground_result,
                focus_result,
                child_focus_result: child_focus.result.unwrap_or(false),
                foreground_match: foreground_after == hwnd,
                current_thread,
                foreground_thread,
                window_thread,
                attached_foreground,
                attached_window,
                child_focus,
            })
        }
    }

    pub fn is_window_foreground(window: &WebviewWindow) -> Result<bool, String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        Ok(unsafe { GetForegroundWindow() == hwnd })
    }

    unsafe fn attach_thread_input(current_thread: u32, target_thread: u32) -> bool {
        target_thread != 0
            && target_thread != current_thread
            && AttachThreadInput(current_thread, target_thread, true).as_bool()
    }

    unsafe fn detach_thread_input(current_thread: u32, target_thread: u32, attached: bool) {
        if attached {
            let _ = AttachThreadInput(current_thread, target_thread, false);
        }
    }

    unsafe extern "system" fn collect_child_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let children = &mut *(lparam.0 as *mut Vec<HWND>);
        children.push(hwnd);
        true.into()
    }

    unsafe fn get_window_class_name(hwnd: HWND) -> String {
        let mut buffer = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut buffer);
        if len <= 0 {
            return "unknown".to_string();
        }
        String::from_utf16_lossy(&buffer[..len as usize])
    }

    unsafe fn find_webview_focus_target(hwnd: HWND) -> (Option<HWND>, String) {
        let mut children: Vec<HWND> = Vec::new();
        let lparam = LPARAM((&mut children as *mut Vec<HWND>) as isize);
        let _ = EnumChildWindows(Some(hwnd), Some(collect_child_window), lparam);

        let mut summary = Vec::new();
        let mut fallback = None;
        let mut preferred = None;
        for child in children {
            let class_name = get_window_class_name(child);
            let visible = IsWindowVisible(child).as_bool();
            let is_webview = WEBVIEW_CHILD_CLASS_MARKERS
                .iter()
                .any(|marker| class_name.contains(marker));
            summary.push(format!(
                "{} visible={} webview={}",
                class_name, visible, is_webview
            ));
            if visible {
                fallback = Some(child);
                if is_webview {
                    preferred = Some(child);
                }
            }
        }

        (preferred.or(fallback), summary.join(" | "))
    }

    unsafe fn focus_webview_child(hwnd: HWND) -> ChildFocusReport {
        let (target, children) = find_webview_focus_target(hwnd);
        let Some(target) = target else {
            return ChildFocusReport {
                result: None,
                target_thread: None,
                attached_target: None,
                children,
            };
        };

        let current_thread = GetCurrentThreadId();
        let target_thread = GetWindowThreadProcessId(target, None);
        let attached_target = attach_thread_input(current_thread, target_thread);
        let focus_result = SetWin32Focus(Some(target)).is_ok();
        detach_thread_input(current_thread, target_thread, attached_target);

        ChildFocusReport {
            result: Some(focus_result),
            target_thread: Some(target_thread),
            attached_target: Some(attached_target),
            children,
        }
    }
}

#[cfg(windows)]
pub use platform::{activate_window, is_window_foreground};
