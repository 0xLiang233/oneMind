type PreviewDocument = { source: string; theme: "light" | "dark" }

function currentTheme(): PreviewDocument["theme"] {
  const theme = document.documentElement.dataset.theme
  return theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"
}

export async function openMermaidPreview(source: string) {
  const theme = currentTheme()
  if (window.oneMind.mermaidPreview) return window.oneMind.mermaidPreview.open(source, theme)
  // Portable fallback: source is handed over in memory, never embedded in a URL
  // or persisted alongside the user's workspace data.
  const child = window.open(`${location.pathname}${location.search}#/mermaid-preview`, "_blank", "popup,width=1200,height=800")
  if (!child) throw new Error("当前桌面外壳不支持独立窗口，或预览窗口被拦截。")
  const send = (event: MessageEvent) => {
    if (event.source !== child || event.origin !== location.origin || event.data !== "mermaid-preview-ready") return
    child.postMessage({ type: "mermaid-preview-document", source, theme }, location.origin)
    window.removeEventListener("message", send)
    window.clearTimeout(timeout)
  }
  window.addEventListener("message", send)
  const timeout = window.setTimeout(() => window.removeEventListener("message", send), 30000)
}

let pendingDocument: Promise<PreviewDocument> | undefined
export function readMermaidPreview(): Promise<PreviewDocument> {
  // StrictMode may mount twice; both passes consume the same handoff.
  return pendingDocument ??= new Promise((resolve, reject) => {
    if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
      const read = () => {
        window.removeEventListener("oneMindBridgeReady", read)
        if (window.oneMind.mermaidPreview) window.oneMind.mermaidPreview.read().then(resolve, reject)
        else reject(new Error("图表预览桥接尚未就绪"))
      }
      if (window.oneMind.mermaidPreview) read()
      else window.addEventListener("oneMindBridgeReady", read, { once: true })
      return
    }
    if (!window.opener) { reject(new Error("请从正文图表的“独立预览”按钮打开此窗口。")); return }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.opener || event.origin !== location.origin) return
      const data = event.data
      if (data?.type !== "mermaid-preview-document" || typeof data.source !== "string") return
      window.removeEventListener("message", receive)
      window.clearTimeout(timeout)
      resolve({ source: data.source, theme: data.theme === "dark" ? "dark" : "light" })
      window.opener = null
    }
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive)
      reject(new Error("图表加载超时，请关闭窗口后重试。"))
    }, 15000)
    window.addEventListener("message", receive)
    window.opener.postMessage("mermaid-preview-ready", location.origin)
  })
}

export async function setMermaidFullscreen(fullscreen: boolean) {
  if (window.oneMind.mermaidPreview) return window.oneMind.mermaidPreview.setFullscreen(fullscreen)
  if (fullscreen) await document.documentElement.requestFullscreen()
  else if (document.fullscreenElement) await document.exitFullscreen()
}

export async function closeMermaidPreview() {
  if (window.oneMind.mermaidPreview) return window.oneMind.mermaidPreview.close()
  window.close()
}
