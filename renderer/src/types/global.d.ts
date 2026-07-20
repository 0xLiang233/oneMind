type WorkspaceMeta = {
  workspacePath: string
  notesPath: string
  assetsPath: string
  inboxPath: string
  sourcesPath: string
  appDataPath: string
}

type NoteTreeNode = {
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
  children?: NoteTreeNode[]
}

type QuickNote = {
  id: string
  content: string
  createdAt: string
}

type MiniappSource = {
  id: string
  name: string
  url: string
  icon?: string
  createdAt: string
}

type SystemAppEntry = {
  id: string
  name: string
  path: string
  targetPath?: string
  iconPath?: string
  source: 'start-menu' | 'recent'
  icon?: string
  lastUsedAt?: string
}

type AppPreferences = {
  theme: 'dark' | 'light' | 'system'
  accent: 'purple' | 'blue' | 'green' | 'orange'
  sidebarPosition: 'left' | 'right'
  startupPage: 'home' | 'last' | 'notes' | 'sources'
  language: 'zh-CN' | 'en-US'
  editorFontSize: number
  editorDefaultMode: 'edit' | 'preview'
  floatNoteShortcut: string
}

type ViewBounds = {
  x: number
  y: number
  width: number
  height: number
}

type ShellReport = {
  appName: string
  appVersion: string
  runtimeTarget: string
  platform: string
  arch: string
  dev: boolean
  logFile: string
  dataDir: string
  generatedAt: string
}

type DebugModeReport = {
  enabled: boolean
  source: string
}

