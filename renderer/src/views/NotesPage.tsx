import "../styles/workbench-writing.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useOutletContext } from "react-router-dom"
import { MarkdownEditor, type MarkdownEditorHandle } from "../components/MarkdownEditor"
import { trackActivity } from "../activity"
import { registerSyncSaveParticipant } from "../sync/saveBarrier"
import { Check, Circle, Clock, CodeXml, FileText, Info, PenLine } from "../icons"

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
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null)
  const savedContentRef = useRef("")
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedName = useMemo(() => {
    if (!selectedSidebarPath) return "未选择笔记"
    return selectedSidebarPath.split(/[/\\]/).pop() || selectedSidebarPath
  }, [selectedSidebarPath])

  const isDirty = content !== savedContent
  const documentReady = Boolean(selectedSidebarPath && loadedPath === selectedSidebarPath)
  const savedState = !saving && !isDirty && ["已加载", "已保存", "已同步"].includes(status)
  const statusLabel = !selectedSidebarPath ? "" : !documentReady ? status
    : saving ? "正在保存…" : isDirty ? "尚未保存" : status === "已加载" ? "已保存" : status
  const StatusIcon = !documentReady || saving ? Clock : isDirty ? Circle : savedState ? Check : Info

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
        savedContentRef.current = ""
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
        savedContentRef.current = next
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
        savedContentRef.current = ""
        setSavedContent("")
        setLoadedPath(null)
        setStatus("无法加载文件: " + String(e))
      }
    }
    void loadContent()
    return () => {
      cancelled = true
    }
  }, [selectedSidebarPath, workspace?.workspacePath])

  const handleSave = useCallback(async () => {
    if (!selectedSidebarPath || loadedPath !== selectedSidebarPath) return
    if (savePromiseRef.current) return savePromiseRef.current

    const readCurrentContent = () => markdownEditorRef.current?.getMarkdown() ?? sourceEditorRef.current?.value ?? content
    const operation = (async () => {
      // Milkdown's change notification is debounced. Read the current document
      // synchronously so typing then immediately switching tabs loses nothing.
      let contentToSave = readCurrentContent()
      while (contentToSave !== savedContentRef.current) {
        setSaving(true)
        const written = await window.oneMind.notes.write(selectedSidebarPath, contentToSave)
        if (!written) throw new Error("笔记未能写入工作区")
        trackActivity(workspace?.workspacePath, {
          module: "notes", action: "save", targetType: "note",
          targetId: selectedSidebarPath, targetLabel: selectedName
        })
        savedContentRef.current = contentToSave
        setSavedContent(contentToSave)
        const latest = readCurrentContent()
        setContent(latest)
        contentToSave = latest
      }
      setStatus("已保存")
    })().finally(() => {
      setSaving(false)
      savePromiseRef.current = null
    })
    savePromiseRef.current = operation
    return operation
  }, [content, loadedPath, selectedSidebarPath, selectedName, workspace?.workspacePath])

  useEffect(() => {
    return registerSyncSaveParticipant(handleSave)
  }, [handleSave])

  useEffect(() => {
    async function reloadAfterSync() {
      if (!selectedSidebarPath || content !== savedContent) return
      try {
        const next = await window.oneMind.notes.read(selectedSidebarPath)
        setContent(next)
        savedContentRef.current = next
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
      void handleSave().catch((error: unknown) => setStatus(`保存失败: ${String(error)}`))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [handleSave, isDirty, saving, selectedSidebarPath])

  function toggleSourceMode() {
    if (editorMode === "rich") setContent(markdownEditorRef.current?.getMarkdown() ?? content)
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
    <section className="page notes-workspace-page writing-notes">
      <div className="md-workspace">
        {/* Header */}
        <div className="md-editor-toolbar">
          <div className="notes-editor-title-group">
            <FileText size={16} aria-hidden="true" />
            <div className="md-document-title" title={selectedName}>{selectedName.replace(/\.md$/i, "")}</div>
          </div>
          <div className="notes-editor-actions">
            <div className="notes-status" role="status" aria-live="polite" aria-atomic="true" title={statusLabel}>
              {statusLabel && <><StatusIcon aria-hidden="true" /><span>{statusLabel}</span></>}
            </div>
            {selectedSidebarPath ? (
              <button
                className="notes-mode-button"
                type="button"
                aria-label={editorMode === "source" ? "返回编辑模式" : "查看 Markdown 源码"}
                title={editorMode === "source" ? "返回编辑模式" : "查看 Markdown 源码"}
                aria-pressed={editorMode === "source"}
                disabled={!documentReady}
                onClick={toggleSourceMode}
              >
                {editorMode === "source" ? <PenLine size={16} aria-hidden="true" /> : <CodeXml size={16} aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        </div>

        {/* Editor */}
        <div className="md-editor-stage" aria-busy={Boolean(selectedSidebarPath && loadedPath !== selectedSidebarPath)}>
          {selectedSidebarPath && loadedPath === selectedSidebarPath ? (
            editorMode === "source" ? (
              <textarea
                ref={sourceEditorRef}
                className="notes-source-editor"
                aria-label={`${selectedName} · Markdown 源码`}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onPaste={(event) => void handleSourcePaste(event)}
                spellCheck={false}
              />
            ) : (
              <MarkdownEditor
                ref={markdownEditorRef}
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
