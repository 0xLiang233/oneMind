import { useEffect, useMemo, useRef, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { ActivitySettingsPanel } from "./ActivitySettingsPanel"

type OutletContext = {
  workspace: WorkspaceMeta | null
  defaultPath?: string
  busy?: boolean
  bridgeReady?: boolean
  handleCreateDefault?: () => Promise<void>
  handleSelectWorkspace?: () => Promise<void>
}

type SettingsGroup = "appearance" | "general" | "miniapps" | "activity" | "editor" | "about"

const defaultPreferences: AppPreferences = {
  theme: "system",
  accent: "purple",
  sidebarPosition: "left",
  startupPage: "last",
  language: "zh-CN",
  editorFontSize: 15,
  editorDefaultMode: "edit",
  floatNoteShortcut: "Alt+Space"
}

const accentValues: Array<{ value: AppPreferences["accent"]; label: string }> = [
  { value: "purple", label: "紫色" },
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "orange", label: "橙色" }
]

const navGroups: Array<{ section: string; items: Array<{ key: SettingsGroup; label: string; icon: string }> }> = [
  { section: "外观", items: [{ key: "appearance", label: "外观", icon: "○" }] },
  {
    section: "通用",
    items: [
      { key: "general", label: "通用", icon: "☼" },
      { key: "miniapps", label: "小程序", icon: "▦" },
      { key: "activity", label: "活跃度", icon: "▥" }
    ]
  },
  { section: "编辑器", items: [{ key: "editor", label: "编辑器", icon: "〉" }] },
  { section: "关于", items: [{ key: "about", label: "关于", icon: "ⓘ" }] }
]

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

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

type ShortcutKeyEvent = Pick<KeyboardEvent | React.KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"> & {
  code?: string
}

function normalizeShortcutKey(event: ShortcutKeyEvent) {
  const keyMap: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab"
  }

  if (event.code === "Space") return "Space"
  return keyMap[event.key] ?? event.key.toUpperCase()
}

function shortcutEventToParts(event: ShortcutKeyEvent, options: { display?: boolean } = {}) {
  const parts: string[] = []
  if (event.ctrlKey) parts.push(options.display ? "Ctrl" : "CommandOrControl")
  if (event.metaKey) parts.push(options.display ? "Win" : "Super")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")

  const key = normalizeShortcutKey(event)
  if (!["CONTROL", "CTRL", "META", "ALT", "SHIFT", "OS", "WIN", "SUPER"].includes(key)) {
    parts.push(key)
  }

  return parts
}

function keyEventToAccelerator(event: ShortcutKeyEvent) {
  const parts = shortcutEventToParts(event)
  const key = parts[parts.length - 1] ?? ""
  if (!key || ["CommandOrControl", "Super", "Alt", "Shift"].includes(key)) return ""
  if (!parts.length && key.length === 1) return ""

  return parts.join("+")
}

function keyEventToDisplayShortcut(event: ShortcutKeyEvent) {
  return shortcutEventToParts(event, { display: true }).join("+")
}

