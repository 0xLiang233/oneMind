import { useEffect, useMemo, useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"

type OutletContext = {
  workspace: WorkspaceMeta | null
  defaultPath?: string
  busy?: boolean
  bridgeReady?: boolean
  handleCreateDefault?: () => Promise<void>
  handleSelectWorkspace?: () => Promise<void>
}

function formatQuickNoteTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "时间未知"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)
}

function formatDateGroup(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "时间未知"
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "今天"
  if (date.toDateString() === yesterday.toDateString()) return "昨天"
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date)
}

function buildSuggestedName(content: string) {
  return (
    content.split("\n")[0].replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 32) || "quick-note"
  )
}

export function CapturePage() {
  const { workspace } = useOutletContext<OutletContext>()
  const navigate = useNavigate()
  const [items, setItems] = useState<QuickNote[]>([])
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [directoryOptions, setDirectoryOptions] = useState<string[]>([])
  const [convertDraft, setConvertDraft] = useState<{
    item: QuickNote
    relativeDir: string
    name: string
  } | null>(null)
  const [batchConvertItems, setBatchConvertItems] = useState<QuickNote[] | null>(null)
  const [status, setStatus] = useState("加载中...")
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const groupedItems = useMemo(() => {
    const groups: Array<{ label: string; items: QuickNote[] }> = []
    for (const item of items) {
      const label = formatDateGroup(item.createdAt)
      let group = groups.find(g => g.label === label)
      if (!group) {
        group = { label, items: [] }
        groups.push(group)
      }
      group.items.push(item)
    }
    return groups
  }, [items])

  useEffect(() => {
    async function loadQuickNotes() {
      if (!workspace) {
        setItems([])
        setStatus("请先选择或创建 workspace。")
        return
      }
      const next = await window.oneMind.quickNotes.list(workspace.workspacePath)
      setItems(next)
      setStatus(next.length > 0 ? "本地 inbox 已加载。" : "还没有随记，先记录第一条。")
    }
    void loadQuickNotes()
  }, [workspace])

  useEffect(() => {
    if (!convertDraft) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setConvertDraft(null); return }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        void handleConfirmConvert()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [convertDraft])

  useEffect(() => {
    if (!batchConvertItems) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setBatchConvertItems(null); return }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        void handleBatchConvert()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [batchConvertItems])

  // Escape exits select mode
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && selectMode) {
        exitSelectMode()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectMode, selectedIds])

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds([])
  }

  function toggleSelectItem(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  function enterSelectMode() {
    setSelectMode(true)
    setSelectedIds([])
  }

  async function handleSave() {
    if (!workspace || !content.trim() || saving) return
    setSaving(true)
    try {
      const created = await window.oneMind.quickNotes.create(workspace.workspacePath, content)
      setItems(current => [created, ...current])
      setContent("")
      setStatus("随记已保存到 inbox。")
    } finally { setSaving(false) }
  }

  async function handleConvertToNote(item: QuickNote) {
    if (!workspace || convertingId) return
    setConvertingId(item.id)
    try {
      const directories = await window.oneMind.notes.listDirectories(workspace.workspacePath)
      setDirectoryOptions(directories)
      setConvertDraft({ item, relativeDir: "", name: buildSuggestedName(item.content) })
    } finally { setConvertingId(null) }
  }

  async function handleConfirmConvert() {
    if (!workspace || !convertDraft) return
    const name = convertDraft.name.trim()
    if (!name) { setStatus("请先填写正文笔记名称。"); return }
    setConvertingId(convertDraft.item.id)
    try {
      const filePath = await window.oneMind.notes.createFromQuickNote(
        workspace.workspacePath, convertDraft.relativeDir, name, convertDraft.item.content
      )
      setConvertDraft(null)
      setStatus("已从随记创建正文笔记。")
      navigate("/notes?selected=" + encodeURIComponent(filePath))
    } finally { setConvertingId(null) }
  }

  async function handleBatchDelete() {
    if (!workspace || selectedIds.length === 0) return
    const ids = selectedIds
    const previousItems = items
    setItems(prev => prev.filter(n => !ids.includes(n.id)))
    exitSelectMode()
    try {
      await Promise.all(ids.map(id => window.oneMind.quickNotes.delete(workspace.workspacePath, id)))
      setStatus(`已删除 ${ids.length} 条随记。`)
    } catch {
      setItems(previousItems)
      setStatus("删除失败，请重试。")
    }
  }

  async function handleDeleteItem(item: QuickNote) {
    if (!workspace) return
    const previousItems = items
    setItems(prev => prev.filter(n => n.id !== item.id))
    try {
      const deleted = await window.oneMind.quickNotes.delete(workspace.workspacePath, item.id)
      setStatus(deleted ? "随记已删除。" : "没有找到要删除的随记。")
    } catch {
      setItems(previousItems)
      setStatus("删除失败，请重试。")
    }
  }

  function handleBatchAiOrganize() {
    if (selectedIds.length === 0) return
    const selectedItems = items.filter(n => selectedIds.includes(n.id))
    void (async () => {
      const directories = await window.oneMind.notes.listDirectories(workspace!.workspacePath)
      setDirectoryOptions(directories)
      setBatchConvertItems(selectedItems)
    })()
  }

  async function handleBatchConvert() {
    if (!workspace || !batchConvertItems) return
    // Convert each selected quick note to a note file
    for (const item of batchConvertItems) {
      try {
        await window.oneMind.notes.createFromQuickNote(
          workspace.workspacePath, "", buildSuggestedName(item.content), item.content
        )
      } catch (e) {
        console.error("Failed to convert:", item.id, e)
      }
    }
    setBatchConvertItems(null)
    setItems(prev => prev.filter(n => !batchConvertItems.map(b => b.id).includes(n.id)))
    setStatus("已批量转为正文笔记。")
    exitSelectMode()
  }

  return (
    <section className="page quicknote-page">
      <header className="quicknote-topbar">
        <div className="quicknote-title">随记</div>
        <div className="quicknote-actions">
          <div className="notes-status">{status}</div>
          {!selectMode ? (
            <button type="button" className="secondary compact" onClick={enterSelectMode}>
              选择
            </button>
          ) : (
            <>
              <button type="button" className="secondary compact" onClick={() => setSelectedIds(items.map(item => item.id))}>
                全选
              </button>
              <button type="button" className="compact" onClick={exitSelectMode}>
                取消
              </button>
            </>
          )}
        </div>
      </header>

      <section className="quicknote-composer-inline">
        <textarea
          className="quicknote-inline-input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="记录想法、网页摘录、待整理内容..."
        />
        <button type="button" className="compact" onClick={handleSave}
          disabled={!workspace || !content.trim() || saving}>
          {saving ? "保存中..." : "保存随记"}
        </button>
      </section>

      <section className={"quicknote-timeline" + (selectMode ? " quicknote-timeline--select-mode" : "")}>
        {groupedItems.length > 0 ? groupedItems.map(group => (
          <div key={group.label} className="quicknote-date-group">
            <div className="date-group-header">{group.label}</div>
            {group.items.map(item => (
              <article
                key={item.id}
                className={"quick-card" + (selectedIds.includes(item.id) ? " selected" : "")}
                onClick={() => selectMode && toggleSelectItem(item.id)}
              >
                {selectMode && (
                  <input
                    className="quick-card-checkbox-native"
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelectItem(item.id)}
                  />
                )}
                <div className="quick-card-content">{item.content}</div>
                <div className="quick-card-meta">
                  <span className="quick-card-time">{formatQuickNoteTime(item.createdAt)}</span>
                  {item.content.length > 40 ? <span className="tag-chip--ai">+ AI 标记</span> : null}
                </div>
                {!selectMode && (
                  <div className="quick-card-actions">
                    <button
                      type="button"
                      className="quick-card-action quick-card-action--muted"
                      onClick={(event) => { event.stopPropagation(); void handleDeleteItem(item) }}
                      disabled={!workspace}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className="quick-card-action"
                      onClick={(event) => { event.stopPropagation(); void handleConvertToNote(item) }}
                      disabled={!workspace || convertingId === item.id}
                    >
                      {convertingId === item.id ? "创建中..." : "转为正文"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )) : (
          <div className="notes-empty">{status}</div>
        )}
      </section>

      {/* Batch bar */}
      {selectMode && (
        <div className="batch-bar">
          <span className="batch-count">已选 {selectedIds.length} 条</span>
          <button type="button" className="secondary compact" onClick={handleBatchDelete}
            disabled={selectedIds.length === 0}>
            删除
          </button>
          <button type="button" className="compact" onClick={handleBatchAiOrganize}
            disabled={selectedIds.length === 0}>
            AI 整理为正文
          </button>
        </div>
      )}

      {/* Single convert dialog */}
      {convertDraft && (
        <div className="convert-overlay" role="presentation" onClick={() => setConvertDraft(null)}>
          <section className="convert-panel" aria-label="随记转正文" onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="settings-section-label">Convert</div>
                <div className="notes-panel-title">转为正文笔记</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setConvertDraft(null)}>
                取消
              </button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">目标目录</span>
                <select className="convert-input" value={convertDraft.relativeDir}
                  onChange={(e) => setConvertDraft(c => c ? { ...c, relativeDir: e.target.value } : c)}>
                  <option value="">notes / 根目录</option>
                  {directoryOptions.map(dir => (
                    <option key={dir} value={dir}>{dir}</option>
                  ))}
                </select>
              </label>
              <label className="convert-field">
                <span className="convert-label">文件名</span>
                <input className="convert-input" value={convertDraft.name}
                  onChange={(e) => setConvertDraft(c => c ? { ...c, name: e.target.value } : c)}
                  placeholder="输入正文笔记名称"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleConfirmConvert() } }} />
              </label>
              <div className="convert-preview">
                <div className="convert-label">内容预览</div>
                <div className="convert-preview-content">{convertDraft.item.content}</div>
              </div>
            </div>
            <div className="convert-footer">
              <div className="convert-hint">Enter 创建，Esc 关闭</div>
              <button type="button" className="compact" onClick={() => void handleConfirmConvert()}
                disabled={convertingId === convertDraft.item.id}>
                {convertingId === convertDraft.item.id ? "创建中..." : "创建正文"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Batch convert dialog */}
      {batchConvertItems && (
        <div className="convert-overlay" role="presentation" onClick={() => setBatchConvertItems(null)}>
          <section className="convert-panel" aria-label="批量转正文" onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="settings-section-label">AI Convert</div>
                <div className="notes-panel-title">AI 整理为正文</div>
              </div>
              <button type="button" className="secondary compact" onClick={() => setBatchConvertItems(null)}>
                取消
              </button>
            </div>
            <div className="convert-body">
              <div className="notes-status">将批量转换 {batchConvertItems.length} 条随记为正文笔记</div>
              {batchConvertItems.map(item => (
                <div key={item.id} className="convert-preview">
                  <div className="convert-label">{formatQuickNoteTime(item.createdAt)}</div>
                  <div className="convert-preview-content">{item.content}</div>
                </div>
              ))}
            </div>
            <div className="convert-footer">
              <div className="convert-hint">AI 自动合并并创建正文笔记</div>
              <button type="button" className="compact" onClick={() => void handleBatchConvert()}>
                开始整理
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
