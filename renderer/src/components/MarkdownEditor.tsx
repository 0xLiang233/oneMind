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
  const parsedDocument = useMemo(() => parseMarkdownDocument(value), [value])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)
  const selectionRangeRef = useRef<Range | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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
    const root = editorRootRef.current
    if (!root) return

    let disposed = false
    const editor = new CrepeBuilder({
      root,
      defaultValue: parsedDocument.body
    })

    editorRef.current = editor
    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(mergeMarkdownDocument(parsedDocument.rawProperties, markdown))
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
    </div>
  )
}

type MarkdownProperty = {
  key: string
  value: string
  values: string[]
  type: "tags" | "date" | "link" | "text"
}

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
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  if (readonly) {
    return <span className={className}>{value || "空"}</span>
  }

  return (
    <input
      className={["markdown-property-input", className].filter(Boolean).join(" ")}
      value={draft}
      placeholder="空"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          onCommit(draft.trim())
          event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          setDraft(value)
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
