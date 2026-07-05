import { useEffect, useLayoutEffect, useRef, useState } from "react"

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  action?: string
  children?: ContextMenuItem[][]
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
  const [position, setPosition] = useState<{ x: number; y: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    function updatePosition() {
      const element = ref.current
      if (!element) return

      const margin = 8
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const availableHeight = Math.max(160, viewportHeight - margin * 2)
      const rect = element.getBoundingClientRect()
      const menuWidth = rect.width
      const menuHeight = Math.min(rect.height, availableHeight)

      const nextX = Math.min(
        Math.max(margin, x),
        Math.max(margin, viewportWidth - menuWidth - margin)
      )
      const shouldOpenUpward = y + menuHeight + margin > viewportHeight && y - menuHeight > margin
      const preferredY = shouldOpenUpward ? y - menuHeight : y
      const nextY = Math.min(
        Math.max(margin, preferredY),
        Math.max(margin, viewportHeight - menuHeight - margin)
      )

      setPosition({ x: nextX, y: nextY, maxHeight: availableHeight })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [items, x, y])

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

  const style = {
    left: `${position?.x ?? x}px`,
    top: `${position?.y ?? y}px`,
    "--context-menu-max-height": `${position?.maxHeight ?? 400}px`
  } as React.CSSProperties

  return (
    <div ref={ref} className="context-menu" id={id} role="menu" style={style}>
      <div className="context-menu-scroll">
        <ContextMenuGroups items={items} onAction={onAction} onClose={onClose} />
      </div>
    </div>
  )
}

function ContextMenuGroups({
  items,
  onAction,
  onClose
}: {
  items: ContextMenuItem[][]
  onAction: (action: string) => void
  onClose: () => void
}) {
  return (
    <>
      {items.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="context-menu-separator" role="separator" />}
          <div className="context-menu-group">
            {group.map((item, ii) => (
              <ContextMenuEntry
                key={ii}
                item={item}
                onAction={onAction}
                onClose={onClose}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function ContextMenuEntry({
  item,
  onAction,
  onClose
}: {
  item: ContextMenuItem
  onAction: (action: string) => void
  onClose: () => void
}) {
  const hasChildren = Boolean(item.children?.some((group) => group.length > 0))
  let cls = "context-menu-item"
  if (item.ai) cls += " context-menu-item--ai"
  if (item.danger) cls += " context-menu-item--danger"
  if (item.disabled) cls += " context-menu-item--disabled"
  if (hasChildren) cls += " context-menu-item--submenu"

  return (
    <div className="context-menu-submenu-wrap">
      <div
        className={cls}
        role={hasChildren ? "menuitem" : "menuitem"}
        aria-haspopup={hasChildren ? "menu" : undefined}
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
        {hasChildren && <span className="context-menu-submenu-indicator">›</span>}
      </div>
      {hasChildren && (
        <div className="context-menu context-menu-submenu" role="menu">
          <div className="context-menu-scroll">
            <ContextMenuGroups items={item.children ?? []} onAction={onAction} onClose={onClose} />
          </div>
        </div>
      )}
    </div>
  )
}
