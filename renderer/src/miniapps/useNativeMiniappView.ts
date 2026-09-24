import { useEffect, useState, type RefObject } from "react"
import { nativeViewQueue } from "./nativeViewQueue"

type NativeStatus = { key: string; state: "ready" | "unavailable" | "error"; message: string }
let nativeViewGeneration = 0

function writeMiniappLog(message: string, context?: string) {
  void window.oneMind?.diagnostics?.writeLog("renderer-debug", message, context).catch((error: unknown) => {
    console.warn("Failed to write miniapp log:", error)
  })
}

function queueNativeViewOperation(operation: () => Promise<void>, onFailure?: () => void) {
  void nativeViewQueue.run(operation).catch((error: unknown) => {
    writeMiniappLog("miniapp_renderer_operation_failed", String(error))
    onFailure?.()
  })
}

type Options = {
  viewKey: string
  url: string | null
  validUrl: boolean
  nativeKey: string
  hostRef: RefObject<HTMLDivElement | null>
}

export function useNativeMiniappView({ viewKey, url, validUrl, nativeKey, hostRef }: Options) {
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  useEffect(() => {
    const generation = ++nativeViewGeneration
    let disposed = false
    const isCurrent = () => !disposed && generation === nativeViewGeneration

    if (!url || !validUrl) {
      queueNativeViewOperation(async () => {
        if (!isCurrent()) return
        writeMiniappLog("miniapp_renderer_hide_no_active_url", "reason=no-active-url")
        await window.oneMind.miniappView.hide()
      })
      return () => { disposed = true }
    }

    const host = hostRef.current
    if (!host) {
      writeMiniappLog("miniapp_renderer_host_missing", `sourceId=${viewKey} url=${url}`)
      return () => { disposed = true }
    }

    const partition = `persist:onemind-miniapp-${viewKey}`
    const hasOverlay = () => Boolean(document.body.querySelector(".workbench-context-menu, .convert-overlay"))
    let overlayOpen = hasOverlay()
    let frame = 0
    let syncQueued = false
    let attemptedShow = false
    let hasShownView = false
    let visible = false
    let lastBounds: ViewBounds | null = null
    let processFailed = false
    const unsubscribe = window.oneMind.miniappView.onFailed?.((failure) => {
      if (!isCurrent() || failure.viewKey !== viewKey) return
      processFailed = true
      visible = false
      hasShownView = false
      setNativeStatus({ key: nativeKey, state: "error", message: failure.reason === "unresponsive"
        ? "网页暂时无响应，其他功能仍可使用。重试会重新载入此网页，未提交的内容可能丢失。"
        : "网页进程已退出，其他功能仍可使用。可以重试以重新载入此网页。" })
    })

    async function hideForOverlay() {
      writeMiniappLog("miniapp_renderer_hide_for_overlay", `viewKey=${viewKey}`)
      if (await window.oneMind.miniappView.hide()) visible = false
    }

    const reconcileNativeView = () => {
      if (!isCurrent() || syncQueued || processFailed) return
      syncQueued = true
      queueNativeViewOperation(async () => {
        syncQueued = false
        if (!isCurrent() || processFailed) return
        try {
          // Check live DOM at execution, not at enqueue: a popup can close or
          // another popup can open while a previous bridge request is pending.
          if (hasOverlay()) {
            if (visible) await hideForOverlay()
            return
          }
          if (attemptedShow && !hasShownView) return
          const rect = host.getBoundingClientRect()
          const bounds = { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
          if (bounds.width <= 0 || bounds.height <= 0) return
          if (!visible) {
            attemptedShow = true
            writeMiniappLog("miniapp_renderer_show", `viewKey=${viewKey} bounds=${JSON.stringify(bounds)} restore=${hasShownView}`)
            // Both shells reuse the same viewKey without navigating. Never use
            // reload/close for popup dismissal; preserve remote history/forms.
            const shown = await window.oneMind.miniappView.show({ viewKey, url, partition, bounds })
            hasShownView = shown
            visible = shown
            lastBounds = bounds
            if (!isCurrent() || processFailed) return // The queued cleanup owns this stale view.
            setNativeStatus({ key: nativeKey, state: shown ? "ready" : "unavailable", message: shown ? "内置浏览视图已连接" : "当前环境无法打开内置浏览视图。" })
            // An overlay may have appeared during the asynchronous initial show.
            if (shown && hasOverlay()) await hideForOverlay()
            return
          }
          if (lastBounds && bounds.x === lastBounds.x && bounds.y === lastBounds.y && bounds.width === lastBounds.width && bounds.height === lastBounds.height) return
          writeMiniappLog("miniapp_renderer_set_bounds", `viewKey=${viewKey} bounds=${JSON.stringify(bounds)}`)
          await window.oneMind.miniappView.setBounds({ viewKey, bounds })
          lastBounds = bounds
        } catch (error: unknown) {
          writeMiniappLog("miniapp_renderer_sync_failed", `viewKey=${viewKey} error=${String(error)}`)
          if (isCurrent()) setNativeStatus({ key: nativeKey, state: "error", message: "内置浏览视图未能更新，请重试。" })
        }
      }, () => {
        if (isCurrent()) setNativeStatus({ key: nativeKey, state: "error",
          message: "内置网页操作超时，其他功能仍可使用；可以稍后重试。" })
      })
    }

    const syncNativeView = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(reconcileNativeView)
    }
    const observer = new ResizeObserver(syncNativeView)
    observer.observe(host)
    const overlayObserver = new MutationObserver(() => {
      const next = hasOverlay()
      if (next === overlayOpen) return
      overlayOpen = next
      // Hide promptly on menu insertion, without waiting for the next frame.
      reconcileNativeView()
    })
    overlayObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] })
    window.addEventListener("resize", syncNativeView)
    syncNativeView()

    return () => {
      disposed = true
      unsubscribe?.()
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      overlayObserver.disconnect()
      window.removeEventListener("resize", syncNativeView)
      // Do not close for overlays. Only route/key changes release the native
      // view, after any in-flight show/hide has settled, before the next show.
      queueNativeViewOperation(async () => {
        writeMiniappLog("miniapp_renderer_cleanup_close", `viewKey=${viewKey}`)
        await window.oneMind.miniappView.close(viewKey)
      })
    }
  }, [viewKey, url, nativeKey, validUrl, hostRef])

  return nativeStatus?.key === nativeKey ? nativeStatus : null
}
