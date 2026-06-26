import { app, BrowserWindow, WebContentsView, dialog, globalShortcut, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

type WorkspaceMeta = {
  workspacePath: string
  notesPath: string
  assetsPath: string
  inboxPath: string
  sourcesPath: string
  appDataPath: string
}
ipcMain.handle("notes:rename", async (_event, oldPath: string, newName: string) => {
  const dir = path.dirname(oldPath)
  const newPath = path.join(dir, newName)
  await fs.rename(oldPath, newPath)
  return newPath
})

ipcMain.handle("notes:move", async (_event, oldPath: string, workspacePath: string, relativeDir: string) => {
  const notesPath = path.join(workspacePath, 'notes')
  const targetDir = path.resolve(notesPath, relativeDir || '')
  const resolvedNotesPath = path.resolve(notesPath)

  if (targetDir !== resolvedNotesPath && !targetDir.startsWith(resolvedNotesPath + path.sep)) {
    throw new Error('Target directory is outside notes workspace.')
  }

  const sourcePath = path.resolve(oldPath)
  const targetPath = path.join(targetDir, path.basename(oldPath))

  if (sourcePath === path.resolve(targetPath)) {
    return oldPath
  }

  const stat = await fs.stat(oldPath)
  if (stat.isDirectory()) {
    const resolvedTargetPath = path.resolve(targetPath)
    if (resolvedTargetPath.startsWith(sourcePath + path.sep)) {
      throw new Error('Cannot move a folder into itself.')
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.rename(oldPath, targetPath)
  return targetPath
})

ipcMain.handle("notes:delete", async (_event, targetPath: string) => {
  const stat = await fs.stat(targetPath)
  if (stat.isDirectory()) {
    await fs.rm(targetPath, { recursive: true, force: true })
  } else {
    await fs.unlink(targetPath)
  }
  return true
})


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

const defaultMiniapps: MiniappSource[] = [
  {
    id: 'preset-chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    icon: 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'preset-claude',
    name: 'Claude',
    url: 'https://claude.ai/',
    icon: 'https://www.google.com/s2/favicons?domain=claude.ai&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'preset-gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    icon: 'https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'preset-perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    icon: 'https://www.google.com/s2/favicons?domain=www.perplexity.ai&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'preset-v0',
    name: 'v0',
    url: 'https://v0.dev/',
    icon: 'https://www.google.com/s2/favicons?domain=v0.dev&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'preset-cursor',
    name: 'Cursor',
    url: 'https://cursor.com/',
    icon: 'https://www.google.com/s2/favicons?domain=cursor.com&sz=64',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
]

const defaultPreferences: AppPreferences = {
  theme: 'system',
  accent: 'purple',
  sidebarPosition: 'left',
  startupPage: 'last',
  language: 'zh-CN',
  editorFontSize: 15,
  editorDefaultMode: 'edit',
  floatNoteShortcut: 'Alt+Space'
}

let mainWindow: BrowserWindow | null = null
let floatNoteWindow: BrowserWindow | null = null
let activeFloatNoteShortcut = ''
let systemAppsCache: { createdAt: number; apps: SystemAppEntry[] } | null = null
type MiniappViewEntry = {
  view: WebContentsView
  initialUrl: string
  partition: string
}

const miniappViews = new Map<string, MiniappViewEntry>()
let activeMiniappViewKey = ''

type ViewBounds = {
  x: number
  y: number
  width: number
  height: number
}

function normalizeBounds(bounds: ViewBounds): ViewBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  }
}

function detachActiveMiniappView() {
  if (!mainWindow || !activeMiniappViewKey) return

  const activeEntry = miniappViews.get(activeMiniappViewKey)
  if (activeEntry) {
    mainWindow.contentView.removeChildView(activeEntry.view)
  }
  activeMiniappViewKey = ''
}

function destroyMiniappViews() {
  detachActiveMiniappView()
  for (const entry of miniappViews.values()) {
    entry.view.webContents.close()
  }
  miniappViews.clear()
}

function createMiniappView(url: string, partition: string): MiniappViewEntry {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition
    }
  })

  view.setBackgroundColor('#ffffff')
  view.webContents.setWindowOpenHandler((details) => {
    view.webContents.loadURL(details.url).catch(() => undefined)
    return { action: 'deny' }
  })
  void view.webContents.loadURL(url)

  return { view, initialUrl: url, partition }
}

