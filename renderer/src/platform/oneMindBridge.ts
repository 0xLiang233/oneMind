const unsupportedPreferences: AppPreferences = {
  theme: "system",
  accent: "purple",
  sidebarPosition: "left",
  startupPage: "last",
  language: "zh-CN",
  editorFontSize: 15,
  editorDefaultMode: "edit",
  floatNoteShortcut: "Alt+Space"
}

function unsupported<T>(feature: string): Promise<T> {
  return Promise.reject(new Error(`${feature} is not available in this desktop shell yet.`))
}

export function installOneMindBridgeFallback() {
  if (window.oneMind) return

  const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window

  if (isTauri) {
    import("./tauriBridge").then(({ createTauriBridge }) => {
      window.oneMind = createTauriBridge()
      window.dispatchEvent(new CustomEvent("oneMindBridgeReady"))
    }).catch((error: unknown) => {
      console.error("Failed to install Tauri bridge:", error)
    })
  }

  window.oneMind = {
    runtime: {
      platform: isTauri ? "tauri" : "unsupported",
      bridgeReady: false
    },
    window: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
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
      getDefaultPath: () => Promise.resolve(""),
      select: () => Promise.resolve(null),
      initDefault: () => unsupported<WorkspaceMeta>("workspace")
    },
    notes: {
      list: () => Promise.resolve([]),
      listDirectories: () => Promise.resolve([]),
      read: () => unsupported<string>("notes.read"),
      write: () => Promise.resolve(false),
      createFile: () => unsupported<string>("notes.createFile"),
      createFromQuickNote: () => unsupported<string>("notes.createFromQuickNote"),
      createFolder: () => unsupported<string>("notes.createFolder"),
      rename: () => unsupported<string>("notes.rename"),
      move: () => unsupported<string>("notes.move"),
      delete: () => Promise.resolve(false)
    },
    quickNotes: {
      list: () => Promise.resolve([]),
      create: () => unsupported<QuickNote>("quickNotes.create")
    },
    miniapps: {
      list: () => Promise.resolve([]),
      create: () => unsupported<MiniappSource>("miniapps.create"),
      update: () => Promise.resolve(null),
      delete: () => Promise.resolve(false)
    },
    preferences: {
      read: () => Promise.resolve(unsupportedPreferences),
      write: (_workspacePath, preferences) => Promise.resolve(preferences)
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
