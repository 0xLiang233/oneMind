//! IPC boundary for workspace I/O. Keep synchronous implementations testable,
//! but run them on the blocking pool, serialized to preserve read/modify/write
//! semantics (e.g. main-window and floating-window quick notes).
use crate::{
    ActivityEventInput, ActivityReport, AppPreferences, MiniappInput, MiniappSource, NoteTreeNode,
    QuickNote, SavedNoteAsset, WorkspaceMeta,
};
use tauri::WebviewWindow;

#[tauri::command]
pub async fn workspace_get_default_path() -> Result<String, String> {
    crate::runtime::run_storage("workspace_get_default_path", move || {
        super::workspace_get_default_path()
    })
    .await
}

#[tauri::command]
pub async fn workspace_init_default() -> Result<WorkspaceMeta, String> {
    crate::runtime::run_storage("workspace_init_default", move || {
        super::workspace_init_default()
    })
    .await
}

#[tauri::command]
pub async fn workspace_select(window: WebviewWindow) -> Result<Option<WorkspaceMeta>, String> {
    crate::runtime::run_blocking("workspace_select", move || super::workspace_select(window)).await
}

#[tauri::command]
pub async fn notes_list(workspace_path: String) -> Result<Vec<NoteTreeNode>, String> {
    crate::runtime::run_storage("notes_list", move || super::notes_list(workspace_path)).await
}

#[tauri::command]
pub async fn notes_list_directories(workspace_path: String) -> Result<Vec<String>, String> {
    crate::runtime::run_storage("notes_list_directories", move || {
        super::notes_list_directories(workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn notes_read(file_path: String) -> Result<String, String> {
    crate::runtime::run_storage("notes_read", move || super::notes_read(file_path)).await
}

#[tauri::command]
pub async fn notes_write(file_path: String, content: String) -> Result<bool, String> {
    crate::runtime::run_storage("notes_write", move || {
        super::notes_write(file_path, content)
    })
    .await
}

#[tauri::command]
pub async fn notes_create_file(
    workspace_path: String,
    relative_dir: String,
    name: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_create_file", move || {
        super::notes_create_file(workspace_path, relative_dir, name)
    })
    .await
}

#[tauri::command]
pub async fn notes_create_from_quick_note(
    workspace_path: String,
    relative_dir: String,
    name: String,
    content: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_create_from_quick_note", move || {
        super::notes_create_from_quick_note(workspace_path, relative_dir, name, content)
    })
    .await
}

#[tauri::command]
pub async fn notes_create_folder(
    workspace_path: String,
    relative_dir: String,
    name: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_create_folder", move || {
        super::notes_create_folder(workspace_path, relative_dir, name)
    })
    .await
}

#[tauri::command]
pub async fn notes_rename(old_path: String, new_name: String) -> Result<String, String> {
    crate::runtime::run_storage("notes_rename", move || {
        super::notes_rename(old_path, new_name)
    })
    .await
}

#[tauri::command]
pub async fn notes_save_pasted_image(
    workspace_path: String,
    note_path: String,
    mime_type: String,
    data_base64: String,
) -> Result<SavedNoteAsset, String> {
    crate::runtime::run_storage("notes_save_pasted_image", move || {
        super::notes_save_pasted_image(workspace_path, note_path, mime_type, data_base64)
    })
    .await
}

#[tauri::command]
pub async fn notes_resolve_image(
    workspace_path: String,
    note_path: String,
    markdown_path: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_resolve_image", move || {
        super::notes_resolve_image(workspace_path, note_path, markdown_path)
    })
    .await
}

#[tauri::command]
pub async fn notes_rename_image(
    workspace_path: String,
    note_path: String,
    markdown_path: String,
    new_name: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_rename_image", move || {
        super::notes_rename_image(workspace_path, note_path, markdown_path, new_name)
    })
    .await
}

#[tauri::command]
pub async fn notes_move(
    old_path: String,
    workspace_path: String,
    relative_dir: String,
) -> Result<String, String> {
    crate::runtime::run_storage("notes_move", move || {
        super::notes_move(old_path, workspace_path, relative_dir)
    })
    .await
}

#[tauri::command]
pub async fn notes_delete(target_path: String) -> Result<bool, String> {
    crate::runtime::run_storage("notes_delete", move || super::notes_delete(target_path)).await
}

