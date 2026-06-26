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
      onNavigate: (callback: (route: string) => void) => () => void
    }
    floatNote: {
      show: () => Promise<boolean>
      hide: () => Promise<boolean>
      setHeight: (height: number) => Promise<boolean>
      openRoute: (route: string) => Promise<boolean>
      registerShortcut: (shortcut: string) => Promise<boolean>
      onShown: (callback: () => void) => () => void
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
    }
    quickNotes: {
      list: (workspacePath: string) => Promise<QuickNote[]>
      create: (workspacePath: string, content: string) => Promise<QuickNote>
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
    systemApps: {
      search: (workspacePath: string, query: string) => Promise<SystemAppEntry[]>
      open: (workspacePath: string, appEntry: SystemAppEntry) => Promise<boolean>
    }
    miniappView: {
      show: (input: { viewKey: string; url: string; partition: string; bounds: ViewBounds }) => Promise<boolean>
      setBounds: (bounds: ViewBounds) => Promise<boolean>
      hide: () => Promise<boolean>
      reload: (input: { viewKey: string; url: string }) => Promise<boolean>
      close: (viewKey: string) => Promise<boolean>
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
