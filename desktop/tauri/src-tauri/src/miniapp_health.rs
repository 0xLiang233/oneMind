//! WebView2 process events stay isolated from the portable renderer contract.
#[cfg(windows)]
pub(crate) fn observe(
    view: &tauri::Webview,
    app: tauri::AppHandle,
    view_key: String,
    instance: u64,
) {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};
    let result = view.with_webview(move |platform| unsafe {
        let install = || -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let mut token = 0;
            core.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                        args.ProcessFailedKind(&mut kind)?;
                        let reason = if kind
                            == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                        {
                            Some("unresponsive")
                        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                        {
                            Some("crashed")
                        } else {
                            None
                        }; // GPU/utility/subframe failures can recover themselves.
                        if let Some(reason) = reason {
                            crate::miniapp::process_failed(
                                app.clone(),
                                view_key.clone(),
                                instance,
                                reason,
                                failure_details(&args, kind),
                            );
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;
            // The registration belongs to this CoreWebView2 and is released on close.
            Ok(())
        };
        if let Err(error) = install() {
            crate::append_global_log(
                "warn",
                "miniapp_health_install_failed",
                Some(&error.to_string()),
            );
        }
    });
    if let Err(error) = result {
        crate::append_global_log(
            "warn",
            "miniapp_health_dispatch_failed",
            Some(&error.to_string()),
        );
    }
}

#[cfg(not(windows))]
pub(crate) fn observe(_: &tauri::Webview, _: tauri::AppHandle, _: String, _: u64) {}

// Read optional diagnostic fields without making recovery depend on a newer
// interface. In particular, an exited renderer is not necessarily an OOM.
#[cfg(windows)]
fn failure_details(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ProcessFailedEventArgs,
    kind: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND,
) -> String {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    let mut details = format!("kind={}", kind.0);
    if let Ok(extra) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
        let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
        if unsafe { extra.Reason(&mut reason) }.is_ok() {
            let name = match reason {
                COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED => "crashed",
                COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE => "unresponsive",
                COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED => "terminated",
                COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY => "out_of_memory",
                COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED => "launch_failed",
                COREWEBVIEW2_PROCESS_FAILED_REASON_PROFILE_DELETED => "profile_deleted",
                _ => "unexpected",
            };
            details.push_str(&format!(" process_reason={name}({})", reason.0));
        }
        let mut code = 0;
        if unsafe { extra.ExitCode(&mut code) }.is_ok() {
            details.push_str(&format!(" exit_code={code} exit_hex=0x{:08X}", code as u32));
        }
    }
    details
}
