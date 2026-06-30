import { useEffect, useMemo, useState } from "react"
import { useLocation, useOutletContext } from "react-router-dom"
import { MarkdownEditor } from "../components/MarkdownEditor"

type OutletContext = {
  workspace: WorkspaceMeta | null
  selectedSidebarPath: string | null
  setSelectedSidebarPath: (path: string | null) => void
}

export function NotesPage() {
  const { selectedSidebarPath, setSelectedSidebarPath } = useOutletContext<OutletContext>()
  const location = useLocation()
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("从侧边栏选择笔记开始编辑")

  const selectedName = useMemo(() => {
    if (!selectedSidebarPath) return "未选择笔记"
    return selectedSidebarPath.split(/[/\\]/).pop() || selectedSidebarPath
  }, [selectedSidebarPath])

  const isDirty = content !== savedContent

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const selected = params.get("selected")
    if (selected) setSelectedSidebarPath(selected)
  }, [location.search, setSelectedSidebarPath])

  // Load content when sidebar selection changes
  useEffect(() => {
    let cancelled = false
    async function loadContent() {
      if (!selectedSidebarPath) {
        setLoadedPath(null)
        setContent("")
        setSavedContent("")
        setStatus("从侧边栏选择笔记开始编辑")
        return
      }
      setLoadedPath(null)
      setStatus("正在加载...")
      try {
        const next = await window.oneMind.notes.read(selectedSidebarPath)
        if (cancelled) return
        setContent(next)
        setSavedContent(next)
        setLoadedPath(selectedSidebarPath)
        setStatus("已加载")
      } catch (e) {
        if (cancelled) return
        setContent("")
        setSavedContent("")
        setLoadedPath(selectedSidebarPath)
        setStatus("无法加载文件: " + String(e))
      }
    }
    void loadContent()
    return () => {
      cancelled = true
    }
  }, [selectedSidebarPath])

  useEffect(() => {
    if (!selectedSidebarPath || !isDirty || saving) return
    setStatus("正在自动保存...")
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [content, isDirty, saving, selectedSidebarPath])

  async function handleSave() {
    if (!selectedSidebarPath || saving) return
    setSaving(true)
    try {
      await window.oneMind.notes.write(selectedSidebarPath, content)
      setSavedContent(content)
      setStatus("已保存")
    } finally { setSaving(false) }
  }

  return (
    <section className="page notes-workspace-page">
      <div className="md-workspace">
        {/* Header */}
        <div className="md-editor-toolbar">
          <div className="notes-editor-title-group">
            <div className="md-document-title">{selectedName}</div>
            {selectedSidebarPath ? <div className="md-ai-badge"><span className="md-ai-badge-dot" />AI 已整理</div> : null}
          </div>
          <div className="notes-editor-actions">
            <div className="notes-status">{isDirty ? "正在自动保存..." : status}</div>
          </div>
        </div>

        {/* Editor */}
        <div className="md-editor-stage">
          {selectedSidebarPath && loadedPath === selectedSidebarPath ? (
            <MarkdownEditor
              key={selectedSidebarPath}
              value={content}
              onChange={setContent}
            />
          ) : selectedSidebarPath ? (
            <div className="notes-empty">{status}</div>
          ) : (
            <div className="notes-empty">{status}</div>
          )}
        </div>
      </div>
    </section>
  )
}