function ensureMiniappView(viewKey: string, url: string, partition: string) {
  const existingEntry = miniappViews.get(viewKey)
  if (existingEntry) return existingEntry

  const entry = createMiniappView(url, partition)
  miniappViews.set(viewKey, entry)
  return entry
}

function showMiniappView(viewKey: string, url: string, partition: string, bounds: ViewBounds) {
  if (!mainWindow) return

  const entry = ensureMiniappView(viewKey, url, partition)
  const view = entry.view
  view.setBounds(normalizeBounds(bounds))

  if (activeMiniappViewKey !== viewKey) {
    detachActiveMiniappView()
    mainWindow.contentView.addChildView(view)
    activeMiniappViewKey = viewKey
  }

  view.setVisible(true)
}

function reloadMiniappView(viewKey: string, url: string) {
  const entry = miniappViews.get(viewKey)
  if (!entry) return false

  entry.initialUrl = url
  void entry.view.webContents.loadURL(url)
  return true
}

function closeMiniappView(viewKey: string) {
  const entry = miniappViews.get(viewKey)
  if (!entry) return false

  if (activeMiniappViewKey === viewKey) {
    detachActiveMiniappView()
  }
  entry.view.webContents.close()
  miniappViews.delete(viewKey)
  return true
}

function getDefaultWorkspacePath() {
  return path.join(os.homedir(), 'OneMindWorkspace')
}

async function ensureWorkspaceStructure(workspacePath: string): Promise<WorkspaceMeta> {
  const notesPath = path.join(workspacePath, 'notes')
  const assetsPath = path.join(workspacePath, 'assets')
  const inboxPath = path.join(workspacePath, 'inbox')
  const sourcesPath = path.join(workspacePath, 'sources')
  const appDataPath = path.join(workspacePath, '.onemind')

  await Promise.all([
    fs.mkdir(notesPath, { recursive: true }),
    fs.mkdir(assetsPath, { recursive: true }),
    fs.mkdir(inboxPath, { recursive: true }),
    fs.mkdir(sourcesPath, { recursive: true }),
    fs.mkdir(path.join(appDataPath, 'logs'), { recursive: true }),
    fs.mkdir(path.join(appDataPath, 'cache'), { recursive: true }),
    fs.mkdir(path.join(appDataPath, 'snapshots'), { recursive: true })
  ])

  const settingsFile = path.join(appDataPath, 'settings.json')
  try {
    await fs.access(settingsFile)
  } catch {
    await fs.writeFile(
      settingsFile,
      JSON.stringify(
        {
          workspacePath,
          createdAt: new Date().toISOString(),
          version: 1
        },
        null,
        2
      ),
      'utf8'
    )
  }

  return {
    workspacePath,
    notesPath,
    assetsPath,
    inboxPath,
    sourcesPath,
    appDataPath
  }
}

async function readNoteTree(dirPath: string, rootPath: string): Promise<NoteTreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.name.toLowerCase().endsWith('.md'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        const relativePath = path.relative(rootPath, fullPath)

        if (entry.isDirectory()) {
          return {
            id: relativePath || entry.name,
            name: entry.name,
            path: fullPath,
            type: 'directory' as const,
            children: await readNoteTree(fullPath, rootPath)
          }
        }

        return {
          id: relativePath,
          name: entry.name,
          path: fullPath,
          type: 'file' as const
        }
      })
  )

  return nodes
}

async function readNoteDirectories(
  dirPath: string,
  rootPath: string,
  result: string[] = []
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(rootPath, fullPath).replaceAll('\\', '/')
    result.push(relativePath)
    await readNoteDirectories(fullPath, rootPath, result)
  }

  return result.sort((a, b) => a.localeCompare(b))
}

async function getQuickNotesFile(workspacePath: string) {
  const inboxPath = path.join(workspacePath, 'inbox')
  await fs.mkdir(inboxPath, { recursive: true })
  return path.join(inboxPath, 'quick-notes.json')
}

async function readQuickNotes(workspacePath: string): Promise<QuickNote[]> {
  const filePath = await getQuickNotesFile(workspacePath)

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as QuickNote[]
    return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

async function getMiniappsFile(workspacePath: string) {
  const sourcesPath = path.join(workspacePath, 'sources')
  await fs.mkdir(sourcesPath, { recursive: true })
  return path.join(sourcesPath, 'miniapps.json')
}

function resolveMiniappIconUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  } catch {
    return ''
  }
}

