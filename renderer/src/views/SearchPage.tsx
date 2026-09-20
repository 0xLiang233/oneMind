import { useEffect, useMemo, useState } from "react"
import { Link, useOutletContext, useSearchParams } from "react-router-dom"
import { FileText, Search, X } from "../icons"
import "../styles/workbench-discovery.css"

type SearchContext = { workspace: WorkspaceMeta | null }

function flattenNotes(nodes: NoteTreeNode[]): NoteTreeNode[] {
  return nodes.flatMap((node) => node.type === "directory" ? flattenNotes(node.children ?? []) : /\.(md|markdown)$/i.test(node.path) ? [node] : [])
}

function WorkspaceSearch({ workspace }: SearchContext) {
  const [params, setParams] = useSearchParams()
  const query = params.get("q") ?? ""
  const [notes, setNotes] = useState<NoteTreeNode[]>([])
  const [loading, setLoading] = useState(Boolean(workspace))
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void window.oneMind.notes.list(workspace.workspacePath).then((tree) => {
      if (cancelled) return
      setNotes(flattenNotes(tree))
      setError("")
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError("无法读取笔记目录，请重试。")
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [workspace, attempt])

  function relativePath(path: string) {
    const root = workspace?.notesPath.replace(/\\/g, "/").replace(/\/$/, "") ?? ""
    const normalized = path.replace(/\\/g, "/")
    return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
  }

  const matches = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const root = workspace?.notesPath.replace(/\\/g, "/").replace(/\/$/, "") ?? ""
    return notes.filter((note) => {
      const path = note.path.replace(/\\/g, "/")
      const searchable = `${note.name} ${path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path}`.toLocaleLowerCase()
      return terms.every((term) => searchable.includes(term))
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [notes, query, workspace?.notesPath])

  function updateQuery(value: string) {
    setParams((current) => { const next = new URLSearchParams(current); if (value) next.set("q", value); else next.delete("q"); return next }, { replace: true })
  }

  return (
    <section className="page discovery-page discovery-search" aria-labelledby="search-heading">
      <header className="discovery-header">
        <h1 id="search-heading">搜索笔记</h1>
        <p className="discovery-description">按名称或文件夹路径查找当前工作区的笔记，不搜索正文。</p>
      </header>
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="discovery-search-field">
          <Search size={18} strokeWidth={1.65} aria-hidden="true" />
          <input type="search" aria-label="搜索笔记名称或路径" placeholder="搜索笔记名称或路径…" value={query} onChange={(event) => updateQuery(event.target.value)} disabled={!workspace} />
          {query && <button type="button" className="discovery-text-control" aria-label="清空搜索" onClick={() => updateQuery("")}><X size={16} aria-hidden="true" /></button>}
        </label>
      </form>
      <section aria-label="搜索结果" aria-busy={loading}>
        <p className="discovery-caption" role="status">{loading ? "正在读取笔记目录…" : error || (!workspace ? "请先选择工作区。" : !query.trim() ? "输入名称或路径开始查找。" : `找到 ${matches.length} 篇笔记`)}</p>
        {error && <button type="button" className="discovery-control" disabled={loading} onClick={() => { setLoading(true); setAttempt((value) => value + 1) }}>重新读取</button>}
        {!loading && !error && matches.length > 0 && <ul className="discovery-result-list">
          {matches.map((note) => <li key={note.path}><Link className="discovery-recent-row" to={`/notes?selected=${encodeURIComponent(note.path)}`}>
            <FileText size={17} aria-hidden="true" /><span className="discovery-result-copy"><span className="discovery-result-title">{note.name}</span><small>{relativePath(note.path)}</small></span>
          </Link></li>)}
        </ul>}
        {!loading && !error && workspace && query.trim() && !matches.length && <p className="discovery-empty-copy">换一个关键词，或从侧栏浏览笔记。</p>}
        <div className="discovery-actions">
          <Link className="discovery-control" to="/notes">浏览笔记</Link>
          <Link className="discovery-control" to="/capture">查看随记</Link>
        </div>
      </section>
    </section>
  )
}

export function SearchPage() {
  const { workspace } = useOutletContext<SearchContext>()
  return <WorkspaceSearch key={workspace?.workspacePath ?? "no-workspace"} workspace={workspace} />
}
