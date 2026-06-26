use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellReport {
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

fn now_iso_like() -> String {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{since_epoch}")
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
            icon: Some("https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64".to_string()),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        },
        MiniappSource {
            id: "preset-perplexity".to_string(),
            name: "Perplexity".to_string(),
            url: "https://www.perplexity.ai/".to_string(),
            icon: Some("https://www.google.com/s2/favicons?domain=www.perplexity.ai&sz=64".to_string()),
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
                    id: if relative_path.is_empty() { name.clone() } else { relative_path },
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

fn read_note_directories(dir_path: &Path, root_path: &Path, result: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir_path).map_err(|e| format!("failed to read notes directory: {e}"))? {
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
            return Ok(miniapps);
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

fn resolve_fallback_log_file() -> PathBuf {
    env::temp_dir().join("onemind-tauri.log")
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
fn workspace_get_default_path() -> Result<String, String> {
    Ok(path_to_string(&get_default_workspace_path()?))
}

#[tauri::command]
fn workspace_init_default() -> Result<WorkspaceMeta, String> {
    ensure_workspace_structure(get_default_workspace_path()?)
}

#[tauri::command]
fn workspace_select() -> Result<Option<WorkspaceMeta>, String> {
    Ok(None)
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
fn notes_create_file(workspace_path: String, relative_dir: String, name: String) -> Result<String, String> {
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
fn notes_create_folder(workspace_path: String, relative_dir: String, name: String) -> Result<String, String> {
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
fn notes_move(old_path: String, workspace_path: String, relative_dir: String) -> Result<String, String> {
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
fn preferences_read(workspace_path: String) -> Result<AppPreferences, String> {
    read_preferences_file(&workspace_path)
}

#[tauri::command]
fn preferences_write(workspace_path: String, preferences: AppPreferences) -> Result<AppPreferences, String> {
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
        .invoke_handler(tauri::generate_handler![
            get_shell_report,
            write_shell_log,
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
            preferences_read,
            preferences_write,
            miniapps_list,
            miniapps_create,
            miniapps_update,
            miniapps_delete
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