function normalizeMiniappSource(item: MiniappSource): MiniappSource {
  const fallbackIcon = resolveMiniappIconUrl(item.url)
  const hasImageIcon = Boolean(item.icon && /^https?:\/\//i.test(item.icon))
  return {
    ...item,
    icon: hasImageIcon ? item.icon : fallbackIcon
  }
}

async function readMiniapps(workspacePath: string): Promise<MiniappSource[]> {
  const filePath = await getMiniappsFile(workspacePath)

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return (JSON.parse(raw) as MiniappSource[]).map(normalizeMiniappSource)
  } catch {
    const next = defaultMiniapps.map(normalizeMiniappSource)
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}

async function writeMiniapps(workspacePath: string, miniapps: MiniappSource[]) {
  const filePath = await getMiniappsFile(workspacePath)
  await fs.writeFile(filePath, JSON.stringify(miniapps, null, 2), 'utf8')
  return miniapps
}

async function getPreferencesFile(workspacePath: string) {
  const appDataPath = path.join(workspacePath, '.onemind')
  await fs.mkdir(appDataPath, { recursive: true })
  return path.join(appDataPath, 'preferences.json')
}

async function readPreferences(workspacePath: string): Promise<AppPreferences> {
  const filePath = await getPreferencesFile(workspacePath)

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return { ...defaultPreferences, ...(JSON.parse(raw) as Partial<AppPreferences>) }
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultPreferences, null, 2), 'utf8')
    return defaultPreferences
  }
}

async function writePreferences(workspacePath: string, preferences: AppPreferences) {
  const filePath = await getPreferencesFile(workspacePath)
  const next = { ...defaultPreferences, ...preferences }
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
  registerFloatNoteShortcut(next.floatNoteShortcut)
  return next
}

async function walkShortcutFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        result.push(...(await walkShortcutFiles(fullPath)))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
        result.push(fullPath)
      }
    }
    return result
  } catch {
    return []
  }
}

function normalizeSystemAppName(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/\s+-\s+快捷方式$/i, '').trim()
}

async function scanSystemApps(): Promise<SystemAppEntry[]> {
  if (systemAppsCache && Date.now() - systemAppsCache.createdAt < 10 * 60 * 1000) {
    return systemAppsCache.apps
  }

  const startMenuDirs = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ]
  const shortcutPaths = (await Promise.all(startMenuDirs.map(walkShortcutFiles))).flat()
  const appMap = new Map<string, SystemAppEntry>()

  for (const shortcutPath of shortcutPaths) {
    const name = normalizeSystemAppName(shortcutPath)
    if (!name) continue
    const id = shortcutPath.toLowerCase()
    if (appMap.has(id)) continue
    let targetPath = ''
    let iconPath = ''
    try {
      const shortcut = shell.readShortcutLink(shortcutPath)
      targetPath = shortcut.target || ''
      iconPath = shortcut.icon || ''
    } catch {
      // Some shortcuts are not readable; keep the .lnk so Windows can still open it.
    }
    appMap.set(id, {
      id,
      name,
      path: shortcutPath,
      targetPath,
      iconPath,
      source: 'start-menu'
    })
  }

  const apps = [...appMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  systemAppsCache = { createdAt: Date.now(), apps }
  return apps
}

async function getRecentSystemAppsFile(workspacePath: string) {
  const appDataPath = path.join(workspacePath, '.onemind')
  await fs.mkdir(appDataPath, { recursive: true })
  return path.join(appDataPath, 'recent-system-apps.json')
}

async function readRecentSystemApps(workspacePath: string): Promise<SystemAppEntry[]> {
  const filePath = await getRecentSystemAppsFile(workspacePath)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return (JSON.parse(raw) as SystemAppEntry[]).sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
  } catch {
    return []
  }
}

async function writeRecentSystemApp(workspacePath: string, appEntry: SystemAppEntry) {
  const filePath = await getRecentSystemAppsFile(workspacePath)
  const recent = await readRecentSystemApps(workspacePath)
  const next = [
    { ...appEntry, source: 'recent' as const, lastUsedAt: new Date().toISOString() },
    ...recent.filter((item) => item.path !== appEntry.path)
  ].slice(0, 24)
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
  return next
}

