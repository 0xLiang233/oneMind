import { useNavigate } from "react-router-dom"

export function HomePage() {
  const navigate = useNavigate()

  return (
    <section className="page home-page">
      <div className="home-logo">
        <div className="home-logo-icon">o</div>
        <div className="home-logo-name">OneMind</div>
        <div className="home-logo-sub">一站式想法 · 你的第二大脑</div>
      </div>

      <div className="home-grid">
        <article className="home-tile" onClick={() => navigate("/capture")}>
          <div className="home-tile-title">新建随记</div>
          <div className="home-tile-desc">快速记录想法</div>
        </article>
        <article className="home-tile" onClick={() => navigate("/notes")}>
          <div className="home-tile-title">新建笔记</div>
          <div className="home-tile-desc">创建正文笔记</div>
        </article>
        <article className="home-tile secondary" onClick={() => navigate("/sources")}>
          <div className="home-tile-title">打开小程序</div>
          <div className="home-tile-desc">浏览应用工具</div>
        </article>
        <article className="home-tile" onClick={() => navigate("/capture")}>
          <div className="home-tile-title">随记时间流</div>
          <div className="home-tile-desc">查看所有随记</div>
        </article>
        <article className="home-tile" onClick={() => navigate("/search")}>
          <div className="home-tile-title">搜索笔记</div>
          <div className="home-tile-desc">全文检索内容</div>
        </article>
        <article className="home-tile" onClick={() => navigate("/settings")}>
          <div className="home-tile-title">设置</div>
          <div className="home-tile-desc">偏好与主题</div>
        </article>
      </div>
    </section>
  )
}
