//! Native miniapp views. Native mutations are serialized off the UI thread.
use crate::{
    append_debug_log, append_global_log, is_external_web_url, open_external_web_url,
    runtime::SerialExecutor, safe_storage_key, ViewBounds,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
};

#[derive(Default)]
pub(crate) struct MiniappState {
    lane: SerialExecutor,
    instances: Mutex<HashMap<String, (u64, bool)>>,
}
static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

async fn run<T: Send + 'static>(
    app: AppHandle,
    name: &'static str,
    task: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let lane = app.state::<MiniappState>().lane.clone();
    lane.run(name, move || task(&app)).await
}

fn set_bounds(webview: &Webview, bounds: ViewBounds) -> Result<(), String> {
    let bounds = clamp_view_bounds(bounds);
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn miniapp_view_show(
    app: AppHandle,
    view_key: String,
    url: String,
    partition: String,
    bounds: ViewBounds,
) -> Result<bool, String> {
    run(app, "miniapp_view_show", move |app| {
        let label = miniapp_window_label(&view_key);
        if let Some(webview) = app.get_webview(&label) {
            let failed = app
                .state::<MiniappState>()
                .instances
                .lock()
                .map_err(|e| e.to_string())?
                .get(&label)
                .is_some_and(|(_, failed)| *failed);
            if failed {
                return Err("网页进程异常，请重试以重新载入网页。".into());
            }
            set_bounds(&webview, bounds)?;
            webview.show().map_err(|e| e.to_string())?;
            return Ok(true);
        }
        let external_url = Url::parse(&url).map_err(|e| format!("invalid miniapp url: {e}"))?;
        if !is_external_web_url(&external_url) {
            return Err("Only HTTP(S) miniapps are supported".into());
        }
        let base_url = external_url.clone();
        let popup_base_url = external_url.clone();
        let navigation_app = app.clone();
        let popup_app = app.clone();
        let popup_label = label.clone();
        let bounds = clamp_view_bounds(bounds);
        let instance = NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed);
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(external_url))
            // Preserve the existing partition path: upgrades must retain logins.
            .data_directory(
                app.path()
                    .app_data_dir()
                    .map_err(|e| e.to_string())?
                    .join("miniapp-profiles")
                    .join(safe_storage_key(&partition)),
            )
            .on_navigation(move |target| {
                if should_keep_miniapp_navigation_inside(&base_url, target) {
                    return true;
                }
                defer_external_open(target.clone(), navigation_app.clone());
                false
            })
            .on_new_window(move |target, _| {
                if should_keep_miniapp_navigation_inside(&popup_base_url, &target) {
                    let app = popup_app.clone();
                    let label = popup_label.clone();
                    // A WebView2 event handler must return before another COM
                    // navigation call; never navigate inline in this callback.
                    tauri::async_runtime::spawn(async move {
                        let _ = run(app, "miniapp_popup_navigation", move |app| {
                            if instance_is_current(app, &label, instance) {
                                if let Some(view) = app.get_webview(&label) {
                                    view.navigate(target).map_err(|e| e.to_string())?;
                                }
                            }
                            Ok(())
                        })
                        .await;
                    });
                } else {
                    defer_external_open(target, popup_app.clone());
                }
                NewWindowResponse::Deny
            });
        let main = app
            .get_window("main")
            .ok_or("main window is not available")?;
        let webview = main
            .add_child(
                builder,
                LogicalPosition::new(bounds.x, bounds.y),
                LogicalSize::new(bounds.width, bounds.height),
            )
            .map_err(|e| format!("failed to create miniapp view: {e}"))?;
        app.state::<MiniappState>()
            .instances
            .lock()
            .map_err(|e| e.to_string())?
            .insert(label.clone(), (instance, false));
        crate::miniapp_health::observe(&webview, app.clone(), view_key, instance);
        webview.show().map_err(|e| e.to_string())?;
        append_debug_log(
            app,
            "miniapp_view_created",
            Some(&format!("label={label} {}", format_view_bounds(bounds))),
        );
        Ok(true)
    })
    .await
}

fn defer_external_open(url: Url, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = crate::runtime::run_blocking("miniapp_external_open", move || {
            append_debug_log(&app, "miniapp_external_navigation", Some(url.as_str()));
            open_external_web_url(&url)
        })
        .await;
    });
}

fn instance_is_current(app: &AppHandle, label: &str, instance: u64) -> bool {
    app.state::<MiniappState>()
        .instances
        .lock()
        .ok()
        .and_then(|instances| instances.get(label).copied())
        .is_some_and(|(id, _)| id == instance)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FailureEvent {
    view_key: String,
    reason: String,
}

pub(crate) fn process_failed(
    app: AppHandle,
    view_key: String,
    instance: u64,
    reason: &str,
    details: String,
) {
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = run(app, "miniapp_process_failed", move |app| {
            let label = miniapp_window_label(&view_key);
            {
                let state = app.state::<MiniappState>();
                let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
                let Some((id, failed)) = instances.get_mut(&label) else {
                    return Ok(());
                };
                if *id != instance || *failed {
                    return Ok(());
                }
                *failed = true;
            }
            append_global_log(
                "error",
                "miniapp_process_failed",
                Some(&format!("label={label} reason={reason} {details}")),
            );
            if let Some(view) = app.get_webview(&label) {
                // Hide, not reload: never silently discard a remote page's draft.
                let _ = view.hide();
            }
            app.emit_to(
                "main",
                "miniapp-view-failed",
                FailureEvent { view_key, reason },
            )
            .map_err(|e| e.to_string())
        })
        .await;
    });
}

