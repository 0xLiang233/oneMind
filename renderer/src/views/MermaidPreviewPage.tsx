import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { Maximize2, Minus, Plus, X } from "../icons"
import { closeMermaidPreview, readMermaidPreview, setMermaidFullscreen } from "../platform/mermaidPreview"
import "../styles/mermaid-preview.css"

export function MermaidPreviewPage() {
  const viewport = useRef<HTMLDivElement>(null)
  const diagram = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const anchor = useRef<{ x: number; y: number; diagramX: number; diagramY: number } | null>(null)
  const [svg, setSvg] = useState("")
  const [error, setError] = useState("")
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [bounds, setBounds] = useState({ width: 1, height: 1 })
  const [manualScale, setManualScale] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState("__TAURI_INTERNALS__" in window)
  const fitScale = Math.min(bounds.width / size.width, bounds.height / size.height, 1)
  const scale = manualScale ?? fitScale
  const minScale = Math.min(0.1, fitScale)

  useEffect(() => {
    let disposed = false
    void readMermaidPreview().then(async ({ source, theme }) => {
      document.documentElement.dataset.theme = theme
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default", flowchart: { htmlLabels: false } })
      const result = await mermaid.render(`mermaid-window-${crypto.randomUUID()}`, source)
      if (!disposed) setSvg(result.svg)
    }).catch((reason: unknown) => { if (!disposed) setError(`无法加载图表：${String(reason)}`) })
    return () => { disposed = true }
  }, [])

  useLayoutEffect(() => {
    const element = diagram.current?.querySelector("svg")
    const box = element?.viewBox.baseVal
    if (box?.width && box.height) setSize({ width: box.width, height: box.height })
  }, [svg])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const update = () => setBounds({ width: Math.max(1, element.clientWidth - 48), height: Math.max(1, element.clientHeight - 48) })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [])

  const zoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const element = viewport.current
    const drawing = diagram.current
    if (!element || !drawing) return
    const rect = element.getBoundingClientRect()
    const diagramRect = drawing.getBoundingClientRect()
    const x = point?.x ?? rect.left + element.clientWidth / 2
    const y = point?.y ?? rect.top + element.clientHeight / 2
    anchor.current = { x: x - rect.left, y: y - rect.top, diagramX: (x - diagramRect.left) / scale, diagramY: (y - diagramRect.top) / scale }
    setManualScale(Math.max(minScale, Math.min(8, next)))
  }, [minScale, scale])

  useLayoutEffect(() => {
    const element = viewport.current
    const drawing = diagram.current
    if (!element || !drawing) return
    if (anchor.current) {
      const point = anchor.current
      const rect = element.getBoundingClientRect()
      const diagramRect = drawing.getBoundingClientRect()
      element.scrollLeft += diagramRect.left - rect.left + point.diagramX * scale - point.x
      element.scrollTop += diagramRect.top - rect.top + point.diagramY * scale - point.y
      anchor.current = null
    } else if (manualScale === null) {
      element.scrollTo(0, 0)
    }
  }, [scale, manualScale, bounds])

  const fit = useCallback(() => {
    anchor.current = null
    setManualScale(null)
    viewport.current?.scrollTo(0, 0)
  }, [])

  const changeFullscreen = useCallback(async (next: boolean) => {
    try { await setMermaidFullscreen(next); setFullscreen(next) }
    catch (reason) { setError(`全屏切换失败：${String(reason)}`) }
  }, [])
  const close = useCallback(() => {
    void closeMermaidPreview().catch((reason: unknown) => setError(`关闭失败：${String(reason)}`))
  }, [])

  useEffect(() => {
    const element = viewport.current
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom(scale * Math.exp(-event.deltaY * 0.002), { x: event.clientX, y: event.clientY })
    }
    element?.addEventListener("wheel", wheel, { passive: false })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (fullscreen) void changeFullscreen(false); else close() }
      if (event.key === "F11") { event.preventDefault(); void changeFullscreen(!fullscreen) }
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault()
        if (event.key === "0") fit()
        else zoom(scale * (event.key === "-" ? 1 / 1.2 : 1.2))
      }
    }
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener("keydown", keydown)
    document.addEventListener("fullscreenchange", syncFullscreen)
    return () => {
      element?.removeEventListener("wheel", wheel)
      document.removeEventListener("keydown", keydown)
      document.removeEventListener("fullscreenchange", syncFullscreen)
    }
  }, [zoom, scale, fullscreen, changeFullscreen, close, fit])

  return (
    <main className="mermaid-preview-page">
      <header className="mermaid-preview-header">
        <div className="mermaid-preview-heading"><strong>Mermaid 图表</strong><span>独立预览 · 只读快照</span></div>
        <div className="mermaid-preview-controls" aria-label="图表预览工具">
          <button disabled={!svg || scale <= minScale} onClick={() => zoom(scale / 1.2)} title="缩小（−）" aria-label="缩小"><Minus /></button>
          <output aria-label="缩放比例">{Math.round(scale * 100)}%</output>
          <button disabled={!svg || scale >= 8} onClick={() => zoom(scale * 1.2)} title="放大（+）" aria-label="放大"><Plus /></button>
          <button disabled={!svg} onClick={fit} aria-pressed={manualScale === null} title="适应窗口（0 / 双击）">适应窗口</button>
          <button disabled={!svg} onClick={() => zoom(1)}>100%</button>
          <span className="mermaid-preview-separator" />
          <button onClick={() => void changeFullscreen(!fullscreen)} title="切换全屏（F11）"><Maximize2 />{fullscreen ? "退出全屏" : "全屏"}</button>
          <button onClick={close} title="关闭预览" aria-label="关闭预览"><X /></button>
        </div>
      </header>
      {error && <div className="mermaid-preview-error" role="alert">{error}</div>}
      <div ref={viewport} className="mermaid-preview-viewport" role="region" aria-label="Mermaid 图表，滚轮缩放，拖拽移动，双击适应窗口" tabIndex={0}
        onDoubleClick={fit}
        onClick={(event) => { if ((event.target as Element).closest("a")) event.preventDefault() }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !svg) return
          event.preventDefault()
          event.currentTarget.focus()
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.dataset.dragging = "true"
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.id !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left - event.clientX + start.x
          event.currentTarget.scrollTop = start.top - event.clientY + start.y
        }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onLostPointerCapture={(event) => { drag.current = null; event.currentTarget.dataset.dragging = "false" }}
      >
        {!svg && !error && <div className="mermaid-preview-loading" role="status">图表渲染中…</div>}
        <div className="mermaid-preview-canvas" style={{ width: Math.max(bounds.width, size.width * scale), height: Math.max(bounds.height, size.height * scale) }}>
          <div ref={diagram} className="mermaid-preview-diagram" style={{ width: size.width * scale, height: size.height * scale }} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
      <footer className="mermaid-preview-footer"><span>滚轮缩放 · 拖拽移动 · 双击适应窗口</span><span>{fullscreen ? "Esc 退出全屏" : "Esc 关闭预览"}</span></footer>
    </main>
  )
}