#[tauri::command]
pub async fn notes_open_file(
    target_path: String,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    crate::runtime::run_storage("notes_open_file", move || {
        super::notes_open_file(target_path, workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn notes_open_containing_folder(
    target_path: String,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    crate::runtime::run_storage("notes_open_containing_folder", move || {
        super::notes_open_containing_folder(target_path, workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn files_read_data_url(
    target_path: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    crate::runtime::run_storage("files_read_data_url", move || {
        super::files_read_data_url(target_path, workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn quick_notes_list(workspace_path: String) -> Result<Vec<QuickNote>, String> {
    crate::runtime::run_storage("quick_notes_list", move || {
        super::quick_notes_list(workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn quick_notes_create(
    workspace_path: String,
    content: String,
) -> Result<QuickNote, String> {
    crate::runtime::run_storage("quick_notes_create", move || {
        super::quick_notes_create(workspace_path, content)
    })
    .await
}

#[tauri::command]
pub async fn quick_notes_delete(workspace_path: String, id: String) -> Result<bool, String> {
    crate::runtime::run_storage("quick_notes_delete", move || {
        super::quick_notes_delete(workspace_path, id)
    })
    .await
}

#[tauri::command]
pub async fn preferences_read(workspace_path: String) -> Result<AppPreferences, String> {
    crate::runtime::run_storage("preferences_read", move || {
        super::preferences_read(workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn preferences_write(
    workspace_path: String,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    crate::runtime::run_storage("preferences_write", move || {
        super::preferences_write(workspace_path, preferences)
    })
    .await
}

#[tauri::command]
pub async fn activity_append(
    workspace_path: String,
    events: Vec<ActivityEventInput>,
) -> Result<usize, String> {
    crate::runtime::run_storage("activity_append", move || {
        super::activity_append(workspace_path, events)
    })
    .await
}

#[tauri::command]
pub async fn activity_report(
    workspace_path: String,
    start_date: String,
    end_date: String,
) -> Result<ActivityReport, String> {
    crate::runtime::run_storage("activity_report", move || {
        super::activity_report(workspace_path, start_date, end_date)
    })
    .await
}

#[tauri::command]
pub async fn miniapps_list(workspace_path: String) -> Result<Vec<MiniappSource>, String> {
    crate::runtime::run_storage("miniapps_list", move || {
        super::miniapps_list(workspace_path)
    })
    .await
}

#[tauri::command]
pub async fn miniapps_create(
    workspace_path: String,
    input: MiniappInput,
) -> Result<MiniappSource, String> {
    crate::runtime::run_storage("miniapps_create", move || {
        super::miniapps_create(workspace_path, input)
    })
    .await
}

#[tauri::command]
pub async fn miniapps_update(
    workspace_path: String,
    id: String,
    input: MiniappInput,
) -> Result<Option<MiniappSource>, String> {
    crate::runtime::run_storage("miniapps_update", move || {
        super::miniapps_update(workspace_path, id, input)
    })
    .await
}

#[tauri::command]
pub async fn miniapps_delete(workspace_path: String, id: String) -> Result<bool, String> {
    crate::runtime::run_storage("miniapps_delete", move || {
        super::miniapps_delete(workspace_path, id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ensure_workspace_structure, now_id, path_to_string};

    #[test]
    fn concurrent_main_and_float_note_writes_keep_every_note_and_unique_id() {
        let root = std::env::temp_dir().join(format!(
            "onemind-storage-test-{}-{}",
            std::process::id(),
            now_id()
        ));
        ensure_workspace_structure(root.clone()).unwrap();
        let workspace = path_to_string(&root);
        tauri::async_runtime::block_on(async {
            let mut jobs = Vec::new();
            for n in 0..64 {
                let workspace = workspace.clone();
                jobs.push(tauri::async_runtime::spawn(async move {
                    quick_notes_create(workspace, format!("concurrent note {n}"))
                        .await
                        .unwrap()
                }));
            }
            let mut ids = std::collections::HashSet::new();
            for job in jobs {
                assert!(ids.insert(job.await.unwrap().id));
            }
            let notes = quick_notes_list(workspace.clone()).await.unwrap();
            assert_eq!(notes.len(), 64);
            assert_eq!(
                notes
                    .iter()
                    .map(|n| &n.content)
                    .collect::<std::collections::HashSet<_>>()
                    .len(),
                64
            );
            // A rejected command must not prevent the next write.
            assert!(quick_notes_create(workspace.clone(), "  ".into())
                .await
                .is_err());
            quick_notes_create(workspace.clone(), "after error".into())
                .await
                .unwrap();
            assert_eq!(quick_notes_list(workspace).await.unwrap().len(), 65);
        });
        std::fs::remove_dir_all(root).unwrap();
    }
}
