import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

export function RouteErrorPage() {
  const error = useRouteError()

  let title = '程序出现异常'
  let detail = '渲染过程中发生了未处理错误。'

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`
    detail = typeof error.data === 'string' ? error.data : detail
  } else if (error instanceof Error) {
    detail = error.message
  }

  return (
    <section className="page error-page">
      <div className="hero-card">
        <div className="section-label">Error</div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </section>
  )
}
