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

const unsupportedShellReport: ShellReport = {
  appName: "OneMind",
  appVersion: "0.0.0",
  runtimeTarget: "unknown",
  platform: "unknown",
  arch: "unknown",
  dev: false,
  logFile: "",
  dataDir: "",
  generatedAt: ""
}

const unsupportedSyncStatus: SyncStatus = {
  available: false,
  configured: false,
  repositoryInitialized: false,
  phase: "idle",
  branch: "main",
  remoteUrl: "",
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  conflicts: [],
  message: "当前桌面外壳不支持同步。"
}

const unsupportedSyncConfig: SyncConfig = {
  enabled: false,
  remoteUrl: "",
  branch: "main",
  autoSyncIntervalMinutes: 0,
  pullOnStartup: false
}

const unsupportedSyncPreflight: SyncPreflight = {
  gitAvailable: false,
  gitVersion: "",
  repositoryInitialized: false,
  identityConfigured: false,
  identity: { name: "", email: "" },
  credentialHelper: "",
  credentialHelperReady: false,
  remoteUrl: "",
  remoteConfigured: false
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
      setSystemMenuEnabled: () => Promise.resolve(false),
      onNavigate: () => () => undefined
    },
    floatNote: {
      show: () => Promise.resolve(false),
      toggle: () => Promise.resolve(false),
      hide: () => Promise.resolve(false),
      focus: () => Promise.resolve(false),
      setHeight: () => Promise.resolve(false),
      openRoute: () => Promise.resolve(false),
      registerShortcut: () => Promise.resolve(false),
      setShortcutEnabled: () => Promise.resolve(false),
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
      delete: () => Promise.resolve(false),
      openFile: () => Promise.resolve(false),
      openContainingFolder: () => Promise.resolve(false)
    },
    files: {
      readDataUrl: () => unsupported<string>("files.readDataUrl")
    },
    quickNotes: {
      list: () => Promise.resolve([]),
      create: () => unsupported<QuickNote>("quickNotes.create"),
      delete: () => Promise.resolve(false)
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
    activity: {
      append: () => Promise.resolve(0),
      report: (_workspacePath, startDate, endDate) => Promise.resolve({
        startDate,
        endDate,
        days: [],
        events: [],
        totals: {
          totalEvents: 0,
          activeDays: 0,
          currentStreakDays: 0,
          moduleCounts: {}
        }
      })
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
    },
    diagnostics: {
      getShellReport: () => Promise.resolve(unsupportedShellReport),
      getDebugMode: () => Promise.resolve({ enabled: false, source: "unsupported" }),
      writeLog: () => Promise.resolve(),
      openDevtools: () => Promise.resolve(false)
    },
    sync: {
      readConfig: () => Promise.resolve(unsupportedSyncConfig),
      writeConfig: (_workspacePath, config) => Promise.resolve(config),
      getStatus: () => Promise.resolve(unsupportedSyncStatus),
      preflight: () => Promise.resolve(unsupportedSyncPreflight),
      writeIdentity: (_workspacePath, identity) => Promise.resolve(identity),
      testRemote: (_workspacePath, remoteUrl) => Promise.resolve({
        success: false,
        state: "unreachable",
        message: "当前桌面外壳不支持远程连接测试。",
        remoteUrl
      }),
      authenticateGitHub: () => unsupported<AuthenticationResult>("sync.authenticateGitHub"),
      initialize: () => unsupported<SyncResult>("sync.initialize"),
      run: () => unsupported<SyncResult>("sync.run"),
      onStatusChanged: () => () => undefined
    }
  }
}
