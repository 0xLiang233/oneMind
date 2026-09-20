import "../styles/workbench-discovery.css"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"

type ViewerKind = "image" | "unsupported"

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])

function getFileName(filePath: string) {
  return filePath.split(/[/\\]/).pop() || filePath
}

function getExtension(filePath: string) {
  const name = getFileName(filePath)
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index).toLowerCase() : ""
}

function inferViewerKind(filePath: string): ViewerKind {
  return imageExtensions.has(getExtension(filePath)) ? "image" : "unsupported"
}

type ViewerState = {
  dataUrl: string
  status: string
  zoom: number
  pan: { x: number; y: number }
}

type ViewerAction =
  | { type: "reset"; status: string }
  | { type: "loaded"; dataUrl: string }
  | { type: "status"; status: string }
  | { type: "reset-view" }
  | { type: "zoom"; zoom: number; pan: { x: number; y: number } }
  | { type: "pan"; pan: { x: number; y: number } }

const initialViewerState: ViewerState = {
  dataUrl: "",
  status: "正在加载...",
  zoom: 1,
  pan: { x: 0, y: 0 }
}

function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "reset":
      return {
        dataUrl: "",
        status: action.status,
        zoom: 1,
        pan: { x: 0, y: 0 }
      }
    case "loaded":
      return {
        ...state,
        dataUrl: action.dataUrl,
        status: ""
      }
    case "status":
      return {
        ...state,
        status: action.status
      }
    case "reset-view":
      return {
        ...state,
        zoom: 1,
        pan: { x: 0, y: 0 }
      }
    case "zoom":
      return {
        ...state,
        zoom: action.zoom,
        pan: action.pan
      }
    case "pan":
      return {
        ...state,
        pan: action.pan
      }
  }
}

export function FileViewerPage() {
  const [params] = useSearchParams()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null)
  const filePath = params.get("path") ?? ""
  const workspacePath = params.get("workspace") ?? undefined
  const kind = useMemo(() => inferViewerKind(filePath), [filePath])
  const [{ dataUrl, status, zoom, pan }, dispatch] = useReducer(viewerReducer, initialViewerState)

  const [attempt, setAttempt] = useState(0)
  const [actionStatus, setActionStatus] = useState("")

  function resetView() {
    dispatch({ type: "reset-view" })
  }

  useEffect(() => {
    let cancelled = false
    dragRef.current = null
    if (!filePath) {
      dispatch({ type: "reset", status: "未选择文件" })
      return
    }
    if (kind !== "image") {
      dispatch({ type: "reset", status: "暂不支持预览此文件类型" })
      return
    }

    dispatch({ type: "reset", status: "正在加载..." })
    void window.oneMind.files.readDataUrl(filePath, workspacePath)
      .then((nextDataUrl) => {
        if (cancelled) return
        dispatch({ type: "loaded", dataUrl: nextDataUrl })
      })
      .catch((error) => {
        if (cancelled) return
        dispatch({ type: "status", status: "无法加载图片: " + String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [filePath, kind, workspacePath, attempt])

  async function openFile() {
    setActionStatus("")
    try {
      if (!await window.oneMind.notes.openFile(filePath, workspacePath)) setActionStatus("当前环境无法打开此文件。")
    } catch { setActionStatus("无法打开文件，请确认文件仍然存在。") }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!dataUrl) return
    event.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const rect = stage.getBoundingClientRect()
    const pointX = event.clientX - rect.left - rect.width / 2
    const pointY = event.clientY - rect.top - rect.height / 2
    const factor = event.deltaY < 0 ? 1.12 : 0.88
    const nextZoom = Math.min(6, Math.max(0.25, zoom * factor))
    const ratio = nextZoom / zoom

    dispatch({
      type: "zoom",
      zoom: nextZoom,
      pan: {
        x: pointX - (pointX - pan.x) * ratio,
        y: pointY - (pointY - pan.y) * ratio
      }
    })
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!dataUrl || zoom <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dispatch({
      type: "pan",
      pan: {
        x: drag.panX + event.clientX - drag.startX,
        y: drag.panY + event.clientY - drag.startY
      }
    })
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null
    }
  }

  return (
    <section className="page file-viewer-page discovery-viewer" aria-labelledby="file-viewer-heading">
      <div className="file-viewer-toolbar">
        <div className="discovery-viewer-heading">
          <h1 id="file-viewer-heading" className="file-viewer-title" title={filePath}>{getFileName(filePath) || "文件预览"}</h1>
          <p className="discovery-viewer-hint">{dataUrl ? "滚轮缩放 · 放大后拖动 · 双击适应窗口" : "本地文件预览"}</p>
        </div>
        <div className="file-viewer-actions" role="group" aria-label="图片缩放">
          <button type="button" className="file-viewer-tool" aria-label="缩小图片" disabled={!dataUrl || zoom <= 0.25}
            onClick={() => dispatch({ type: "zoom", zoom: Math.max(0.25, zoom / 1.2), pan: { x: 0, y: 0 } })}>−</button>
          <button type="button" className="file-viewer-tool" aria-label="放大图片" disabled={!dataUrl || zoom >= 6}
            onClick={() => dispatch({ type: "zoom", zoom: Math.min(6, zoom * 1.2), pan: { x: 0, y: 0 } })}>+</button>
          <button type="button" className="file-viewer-tool" onClick={resetView} disabled={!dataUrl}>
            适应
          </button>
          <div className="file-viewer-meta" aria-live="polite">{dataUrl ? `${Math.round(zoom * 100)}%` : "—"}</div>
        </div>
      </div>
      <div
        ref={stageRef}
        className={"file-viewer-stage" + (dataUrl ? " loaded" : "") + (zoom > 1 ? " pannable" : "")}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={resetView}
      >
        {dataUrl ? (
          <img
            className="file-viewer-image"
            src={dataUrl}
            alt={getFileName(filePath)}
            onError={() => dispatch({ type: "reset", status: "无法显示图片，请检查文件是否损坏或格式是否受支持。" })}
            draggable={false}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
            }}
          />
        ) : (
          <div className="discovery-state" role="status" aria-live="polite">
            <h2>{status}</h2>
            <p>{status === "正在加载..."
              ? "正在读取图片，请稍候。"
              : !filePath
                ? "从侧栏选择一个文件开始预览。"
                : kind !== "image"
                  ? "此处支持图片预览。其他类型的文件请使用对应应用打开。"
                  : "请确认文件仍在工作区中，然后重新打开。"}</p>
            {status !== "正在加载..." && <div className="discovery-actions">
              {filePath && kind === "image" && <button type="button" className="file-viewer-tool" onClick={() => { setActionStatus(""); setAttempt((value) => value + 1) }}>重新读取</button>}
              {filePath && <button type="button" className="file-viewer-tool" onClick={() => void openFile()}>用默认应用打开</button>}
              <Link className="file-viewer-tool" to="/notes">浏览笔记</Link>
            </div>}
            {actionStatus && <p>{actionStatus}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
