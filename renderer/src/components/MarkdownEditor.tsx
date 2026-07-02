import { tags as highlightTags } from "@lezer/highlight"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { EditorView } from "@codemirror/view"
import { CrepeBuilder } from "@milkdown/crepe"
import { codeMirror } from "@milkdown/crepe/feature/code-mirror"
import "@milkdown/crepe/theme/classic.css"
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand
} from "@milkdown/kit/preset/commonmark"
import { createTable } from "@milkdown/kit/preset/gfm"
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core"
import { useEffect, useMemo, useRef, useState } from "react"
import mermaid from "mermaid"
import { ContextMenu, type ContextMenuItem } from "../shell/ContextMenu"

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  readonly?: boolean
}

type MermaidDragState = {
  pointerId: number
  viewport: HTMLElement
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

export function MarkdownEditor({ value, onChange, readonly = false }: MarkdownEditorProps) {
  const parsedDocument = useMemo(() => parseMarkdownDocument(value), [value])
  const parsedDocumentRef = useRef(parsedDocument)
  const readonlyRef = useRef(readonly)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)
  const selectionRangeRef = useRef<Range | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; activeIndex: number } | null>(null)

  function updateProperties(nextProperties: MarkdownProperty[]) {
    onChangeRef.current(mergeMarkdownDocument(serializeFrontmatterProperties(nextProperties), parsedDocument.body))
  }

  const menuItems = useMemo<ContextMenuItem[][]>(() => [
    [
      { label: "剪切", action: "cut", shortcut: "Ctrl+X", disabled: readonly },
      { label: "复制", action: "copy", shortcut: "Ctrl+C" },
      { label: "粘贴", action: "paste", shortcut: "Ctrl+V", disabled: readonly },
      { label: "全选", action: "select-all", shortcut: "Ctrl+A" }
    ],
    [
      {
        label: "插入",
        disabled: readonly,
        children: [
          [
            { label: "表格", action: "insert-table" },
            { label: "代码块", action: "insert-code-block" },
            { label: "引用", action: "insert-quote" },
            { label: "分割线", action: "insert-divider" }
          ],
          [
            { label: "链接", action: "insert-link" },
            { label: "任务列表", action: "insert-task-list" },
            { label: "无序列表", action: "insert-bullet-list" },
            { label: "有序列表", action: "insert-number-list" }
          ]
        ]
      }
    ],
    [
      { label: "加粗", action: "insert-bold", shortcut: "Ctrl+B", disabled: readonly },
      { label: "斜体", action: "insert-italic", shortcut: "Ctrl+I", disabled: readonly }
    ]
  ], [readonly])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    parsedDocumentRef.current = parsedDocument
  }, [parsedDocument])

  useEffect(() => {
    readonlyRef.current = readonly
  }, [readonly])

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
      flowchart: {
        htmlLabels: false
      }
    })
  }, [])

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return

    let disposed = false
    const editor = new CrepeBuilder({
      root,
      defaultValue: parsedDocumentRef.current.body
    }).addFeature(codeMirror, {
      languages,
      extensions: [onemindCodeMirrorTheme],
      previewLabel: "预览",
      previewLoading: "图表渲染中...",
      previewOnlyByDefault: true,
      searchPlaceholder: "筛选语言",
      noResultText: "没有匹配的语言",
      copyText: "复制",
      copyIcon: createCopyIconMarkup(),
      expandIcon: createExpandIconMarkup(),
      searchIcon: createSearchIconMarkup(),
      clearSearchIcon: createClearIconMarkup(),
      renderLanguage: (language) => language,
      previewToggleIcon: (previewOnlyMode) => createPreviewToggleMarkup(previewOnlyMode),
      previewToggleText: () => "",
      renderPreview: (language, content, applyPreview) => {
        if (language.toLowerCase() !== "mermaid") return null
        if (!content.trim()) return null

        const renderId = `onemind-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`
        void mermaid.render(renderId, content)
          .then((result) => applyPreview(createMermaidPreviewElement(result.svg)))
          .catch(() => applyPreview(createMermaidErrorElement()))
      }
    })

    editorRef.current = editor
    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(mergeMarkdownDocument(parsedDocumentRef.current.rawProperties, markdown))
      })
    })

    void editor.create().then(() => {
      if (disposed) return
      editor.setReadonly(readonlyRef.current)
    })

    return () => {
      disposed = true
      editorRef.current = null
      void editor.destroy()
    }
  }, [])

  useEffect(() => {
    editorRef.current?.setReadonly(readonly)
  }, [readonly])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let activeDrag: MermaidDragState | null = null
    let pendingDragFrame = 0
    let pendingDragX = 0
    let pendingDragY = 0

    const handleWheel = (event: WheelEvent) => {
      const viewport = findMermaidViewport(event.target)
      if (!viewport || !root.contains(viewport)) return
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      zoomMermaidPreview(viewport, event.deltaY, event.clientX, event.clientY)
    }

    const flushDrag = () => {
      pendingDragFrame = 0
      if (!activeDrag) return
      activeDrag.viewport.scrollLeft = activeDrag.scrollLeft - (pendingDragX - activeDrag.startX)
      activeDrag.viewport.scrollTop = activeDrag.scrollTop - (pendingDragY - activeDrag.startY)
    }

    const handlePointerDown = (event: PointerEvent) => {
      const viewport = findMermaidViewport(event.target)
      if (!viewport || !root.contains(viewport) || event.button !== 0) return

      const scale = getMermaidPreviewNumber(viewport, "scale", 1)
      if (scale <= 1) return

      event.preventDefault()
      event.stopPropagation()
      activeDrag = {
        pointerId: event.pointerId,
        viewport,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop
      }
      pendingDragX = event.clientX
      pendingDragY = event.clientY
      viewport.dataset.dragging = "true"
      viewport.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return

      event.preventDefault()
      event.stopPropagation()
      pendingDragX = event.clientX
      pendingDragY = event.clientY
      if (!pendingDragFrame) {
        pendingDragFrame = window.requestAnimationFrame(flushDrag)
      }
    }

    const endPointerDrag = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return

      event.preventDefault()
      event.stopPropagation()
      activeDrag.viewport.dataset.dragging = "false"
      if (activeDrag.viewport.hasPointerCapture(event.pointerId)) {
        activeDrag.viewport.releasePointerCapture(event.pointerId)
      }
      activeDrag = null
      if (pendingDragFrame) {
        window.cancelAnimationFrame(pendingDragFrame)
        pendingDragFrame = 0
      }
    }

    const handleDoubleClick = (event: MouseEvent) => {
      const viewport = findMermaidViewport(event.target)
      if (!viewport || !root.contains(viewport)) return

      event.preventDefault()
      event.stopPropagation()
      fitMermaidPreview(viewport, { resetScroll: true })
    }

    root.addEventListener("wheel", handleWheel, { passive: false, capture: true })
    root.addEventListener("pointerdown", handlePointerDown, { capture: true })
    root.addEventListener("pointermove", handlePointerMove, { capture: true })
    root.addEventListener("pointerup", endPointerDrag, { capture: true })
    root.addEventListener("pointercancel", endPointerDrag, { capture: true })
    root.addEventListener("dblclick", handleDoubleClick, { capture: true })
    return () => {
      root.removeEventListener("wheel", handleWheel, { capture: true })
      root.removeEventListener("pointerdown", handlePointerDown, { capture: true })
      root.removeEventListener("pointermove", handlePointerMove, { capture: true })
      root.removeEventListener("pointerup", endPointerDrag, { capture: true })
      root.removeEventListener("pointercancel", endPointerDrag, { capture: true })
      root.removeEventListener("dblclick", handleDoubleClick, { capture: true })
      if (pendingDragFrame) {
        window.cancelAnimationFrame(pendingDragFrame)
      }
    }
  }, [])

  function saveCurrentSelection() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!rootRef.current?.contains(range.commonAncestorContainer)) return
    selectionRangeRef.current = range.cloneRange()
  }

  function restoreEditorSelection() {
    const editable = rootRef.current?.querySelector<HTMLElement>(".ProseMirror")
    editable?.focus()

    const range = selectionRangeRef.current
    if (!range) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!rootRef.current?.contains(e.target as Node)) return
    e.preventDefault()
    saveCurrentSelection()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function getSelectionMenuPosition() {
    const editor = editorRef.current?.editor
    if (editor) {
      let position: { x: number; y: number } | null = null
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const coords = view.coordsAtPos(view.state.selection.from)
        position = { x: coords.left, y: coords.bottom + 8 }
      })
      if (position) return position
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    return { x: rect.left, y: rect.bottom + 8 }
  }

  function openSlashMenu() {
    if (readonly) return
    const position = getSelectionMenuPosition()
    if (!position) return
    saveCurrentSelection()
    setSlashMenu({
      x: Math.min(position.x, window.innerWidth - 296),
      y: Math.min(position.y, window.innerHeight - 348),
      activeIndex: 0
    })
  }

  function deleteSlashTrigger() {
    const editor = editorRef.current?.editor
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from } = view.state.selection
      if (from <= 0) return
      const previousChar = view.state.doc.textBetween(from - 1, from)
      if (previousChar !== "/") return
      view.dispatch(view.state.tr.delete(from - 1, from))
    })
  }

  function handleSlashMenuKeyDown(event: React.KeyboardEvent) {
    if (!slashMenu) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSlashMenu(current => current ? { ...current, activeIndex: (current.activeIndex + 1) % slashCommands.length } : current)
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setSlashMenu(current => current ? { ...current, activeIndex: (current.activeIndex - 1 + slashCommands.length) % slashCommands.length } : current)
    }
    if (event.key === "Enter") {
      event.preventDefault()
      void handleSlashAction(slashCommands[slashMenu.activeIndex].action)
    }
    if (event.key === "Escape") {
      event.preventDefault()
      setSlashMenu(null)
    }
  }

  async function handleSlashAction(action: string) {
    restoreEditorSelection()
    deleteSlashTrigger()
    setSlashMenu(null)

    const markdownSnippet = getMarkdownSnippet(action)
    if (markdownSnippet && pasteMarkdown(markdownSnippet)) return
    runMilkdownCommand(action)
  }

  async function handleMenuAction(action: string) {
    restoreEditorSelection()

    if (action === "copy" || action === "cut") {
      document.execCommand(action)
      return
    }
    if (action === "paste") {
      const text = await navigator.clipboard?.readText?.().catch(() => "")
      if (text) insertMarkdownText(text)
      return
    }
    if (action === "select-all") {
      document.execCommand("selectAll")
      saveCurrentSelection()
      return
    }

    const markdownSnippet = getMarkdownSnippet(action)
    if (markdownSnippet && pasteMarkdown(markdownSnippet)) return

    if (runMilkdownCommand(action)) return
  }

  function insertMarkdownText(text: string) {
    if (readonly) return
    document.execCommand("insertText", false, text)
    saveCurrentSelection()
  }

  function pasteMarkdown(markdown: string) {
    if (readonly) return false

    const viewElement = rootRef.current?.querySelector<HTMLElement>(".ProseMirror")
    if (!viewElement) return false

    const data = new DataTransfer()
    data.setData("text/markdown", markdown)
    data.setData("text/plain", markdown)
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    })

    viewElement.dispatchEvent(event)
    saveCurrentSelection()
    return event.defaultPrevented
  }

  function runMilkdownCommand(action: string) {
    const editor = editorRef.current?.editor
    if (!editor) return false

    let handled = false
    editor.action((ctx) => {
      const commands = ctx.get(commandsCtx)
      const view = ctx.get(editorViewCtx)
      const { from } = view.state.selection

      switch (action) {
        case "insert-table":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) })
          commands.call(selectTextNearPosCommand.key, { pos: from })
          handled = true
          break
        case "insert-code-block":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) })
          handled = true
          break
        case "insert-quote":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) })
          handled = true
          break
        case "insert-divider":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) })
          handled = true
          break
        case "insert-bullet-list":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) })
          handled = true
          break
        case "insert-number-list":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) })
          handled = true
          break
        case "insert-task-list":
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(wrapInBlockTypeCommand.key, {
            nodeType: listItemSchema.type(ctx),
            attrs: { checked: false }
          })
          handled = true
          break
        case "insert-bold":
          commands.call(toggleStrongCommand.key)
          handled = true
          break
        case "insert-italic":
          commands.call(toggleEmphasisCommand.key)
          handled = true
          break
      }
    })

    if (handled) saveCurrentSelection()
    return handled
  }

  return (
    <div
      className="onemind-markdown-editor"
      ref={rootRef}
      onContextMenu={handleContextMenu}
      onMouseUp={saveCurrentSelection}
      onKeyDown={handleSlashMenuKeyDown}
      onKeyUp={(event) => {
        saveCurrentSelection()
        if (event.key === "/") openSlashMenu()
      }}
    >
      {parsedDocument.properties.length > 0 ? (
        <MarkdownPropertiesPanel
          properties={parsedDocument.properties}
          readonly={readonly}
          onChange={updateProperties}
        />
      ) : null}
      <div ref={editorRootRef} />
      {contextMenu && (
        <ContextMenu
          id="editor-context-menu"
          items={menuItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onAction={(action) => {
            void handleMenuAction(action)
          }}
        />
      )}
      {slashMenu && (
        <div
          className="markdown-slash-menu"
          style={{ left: slashMenu.x, top: slashMenu.y }}
          role="listbox"
          aria-label="插入内容"
        >
          {slashCommands.map((command, index) => (
            <button
              type="button"
              key={command.action}
              className={index === slashMenu.activeIndex ? "active" : ""}
              role="option"
              aria-selected={index === slashMenu.activeIndex}
              onMouseEnter={() => setSlashMenu(current => current ? { ...current, activeIndex: index } : current)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleSlashAction(command.action)}
            >
              <span>{command.label}</span>
              <small>{command.description}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const slashCommands = [
  { label: "表格", description: "插入 3 列表格", action: "insert-table" },
  { label: "代码块", description: "插入 fenced code block", action: "insert-code-block" },
  { label: "Mermaid 图表", description: "插入流程图模板", action: "insert-mermaid" },
  { label: "引用", description: "插入引用块", action: "insert-quote" },
  { label: "分割线", description: "插入横向分隔", action: "insert-divider" },
  { label: "链接", description: "插入 Markdown 链接", action: "insert-link" },
  { label: "任务列表", description: "插入待办项", action: "insert-task-list" },
  { label: "无序列表", description: "插入项目符号列表", action: "insert-bullet-list" },
  { label: "有序列表", description: "插入编号列表", action: "insert-number-list" }
]

type MarkdownProperty = {
  key: string
  value: string
  values: string[]
  type: "tags" | "date" | "link" | "text"
}

function createMermaidErrorElement() {
  const element = document.createElement("div")
  element.className = "markdown-mermaid-preview error"
  element.textContent = "Mermaid 语法无法渲染"
  return element
}

function createMermaidPreviewElement(svg: string) {
  const viewport = document.createElement("div")
  viewport.className = "markdown-mermaid-viewport"
  viewport.dataset.scale = "1"

  const canvas = document.createElement("div")
  canvas.className = "markdown-mermaid-canvas"
  canvas.innerHTML = svg
  prepareMermaidSvg(canvas.querySelector("svg"))
  viewport.appendChild(canvas)
  queueMermaidPreviewFit(viewport)
  return viewport
}

function findMermaidViewport(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>(".markdown-mermaid-viewport")
}

function getMermaidPreviewNumber(element: HTMLElement, key: string, fallback: number) {
  const value = Number(element.dataset[key])
  return Number.isFinite(value) ? value : fallback
}

function zoomMermaidPreview(viewport: HTMLElement, deltaY: number, clientX: number, clientY: number) {
  const currentScale = getMermaidPreviewNumber(viewport, "scale", 1)
  const nextScale = clamp(currentScale * (deltaY < 0 ? 1.12 : 0.88), 0.35, 6)
  if (nextScale <= 1.02) {
    fitMermaidPreview(viewport, { resetScroll: false })
    return
  }
  resizeMermaidPreview(viewport, nextScale, { clientX, clientY, previousScale: currentScale })
}

function queueMermaidPreviewFit(viewport: HTMLElement) {
  let frame = 0
  let stableFrames = 0
  let lastWidth = 0
  let lastHeight = 0

  const fitWhenStable = () => {
    if (!document.body.contains(viewport)) {
      frame = window.requestAnimationFrame(fitWhenStable)
      return
    }

    const rect = viewport.getBoundingClientRect()
    const hasSize = rect.width > 0 && rect.height > 0
    const isStable = hasSize && Math.abs(rect.width - lastWidth) < 0.5 && Math.abs(rect.height - lastHeight) < 0.5
    lastWidth = rect.width
    lastHeight = rect.height
    stableFrames = isStable ? stableFrames + 1 : 0

    if (stableFrames >= 2) {
      fitMermaidPreview(viewport)
      return
    }

    frame = window.requestAnimationFrame(fitWhenStable)
  }

  frame = window.requestAnimationFrame(fitWhenStable)
  void document.fonts?.ready.then(() => fitMermaidPreview(viewport))
  window.setTimeout(() => {
    if (document.body.contains(viewport) && getMermaidPreviewNumber(viewport, "scale", 1) <= 1.02) {
      fitMermaidPreview(viewport)
    }
  }, 180)

  const resizeObserver = new ResizeObserver(() => {
    if (getMermaidPreviewNumber(viewport, "scale", 1) <= 1.02) {
      if (frame) window.cancelAnimationFrame(frame)
      stableFrames = 0
      frame = window.requestAnimationFrame(fitWhenStable)
    }
  })
  resizeObserver.observe(viewport)
}

function getMermaidSvg(viewport: HTMLElement) {
  return viewport.querySelector<SVGSVGElement>(".markdown-mermaid-canvas svg")
}

function fitMermaidPreview(viewport: HTMLElement, options: { resetScroll?: boolean } = {}) {
  resizeMermaidPreview(viewport, 1)
  if (options.resetScroll) {
    viewport.scrollLeft = 0
    viewport.scrollTop = 0
  }
}

function resizeMermaidPreview(
  viewport: HTMLElement,
  scale: number,
  focus?: { clientX: number; clientY: number; previousScale: number }
) {
  const svg = getMermaidSvg(viewport)
  const viewBox = svg?.viewBox.baseVal
  if (!svg || !viewBox || !viewBox.width || !viewBox.height) return

  const viewportWidth = Math.max(viewport.clientWidth - 56, 240)
  const baseWidth = Math.max(viewportWidth, Math.min(viewBox.width, viewportWidth))
  const nextWidth = baseWidth * scale
  const nextHeight = nextWidth * (viewBox.height / viewBox.width)
  const beforeRect = svg.getBoundingClientRect()
  const focusX = focus ? focus.clientX - beforeRect.left + viewport.scrollLeft : 0
  const focusY = focus ? focus.clientY - beforeRect.top + viewport.scrollTop : 0
  const focusRatioX = beforeRect.width ? focusX / beforeRect.width : 0.5
  const focusRatioY = beforeRect.height ? focusY / beforeRect.height : 0.5

  svg.style.width = `${nextWidth}px`
  svg.style.height = `${nextHeight}px`
  const canvas = svg.closest<HTMLElement>(".markdown-mermaid-canvas")
  if (canvas) {
    canvas.style.width = `${Math.max(nextWidth, viewport.clientWidth - 56)}px`
    canvas.style.height = `${Math.max(nextHeight, viewport.clientHeight - 56)}px`
    canvas.style.justifyContent = nextWidth < viewport.clientWidth - 56 ? "center" : "flex-start"
  }
  viewport.dataset.scale = String(scale)
  viewport.dataset.zoomed = String(scale > 1.02)

  if (focus) {
    const afterRect = svg.getBoundingClientRect()
    viewport.scrollLeft = afterRect.width * focusRatioX - (focus.clientX - afterRect.left)
    viewport.scrollTop = afterRect.height * focusRatioY - (focus.clientY - afterRect.top)
  }
}

function prepareMermaidSvg(svg: SVGSVGElement | null) {
  if (!svg) return
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet")
  if (svg.querySelector(":scope > .markdown-mermaid-transform-root")) return

  const namespace = "http://www.w3.org/2000/svg"
  const transformRoot = document.createElementNS(namespace, "g")
  transformRoot.classList.add("markdown-mermaid-transform-root")

  const staticRootTags = new Set(["defs", "style", "title", "desc", "metadata"])
  Array.from(svg.childNodes).forEach((node) => {
    if (
      node instanceof SVGElement &&
      staticRootTags.has(node.tagName.toLowerCase())
    ) {
      return
    }
    transformRoot.appendChild(node)
  })

  if (transformRoot.childNodes.length > 0) {
    svg.appendChild(transformRoot)
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createPreviewToggleMarkup(previewOnlyMode: boolean) {
  return `
    <span class="markdown-code-toggle ${previewOnlyMode ? "is-preview" : "is-source"}" aria-hidden="true">
      <span class="markdown-code-toggle-option">预览</span>
      <span class="markdown-code-toggle-option">源码</span>
    </span>
  `
}

function createExpandIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 6.25 8 9.75l3.5-3.5" />
    </svg>
  `
}

function createCopyIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 5.5h5v6h-5z" />
      <path d="M3.5 9.5v-6h5" />
    </svg>
  `
}

function createSearchIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="3.25" />
      <path d="m9.5 9.5 3 3" />
    </svg>
  `
}

function createClearIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5 5 6 6M11 5l-6 6" />
    </svg>
  `
}

const onemindCodeMirrorTheme = [
  EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: "var(--color-text-primary)",
      fontFamily: "var(--font-mono)",
      fontSize: "13px"
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.65"
    },
    ".cm-content": {
      padding: "10px 0 12px"
    },
    ".cm-line": {
      padding: "0 18px"
    },
    ".cm-gutters": {
      backgroundColor: "color-mix(in srgb, var(--color-bg-elevated) 68%, transparent)",
      borderRight: "1px solid var(--color-border-subtle)",
      color: "var(--color-text-tertiary)"
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "34px",
      padding: "0 10px 0 8px"
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--color-accent-primary) 7%, transparent)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--color-accent-primary) 8%, transparent)",
      color: "var(--color-text-secondary)"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--color-accent-primary-glow)"
    },
    ".cm-cursor": {
      borderLeftColor: "var(--color-accent-primary)"
    },
    "&.cm-focused": {
      outline: "none"
    }
  }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: [highlightTags.keyword, highlightTags.operatorKeyword], color: "#7c3aed", fontWeight: "600" },
    { tag: [highlightTags.string, highlightTags.special(highlightTags.string)], color: "#0f766e" },
    { tag: [highlightTags.number, highlightTags.bool, highlightTags.null], color: "#b45309" },
    { tag: [highlightTags.propertyName, highlightTags.attributeName], color: "#2563eb" },
    { tag: [highlightTags.variableName, highlightTags.definition(highlightTags.variableName)], color: "#334155" },
    { tag: [highlightTags.comment, highlightTags.lineComment, highlightTags.blockComment], color: "#94a3b8", fontStyle: "italic" },
    { tag: [highlightTags.heading, highlightTags.strong], color: "#0f172a", fontWeight: "700" },
    { tag: [highlightTags.link, highlightTags.url], color: "#0e7490", textDecoration: "underline" },
    { tag: [highlightTags.punctuation, highlightTags.bracket], color: "#64748b" }
  ]))
]

