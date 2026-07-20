use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use windows::core::Interface;
mod float_note_focus;
mod sync;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::{
    collections::hash_map::DefaultHasher,
    env,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(windows)]
use windows::Win32::Foundation::MAX_PATH;
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
#[cfg(windows)]
use windows::Win32::System::Com::{
    CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
};
#[cfg(windows)]
use windows::Win32::UI::Shell::{
    IShellLinkW, SHGetFileInfoW, ShellLink, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, DI_NORMAL,
    GWL_STYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_SYSMENU,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedNoteAsset {
    markdown_path: String,
    absolute_path: String,
    mime_type: String,
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
struct SystemAppEntry {
    id: String,
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_path: Option<String>,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_used_at: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ActivityEvent {
    id: String,
    kind: String,
    module: String,
    action: String,
    occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_label: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    metadata: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEventInput {
    #[serde(default)]
    kind: Option<String>,
    module: String,
    action: String,
    #[serde(default)]
    occurred_at: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    ended_at: Option<String>,
    #[serde(default)]
    target_type: Option<String>,
    #[serde(default)]
    target_id: Option<String>,
    #[serde(default)]
    target_label: Option<String>,
    #[serde(default)]
    metadata: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityDaySummary {
    date: String,
    count: u32,
    score: u32,
    module_counts: std::collections::BTreeMap<String, u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityTotals {
    total_events: u32,
    active_days: u32,
    current_streak_days: u32,
    module_counts: std::collections::BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_active_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityReport {
    start_date: String,
    end_date: String,
    days: Vec<ActivityDaySummary>,
    events: Vec<ActivityEvent>,
    totals: ActivityTotals,
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
    float_note_suspended_shortcut: Mutex<Option<String>>,
    float_note_is_pressed: Mutex<bool>,
    float_note_last_press: Mutex<Option<Instant>>,
    float_note_last_activation: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct SystemAppStore {
    cached_apps: Mutex<Option<Vec<SystemAppEntry>>>,
}

struct ResolvedSystemApp {
    id: String,
    name: String,
    path: String,
    target_path: Option<String>,
    icon_source_path: PathBuf,
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

fn system_app_id(path: &Path) -> String {
    format!(
        "system-app-{}",
        safe_storage_key(&path_to_string(path).to_lowercase())
    )
}

fn system_app_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Application")
        .trim()
        .to_string()
}

fn is_supported_system_app_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "lnk" | "exe" | "appref-ms" | "app"
            )
        })
        .unwrap_or(false)
}

fn utf16_buffer_to_string(buffer: &[u16]) -> Option<String> {
    let end = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    let value = String::from_utf16_lossy(&buffer[..end]).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn is_unwanted_system_app_entry(name: &str, target_path: Option<&str>) -> bool {
    let normalized_name = name.to_lowercase();
    let blocked_name_keywords = [
        "卸载",
        "uninstall",
        "remove ",
        "readme",
        "帮助",
        "help",
        "documentation",
        "文档",
        "license",
    ];
    if blocked_name_keywords
        .iter()
        .any(|keyword| normalized_name.contains(keyword))
    {
        return true;
    }

    if let Some(target_path) = target_path {
        let normalized_target = target_path.to_lowercase();
        let blocked_target_keywords = ["unins", "uninstall", "uninstaller", "remove.exe"];
        if blocked_target_keywords
            .iter()
            .any(|keyword| normalized_target.contains(keyword))
        {
            return true;
        }
    }

    false
}

fn resolve_system_app_entry(path: &Path) -> Option<ResolvedSystemApp> {
    let name = system_app_name(path);
    let mut target_path = None;
    let mut icon_source_path = path.to_path_buf();

    #[cfg(windows)]
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false)
    {
        if let Some(link) = resolve_windows_shell_link(path) {
            if let Some(icon_path) = link.icon_path.filter(|value| Path::new(value).exists()) {
                icon_source_path = PathBuf::from(icon_path);
            } else if let Some(target) = link
                .target_path
                .as_ref()
                .filter(|value| Path::new(value).exists())
            {
                icon_source_path = PathBuf::from(target);
            }
            target_path = link.target_path;
        }
    }

    if is_unwanted_system_app_entry(&name, target_path.as_deref()) {
        return None;
    }

    Some(ResolvedSystemApp {
        id: system_app_id(path),
        name,
        path: path_to_string(path),
        target_path,
        icon_source_path,
    })
}

#[cfg(windows)]
struct WindowsShellLinkInfo {
    target_path: Option<String>,
    icon_path: Option<String>,
}

#[cfg(windows)]
fn resolve_windows_shell_link(path: &Path) -> Option<WindowsShellLinkInfo> {
    unsafe {
        let shell_link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>();
        persist_file
            .Load(windows::core::PCWSTR(wide_path.as_ptr()), STGM_READ)
            .ok()?;

        let mut target_buffer = vec![0u16; MAX_PATH as usize];
        let target_path = shell_link
            .GetPath(&mut target_buffer, std::ptr::null_mut(), 0)
            .ok()
            .and_then(|_| utf16_buffer_to_string(&target_buffer));

        let mut icon_buffer = vec![0u16; MAX_PATH as usize];
        let mut icon_index = 0;
        let icon_path = shell_link
            .GetIconLocation(&mut icon_buffer, &mut icon_index)
            .ok()
            .and_then(|_| utf16_buffer_to_string(&icon_buffer));

        Some(WindowsShellLinkInfo {
            target_path,
            icon_path,
        })
    }
}

fn collect_system_apps_from_dir(app: &AppHandle, root: &Path, entries: &mut Vec<SystemAppEntry>) {
    if !root.exists() {
        return;
    }

    let Ok(items) = fs::read_dir(root) else {
        return;
    };

    for item in items.flatten() {
        let path = item.path();
        if path.is_dir() {
            collect_system_apps_from_dir(app, &path, entries);
            continue;
        }
        if !is_supported_system_app_path(&path) {
            continue;
        }

        let Some(resolved) = resolve_system_app_entry(&path) else {
            continue;
        };
        let (icon_path, icon) = resolve_system_app_icon(app, &resolved.icon_source_path);
        entries.push(SystemAppEntry {
            id: resolved.id,
            name: resolved.name,
            path: resolved.path,
            target_path: resolved.target_path,
            icon_path,
            source: "start-menu".to_string(),
            icon,
            last_used_at: None,
        });
    }
}

fn system_app_initials(name: &str) -> String {
    name.split(|ch: char| !ch.is_alphanumeric())
        .filter_map(|part| part.chars().next())
        .collect::<String>()
        .to_lowercase()
}

fn fuzzy_subsequence_score(text: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }

    let mut query_chars = query.chars();
    let mut current = query_chars.next()?;
    let mut gaps = 0usize;
    let mut started = false;

    for ch in text.chars() {
        if ch == current {
            started = true;
            if let Some(next) = query_chars.next() {
                current = next;
            } else {
                return Some(gaps);
            }
        } else if started {
            gaps += 1;
        }
    }

    None
}

fn system_app_search_score(entry: &SystemAppEntry, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(1000);
    }

    let name = entry.name.to_lowercase();
    let path = entry.path.to_lowercase();
    let target_path = entry.target_path.as_deref().unwrap_or("").to_lowercase();
    let initials = system_app_initials(&entry.name);

    if name == query {
        Some(0)
    } else if name.starts_with(query) {
        Some(10 + name.len().saturating_sub(query.len()))
    } else if initials.starts_with(query) {
        Some(28 + initials.len().saturating_sub(query.len()))
    } else if name
        .split(|ch: char| !ch.is_alphanumeric())
        .any(|part| part.starts_with(query))
    {
        Some(38)
    } else if name.contains(query) {
        Some(30 + name.find(query).unwrap_or(0))
    } else if path.contains(query) || target_path.contains(query) {
        Some(110)
    } else if let Some(gaps) = fuzzy_subsequence_score(&name, query) {
        Some(160 + gaps)
    } else {
        None
    }
}

fn scan_system_apps(app: &AppHandle) -> Vec<SystemAppEntry> {
    let mut entries = Vec::new();

    #[cfg(windows)]
    {
        if let Some(program_data) = env::var_os("PROGRAMDATA") {
            collect_system_apps_from_dir(
                app,
                &PathBuf::from(program_data)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs"),
                &mut entries,
            );
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            collect_system_apps_from_dir(
                app,
                &PathBuf::from(app_data)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs"),
                &mut entries,
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        collect_system_apps_from_dir(app, Path::new("/Applications"), &mut entries);
        if let Some(home) = dirs::home_dir() {
            collect_system_apps_from_dir(app, &home.join("Applications"), &mut entries);
        }
    }

    entries.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    entries.dedup_by(|left, right| {
        left.path.eq_ignore_ascii_case(&right.path)
            || (left.name.eq_ignore_ascii_case(&right.name)
                && left
                    .target_path
                    .as_deref()
                    .unwrap_or("")
                    .eq_ignore_ascii_case(right.target_path.as_deref().unwrap_or("")))
    });
    entries
}

fn get_cached_system_apps(app: &AppHandle) -> Vec<SystemAppEntry> {
    let store = app.state::<SystemAppStore>();
    if let Ok(mut cached_apps) = store.cached_apps.lock() {
        if let Some(apps) = cached_apps.as_ref() {
            return apps.clone();
        }
        let apps = scan_system_apps(app);
        *cached_apps = Some(apps.clone());
        return apps;
    }

    scan_system_apps(app)
}

fn recent_rank_map(recents: &[SystemAppEntry]) -> std::collections::HashMap<String, usize> {
    recents
        .iter()
        .enumerate()
        .map(|(index, entry)| (entry.path.to_lowercase(), index))
        .collect()
}

fn list_system_apps(app: &AppHandle, workspace_path: &str, query: &str) -> Vec<SystemAppEntry> {
    let normalized_query = query.trim().to_lowercase();
    let recents = read_system_app_recents(workspace_path);
    let recent_ranks = recent_rank_map(&recents);
    let apps = get_cached_system_apps(app);
    let mut entries = if normalized_query.is_empty() {
        let mut home_entries = recents
            .iter()
            .cloned()
            .filter(|entry| Path::new(&entry.path).exists() || entry.path.starts_with("uwp:"))
            .collect::<Vec<_>>();
        if home_entries.is_empty() {
            home_entries = apps.into_iter().take(12).collect();
        }
        home_entries
    } else {
        apps.into_iter()
            .filter(|entry| system_app_search_score(entry, &normalized_query).is_some())
            .collect::<Vec<_>>()
    };

    entries.sort_by(|left, right| {
        let left_recent_rank = recent_ranks.get(&left.path.to_lowercase()).copied();
        let right_recent_rank = recent_ranks.get(&right.path.to_lowercase()).copied();
        let left_score = system_app_search_score(left, &normalized_query).unwrap_or(usize::MAX)
            + left_recent_rank.map(|rank| rank * 2).unwrap_or(40);
        let right_score = system_app_search_score(right, &normalized_query).unwrap_or(usize::MAX)
            + right_recent_rank.map(|rank| rank * 2).unwrap_or(40);
        left_score
            .cmp(&right_score)
            .then_with(|| {
                left_recent_rank
                    .unwrap_or(usize::MAX)
                    .cmp(&right_recent_rank.unwrap_or(usize::MAX))
            })
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    entries
        .into_iter()
        .map(|mut entry| {
            if let Some(rank) = recent_ranks.get(&entry.path.to_lowercase()) {
                entry.source = "recent".to_string();
                entry.last_used_at = recents
                    .get(*rank)
                    .and_then(|recent| recent.last_used_at.clone());
            }
            entry
        })
        .take(24)
        .collect()
}

fn open_system_app_path(path: &str) -> Result<bool, String> {
    if path.trim().is_empty() {
        return Ok(false);
    }

    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|e| format!("failed to open system app: {e}"))?;
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("failed to open system app: {e}"))?;
        return Ok(true);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("failed to open system app: {e}"))?;
        return Ok(true);
    }
}

fn resolve_system_app_icon(_app: &AppHandle, _path: &Path) -> (Option<String>, Option<String>) {
    #[cfg(windows)]
    {
        resolve_windows_system_app_icon(_app, _path)
    }
    #[cfg(not(windows))]
    {
        (None, None)
    }
}

#[cfg(windows)]
fn resolve_windows_system_app_icon(
    app: &AppHandle,
    path: &Path,
) -> (Option<String>, Option<String>) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return (None, None);
    };
    let icon_dir = app_data_dir.join("system-app-icons");
    if fs::create_dir_all(&icon_dir).is_err() {
        return (None, None);
    }
    let icon_path = icon_dir.join(format!("v3-{}.png", system_app_id(path)));
    if !icon_path.exists() && save_windows_shell_icon_png(path, &icon_path, 64).is_err() {
        return (None, None);
    }

    let icon = fs::read(&icon_path).ok().map(|bytes| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    });
    (Some(path_to_string(&icon_path)), icon)
}

