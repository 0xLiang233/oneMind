import { Crepe } from "@milkdown/crepe"
import "@milkdown/crepe/theme/classic.css"
import { useEffect, useRef } from "react"

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  readonly?: boolean
}

export function MarkdownEditor({ value, onChange, readonly = false }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Crepe | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let disposed = false
    const crepe = new Crepe({
      root,
      defaultValue: value
    })

    editorRef.current = crepe
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    void crepe.create().then(() => {
      if (disposed) return
      crepe.setReadonly(readonly)
    })

    return () => {
      disposed = true
      editorRef.current = null
      void crepe.destroy()
    }
  }, [])

  useEffect(() => {
    editorRef.current?.setReadonly(readonly)
  }, [readonly])

  return <div className="onemind-markdown-editor" ref={rootRef} />
}
