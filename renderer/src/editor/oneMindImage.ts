import type { Editor } from "@milkdown/kit/core"
import type { Node as MarkdownNode } from "@milkdown/kit/transformer"
import { uploadConfig } from "@milkdown/kit/plugin/upload"
import { $ctx, $nodeSchema, $remark, $view } from "@milkdown/kit/utils"
import { NodeSelection } from "prosemirror-state"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { Check, MoveDiagonal2, X } from "../icons"

const imageNodeId = "onemind-image"
const minimumWidthPercent = 20
const maximumWidthPercent = 100
const metadataPattern = /^<!--\s*onemind:image\s+width=(\d+(?:\.\d+)?)%\s*-->$/
const legacyRatioAltPattern = /^\d+(?:\.\d+)?$/
export const oneMindImageRenameEvent = "onemind:image-rename"

export type OneMindImageConfig = {
  onUpload: (file: File) => Promise<string>
  resolveImageURL: (url: string) => Promise<string> | string
  renameImage?: (url: string, newName: string) => Promise<string>
  onError?: (message: string) => void
}

type OneMindImageMarkdownNode = MarkdownNode & {
  url?: string
  alt?: string
  title?: string
  widthPercent?: number | null
  value?: string
  children?: OneMindImageMarkdownNode[]
}

export const oneMindImageConfig = $ctx<OneMindImageConfig, "oneMindImageConfig">(
  {
    onUpload: async () => {
      throw new Error("Image upload is not configured.")
    },
    resolveImageURL: (url) => url
  },
  "oneMindImageConfig"
)

export const oneMindImageSchema = $nodeSchema(imageNodeId, () => ({
  inline: false,
  group: "block",
  selectable: true,
  draggable: true,
  isolating: true,
  marks: "",
  atom: true,
  attrs: {
    src: { default: "", validate: "string" },
    alt: { default: "image", validate: "string" },
    title: { default: "", validate: "string" },
    widthPercent: { default: null }
  },
  parseDOM: [
    {
      tag: `img[data-type="${imageNodeId}"]`,
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLImageElement)) return false
        return {
          src: dom.getAttribute("src") || "",
          alt: dom.getAttribute("alt") || "image",
          title: dom.getAttribute("title") || "",
          widthPercent: parseWidthPercent(dom.dataset.widthPercent)
        }
      }
    }
  ],
  toDOM: (node) => ["img", {
    "data-type": imageNodeId,
    "data-width-percent": node.attrs.widthPercent ?? "",
    src: node.attrs.src,
    alt: node.attrs.alt,
    title: node.attrs.title
  }],
  parseMarkdown: {
    match: (node) => node.type === imageNodeId,
    runner: (state, node, type) => {
      const image = node as OneMindImageMarkdownNode
      const rawAlt = image.alt || "image"
      state.addNode(type, {
        src: image.url || "",
        alt: legacyRatioAltPattern.test(rawAlt) ? "image" : rawAlt,
        title: image.title || "",
        widthPercent: normalizeWidthPercent(image.widthPercent)
      })
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === imageNodeId,
    runner: (state, node) => {
      state.openNode("paragraph")
      state.addNode("image", undefined, undefined, {
        url: node.attrs.src,
        alt: node.attrs.alt || "image",
        title: node.attrs.title || undefined
      })
      state.closeNode()

      const widthPercent = normalizeWidthPercent(node.attrs.widthPercent)
      if (widthPercent != null) {
        state.addNode("html", undefined, `<!-- onemind:image width=${widthPercent}% -->`)
      }
    }
  }
}))

export const oneMindImageRemark = $remark(
  "onemind-image",
  () => () => (tree: MarkdownNode) => transformImageParagraphs(tree as OneMindImageMarkdownNode)
)

