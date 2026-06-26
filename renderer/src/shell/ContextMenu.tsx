import { useEffect, useRef } from "react"

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  action?: string
  danger?: boolean
  ai?: boolean
  disabled?: boolean
}

interface ContextMenuProps {
  id: string
  items: ContextMenuItem[][]
  x: number
  y: number
  onClose: () => void
  onAction: (action: string) => void
}

export function ContextMenu({ id, items, x, y, onClose, onAction }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    setTimeout(() => {
      document.addEventListener("click", handleClick)
      document.addEventListener("keydown", handleKeyDown)
    }, 0)
    return () => {
      document.removeEventListener("click", handleClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  const style: React.CSSProperties = {}
  if (typeof x === "number" && typeof y === "number") {
    style.left = x + "px"
    style.top = y + "px"
  }

  return (
    <div ref={ref} className="context-menu" id={id} role="menu" style={style}>
      <div className="context-menu-scroll">
        {items.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="context-menu-separator" role="separator" />}
            <div className="context-menu-group">
              {group.map((item, ii) => {
                let cls = "context-menu-item"
                if (item.ai) cls += " context-menu-item--ai"
                if (item.danger) cls += " context-menu-item--danger"
                if (item.disabled) cls += " context-menu-item--disabled"
                return (
                  <div
                    key={ii}
                    className={cls}
                    role="menuitem"
                    data-action={item.action}
                    onClick={() => {
                      if (!item.disabled && item.action) {
                        onAction(item.action)
                        onClose()
                      }
                    }}
                  >
                    <span className="context-menu-item-icon">{item.icon}</span>
                    <span className="context-menu-item-label">{item.label}</span>
                    {item.shortcut && (
                      <span className="context-menu-item-shortcut">{item.shortcut}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
