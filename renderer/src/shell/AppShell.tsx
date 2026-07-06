import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ContextMenu, type ContextMenuItem } from "./ContextMenu"
import { trackActivity } from "../activity"
import type { LucideIcon } from "../icons"
import {
  ChevronRight,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  Home,
  Image,
  MoveRight,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Settings,
  Trash2,
  X,
  Zap
} from "../icons"

interface Tab {
  id: string
  path: string
  label: string
}

const SIDEBAR_STORAGE_KEY = "onemind-sidebar-collapsed"
const SIDEBAR_WIDTH_STORAGE_KEY = "onemind-sidebar-width"
const SIDEBAR_MIN_WIDTH = 204
const SIDEBAR_MAX_WIDTH = 360

function applyPreferences(preferences: AppPreferences) {
  const root = document.documentElement
  if (preferences.theme === "system") {
    root.removeAttribute("data-theme")
  } else {
    root.setAttribute("data-theme", preferences.theme)
  }
  root.dataset.accent = preferences.accent
  root.dataset.sidebarPosition = preferences.sidebarPosition
  root.style.setProperty("--md-editor-font-size", `${preferences.editorFontSize}px`)
}

async function activateShellPreferences(preferences: AppPreferences) {
  applyPreferences(preferences)
  try {
    await window.oneMind.floatNote.registerShortcut(preferences.floatNoteShortcut)
  } catch (error) {
    console.warn("Failed to register float note shortcut:", error)
  }
}

const routeLabels: Record<string, string> = {
  "/home": "首页",
  "/capture": "随记",
  "/file-viewer": "文件",
  "/notes": "笔记",
  "/sources": "小程序",
  "/settings": "设置",
  "/search": "搜索"
}

const sidebarIcons: Array<{
  scene: string
  accent: "primary" | "secondary"
  tooltip: string
  icon: LucideIcon
}> = [
  {
    scene: "home",
    accent: "primary",
    tooltip: "首页",
    icon: Home
  },
  {
    scene: "capture",
    accent: "primary",
    tooltip: "随记",
    icon: Zap
  },
  {
    scene: "notes",
    accent: "primary",
    tooltip: "笔记",
    icon: NotebookText
  },
  {
    scene: "sources",
    accent: "secondary",
    tooltip: "小程序",
    icon: Grid3X3
  },
  {
    scene: "settings",
    accent: "primary",
    tooltip: "设置",
    icon: Settings
  }
]

function writeShellInteractionLog(message: string, context?: string) {
  void window.oneMind?.diagnostics?.writeLog("renderer-debug", message, context).catch((error: unknown) => {
    console.warn("Failed to write shell interaction log:", error)
  })
}

function runWindowAction(name: "minimize" | "maximize" | "close", action: () => Promise<void>) {
  writeShellInteractionLog("titlebar_window_action_start", `action=${name}`)
  void action()
    .then(() => {
      writeShellInteractionLog("titlebar_window_action_done", `action=${name}`)
    })
    .catch((error: unknown) => {
      writeShellInteractionLog("titlebar_window_action_failed", `action=${name} error=${String(error)}`)
      console.warn(`Failed to run titlebar action ${name}:`, error)
    })
}

function normalizeRoutePath(path: string) {
  return path === "/" ? "/home" : path
}

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function getInitialSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"
}

function getInitialSidebarWidth() {
  const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
  return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : 204
}

