import "../styles/workbench-discovery.css"
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

export function RouteErrorPage() {
  const error = useRouteError()

  let title = '程序出现异常'
  let detail = '渲染过程中发生了未处理错误。'

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`
    if (error.status === 404) title = '找不到这个页面'
    detail = typeof error.data === 'string' ? error.data : error.status === 404 ? '页面地址可能已经变更，请从首页或侧栏重新打开。' : detail
  } else if (error instanceof Error) {
    detail = error.message
  }

  return (
    <section className="page discovery-page discovery-error" aria-labelledby="route-error-heading">
      <div className="discovery-state" role="alert">
        <p className="discovery-eyebrow">页面暂时无法显示</p>
        <h1 id="route-error-heading">{title}</h1>
        <p className="discovery-error-detail">{detail}</p>
        <p>可以返回首页，或重新加载页面。重新加载可能丢失未保存的内容。</p>
        <div className="discovery-actions">
          <Link className="discovery-control" to="/home">返回首页</Link>
          <button className="discovery-control" type="button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    </section>
  )
}
