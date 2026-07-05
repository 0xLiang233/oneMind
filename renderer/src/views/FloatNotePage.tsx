import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

type FloatMode = "quick" | "tools"
type SaveState = "idle" | "saving" | "saved"

type FloatCommand = {
  id: string
  label: string
  keywords: string[]
  shortcut?: string
  route?: string
}

type ToolResult =
  | { type: "command"; id: string; label: string; subtitle: string; shortcut?: string; command: FloatCommand }
  | { type: "app"; id: string; label: string; subtitle: string; app: SystemAppEntry }

const modes: Array<{ key: FloatMode; label: string }> = [
  { key: "quick", label: "随记" },
  { key: "tools", label: "工具" }
]

const commands: FloatCommand[] = [
  { id: "new-note", label: "新建笔记", keywords: ["笔记", "note", "新建", "md"], shortcut: "Ctrl+N", route: "/notes" },
  { id: "search-notes", label: "搜索笔记", keywords: ["搜索", "search", "查找", "find"], shortcut: "Ctrl+F", route: "/search" },
  { id: "open-miniapps", label: "打开小程序", keywords: ["小程序", "app", "应用", "miniapp"], route: "/sources" },
  { id: "open-settings", label: "打开设置", keywords: ["设置", "settings", "偏好", "config"], shortcut: "Ctrl+,", route: "/settings" }
]

const FLOAT_PAGE_VERTICAL_PADDING = 12
const FLOAT_HEADER_BASE_HEIGHT = 58
const FLOAT_HEADER_VERTICAL_PADDING = 29
const FLOAT_HINT_HEIGHT = 42
const QUICK_INPUT_LINE_HEIGHT = 28
const QUICK_INPUT_MIN_HEIGHT = 32
const QUICK_INPUT_MAX_LINES = 10
const QUICK_INPUT_VERTICAL_PADDING = 4
const INPUT_FOCUS_FALLBACK_DELAY_MS = 140
const FLOAT_MIN_WINDOW_HEIGHT = 150
const FLOAT_MAX_WINDOW_HEIGHT = 560
const FLOAT_WINDOW_HEIGHT_BUFFER = 2

function QuickModeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M5 15.8L4.2 18.6L7 17.8L16.7 8.1C17.3 7.5 17.3 6.5 16.7 5.9L16.1 5.3C15.5 4.7 14.5 4.7 13.9 5.3L5 14.2V15.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 6.4L15.6 9.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ToolsModeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="9.5" cy="9.5" r="5.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L18.2 18.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function FloatNotePage() {
  const [workspace, setWorkspace] = useState<WorkspaceMeta | null>(null)
  const [mode, setMode] = useState<FloatMode>("quick")
  const [value, setValue] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [status, setStatus] = useState("")
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [systemApps, setSystemApps] = useState<SystemAppEntry[]>([])
  const [isSearchingApps, setIsSearchingApps] = useState(false)
  const [systemAppsError, setSystemAppsError] = useState("")
  const [systemAppSearchRefreshToken, setSystemAppSearchRefreshToken] = useState(0)
  const [bridgeReadyToken, setBridgeReadyToken] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const paletteRef = useRef<HTMLElement | null>(null)
  const lastWindowHeightRef = useRef(0)
  const pendingWindowHeightRef = useRef(0)
  const resizeFrameRef = useRef(0)
  const focusTimersRef = useRef<number[]>([])
  const focusRequestIdRef = useRef(0)
  const appSearchRequestIdRef = useRef(0)
  const debugEnabledRef = useRef(false)
  const requestInputFocusRef = useRef<() => void>(() => undefined)
  const syncPanelHeightRef = useRef<() => void>(() => undefined)
  const resetPaletteRef = useRef<() => void>(() => undefined)

  function getFocusSnapshot(stage: string) {
    const input = inputRef.current
    const activeElement = document.activeElement as HTMLElement | null
    return JSON.stringify({
      stage,
      hasDocumentFocus: document.hasFocus(),
      visibilityState: document.visibilityState,
      activeTag: activeElement?.tagName ?? null,
      activeClass: activeElement?.className ?? null,
      inputExists: Boolean(input),
      inputDisabled: Boolean(input?.disabled),
      inputIsActive: Boolean(input && activeElement === input),
      valueLength: input?.value.length ?? null
    })
  }

  function writeDebugLog(message: string, context?: string) {
    if (!debugEnabledRef.current) return
    void window.oneMind.diagnostics.writeLog("renderer-debug", message, context).catch((error: unknown) => {
      console.warn("Failed to write float note debug log:", error)
    })
  }

  function isInputFocused() {
    const input = inputRef.current
    return Boolean(input && document.hasFocus() && document.activeElement === input)
  }

  function focusInput(stage = "focus") {
    const input = inputRef.current
    if (isInputFocused()) {
      writeDebugLog("float_note_focus_input_skipped", getFocusSnapshot(`${stage}_already_focused`))
      return
    }
    writeDebugLog("float_note_focus_input_before", getFocusSnapshot(stage))
    if (!input || input.disabled) {
      writeDebugLog("float_note_focus_input_skipped", getFocusSnapshot("skipped"))
      return
    }
    input.focus({ preventScroll: true })
    const end = input.value.length
    input.setSelectionRange(end, end)
    window.setTimeout(() => {
      writeDebugLog("float_note_focus_input_after", getFocusSnapshot("after_timeout_0"))
    }, 0)
  }

  function clearFocusTimers() {
    focusTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    focusTimersRef.current = []
  }

  function requestInputFocus() {
    clearFocusTimers()
    const requestId = focusRequestIdRef.current + 1
    focusRequestIdRef.current = requestId
    writeDebugLog("float_note_request_input_focus", getFocusSnapshot("request_start"))
    if (document.visibilityState !== "visible") {
      writeDebugLog("float_note_request_input_focus_skipped", getFocusSnapshot("hidden"))
      return
    }
    window.requestAnimationFrame(() => {
      if (focusRequestIdRef.current === requestId) {
        focusInput("raf")
      }
    })
    ;[INPUT_FOCUS_FALLBACK_DELAY_MS].forEach((delay) => {
      const timer = window.setTimeout(() => {
        if (focusRequestIdRef.current === requestId) {
          focusInput(`delay_${delay}`)
        }
      }, delay)
      focusTimersRef.current.push(timer)
    })
  }

  function getVisualLineCount(text: string) {
    return Math.max(1, text.split("\n").length)
  }

  function getQuickInputHeight(text = value) {
    const lines = Math.min(getVisualLineCount(text), QUICK_INPUT_MAX_LINES)
    return Math.max(QUICK_INPUT_MIN_HEIGHT, Math.ceil(lines * QUICK_INPUT_LINE_HEIGHT + QUICK_INPUT_VERTICAL_PADDING))
  }

  function resizeQuickInput(text = value) {
    const input = inputRef.current
    if (!input) return QUICK_INPUT_MIN_HEIGHT
    const inputHeight = getQuickInputHeight(text)
    input.style.height = `${inputHeight}px`
    input.style.overflowY = getVisualLineCount(text) > QUICK_INPUT_MAX_LINES ? "auto" : "hidden"
    input.scrollTop = input.scrollHeight
    return inputHeight
  }

  function scheduleWindowHeight(height: number) {
    const clampedHeight = Math.min(Math.max(Math.ceil(height), FLOAT_MIN_WINDOW_HEIGHT), FLOAT_MAX_WINDOW_HEIGHT)
    if (clampedHeight === lastWindowHeightRef.current) return
    pendingWindowHeightRef.current = clampedHeight
    if (resizeFrameRef.current) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = 0
      const nextHeight = pendingWindowHeightRef.current
      if (nextHeight === lastWindowHeightRef.current) return
      lastWindowHeightRef.current = nextHeight
      void window.oneMind.floatNote.setHeight(nextHeight)
    })
  }

  function invalidateWindowHeightCache() {
    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = 0
    }
    lastWindowHeightRef.current = 0
    pendingWindowHeightRef.current = 0
  }

  function getEstimatedWindowHeight(inputHeight: number) {
    const headerHeight = Math.max(FLOAT_HEADER_BASE_HEIGHT, inputHeight + FLOAT_HEADER_VERTICAL_PADDING)
    return Math.max(FLOAT_MIN_WINDOW_HEIGHT, Math.ceil(headerHeight + FLOAT_HINT_HEIGHT + FLOAT_PAGE_VERTICAL_PADDING))
  }

  function getMeasuredWindowHeight(fallbackHeight: number) {
    const palette = paletteRef.current
    if (!palette) return fallbackHeight
    const paletteHeight = Math.max(palette.scrollHeight, palette.getBoundingClientRect().height)
    return Math.max(fallbackHeight, Math.ceil(paletteHeight + FLOAT_PAGE_VERTICAL_PADDING + FLOAT_WINDOW_HEIGHT_BUFFER))
  }

  function cancelSystemAppSearch() {
    appSearchRequestIdRef.current += 1
    setIsSearchingApps(false)
  }

  const commandMatches = useMemo(() => {
    const query = value.trim().toLowerCase()
    if (!query) return []
    return commands.filter((command) => {
      return command.label.toLowerCase().includes(query) || command.keywords.some((keyword) => keyword.includes(query))
    })
  }, [value])

  const toolResults = useMemo<ToolResult[]>(() => {
    const appResults = systemApps.map<ToolResult>((appEntry) => ({
      type: "app",
      id: `app:${appEntry.id}`,
      label: appEntry.name,
      subtitle: appEntry.source === "recent" ? "最近使用" : "系统应用",
      app: appEntry
    }))
    const commandResults = commandMatches.map<ToolResult>((command) => ({
      type: "command",
      id: `command:${command.id}`,
      label: command.label,
      subtitle: "OneMind 指令",
      shortcut: command.shortcut,
      command
    }))
    return [...appResults, ...commandResults].slice(0, 12)
  }, [commandMatches, systemApps])
  const isToolHome = mode === "tools" && !value.trim()
  const hasToolQuery = mode === "tools" && Boolean(value.trim())
  const hasAppResults = toolResults.some((result) => result.type === "app")

  useEffect(() => {
    function handleBridgeReady() {
      setBridgeReadyToken((current) => current + 1)
    }

    window.addEventListener("oneMindBridgeReady", handleBridgeReady)
    return () => window.removeEventListener("oneMindBridgeReady", handleBridgeReady)
  }, [])

  useEffect(() => {
    let disposed = false
    async function initDebugMode() {
      const localEnabled = localStorage.getItem("onemindDebug") === "1"
        || localStorage.getItem("onemind:debug") === "1"
      const report = await window.oneMind.diagnostics.getDebugMode().catch(() => ({ enabled: false, source: "unavailable" }))
      if (disposed) return
      debugEnabledRef.current = localEnabled || report.enabled
      writeDebugLog("float_note_debug_mode_ready", JSON.stringify({
        localEnabled,
        nativeEnabled: report.enabled,
        source: report.source
      }))
    }

    void initDebugMode()
    return () => {
      disposed = true
    }
  }, [bridgeReadyToken])

  useEffect(() => {
    function handleWindowFocus() {
      writeDebugLog("float_note_window_focus_event", getFocusSnapshot("window_focus"))
      requestInputFocusRef.current()
    }

    function handleVisibilityChange() {
      writeDebugLog("float_note_visibility_change", getFocusSnapshot("visibility_change"))
      if (document.visibilityState === "visible") {
        requestInputFocusRef.current()
      }
    }

    window.addEventListener("focus", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add("float-note-shell")
    document.body.classList.add("float-note-shell")
    if (window.oneMind.runtime?.bridgeReady === false) {
      return () => {
        document.documentElement.classList.remove("float-note-shell")
        document.body.classList.remove("float-note-shell")
      }
    }

    let disposed = false
    void window.oneMind.workspace.initDefault().then((nextWorkspace) => {
      if (!disposed) setWorkspace(nextWorkspace)
    }).catch((error: unknown) => {
      console.warn("Failed to initialize float note workspace:", error)
    })
    const unsubscribe = window.oneMind.floatNote.onShown((reason) => {
      writeDebugLog("float_note_on_shown_event", JSON.stringify({ reason, snapshot: JSON.parse(getFocusSnapshot("on_shown")) }))
      if (reason === "shown") {
        invalidateWindowHeightCache()
        resetPaletteRef.current()
      }
      window.requestAnimationFrame(() => {
        if (reason === "shown") {
          syncPanelHeightRef.current()
        }
        requestInputFocusRef.current()
      })
    })
    window.requestAnimationFrame(() => {
      syncPanelHeightRef.current()
      requestInputFocusRef.current()
    })
    return () => {
      disposed = true
      unsubscribe()
      clearFocusTimers()
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      document.documentElement.classList.remove("float-note-shell")
      document.body.classList.remove("float-note-shell")
    }
  }, [bridgeReadyToken])

  useEffect(() => {
    if (!workspace || mode !== "tools") {
      appSearchRequestIdRef.current += 1
      return
    }
    let disposed = false
    const requestId = appSearchRequestIdRef.current + 1
    appSearchRequestIdRef.current = requestId
    const timer = window.setTimeout(() => {
      if (disposed || appSearchRequestIdRef.current !== requestId) return
      setIsSearchingApps(true)
      setSystemAppsError("")
      void window.oneMind.systemApps.search(workspace.workspacePath, value)
        .then((apps) => {
          if (disposed || appSearchRequestIdRef.current !== requestId) return
          setSystemApps(apps)
        })
        .catch((error: unknown) => {
          if (disposed || appSearchRequestIdRef.current !== requestId) return
          console.warn("Failed to search system apps:", error)
          setSystemApps([])
          setSystemAppsError("系统应用搜索暂不可用")
        })
        .finally(() => {
          if (!disposed && appSearchRequestIdRef.current === requestId) {
            setIsSearchingApps(false)
          }
        })
    }, value.trim() ? 90 : 0)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [mode, systemAppSearchRefreshToken, value, workspace])

  function syncPanelHeight() {
    const inputHeight = resizeQuickInput()
    scheduleWindowHeight(getMeasuredWindowHeight(getEstimatedWindowHeight(inputHeight)))
  }

  useEffect(() => {
    requestInputFocusRef.current = requestInputFocus
    syncPanelHeightRef.current = syncPanelHeight
    resetPaletteRef.current = resetPalette
  })

  useLayoutEffect(() => {
    syncPanelHeightRef.current()
  }, [toolResults.length, mode, saveState, value])

  useEffect(() => {
    if (!window.ResizeObserver) return
    const observedElements: Element[] = []
    if (paletteRef.current) observedElements.push(paletteRef.current)
    if (inputRef.current) observedElements.push(inputRef.current)
    if (observedElements.length === 0) return
    const observer = new ResizeObserver(() => {
      syncPanelHeightRef.current()
    })
    observedElements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  function resetPalette() {
    cancelSystemAppSearch()
    setValue("")
    setActiveIndex(0)
    setStatus("")
    setSaveState("idle")
    setSystemApps([])
    setSystemAppsError("")
    setIsSearchingApps(false)
    setSystemAppSearchRefreshToken((current) => current + 1)
  }

  function switchMode() {
    cancelSystemAppSearch()
    setMode((current) => {
      const index = modes.findIndex((item) => item.key === current)
      return modes[(index + 1) % modes.length].key
    })
    setValue("")
    setActiveIndex(0)
    setStatus("")
    setSystemAppsError("")
    requestInputFocus()
  }

  function handleValueChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value
    const inputHeight = resizeQuickInput(nextValue)
    scheduleWindowHeight(getMeasuredWindowHeight(getEstimatedWindowHeight(inputHeight)))
    setValue(nextValue)
    setActiveIndex(0)
  }

  async function saveQuickNote(closeAfterSave: boolean) {
    const content = value.trim()
    if (!content || saveState === "saving") return
    setSaveState("saving")
    setStatus("")
    const activeWorkspace = workspace ?? await window.oneMind.workspace.initDefault()
    setWorkspace(activeWorkspace)
    await window.oneMind.quickNotes.create(activeWorkspace.workspacePath, content)
    setSaveState("saved")
    setStatus("已保存")
    if (closeAfterSave) {
      window.setTimeout(() => {
        resetPalette()
        void window.oneMind.floatNote.hide()
      }, 520)
      return
    }
    window.setTimeout(() => {
      setValue("")
      setStatus("")
      setSaveState("idle")
      requestInputFocus()
    }, 520)
  }

  async function runToolResult(result: ToolResult | undefined) {
    if (!result || !workspace) return
    if (result.type === "app") {
      await window.oneMind.systemApps.open(workspace.workspacePath, result.app)
      return
    }
    if (!result.command.route) return
    await window.oneMind.floatNote.openRoute(result.command.route)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      switchMode()
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      void window.oneMind.floatNote.hide()
      return
    }

    if (mode === "tools") {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        if (isToolHome || toolResults.length === 0) return
        setActiveIndex((current) => Math.min(current + 1, toolResults.length - 1))
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        if (isToolHome || toolResults.length === 0) return
        setActiveIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        if (toolResults.length === 0) return
        setActiveIndex((current) => Math.min(current + 1, toolResults.length - 1))
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        if (toolResults.length === 0) return
        setActiveIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        void runToolResult(toolResults[activeIndex])
      }
      return
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void saveQuickNote(!(event.ctrlKey || event.metaKey))
    }
  }

  const placeholder = mode === "quick" ? "记录想法..." : "搜索工具..."
  const shortcutHint = mode === "quick" ? "Enter 保存 · Shift+Enter 换行 · Shift+Tab 切换模式" : "Enter 打开 · 方向键选择 · Shift+Tab 切换模式"
  const handleInputFocusEvent = () => writeDebugLog("float_note_input_focus_event", getFocusSnapshot("input_focus"))
  const handleInputBlurEvent = () => writeDebugLog("float_note_input_blur_event", getFocusSnapshot("input_blur"))
  const handleInputMouseDownEvent = () => writeDebugLog("float_note_input_mousedown_event", getFocusSnapshot("input_mousedown"))

  return (
    <main className="float-note-page" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        void window.oneMind.floatNote.hide()
      }
    }}>
      <section ref={paletteRef} className={"float-note-palette mode-" + mode} onMouseDown={(event) => event.stopPropagation()}>
        <header className="float-note-header">
          <button type="button" className="float-note-mode-wheel" onClick={switchMode} aria-label="切换模式">
            <span className="float-note-mode-wheel-track">
              <span className="float-note-mode-wheel-item">
                <QuickModeIcon />
              </span>
              <span className="float-note-mode-wheel-item">
                <ToolsModeIcon />
              </span>
            </span>
          </button>
          <textarea
            ref={inputRef}
            className="float-note-input float-note-text-input"
            value={value}
            onChange={handleValueChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocusEvent}
            onBlur={handleInputBlurEvent}
            onMouseDown={handleInputMouseDownEvent}
            placeholder={placeholder}
            spellCheck={false}
            rows={1}
            disabled={saveState === "saving" || saveState === "saved"}
          />
          {mode === "quick" && saveState !== "idle" ? (
            <span className={"float-note-save-indicator " + saveState} aria-label={saveState === "saving" ? "保存中" : "已保存"}>
              {saveState === "saving" ? null : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7.2L5.8 10L11 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          ) : null}
        </header>

        {mode === "tools" && isToolHome ? (
          <section className="float-note-app-grid" aria-label="最近使用">
            <div className="float-note-section-title">
              <span>最近使用</span>
              {isSearchingApps ? <span className="float-note-section-status">搜索中</span> : null}
            </div>
            <div className="float-note-app-row">
              {toolResults.map((result, index) => (
                <button
                  key={result.id}
                  type="button"
                  className={activeIndex === index ? "float-note-app-tile active" : "float-note-app-tile"}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void runToolResult(result)}
                >
                  <span className={"float-note-app-icon " + result.type}>
                    {result.type === "app" && result.app.icon ? <img src={result.app.icon} alt="" /> : result.label.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="float-note-app-name">{result.label}</span>
                </button>
              ))}
              {toolResults.length === 0 ? (
                <div className="float-note-empty">{systemAppsError || (isSearchingApps ? "正在加载应用..." : "输入关键词搜索应用")}</div>
              ) : null}
            </div>
          </section>
        ) : mode === "tools" ? (
          <section className="float-note-results">
            {isSearchingApps ? <div className="float-note-results-status">正在搜索系统应用...</div> : null}
            {toolResults.map((result, index) => (
              <button
                key={result.id}
                type="button"
                className={activeIndex === index ? "float-note-result active" : "float-note-result"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void runToolResult(result)}
              >
                <span className="float-note-result-main">
                  <span className={"float-note-result-icon " + result.type}>
                    {result.type === "app" && result.app.icon ? <img src={result.app.icon} alt="" /> : result.label.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="float-note-result-copy">
                    <span>{result.label}</span>
                    <small>{result.subtitle}</small>
                  </span>
                </span>
                {result.type === "command" && result.shortcut ? <kbd>{result.shortcut}</kbd> : null}
              </button>
            ))}
            {toolResults.length === 0 && !isSearchingApps ? (
              <div className="float-note-empty">{systemAppsError || `没有找到与「${value.trim()}」匹配的工具或应用`}</div>
            ) : null}
            {hasToolQuery && !hasAppResults && toolResults.length > 0 && !isSearchingApps ? (
              <div className="float-note-results-status">未匹配到系统应用，显示 OneMind 指令</div>
            ) : null}
          </section>
        ) : null}

        <footer className="float-note-hint-bar">{shortcutHint}</footer>
        {status ? <div className="float-note-toast">{status}</div> : null}
      </section>
    </main>
  )
}