export const oneMindImageView = $view(oneMindImageSchema.node, (ctx) => {
  return (initialNode, view, getPos) => {
    const config = ctx.get(oneMindImageConfig.key)
    const dom = document.createElement("div")
    const frame = document.createElement("div")
    const image = document.createElement("img")
    const handle = document.createElement("button")
    const renameForm = document.createElement("form")
    const renameField = document.createElement("div")
    const renameInput = document.createElement("input")
    const renameExtension = document.createElement("span")
    const renameConfirm = document.createElement("button")
    const renameCancel = document.createElement("button")
    const renameError = document.createElement("div")
    let currentNode = initialNode
    let loadVersion = 0
    let renaming = false
    let renamePending = false
    let activeResize: {
      pointerId: number
      startX: number
      startWidth: number
      containerWidth: number
      originalWidth: number | null
      previewWidth: number
      pendingClientX: number
      animationFrame: number
    } | null = null

    dom.className = "onemind-image-node"
    frame.className = "onemind-image-frame"
    image.className = "onemind-image-content"
    image.draggable = false
    handle.className = "onemind-image-resize-handle"
    handle.type = "button"
    handle.tabIndex = -1
    handle.title = "调整图片宽度；双击恢复原始大小"
    handle.setAttribute("aria-label", "调整图片宽度")
    const handleIconRoot = createRoot(handle)
    handleIconRoot.render(createElement(MoveDiagonal2, {
      "aria-hidden": true,
      size: 13,
      strokeWidth: 1.8
    }))
    renameForm.className = "onemind-image-rename"
    renameForm.hidden = true
    renameField.className = "onemind-image-rename-field"
    renameInput.className = "onemind-image-rename-input"
    renameInput.type = "text"
    renameInput.autocomplete = "off"
    renameInput.spellcheck = false
    renameInput.setAttribute("aria-label", "图片名称")
    renameExtension.className = "onemind-image-rename-extension"
    renameConfirm.className = "onemind-image-rename-action"
    renameConfirm.type = "submit"
    renameConfirm.title = "保存名称"
    renameConfirm.setAttribute("aria-label", "保存名称")
    renameCancel.className = "onemind-image-rename-action"
    renameCancel.type = "button"
    renameCancel.title = "取消重命名"
    renameCancel.setAttribute("aria-label", "取消重命名")
    renameError.className = "onemind-image-rename-error"
    renameError.hidden = true
    renameError.setAttribute("role", "alert")
    const renameConfirmIconRoot = createRoot(renameConfirm)
    const renameCancelIconRoot = createRoot(renameCancel)
    renameConfirmIconRoot.render(createElement(Check, { "aria-hidden": true, size: 14, strokeWidth: 1.9 }))
    renameCancelIconRoot.render(createElement(X, { "aria-hidden": true, size: 14, strokeWidth: 1.9 }))
    renameField.append(renameInput, renameExtension)
    renameForm.append(renameField, renameConfirm, renameCancel, renameError)
    frame.append(image, handle)
    dom.append(frame, renameForm)

    frame.addEventListener("pointerdown", (event) => {
      if (!view.editable || handle.contains(event.target as Node)) return
      const pos = getPos()
      if (pos == null) return
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
      view.focus()
    })

    function setPreviewWidth(widthPercent: number | null, resizing = false) {
      const previewWidth = clampWidthPercent(widthPercent)
      dom.dataset.sized = previewWidth == null ? "false" : "true"
      dom.style.width = previewWidth == null ? "fit-content" : `${previewWidth}%`
      dom.dataset.widthLabel = previewWidth == null ? "原始" : `${Math.round(previewWidth)}%`
      dom.dataset.resizing = resizing ? "true" : "false"
    }

    function commitWidth(widthPercent: number | null) {
      if (!view.editable) return
      const pos = getPos()
      if (pos == null) return
      view.dispatch(view.state.tr.setNodeAttribute(pos, "widthPercent", normalizeWidthPercent(widthPercent)))
      view.focus()
    }

    function setRenameError(message: string) {
      renameError.textContent = message
      renameError.hidden = !message
    }

    function closeRename(focusEditor = true) {
      renaming = false
      renamePending = false
      dom.dataset.renaming = "false"
      dom.dataset.renamePending = "false"
      renameForm.hidden = true
      renameInput.disabled = false
      renameConfirm.disabled = false
      renameCancel.disabled = false
      setRenameError("")
      if (focusEditor) view.focus()
    }

    function startRename() {
      const name = getManagedImageName(currentNode.attrs.src)
      if (!view.editable || !config.renameImage || !name) return
      renaming = true
      renamePending = false
      dom.dataset.renaming = "true"
      dom.dataset.renamePending = "false"
      renameForm.hidden = false
      renameInput.value = name.baseName
      renameExtension.textContent = name.extension
      setRenameError("")
      window.requestAnimationFrame(() => {
        if (!renaming) return
        renameInput.focus()
        renameInput.select()
      })
    }

    async function commitRename() {
      if (!renaming || renamePending || !config.renameImage) return
      const validationError = validateImageBaseName(renameInput.value)
      if (validationError) {
        setRenameError(validationError)
        renameInput.focus()
        return
      }

      const source = currentNode.attrs.src as string
      const currentName = getManagedImageName(source)
      if (currentName?.baseName === renameInput.value.trim()) {
        closeRename()
        return
      }

      renamePending = true
      dom.dataset.renamePending = "true"
      renameInput.disabled = true
      renameConfirm.disabled = true
      renameCancel.disabled = true
      setRenameError("")
      try {
        const renamedSource = await config.renameImage(source, renameInput.value.trim())
        closeRename(false)
        let transaction = view.state.tr
        view.state.doc.descendants((node, pos) => {
          if (node.type === currentNode.type && node.attrs.src === source) {
            transaction = transaction.setNodeAttribute(pos, "src", renamedSource)
          }
        })
        if (transaction.docChanged) view.dispatch(transaction)
        view.focus()
      } catch (error) {
        renamePending = false
        dom.dataset.renamePending = "false"
        renameInput.disabled = false
        renameConfirm.disabled = false
        renameCancel.disabled = false
        setRenameError(String(error).replace(/^Error:\s*/, ""))
        renameInput.focus()
        renameInput.select()
      }
    }

    function bindNode(node: typeof initialNode) {
      if (renaming && node.attrs.src !== currentNode.attrs.src) closeRename(false)
      currentNode = node
      dom.dataset.renamable = config.renameImage && getManagedImageName(node.attrs.src) ? "true" : "false"
      image.alt = node.attrs.alt || "image"
      image.title = node.attrs.title || ""
      setPreviewWidth(node.attrs.widthPercent)

      const version = ++loadVersion
      image.removeAttribute("src")
      image.setAttribute("aria-busy", "true")
      Promise.resolve(config.resolveImageURL(node.attrs.src))
        .then((resolvedURL) => {
          if (version !== loadVersion) return
          image.src = resolvedURL
          image.setAttribute("aria-busy", "false")
        })
        .catch((error) => {
          if (version !== loadVersion) return
          image.setAttribute("aria-busy", "false")
          config.onError?.(`图片加载失败: ${String(error)}`)
        })
    }

    function finishResize(cancelled: boolean) {
      if (!activeResize) return
      const resize = activeResize
      if (resize.animationFrame) {
        window.cancelAnimationFrame(resize.animationFrame)
        resize.animationFrame = 0
      }
      if (!cancelled) updateResizePreview(resize)
      activeResize = null
      if (handle.hasPointerCapture(resize.pointerId)) {
        handle.releasePointerCapture(resize.pointerId)
      }
      if (cancelled) {
        setPreviewWidth(resize.originalWidth)
        return
      }
      const committedWidth = normalizeWidthPercent(resize.previewWidth)
      setPreviewWidth(committedWidth)
      commitWidth(committedWidth)
    }

    function updateResizePreview(resize: NonNullable<typeof activeResize>) {
      const width = resize.startWidth + resize.pendingClientX - resize.startX
      resize.previewWidth = clampWidthPercent((width / resize.containerWidth) * 100) ?? maximumWidthPercent
      setPreviewWidth(resize.previewWidth, true)
    }

    function scheduleResizePreview(resize: NonNullable<typeof activeResize>) {
      if (resize.animationFrame) return
      resize.animationFrame = window.requestAnimationFrame(() => {
        resize.animationFrame = 0
        if (activeResize !== resize) return
        updateResizePreview(resize)
      })
    }

    handle.addEventListener("pointerdown", (event) => {
      if (!view.editable || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const container = dom.parentElement?.getBoundingClientRect()
      if (!container?.width) return
      const currentWidth = normalizeWidthPercent(currentNode.attrs.widthPercent)
      activeResize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: dom.getBoundingClientRect().width,
        containerWidth: container.width,
        originalWidth: currentWidth,
        previewWidth: currentWidth ?? (dom.getBoundingClientRect().width / container.width) * 100,
        pendingClientX: event.clientX,
        animationFrame: 0
      }
      handle.setPointerCapture(event.pointerId)
      dom.dataset.resizing = "true"
    })

    handle.addEventListener("pointermove", (event) => {
      if (!activeResize || event.pointerId !== activeResize.pointerId) return
      event.preventDefault()
      activeResize.pendingClientX = event.clientX
      scheduleResizePreview(activeResize)
    })

    handle.addEventListener("pointerup", (event) => {
      if (!activeResize || event.pointerId !== activeResize.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      activeResize.pendingClientX = event.clientX
      finishResize(false)
    })
    handle.addEventListener("pointercancel", () => finishResize(true))
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault()
      event.stopPropagation()
      setPreviewWidth(null)
      commitWidth(null)
    })
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Home") {
        setPreviewWidth(null)
        commitWidth(null)
        return
      }
      const step = event.shiftKey ? 1 : 5
      const current = normalizeWidthPercent(currentNode.attrs.widthPercent) ?? maximumWidthPercent
      const direction = event.key === "ArrowLeft" ? -1 : 1
      const next = normalizeWidthPercent(current + direction * step)
      setPreviewWidth(next)
      commitWidth(next)
    })
    dom.addEventListener(oneMindImageRenameEvent, startRename)
    renameForm.addEventListener("submit", (event) => {
      event.preventDefault()
      void commitRename()
    })
    renameInput.addEventListener("input", () => setRenameError(""))
    renameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeRename()
    })
    renameCancel.addEventListener("click", () => closeRename())
    renameForm.addEventListener("focusout", (event) => {
      if (!renaming || renamePending) return
      if (event.relatedTarget instanceof Node && renameForm.contains(event.relatedTarget)) return
      window.setTimeout(() => {
        if (renaming && !renameForm.contains(document.activeElement)) void commitRename()
      }, 0)
    })

    bindNode(initialNode)
    return {
      dom,
      update: (updatedNode) => {
        if (updatedNode.type !== initialNode.type) return false
        bindNode(updatedNode)
        return true
      },
      selectNode: () => {
        dom.classList.add("selected")
        handle.tabIndex = 0
      },
      deselectNode: () => {
        dom.classList.remove("selected")
        handle.tabIndex = -1
        finishResize(true)
      },
      stopEvent: (event) =>
        handle.contains(event.target as Node) || renameForm.contains(event.target as Node),
      ignoreMutation: () => true,
      destroy: () => {
        finishResize(true)
        handleIconRoot.unmount()
        renameConfirmIconRoot.unmount()
        renameCancelIconRoot.unmount()
        loadVersion += 1
        dom.remove()
      }
    }
  }
})

