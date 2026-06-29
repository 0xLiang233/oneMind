import { useCallback, useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ContextMenu, type ContextMenuItem } from "./ContextMenu"

interface Tab {
  id: string
  path: string
  label: string
}

const SIDEBAR_STORAGE_KEY = "onemind-sidebar-collapsed"

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
  "/notes": "笔记",
  "/sources": "小程序",
  "/settings": "设置",
  "/search": "搜索"
}

const sidebarIcons = [
  {
    scene: "home",
    accent: "primary" as const,
    tooltip: "首页",
    svg: (
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
        <path d="M2 5L7 2L12 5V11.5H2V5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    scene: "capture",
    accent: "primary" as const,
    tooltip: "随记",
    svg: (
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
        <path d="M8 1L3 8H7L6 13L11 6H7L8 1Z" fill="currentColor" opacity="0.85" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    scene: "notes",
    accent: "primary" as const,
    tooltip: "笔记",
    svg: (
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1"/>
        <path d="M5 4H9M5 6.5H9M5 9H7" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    scene: "sources",
    accent: "secondary" as const,
    tooltip: "小程序",
    svg: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.7"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="10" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
      </svg>
    )
  },
  {
    scene: "settings",
    accent: "primary" as const,
    tooltip: "设置",
    svg: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M9 1.5V3.5M9 14.5V16.5M1.5 9H3.5M14.5 9H16.5M3.7 3.7L5.1 5.1M12.9 12.9L14.3 14.3M14.3 3.7L12.9 5.1M5.1 12.9L3.7 14.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    )
  }
]

function normalizeRoutePath(path: string) {
  return path === "/" ? "/home" : path
}

function FolderArrow() {
  return (
    <span className="tree-folder-arrow">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M2 1L6 4L2 7" fill="currentColor" opacity="0.6"/>
      </svg>
    </span>
  )
}

function FolderIcon() {
  return (
    <span className="tree-folder-icon">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 4V11H13V4H7L5 2H1V4Z" fill="currentColor" opacity="0.62"/>
      </svg>
    </span>
  )
}

function FileIcon() {
  return (
    <span className="tree-file-icon">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1"/>
        <path d="M5 4H9M5 6.5H9M5 9H7" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round"/>
      </svg>
    </span>
  )
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
  const [activeTabPath, setActiveTabPath] = useState(normalizeRoutePath(location.pathname) + location.search)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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

  // Sidebar collapsed state — no-flash init
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    setSidebarCollapsed(saved === "true")
  }, [])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const currentRoutePath = normalizeRoutePath(location.pathname) + location.search

  useEffect(() => { setActiveTabPath(currentRoutePath) }, [currentRoutePath])

  // Load sidebar data
  useEffect(() => {
    async function load() {
      if (!workspace) { setNoteTree([]); return }
      const nextTree = await window.oneMind.notes.list(workspace.workspacePath)
      setNoteTree(nextTree)
    }
    void load()
  }, [workspace])

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
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
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

  useEffect(() => {
    return window.oneMind.window.onNavigate((route) => {
      openRoute(route)
    })
  }, [])

  // Tab tracking
  useEffect(() => {
    const normalizedPathname = normalizeRoutePath(location.pathname)
    if (normalizedPathname === "/home") {
      setTabs(prev => prev.filter(tab => normalizeRoutePath(tab.path.split("?")[0]) !== "/home"))
      return
    }
    setTabs(prev => {
      const cleaned = prev.filter(tab => normalizeRoutePath(tab.path.split("?")[0]) !== "/home")
      const exists = cleaned.find(t => t.path === currentRoutePath)
      if (exists) return cleaned
      const params = new URLSearchParams(location.search)
      const label = normalizedPathname === "/sources" && params.get("title")
        ? params.get("title")!
        : routeLabels[normalizedPathname] ?? "页面"
      return [...cleaned, { id: currentRoutePath, path: currentRoutePath, label }]
    })
  }, [currentRoutePath, location.pathname, location.search])

  function openRoute(path: string) {
    navigate(normalizeRoutePath(path))
  }

  function openNoteFile(filePath: string) {
    setSelectedSidebarPath(filePath)
    navigate("/notes?selected=" + encodeURIComponent(filePath))
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
    if (target.type === "directory") return getRelativeNoteDir(target.path)
    const parentDir = target.path.replace(/[/\\][^/\\]+$/, "")
    return getRelativeNoteDir(parentDir)
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
      if (activeTabPath === path && next.length > 0) {
        navigate(next[next.length - 1].path)
      } else if (next.length === 0) {
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
        setContextMenu(null)
        setNameInput('')
        setCreateDialog({ type: 'folder', dirPath: getCreationDir(target ?? null) })
        break
      }
      case 'new-note': {
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
        if (!target) return
        setContextMenu(null)
        const dirs = await window.oneMind.notes.listDirectories(ws.workspacePath)
        setDirectoryList(dirs)
        setNameInput("")
        setMoveTarget(target)
        break
      }
    }
  }

  function getContextMenuItems(nodeType: string | null): ContextMenuItem[][] {
    // Tree context menu (prototype Phase 3)
    const createItems: ContextMenuItem[] = [
        {
          label: '新建文件夹',
          shortcut: 'Ctrl+Shift+N',
          action: 'new-folder',
          icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 4V11.5H13V5H7L5.5 3.5H1V4Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/><path d="M7 7V11M5 9H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
        },
        {
          label: '新建笔记',
          shortcut: 'Ctrl+N',
          action: 'new-note',
          icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M7 5V9M5 7H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
        }
      ]

    if (!nodeType) return [createItems]

    return [
      createItems,
      [
        {
          label: '重命名',
          action: 'rename',
          icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10L11 2L12 3L3 12L1 13L2 10Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
        },
        {
          label: '删除',
          shortcut: 'Del',
          action: 'delete',
          danger: true,
          icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4.5H11M5 4.5V2.5H9V4.5M4 4.5L4.5 12H9.5L10 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
        }
      ],
      [
        {
          label: '移动到…',
          action: 'move',
          icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M10 4L13 7L10 10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
        }
      ]
    ]
  }

  function switchScene(scene: string) {
    openRoute("/" + scene)
  }

  // Render file tree (prototype style with details/summary)
  function renderFileTree(nodes: NoteTreeNode[]): React.ReactNode {
    if (!nodes || nodes.length === 0) {
      return <div className="notes-empty" style={{ padding: "8px", fontSize: "12px" }}>notes/ 暂无内容</div>
    }
    return (
      <div className="file-tree">
        {nodes.map(node => renderTreeNode(node))}
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
    await moveNodeToDirectory(draggingNode, getRelativeNoteDir(node.path))
  }

  function handleRootDragOver(e: React.DragEvent) {
    if (!draggingNode) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTargetPath("__root__")
  }

  async function handleRootDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingNode) return
    await moveNodeToDirectory(draggingNode, "")
  }

  function renderTreeNode(node: NoteTreeNode): React.ReactNode {
    if (node.type === "directory") {
      const isDropTarget = dropTargetPath === node.path
      return (
        <details
          key={node.id}
          className={"tree-folder" + (isDropTarget ? " drop-target" : "")}
          open
          draggable
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
            <span>{node.name}</span>
          </summary>
          <div className="tree-file-list">
            {node.children && node.children.length > 0
              ? node.children.map(child => renderTreeNode(child))
              : <div className="tree-empty-folder">空文件夹</div>
            }
          </div>
        </details>
      )
    }
    return (
      <div
        key={node.id}
        className={"tree-file" + (selectedSidebarPath === node.path ? " active" : "")}
        data-file-id={node.id}
        draggable
        onDragStart={(e) => handleTreeDragStart(e, node)}
        onDragEnd={() => { setDraggingNode(null); setDropTargetPath(null) }}
        onClick={() => openNoteFile(node.path)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        <FileIcon />
        <span className="tree-file-name">{node.name}</span>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* Titlebar */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region>
          <div className="brand-mark small">O</div>
          <div className="titlebar-brand-name">ONEMIND</div>
        </div>
        <div className="titlebar-center" data-tauri-drag-region>OneMind Workbench</div>
        <div className="titlebar-controls">
          <button className="titlebar-btn" title="最小化" aria-label="最小化" onClick={() => void window.oneMind.window.minimize()}>
            <span className="titlebar-icon titlebar-icon-minimize" aria-hidden="true" />
          </button>
          <button className="titlebar-btn" title="最大化" aria-label="最大化" onClick={() => void window.oneMind.window.toggleMaximize()}>
            <span className="titlebar-icon titlebar-icon-maximize" aria-hidden="true" />
          </button>
          <button className="titlebar-btn titlebar-btn-close" title="关闭" aria-label="关闭" onClick={() => void window.oneMind.window.close()}>
            <span className="titlebar-icon titlebar-icon-close" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={"workspace-layout" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
        {/* Sidebar */}
        <aside className="sidebar" id="sidebar">
          {/* Collapse button */}
          <button
            className={"sidebar-collapse-btn" + (sidebarCollapsed ? " collapsed" : "")}
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏 (Ctrl+\\)" : "收起侧边栏 (Ctrl+\\)"}
          >
            <svg className="sidebar-collapse-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 2L4 7L8 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 2L6 7L10 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" transform="translate(-2,0)"/>
            </svg>
          </button>

          {/* Expanded content */}
          <div className="sidebar-expanded-content">
            {/* Quick Note Section (fixed) */}
            <div className="sidebar-section sidebar-section--quick-note">
              <button
                type="button"
                className={location.pathname === "/capture" ? "nav-item nav-item--quick-note active" : "nav-item nav-item--quick-note"}
                onClick={() => openRoute("/capture")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M8 1L3 8H7L6 13L11 6H7L8 1Z" fill="currentColor" opacity="0.85" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round"/>
                </svg>
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
                    <span aria-hidden="true" />
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
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                  <rect x="2" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.7"/>
                  <rect x="10" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
                  <rect x="2" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
                  <rect x="10" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
                </svg>
                <span>小程序</span>
              </button>
              <button
                type="button"
                className={location.pathname === "/settings" ? "nav-item active" : "nav-item"}
                onClick={() => openRoute("/settings")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M9 1.5V3.5M9 14.5V16.5M1.5 9H3.5M14.5 9H16.5M3.7 3.7L5.1 5.1M12.9 12.9L14.3 14.3M14.3 3.7L12.9 5.1M5.1 12.9L3.7 14.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span>设置</span>
              </button>

              <div className="workspace-default">{defaultPath || "Loading..."}</div>
            </div>
          </div>

          {/* Collapsed bar */}
          <div className="sidebar-collapsed-bar">
            {sidebarIcons.map(item => {
              const isActive = location.pathname === "/" + item.scene || (item.scene === "home" && location.pathname === "/home")
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
                  {item.svg}
                </button>
              )
            })}
            <div className="sidebar-collapsed-spacer" />
          </div>
        </aside>

        {/* Content */}
        <main className="content">
          {/* Tab Bar */}
          <div className="tab-bar">
            <button
              type="button"
              className={activeTabPath === "/home" ? "tab-item active" : "tab-item"}
              onClick={() => openRoute("/home")}
            >
              首页
            </button>
            {tabs.map(tab => (
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
                  ×
                </span>
              </button>
            ))}
          </div>

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
                          setSelectedSidebarPath(filePath)
                          navigate("/notes?selected=" + encodeURIComponent(filePath))
                        } else {
                          await window.oneMind.notes.createFolder(ws.workspacePath, dirPath, nameInput)
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
                    setSelectedSidebarPath(filePath)
                    navigate("/notes?selected=" + encodeURIComponent(filePath))
                  } else {
                    await window.oneMind.notes.createFolder(ws.workspacePath, dirPath, nameInput)
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

