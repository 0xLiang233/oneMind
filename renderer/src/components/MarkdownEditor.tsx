import { CrepeBuilder } from "@milkdown/crepe"
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
import { ContextMenu, type ContextMenuItem } from "../shell/ContextMenu"

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  readonly?: boolean
}

export function MarkdownEditor({ value, onChange, readonly = false }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)
  const selectionRangeRef = useRef<Range | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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
    const root = editorRootRef.current
    if (!root) return

    let disposed = false
    const editor = new CrepeBuilder({
      root,
      defaultValue: value
    })

    editorRef.current = editor
    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    void editor.create().then(() => {
      if (disposed) return
      editor.setReadonly(readonly)
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
      onKeyUp={saveCurrentSelection}
    >
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
    </div>
  )
}

function getMarkdownSnippet(action: string) {
  switch (action) {
    case "insert-table":
      return "\n| 标题 | 内容 | 备注 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n"
    case "insert-code-block":
      return "\n```text\n\n```\n"
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