function parseMarkdownDocument(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/)
  if (!match) {
    return {
      rawProperties: "",
      properties: [] as MarkdownProperty[],
      body: markdown
    }
  }

  const rawProperties = match[1]
  return {
    rawProperties,
    properties: parseFrontmatterProperties(rawProperties),
    body: match[2] ?? ""
  }
}

function mergeMarkdownDocument(rawProperties: string, body: string) {
  if (!rawProperties.trim()) return body
  const normalizedBody = body.replace(/^\n+/, "")
  return `---\n${rawProperties.trimEnd()}\n---\n${normalizedBody}`
}

function parseFrontmatterProperties(rawProperties: string): MarkdownProperty[] {
  const lines = rawProperties.replace(/\r\n/g, "\n").split("\n")
  const properties: MarkdownProperty[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    const firstValue = match[2].trim()
    const listValues: string[] = []

    let cursor = index + 1
    while (cursor < lines.length) {
      const itemMatch = lines[cursor].match(/^\s*-\s+(.+)$/)
      if (!itemMatch) break
      listValues.push(cleanPropertyValue(itemMatch[1]))
      cursor += 1
    }

    if (listValues.length > 0) {
      index = cursor - 1
      properties.push({
        key,
        value: listValues.join(", "),
        values: listValues,
        type: key.toLowerCase() === "tags" ? "tags" : "text"
      })
      continue
    }

    const value = cleanPropertyValue(firstValue)
    properties.push({
      key,
      value,
      values: value ? [value] : [],
      type: inferPropertyType(key, value)
    })
  }

  return properties
}

