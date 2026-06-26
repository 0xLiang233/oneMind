import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

const appWindow = getCurrentWindow()

export function createTauriBridge(): Window["oneMind"] {
  return {
    runtime: {
      platform: "tauri",
      bridgeReady: true
    },
    window: {
      minimize: () => appWindow.minimize(),
      toggleMaximize: () => appWindow.toggleMaximize(),
      close: () => appWindow.close(),
      onNavigate: () => () => undefined
    },
    floatNote: {
      show: () => Promise.resolve(false),
      hide: () => Promise.resolve(false),
      setHeight: () => Promise.resolve(false),
      openRoute: () => Promise.resolve(false),
      registerShortcut: () => Promise.resolve(false),
      onShown: () => () => undefined
    },
    workspace: {
      getDefaultPath: () => invoke<string>("workspace_get_default_path"),
      select: () => invoke<WorkspaceMeta | null>("workspace_select"),
      initDefault: () => invoke<WorkspaceMeta>("workspace_init_default")
    },
    notes: {
      list: (workspacePath) => invoke<NoteTreeNode[]>("notes_list", { workspacePath }),
      listDirectories: (workspacePath) => invoke<string[]>("notes_list_directories", { workspacePath }),
      read: (filePath) => invoke<string>("notes_read", { filePath }),
      write: (filePath, content) => invoke<boolean>("notes_write", { filePath, content }),
      createFile: (workspacePath, relativeDir, name) =>
        invoke<string>("notes_create_file", { workspacePath, relativeDir, name }),
      createFromQuickNote: (workspacePath, relativeDir, name, content) =>
        invoke<string>("notes_create_from_quick_note", { workspacePath, relativeDir, name, content }),
      createFolder: (workspacePath, relativeDir, name) =>
        invoke<string>("notes_create_folder", { workspacePath, relativeDir, name }),
      rename: (oldPath, newName) => invoke<string>("notes_rename", { oldPath, newName }),
      move: (oldPath, workspacePath, relativeDir) =>
        invoke<string>("notes_move", { oldPath, workspacePath, relativeDir }),
      delete: (targetPath) => invoke<boolean>("notes_delete", { targetPath })
    },
    quickNotes: {
      list: (workspacePath) => invoke<QuickNote[]>("quick_notes_list", { workspacePath }),
      create: (workspacePath, content) => invoke<QuickNote>("quick_notes_create", { workspacePath, content })
    },
    miniapps: {
      list: (workspacePath) => invoke<MiniappSource[]>("miniapps_list", { workspacePath }),
      create: (workspacePath, input) => invoke<MiniappSource>("miniapps_create", { workspacePath, input }),
      update: (workspacePath, id, input) =>
        invoke<MiniappSource | null>("miniapps_update", { workspacePath, id, input }),
      delete: (workspacePath, id) => invoke<boolean>("miniapps_delete", { workspacePath, id })
    },
    preferences: {
      read: (workspacePath) => invoke<AppPreferences>("preferences_read", { workspacePath }),
      write: (workspacePath, preferences) =>
        invoke<AppPreferences>("preferences_write", { workspacePath, preferences })
    },
    systemApps: {
      search: () => Promise.resolve([]),
      open: () => Promise.resolve(false)
    },
    miniappView: {
      show: () => Promise.resolve(false),
      setBounds: () => Promise.resolve(false),
      hide: () => Promise.resolve(false),
      reload: () => Promise.resolve(false),
      close: () => Promise.resolve(false)
    }
  }
}