function FolderArrow() {
  return (
    <span className="tree-folder-arrow">
      <ChevronRight size={10} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

function FolderIcon() {
  return (
    <span className="tree-folder-icon">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          className="tree-folder-icon-tab"
          d="M1.8 4.4C1.8 3.6 2.45 3 3.22 3h3.1c.44 0 .86.2 1.13.55l.63.82h4.62c.82 0 1.48.66 1.48 1.48v.65H1.8V4.4Z"
        />
        <path
          className="tree-folder-icon-body"
          d="M1.55 6.15c.07-.7.67-1.23 1.37-1.23h10.16c.79 0 1.41.67 1.35 1.46l-.42 5.14c-.06.72-.66 1.28-1.38 1.28H3.13c-.72 0-1.32-.56-1.38-1.28l-.2-5.37Z"
        />
      </svg>
    </span>
  )
}

function FileIcon() {
  return (
    <span className="tree-file-icon">
      <FileText size={14} strokeWidth={1.7} aria-hidden="true" />
    </span>
  )
}

function ImageFileIcon() {
  return (
    <span className="tree-file-icon">
      <Image size={14} strokeWidth={1.7} aria-hidden="true" />
    </span>
  )
}

function isMarkdownPath(path: string) {
  return path.toLowerCase().endsWith(".md")
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])

function getFileName(path: string) {
  return path.split(/[/\\]/).pop() || path
}

function isImagePath(path: string) {
  const name = getFileName(path)
  const index = name.lastIndexOf(".")
  return index >= 0 && imageExtensions.has(name.slice(index).toLowerCase())
}

function getTabLabel(pathname: string, search: string) {
  const params = new URLSearchParams(search)
  const routeTitle = params.get("title")
  if (routeTitle) return routeTitle

  if (pathname === "/notes") {
    const selectedPath = params.get("selected")
    if (selectedPath) return getFileName(selectedPath)
  }

  if (pathname === "/file-viewer") {
    const filePath = params.get("path")
    if (filePath) return getFileName(filePath)
  }

  return routeLabels[pathname] || "页面"
}

function createTabFromRoute(routePath: string): Tab | null {
  const [rawPathname, rawSearch = ""] = routePath.split("?")
  const pathname = normalizeRoutePath(rawPathname)
  if (pathname === "/home") return null
  const search = rawSearch ? `?${rawSearch}` : ""
  const path = pathname + search
  return {
    id: path,
    path,
    label: getTabLabel(pathname, search)
  }
}

function upsertTab(tabs: Tab[], nextTab: Tab | null) {
  if (!nextTab) return tabs.filter(tab => normalizeRoutePath(tab.path.split("?")[0]) !== "/home")
  const withoutHome = tabs.filter(tab => normalizeRoutePath(tab.path.split("?")[0]) !== "/home")
  const exists = withoutHome.some(tab => tab.path === nextTab.path)
  if (exists) {
    return withoutHome.map(tab => tab.path === nextTab.path ? nextTab : tab)
  }
  return [...withoutHome, nextTab]
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const initialPathRef = useRef(location.pathname)
  const [workspace, setWorkspace] = useState<WorkspaceMeta | null>(null)
  const [defaultPath, setDefaultPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [bridgeError, setBridgeError] = useState("")
  const [tabs, setTabs] = useState<Tab[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth)
  const sidebarWidthRef = useRef(204)
  const [notesSearchExpanded, setNotesSearchExpanded] = useState(false)
  const [notesSearchQuery, setNotesSearchQuery] = useState("")
  const notesSearchRef = useRef<HTMLInputElement | null>(null)
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([])
  const [selectedSidebarPath, setSelectedSidebarPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetNode: NoteTreeNode | null } | null>(null)
  const [renameTarget, setRenameTarget] = useState<NoteTreeNode | null>(null)
  const [nameValue, setNameValue] = useState('')
  const [createDialog, setCreateDialog] = useState<{ type: 'file' | 'folder'; dirPath: string } | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [moveTarget, setMoveTarget] = useState<NoteTreeNode | null>(null)
  const [directoryList, setDirectoryList] = useState<string[]>([])
  const [draggingNode, setDraggingNode] = useState<NoteTreeNode | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const activeFilePath = location.pathname === "/file-viewer"
    ? new URLSearchParams(location.search).get("path")
    : null

  // Bridge init + auto-init default workspace
  useEffect(() => {
    let cancelled = false

    async function initBridge() {
      const bridge = window.oneMind
      if (!bridge?.workspace || bridge.runtime?.bridgeReady === false) {
        setBridgeReady(false)
        setBridgeError("当前桌面外壳尚未接入 OneMind 原生能力。")
        return
      }
      setBridgeReady(true)
      setBridgeError("")
      const defaultPath = await bridge.workspace.getDefaultPath()
      if (cancelled) return
      setDefaultPath(defaultPath)
      try {
        const ws = await bridge.workspace.initDefault()
        if (cancelled) return
        setWorkspace(ws)
        const preferences = await bridge.preferences.read(ws.workspacePath)
        if (cancelled) return
        await activateShellPreferences(preferences)
        if (cancelled) return
        if (initialPathRef.current === "/" || initialPathRef.current === "/home") {
          if (preferences.startupPage === "notes") {
            navigate("/notes")
          } else if (preferences.startupPage === "sources") {
            navigate("/sources")
          }
        }
      } catch (err) {
        console.warn("Auto-init workspace failed, user can create manually:", err)
      }
    }

    void initBridge()
    window.addEventListener("oneMindBridgeReady", initBridge)
    return () => {
      cancelled = true
      window.removeEventListener("oneMindBridgeReady", initBridge)
    }
  }, [navigate])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const currentRoutePath = normalizeRoutePath(location.pathname) + location.search
  const activeTabPath = currentRoutePath
  const visibleTabs = useMemo(() => upsertTab(tabs, createTabFromRoute(currentRoutePath)), [currentRoutePath, tabs])

  useEffect(() => {
    if (location.pathname === "/sources") return
    writeShellInteractionLog(
      "miniapp_hide_on_route_leave",
      `pathname=${location.pathname} search=${location.search || ""}`
    )
    void window.oneMind.miniappView.hide().catch((error: unknown) => {
      writeShellInteractionLog(
        "miniapp_hide_on_route_leave_failed",
        `pathname=${location.pathname} error=${String(error)}`
      )
    })
  }, [location.pathname, location.search])

  // Load sidebar data
  useEffect(() => {
    async function load() {
      if (!workspace) { setNoteTree([]); return }
      const nextTree = await window.oneMind.notes.list(workspace.workspacePath)
      setNoteTree(nextTree)
    }
    void load()
  }, [workspace])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  // Keyboard shortcuts for sidebar collapse
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? ""
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable

      // Ctrl+\ or Ctrl+B (only when not in input for Ctrl+B)
      if ((e.key === "\\" || e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey)) {
        if ((e.key === "b" || e.key === "B") && isInput) return
        e.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  const startSidebarResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const sidebarPosition = document.documentElement.dataset.sidebarPosition

    function handlePointerMove(moveEvent: PointerEvent) {
      const delta = sidebarPosition === "right"
        ? startX - moveEvent.clientX
        : moveEvent.clientX - startX
      setSidebarWidth(clampSidebarWidth(startWidth + delta))
    }

    function handlePointerUp() {
      document.removeEventListener("pointermove", handlePointerMove)
      document.removeEventListener("pointerup", handlePointerUp)
      document.body.classList.remove("sidebar-resizing")
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(sidebarWidthRef.current)))
    }

    document.body.classList.add("sidebar-resizing")
    document.addEventListener("pointermove", handlePointerMove)
    document.addEventListener("pointerup", handlePointerUp)
  }, [sidebarCollapsed, sidebarWidth])

  const handleTabsWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  const expandNotesSearch = useCallback(() => {
    setNotesSearchExpanded(true)
    window.requestAnimationFrame(() => notesSearchRef.current?.focus())
  }, [])

  const collapseNotesSearchIfEmpty = useCallback(() => {
    if (!notesSearchQuery.trim()) {
      setNotesSearchExpanded(false)
    }
  }, [notesSearchQuery])

  const openRoute = useCallback((path: string) => {
    const nextRoutePath = normalizeRoutePath(path)
    if (nextRoutePath.split("?")[0] !== "/sources") {
      writeShellInteractionLog("miniapp_hide_before_route_open", `from=${currentRoutePath} to=${nextRoutePath}`)
      void window.oneMind.miniappView.hide().catch((error: unknown) => {
        writeShellInteractionLog("miniapp_hide_before_route_open_failed", `to=${nextRoutePath} error=${String(error)}`)
      })
    }
    setTabs(prev => upsertTab(upsertTab(prev, createTabFromRoute(currentRoutePath)), createTabFromRoute(nextRoutePath)))
    navigate(nextRoutePath)
  }, [currentRoutePath, navigate])

  useEffect(() => {
    return window.oneMind.window.onNavigate((route) => {
      openRoute(route)
    })
  }, [openRoute])

  function openNoteFile(filePath: string) {
    setSelectedSidebarPath(filePath)
    navigate("/notes?selected=" + encodeURIComponent(filePath))
  }

  async function openTreeFile(filePath: string) {
    if (isMarkdownPath(filePath)) {
      openNoteFile(filePath)
      return
    }
    if (isImagePath(filePath) && workspace) {
      const params = new URLSearchParams({
        path: filePath,
        workspace: workspace.workspacePath,
        title: getFileName(filePath)
      })
      navigate("/file-viewer?" + params.toString())
      return
    }
    if (!workspace) return
    try {
      await window.oneMind.notes.openFile(filePath, workspace.workspacePath)
    } catch (error) {
      console.error("Open file failed:", error)
    }
  }

  function getRelativeNoteDir(dirPath: string) {
    if (!workspace) return ""
    return dirPath
      .replace(workspace.notesPath, "")
      .replace(/^[/\\]/, "")
      .replaceAll("\\", "/")
  }

  function getCreationDir(target: NoteTreeNode | null) {
    if (!workspace) return ""
    if (!target) return ""
    if (target.path === workspace.assetsPath || target.path.startsWith(workspace.assetsPath + "\\" ) || target.path.startsWith(workspace.assetsPath + "/")) {
      return ""
    }
    if (target.type === "directory") return getRelativeNoteDir(target.path)
    const parentDir = target.path.replace(/[/\\][^/\\]+$/, "")
    return getRelativeNoteDir(parentDir)
  }

  function isAssetsNode(target: NoteTreeNode | null) {
    if (!workspace || !target) return false
    return target.path === workspace.assetsPath
      || target.path.startsWith(workspace.assetsPath + "\\")
      || target.path.startsWith(workspace.assetsPath + "/")
  }

  async function refreshNoteTree() {
    if (!workspace) return
    const nextTree = await window.oneMind.notes.list(workspace.workspacePath)
    setNoteTree(nextTree)
  }

  async function moveNodeToDirectory(node: NoteTreeNode, relativeDir: string) {
    if (!workspace) return
    try {
      const newPath = await window.oneMind.notes.move(node.path, workspace.workspacePath, relativeDir)
      await refreshNoteTree()
      if (selectedSidebarPath === node.path) {
        setSelectedSidebarPath(newPath)
        if (node.type === "file") {
          navigate("/notes?selected=" + encodeURIComponent(newPath))
        }
      }
    } catch (err) {
      console.error("Move failed:", err)
    } finally {
      setDraggingNode(null)
      setDropTargetPath(null)
    }
  }

  function closeTab(path: string) {
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path)
      const nextVisible = visibleTabs.filter(t => t.path !== path)
      if (activeTabPath === path && nextVisible.length > 0) {
        navigate(nextVisible[nextVisible.length - 1].path)
      } else if (nextVisible.length === 0) {
        navigate("/home")
      }
      return next
    })
  }

  async function handleCreateDefault() {
    if (!window.oneMind?.workspace) return
    setBusy(true)
    try {
      const result = await window.oneMind.workspace.initDefault()
      setWorkspace(result)
      const preferences = await window.oneMind.preferences.read(result.workspacePath)
      await activateShellPreferences(preferences)
    } finally { setBusy(false) }
  }

  async function handleSelectWorkspace() {
    if (!window.oneMind?.workspace) return
    setBusy(true)
    try {
      const result = await window.oneMind.workspace.select()
      if (result) {
        setWorkspace(result)
        const preferences = await window.oneMind.preferences.read(result.workspacePath)
        await activateShellPreferences(preferences)
      }
    } finally { setBusy(false) }
  }

  function handleContextMenu(e: React.MouseEvent, node: NoteTreeNode) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, targetNode: node })
  }

  function handleNotesAreaContextMenu(e: React.MouseEvent) {
    if (!workspace) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, targetNode: null })
  }

  async function handleContextMenuAction(action: string) {
    const target = contextMenu?.targetNode
    const ws = workspace
    if (!ws) return

    switch (action) {
      case 'new-folder': {
        if (isAssetsNode(target ?? null)) return
        setContextMenu(null)
        setNameInput('')
        setCreateDialog({ type: 'folder', dirPath: getCreationDir(target ?? null) })
        break
      }
      case 'new-note': {
        if (isAssetsNode(target ?? null)) return
        setContextMenu(null)
        setNameInput('')
        setCreateDialog({ type: 'file', dirPath: getCreationDir(target ?? null) })
        break
      }
      case 'rename': {
        if (!target) return
        setContextMenu(null)
        setRenameTarget(target)
        setNameValue(target.name)
        break
      }
      case 'delete': {
        if (!target) return
        setContextMenu(null)
        if (window.confirm('确定删除 "' + target.name + '" 吗？')) {
          try {
            await window.oneMind.notes.delete(target.path)
            await refreshNoteTree()
            if (selectedSidebarPath === target.path) {
              setSelectedSidebarPath(null)
            }
          } catch (e) {
            console.error('Delete failed:', e)
          }
        }
        break
      }
      case 'move': {
        if (!target || isAssetsNode(target)) return
        setContextMenu(null)
        const dirs = await window.oneMind.notes.listDirectories(ws.workspacePath)
        setDirectoryList(dirs)
        setNameInput("")
        setMoveTarget(target)
        break
      }
      case 'open-containing-folder': {
        setContextMenu(null)
        const targetPath = target?.path ?? ws.notesPath
        try {
          await window.oneMind.notes.openContainingFolder(targetPath, ws.workspacePath)
        } catch (error) {
          console.error("Open containing folder failed:", error)
        }
        break
      }
    }
  }

  function getContextMenuItems(nodeType: string | null): ContextMenuItem[][] {
    // Tree context menu (prototype Phase 3)
    const target = contextMenu?.targetNode ?? null
    const targetIsAssets = isAssetsNode(target)
    const createItems: ContextMenuItem[] = [
        {
          label: '新建文件夹',
          shortcut: 'Ctrl+Shift+N',
          action: 'new-folder',
          icon: <FolderPlus size={14} strokeWidth={1.8} aria-hidden="true" />
        },
        {
          label: '新建笔记',
          shortcut: 'Ctrl+N',
          action: 'new-note',
          icon: <FilePlus size={14} strokeWidth={1.8} aria-hidden="true" />
        }
      ]

    const openFolderItem: ContextMenuItem = {
      label: '打开所在目录',
      action: 'open-containing-folder',
      icon: <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
    }

    if (!nodeType) return [createItems, [openFolderItem]]

    return [
      ...(targetIsAssets ? [] : [createItems]),
      [
        openFolderItem
      ],
      [
        {
          label: '重命名',
          action: 'rename',
          icon: <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
        },
        {
          label: '删除',
          shortcut: 'Del',
          action: 'delete',
          danger: true,
          icon: <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
        }
      ],
      [
        ...(targetIsAssets ? [] : [{
          label: '移动到…',
          action: 'move',
          icon: <MoveRight size={14} strokeWidth={1.8} aria-hidden="true" />
        }])
      ]
    ]
  }

  function switchScene(scene: string) {
    openRoute("/" + scene)
  }

  function runTitlebarActionFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, action: () => void) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  // Render file tree (prototype style with details/summary)
  function renderFileTree(nodes: NoteTreeNode[]): React.ReactNode {
    if (!nodes || nodes.length === 0) {
      return <div className="notes-empty" style={{ padding: "8px", fontSize: "12px" }}>notes/ 暂无内容</div>
    }
    return (
      <div className="file-tree">
        {nodes.map(node => renderTreeNode(node, 0))}
      </div>
    )
  }

  function handleTreeDragStart(e: React.DragEvent, node: NoteTreeNode) {
    setDraggingNode(node)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", node.path)
  }

  function handleDirectoryDragOver(e: React.DragEvent, node: NoteTreeNode) {
    if (!draggingNode || draggingNode.path === node.path) return
    if (isAssetsNode(node) || isAssetsNode(draggingNode)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    setDropTargetPath(node.path)
  }

  function handleDirectoryDragLeave(e: React.DragEvent, node: NoteTreeNode) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTargetPath(prev => prev === node.path ? null : prev)
    }
  }

  async function handleDirectoryDrop(e: React.DragEvent, node: NoteTreeNode) {
    e.preventDefault()
    e.stopPropagation()
    if (!draggingNode || draggingNode.path === node.path) return
    if (isAssetsNode(node) || isAssetsNode(draggingNode)) return
    await moveNodeToDirectory(draggingNode, getRelativeNoteDir(node.path))
  }

  function handleRootDragOver(e: React.DragEvent) {
    if (!draggingNode) return
    if (isAssetsNode(draggingNode)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTargetPath("__root__")
  }

  async function handleRootDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingNode) return
    if (isAssetsNode(draggingNode)) return
    await moveNodeToDirectory(draggingNode, "")
  }

  function renderTreeNode(node: NoteTreeNode, depth: number): React.ReactNode {
    const inAssets = isAssetsNode(node)
    if (node.type === "directory") {
      const isDropTarget = dropTargetPath === node.path
      return (
        <details
          key={node.id}
          className={"tree-folder" + (isDropTarget ? " drop-target" : "")}
          style={{ "--tree-depth": depth } as React.CSSProperties}
          open
          draggable={!inAssets}
          onDragStart={(e) => handleTreeDragStart(e, node)}
          onDragEnd={() => { setDraggingNode(null); setDropTargetPath(null) }}
        >
          <summary
            onContextMenu={(e) => handleContextMenu(e, node)}
            onDragOver={(e) => handleDirectoryDragOver(e, node)}
            onDragLeave={(e) => handleDirectoryDragLeave(e, node)}
            onDrop={(e) => void handleDirectoryDrop(e, node)}
          >
            <FolderArrow />
            <FolderIcon />
            <span className="tree-node-name">{node.name}</span>
          </summary>
          <div className="tree-file-list">
            {node.children && node.children.length > 0
              ? node.children.map(child => renderTreeNode(child, depth + 1))
              : <div className="tree-empty-folder" style={{ "--tree-depth": depth + 1 } as React.CSSProperties}>空文件夹</div>
            }
          </div>
        </details>
      )
    }
    return (
      <div
        key={node.id}
        className={"tree-file" + (selectedSidebarPath === node.path || activeFilePath === node.path ? " active" : "")}
        style={{ "--tree-depth": depth } as React.CSSProperties}
        data-file-id={node.id}
        draggable={!inAssets}
        onDragStart={(e) => handleTreeDragStart(e, node)}
        onDragEnd={() => { setDraggingNode(null); setDropTargetPath(null) }}
        onClick={() => void openTreeFile(node.path)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        {isMarkdownPath(node.path) ? <FileIcon /> : <ImageFileIcon />}
        <span className="tree-node-name tree-file-name">{node.name}</span>
      </div>
    )
  }

  return (
    <div
      className={"app-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")}
      style={{ "--sidebar-expanded-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <header className="app-chrome">
        <div className="chrome-brand">
          <div className="chrome-brand-identity" aria-hidden="true" data-tauri-drag-region>
            <span className="brand-mark small">O</span>
            <span className="titlebar-brand-name">ONEMIND</span>
          </div>
          <button
            type="button"
            className="chrome-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏 (Ctrl+\\)" : "收起侧边栏 (Ctrl+\\)"}
          >
            <span className="chrome-sidebar-icon" aria-hidden="true">
              {sidebarCollapsed ? (
                <PanelLeftOpen className="chrome-sidebar-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <PanelLeftClose className="chrome-sidebar-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
            </span>
          </button>
        </div>
        <div className="chrome-tabs" onWheel={handleTabsWheel}>
          <button
            type="button"
            className={activeTabPath === "/home" ? "tab-item active" : "tab-item"}
            onClick={() => openRoute("/home")}
          >
            首页
          </button>
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={tab.path === activeTabPath ? "tab-item active" : "tab-item"}
              onClick={() => openRoute(tab.path)}
            >
              <span className="tab-item-label">
                {tab.label}
              </span>
              <span
                role="button"
                tabIndex={0}
                className="tab-item-close"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    closeTab(tab.path)
                  }
                }}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
        <div className="chrome-drag-region" data-tauri-drag-region />
        <div
          className="titlebar-controls"
          onPointerDown={(event) => {
            writeShellInteractionLog(
              "titlebar_controls_pointer_down",
              `button=${event.button} x=${Math.round(event.clientX)} y=${Math.round(event.clientY)}`
            )
            event.stopPropagation()
          }}
        >
          <button
            className="titlebar-btn"
            title="最小化"
            aria-label="最小化"
            onClick={(event) => {
              writeShellInteractionLog("titlebar_minimize_click", `button=${event.button}`)
              event.preventDefault()
              event.stopPropagation()
              runWindowAction("minimize", window.oneMind.window.minimize)
            }}
            onKeyDown={(event) => runTitlebarActionFromKeyboard(event, () => runWindowAction("minimize", window.oneMind.window.minimize))}
          >
            <span className="titlebar-icon titlebar-icon-minimize" aria-hidden="true" />
          </button>
          <button
            className="titlebar-btn"
            title="最大化"
            aria-label="最大化"
            onClick={(event) => {
              writeShellInteractionLog("titlebar_maximize_click", `button=${event.button}`)
              event.preventDefault()
              event.stopPropagation()
              runWindowAction("maximize", window.oneMind.window.toggleMaximize)
            }}
            onKeyDown={(event) => runTitlebarActionFromKeyboard(event, () => runWindowAction("maximize", window.oneMind.window.toggleMaximize))}
          >
            <span className="titlebar-icon titlebar-icon-maximize" aria-hidden="true" />
          </button>
          <button
            className="titlebar-btn titlebar-btn-close"
            title="关闭"
            aria-label="关闭"
            onClick={(event) => {
              writeShellInteractionLog("titlebar_close_click", `button=${event.button}`)
              event.preventDefault()
              event.stopPropagation()
              runWindowAction("close", window.oneMind.window.close)
            }}
            onKeyDown={(event) => runTitlebarActionFromKeyboard(event, () => runWindowAction("close", window.oneMind.window.close))}
          >
            <span className="titlebar-icon titlebar-icon-close" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={"workspace-layout" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
        {/* Sidebar */}
        <aside className="sidebar" id="sidebar">
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
            title="拖拽调整侧边栏宽度"
            onPointerDown={startSidebarResize}
          />
          {/* Expanded content */}
          <div className="sidebar-expanded-content">
            {/* Quick Note Section (fixed) */}
            <div className="sidebar-section sidebar-section--quick-note">
              <button
                type="button"
                className={location.pathname === "/capture" ? "nav-item nav-item--quick-note active" : "nav-item nav-item--quick-note"}
                onClick={() => openRoute("/capture")}
              >
                <Zap size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} aria-hidden="true" />
                <span>随记</span>
              </button>
            </div>

            <div className="sidebar-divider" />

            {/* Notes Section (flex: 1) */}
            <div className="sidebar-section sidebar-section--notes">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">笔记</div>
                <div className={"sidebar-search sidebar-notes-search" + (notesSearchExpanded || notesSearchQuery ? " expanded" : "")}>
                  <button
                    type="button"
                    className="sidebar-search-trigger"
                    aria-label="搜索笔记"
                    title="搜索笔记"
                    onClick={expandNotesSearch}
                  >
                    <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <input
                    ref={notesSearchRef}
                    className="sidebar-search-input"
                    value={notesSearchQuery}
                    onChange={(event) => setNotesSearchQuery(event.target.value)}
                    onFocus={() => setNotesSearchExpanded(true)}
                    onBlur={collapseNotesSearchIfEmpty}
                    placeholder="搜索笔记..."
                  />
                </div>
              </div>
              {/* File tree */}
              <div
                className={"sidebar-notes-tree-surface" + (dropTargetPath === "__root__" ? " drop-target" : "")}
                onContextMenu={handleNotesAreaContextMenu}
                onDragOver={handleRootDragOver}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTargetPath(prev => prev === "__root__" ? null : prev)
                  }
                }}
                onDrop={(e) => void handleRootDrop(e)}
              >
                {workspace ? (
                  renderFileTree(noteTree)
                ) : (
                  <div style={{ padding: "8px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    {bridgeReady ? "未选择 workspace" : bridgeError}
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-divider" />

            {/* Bottom: miniapp + settings + workspace */}
            <div className="sidebar-bottom">
              <button
                type="button"
                className={location.pathname === "/sources" ? "nav-item active" : "nav-item"}
                onClick={() => openRoute("/sources")}
              >
                <Grid3X3 size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} aria-hidden="true" />
                <span>小程序</span>
              </button>
              <button
                type="button"
                className={location.pathname === "/settings" ? "nav-item active" : "nav-item"}
                onClick={() => openRoute("/settings")}
              >
                <Settings size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} aria-hidden="true" />
                <span>设置</span>
              </button>

              <div className="workspace-default">{defaultPath || "Loading..."}</div>
            </div>
          </div>

          {/* Collapsed bar */}
          <div className="sidebar-collapsed-bar">
            {sidebarIcons.map(item => {
              const isActive = location.pathname === "/" + item.scene || (item.scene === "home" && location.pathname === "/home")
              const Icon = item.icon
              return (
                <button
                  key={item.scene}
                  type="button"
                  className={"sidebar-icon-item" + (isActive ? " active" : "")}
                  data-accent={item.accent}
                  data-tooltip={item.tooltip}
                  aria-label={item.tooltip}
                  onClick={() => switchScene(item.scene)}
                >
                  <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              )
            })}
            <div className="sidebar-collapsed-spacer" />
          </div>
        </aside>

        {/* Content */}
        <main className="content">
          <section className="content-panel">
            <Outlet context={{ workspace, defaultPath, busy, bridgeReady, handleCreateDefault, handleSelectWorkspace, selectedSidebarPath, setSelectedSidebarPath }} />
          </section>
        </main>
      </div>

      {contextMenu && (
        <ContextMenu
          id="context-menu-tree"
          items={getContextMenuItems(contextMenu.targetNode?.type ?? null)}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}

      {/* Create dialog */}
      {createDialog && (
        <div className="convert-overlay" role="presentation" onClick={() => setCreateDialog(null)}>
          <section className="convert-panel" aria-label={createDialog.type === "file" ? "新建笔记" : "新建文件夹"} onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="section-label">Create</div>
                <div className="notes-panel-title">{createDialog.type === "file" ? "新建笔记" : "新建文件夹"}</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setCreateDialog(null)}>取消</button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">{createDialog.type === "file" ? "笔记名称" : "文件夹名称"}</span>
                <input className="convert-input" value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder={createDialog.type === "file" ? "输入笔记名称" : "输入文件夹名称"}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && workspace) {
                      e.preventDefault()
                      try {
                        const ws = workspace
                        const dirPath = createDialog.dirPath
                        if (createDialog.type === "file") {
                          const filePath = await window.oneMind.notes.createFile(ws.workspacePath, dirPath, nameInput)
                          trackActivity(ws.workspacePath, {
                            module: "notes",
                            action: "create",
                            targetType: "note",
                            targetId: filePath,
                            targetLabel: nameInput
                          })
                          setSelectedSidebarPath(filePath)
                          navigate("/notes?selected=" + encodeURIComponent(filePath))
                        } else {
                          const folderPath = await window.oneMind.notes.createFolder(ws.workspacePath, dirPath, nameInput)
                          trackActivity(ws.workspacePath, {
                            module: "notes",
                            action: "create",
                            targetType: "folder",
                            targetId: folderPath,
                            targetLabel: nameInput
                          })
                        }
                        setCreateDialog(null)
                        setNameInput('')
                        await refreshNoteTree()
                      } catch (err) { console.error(err) }
                    }
                  }}
                />
              </label>
            </div>
            <div className="convert-footer">
              <div className="convert-hint">Enter 创建，Esc 关闭</div>
              <button type="button" className="compact" onClick={async () => {
                if (!workspace) return
                try {
                  const ws = workspace
                  const dirPath = createDialog.dirPath
                  if (createDialog.type === "file") {
                    const filePath = await window.oneMind.notes.createFile(ws.workspacePath, dirPath, nameInput)
                    trackActivity(ws.workspacePath, {
                      module: "notes",
                      action: "create",
                      targetType: "note",
                      targetId: filePath,
                      targetLabel: nameInput
                    })
                    setSelectedSidebarPath(filePath)
                    navigate("/notes?selected=" + encodeURIComponent(filePath))
                  } else {
                    const folderPath = await window.oneMind.notes.createFolder(ws.workspacePath, dirPath, nameInput)
                    trackActivity(ws.workspacePath, {
                      module: "notes",
                      action: "create",
                      targetType: "folder",
                      targetId: folderPath,
                      targetLabel: nameInput
                    })
                  }
                  setCreateDialog(null)
                  setNameInput('')
                  await refreshNoteTree()
                } catch (err) { console.error(err) }
              }}>
                {createDialog.type === "file" ? '创建笔记' : '创建文件夹'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <div className="convert-overlay" role="presentation" onClick={() => setRenameTarget(null)}>
          <section className="convert-panel" aria-label="重命名" onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="section-label">Rename</div>
                <div className="notes-panel-title">重命名</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setRenameTarget(null)}>取消</button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">新名称</span>
                <input className="convert-input" value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && nameValue.trim() && workspace) {
                      e.preventDefault()
                      try {
                        const newPath = await window.oneMind.notes.rename(renameTarget.path, nameValue.trim())
                        setRenameTarget(null)
                        // Refresh tree
                        const nextTree = await window.oneMind.notes.list(workspace.workspacePath)
                        setNoteTree(nextTree)
                        if (selectedSidebarPath === renameTarget.path) {
                          setSelectedSidebarPath(newPath)
                        }
                      } catch (err) { console.error(err) }
                    }
                  }}
                />
              </label>
            </div>
            <div className="convert-footer">
              <div className="convert-hint">Enter 确认，Esc 关闭</div>
              <button type="button" className="compact" onClick={async () => {
                if (!nameValue.trim() || !workspace) return
                try {
                  const newPath = await window.oneMind.notes.rename(renameTarget.path, nameValue.trim())
                  setRenameTarget(null)
                  const nextTree = await window.oneMind.notes.list(workspace.workspacePath)
                  setNoteTree(nextTree)
                  if (selectedSidebarPath === renameTarget.path) {
                    setSelectedSidebarPath(newPath)
                  }
                } catch (err) { console.error(err) }
              }}>
                确认
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Move dialog */}
      {moveTarget && (
        <div className="convert-overlay" role="presentation" onClick={() => setMoveTarget(null)}>
          <section className="convert-panel" aria-label="移动到" onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="section-label">Move</div>
                <div className="notes-panel-title">移动到</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setMoveTarget(null)}>取消</button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">目标目录</span>
                <select className="convert-input" value={nameInput} onChange={(e) => setNameInput(e.target.value)}>
                  <option value="">notes / 根目录</option>
                  {directoryList.map(dir => (<option key={dir} value={dir}>{dir}</option>))}
                </select>
              </label>
            </div>
            <div className="convert-footer">
              <div className="convert-hint">选择一个目录，Esc 关闭</div>
              <button type="button" className="compact" onClick={async () => {
                if (!workspace) return
                try {
                  const ws = workspace
                  const dirPath = nameInput
                  const newPath = await window.oneMind.notes.move(moveTarget.path, ws.workspacePath, dirPath)
                  setMoveTarget(null)
                  setNameInput("")
                  await refreshNoteTree()
                  if (selectedSidebarPath === moveTarget.path) {
                    setSelectedSidebarPath(newPath)
                    if (moveTarget.type === "file") {
                      navigate("/notes?selected=" + encodeURIComponent(newPath))
                    }
                  }
                } catch (err) { console.error(err) }
              }}>
                移动
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

