import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { trackActivity } from '../activity'

type OutletContext = {
  workspace: WorkspaceMeta | null
  defaultPath?: string
  busy?: boolean
  bridgeReady?: boolean
  handleCreateDefault?: () => Promise<void>
  handleSelectWorkspace?: () => Promise<void>
}

function writeMiniappLog(message: string, context?: string) {
  void window.oneMind?.diagnostics?.writeLog("renderer-debug", message, context).catch((error: unknown) => {
    console.warn("Failed to write miniapp log:", error)
  })
}

export function SourcesPage() {
  const { workspace } = useOutletContext<OutletContext>()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<MiniappSource[]>([])
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState('请先选择或创建 workspace。')
  const webviewHostRef = useRef<HTMLDivElement | null>(null)

  const params = new URLSearchParams(location.search)
  const activeUrl = params.get('url')
  const activeTitle = params.get('title') ?? '小程序'
  const activeSourceId = params.get('sourceId') ?? activeTitle

  useEffect(() => {
    async function loadMiniapps() {
      if (!workspace) {
        setItems([])
        setStatus('请先选择或创建 workspace。')
        return
      }

      const next = await window.oneMind.miniapps.list(workspace.workspacePath)
      setItems(next)
      setStatus(next.length > 0 ? '小程序目录已加载。' : '先添加一个常用 AI 站点。')
    }

    void loadMiniapps()
  }, [workspace])

  useEffect(() => {
    if (!activeUrl) {
      writeMiniappLog("miniapp_renderer_hide_no_active_url", `pathname=${location.pathname}`)
      void window.oneMind.miniappView.hide().catch((error: unknown) => {
        writeMiniappLog("miniapp_renderer_hide_no_active_url_failed", String(error))
      })
      return
    }

    const host = webviewHostRef.current
    if (!host) {
      writeMiniappLog("miniapp_renderer_host_missing", `sourceId=${activeSourceId} url=${activeUrl}`)
      return
    }

    const viewKey = activeSourceId
    const partition = `persist:onemind-miniapp-${activeSourceId}`
    let frame = 0
    let hasShownView = false
    let lastX = 0
    let lastY = 0
    let lastWidth = 0
    let lastHeight = 0

    const syncNativeView = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect()
        const x = Math.round(rect.left)
        const y = Math.round(rect.top)
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)

        if (x === lastX && y === lastY && width === lastWidth && height === lastHeight) return
        if (width <= 0 || height <= 0) {
          writeMiniappLog(
            "miniapp_renderer_skip_invalid_bounds",
            `viewKey=${viewKey} x=${x} y=${y} width=${width} height=${height}`
          )
          return
        }
        lastX = x
        lastY = y
        lastWidth = width
        lastHeight = height

        const bounds = { x, y, width, height }
        if (!hasShownView) {
          hasShownView = true
          writeMiniappLog(
            "miniapp_renderer_show",
            `viewKey=${viewKey} x=${x} y=${y} width=${width} height=${height} url=${activeUrl}`
          )
          void window.oneMind.miniappView.show({
            viewKey,
            url: activeUrl,
            partition,
            bounds
          }).catch((error: unknown) => {
            writeMiniappLog("miniapp_renderer_show_failed", `viewKey=${viewKey} error=${String(error)}`)
          })
          return
        }

        writeMiniappLog(
          "miniapp_renderer_set_bounds",
          `viewKey=${viewKey} x=${x} y=${y} width=${width} height=${height}`
        )
        void window.oneMind.miniappView.setBounds({ viewKey, bounds }).catch((error: unknown) => {
          writeMiniappLog("miniapp_renderer_set_bounds_failed", `viewKey=${viewKey} error=${String(error)}`)
        })
      })
    }

    const observer = new ResizeObserver(syncNativeView)
    observer.observe(host)
    window.addEventListener('resize', syncNativeView)
    syncNativeView()

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', syncNativeView)
      writeMiniappLog("miniapp_renderer_cleanup_hide", `viewKey=${viewKey}`)
      void window.oneMind.miniappView.hide().catch((error: unknown) => {
        writeMiniappLog("miniapp_renderer_cleanup_hide_failed", `viewKey=${viewKey} error=${String(error)}`)
      })
    }
  }, [activeSourceId, activeUrl, location.pathname])

  function openSource(source: MiniappSource | { id: string; name: string; url: string }) {
    const nextParams = new URLSearchParams({
      sourceId: source.id,
      title: source.name,
      url: source.url
    })
    navigate(`/sources?${nextParams.toString()}`)
    trackActivity(workspace?.workspacePath, {
      module: "miniapp",
      action: "open",
      targetType: "miniapp",
      targetId: source.id,
      targetLabel: source.name
    })
  }

  function getSourceDomain(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url.replace(/^https?:\/\//, '').split('/')[0]
    }
  }

  function renderMiniappIcon(item: MiniappSource) {
    if (item.icon && !failedIcons[item.id]) {
      return (
        <img
          src={item.icon}
          alt=""
          draggable={false}
          onError={() => setFailedIcons((current) => ({ ...current, [item.id]: true }))}
        />
      )
    }

    return <span>{item.name.slice(0, 1).toUpperCase()}</span>
  }

  return (
    <section className="page sources-page">
      {!activeUrl ? (
        <div className="miniapp-launcher">
          <div className="miniapp-grid">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="miniapp-app-tile"
                onClick={() => openSource(item)}
              >
                <div className="miniapp-app-icon">{renderMiniappIcon(item)}</div>
                <div className="miniapp-app-meta">
                  <div className="miniapp-app-name">{item.name}</div>
                  <div className="miniapp-app-domain">{getSourceDomain(item.url)}</div>
                </div>
              </button>
            ))}
          </div>
          {items.length === 0 ? <div className="miniapp-footer-note">{status}</div> : null}
        </div>
      ) : (
        <div className="webview-scene" ref={webviewHostRef} aria-label={activeTitle}>
          <div className="source-native-view-placeholder" />
        </div>
      )}
    </section>
  )
}
