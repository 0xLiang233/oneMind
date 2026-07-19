import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useOutletContext } from "react-router-dom"
import { MarkdownEditor } from "../components/MarkdownEditor"
import { trackActivity } from "../activity"
import { registerSyncSaveParticipant } from "../sync/saveBarrier"

type OutletContext = {
  workspace: WorkspaceMeta | null
  selectedSidebarPath: string | null
  setSelectedSidebarPath: (path: string | null) => void
}

export function NotesPage() {
  const { workspace, selectedSidebarPath, setSelectedSidebarPath } = useOutletContext<OutletContext>()
  const location = useLocation()
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("从侧边栏选择笔记开始编辑")
  const [editorMode, setEditorMode] = useState<"rich" | "source">("rich")
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null)

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
        setEditorMode("rich")
        setStatus("从侧边栏选择笔记开始编辑")
        return
      }
      setLoadedPath(null)
      setEditorMode("rich")
      setStatus("正在加载...")
      try {
        const next = await window.oneMind.notes.read(selectedSidebarPath)
        if (cancelled) return
        setContent(next)
        setSavedContent(next)
        setLoadedPath(selectedSidebarPath)
        setStatus("已加载")
        trackActivity(workspace?.workspacePath, {
          module: "notes",
          action: "open",
          targetType: "note",
          targetId: selectedSidebarPath,
          targetLabel: selectedSidebarPath.split(/[/\\]/).pop() || selectedSidebarPath
        })
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
  }, [selectedSidebarPath, workspace?.workspacePath])

  const handleSave = useCallback(async () => {
    if (!selectedSidebarPath) return
    if (savePromiseRef.current) return savePromiseRef.current

    const contentToSave = content
    const operation = (async () => {
      setSaving(true)
      await window.oneMind.notes.write(selectedSidebarPath, contentToSave)
      setSavedContent(contentToSave)
      setStatus("已保存")
      trackActivity(workspace?.workspacePath, {
        module: "notes",
        action: "save",
        targetType: "note",
        targetId: selectedSidebarPath,
        targetLabel: selectedName
      })
    })().finally(() => {
      setSaving(false)
      savePromiseRef.current = null
    })
    savePromiseRef.current = operation
    return operation
  }, [content, selectedName, selectedSidebarPath, workspace?.workspacePath])

  useEffect(() => {
    return registerSyncSaveParticipant(async () => {
      if (content !== savedContent) {
        await handleSave()
      } else if (savePromiseRef.current) {
        await savePromiseRef.current
      }
    })
  }, [content, handleSave, savedContent])

  useEffect(() => {
    async function reloadAfterSync() {
      if (!selectedSidebarPath || content !== savedContent) return
      try {
        const next = await window.oneMind.notes.read(selectedSidebarPath)
        setContent(next)
        setSavedContent(next)
        setStatus("已同步")
      } catch {
        setStatus("同步后文件已被移动或删除")
      }
    }
    window.addEventListener("onemind-workspace-changed", reloadAfterSync)
    return () => window.removeEventListener("onemind-workspace-changed", reloadAfterSync)
  }, [content, savedContent, selectedSidebarPath])

  useEffect(() => {
    if (!selectedSidebarPath || !isDirty || saving) return
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [handleSave, isDirty, saving, selectedSidebarPath])

  function toggleSourceMode() {
    setEditorMode((current) => current === "source" ? "rich" : "source")
  }

  async function handleSourcePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!workspace || !selectedSidebarPath) return
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"))
    if (images.length === 0) return

    event.preventDefault()
    const selectionStart = event.currentTarget.selectionStart
    const selectionEnd = event.currentTarget.selectionEnd
    try {
      const saved = await Promise.all(images.map(async (file) => {
        const dataBase64 = await readFileAsBase64(file)
        return window.oneMind.notes.assets.savePastedImage(workspace.workspacePath, selectedSidebarPath, {
          mimeType: file.type,
          dataBase64
        })
      }))
      const markdown = saved.map((asset) => `![image](${asset.markdownPath})`).join("\n\n")
      setContent((current) => `${current.slice(0, selectionStart)}${markdown}${current.slice(selectionEnd)}`)
      window.requestAnimationFrame(() => {
        const caret = selectionStart + markdown.length
        sourceEditorRef.current?.focus()
        sourceEditorRef.current?.setSelectionRange(caret, caret)
      })
    } catch (error) {
      setStatus(`图片保存失败: ${String(error)}`)
    }
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
            <div className="notes-status">{saving ? "正在自动保存..." : status}</div>
            {selectedSidebarPath ? (
              <div className="notes-more-menu">
                <button className="notes-more-button" type="button" aria-label="更多" aria-haspopup="menu">
                  <span />
                  <span />
                  <span />
                </button>
                <div className="notes-more-panel" role="menu">
                  <button
                    type="button"
                    className={`notes-more-item ${editorMode === "source" ? "active" : ""}`}
                    role="menuitemcheckbox"
                    aria-checked={editorMode === "source"}
                    onClick={toggleSourceMode}
                  >
                    <span className="notes-more-item-label">源码模式</span>
                    <span className="notes-more-check" aria-hidden="true">{editorMode === "source" ? "✓" : ""}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Editor */}
        <div className="md-editor-stage">
          {selectedSidebarPath && loadedPath === selectedSidebarPath ? (
            editorMode === "source" ? (
              <textarea
                ref={sourceEditorRef}
                className="notes-source-editor"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onPaste={(event) => void handleSourcePaste(event)}
                spellCheck={false}
              />
            ) : (
              <MarkdownEditor
                key={selectedSidebarPath}
                value={content}
                onChange={setContent}
                workspacePath={workspace?.workspacePath ?? ""}
                notePath={selectedSidebarPath}
                onError={setStatus}
              />
            )
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

function readFileAsBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片"))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("无法读取图片"))
        return
      }
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.readAsDataURL(file)
  })
}