#[tauri::command]
pub async fn miniapp_view_set_bounds(
    app: AppHandle,
    view_key: String,
    bounds: ViewBounds,
) -> Result<bool, String> {
    run(app, "miniapp_view_set_bounds", move |app| {
        if let Some(view) = app.get_webview(&miniapp_window_label(&view_key)) {
            set_bounds(&view, bounds)?;
        }
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn miniapp_view_hide(app: AppHandle, view_key: Option<String>) -> Result<bool, String> {
    run(app, "miniapp_view_hide", move |app| {
        let label = view_key.map(|key| miniapp_window_label(&key));
        for (key, view) in app.webviews() {
            if key.starts_with("miniapp-") && label.as_ref().is_none_or(|label| *label == key) {
                view.hide().map_err(|e| e.to_string())?;
            }
        }
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn miniapp_view_reload(
    app: AppHandle,
    view_key: String,
    url: String,
) -> Result<bool, String> {
    run(app, "miniapp_view_reload", move |app| {
        let Some(view) = app.get_webview(&miniapp_window_label(&view_key)) else {
            return Ok(false);
        };
        let url = Url::parse(&url).map_err(|e| e.to_string())?;
        if !is_external_web_url(&url) {
            return Err("Only HTTP(S) miniapps are supported".into());
        }
        view.navigate(url).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn miniapp_view_close(app: AppHandle, view_key: String) -> Result<bool, String> {
    run(app, "miniapp_view_close", move |app| {
        let label = miniapp_window_label(&view_key);
        app.state::<MiniappState>()
            .instances
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&label);
        if let Some(view) = app.get_webview(&label) {
            view.close().map_err(|e| e.to_string())?;
        }
        Ok(true)
    })
    .await
}

fn miniapp_window_label(view_key: &str) -> String {
    // Hex encoding is injective (unlike replacing all non-ASCII characters with '-').
    let key = view_key
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("miniapp-{key}")
}

fn clamp_view_bounds(bounds: ViewBounds) -> ViewBounds {
    const MAIN_CHROME_HEIGHT: f64 = 40.0;
    let x = bounds.x.max(0.0);
    let top = bounds.y.max(MAIN_CHROME_HEIGHT);
    let overflow = (MAIN_CHROME_HEIGHT - bounds.y).max(0.0);

    ViewBounds {
        x,
        y: top,
        width: bounds.width.max(1.0),
        height: (bounds.height - overflow).max(1.0),
    }
}

fn format_view_bounds(bounds: ViewBounds) -> String {
    format!(
        "x={:.0} y={:.0} width={:.0} height={:.0}",
        bounds.x, bounds.y, bounds.width, bounds.height
    )
}

fn text_has_auth_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "auth",
        "login",
        "signin",
        "sign-in",
        "oauth",
        "authorize",
        "sso",
        "account",
        "session",
        "callback",
        "identity",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

fn is_known_auth_provider_host(host: &str) -> bool {
    [
        "auth.openai.com",
        "accounts.google.com",
        "login.microsoftonline.com",
        "login.live.com",
        "appleid.apple.com",
        "github.com",
        "auth0.com",
        "okta.com",
    ]
    .iter()
    .any(|suffix| host_matches_suffix(host, suffix))
}

fn is_miniapp_auth_navigation(base_url: &Url, target_url: &Url) -> bool {
    let Some(target_host) = target_url.host_str().map(|host| host.to_ascii_lowercase()) else {
        return false;
    };
    let base_host = base_url.host_str().unwrap_or_default().to_ascii_lowercase();

    is_known_auth_provider_host(&target_host)
        || text_has_auth_marker(&target_host)
        || text_has_auth_marker(target_url.path())
        || (!base_host.is_empty()
            && text_has_auth_marker(&base_host)
            && host_matches_suffix(&target_host, base_host.trim_start_matches("auth.")))
}

fn should_keep_miniapp_navigation_inside(base_url: &Url, target_url: &Url) -> bool {
    if !is_external_web_url(target_url) {
        return true;
    }

    (base_url.scheme() == target_url.scheme()
        && base_url.host_str() == target_url.host_str()
        && base_url.port_or_known_default() == target_url.port_or_known_default())
        || is_miniapp_auth_navigation(base_url, target_url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_do_not_alias_unicode_or_punctuation() {
        let keys = ["中文", "网页", "a/b", "a-b", "a_b", "", "é", "e"];
        let labels = keys.map(miniapp_window_label);
        let unique: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(unique.len(), keys.len());
        assert!(labels
            .iter()
            .all(|s| s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')));
    }
    #[test]
    fn chrome_is_never_covered_and_bounds_stay_positive() {
        let bounds = clamp_view_bounds(ViewBounds {
            x: -4.0,
            y: 10.0,
            width: 0.0,
            height: 10.0,
        });
        assert_eq!(
            (bounds.x, bounds.y, bounds.width, bounds.height),
            (0.0, 40.0, 1.0, 1.0)
        );
    }
    #[test]
    fn same_origin_and_login_flows_stay_internal_other_sites_open_externally() {
        let base = Url::parse("https://example.com/app").unwrap();
        for url in [
            "https://example.com/path",
            "https://accounts.google.com/o/oauth2",
            "https://login.microsoftonline.com/common",
            "about:blank",
        ] {
            assert!(
                should_keep_miniapp_navigation_inside(&base, &Url::parse(url).unwrap()),
                "{url}"
            );
        }
        for url in [
            "https://elsewhere.example/news",
            "https://example.com:8443/news",
            "http://example.com/news",
        ] {
            assert!(
                !should_keep_miniapp_navigation_inside(&base, &Url::parse(url).unwrap()),
                "{url}"
            );
        }
    }
}
