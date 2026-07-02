import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export function createTauriBridge(): Window["oneMind"] {
  return {
    runtime: {
      platform: "tauri",
      bridgeReady: true
    },
    window: {
      minimize: () => invoke<void>("window_minimize"),
      toggleMaximize: () => invoke<void>("window_toggle_maximize"),
      close: () => invoke<void>("window_close"),
      setSystemMenuEnabled: (enabled) => invoke<boolean>("window_set_system_menu_enabled", { enabled }),
      onNavigate: (callback) => {
        let disposed = false
        let unlisten: (() => void) | null = null
        void listen<string>("app-navigate", (event) => callback(event.payload)).then((nextUnlisten) => {
          if (disposed) {
            nextUnlisten()
            return
          }
          unlisten = nextUnlisten
        })
        return () => {
          disposed = true
          unlisten?.()
        }
      }
    },
    floatNote: {
      show: () => invoke<boolean>("float_note_show"),
      toggle: () => invoke<boolean>("float_note_toggle"),
      hide: () => invoke<boolean>("float_note_hide"),
      focus: () => invoke<boolean>("float_note_focus"),
      setHeight: (height) => invoke<boolean>("float_note_set_height", { height }),
      openRoute: (route) => invoke<boolean>("float_note_open_route", { route }),
      registerShortcut: (shortcut) => invoke<boolean>("float_note_register_shortcut", { shortcut }),
      setShortcutEnabled: (enabled) => invoke<boolean>("float_note_set_shortcut_enabled", { enabled }),
      onShown: (callback) => {
        let disposed = false
        const unlisteners: Array<() => void> = []
        const addUnlisten = (nextUnlisten: () => void) => {
          if (disposed) {
            nextUnlisten()
            return
          }
          unlisteners.push(nextUnlisten)
        }
        void listen("float-note-shown", () => callback("shown")).then(addUnlisten)
        void listen("float-note-focus-ready", () => callback("focus-ready")).then(addUnlisten)
        return () => {
          disposed = true
          unlisteners.forEach((unlisten) => unlisten())
        }
      }
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
      delete: (targetPath) => invoke<boolean>("notes_delete", { targetPath }),
      openFile: (targetPath, workspacePath) =>
        invoke<boolean>("notes_open_file", { targetPath, workspacePath }),
      openContainingFolder: (targetPath, workspacePath) =>
        invoke<boolean>("notes_open_containing_folder", { targetPath, workspacePath })
    },
    files: {
      readDataUrl: (targetPath, workspacePath) =>
        invoke<string>("files_read_data_url", { targetPath, workspacePath })
    },
    quickNotes: {
      list: (workspacePath) => invoke<QuickNote[]>("quick_notes_list", { workspacePath }),
      create: (workspacePath, content) => invoke<QuickNote>("quick_notes_create", { workspacePath, content }),
      delete: (workspacePath, id) => invoke<boolean>("quick_notes_delete", { workspacePath, id })
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
      search: async (workspacePath, query) => {
        return invoke<SystemAppEntry[]>("system_apps_search", { workspacePath, query })
      },
      open: (workspacePath, appEntry) => invoke<boolean>("system_apps_open", { workspacePath, appEntry })
    },
    miniappView: {
      show: ({ viewKey, url, partition, bounds }) =>
        invoke<boolean>("miniapp_view_show", { viewKey, url, partition, bounds }),
      setBounds: ({ viewKey, bounds }) => invoke<boolean>("miniapp_view_set_bounds", { viewKey, bounds }),
      hide: () => invoke<boolean>("miniapp_view_hide"),
      reload: ({ viewKey, url }) => invoke<boolean>("miniapp_view_reload", { viewKey, url }),
      close: (viewKey) => invoke<boolean>("miniapp_view_close", { viewKey })
    },
    diagnostics: {
      getShellReport: () => invoke<ShellReport>("get_shell_report"),
      getDebugMode: () => invoke<DebugModeReport>("diagnostics_get_debug_mode"),
      writeLog: (level, message, context) => invoke<void>("write_shell_log", { level, message, context }),
      openDevtools: (label) => invoke<boolean>("diagnostics_open_devtools", { label })
    }
  }
}
