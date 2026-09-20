import "../styles/workbench-writing.css"
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { trackActivity } from "../activity"
import { ArrowUp, Check, FilePlus, Trash2 } from "../icons"
import { ContextMenu } from "../shell/ContextMenu"

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
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
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
  return new Intl.DateTimeFormat("zh-CN", {
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: "numeric", day: "numeric"
  }).format(date)
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
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(true)
  const [batchConverting, setBatchConverting] = useState(false)
  const [conversionStatus, setConversionStatus] = useState("")
  const [entryMenu, setEntryMenu] = useState<{
    itemId: string; trigger: HTMLButtonElement; x: number; y: number
  } | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<HTMLElement>(null)
  const batchInFlightRef = useRef(false)
  const convertInFlightRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: QuickNote[] }>()
    const newestFirst = [...items].sort((a, b) =>
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    for (const item of newestFirst) {
      const date = new Date(item.createdAt)
      // Full local dates keep different years separate even when labels look similar.
      const key = Number.isNaN(date.getTime()) ? "unknown" : date.toDateString()
      let group = groups.get(key)
      if (!group) {
        group = { key, label: formatDateGroup(item.createdAt), items: [] }
        groups.set(key, group)
      }
      group.items.push(item)
    }
    return [...groups.values()]
  }, [items])

  useLayoutEffect(() => {
    const input = composerRef.current
    if (!input) return
    function resize() {
      if (!input) return
      input.style.height = "auto"
      input.style.height = input.scrollHeight + "px"
    }
    resize()
    let previousWidth = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== previousWidth) {
        previousWidth = input.clientWidth
        resize()
      }
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [content])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds([])
  }, [])

  const handleConfirmConvert = useCallback(async () => {
    if (!workspace || !convertDraft || convertingId || convertInFlightRef.current) return
    const name = convertDraft.name.trim()
    if (!name) { setConversionStatus("请先填写正文笔记名称。"); return }
    convertInFlightRef.current = true
    setConvertingId(convertDraft.item.id)
    setConversionStatus("")
    try {
      const filePath = await window.oneMind.notes.createFromQuickNote(
        workspace.workspacePath, convertDraft.relativeDir, name, convertDraft.item.content
      )
      trackActivity(workspace.workspacePath, {
        module: "quickNote",
        action: "convert",
        targetType: "note",
        targetId: filePath,
        targetLabel: name
      })
      setConvertDraft(null)
      setStatus("已从随记创建正文笔记。")
      navigate("/notes?selected=" + encodeURIComponent(filePath))
    } catch {
      setConversionStatus("创建失败，原随记已保留，请重试。")
    } finally { convertInFlightRef.current = false; setConvertingId(null) }
  }, [convertDraft, convertingId, navigate, workspace])

  const handleBatchConvert = useCallback(async () => {
    if (!workspace || !batchConvertItems || batchInFlightRef.current) return
    batchInFlightRef.current = true
    setBatchConverting(true)
    setConversionStatus("")
    const failed: QuickNote[] = []
    let convertedCount = 0
    try {
      for (const item of batchConvertItems) {
        try {
          await window.oneMind.notes.createFromQuickNote(
            workspace.workspacePath, "", buildSuggestedName(item.content), item.content
          )
          convertedCount += 1
        } catch {
          failed.push(item)
        }
      }
      if (convertedCount > 0) {
        trackActivity(workspace.workspacePath, {
          module: "quickNote", action: "convert", targetType: "note",
          targetLabel: "批量转正文 " + convertedCount + " 条",
          metadata: { count: convertedCount }
        })
      }
      // Creating note files does not delete or hide original captures.
      // Retry only failed items so successful note files aren't duplicated.
      if (failed.length > 0) {
        setBatchConvertItems(failed)
        setSelectedIds(failed.map(item => item.id))
        setConversionStatus("已创建 " + convertedCount + " 篇正文，" + failed.length + " 条失败。原随记均已保留，可重试失败项。")
      } else {
        setBatchConvertItems(null)
        setStatus("已创建 " + convertedCount + " 篇正文，原随记已保留。")
        exitSelectMode()
      }
    } finally {
      batchInFlightRef.current = false
      setBatchConverting(false)
    }
  }, [batchConvertItems, exitSelectMode, workspace])

  useEffect(() => {
    let cancelled = false
    async function loadQuickNotes() {
      setLoading(true)
      setStatus("")
      setItems([])
      setSelectedIds([])
      setSelectMode(false)
      setEntryMenu(null)
      if (!workspace) {
        setLoading(false)
        return
      }
      try {
        const next = await window.oneMind.quickNotes.list(workspace.workspacePath)
        if (!cancelled) setItems(next)
      } catch {
        if (!cancelled) setStatus("随记加载失败，请重新打开此页重试。")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadQuickNotes()
    return () => { cancelled = true }
  }, [workspace])

  useEffect(() => {
    if (!convertDraft) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || convertingId) return
      if (event.key === "Escape") { setConvertDraft(null); return }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        void handleConfirmConvert()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [convertDraft, convertingId, handleConfirmConvert])

  useEffect(() => {
    if (!batchConvertItems) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || batchInFlightRef.current) return
      if (event.key === "Escape") { setBatchConvertItems(null); return }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        void handleBatchConvert()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [batchConvertItems, handleBatchConvert])

  // Escape exits select mode
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && selectMode && !batchConvertItems && !entryMenu) {
        exitSelectMode()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [batchConvertItems, entryMenu, exitSelectMode, selectMode])

  function toggleSelectItem(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  async function handleSave() {
    if (!workspace || !content.trim() || saving || loading || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaving(true)
    try {
      const created = await window.oneMind.quickNotes.create(workspace.workspacePath, content)
      trackActivity(workspace.workspacePath, {
        module: "quickNote",
        action: "create",
        targetType: "quickNote",
        targetId: created.id,
        targetLabel: content.split("\n")[0].trim().slice(0, 32) || "随记"
      })
      setItems(current => [created, ...current])
      setContent(current => current === content ? "" : current)
      setStatus("已保存")
      composerRef.current?.focus()
      timelineRef.current?.closest(".writing-capture")?.scrollTo({ top: 0 })
    } catch {
      setStatus("保存失败，内容还在输入框中，请重试。")
    } finally { saveInFlightRef.current = false; setSaving(false) }
  }

  async function handleConvertToNote(item: QuickNote) {
    if (!workspace || convertingId) return
    setConvertingId(item.id)
    try {
      const directories = await window.oneMind.notes.listDirectories(workspace.workspacePath)
      setDirectoryOptions(directories)
      setConversionStatus("")
      setConvertDraft({ item, relativeDir: "", name: buildSuggestedName(item.content) })
    } catch {
      setStatus("无法读取笔记目录，请重试。")
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

  function handleBatchOrganize() {
    if (!workspace || selectedIds.length === 0) return
    setConversionStatus("")
    setBatchConvertItems(items.filter(item => selectedIds.includes(item.id)))
  }

  function openEntryMenu(item: QuickNote, trigger: HTMLButtonElement) {
    const rect = trigger.getBoundingClientRect()
    setEntryMenu(current => current?.itemId === item.id ? null : {
      itemId: item.id, trigger, x: rect.right, y: rect.bottom + 4
    })
  }

  const menuItem = items.find(item => item.id === entryMenu?.itemId)

  return (
    <section className="page quicknote-page writing-capture" onScroll={() => setEntryMenu(null)}>
      <header className="quicknote-topbar">
        <div className="quicknote-heading">
          <h1 className="quicknote-title">随记</h1>
          <span className="quicknote-count">{loading ? "加载中…" : items.length + " 条"}</span>
        </div>
        {items.length > 0 && (
          <button type="button" className="quicknote-select-button" aria-pressed={selectMode}
            disabled={batchConverting}
            onClick={() => { setEntryMenu(null); if (selectMode) exitSelectMode(); else setSelectMode(true) }}>
            {selectMode ? "退出选择" : "选择"}
          </button>
        )}
      </header>

      <section className="quicknote-composer-inline" aria-label="写随记" aria-busy={saving}>
        <textarea
          ref={composerRef}
          className="quicknote-inline-input"
          aria-label="随记内容"
          aria-describedby="quicknote-composer-hint"
          rows={1}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void handleSave()
            }
          }}
          placeholder="记下一个想法、待办或片段…"
        />
        <div className="quicknote-composer-footer">
          <div className="quicknote-composer-messages">
            <span id="quicknote-composer-hint" className="quicknote-composer-hint">Ctrl+Enter 保存 · Enter 换行</span>
            <span className="quicknote-composer-status" role="status">{saving ? "保存中…" : status}</span>
          </div>
          <button type="button" className="quicknote-save-button" onClick={() => void handleSave()}
            disabled={!workspace || !content.trim() || saving || loading}
            aria-label={saving ? "保存中" : "保存随记"} title="保存随记（Ctrl+Enter）">
            <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </section>

      {selectMode && (
        <div className="batch-bar" role="group" aria-label="批量操作">
          <span className="batch-count">已选 {selectedIds.length} 条</span>
          <button type="button" className="secondary compact" disabled={batchConverting}
            onClick={() => setSelectedIds(selectedIds.length === items.length ? [] : items.map(item => item.id))}>
            {selectedIds.length === items.length ? "取消全选" : "全选"}
          </button>
          <button type="button" className="secondary compact" onClick={() => void handleBatchDelete()}
            disabled={selectedIds.length === 0 || batchConverting}>删除</button>
          <button type="button" className="compact" onClick={handleBatchOrganize}
            disabled={selectedIds.length === 0 || batchConverting}>转为正文</button>
        </div>
      )}

      <section ref={timelineRef} className={"quicknote-timeline" + (selectMode ? " quicknote-timeline--select-mode" : "")}
        aria-label="随记记录" aria-busy={loading}>
        {groupedItems.map(group => (
          <section key={group.key} className="quicknote-date-group" aria-label={group.label}>
            <h2 className="date-group-header">{group.label}</h2>
            {group.items.map(item => (
              <CaptureEntry key={item.id} item={item} selectMode={selectMode}
                selected={selectedIds.includes(item.id)} onSelect={() => toggleSelectItem(item.id)}
                menuOpen={entryMenu?.itemId === item.id} onOpenMenu={openEntryMenu}
                busy={convertingId === item.id} />
            ))}
          </section>
        ))}
        {items.length === 0 && (
          <div className="notes-empty">
            {loading ? "正在读取随记…" : !workspace ? "先选择或创建工作区，再开始记录。" : status || "想到什么就记下来。之后可从记录菜单转为正文。"}
          </div>
        )}
      </section>

      {entryMenu && menuItem && (
        <ContextMenu id="capture-entry-menu" ariaLabel="随记操作" trigger={entryMenu.trigger}
          x={entryMenu.x} y={entryMenu.y} onClose={() => setEntryMenu(null)}
          items={[
            [
              { label: "转为正文", action: "convert", icon: <FilePlus size={16} />, disabled: !workspace || Boolean(convertingId) },
              { label: "选择记录", action: "select", icon: <Check size={16} /> }
            ],
            [{ label: "删除", action: "delete", icon: <Trash2 size={16} />, danger: true, disabled: !workspace }]
          ]}
          onAction={(action) => {
            if (action === "convert") void handleConvertToNote(menuItem)
            else if (action === "delete") void handleDeleteItem(menuItem)
            else if (action === "select") { setSelectMode(true); setSelectedIds([menuItem.id]) }
          }} />
      )}

      {/* Single convert dialog */}
      {convertDraft && (
        <div className="convert-overlay" role="presentation" onClick={() => { if (!convertingId) setConvertDraft(null) }}>
          <section className="convert-panel" aria-label="随记转正文" aria-busy={Boolean(convertingId)} onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="writing-dialog-eyebrow">随记</div>
                <div className="notes-panel-title">转为正文笔记</div>
              </div>
              <button type="button" className="secondary compact" disabled={Boolean(convertingId)} onClick={() => setConvertDraft(null)}>
                取消
              </button>
            </div>
            <div className="convert-body">
              <label className="convert-field">
                <span className="convert-label">目标目录</span>
                <select className="convert-input" disabled={Boolean(convertingId)} value={convertDraft.relativeDir}
                  onChange={(e) => setConvertDraft(c => c ? { ...c, relativeDir: e.target.value } : c)}>
                  <option value="">notes / 根目录</option>
                  {directoryOptions.map(dir => (
                    <option key={dir} value={dir}>{dir}</option>
                  ))}
                </select>
              </label>
              <label className="convert-field">
                <span className="convert-label">文件名</span>
                <input className="convert-input" disabled={Boolean(convertingId)} value={convertDraft.name}
                  onChange={(e) => setConvertDraft(c => c ? { ...c, name: e.target.value } : c)}
                  placeholder="输入正文笔记名称"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void handleConfirmConvert() } }} />
              </label>
              <div className="convert-preview">
                <div className="convert-label">内容预览</div>
                <div className="convert-preview-content">{convertDraft.item.content}</div>
              </div>
            </div>
            <div className="convert-footer">
              <div className="convert-hint" role="status">{conversionStatus || "原随记保留 · Ctrl+Enter 创建 · Esc 关闭"}</div>
              <button type="button" className="compact" onClick={() => void handleConfirmConvert()}
                disabled={convertingId === convertDraft.item.id || !convertDraft.name.trim()}>
                {convertingId === convertDraft.item.id ? "创建中..." : "创建正文"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Batch convert dialog */}
      {batchConvertItems && (
        <div className="convert-overlay" role="presentation" onClick={() => { if (!batchConverting) setBatchConvertItems(null) }}>
          <section className="convert-panel" aria-label="批量转正文" aria-busy={batchConverting} onClick={(e) => e.stopPropagation()}>
            <div className="convert-header">
              <div>
                <div className="writing-dialog-eyebrow">批量整理</div>
                <div className="notes-panel-title">批量转为正文</div>
              </div>
              <button type="button" className="secondary compact" disabled={batchConverting} onClick={() => setBatchConvertItems(null)}>
                取消
              </button>
            </div>
            <div className="convert-body">
              <div className="convert-hint">为 {batchConvertItems.length} 条随记各创建一篇正文，保存到 notes 根目录。</div>
              {batchConvertItems.map(item => (
                <div key={item.id} className="convert-preview">
                  <div className="convert-label">{formatDateGroup(item.createdAt)} · {formatQuickNoteTime(item.createdAt)}</div>
                  <div className="convert-preview-content">{item.content}</div>
                </div>
              ))}
            </div>
            <div className="convert-footer">
              <div className="convert-hint" role="status">{batchConverting ? "正在创建正文，请稍候…" : conversionStatus || "原随记保留 · Ctrl+Enter 创建 · Esc 关闭"}</div>
              <button type="button" className="compact" disabled={batchConverting} onClick={() => void handleBatchConvert()}>
                {batchConverting ? "创建中…" : conversionStatus ? "重试失败项" : "创建正文"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

// Measure wrapping instead of truncating by character count: paragraphs, URLs and
// pasted multiline text retain their original content at every reading width.
function CaptureEntry({ item, selectMode, selected, onSelect, menuOpen, onOpenMenu, busy }: {
  item: QuickNote
  selectMode: boolean
  selected: boolean
  onSelect: () => void
  menuOpen: boolean
  onOpenMenu: (item: QuickNote, trigger: HTMLButtonElement) => void
  busy: boolean
}) {
  const contentId = useId()
  const textRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)

  useLayoutEffect(() => {
    const text = textRef.current
    if (!text) return
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight)
      setCanExpand(text.getBoundingClientRect().height > lineHeight * 5 + 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => observer.disconnect()
  }, [item.content])

  return (
    <article className={"quick-card" + (selected ? " selected" : "")}
      onClick={() => { if (selectMode) onSelect() }}>
      <div className="quick-card-leading">
        {selectMode && (
          <input className="quick-card-checkbox-native" type="checkbox" checked={selected}
            aria-label={"选择随记：" + item.content.slice(0, 40)}
            onClick={(event) => event.stopPropagation()} onChange={onSelect} />
        )}
        <time className="quick-card-time" dateTime={item.createdAt}>{formatQuickNoteTime(item.createdAt)}</time>
      </div>
      <div className="quick-card-body">
        <div id={contentId} className={"quick-card-content" + (!expanded ? " quick-card-content--collapsed" : "")}>
          <div ref={textRef} className="quick-card-text">{item.content}</div>
        </div>
        {canExpand && (
          <button type="button" className="quick-card-expand" aria-expanded={expanded} aria-controls={contentId}
            onClick={(event) => { event.stopPropagation(); setExpanded(current => !current) }}>
            {expanded ? "收起全文" : "展开全文"}
          </button>
        )}
      </div>
      {!selectMode && (
        <button type="button" className="quick-card-menu" aria-label={"随记操作：" + item.content.slice(0, 24)}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? "capture-entry-menu" : undefined}
          disabled={busy} title={busy ? "准备正文…" : "随记操作"}
          onClick={(event) => { event.stopPropagation(); onOpenMenu(item, event.currentTarget) }}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <circle cx="3" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="13" cy="8" r="1.25" />
          </svg>
        </button>
      )}
    </article>
  )
}