#[cfg(windows)]
fn save_windows_shell_icon_png(
    source_path: &Path,
    output_path: &Path,
    size: i32,
) -> Result<(), String> {
    let mut wide_path = source_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    if wide_path.len() > MAX_PATH as usize {
        wide_path = format!(r"\\?\{}", source_path.to_string_lossy())
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
    }

    let mut file_info = SHFILEINFOW::default();
    let info_size = std::mem::size_of::<SHFILEINFOW>() as u32;
    let result = unsafe {
        SHGetFileInfoW(
            windows::core::PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut file_info),
            info_size,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if result == 0 || file_info.hIcon.is_invalid() {
        return Err("failed to resolve shell icon".to_string());
    }

    let pixels = unsafe { hicon_to_rgba(file_info.hIcon, size)? };
    unsafe {
        let _ = DestroyIcon(file_info.hIcon);
    }

    let file = fs::File::create(output_path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(file, size as u32, size as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(&pixels).map_err(|e| e.to_string())
}

#[cfg(windows)]
unsafe fn hicon_to_rgba(
    icon: windows::Win32::UI::WindowsAndMessaging::HICON,
    size: i32,
) -> Result<Vec<u8>, String> {
    let screen_dc = GetDC(None);
    if screen_dc.is_invalid() {
        return Err("failed to get screen dc".to_string());
    }

    let memory_dc = CreateCompatibleDC(Some(screen_dc));
    if memory_dc.is_invalid() {
        let _ = ReleaseDC(None, screen_dc);
        return Err("failed to create compatible dc".to_string());
    }

    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits_ptr = std::ptr::null_mut();
    let bitmap: HBITMAP = CreateDIBSection(
        Some(HDC::default()),
        &bitmap_info,
        DIB_RGB_COLORS,
        &mut bits_ptr,
        None,
        0,
    )
    .map_err(|e| e.to_string())?;
    if bitmap.is_invalid() || bits_ptr.is_null() {
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);
        return Err("failed to create icon bitmap".to_string());
    }

    let old_object: HGDIOBJ = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
    let drawn = DrawIconEx(memory_dc, 0, 0, icon, size, size, 0, None, DI_NORMAL);
    let byte_len = (size * size * 4) as usize;
    let bgra = std::slice::from_raw_parts(bits_ptr as *const u8, byte_len);
    let mut rgba = Vec::with_capacity(byte_len);
    for pixel in bgra.chunks_exact(4) {
        rgba.push(pixel[2]);
        rgba.push(pixel[1]);
        rgba.push(pixel[0]);
        rgba.push(pixel[3]);
    }

    let _ = SelectObject(memory_dc, old_object);
    let _ = DeleteObject(HGDIOBJ(bitmap.0));
    let _ = DeleteDC(memory_dc);
    let _ = ReleaseDC(None, screen_dc);

    if drawn.is_ok() {
        Ok(rgba)
    } else {
        Err("failed to draw shell icon".to_string())
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

fn read_note_tree(
    dir_path: &Path,
    root_path: &Path,
    hide_attachment_dirs: bool,
) -> Result<Vec<NoteTreeNode>, String> {
    let mut entries = fs::read_dir(dir_path)
        .map_err(|e| format!("failed to read notes directory: {e}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

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
        .filter(|entry| {
            !(hide_attachment_dirs && entry.path().is_dir() && entry.file_name() == "assets")
        })
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
                    children: Some(read_note_tree(&full_path, root_path, hide_attachment_dirs)?),
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
        if entry.file_name() == "assets" {
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

fn get_system_app_recents_file(workspace_path: &str) -> Result<PathBuf, String> {
    let app_data_path = Path::new(workspace_path).join(".onemind");
    fs::create_dir_all(&app_data_path).map_err(|e| e.to_string())?;
    Ok(app_data_path.join("system-app-recents.json"))
}

fn read_system_app_recents(workspace_path: &str) -> Vec<SystemAppEntry> {
    let Ok(file_path) = get_system_app_recents_file(workspace_path) else {
        return Vec::new();
    };
    let raw = fs::read_to_string(file_path).unwrap_or_else(|_| "[]".to_string());
    let mut recents = serde_json::from_str::<Vec<SystemAppEntry>>(&raw).unwrap_or_default();
    recents.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    recents.truncate(12);
    recents
}

fn write_system_app_recents(
    workspace_path: &str,
    recents: &[SystemAppEntry],
) -> Result<(), String> {
    let file_path = get_system_app_recents_file(workspace_path)?;
    fs::write(
        file_path,
        serde_json::to_string_pretty(recents).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn record_system_app_recent(
    workspace_path: &str,
    app_entry: &SystemAppEntry,
) -> Result<(), String> {
    let mut recents = read_system_app_recents(workspace_path);
    let mut next_entry = app_entry.clone();
    next_entry.source = "recent".to_string();
    next_entry.last_used_at = Some(now_iso_like());
    recents.retain(|entry| {
        !entry.path.eq_ignore_ascii_case(&next_entry.path)
            && !entry.name.eq_ignore_ascii_case(&next_entry.name)
    });
    recents.insert(0, next_entry);
    recents.truncate(12);
    write_system_app_recents(workspace_path, &recents)
}

fn get_activity_dir(workspace_path: &str) -> Result<PathBuf, String> {
    let activity_dir = Path::new(workspace_path).join(".onemind").join("activity");
    fs::create_dir_all(&activity_dir).map_err(|e| e.to_string())?;
    Ok(activity_dir)
}

fn activity_month_from_timestamp(value: &str) -> String {
    value.get(0..7).unwrap_or("unknown").to_string()
}

fn activity_date_from_timestamp(value: &str) -> Option<String> {
    value.get(0..10).map(|date| date.to_string())
}

fn normalize_activity_event(input: ActivityEventInput, index: usize) -> ActivityEvent {
    let occurred_at = input.occurred_at.unwrap_or_else(now_iso_like);
    ActivityEvent {
        id: format!("activity-{}-{}", now_id(), index),
        kind: input.kind.unwrap_or_else(|| "instant".to_string()),
        module: input.module,
        action: input.action,
        occurred_at,
        started_at: input.started_at,
        ended_at: input.ended_at,
        target_type: input.target_type,
        target_id: input.target_id,
        target_label: input.target_label,
        metadata: input.metadata,
    }
}

fn append_activity_events_file(
    workspace_path: &str,
    events: Vec<ActivityEvent>,
) -> Result<usize, String> {
    if events.is_empty() {
        return Ok(0);
    }

    let activity_dir = get_activity_dir(workspace_path)?;
    let mut events_by_month: std::collections::BTreeMap<String, Vec<ActivityEvent>> =
        std::collections::BTreeMap::new();
    for event in events {
        events_by_month
            .entry(activity_month_from_timestamp(&event.occurred_at))
            .or_default()
            .push(event);
    }

    let mut written = 0usize;
    for (month, month_events) in events_by_month {
        let file_path = activity_dir.join(format!("events-{month}.jsonl"));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)
            .map_err(|e| e.to_string())?;
        for event in month_events {
            let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
            file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            file.write_all(b"\n").map_err(|e| e.to_string())?;
            written += 1;
        }
    }

    Ok(written)
}

fn activity_event_score(event: &ActivityEvent) -> u32 {
    if event.kind == "session" {
        let count = event
            .metadata
            .get("eventCount")
            .and_then(|value| value.as_u64())
            .unwrap_or(1);
        return 1 + (count.min(4) as u32);
    }
    1
}

fn read_activity_events_in_range(
    workspace_path: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<ActivityEvent>, String> {
    let activity_dir = get_activity_dir(workspace_path)?;
    let mut events = Vec::new();
    let Ok(entries) = fs::read_dir(activity_dir) else {
        return Ok(events);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| name.starts_with("events-") && name.ends_with(".jsonl"))
            .unwrap_or(false)
        {
            continue;
        }

        let Ok(file) = fs::File::open(path) else {
            continue;
        };
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<ActivityEvent>(&line) else {
                continue;
            };
            let Some(date) = activity_date_from_timestamp(&event.occurred_at) else {
                continue;
            };
            if date.as_str() >= start_date && date.as_str() <= end_date {
                events.push(event);
            }
        }
    }

    events.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    Ok(events)
}

fn build_activity_report(
    workspace_path: &str,
    start_date: &str,
    end_date: &str,
) -> Result<ActivityReport, String> {
    let events = read_activity_events_in_range(workspace_path, start_date, end_date)?;
    let mut days: std::collections::BTreeMap<String, ActivityDaySummary> =
        std::collections::BTreeMap::new();
    let mut module_counts = std::collections::BTreeMap::<String, u32>::new();
    let mut last_active_at = None;

    for event in &events {
        let Some(date) = activity_date_from_timestamp(&event.occurred_at) else {
            continue;
        };
        let score = activity_event_score(event);
        let day = days
            .entry(date.clone())
            .or_insert_with(|| ActivityDaySummary {
                date,
                count: 0,
                score: 0,
                module_counts: std::collections::BTreeMap::new(),
            });
        day.count += 1;
        day.score += score;
        *day.module_counts.entry(event.module.clone()).or_insert(0) += 1;
        *module_counts.entry(event.module.clone()).or_insert(0) += 1;
        last_active_at = Some(event.occurred_at.clone());
    }

    let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d").ok();
    let mut streak = 0u32;
    if let Some(mut cursor) = end {
        loop {
            let key = cursor.format("%Y-%m-%d").to_string();
            if !days.contains_key(&key) {
                break;
            }
            streak += 1;
            let Some(previous) = cursor.pred_opt() else {
                break;
            };
            cursor = previous;
        }
    }

    let totals = ActivityTotals {
        total_events: events.len() as u32,
        active_days: days.len() as u32,
        current_streak_days: streak,
        module_counts,
        last_active_at,
    };

    Ok(ActivityReport {
        start_date: start_date.to_string(),
        end_date: end_date.to_string(),
        days: days.into_values().collect(),
        events,
        totals,
    })
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
    let fallback_icon = resolve_miniapp_icon_url(&item.url);
    MiniappSource {
        created_at: normalize_timestamp(item.created_at),
        icon: item.icon.or(fallback_icon),
        ..item
    }
}

fn resolve_miniapp_icon_url(url: &str) -> Option<String> {
    let without_scheme = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .trim();
    let host = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('/');
    if host.is_empty() {
        return None;
    }
    Some(format!(
        "https://www.google.com/s2/favicons?domain={host}&sz=64"
    ))
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
            request_float_note_renderer_focus(
                &focus_window.app_handle(),
                &focus_window,
                "window_event",
            );
        } else if matches!(event, WindowEvent::Focused(false)) {
            let app_handle = focus_window.app_handle().clone();
            let blur_window = focus_window.clone();
            append_debug_log(
                &app_handle,
                "float_note_window_event_focused",
                Some("focused=false"),
            );
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_millis(
                    FLOAT_NOTE_BLUR_HIDE_DELAY_MS,
                ));
                append_float_note_window_snapshot(&app_handle, &blur_window, "blur_delayed");
                if !blur_window.is_visible().unwrap_or(false) {
                    append_debug_log(
                        &app_handle,
                        "float_note_hide_ignored",
                        Some("source=blur reason=hidden"),
                    );
                    return;
                }
                if is_float_note_recently_activated(&app_handle) {
                    append_debug_log(
                        &app_handle,
                        "float_note_hide_ignored",
                        Some("source=blur reason=activation_grace"),
                    );
                    return;
                }
                if blur_window.is_focused().unwrap_or(false) {
                    append_debug_log(
                        &app_handle,
                        "float_note_hide_ignored",
                        Some("source=blur reason=refocused"),
                    );
                    return;
                }
                if is_cursor_inside_window(&app_handle, &blur_window).unwrap_or(false) {
                    append_debug_log(
                        &app_handle,
                        "float_note_hide_ignored",
                        Some("source=blur reason=cursor_inside"),
                    );
                    mark_float_note_activation(&app_handle, "blur_cursor_inside");
                    let _ = blur_window.set_focus();
                    activate_float_note_window_native(
                        &app_handle,
                        &blur_window,
                        "blur_cursor_inside",
                    );
                    request_float_note_renderer_focus(
                        &app_handle,
                        &blur_window,
                        "blur_cursor_inside",
                    );
                    focus_float_note_input(&app_handle, &blur_window, "blur_cursor_inside");
                    return;
                }
                let _ = hide_float_note_window(&app_handle, &blur_window, "blur_outside");
            });
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
    match float_note_focus::activate_window(window) {
        Ok(report) => {
            let child_context = match report.child_focus.result {
                Some(result) => format!(
                    "source={source} result={result} target_thread={} attached_target={} children={}",
                    report.child_focus.target_thread.unwrap_or(0),
                    report.child_focus.attached_target.unwrap_or(false),
                    report.child_focus.children
                ),
                None => format!(
                    "source={source} result=missing children={}",
                    report.child_focus.children
                ),
            };
            append_debug_log(app, "float_note_webview_child_focus", Some(&child_context));
            append_debug_log(
                app,
                "float_note_native_activate",
                Some(&format!(
                    "source={source} foreground={foreground_result} focus={focus_result} child_focus={child_focus_result} foreground_match={} current_thread={} foreground_thread={} window_thread={} attached_foreground={} attached_window={}",
                    report.foreground_match,
                    report.current_thread,
                    report.foreground_thread,
                    report.window_thread,
                    report.attached_foreground,
                    report.attached_window,
                    foreground_result = report.foreground_result,
                    focus_result = report.focus_result,
                    child_focus_result = report.child_focus_result
                )),
            );
        }
        Err(error) => append_debug_log(
            app,
            "float_note_native_activate",
            Some(&format!("source={source} result=err error={error}")),
        ),
    }
}

#[cfg(not(windows))]
fn activate_float_note_window_native(_app: &AppHandle, _window: &WebviewWindow, _source: &str) {}

#[cfg(windows)]
fn set_window_system_menu_enabled_native(
    window: &WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let system_menu_style = WS_SYSMENU.0 as isize;
        let next_style = if enabled {
            style | system_menu_style
        } else {
            style & !system_menu_style
        };
        if next_style == style {
            return Ok(());
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, next_style);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_window_system_menu_enabled_native(
    _window: &WebviewWindow,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
}

const FLOAT_NOTE_WIDTH: f64 = 724.0;
const FLOAT_NOTE_MIN_HEIGHT: f64 = 150.0;
const FLOAT_NOTE_SCREEN_MARGIN: f64 = 24.0;
const FLOAT_NOTE_BLUR_HIDE_DELAY_MS: u64 = 180;
const FLOAT_NOTE_ACTIVATION_GRACE_MS: u64 = 700;
const FLOAT_NOTE_FIRST_FOCUS_RETRY_MS: u64 = 120;
const FLOAT_NOTE_SECOND_FOCUS_RETRY_GAP_MS: u64 = 200;

fn hide_float_note_window(
    app: &AppHandle,
    window: &WebviewWindow,
    source: &str,
) -> Result<(), String> {
    append_debug_log(
        app,
        "float_note_hide_start",
        Some(&format!("source={source}")),
    );
    window.hide().map_err(|e| e.to_string())?;
    append_debug_log(
        app,
        "float_note_hide_done",
        Some(&format!("source={source}")),
    );
    Ok(())
}

fn mark_float_note_activation(app: &AppHandle, source: &str) {
    let state = app.state::<ShortcutStateStore>();
    if let Ok(mut last_activation) = state.float_note_last_activation.lock() {
        *last_activation = Some(Instant::now());
    }
    append_debug_log(
        app,
        "float_note_activation_marked",
        Some(&format!("source={source}")),
    );
}

fn is_float_note_recently_activated(app: &AppHandle) -> bool {
    let state = app.state::<ShortcutStateStore>();
    state
        .float_note_last_activation
        .lock()
        .ok()
        .and_then(|last_activation| *last_activation)
        .map(|last| last.elapsed() < Duration::from_millis(FLOAT_NOTE_ACTIVATION_GRACE_MS))
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_float_note_window_active(window: &WebviewWindow) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    if window.is_focused().unwrap_or(false) {
        return true;
    }
    float_note_focus::is_window_foreground(window).unwrap_or(false)
}

#[cfg(not(windows))]
fn is_float_note_window_active(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
}

fn is_cursor_inside_window(app: &AppHandle, window: &WebviewWindow) -> Option<bool> {
    let cursor = app.cursor_position().ok()?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let left = position.x as f64;
    let top = position.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;
    Some(cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom)
}

fn float_note_window_snapshot(app: &AppHandle, window: &WebviewWindow, source: &str) -> String {
    let cursor = app
        .cursor_position()
        .ok()
        .map(|point| format!("{},{}", point.x.round(), point.y.round()))
        .unwrap_or_else(|| "unknown".to_string());
    let position = window
        .outer_position()
        .ok()
        .map(|point| format!("{},{}", point.x, point.y))
        .unwrap_or_else(|| "unknown".to_string());
    let size = window
        .outer_size()
        .ok()
        .map(|size| format!("{}x{}", size.width, size.height))
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "source={source} visible={} focused={} cursor={} bounds={} size={} cursor_inside={}",
        window.is_visible().unwrap_or(false),
        window.is_focused().unwrap_or(false),
        cursor,
        position,
        size,
        is_cursor_inside_window(app, window)
            .map(|inside| inside.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    )
}

fn append_float_note_window_snapshot(app: &AppHandle, window: &WebviewWindow, source: &str) {
    append_debug_log(
        app,
        "float_note_window_snapshot",
        Some(&float_note_window_snapshot(app, window, source)),
    );
}

fn request_float_note_renderer_focus(app: &AppHandle, window: &WebviewWindow, source: &str) {
    let _ = window.emit("float-note-focus-ready", ());
    append_debug_log(
        app,
        "float_note_emit_focus_ready",
        Some(&format!("source={source}")),
    );
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

fn show_float_note_window(app: &AppHandle) -> Result<bool, String> {
    append_debug_log(app, "float_note_show_start", None);
    let window = ensure_float_note_window(app)?;
    append_float_note_window_snapshot(app, &window, "show_before");
    let _ = window.set_size(LogicalSize::new(FLOAT_NOTE_WIDTH, FLOAT_NOTE_MIN_HEIGHT));
    position_float_note_window(app, &window, FLOAT_NOTE_MIN_HEIGHT, true, "show");

    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    append_debug_log(app, "float_note_show_done", None);
    mark_float_note_activation(app, "show");
    let _ = window.set_always_on_top(true);
    window.set_focus().map_err(|e| e.to_string())?;
    append_debug_log(app, "float_note_set_focus_done", Some("source=show"));
    activate_float_note_window_native(app, &window, "show");
    append_float_note_window_snapshot(app, &window, "show_after_activate");
    let _ = window.emit("float-note-shown", ());
    append_debug_log(app, "float_note_emit_shown", None);
    request_float_note_renderer_focus(app, &window, "show");
    focus_float_note_input(app, &window, "show");
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(std::time::Duration::from_millis(
            FLOAT_NOTE_FIRST_FOCUS_RETRY_MS,
        ));
        if let Some(window) = app_handle.get_webview_window("float-note") {
            append_float_note_window_snapshot(&app_handle, &window, "delayed_120ms_before");
            if !window.is_visible().unwrap_or(false) {
                append_debug_log(
                    &app_handle,
                    "float_note_delayed_focus_skipped",
                    Some("source=delayed_120ms reason=hidden"),
                );
                return;
            }
            if is_float_note_window_active(&window) {
                append_debug_log(
                    &app_handle,
                    "float_note_delayed_focus_skipped",
                    Some("source=delayed_120ms reason=active"),
                );
                return;
            }
            mark_float_note_activation(&app_handle, "delayed_120ms");
            let _ = window.set_focus();
            append_debug_log(
                &app_handle,
                "float_note_set_focus_done",
                Some("source=delayed_120ms"),
            );
            activate_float_note_window_native(&app_handle, &window, "delayed_120ms");
            request_float_note_renderer_focus(&app_handle, &window, "delayed_120ms");
            focus_float_note_input(&app_handle, &window, "delayed_120ms");
            append_float_note_window_snapshot(&app_handle, &window, "delayed_120ms_after");
        }
        std::thread::sleep(std::time::Duration::from_millis(
            FLOAT_NOTE_SECOND_FOCUS_RETRY_GAP_MS,
        ));
        if let Some(window) = app_handle.get_webview_window("float-note") {
            append_float_note_window_snapshot(&app_handle, &window, "delayed_320ms_before");
            if !window.is_visible().unwrap_or(false) {
                append_debug_log(
                    &app_handle,
                    "float_note_delayed_focus_skipped",
                    Some("source=delayed_320ms reason=hidden"),
                );
                return;
            }
            if is_float_note_window_active(&window) {
                append_debug_log(
                    &app_handle,
                    "float_note_delayed_focus_skipped",
                    Some("source=delayed_320ms reason=active"),
                );
                return;
            }
            mark_float_note_activation(&app_handle, "delayed_320ms");
            let _ = window.set_focus();
            append_debug_log(
                &app_handle,
                "float_note_set_focus_done",
                Some("source=delayed_320ms"),
            );
            activate_float_note_window_native(&app_handle, &window, "delayed_320ms");
            focus_float_note_input(&app_handle, &window, "delayed_320ms");
            append_float_note_window_snapshot(&app_handle, &window, "delayed_320ms_after");
        }
    });
    Ok(true)
}

fn toggle_float_note_window(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("float-note") {
        append_float_note_window_snapshot(app, &window, "toggle");
        if is_float_note_window_active(&window) {
            hide_float_note_window(app, &window, "toggle")?;
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
        *is_pressed = true;
    }

    if let Ok(mut last_press) = shortcut_state.float_note_last_press.lock() {
        let now = Instant::now();
        if last_press
            .map(|last| now.duration_since(last) < Duration::from_millis(220))
            .unwrap_or(false)
        {
            append_debug_log(app, "float_note_shortcut_ignored", Some("reason=debounce"));
            return;
        }
        *last_press = Some(now);
    }

    if let Some(window) = app.get_webview_window("float-note") {
        append_float_note_window_snapshot(app, &window, "shortcut_pressed");
        if is_float_note_window_active(&window) {
            let _ = hide_float_note_window(app, &window, "shortcut");
            return;
        }
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
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

fn register_float_note_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            handle_float_note_shortcut(app, event.state());
        })
        .map_err(|err| {
            append_global_log("shortcut", "register_failed", Some(&err.to_string()));
            err.to_string()
        })
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

fn is_external_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
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

fn open_external_web_url(url: &Url) -> Result<bool, String> {
    if !is_external_web_url(url) {
        return Ok(false);
    }

    #[cfg(windows)]
    {
        Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(url.as_str())
            .spawn()
            .map_err(|e| format!("failed to open external url: {e}"))?;
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url.as_str())
            .spawn()
            .map_err(|e| format!("failed to open external url: {e}"))?;
        return Ok(true);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url.as_str())
            .spawn()
            .map_err(|e| format!("failed to open external url: {e}"))?;
        return Ok(true);
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
    read_note_tree(&notes_path, &notes_path, true)
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

const MAX_NOTE_IMAGE_BYTES: usize = 20 * 1024 * 1024;

fn image_format(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if bytes.len() >= 16
        && &bytes[4..8] == b"ftyp"
        && bytes[8..]
            .chunks(4)
            .take(5)
            .any(|brand| brand == b"avif" || brand == b"avis")
    {
        Some(("avif", "image/avif"))
    } else {
        None
    }
}

fn note_asset_bucket(note_path: &Path) -> String {
    let stem = note_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("note");
    let mut bucket = stem
        .chars()
        .take(64)
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if bucket.trim_matches('_').is_empty() {
        bucket = "note".to_string();
    }
    bucket
}

fn decode_note_image(data_base64: &str) -> Result<Vec<u8>, String> {
    let encoded = data_base64
        .split_once(',')
        .filter(|(prefix, _)| prefix.starts_with("data:") && prefix.ends_with(";base64"))
        .map(|(_, payload)| payload)
        .unwrap_or(data_base64);
    let max_encoded_len = MAX_NOTE_IMAGE_BYTES.div_ceil(3) * 4 + 4;
    if encoded.len() > max_encoded_len {
        return Err("Image exceeds the 20 MB size limit.".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Image data is not valid base64.".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_NOTE_IMAGE_BYTES {
        return Err("Image is empty or exceeds the 20 MB size limit.".to_string());
    }
    Ok(bytes)
}

fn canonical_notes_root(workspace_path: &str) -> Result<PathBuf, String> {
    let notes = Path::new(workspace_path).join("notes");
    fs::create_dir_all(&notes).map_err(|e| e.to_string())?;
    fs::canonicalize(notes).map_err(|e| e.to_string())
}

fn validate_note_file(note_path: &Path, notes_root: &Path) -> Result<PathBuf, String> {
    let resolved = fs::canonicalize(note_path).map_err(|e| e.to_string())?;
    if !resolved.starts_with(notes_root)
        || !resolved.is_file()
        || resolved
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
    {
        return Err("Note must be a Markdown file inside the notes workspace.".to_string());
    }
    Ok(resolved)
}

fn create_workspace_dir(path: &Path, notes_root: &Path) -> Result<PathBuf, String> {
    let relative = path
        .strip_prefix(notes_root)
        .map_err(|_| "Directory is outside the notes workspace.".to_string())?;
    let mut current = notes_root.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::CurDir => continue,
            std::path::Component::Normal(name) => current.push(name),
            _ => return Err("Directory is outside the notes workspace.".to_string()),
        }
        if !current.exists() {
            fs::create_dir(&current).map_err(|e| e.to_string())?;
        }
        current = fs::canonicalize(&current).map_err(|e| e.to_string())?;
        if !current.starts_with(notes_root) || !current.is_dir() {
            return Err("Directory is outside the notes workspace.".to_string());
        }
    }
    Ok(current)
}

fn local_markdown_path(path: &str) -> Option<PathBuf> {
    let path = path.trim();
    if path.is_empty()
        || path.contains('\\')
        || path.starts_with('/')
        || path.starts_with('#')
        || path.contains("://")
        || path.starts_with("data:")
        || path.starts_with("file:")
        || path.starts_with("blob:")
        || path.contains('?')
        || path.contains('#')
    {
        return None;
    }
    let candidate = PathBuf::from(path);
    if candidate.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    Some(candidate)
}

fn markdown_image_paths(markdown: &str) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let mut rest = markdown;
    while let Some(image_start) = rest.find("![") {
        rest = &rest[image_start + 2..];
        let Some(label_end) = rest.find("](") else {
            continue;
        };
        rest = &rest[label_end + 2..];
        let Some(destination_end) = rest.find(')') else {
            break;
        };
        let raw = rest[..destination_end].trim();
        rest = &rest[destination_end + 1..];
        let destination = if raw.starts_with('<') && raw.ends_with('>') {
            &raw[1..raw.len() - 1]
        } else {
            raw.split_whitespace().next().unwrap_or("")
        };
        if let Some(path) = local_markdown_path(destination) {
            if !result.contains(&path) {
                result.push(path);
            }
        }
    }
    result
}

fn remove_created_files(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = fs::remove_file(path);
    }
}

fn copy_attachment(source: &Path, destination: &Path) -> Result<bool, String> {
    if destination.exists() {
        let source_bytes = fs::read(source).map_err(|e| e.to_string())?;
        let destination_bytes = fs::read(destination).map_err(|e| e.to_string())?;
        if source_bytes == destination_bytes {
            return Ok(false);
        }
        return Err(format!(
            "Attachment already exists with different content: {}",
            path_to_string(destination)
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Attachment destination has no parent.".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| e.to_string())?;
    if let Err(error) = io::copy(&mut input, &mut output) {
        drop(output);
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(true)
}

fn markdown_files_under(dir: &Path, result: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            markdown_files_under(&path, result);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            result.push(path);
        }
    }
}

fn attachment_is_referenced(attachment: &Path, notes_root: &Path) -> bool {
    let Ok(attachment) = fs::canonicalize(attachment) else {
        return false;
    };
    let mut notes = Vec::new();
    markdown_files_under(notes_root, &mut notes);
    notes.into_iter().any(|note| {
        let Ok(markdown) = fs::read_to_string(&note) else {
            return false;
        };
        let Some(parent) = note.parent() else {
            return false;
        };
        markdown_image_paths(&markdown).into_iter().any(|relative| {
            fs::canonicalize(parent.join(relative)).is_ok_and(|candidate| candidate == attachment)
        })
    })
}

#[tauri::command]
fn notes_save_pasted_image(
    workspace_path: String,
    note_path: String,
    mime_type: String,
    data_base64: String,
) -> Result<SavedNoteAsset, String> {
    let notes_root = canonical_notes_root(&workspace_path)?;
    let note = validate_note_file(Path::new(&note_path), &notes_root)?;
    let bytes = decode_note_image(&data_base64)?;
    let (extension, detected_mime) =
        image_format(&bytes).ok_or_else(|| "Unsupported or invalid image format.".to_string())?;
    if !mime_type.is_empty() && mime_type != detected_mime {
        return Err("Image MIME type does not match its file signature.".to_string());
    }

    let bucket = note_asset_bucket(&note);
    let asset_dir = note
        .parent()
        .ok_or_else(|| "Note has no parent directory.".to_string())?
        .join("assets")
        .join(&bucket);
    let resolved_asset_dir = create_workspace_dir(&asset_dir, &notes_root)?;

    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let hash = hasher.finish();
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut saved_path = None;
    for suffix in 0..100u8 {
        let suffix = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let file_name = format!("img-{timestamp}-{hash:08x}{suffix}.{extension}");
        let candidate = resolved_asset_dir.join(file_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(&bytes) {
                    drop(file);
                    let _ = fs::remove_file(&candidate);
                    return Err(error.to_string());
                }
                saved_path = Some(candidate);
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    let saved_path =
        saved_path.ok_or_else(|| "Could not allocate an image filename.".to_string())?;
    let file_name = saved_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Saved image filename is invalid.".to_string())?;
    Ok(SavedNoteAsset {
        markdown_path: format!("./assets/{bucket}/{file_name}"),
        absolute_path: path_to_string(&saved_path),
        mime_type: detected_mime.to_string(),
    })
}

#[tauri::command]
fn notes_resolve_image(
    workspace_path: String,
    note_path: String,
    markdown_path: String,
) -> Result<String, String> {
    let notes_root = canonical_notes_root(&workspace_path)?;
    let note = validate_note_file(Path::new(&note_path), &notes_root)?;
    let relative = local_markdown_path(&markdown_path)
        .ok_or_else(|| "Image path must be a safe relative path.".to_string())?;
    let image = note
        .parent()
        .ok_or_else(|| "Note has no parent directory.".to_string())?
        .join(relative);
    let resolved = fs::canonicalize(image).map_err(|e| e.to_string())?;
    if !resolved.starts_with(&notes_root) || !resolved.is_file() {
        return Err("Image is outside the notes workspace or is not a file.".to_string());
    }
    let bytes = fs::read(&resolved).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_NOTE_IMAGE_BYTES {
        return Err("Image exceeds the 20 MB size limit.".to_string());
    }
    let (_, mime) =
        image_format(&bytes).ok_or_else(|| "Unsupported or invalid image format.".to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn validate_image_base_name(value: &str) -> Result<&str, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("图片名称不能为空。".to_string());
    }
    if name.chars().count() > 120 {
        return Err("图片名称不能超过 120 个字符。".to_string());
    }
    if name == "."
        || name == ".."
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err("图片名称包含无效字符。".to_string());
    }

    let device_name = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let is_reserved = matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device_name.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || device_name.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if is_reserved {
        return Err("该图片名称是系统保留名称。".to_string());
    }

    Ok(name)
}

#[tauri::command]
fn notes_rename_image(
    workspace_path: String,
    note_path: String,
    markdown_path: String,
    new_name: String,
) -> Result<String, String> {
    let notes_root = canonical_notes_root(&workspace_path)?;
    let note = validate_note_file(Path::new(&note_path), &notes_root)?;
    let relative = local_markdown_path(&markdown_path)
        .ok_or_else(|| "图片路径必须是安全的相对路径。".to_string())?;
    let components = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value),
            std::path::Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>();
    if components.len() != 3 || components[0] != "assets" {
        return Err("只能重命名当前笔记 assets 目录中的图片。".to_string());
    }

    let note_parent = note
        .parent()
        .ok_or_else(|| "笔记没有父目录。".to_string())?;
    let assets_root = fs::canonicalize(note_parent.join("assets"))
        .map_err(|_| "图片 assets 目录不存在。".to_string())?;
    if !assets_root.starts_with(&notes_root) || !assets_root.is_dir() {
        return Err("图片 assets 目录不在笔记工作区内。".to_string());
    }

    let source = fs::canonicalize(note_parent.join(&relative))
        .map_err(|_| "找不到需要重命名的图片。".to_string())?;
    if !source.starts_with(&assets_root)
        || !source.is_file()
        || source.parent().and_then(Path::parent) != Some(assets_root.as_path())
    {
        return Err("只能重命名当前笔记直接管理的图片。".to_string());
    }
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_NOTE_IMAGE_BYTES || image_format(&bytes).is_none() {
        return Err("目标文件不是受支持的图片。".to_string());
    }

    let base_name = validate_image_base_name(&new_name)?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "图片扩展名无效。".to_string())?;
    let target_file_name = format!("{base_name}.{extension}");
    if source.file_name().and_then(|value| value.to_str()) == Some(target_file_name.as_str()) {
        return Ok(markdown_path);
    }

    let target = source
        .parent()
        .ok_or_else(|| "图片没有父目录。".to_string())?
        .join(&target_file_name);
    if target.exists() {
        return Err("同名图片已经存在。".to_string());
    }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;

    let bucket = source
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .ok_or_else(|| "图片目录名称无效。".to_string())?;
    Ok(format!("./assets/{bucket}/{target_file_name}"))
}

#[tauri::command]
fn notes_move(
    old_path: String,
    workspace_path: String,
    relative_dir: String,
) -> Result<String, String> {
    let resolved_notes = canonical_notes_root(&workspace_path)?;
    let relative_target = local_markdown_path(&relative_dir)
        .or_else(|| relative_dir.trim().is_empty().then(PathBuf::new))
        .ok_or_else(|| "Target directory must be inside the notes workspace.".to_string())?;
    let target_dir = resolved_notes.join(relative_target);
    let resolved_target_dir = create_workspace_dir(&target_dir, &resolved_notes)?;

    let old_path_buf = fs::canonicalize(&old_path).map_err(|e| e.to_string())?;
    if !old_path_buf.starts_with(&resolved_notes) || old_path_buf == resolved_notes {
        return Err("Source is outside the notes workspace.".to_string());
    }
    let target_path = resolved_target_dir.join(
        old_path_buf
            .file_name()
            .ok_or_else(|| "target has no file name".to_string())?,
    );

    if old_path_buf == target_path {
        return Ok(old_path);
    }

    if target_path.exists() {
        return Err(
            "A file or directory with the same name already exists at the destination.".to_string(),
        );
    }

    if old_path_buf.is_dir()
        || old_path_buf
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
    {
        fs::rename(&old_path_buf, &target_path).map_err(|e| e.to_string())?;
        return Ok(path_to_string(&target_path));
    }

    let markdown = fs::read_to_string(&old_path_buf).map_err(|e| e.to_string())?;
    let old_parent = old_path_buf
        .parent()
        .ok_or_else(|| "Source note has no parent directory.".to_string())?;
    let mut attachments = Vec::new();
    for relative in markdown_image_paths(&markdown) {
        let source = old_parent.join(&relative);
        let Ok(resolved_source) = fs::canonicalize(&source) else {
            continue;
        };
        if !resolved_source.starts_with(&resolved_notes) || !resolved_source.is_file() {
            continue;
        }
        let Ok(source_bytes) = fs::read(&resolved_source) else {
            continue;
        };
        if source_bytes.len() > MAX_NOTE_IMAGE_BYTES || image_format(&source_bytes).is_none() {
            continue;
        }
        let destination = resolved_target_dir.join(&relative);
        attachments.push((resolved_source, destination));
    }

    let mut created = Vec::new();
    for (source, destination) in &attachments {
        let destination_parent = destination
            .parent()
            .ok_or_else(|| "Attachment destination has no parent.".to_string())?;
        let resolved_destination_parent =
            match create_workspace_dir(destination_parent, &resolved_notes) {
                Ok(parent) => parent,
                Err(error) => {
                    remove_created_files(&created);
                    return Err(error);
                }
            };
        let safe_destination = resolved_destination_parent.join(
            destination
                .file_name()
                .ok_or_else(|| "Attachment destination has no filename.".to_string())?,
        );
        match copy_attachment(source, &safe_destination) {
            Ok(true) => created.push(safe_destination),
            Ok(false) => {}
            Err(error) => {
                remove_created_files(&created);
                return Err(error);
            }
        }
    }

    if let Err(error) = fs::rename(&old_path_buf, &target_path) {
        remove_created_files(&created);
        return Err(error.to_string());
    }

    for (source, destination) in attachments {
        if source != destination && !attachment_is_referenced(&source, &resolved_notes) {
            let _ = fs::remove_file(source);
        }
    }
    Ok(path_to_string(&target_path))
}

#[cfg(test)]
mod note_asset_tests {
    use super::*;

    fn test_workspace(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let workspace = env::temp_dir().join(format!("onemind-{label}-{unique}"));
        fs::create_dir_all(workspace.join("notes")).expect("create notes");
        workspace
    }

    fn write_png(path: &Path, marker: u8) {
        fs::create_dir_all(path.parent().expect("image parent")).expect("create image parent");
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.push(marker);
        fs::write(path, bytes).expect("write image");
    }

    #[test]
    fn saves_to_note_scoped_assets_and_rejects_traversal() {
        let workspace = test_workspace("save");
        let note = workspace.join("notes").join("My note.md");
        fs::write(&note, "# Note\n").expect("write note");
        let saved = notes_save_pasted_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "image/png".to_string(),
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n"),
        )
        .expect("save image");

        assert!(saved.markdown_path.starts_with("./assets/My_note/img-"));
        assert!(Path::new(&saved.absolute_path).is_file());
        assert!(notes_resolve_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "../outside.png".to_string(),
        )
        .is_err());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn renames_managed_image_and_preserves_extension() {
        let workspace = test_workspace("rename-image");
        let note = workspace.join("notes").join("My note.md");
        fs::write(&note, "# Note\n").expect("write note");
        let source = workspace
            .join("notes")
            .join("assets")
            .join("My_note")
            .join("original.png");
        write_png(&source, 1);

        let renamed = notes_rename_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "./assets/My_note/original.png".to_string(),
            "项目截图".to_string(),
        )
        .expect("rename image");

        assert_eq!(renamed, "./assets/My_note/项目截图.png");
        assert!(!source.exists());
        assert!(workspace
            .join("notes/assets/My_note/项目截图.png")
            .is_file());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn image_rename_rejects_unmanaged_paths_and_conflicts() {
        let workspace = test_workspace("rename-image-invalid");
        let notes = workspace.join("notes");
        let note = notes.join("note.md");
        fs::write(&note, "# Note\n").expect("write note");
        write_png(&notes.join("outside.png"), 1);
        write_png(&notes.join("assets/note/source.png"), 1);
        write_png(&notes.join("assets/note/taken.png"), 2);

        assert!(notes_rename_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "./outside.png".to_string(),
            "renamed".to_string(),
        )
        .is_err());
        assert!(notes_rename_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "./assets/note/source.png".to_string(),
            "taken".to_string(),
        )
        .is_err());
        assert!(notes_rename_image(
            path_to_string(&workspace),
            path_to_string(&note),
            "./assets/note/source.png".to_string(),
            "bad/name".to_string(),
        )
        .is_err());
        assert!(notes.join("assets/note/source.png").is_file());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn moving_note_moves_managed_attachment_even_after_rename() {
        let workspace = test_workspace("move");
        let notes = workspace.join("notes");
        let old_note = notes.join("renamed.md");
        let source_image = notes.join("assets/original/image.png");
        write_png(&source_image, 1);
        fs::write(&old_note, "![image](./assets/original/image.png)\n").expect("write note");
        fs::create_dir_all(notes.join("archive")).expect("create target");

        let moved = notes_move(
            path_to_string(&old_note),
            path_to_string(&workspace),
            "archive".to_string(),
        )
        .expect("move note");

        assert_eq!(
            fs::canonicalize(moved).expect("canonical moved note"),
            fs::canonicalize(notes.join("archive/renamed.md")).expect("canonical expected note"),
        );
        assert!(notes.join("archive/assets/original/image.png").is_file());
        assert!(!source_image.exists());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn attachment_conflict_keeps_source_note_and_image() {
        let workspace = test_workspace("conflict");
        let notes = workspace.join("notes");
        let note = notes.join("note.md");
        let source_image = notes.join("assets/note/image.png");
        let conflicting_image = notes.join("target/assets/note/image.png");
        write_png(&source_image, 1);
        write_png(&conflicting_image, 2);
        fs::write(&note, "![image](./assets/note/image.png)\n").expect("write note");

        let result = notes_move(
            path_to_string(&note),
            path_to_string(&workspace),
            "target".to_string(),
        );

        assert!(result.is_err());
        assert!(note.is_file());
        assert!(source_image.is_file());
        assert_eq!(
            fs::read(conflicting_image).expect("read conflict").last(),
            Some(&2)
        );
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn note_tree_excludes_workspace_and_note_asset_directories() {
        let workspace = test_workspace("tree-assets");
        fs::create_dir_all(workspace.join("assets")).expect("create workspace assets");
        fs::write(workspace.join("assets/legacy.png"), b"legacy").expect("write legacy asset");
        fs::create_dir_all(workspace.join("notes/assets/note")).expect("create note assets");
        fs::write(workspace.join("notes/assets/note/image.png"), b"image").expect("write note asset");
        fs::write(workspace.join("notes/note.md"), "# Note\n").expect("write note");

        let nodes = notes_list(path_to_string(&workspace)).expect("list notes");

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "note.md");
        let _ = fs::remove_dir_all(workspace);
    }
}

#[tauri::command]
fn notes_delete(target_path: String) -> Result<bool, String> {
    let path = PathBuf::from(target_path);
    let is_managed_root = path.parent().is_some_and(|parent| {
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy())
            .unwrap_or_default();
        (name.eq_ignore_ascii_case("assets") && parent.join("notes").is_dir())
            || (name.eq_ignore_ascii_case("notes") && parent.join("assets").is_dir())
    });
    if is_managed_root {
        return Err("cannot delete a managed workspace directory".to_string());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
fn notes_open_file(target_path: String, workspace_path: Option<String>) -> Result<bool, String> {
    let target = PathBuf::from(target_path);
    validate_workspace_content_path(&target, workspace_path.as_deref())?;
    open_path_in_system(&target)?;
    Ok(true)
}

#[tauri::command]
fn notes_open_containing_folder(
    target_path: String,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    let target = PathBuf::from(target_path);
    validate_workspace_content_path(&target, workspace_path.as_deref())?;
    let folder = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .ok_or_else(|| "target has no parent directory".to_string())?
            .to_path_buf()
    };

    open_path_in_system(&folder)?;
    Ok(true)
}

#[tauri::command]
fn files_read_data_url(
    target_path: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let target = PathBuf::from(target_path);
    validate_workspace_content_path(&target, workspace_path.as_deref())?;
    if !target.is_file() {
        return Err("target path is not a file".to_string());
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    let mime = mime_type_for_path(&target);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

fn validate_workspace_content_path(
    target: &Path,
    workspace_path: Option<&str>,
) -> Result<(), String> {
    let Some(workspace_path) = workspace_path else {
        return Ok(());
    };
    let workspace_path = Path::new(workspace_path);
    let notes_path = workspace_path.join("notes");
    let assets_path = workspace_path.join("assets");
    let resolved_target = fs::canonicalize(target).map_err(|e| e.to_string())?;
    let resolved_notes = fs::canonicalize(&notes_path).map_err(|e| e.to_string())?;
    let resolved_assets = fs::canonicalize(&assets_path).map_err(|e| e.to_string())?;

    if resolved_target.starts_with(&resolved_notes) || resolved_target.starts_with(&resolved_assets)
    {
        return Ok(());
    }

    Err("Target is outside notes and assets workspace.".to_string())
}

fn open_path_in_system(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("target path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map_err(|e| format!("failed to open path: {e}"))?;
    Ok(())
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
fn activity_append(
    workspace_path: String,
    events: Vec<ActivityEventInput>,
) -> Result<usize, String> {
    let normalized = events
        .into_iter()
        .enumerate()
        .filter(|(_, event)| !event.module.trim().is_empty() && !event.action.trim().is_empty())
        .map(|(index, event)| normalize_activity_event(event, index))
        .collect::<Vec<_>>();
    append_activity_events_file(&workspace_path, normalized)
}

#[tauri::command]
fn activity_report(
    workspace_path: String,
    start_date: String,
    end_date: String,
) -> Result<ActivityReport, String> {
    build_activity_report(&workspace_path, &start_date, &end_date)
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
        icon: resolve_miniapp_icon_url(&input.url),
        url: input.url,
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
            item.icon = resolve_miniapp_icon_url(&input.url);
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
fn window_minimize(app: AppHandle) -> Result<(), String> {
    append_debug_log(&app, "window_minimize_requested", None);
    if let Some(window) = app.get_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
        append_debug_log(&app, "window_minimize_done", Some("found=true"));
    } else {
        append_debug_log(&app, "window_minimize_skipped", Some("found=false"));
    }
    Ok(())
}

#[tauri::command]
fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    append_debug_log(&app, "window_toggle_maximize_requested", None);
    if let Some(window) = app.get_window("main") {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())?;
            append_debug_log(
                &app,
                "window_toggle_maximize_done",
                Some("action=unmaximize found=true"),
            );
        } else {
            window.maximize().map_err(|e| e.to_string())?;
            append_debug_log(
                &app,
                "window_toggle_maximize_done",
                Some("action=maximize found=true"),
            );
        }
    } else {
        append_debug_log(&app, "window_toggle_maximize_skipped", Some("found=false"));
    }
    Ok(())
}

#[tauri::command]
fn window_close(app: AppHandle) -> Result<(), String> {
    append_debug_log(&app, "window_close_requested", None);
    if let Some(window) = app.get_window("main") {
        window.close().map_err(|e| e.to_string())?;
        append_debug_log(&app, "window_close_done", Some("found=true"));
    } else {
        append_debug_log(&app, "window_close_skipped", Some("found=false"));
    }
    Ok(())
}

#[tauri::command]
fn window_set_system_menu_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        set_window_system_menu_enabled_native(&window, enabled)?;
        return Ok(true);
    }
    Ok(false)
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
        hide_float_note_window(&app, &window, "command")?;
    }
    Ok(true)
}

#[tauri::command]
fn float_note_focus(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("float-note") {
        append_float_note_window_snapshot(&app, &window, "command_focus_before");
        if !window.is_visible().unwrap_or(false) {
            append_debug_log(&app, "float_note_focus_skipped", Some("reason=hidden"));
            return Ok(false);
        }
        let _ = window.set_always_on_top(true);
        mark_float_note_activation(&app, "command_focus");
        window.set_focus().map_err(|e| e.to_string())?;
        activate_float_note_window_native(&app, &window, "command_focus");
        append_float_note_window_snapshot(&app, &window, "command_focus_after");
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn float_note_set_height(app: AppHandle, height: u32) -> Result<bool, String> {
    let window = ensure_float_note_window(&app)?;
    let next_height = height.clamp(150, 560);
    window
        .set_size(LogicalSize::new(FLOAT_NOTE_WIDTH, next_height as f64))
        .map_err(|e| e.to_string())?;
    keep_float_note_window_inside_current_monitor(&app, &window, "set_height");
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
    let mut suspended_shortcut = state
        .float_note_suspended_shortcut
        .lock()
        .map_err(|_| "failed to lock suspended shortcut state".to_string())?;
    if let Some(current) = suspended_shortcut.take() {
        let _ = app.global_shortcut().unregister(current.as_str());
    }

    match register_float_note_shortcut(&app, next_shortcut.as_str()) {
        Ok(()) => {
            *active_shortcut = Some(next_shortcut);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn float_note_set_shortcut_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let state = app.state::<ShortcutStateStore>();
    let mut active_shortcut = state
        .float_note_shortcut
        .lock()
        .map_err(|_| "failed to lock shortcut state".to_string())?;
    let mut suspended_shortcut = state
        .float_note_suspended_shortcut
        .lock()
        .map_err(|_| "failed to lock suspended shortcut state".to_string())?;

    if enabled {
        if active_shortcut.is_some() {
            return Ok(true);
        }
        let Some(shortcut) = suspended_shortcut.take() else {
            return Ok(true);
        };
        register_float_note_shortcut(&app, shortcut.as_str())?;
        *active_shortcut = Some(shortcut);
        return Ok(true);
    }

    if let Some(shortcut) = active_shortcut.take() {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
        *suspended_shortcut = Some(shortcut);
    }
    Ok(true)
}

#[tauri::command]
fn system_apps_search(
    app: AppHandle,
    workspace_path: String,
    query: String,
) -> Result<Vec<SystemAppEntry>, String> {
    let apps = list_system_apps(&app, &workspace_path, &query);
    append_debug_log(
        &app,
        "system_apps_search",
        Some(&format!(
            "workspace={} query={} count={}",
            workspace_path,
            query,
            apps.len()
        )),
    );
    Ok(apps)
}

#[tauri::command]
fn system_apps_open(
    app: AppHandle,
    workspace_path: String,
    app_entry: SystemAppEntry,
) -> Result<bool, String> {
    append_debug_log(
        &app,
        "system_apps_open",
        Some(&format!(
            "workspace={} name={} path={}",
            workspace_path, app_entry.name, app_entry.path
        )),
    );
    let opened = open_system_app_path(&app_entry.path)?;
    if opened {
        let _ = record_system_app_recent(&workspace_path, &app_entry);
        if let Some(window) = app.get_webview_window("float-note") {
            let _ = hide_float_note_window(&app, &window, "system_app_open");
        }
    }
    Ok(opened)
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
    let raw_bounds = bounds;
    let bounds = clamp_view_bounds(raw_bounds);
    append_debug_log(
        &app,
        "miniapp_view_show",
        Some(&format!(
            "label={} view_key={} raw=({}) clamped=({}) url={}",
            label,
            view_key,
            format_view_bounds(raw_bounds),
            format_view_bounds(bounds),
            url
        )),
    );
    if let Some(webview) = app.get_webview(&label) {
        append_debug_log(
            &app,
            "miniapp_view_show_reuse",
            Some(&format!(
                "label={} clamped=({})",
                label,
                format_view_bounds(bounds)
            )),
        );
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
    let external_url: Url = url
        .parse()
        .map_err(|e| format!("invalid miniapp url: {e}"))?;
    let base_url = external_url.clone();
    let navigation_app = app.clone();
    let navigation_label = label.clone();
    let new_window_app = app.clone();
    let new_window_label = label.clone();
    let new_window_base_url = base_url.clone();
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(external_url))
        .data_directory(
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("miniapp-profiles")
                .join(safe_storage_key(&partition)),
        )
        .on_navigation(move |target_url| {
            if should_keep_miniapp_navigation_inside(&base_url, target_url) {
                return true;
            }

            append_debug_log(
                &navigation_app,
                "miniapp_external_navigation",
                Some(&format!("label={} url={}", navigation_label, target_url)),
            );
            if let Err(error) = open_external_web_url(target_url) {
                append_debug_log(
                    &navigation_app,
                    "miniapp_external_navigation_failed",
                    Some(&format!(
                        "label={} url={} error={}",
                        navigation_label, target_url, error
                    )),
                );
            }
            false
        })
        .on_new_window(move |target_url, _features| {
            if should_keep_miniapp_navigation_inside(&new_window_base_url, &target_url) {
                if let Some(webview) = new_window_app.get_webview(&new_window_label) {
                    append_debug_log(
                        &new_window_app,
                        "miniapp_internal_new_window_navigation",
                        Some(&format!("label={} url={}", new_window_label, target_url)),
                    );
                    if let Err(error) = webview.navigate(target_url) {
                        append_debug_log(
                            &new_window_app,
                            "miniapp_internal_new_window_navigation_failed",
                            Some(&format!("label={} error={}", new_window_label, error)),
                        );
                    }
                }
                return NewWindowResponse::Deny;
            }

            append_debug_log(
                &new_window_app,
                "miniapp_external_new_window",
                Some(&format!("label={} url={}", new_window_label, target_url)),
            );
            if let Err(error) = open_external_web_url(&target_url) {
                append_debug_log(
                    &new_window_app,
                    "miniapp_external_new_window_failed",
                    Some(&format!(
                        "label={} url={} error={}",
                        new_window_label, target_url, error
                    )),
                );
            }
            NewWindowResponse::Deny
        });
    let webview = main
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| format!("failed to create miniapp view: {e}"))?;
    webview.show().map_err(|e| e.to_string())?;
    append_debug_log(
        &app,
        "miniapp_view_show_created",
        Some(&format!(
            "label={} clamped=({})",
            label,
            format_view_bounds(bounds)
        )),
    );
    Ok(true)
}

#[tauri::command]
fn miniapp_view_set_bounds(
    app: AppHandle,
    view_key: String,
    bounds: ViewBounds,
) -> Result<bool, String> {
    let label = miniapp_window_label(&view_key);
    let raw_bounds = bounds;
    let bounds = clamp_view_bounds(raw_bounds);
    append_debug_log(
        &app,
        "miniapp_view_set_bounds",
        Some(&format!(
            "label={} view_key={} raw=({}) clamped=({})",
            label,
            view_key,
            format_view_bounds(raw_bounds),
            format_view_bounds(bounds)
        )),
    );
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
    } else {
        append_debug_log(
            &app,
            "miniapp_view_set_bounds_missing",
            Some(&format!("label={} view_key={}", label, view_key)),
        );
    }
    Ok(true)
}

#[tauri::command]
fn miniapp_view_hide(app: AppHandle, view_key: Option<String>) -> Result<bool, String> {
    if let Some(view_key) = view_key {
        let label = miniapp_window_label(&view_key);
        append_debug_log(
            &app,
            "miniapp_view_hide_one",
            Some(&format!("label={} view_key={}", label, view_key)),
        );
        if let Some(webview) = app.get_webview(&label) {
            webview.hide().map_err(|e| e.to_string())?;
        } else {
            append_debug_log(
                &app,
                "miniapp_view_hide_one_missing",
                Some(&format!("label={} view_key={}", label, view_key)),
            );
        }
        return Ok(true);
    }

    let mut hidden_count = 0usize;
    let mut failed_count = 0usize;
    for (label, webview) in app.webviews() {
        if label.starts_with("miniapp-") {
            match webview.hide() {
                Ok(()) => {
                    hidden_count += 1;
                    append_debug_log(
                        &app,
                        "miniapp_view_hide_all_one",
                        Some(&format!("label={}", label)),
                    );
                }
                Err(error) => {
                    failed_count += 1;
                    append_debug_log(
                        &app,
                        "miniapp_view_hide_all_one_failed",
                        Some(&format!("label={} error={}", label, error)),
                    );
                }
            }
        }
    }
    append_debug_log(
        &app,
        "miniapp_view_hide_all_done",
        Some(&format!(
            "hidden_count={} failed_count={}",
            hidden_count, failed_count
        )),
    );
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ShortcutStateStore::default())
        .manage(SystemAppStore::default())
        .manage(sync::SyncState::default())
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
            let default_shortcut = get_default_workspace_path()
                .ok()
                .and_then(|path| read_preferences_file(&path_to_string(&path)).ok())
                .map(|preferences| normalize_shortcut(&preferences.float_note_shortcut))
                .unwrap_or_else(|| normalize_shortcut(&default_preferences().float_note_shortcut));
            match register_float_note_shortcut(app.handle(), &default_shortcut) {
                Ok(()) => {
                    let state = app.state::<ShortcutStateStore>();
                    if let Ok(mut active_shortcut) = state.float_note_shortcut.lock() {
                        *active_shortcut = Some(default_shortcut.clone());
                    }
                    append_boot_log_line_with_context(
                        app.handle(),
                        "float_note_shortcut_registered",
                        &default_shortcut,
                    );
                }
                Err(error) => append_boot_log_line_with_context(
                    app.handle(),
                    "float_note_shortcut_register_failed",
                    &error,
                ),
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
            sync::sync_read_config,
            sync::sync_write_config,
            sync::sync_get_status,
            sync::sync_list_changes,
            sync::sync_preflight,
            sync::sync_write_identity,
            sync::sync_test_remote,
            sync::sync_authenticate_github,
            sync::sync_initialize,
            sync::sync_run,
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
            notes_save_pasted_image,
            notes_resolve_image,
            notes_rename_image,
            notes_move,
            notes_delete,
            notes_open_file,
            notes_open_containing_folder,
            files_read_data_url,
            quick_notes_list,
            quick_notes_create,
            quick_notes_delete,
            preferences_read,
            preferences_write,
            activity_append,
            activity_report,
            miniapps_list,
            miniapps_create,
            miniapps_update,
            miniapps_delete,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_set_system_menu_enabled,
            float_note_show,
            float_note_toggle,
            float_note_hide,
            float_note_focus,
            float_note_set_height,
            float_note_open_route,
            float_note_register_shortcut,
            float_note_set_shortcut_enabled,
            system_apps_search,
            system_apps_open,
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