type AppUpdateInfo = {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

type AppUpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

type SyncPhase = 'idle' | 'initializing' | 'committing' | 'fetching' | 'rebasing' | 'pushing' | 'conflicted' | 'error'

type SyncConfig = {
  enabled: boolean
  remoteUrl: string
  branch: string
  autoSyncIntervalMinutes: number
  pullOnStartup: boolean
}

type SyncStatus = {
  available: boolean
  configured: boolean
  repositoryInitialized: boolean
  phase: SyncPhase
  branch: string
  remoteUrl: string
  ahead: number
  behind: number
  changedFiles: number
  conflicts: string[]
  message: string
}

type SyncChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted'

type SyncChange = {
  kind: SyncChangeKind
  path: string
  previousPath?: string
}

type SyncResult = {
  success: boolean
  status: SyncStatus
}

type GitIdentity = {
  name: string
  email: string
}

type SyncPreflight = {
  gitAvailable: boolean
  gitVersion: string
  repositoryInitialized: boolean
  identityConfigured: boolean
  identity: GitIdentity
  credentialHelper: string
  credentialHelperReady: boolean
  remoteUrl: string
  remoteConfigured: boolean
}

type RemoteCheck = {
  success: boolean
  state: 'empty' | 'has_history' | 'authentication_required' | 'repository_not_found' | 'network_unavailable' | 'unreachable'
  message: string
  remoteUrl: string
}

type AuthenticationResult = {
  success: boolean
  message: string
}

type ActivityEventInput = {
  kind?: 'instant' | 'session'
  module: string
  action: string
  occurredAt?: string
  startedAt?: string
  endedAt?: string
  targetType?: string
  targetId?: string
  targetLabel?: string
  metadata?: Record<string, unknown>
}

type ActivityEvent = ActivityEventInput & {
  id: string
  kind: 'instant' | 'session'
  occurredAt: string
}

type ActivityDaySummary = {
  date: string
  count: number
  score: number
  moduleCounts: Record<string, number>
}

type ActivityTotals = {
  totalEvents: number
  activeDays: number
  currentStreakDays: number
  moduleCounts: Record<string, number>
  lastActiveAt?: string
}

type ActivityReport = {
  startDate: string
  endDate: string
  days: ActivityDaySummary[]
  events: ActivityEvent[]
  totals: ActivityTotals
}

type SavedNoteAsset = {
  markdownPath: string
  absolutePath: string
  mimeType: string
}

interface Window {
  oneMind: {
    runtime?: {
      platform: 'electron' | 'tauri' | 'unsupported'
      bridgeReady: boolean
    }
    window: {
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<void>
      close: () => Promise<void>
      setSystemMenuEnabled?: (enabled: boolean) => Promise<boolean>
      onNavigate: (callback: (route: string) => void) => () => void
    }
    floatNote: {
      show: () => Promise<boolean>
      toggle: () => Promise<boolean>
      hide: () => Promise<boolean>
      focus: () => Promise<boolean>
      setHeight: (height: number) => Promise<boolean>
      openRoute: (route: string) => Promise<boolean>
      registerShortcut: (shortcut: string) => Promise<boolean>
      setShortcutEnabled?: (enabled: boolean) => Promise<boolean>
      onShown: (callback: (reason?: 'shown' | 'focus-ready') => void) => () => void
    }
    workspace: {
      getDefaultPath: () => Promise<string>
      select: () => Promise<WorkspaceMeta | null>
      initDefault: () => Promise<WorkspaceMeta>
    }
    notes: {
      list: (workspacePath: string) => Promise<NoteTreeNode[]>
      listDirectories: (workspacePath: string) => Promise<string[]>
      read: (filePath: string) => Promise<string>
      write: (filePath: string, content: string) => Promise<boolean>
      createFile: (workspacePath: string, relativeDir: string, name: string) => Promise<string>
      createFromQuickNote: (
        workspacePath: string,
        relativeDir: string,
        name: string,
        content: string
      ) => Promise<string>
      createFolder: (workspacePath: string, relativeDir: string, name: string) => Promise<string>
      rename: (oldPath: string, newName: string) => Promise<string>
      move: (oldPath: string, workspacePath: string, relativeDir: string) => Promise<string>
      delete: (targetPath: string) => Promise<boolean>
      openFile: (targetPath: string, workspacePath?: string) => Promise<boolean>
      openContainingFolder: (targetPath: string, workspacePath?: string) => Promise<boolean>
      assets: {
        savePastedImage: (
          workspacePath: string,
          notePath: string,
          image: { mimeType: string; dataBase64: string }
        ) => Promise<SavedNoteAsset>
        resolveImage: (workspacePath: string, notePath: string, markdownPath: string) => Promise<string>
        renameImage: (
          workspacePath: string,
          notePath: string,
          markdownPath: string,
          newName: string
        ) => Promise<string>
      }
    }
    files: {
      readDataUrl: (targetPath: string, workspacePath?: string) => Promise<string>
    }
    quickNotes: {
      list: (workspacePath: string) => Promise<QuickNote[]>
      create: (workspacePath: string, content: string) => Promise<QuickNote>
      delete: (workspacePath: string, id: string) => Promise<boolean>
    }
    miniapps: {
      list: (workspacePath: string) => Promise<MiniappSource[]>
      create: (workspacePath: string, input: { name: string; url: string }) => Promise<MiniappSource>
      update: (workspacePath: string, id: string, input: { name: string; url: string }) => Promise<MiniappSource | null>
      delete: (workspacePath: string, id: string) => Promise<boolean>
    }
    preferences: {
      read: (workspacePath: string) => Promise<AppPreferences>
      write: (workspacePath: string, preferences: AppPreferences) => Promise<AppPreferences>
    }
    activity: {
      append: (workspacePath: string, events: ActivityEventInput[]) => Promise<number>
      report: (workspacePath: string, startDate: string, endDate: string) => Promise<ActivityReport>
    }
    systemApps: {
      search: (workspacePath: string, query: string) => Promise<SystemAppEntry[]>
      open: (workspacePath: string, appEntry: SystemAppEntry) => Promise<boolean>
    }
    miniappView: {
      show: (input: { viewKey: string; url: string; partition: string; bounds: ViewBounds }) => Promise<boolean>
      setBounds: (input: { viewKey: string; bounds: ViewBounds }) => Promise<boolean>
      hide: () => Promise<boolean>
      reload: (input: { viewKey: string; url: string }) => Promise<boolean>
      close: (viewKey: string) => Promise<boolean>
    }
    diagnostics: {
      getShellReport: () => Promise<ShellReport>
      getDebugMode: () => Promise<DebugModeReport>
      writeLog: (level: string, message: string, context?: string) => Promise<void>
      openDevtools: (label?: string) => Promise<boolean>
    }
    updates: {
      supported: boolean
      check: () => Promise<AppUpdateInfo | null>
      downloadAndInstall: (onEvent?: (event: AppUpdateDownloadEvent) => void) => Promise<void>
      relaunch: () => Promise<void>
    }
    sync: {
      readConfig: (workspacePath: string) => Promise<SyncConfig>
      writeConfig: (workspacePath: string, config: SyncConfig) => Promise<SyncConfig>
      getStatus: (workspacePath: string) => Promise<SyncStatus>
      listChanges: (workspacePath: string) => Promise<SyncChange[]>
      preflight: (workspacePath: string) => Promise<SyncPreflight>
      writeIdentity: (workspacePath: string, identity: GitIdentity) => Promise<GitIdentity>
      testRemote: (workspacePath: string, remoteUrl: string) => Promise<RemoteCheck>
      authenticateGitHub: (workspacePath: string, username?: string) => Promise<AuthenticationResult>
      initialize: (workspacePath: string, config: SyncConfig) => Promise<SyncResult>
      run: (workspacePath: string) => Promise<SyncResult>
      onStatusChanged: (callback: (status: SyncStatus) => void) => () => void
    }
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      partition?: string
      allowpopups?: boolean | string
    }
  }
}
