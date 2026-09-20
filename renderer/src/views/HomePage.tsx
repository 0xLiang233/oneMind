import "../styles/workbench-discovery.css"
import { useEffect, useState } from "react"
import { Globe } from "lucide-react"
import { Link, useNavigate, useOutletContext } from "react-router-dom"
import { flushActivity, trackActivity } from "../activity"
import { Clock, FileText, Grid3X3, PenLine, Search, Settings } from "../icons"

type HomeContext = { workspace: WorkspaceMeta | null }
type RecentWork = { id: string; title: string; to: string; kind: "note" | "miniapp"; occurredAt: string }

function sourceRoute(source: MiniappSource) {
  return `/sources?${new URLSearchParams({ sourceId: source.id, title: source.name, url: source.url })}`
}

function collectNotes(nodes: NoteTreeNode[], notes = new Map<string, string>()) {
  for (const node of nodes) {
    if (node.type === "directory") collectNotes(node.children ?? [], notes)
    else if (/\.(md|markdown)$/i.test(node.path)) notes.set(node.path, node.name)
  }
  return notes
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function WorkspaceHome({ workspace }: HomeContext) {
  const navigate = useNavigate()
  const [sources, setSources] = useState<MiniappSource[]>([])
  const [recent, setRecent] = useState<RecentWork[]>([])
  const [loading, setLoading] = useState(Boolean(workspace))
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspace) return
    const workspacePath = workspace.workspacePath
    let cancelled = false
    async function load() {
      await flushActivity()
      const end = new Date()
      const start = new Date(end)
      start.setDate(start.getDate() - 29)
      const [apps, tree, activity] = await Promise.allSettled([
        window.oneMind.miniapps.list(workspacePath),
        window.oneMind.notes.list(workspacePath),
        window.oneMind.activity.report(workspacePath, localDate(start), localDate(end))
      ])
      if (cancelled) return
      const nextSources = apps.status === "fulfilled" ? apps.value : []
      const notes = collectNotes(tree.status === "fulfilled" ? tree.value : [])
      const seen = new Set<string>()
      const nextRecent: RecentWork[] = []
      if (activity.status === "fulfilled") {
        const events = [...activity.value.events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
        for (const event of events) {
          if (!event.targetId || !["open", "save", "create"].includes(event.action)) continue
          const id = `${event.module}:${event.targetId}`
          if (seen.has(id) || !Number.isFinite(Date.parse(event.occurredAt))) continue
          const source = event.module === "miniapp" ? nextSources.find((item) => item.id === event.targetId) : undefined
          const note = event.module === "notes" ? notes.get(event.targetId) : undefined
          if (!source && !note) continue
          seen.add(id)
          nextRecent.push({
            id, title: source?.name ?? note!, kind: source ? "miniapp" : "note",
            to: source ? sourceRoute(source) : `/notes?selected=${encodeURIComponent(event.targetId)}`,
            occurredAt: event.occurredAt
          })
          if (nextRecent.length === 8) break
        }
      }
      setSources(nextSources)
      setRecent(nextRecent)
      setError([apps, tree, activity].some((result) => result.status === "rejected") ? "部分工作区内容未能读取，请重试。" : "")
      setLoading(false)
    }
    void load().catch(() => {
      if (!cancelled) { setError("工作区内容未能读取，请重试。"); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [workspace, attempt])

  function openSource(source: MiniappSource) {
    trackActivity(workspace?.workspacePath, { module: "miniapp", action: "open", targetType: "miniapp", targetId: source.id, targetLabel: source.name })
    navigate(sourceRoute(source))
  }

  return (
    <section className="page discovery-page discovery-home" aria-labelledby="home-heading">
      <header className="discovery-header">
        <h1 id="home-heading">你的工作台</h1>
        <p className="discovery-description">笔记、网页和想法，在一个地方继续。</p>
      </header>
      <nav aria-label="工作台快捷入口">
        <div className="discovery-section-heading">
          <h2 className="discovery-caption">打开一个小程序</h2>
          <Link className="discovery-text-control" to="/sources">全部小程序</Link>
        </div>
        <div className="discovery-launchers">
          {sources.slice(0, 3).map((source) => (
            <button type="button" key={source.id} className="discovery-launcher" onClick={() => openSource(source)}>
              <Globe size={21} strokeWidth={1.65} aria-hidden="true" />
              <span className="discovery-launcher-copy"><strong>{source.name}</strong><span title={source.url}>{source.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span></span>
            </button>
          ))}
          <Link className="discovery-launcher" to="/capture">
            <PenLine size={21} strokeWidth={1.65} aria-hidden="true" />
            <span className="discovery-launcher-copy"><strong>随手记点什么</strong><span>记录想法，回到随记时间流</span></span>
          </Link>
          {!sources.length && <Link className="discovery-launcher" to="/sources">
            <Grid3X3 size={21} strokeWidth={1.65} aria-hidden="true" />
            <span className="discovery-launcher-copy"><strong>打开小程序</strong><span>浏览与管理常用站点</span></span>
          </Link>}
        </div>

      </nav>
      <section aria-labelledby="recent-work-heading" aria-busy={loading}>
        <div className="discovery-section-heading">
          <h2 id="recent-work-heading" className="discovery-caption">继续刚才的工作</h2>
          <span className="discovery-section-meta">近 30 天</span>
        </div>
        {error && <div className="discovery-inline-status" role="status">{error}<button type="button" className="discovery-text-control" disabled={loading} onClick={() => { setLoading(true); setAttempt((value) => value + 1) }}>重试</button></div>}
        {recent.length ? <ul className="discovery-result-list">
          {recent.map((item) => <li key={item.id}>
            <Link className="discovery-recent-row" to={item.to}>
              {item.kind === "note" ? <FileText size={17} aria-hidden="true" /> : <Globe size={17} aria-hidden="true" />}
              <span className="discovery-result-title">{item.title}</span>
              <small>{item.kind === "note" ? "笔记" : "小程序"}</small>
              <time dateTime={item.occurredAt} title={new Date(item.occurredAt).toLocaleString()}>{new Date(item.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
            </Link>
          </li>)}
        </ul> : <p className="discovery-empty-copy" role="status">{loading ? "正在读取最近的工作…" : !workspace ? "选择工作区后，可以在这里继续最近的工作。" : error ? "暂时无法显示最近的工作。" : "近 30 天还没有可继续的笔记或小程序。从上方入口开始，之后在这里继续。"}</p>}
      </section>
      <footer className="discovery-home-footer">
        <div className="discovery-shortcuts">
          <Link className="discovery-text-control" to="/notes"><FileText size={14} aria-hidden="true" />打开笔记</Link>
          <Link className="discovery-text-control" to="/capture"><Clock size={14} aria-hidden="true" />随记时间流</Link>
          <Link className="discovery-text-control" to="/search"><Search size={14} aria-hidden="true" />搜索笔记</Link>
          <Link className="discovery-text-control" to="/settings"><Settings size={14} aria-hidden="true" />设置</Link>
        </div>
        <p className="discovery-footnote">侧栏是资源入口，顶部是正在进行的任务。再次打开同一份笔记或小程序，会回到已有标签。</p>
      </footer>
    </section>
  )
}

export function HomePage() {
  const { workspace } = useOutletContext<HomeContext>()
  return <WorkspaceHome key={workspace?.workspacePath ?? "no-workspace"} workspace={workspace} />
}
