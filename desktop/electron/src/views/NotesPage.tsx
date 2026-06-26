import { useEffect, useMemo, useState } from "react"
import { useLocation, useOutletContext } from "react-router-dom"
import { MarkdownEditor } from "../components/MarkdownEditor"

type OutletContext = {
  workspace: WorkspaceMeta | null
  selectedSidebarPath: string | null
  setSelectedSidebarPath: (path: string | null) => void
}

type CreateDraft = {
  type: "file" | "folder"
  relativeDir: string
  name: string
}

export function NotesPage() {
  const { workspace, selectedSidebarPath, setSelectedSidebarPath } = useOutletContext<OutletContext>()
  const location = useLocation()
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("从侧边栏选择笔记开始编辑")
  const [directoryOptions, setDirectoryOptions] = useState<string[]>([])
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)

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
    async function loadContent() {
      if (!selectedSidebarPath) {
        setContent("")
        setSavedContent("")
        setStatus("从侧边栏选择笔记开始编辑")
        return
      }
      try {
        const next = await window.oneMind.notes.read(selectedSidebarPath)
        setContent(next)
        setSavedContent(next)
        setStatus("已加载")
      } catch (e) {
        setContent("")
        setSavedContent("")
        setStatus("无法加载文件: " + String(e))
      }
    }
    void loadContent()
  }, [selectedSidebarPath])

  // Keyboard shortcuts for create dialog
  useEffect(() => {
    if (!createDraft) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setCreateDraft(null); return }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        void handleConfirmCreate()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [createDraft])

  useEffect(() => {
    if (!selectedSidebarPath || !isDirty || saving) return
    setStatus("正在自动保存...")
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [content, isDirty, saving, selectedSidebarPath])

  async function openCreateDialog(type: CreateDraft["type"]) {
    if (!workspace) return
    const directories = await window.oneMind.notes.listDirectories(workspace.workspacePath)
    setDirectoryOptions(directories)
    setCreateDraft({ type, relativeDir: "", name: type === "file" ? "untitled-note" : "new-folder" })
  }

  async function handleConfirmCreate() {
    if (!workspace || !createDraft) return
    const name = createDraft.name.trim()
    if (!name) {
      setStatus(createDraft.type === "file" ? "请先填写笔记名称。" : "请先填写文件夹名称。")
      return
    }
    if (createDraft.type === "file") {
      const filePath = await window.oneMind.notes.createFile(workspace.workspacePath, createDraft.relativeDir, name)
      setCreateDraft(null)
      setSelectedSidebarPath(filePath)
      setStatus("已创建新笔记。")
      return
    }
    await window.oneMind.notes.createFolder(workspace.workspacePath, createDraft.relativeDir, name)
    setCreateDraft(null)
    setStatus("已创建新文件夹。")
  }

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
            <div className="notes-status">{isDirty ? "有未保存更改" : status}</div>
            <button type="button" className="secondary compact" onClick={() => void openCreateDialog("folder")}>
              新建文件夹
            </button>
            <button type="button" className="compact" onClick={() => void openCreateDialog("file")}>
              新建笔记
            </button>
            <button type="button" className="compact" onClick={handleSave} disabled={!selectedSidebarPath || !isDirty || saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="md-editor-stage">
          {selectedSidebarPath ? (
            <MarkdownEditor
              key={selectedSidebarPath}
              value={content}
              onChange={setContent}
            />
          ) : (
            <div className="notes-empty">{status}</div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      {createDraft ? (
        <div className="convert-overlay" role="presentation" onClick={() => setCreateDraft(null)}>
          <section className="convert-panel" aria-label={createDraft.type === "file" ? "新建笔记" : "新建文件夹"} onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="section-label">Create</div>
                <div className="notes-panel-title">{createDraft.type === "file" ? "新建笔记" : "新建文件夹"}</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setCreateDraft(null)}>取消</button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">目标目录</span>
                <select className="convert-input" value={createDraft.relativeDir}
                  onChange={(e) => setCreateDraft(c => c ? { ...c, relativeDir: e.target.value } : c)}>
                  <option value="">notes / 根目录</option>
                  {directoryOptions.map(dir => (<option key={dir} value={dir}>{dir}</option>))}
                </select>
              </label>
              <label className="convert-field">
                <span className="convert-label">{createDraft.type === "file" ? "笔记名称" : "文件夹名称"}</span>
                <input className="convert-input" value={createDraft.name}
                  onChange={(e) => setCreateDraft(c => c ? { ...c, name: e.target.value } : c)}
                  placeholder={createDraft.type === "file" ? "输入笔记名称" : "输入文件夹名称"}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleConfirmCreate() } }} />
              </label>
            </div>
            <div className="convert-footer">
              <div className="convert-hint">Enter 创建，Esc 关闭</div>
              <button type="button" className="compact" onClick={() => void handleConfirmCreate()}>
                {createDraft.type === "file" ? "创建笔记" : "创建文件夹"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