export function oneMindImageFeature(editor: Editor, config?: OneMindImageConfig) {
  if (!config) throw new Error("OneMind image feature requires configuration.")
  editor
    .config((ctx) => {
      ctx.set(oneMindImageConfig.key, config)
      ctx.update(uploadConfig.key, (previous) => ({
        ...previous,
        uploader: async (files, schema) => {
          const nodeType = schema.nodes[imageNodeId]
          if (!nodeType) return []
          const images = Array.from(files).filter((file) => file.type.startsWith("image/"))
          return Promise.all(images.map(async (file) => nodeType.createAndFill({
            src: await config.onUpload(file),
            alt: "image",
            title: "",
            widthPercent: null
          }))).then((nodes) => nodes.filter((node) => node != null))
        }
      }))
    })
    .use(oneMindImageConfig)
    .use(oneMindImageRemark)
    .use(oneMindImageSchema)
    .use(oneMindImageView)
}

function transformImageParagraphs(node: OneMindImageMarkdownNode) {
  const children = node.children
  if (!children) return

  for (const child of children) transformImageParagraphs(child)
  for (let index = 0; index < children.length; index += 1) {
    const paragraph = children[index]
    if (paragraph.type !== "paragraph" || paragraph.children?.length !== 1) continue
    const image = paragraph.children[0]
    if (image.type !== "image") continue

    let widthPercent: number | null = null
    while (true) {
      const metadataWidth = getMetadataWidth(children[index + 1])
      if (metadataWidth == null) break
      widthPercent ??= metadataWidth
      children.splice(index + 1, 1)
    }

    children[index] = {
      type: imageNodeId,
      url: image.url,
      alt: image.alt,
      title: image.title,
      widthPercent
    } as OneMindImageMarkdownNode
  }
}

