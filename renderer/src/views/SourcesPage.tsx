import "../styles/workbench-sources.css"
import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useOutletContext } from "react-router-dom"
import { trackActivity } from "../activity"
import { useNativeMiniappView } from "../miniapps/useNativeMiniappView"
import { nativeViewQueue } from "../miniapps/nativeViewQueue"
import { ChevronLeft, Grid3X3, MoveRight, RefreshCw } from "../icons"

type OutletContext = { workspace: WorkspaceMeta | null }

function isWebUrl(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol) } catch { return false }
}

function getSourceDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

export function SourcesPage() {
  const { workspace } = useOutletContext<OutletContext>()
  const location = useLocation()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<{ workspacePath: string; items: MiniappSource[]; error: string } | null>(null)
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({})
  const [actionError, setActionError] = useState("")
  const [reloadPending, setReloadPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const webviewHostRef = useRef<HTMLDivElement | null>(null)

  const params = new URLSearchParams(location.search)
  const activeUrl = params.get("url")
  const activeTitle = params.get("title") ?? "小程序"
  const activeSourceId = params.get("sourceId") ?? activeTitle
  const nativeKey = `${activeSourceId}:${activeUrl}:${attempt}`
  const validUrl = activeUrl ? isWebUrl(activeUrl) : false
  const currentNative = useNativeMiniappView({
    viewKey: activeSourceId, url: activeUrl, validUrl, nativeKey, hostRef: webviewHostRef
  })
  const currentCatalog = catalog?.workspacePath === workspace?.workspacePath ? catalog : null
  const items = currentCatalog?.items ?? []
  const catalogLoading = Boolean(workspace && !currentCatalog)
  const nativeMessage = !validUrl ? "此地址无法作为网页打开。" : currentNative?.message ?? "正在连接内置浏览视图…"

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void window.oneMind.miniapps.list(workspace.workspacePath).then((next) => {
      if (!cancelled) setCatalog({ workspacePath: workspace.workspacePath, items: next, error: "" })
    }).catch(() => {
      if (!cancelled) setCatalog({ workspacePath: workspace.workspacePath, items: [], error: "小程序目录未能读取，请重试。" })
    })
    return () => { cancelled = true }
  }, [workspace, attempt])

  function openSource(source: MiniappSource) {
    setActionError("")
    navigate(`/sources?${new URLSearchParams({ sourceId: source.id, title: source.name, url: source.url })}`)
    trackActivity(workspace?.workspacePath, { module: "miniapp", action: "open", targetType: "miniapp", targetId: source.id, targetLabel: source.name })
  }

  async function reloadSource() {
    if (!activeUrl || !validUrl) return
    setActionError("")
    if (currentNative?.state !== "ready") { setAttempt((value) => value + 1); return }
    setReloadPending(true)
    try {
      const reloaded = await nativeViewQueue.run(() => window.oneMind.miniappView.reload({ viewKey: activeSourceId, url: activeUrl }))
      if (!reloaded) setActionError("当前环境无法刷新此网页。")
    } catch { setActionError("刷新失败，请重试。") }
    finally { setReloadPending(false) }
  }

  async function openExternal() {
    if (!activeUrl || !validUrl) return
    setActionError("")
    try {
      if (!await window.oneMind.window.openExternal(activeUrl)) setActionError("未能打开系统浏览器。")
    } catch { setActionError("未能打开系统浏览器，请稍后重试。") }
  }

  return (
    <section className="page sources-page workbench-sources" aria-label={activeUrl ? activeTitle : "小程序"}>
      {!activeUrl ? (
        <div className="miniapp-launcher">
          <header className="sources-module-header">
            <div><h1>小程序</h1><p>常用站点，集中访问。</p></div>
            <button type="button" className="sources-control" onClick={() => navigate("/settings?group=miniapps")}>管理小程序</button>
          </header>
          <div className="miniapp-grid" aria-label="小程序目录" aria-busy={catalogLoading}>
            {items.map((item) => (
              <button key={item.id} type="button" className="miniapp-app-tile" title={`${item.name} · ${getSourceDomain(item.url)}`} onClick={() => openSource(item)}>
                <span className="miniapp-app-icon">{item.icon && !failedIcons[item.id] ? <img src={item.icon} alt="" draggable={false} onError={() => setFailedIcons((current) => ({ ...current, [item.id]: true }))} /> : <span>{item.name.slice(0, 1).toUpperCase()}</span>}</span>
                <span className="miniapp-app-meta"><span className="miniapp-app-name">{item.name}</span><span className="miniapp-app-domain">{getSourceDomain(item.url)}</span></span>
              </button>
            ))}
          </div>
          {!items.length && <div className="sources-state" role="status">
            <Grid3X3 size={24} strokeWidth={1.5} aria-hidden="true" />
            <h2>{catalogLoading ? "正在读取小程序…" : currentCatalog?.error ? "暂时无法读取目录" : !workspace ? "还没有打开工作区" : "还没有添加小程序"}</h2>
            <p>{currentCatalog?.error || (!workspace ? "选择工作区后，即可访问保存的常用站点。" : "在管理小程序中添加常用站点，之后从这里打开。")}</p>
            {currentCatalog?.error && <button type="button" className="sources-control" onClick={() => { setCatalog(null); setAttempt((value) => value + 1) }}>重新读取</button>}
          </div>}
        </div>
      ) : (
        <>
          <div className="sources-browser-toolbar" role="group" aria-label="网页工具">
            <button type="button" className="sources-icon-control" title="返回小程序目录" aria-label="返回小程序目录" onClick={() => navigate("/sources")}><ChevronLeft size={17} aria-hidden="true" /></button>
            <button type="button" className="sources-icon-control" title="重新载入网页" aria-label="重新载入网页" disabled={!validUrl || reloadPending} onClick={() => void reloadSource()}><RefreshCw size={16} aria-hidden="true" /></button>
            <input className="sources-address" aria-label="小程序入口地址（网页内导航不会同步此地址）" title={activeUrl} value={activeUrl} readOnly />
            <button type="button" className="sources-icon-control" title="在系统浏览器打开入口地址" aria-label="在系统浏览器打开入口地址" disabled={!validUrl} onClick={() => void openExternal()}><MoveRight size={17} aria-hidden="true" /></button>
          </div>
          {actionError && <p className="sources-toolbar-status" role="status">{actionError}</p>}
          <div className="webview-scene" ref={webviewHostRef} aria-label={activeTitle}>
            <div className="source-native-view-placeholder">
              <div className="sources-state" role="status" aria-live="polite">
                <Grid3X3 size={24} strokeWidth={1.5} aria-hidden="true" />
                <h1>{activeTitle}</h1><p>{nativeMessage}</p>
                {validUrl && currentNative && currentNative.state !== "ready" && <div className="sources-state-actions">
                  <button type="button" className="sources-control" onClick={() => void reloadSource()}>重试</button>
                  <button type="button" className="sources-control" onClick={() => void openExternal()}>在浏览器中打开</button>
                </div>}
                {!validUrl && <button type="button" className="sources-control" onClick={() => navigate("/settings?group=miniapps")}>管理小程序</button>}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
