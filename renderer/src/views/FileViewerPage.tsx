import { useEffect, useMemo, useReducer, useRef } from "react"
import { useSearchParams } from "react-router-dom"

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

  function resetView() {
    dispatch({ type: "reset-view" })
  }

  useEffect(() => {
    let cancelled = false
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
  }, [filePath, kind, workspacePath])

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
    <section className="page file-viewer-page">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-title">{getFileName(filePath) || "文件预览"}</div>
        <div className="file-viewer-actions">
          <button type="button" className="file-viewer-tool" onClick={resetView} disabled={!dataUrl}>
            适应
          </button>
          <div className="file-viewer-meta">{kind === "image" ? `${Math.round(zoom * 100)}%` : "文件"}</div>
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
        onDoubleClick={resetView}
      >
        {dataUrl ? (
          <img
            className="file-viewer-image"
            src={dataUrl}
            alt={getFileName(filePath)}
            draggable={false}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
            }}
          />
        ) : (
          <div className="notes-empty">{status}</div>
        )}
      </div>
    </section>
  )
}