function filterSystemApps(apps: SystemAppEntry[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return apps.slice(0, 12)
  return apps
    .map((appEntry) => {
      const name = appEntry.name.toLowerCase()
      const index = name.indexOf(normalizedQuery)
      const score = index === 0 ? 0 : index > 0 ? 1 : name.includes(normalizedQuery) ? 2 : 9
      return { appEntry, score }
    })
    .filter((item) => item.score < 9)
    .sort((a, b) => a.score - b.score || a.appEntry.name.localeCompare(b.appEntry.name))
    .map((item) => item.appEntry)
    .slice(0, 12)
}

async function withSystemAppIcons(apps: SystemAppEntry[]) {
  return Promise.all(
    apps.map(async (appEntry) => {
      const iconCandidates = [appEntry.iconPath, appEntry.targetPath, appEntry.path].filter(Boolean) as string[]
      for (const iconPath of iconCandidates) {
        try {
          const icon = await app.getFileIcon(iconPath, { size: 'normal' })
          const iconData = icon.toDataURL()
          if (iconData) return { ...appEntry, icon: iconData }
        } catch {
          // Try the next candidate.
        }
      }
      return appEntry
    })
  )
}

function mergeRecentSystemApps(recent: SystemAppEntry[], apps: SystemAppEntry[]) {
  const appByPath = new Map(apps.map((appEntry) => [appEntry.path, appEntry]))
  return recent.map((recentEntry) => {
    const scanned = appByPath.get(recentEntry.path)
    return scanned ? { ...scanned, source: 'recent' as const, lastUsedAt: recentEntry.lastUsedAt } : recentEntry
  })
}

function getRendererUrl(route = '') {
  if (isDev) {
    return `http://127.0.0.1:5173${route}`
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer/index.html')
  }
  return path.join(__dirname, '../../renderer/dist/index.html')
}

async function loadRendererWindow(window: BrowserWindow, route = '') {
  if (isDev) {
    await window.loadURL(getRendererUrl(route))
    return
  }

  await window.loadFile(getRendererUrl(), route ? { hash: route.replace(/^#?\/?/, '/') } : undefined)
}

async function ensureFloatNoteWindow() {
  if (floatNoteWindow && !floatNoteWindow.isDestroyed()) return floatNoteWindow

  floatNoteWindow = new BrowserWindow({
    width: 724,
    height: 136,
    minWidth: 520,
    minHeight: 110,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'OneMind Float Note',
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  floatNoteWindow.setMenuBarVisibility(false)
  floatNoteWindow.setHasShadow(false)

  floatNoteWindow.on('blur', () => {
    floatNoteWindow?.hide()
  })
  floatNoteWindow.on('closed', () => {
    floatNoteWindow = null
  })

  await loadRendererWindow(floatNoteWindow, '#/float-note')
  return floatNoteWindow
}

async function showFloatNoteWindow() {
  const win = await ensureFloatNoteWindow()
  const display = mainWindow?.getBounds()
  if (display) {
    const bounds = win.getBounds()
    win.setBounds({
      x: Math.round(display.x + display.width / 2 - bounds.width / 2),
      y: Math.round(display.y + Math.max(80, display.height * 0.18)),
      width: bounds.width,
      height: bounds.height
    })
  }
  win.show()
  win.focus()
  win.webContents.send('float-note:shown')
}

function hideFloatNoteWindow() {
  floatNoteWindow?.hide()
}

function registerFloatNoteShortcut(shortcut: string) {
  if (activeFloatNoteShortcut) {
    globalShortcut.unregister(activeFloatNoteShortcut)
    activeFloatNoteShortcut = ''
  }

  const nextShortcut = shortcut.trim() || defaultPreferences.floatNoteShortcut
  const registered = globalShortcut.register(nextShortcut, () => {
    void showFloatNoteWindow()
  })
  if (registered) {
    activeFloatNoteShortcut = nextShortcut
  }
  return registered
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 720,
    title: 'OneMind',
    frame: false,
    backgroundColor: '#11151c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  if (isDev) {
    await loadRendererWindow(mainWindow)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await loadRendererWindow(mainWindow)
  }

  mainWindow.on('closed', () => {
    destroyMiniappViews()
    mainWindow = null
  })
}

ipcMain.handle('workspace:get-default-path', async () => getDefaultWorkspacePath())

ipcMain.handle('window:minimize', async () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:toggle-maximize', async () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return
  }
  mainWindow.maximize()
})

ipcMain.handle('window:close', async () => {
  mainWindow?.close()
})

ipcMain.handle('float-note:show', async () => {
  await showFloatNoteWindow()
  return true
})

ipcMain.handle('float-note:hide', async () => {
  hideFloatNoteWindow()
  return true
})

ipcMain.handle('float-note:set-height', async (_event, height: number) => {
  if (!floatNoteWindow) return false
  const bounds = floatNoteWindow.getBounds()
  floatNoteWindow.setBounds({ ...bounds, height: Math.max(126, Math.min(520, Math.round(height))) })
  return true
})

ipcMain.handle('float-note:register-shortcut', async (_event, shortcut: string) => {
  return registerFloatNoteShortcut(shortcut)
})

ipcMain.handle('float-note:open-route', async (_event, route: string) => {
  if (!mainWindow) {
    await createWindow()
  }
  mainWindow?.show()
  mainWindow?.focus()
  if (route) {
    mainWindow?.webContents.send('app:navigate', route)
  }
  hideFloatNoteWindow()
  return true
})

ipcMain.handle('workspace:select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getDefaultWorkspacePath(),
    title: 'Select OneMind Workspace'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return ensureWorkspaceStructure(result.filePaths[0])
})

ipcMain.handle('workspace:init-default', async () => {
  return ensureWorkspaceStructure(getDefaultWorkspacePath())
})

ipcMain.handle('notes:list', async (_event, workspacePath: string) => {
  const notesPath = path.join(workspacePath, 'notes')
  await fs.mkdir(notesPath, { recursive: true })
  return readNoteTree(notesPath, notesPath)
})

ipcMain.handle('notes:list-directories', async (_event, workspacePath: string) => {
  const notesPath = path.join(workspacePath, 'notes')
  await fs.mkdir(notesPath, { recursive: true })
  return readNoteDirectories(notesPath, notesPath)
})

ipcMain.handle('notes:read', async (_event, filePath: string) => {
  return fs.readFile(filePath, 'utf8')
})

ipcMain.handle('notes:write', async (_event, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8')
  return true
})

ipcMain.handle(
  'notes:create-file',
  async (_event, workspacePath: string, relativeDir: string, name: string) => {
    const notesPath = path.join(workspacePath, 'notes')
    const targetDir = path.join(notesPath, relativeDir)
    await fs.mkdir(targetDir, { recursive: true })

    const normalizedName = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`
    const filePath = path.join(targetDir, normalizedName)

    await fs.writeFile(filePath, `# ${normalizedName.replace(/\.md$/i, '')}\n\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })

    return filePath
  }
)

ipcMain.handle(
  'notes:create-from-quick-note',
  async (_event, workspacePath: string, relativeDir: string, name: string, content: string) => {
    const notesPath = path.join(workspacePath, 'notes')
    const targetDir = path.join(notesPath, relativeDir)
    await fs.mkdir(targetDir, { recursive: true })

    const normalizedName = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`
    const filePath = path.join(targetDir, normalizedName)
    const title = normalizedName.replace(/\.md$/i, '')
    const body = content.trim()
    const markdown = `# ${title}\n\n${body}\n`

    await fs.writeFile(filePath, markdown, {
      encoding: 'utf8',
      flag: 'wx'
    })

    return filePath
  }
)

ipcMain.handle(
  'notes:create-folder',
  async (_event, workspacePath: string, relativeDir: string, name: string) => {
    const notesPath = path.join(workspacePath, 'notes')
    const targetDir = path.join(notesPath, relativeDir, name.trim())
    await fs.mkdir(targetDir, { recursive: false })
    return targetDir
  }
)

ipcMain.handle('quick-notes:list', async (_event, workspacePath: string) => {
  return readQuickNotes(workspacePath)
})

ipcMain.handle('quick-notes:create', async (_event, workspacePath: string, content: string) => {
  const nextContent = content.trim()
  if (!nextContent) {
    throw new Error('Quick note content cannot be empty.')
  }

  const filePath = await getQuickNotesFile(workspacePath)
  const notes = await readQuickNotes(workspacePath)
  const item: QuickNote = {
    id: `qn-${Date.now()}`,
    content: nextContent,
    createdAt: new Date().toISOString()
  }

  const nextNotes = [item, ...notes]
  await fs.writeFile(filePath, JSON.stringify(nextNotes, null, 2), 'utf8')
  return item
})

ipcMain.handle('miniapps:list', async (_event, workspacePath: string) => {
  return readMiniapps(workspacePath)
})

ipcMain.handle('miniapps:create', async (_event, workspacePath: string, input: { name: string; url: string }) => {
  const name = input.name.trim()
  const url = input.url.trim()

  if (!name || !url) {
    throw new Error('Miniapp name and url are required.')
  }

  const filePath = await getMiniappsFile(workspacePath)
  const current = await readMiniapps(workspacePath)
  const item: MiniappSource = {
    id: `miniapp-${Date.now()}`,
    name,
    url,
    icon: resolveMiniappIconUrl(url),
    createdAt: new Date().toISOString()
  }

  const next = [...current, item]
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
  return item
})

ipcMain.handle(
  'miniapps:update',
  async (_event, workspacePath: string, id: string, input: { name: string; url: string }) => {
    const name = input.name.trim()
    const url = input.url.trim()
    if (!name || !url) {
      throw new Error('Miniapp name and url are required.')
    }

    const current = await readMiniapps(workspacePath)
    const next = current.map((item) => (
      item.id === id ? { ...item, name, url, icon: resolveMiniappIconUrl(url) } : item
    ))
    await writeMiniapps(workspacePath, next)
    return next.find((item) => item.id === id) ?? null
  }
)

ipcMain.handle('miniapps:delete', async (_event, workspacePath: string, id: string) => {
  const current = await readMiniapps(workspacePath)
  const next = current.filter((item) => item.id !== id)
  await writeMiniapps(workspacePath, next)
  return true
})

ipcMain.handle('preferences:read', async (_event, workspacePath: string) => {
  return readPreferences(workspacePath)
})

ipcMain.handle('preferences:write', async (_event, workspacePath: string, preferences: AppPreferences) => {
  return writePreferences(workspacePath, preferences)
})

ipcMain.handle('system-apps:search', async (_event, workspacePath: string, query: string) => {
  const apps = await scanSystemApps()
  if (query.trim()) return withSystemAppIcons(filterSystemApps(apps, query))

  const recent = mergeRecentSystemApps(await readRecentSystemApps(workspacePath), apps)
  const recentPaths = new Set(recent.map((item) => item.path))
  return withSystemAppIcons([
    ...recent,
    ...apps.filter((item) => !recentPaths.has(item.path)).slice(0, Math.max(0, 12 - recent.length))
  ].slice(0, 12))
})

ipcMain.handle('system-apps:open', async (_event, workspacePath: string, appEntry: SystemAppEntry) => {
  const error = await shell.openPath(appEntry.path)
  if (error) {
    throw new Error(error)
  }
  const [appWithIcon] = await withSystemAppIcons([appEntry])
  await writeRecentSystemApp(workspacePath, appWithIcon)
  hideFloatNoteWindow()
  return true
})

ipcMain.handle(
  'miniapp-view:show',
  async (_event, input: { viewKey: string; url: string; partition: string; bounds: ViewBounds }) => {
    showMiniappView(input.viewKey, input.url, input.partition, input.bounds)
    return true
  }
)

ipcMain.handle('miniapp-view:set-bounds', async (_event, bounds: ViewBounds) => {
  const activeEntry = miniappViews.get(activeMiniappViewKey)
  if (!activeEntry) return false
  activeEntry.view.setBounds(normalizeBounds(bounds))
  return true
})

ipcMain.handle('miniapp-view:hide', async () => {
  detachActiveMiniappView()
  return true
})

ipcMain.handle('miniapp-view:reload', async (_event, input: { viewKey: string; url: string }) => {
  return reloadMiniappView(input.viewKey, input.url)
})

ipcMain.handle('miniapp-view:close', async (_event, viewKey: string) => {
  return closeMiniappView(viewKey)
})

app.whenReady().then(async () => {
  await createWindow()
  const workspace = await ensureWorkspaceStructure(getDefaultWorkspacePath())
  const preferences = await readPreferences(workspace.workspacePath)
  registerFloatNoteShortcut(preferences.floatNoteShortcut)
  setTimeout(() => {
    void ensureFloatNoteWindow()
  }, 800)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