function serializeFrontmatterProperties(properties: MarkdownProperty[]) {
  return properties
    .map((property) => {
      if (property.type === "tags") {
        const values = property.values.filter(Boolean)
        if (values.length === 0) return `${property.key}:`
        return `${property.key}:\n${values.map((value) => `  - ${value}`).join("\n")}`
      }

      return `${property.key}: ${formatPropertyValue(property.value)}`
    })
    .join("\n")
}

function formatPropertyValue(value: string) {
  if (!value) return ""
  if (/[:#[\]{},"\n]/.test(value)) return JSON.stringify(value)
  return value
}

function cleanPropertyValue(value: string) {
  return value.trim().replace(/^["']|["']$/g, "")
}

function inferPropertyType(key: string, value: string): MarkdownProperty["type"] {
  const normalizedKey = key.toLowerCase()
  if (normalizedKey === "tags") return "tags"
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date"
  if (/^\[\[.+\]\]$/.test(value) || value.startsWith("./") || value.startsWith("../")) return "link"
  return "text"
}

function MarkdownPropertiesPanel({
  properties,
  readonly,
  onChange
}: {
  properties: MarkdownProperty[]
  readonly: boolean
  onChange: (properties: MarkdownProperty[]) => void
}) {
  function updateProperty(key: string, updater: (property: MarkdownProperty) => MarkdownProperty) {
    onChange(properties.map((property) => property.key === key ? updater(property) : property))
  }

  function addTag(property: MarkdownProperty, value: string) {
    const tag = value.trim()
    if (!tag || property.values.includes(tag)) return
    updateProperty(property.key, (current) => ({
      ...current,
      values: [...current.values, tag],
      value: [...current.values, tag].join(", ")
    }))
  }

  function removeTag(property: MarkdownProperty, value: string) {
    updateProperty(property.key, (current) => {
      const values = current.values.filter((item) => item !== value)
      return {
        ...current,
        values,
        value: values.join(", ")
      }
    })
  }

  return (
    <div className="markdown-properties-panel" contentEditable={false}>
      {properties.map((property) => (
        <div className="markdown-property-row" key={property.key}>
          <div className="markdown-property-key">
            <PropertyIcon type={property.type} />
            <span>{property.key}</span>
          </div>
          <div className="markdown-property-value">
            {property.type === "tags" ? (
              <>
                {property.values.map((value) => (
                  <span className="markdown-property-tag" key={value}>
                    {value}
                    {!readonly ? (
                      <button
                        type="button"
                        className="markdown-property-tag-remove"
                        aria-label={`删除标签 ${value}`}
                        onClick={() => removeTag(property, value)}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
                {!readonly ? (
                  <TagInput onCommit={(value) => addTag(property, value)} />
                ) : null}
              </>
            ) : property.type === "link" ? (
              <EditablePropertyValue
                className="markdown-property-link"
                value={property.value}
                readonly={readonly}
                onCommit={(value) => updateProperty(property.key, (current) => ({
                  ...current,
                  value,
                  values: value ? [value] : [],
                  type: inferPropertyType(current.key, value)
                }))}
              />
            ) : (
              <EditablePropertyValue
                value={property.value}
                readonly={readonly}
                onCommit={(value) => updateProperty(property.key, (current) => ({
                  ...current,
                  value,
                  values: value ? [value] : [],
                  type: inferPropertyType(current.key, value)
                }))}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TagInput({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState("")

  function commit() {
    const next = value.trim()
    if (!next) return
    onCommit(next)
    setValue("")
  }

  return (
    <input
      className="markdown-property-tag-input"
      value={value}
      placeholder="+ 标签"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
          event.preventDefault()
          commit()
        }
        if (event.key === "Escape") {
          setValue("")
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function EditablePropertyValue({
  value,
  readonly,
  className,
  onCommit
}: {
  value: string
  readonly: boolean
  className?: string
  onCommit: (value: string) => void
}) {
  if (readonly) {
    return <span className={className}>{value || "空"}</span>
  }

  return (
    <input
      key={value}
      className={["markdown-property-input", className].filter(Boolean).join(" ")}
      defaultValue={value}
      placeholder="空"
      onBlur={(event) => onCommit(event.currentTarget.value.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          onCommit(event.currentTarget.value.trim())
          event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          event.currentTarget.value = value
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function PropertyIcon({ type }: { type: MarkdownProperty["type"] }) {
  const path = type === "tags"
    ? "M3 3.5H8.5L13 8V13.5H7.5L3 9V3.5ZM5 5.5H7"
    : type === "date"
      ? "M4 2.5V5M10 2.5V5M2.5 6.5H11.5M3 4H11C11.8 4 12.5 4.7 12.5 5.5V12C12.5 12.8 11.8 13.5 11 13.5H3C2.2 13.5 1.5 12.8 1.5 12V5.5C1.5 4.7 2.2 4 3 4Z"
      : type === "link"
        ? "M5.5 8.5L8.5 5.5M6 4.5L7 3.5C8 2.5 9.6 2.5 10.6 3.5C11.6 4.5 11.6 6.1 10.6 7.1L9.6 8.1M8 9.5L7 10.5C6 11.5 4.4 11.5 3.4 10.5C2.4 9.5 2.4 7.9 3.4 6.9L4.4 5.9"
        : "M3 4H11M3 7H11M3 10H8"

  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getMarkdownSnippet(action: string) {
  switch (action) {
    case "insert-table":
      return "\n| 标题 | 内容 | 备注 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n"
    case "insert-code-block":
      return "\n```text\n\n```\n"
    case "insert-mermaid":
      return "\n```mermaid\nflowchart TD\n  A[开始] --> B{条件}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n```\n"
    case "insert-quote":
      return "\n> 引用内容\n"
    case "insert-divider":
      return "\n---\n"
    case "insert-link":
      return "[链接文本](https://)"
    case "insert-task-list":
      return "\n- [ ] 待办事项\n"
    case "insert-bullet-list":
      return "\n- 列表项\n"
    case "insert-number-list":
      return "\n1. 列表项\n"
    default:
      return ""
  }
}