export function SettingsPage() {
  const { workspace, defaultPath, busy, bridgeReady, handleCreateDefault, handleSelectWorkspace } =
    useOutletContext<OutletContext>()
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("appearance")
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences)
  const [miniapps, setMiniapps] = useState<MiniappSource[]>([])
  const [failedMiniappIcons, setFailedMiniappIcons] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState({ name: "", url: "" })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [recordingShortcutPreview, setRecordingShortcutPreview] = useState("")
  const [status, setStatus] = useState("")
  const statusTimerRef = useRef<number | null>(null)
  const savedShortcutRef = useRef(defaultPreferences.floatNoteShortcut)
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null)
  const pendingShortcutRef = useRef("")
  const finishShortcutRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const previewShortcutFromEventRef = useRef<(event: ShortcutKeyEvent) => void>(() => undefined)

  const workspacePath = workspace?.workspacePath ?? ""

  function clearStatusTimer() {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }

  function showStatus(message: string) {
    clearStatusTimer()
    setStatus(message)
    statusTimerRef.current = window.setTimeout(() => {
      setStatus("")
      statusTimerRef.current = null
    }, 2200)
  }

  useEffect(() => {
    if (!workspacePath) {
      return
    }

    async function loadSettings() {
      const [nextPreferences, nextMiniapps] = await Promise.all([
        window.oneMind.preferences.read(workspacePath),
        window.oneMind.miniapps.list(workspacePath)
      ])
      setPreferences(nextPreferences)
      savedShortcutRef.current = nextPreferences.floatNoteShortcut
      setMiniapps(nextMiniapps)
      applyPreferences(nextPreferences)
    }

    void loadSettings()
  }, [workspacePath])

  useEffect(() => {
    return () => clearStatusTimer()
  }, [])

  const activeTitle = useMemo(() => {
    return navGroups.flatMap((group) => group.items).find((item) => item.key === activeGroup)?.label ?? "设置"
  }, [activeGroup])

  async function persistPreferences(nextPreferences: AppPreferences) {
    setPreferences(nextPreferences)
    savedShortcutRef.current = nextPreferences.floatNoteShortcut
    applyPreferences(nextPreferences)
    if (!workspacePath) return
    const saved = await window.oneMind.preferences.write(workspacePath, nextPreferences)
    setPreferences(saved)
    savedShortcutRef.current = saved.floatNoteShortcut
    applyPreferences(saved)
    showStatus("设置已保存。")
  }

  async function persistShortcut(shortcut: string) {
    const nextShortcut = shortcut.trim() || defaultPreferences.floatNoteShortcut
    const registered = await window.oneMind.floatNote.registerShortcut(nextShortcut)
    if (!registered) {
      setPreferences((current) => ({ ...current, floatNoteShortcut: savedShortcutRef.current }))
      setStatus("快捷键注册失败，请换一个组合。")
      return
    }
    await persistPreferences({ ...preferences, floatNoteShortcut: nextShortcut })
  }

  function cancelShortcutRecording() {
    pendingShortcutRef.current = ""
    setRecordingShortcut(false)
    setRecordingShortcutPreview("")
    setStatus("")
  }

  function previewShortcutFromEvent(event: ShortcutKeyEvent) {
    const preview = keyEventToDisplayShortcut(event)
    if (preview) setRecordingShortcutPreview(preview)

    if (normalizeShortcutKey(event) === "Esc") {
      cancelShortcutRecording()
      return
    }

    const shortcut = keyEventToAccelerator(event)
    if (shortcut) pendingShortcutRef.current = shortcut
  }

  async function finishShortcutRecording() {
    const shortcut = pendingShortcutRef.current
    pendingShortcutRef.current = ""
    setRecordingShortcut(false)
    setRecordingShortcutPreview("")

    if (!shortcut) {
      setStatus("快捷键未变更。")
      return
    }

    setPreferences((current) => ({ ...current, floatNoteShortcut: shortcut }))
    await persistShortcut(shortcut)
  }

  useEffect(() => {
    finishShortcutRecordingRef.current = finishShortcutRecording
    previewShortcutFromEventRef.current = previewShortcutFromEvent
  })

  useEffect(() => {
    if (!recordingShortcut) return

    void window.oneMind.window.setSystemMenuEnabled?.(false)
    void window.oneMind.floatNote.setShortcutEnabled?.(false)
    return () => {
      void window.oneMind.window.setSystemMenuEnabled?.(true)
      void window.oneMind.floatNote.setShortcutEnabled?.(true)
    }
  }, [recordingShortcut])

  async function handleShortcutKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (normalizeShortcutKey(event) === "Enter") {
      await finishShortcutRecording()
      return
    }
    previewShortcutFromEvent(event)
  }

  useEffect(() => {
    if (!recordingShortcut) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (normalizeShortcutKey(event) === "Enter") {
        void finishShortcutRecordingRef.current()
        return
      }
      previewShortcutFromEventRef.current(event)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      previewShortcutFromEventRef.current(event)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (shortcutButtonRef.current?.contains(event.target as Node)) return
      void finishShortcutRecordingRef.current()
    }

    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    window.addEventListener("pointerdown", handlePointerDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
      window.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [recordingShortcut, preferences])

  async function handleAddMiniapp() {
    if (!workspacePath) return
    const name = draft.name.trim()
    const url = normalizeUrl(draft.url)
    if (!name || !url) {
      setStatus("请填写小程序名称和 URL。")
      return
    }

    if (editingId) {
      const updated = await window.oneMind.miniapps.update(workspacePath, editingId, { name, url })
      if (updated) {
        setMiniapps((current) => current.map((item) => (item.id === editingId ? updated : item)))
        await window.oneMind.miniappView.close(editingId)
      }
      setEditingId(null)
      showStatus("小程序已更新。")
    } else {
      const created = await window.oneMind.miniapps.create(workspacePath, { name, url })
      setMiniapps((current) => [...current, created])
      showStatus("小程序已添加。")
    }

    setDraft({ name: "", url: "" })
  }

  async function handleDeleteMiniapp(id: string) {
    if (!workspacePath) return
    await window.oneMind.miniapps.delete(workspacePath, id)
    await window.oneMind.miniappView.close(id)
    setMiniapps((current) => current.filter((item) => item.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setDraft({ name: "", url: "" })
    }
    showStatus("小程序已移除。")
  }

  function beginEditMiniapp(item: MiniappSource) {
    setStatus("")
    setEditingId(item.id)
    setDraft({ name: item.name, url: item.url })
  }

  function renderMiniappIcon(item: MiniappSource) {
    if (item.icon && !failedMiniappIcons[item.id]) {
      return (
        <img
          src={item.icon}
          alt=""
          draggable={false}
          onError={() => setFailedMiniappIcons((current) => ({ ...current, [item.id]: true }))}
        />
      )
    }

    return <span>{item.name.slice(0, 1).toUpperCase()}</span>
  }

  function handleGroupChange(group: SettingsGroup) {
    clearStatusTimer()
    setStatus("")
    setActiveGroup(group)
  }

  return (
    <section className="page settings-page">
      <div className="settings-layout settings-prototype-layout">
        <aside className="settings-sidebar">
          {navGroups.map((group) => (
            <div className="settings-nav-group" key={group.section}>
              <div className="settings-section-label">{group.section}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={activeGroup === item.key ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => handleGroupChange(item.key)}
                >
                  <span className="settings-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div className="sidebar-divider" />
            </div>
          ))}
        </aside>

        <section className="settings-content">
          <div className="settings-group-title">{activeTitle}</div>

          {activeGroup === "appearance" ? (
            <>
              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">主题模式</div>
                  <p>选择界面主题外观</p>
                </div>
                <div className="settings-pill-row">
                  {[
                    { value: "dark", label: "暗色" },
                    { value: "light", label: "亮色" },
                    { value: "system", label: "跟随系统" }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={preferences.theme === option.value ? "settings-pill active" : "settings-pill"}
                      onClick={() => void persistPreferences({ ...preferences, theme: option.value as AppPreferences["theme"] })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">强调色</div>
                  <p>自定义界面强调色</p>
                </div>
                <div className="settings-swatch-row" aria-label="强调色">
                  {accentValues.map((accent) => (
                    <button
                      key={accent.value}
                      type="button"
                      title={accent.label}
                      className={preferences.accent === accent.value ? "settings-swatch active" : "settings-swatch"}
                      data-accent-option={accent.value}
                      onClick={() => void persistPreferences({ ...preferences, accent: accent.value })}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">侧边栏位置</div>
                  <p>将侧边栏移动到右侧</p>
                </div>
                <button
                  type="button"
                  className={preferences.sidebarPosition === "right" ? "settings-toggle active" : "settings-toggle"}
                  aria-label="侧边栏位置"
                  onClick={() =>
                    void persistPreferences({
                      ...preferences,
                      sidebarPosition: preferences.sidebarPosition === "left" ? "right" : "left"
                    })
                  }
                />
              </div>
            </>
          ) : null}

          {activeGroup === "general" ? (
            <>
              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">启动时打开</div>
                  <p>应用启动时的默认页面</p>
                </div>
                <select
                  className="settings-select"
                  value={preferences.startupPage}
                  onChange={(event) =>
                    void persistPreferences({
                      ...preferences,
                      startupPage: event.target.value as AppPreferences["startupPage"]
                    })
                  }
                >
                  <option value="last">上次状态</option>
                  <option value="home">首页</option>
                  <option value="notes">笔记</option>
                  <option value="sources">小程序</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">语言</div>
                  <p>界面显示语言</p>
                </div>
                <select
                  className="settings-select"
                  value={preferences.language}
                  onChange={(event) =>
                    void persistPreferences({
                      ...preferences,
                      language: event.target.value as AppPreferences["language"]
                    })
                  }
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">浮动随记快捷键</div>
                  <p>用于全局唤起快速记录面板</p>
                </div>
                <button
                  type="button"
                  className={recordingShortcut ? "settings-shortcut-recorder recording" : "settings-shortcut-recorder"}
                  onClick={() => {
                    if (recordingShortcut) return
                    setRecordingShortcut(true)
                    setRecordingShortcutPreview("")
                    setStatus("请按下新的快捷键组合。")
                    window.setTimeout(() => shortcutButtonRef.current?.focus(), 0)
                  }}
                  ref={shortcutButtonRef}
                  onKeyDown={(event) => void handleShortcutKeyDown(event)}
                >
                  {recordingShortcut ? recordingShortcutPreview || "按下快捷键..." : preferences.floatNoteShortcut}
                </button>
              </div>

              <div className="settings-row">
                <div style={{ flex: 1 }}>
                  <div className="notes-panel-title">工作目录</div>
                  <p style={{ fontSize: "12px", wordBreak: "break-all", marginTop: "4px" }}>
                    {workspace ? workspace.workspacePath : defaultPath || "未设置"}
                  </p>
                </div>
                <div className="settings-inline-actions">
                  <button type="button" className="compact" onClick={handleCreateDefault} disabled={busy || !bridgeReady}>
                    重置默认库
                  </button>
                  <button type="button" className="secondary compact" onClick={handleSelectWorkspace} disabled={busy || !bridgeReady}>
                    选择目录
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {activeGroup === "miniapps" ? (
            <>
              <div className="settings-row settings-row-stack">
                <div>
                  <div className="notes-panel-title">{editingId ? "编辑网页入口" : "添加网页入口"}</div>
                  <p>这些入口会显示在小程序页面，并持久化到当前 workspace。</p>
                </div>
                <div className="settings-miniapp-form">
                  <input
                    className="convert-input"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="名称，例如 ChatGPT"
                  />
                  <input
                    className="convert-input"
                    value={draft.url}
                    onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                    placeholder="https://example.com/"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void handleAddMiniapp()
                      }
                    }}
                  />
                  <button type="button" className="compact" onClick={() => void handleAddMiniapp()}>
                    {editingId ? "保存" : "添加"}
                  </button>
                  {editingId ? (
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => {
                        setEditingId(null)
                        setDraft({ name: "", url: "" })
                      }}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="settings-miniapp-list">
                {miniapps.map((item) => (
                  <div className="settings-miniapp-item" key={item.id}>
                    <div className="settings-miniapp-icon">{renderMiniappIcon(item)}</div>
                    <div className="settings-miniapp-meta">
                      <div className="notes-panel-title">{item.name}</div>
                      <p>{item.url}</p>
                    </div>
                    <button type="button" className="secondary compact" onClick={() => beginEditMiniapp(item)}>
                      编辑
                    </button>
                    <button type="button" className="secondary compact danger" onClick={() => void handleDeleteMiniapp(item.id)}>
                      移除
                    </button>
                  </div>
                ))}
                {miniapps.length === 0 ? <div className="settings-empty">暂无小程序入口。</div> : null}
              </div>
            </>
          ) : null}

          {activeGroup === "activity" ? (
            workspacePath ? (
              <ActivitySettingsPanel workspacePath={workspacePath} />
            ) : (
              <div className="settings-empty">创建或选择工作区后即可查看活跃度。</div>
            )
          ) : null}

          {activeGroup === "editor" ? (
            <>
              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">默认字体大小</div>
                  <p>编辑器文字大小</p>
                </div>
                <div className="settings-slider">
                  <input
                    type="range"
                    min={13}
                    max={22}
                    value={preferences.editorFontSize}
                    onChange={(event) =>
                      void persistPreferences({
                        ...preferences,
                        editorFontSize: Number(event.target.value)
                      })
                    }
                  />
                  <span>{preferences.editorFontSize}</span>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">编辑/预览模式</div>
                  <p>默认打开笔记时使用编辑模式</p>
                </div>
                <button
                  type="button"
                  className={preferences.editorDefaultMode === "edit" ? "settings-toggle active" : "settings-toggle"}
                  aria-label="编辑/预览模式"
                  onClick={() =>
                    void persistPreferences({
                      ...preferences,
                      editorDefaultMode: preferences.editorDefaultMode === "edit" ? "preview" : "edit"
                    })
                  }
                />
              </div>
            </>
          ) : null}

          {activeGroup === "about" ? (
            <>
              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">OneMind</div>
                  <p>个人 AI Agent 工作台</p>
                </div>
                <span className="settings-version">v0.1.0</span>
              </div>

              <div className="settings-row">
                <div>
                  <div className="notes-panel-title">检查更新</div>
                  <p>查看是否有新版本可用</p>
                </div>
                <button type="button" className="secondary compact" onClick={() => showStatus("当前已是最新版本。")}>
                  检查
                </button>
              </div>
            </>
          ) : null}

          {status ? <div className="settings-status">{status}</div> : null}
        </section>
      </div>
    </section>
  )
}