function getMetadataWidth(node: OneMindImageMarkdownNode | undefined) {
  if (!node) return null
  let value: string | undefined
  if (node.type === "html" && typeof node.value === "string") {
    value = node.value
  } else if (node.type === "paragraph" && node.children?.length === 1) {
    const content = node.children[0]
    if (
      (content.type === "html" || content.type === "text") &&
      typeof content.value === "string"
    ) {
      value = content.value
    }
  }
  if (!value) return null
  const match = value.trim().match(metadataPattern)
  return match ? parseWidthPercent(match[1]) : null
}

function parseWidthPercent(value: unknown) {
  if (typeof value === "number") return normalizeWidthPercent(value)
  if (typeof value !== "string" || !value.trim()) return null
  return normalizeWidthPercent(Number.parseFloat(value))
}

function clampWidthPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.min(maximumWidthPercent, Math.max(minimumWidthPercent, value))
}

function normalizeWidthPercent(value: unknown): number | null {
  const clamped = clampWidthPercent(value)
  return clamped == null ? null : Math.round(clamped)
}

function getManagedImageName(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/^\.\//, "")
  const segments = normalized.split("/")
  if (segments.length !== 3 || segments[0] !== "assets" || !segments[1]) return null
  const fileName = segments[2]
  const extensionIndex = fileName.lastIndexOf(".")
  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) return null
  return {
    baseName: fileName.slice(0, extensionIndex),
    extension: fileName.slice(extensionIndex)
  }
}

function validateImageBaseName(value: string) {
  const name = value.trim()
  if (!name) return "图片名称不能为空"
  if (Array.from(name).length > 120) return "图片名称不能超过 120 个字符"
  const hasInvalidCharacter = Array.from(name).some((character) =>
    character.charCodeAt(0) <= 31 || '<>:"/\\|?*'.includes(character)
  )
  if (name === "." || name === ".." || hasInvalidCharacter || /[. ]$/.test(name)) {
    return "图片名称包含无效字符"
  }
  const deviceName = name.split(".")[0].toUpperCase()
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceName)) return "该图片名称是系统保留名称"
  return ""
}
