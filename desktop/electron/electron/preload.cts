import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('oneMind', {
  runtime: {
    platform: 'electron',
    bridgeReady: true
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<void>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    onNavigate: (callback: (route: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: string) => callback(route)
      ipcRenderer.on('app:navigate', listener)
      return () => ipcRenderer.removeListener('app:navigate', listener)
    }
  },
  floatNote: {
    show: () => ipcRenderer.invoke('float-note:show') as Promise<boolean>,
    hide: () => ipcRenderer.invoke('float-note:hide') as Promise<boolean>,
    setHeight: (height: number) => ipcRenderer.invoke('float-note:set-height', height) as Promise<boolean>,
    openRoute: (route: string) => ipcRenderer.invoke('float-note:open-route', route) as Promise<boolean>,
    registerShortcut: (shortcut: string) =>
      ipcRenderer.invoke('float-note:register-shortcut', shortcut) as Promise<boolean>,
    onShown: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('float-note:shown', listener)
      return () => ipcRenderer.removeListener('float-note:shown', listener)
    }
  },
  workspace: {
    getDefaultPath: () => ipcRenderer.invoke('workspace:get-default-path') as Promise<string>,
    select: () => ipcRenderer.invoke('workspace:select') as Promise<WorkspaceMeta | null>,
    initDefault: () => ipcRenderer.invoke('workspace:init-default') as Promise<WorkspaceMeta>
  },
  notes: {
    list: (workspacePath: string) =>
      ipcRenderer.invoke('notes:list', workspacePath) as Promise<NoteTreeNode[]>,
    listDirectories: (workspacePath: string) =>
      ipcRenderer.invoke('notes:list-directories', workspacePath) as Promise<string[]>,
    read: (filePath: string) => ipcRenderer.invoke('notes:read', filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('notes:write', filePath, content) as Promise<boolean>,
    createFile: (workspacePath: string, relativeDir: string, name: string) =>
      ipcRenderer.invoke('notes:create-file', workspacePath, relativeDir, name) as Promise<string>,
    createFromQuickNote: (
      workspacePath: string,
      relativeDir: string,
      name: string,
      content: string
    ) =>
      ipcRenderer.invoke(
        'notes:create-from-quick-note',
        workspacePath,
        relativeDir,
        name,
        content
      ) as Promise<string>,
    createFolder: (workspacePath: string, relativeDir: string, name: string) =>
      ipcRenderer.invoke('notes:create-folder', workspacePath, relativeDir, name) as Promise<string>,
    rename: (oldPath: string, newName: string) =>
      ipcRenderer.invoke("notes:rename", oldPath, newName) as Promise<string>,
    move: (oldPath: string, workspacePath: string, relativeDir: string) =>
      ipcRenderer.invoke("notes:move", oldPath, workspacePath, relativeDir) as Promise<string>,
    delete: (targetPath: string) =>
      ipcRenderer.invoke("notes:delete", targetPath) as Promise<boolean>
  },
  quickNotes: {
    list: (workspacePath: string) =>
      ipcRenderer.invoke('quick-notes:list', workspacePath) as Promise<QuickNote[]>,
    create: (workspacePath: string, content: string) =>
      ipcRenderer.invoke('quick-notes:create', workspacePath, content) as Promise<QuickNote>
  },
  miniapps: {
    list: (workspacePath: string) =>
      ipcRenderer.invoke('miniapps:list', workspacePath) as Promise<MiniappSource[]>,
    create: (workspacePath: string, input: { name: string; url: string }) =>
      ipcRenderer.invoke('miniapps:create', workspacePath, input) as Promise<MiniappSource>,
    update: (workspacePath: string, id: string, input: { name: string; url: string }) =>
      ipcRenderer.invoke('miniapps:update', workspacePath, id, input) as Promise<MiniappSource | null>,
    delete: (workspacePath: string, id: string) =>
      ipcRenderer.invoke('miniapps:delete', workspacePath, id) as Promise<boolean>
  },
  preferences: {
    read: (workspacePath: string) =>
      ipcRenderer.invoke('preferences:read', workspacePath) as Promise<AppPreferences>,
    write: (workspacePath: string, preferences: AppPreferences) =>
      ipcRenderer.invoke('preferences:write', workspacePath, preferences) as Promise<AppPreferences>
  },
  systemApps: {
    search: (workspacePath: string, query: string) =>
      ipcRenderer.invoke('system-apps:search', workspacePath, query) as Promise<SystemAppEntry[]>,
    open: (workspacePath: string, appEntry: SystemAppEntry) =>
      ipcRenderer.invoke('system-apps:open', workspacePath, appEntry) as Promise<boolean>
  },
  miniappView: {
    show: (input: { viewKey: string; url: string; partition: string; bounds: ViewBounds }) =>
      ipcRenderer.invoke('miniapp-view:show', input) as Promise<boolean>,
    setBounds: (bounds: ViewBounds) =>
      ipcRenderer.invoke('miniapp-view:set-bounds', bounds) as Promise<boolean>,
    hide: () => ipcRenderer.invoke('miniapp-view:hide') as Promise<boolean>,
    reload: (input: { viewKey: string; url: string }) =>
      ipcRenderer.invoke('miniapp-view:reload', input) as Promise<boolean>,
    close: (viewKey: string) =>
      ipcRenderer.invoke('miniapp-view:close', viewKey) as Promise<boolean>
  }
})
