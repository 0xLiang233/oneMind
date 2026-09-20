import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import "../styles/workbench-menu.css"

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  action?: string
  children?: ContextMenuItem[][]
  danger?: boolean
  ai?: boolean
  disabled?: boolean
  checked?: boolean
}

interface ContextMenuProps {
  id: string
  className?: string
  ariaLabel?: string
  trigger?: HTMLElement | null
  items: ContextMenuItem[][]
  x: number
  y: number
  onClose: () => void
  onAction: (action: string) => void
}

export function ContextMenu({ id, items, x, y, className, ariaLabel, trigger, onClose, onAction }: ContextMenuProps) {
  const owner = useId()
  const returnFocus = useRef<HTMLElement | null>(null)

  function restoreFocus() {
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
  }

  // Capture before the panel's passive focus effect, including in StrictMode.
  useLayoutEffect(() => {
    returnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    return () => {
      const active = document.activeElement
      if (active === document.body || active?.closest("[data-context-menu-owner]")?.getAttribute("data-context-menu-owner") === owner) {
        restoreFocus()
      }
    }
  }, [owner, trigger])

  useEffect(() => {
    function isInside(target: EventTarget | null) {
      return target instanceof Element && target.closest("[data-context-menu-owner]")?.getAttribute("data-context-menu-owner") === owner
    }
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && trigger?.contains(event.target)) return
      if (!isInside(event.target)) onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        restoreFocus()
        onClose()
      }
    }
    // pointerdown precedes the click/contextmenu that opens us: no deferred
    // listener (and therefore no orphaned setTimeout after rapid unmount).
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, owner, trigger])

  return (
    <MenuPanel
      key={`${x}:${y}`}
      id={id}
      owner={owner}
      className={className}
      ariaLabel={ariaLabel}
      trigger={trigger}
      items={items}
      x={x}
      y={y}
      focusOnOpen
      onClose={() => { restoreFocus(); onClose() }}
      onAction={(action) => {
        // Editor actions may need the original selection/focus, while dialogs
        // opened by an action must be allowed to retain their new focus.
        restoreFocus()
        onAction(action)
        onClose()
      }}
    />
  )
}

interface MenuPanelProps {
  id: string
  owner: string
  items: ContextMenuItem[][]
  x?: number
  y?: number
  anchor?: HTMLButtonElement
  trigger?: HTMLElement | null
  className?: string
  ariaLabel?: string
  focusOnOpen: boolean
  onClose: () => void
  onAction: (action: string) => void
  onBack?: () => void
}

function MenuPanel({ id, owner, items, x = 0, y = 0, anchor, trigger, className, ariaLabel, focusOnOpen, onClose, onAction, onBack }: MenuPanelProps) {
  const panel = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const search = useRef({ text: "", time: 0 })
  const groups = items.filter((group) => group.length > 0)
  const entries = groups.flat()
  const enabled = entries.flatMap((item, index) => item.disabled ? [] : [index])
  const [active, setActive] = useState(() => enabled.find((index) => entries[index].checked) ?? enabled[0] ?? -1)
  const [submenu, setSubmenu] = useState<{ index: number; focus: boolean; anchor: HTMLButtonElement } | null>(null)

  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    function position() {
      if (!element) return
      const margin = 8
      const width = window.innerWidth
      const height = window.innerHeight
      element.style.setProperty("--context-menu-available-height", `${Math.max(0, height - margin * 2)}px`)
      const rect = element.getBoundingClientRect()
      const origin = anchor?.getBoundingClientRect()
      let left = x
      let top = y
      if (origin) {
        const parent = anchor?.closest('[role="menu"]')?.getBoundingClientRect() ?? origin
        left = parent.right - 2
        if (left + rect.width > width - margin) left = parent.left - rect.width + 2
        top = origin.top - 6
      } else if (trigger) {
        // Root dropdown: below the trigger, with right edges aligned.
        // Submenu side placement intentionally uses a different anchor.
        const source = trigger.getBoundingClientRect()
        left = source.right - rect.width
        top = source.bottom + 6
        if (top + rect.height > height - margin && source.top - rect.height - 6 >= margin) {
          top = source.top - rect.height - 6
        }
      } else if (top + rect.height > height - margin && top - rect.height >= margin) {
        top -= rect.height
      }
      element.style.left = `${Math.max(margin, Math.min(left, width - rect.width - margin))}px`
      element.style.top = `${Math.max(margin, Math.min(top, height - rect.height - margin))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(element)
    if (trigger) observer.observe(trigger)
    window.addEventListener("resize", position)
    window.addEventListener("scroll", position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", position)
      window.removeEventListener("scroll", position, true)
    }
  }, [anchor, trigger, className, x, y])

  useEffect(() => {
    if (!focusOnOpen) return
    const available = buttons.current.filter((button) => button && button.getAttribute("aria-disabled") !== "true")
    const selected = available.find((button) => button?.getAttribute("aria-checked") === "true")
    const target = selected ?? available[0] ?? panel.current
    target?.focus({ preventScroll: true })
    selected?.scrollIntoView({ block: "nearest" })
  }, [focusOnOpen])

  function focusItem(index: number) {
    const button = buttons.current[index]
    if (!button) return
    setActive(index)
    button.focus({ preventScroll: true })
    button.scrollIntoView({ block: "nearest" })
  }

  function openSubmenu(index: number, focus: boolean) {
    const item = entries[index]
    if (!item || item.disabled || !item.children?.some((group) => group.length)) {
      setSubmenu(null)
      return
    }
    const trigger = buttons.current[index]
    if (trigger) setSubmenu((current) => current?.index === index && current.focus === focus ? current : { index, focus, anchor: trigger })
  }

  function activate(index: number) {
    const item = entries[index]
    if (!item || item.disabled) return
    if (item.children?.some((group) => group.length)) openSubmenu(index, true)
    else if (item.action) onAction(item.action)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Portaled children still bubble through the React tree, not the DOM tree.
    event.stopPropagation()
    const index = buttons.current.findIndex((button) => button === document.activeElement)
    const current = enabled.indexOf(index)
    const key = event.key
    if (key.length !== 1) search.current = { text: "", time: 0 }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault()
      setSubmenu(null)
      let next = key === "Home" ? 0 : key === "End" ? enabled.length - 1 : current + (key === "ArrowDown" ? 1 : -1)
      if (current < 0 && key === "ArrowUp") next = enabled.length - 1
      if (enabled.length) focusItem(enabled[(next + enabled.length) % enabled.length])
    } else if (key === "ArrowRight") {
      event.preventDefault()
      openSubmenu(index, true)
    } else if (key === "ArrowLeft" || key === "Escape") {
      event.preventDefault()
      if (submenu) setSubmenu(null)
      else if (onBack) onBack()
      else if (key === "Escape") onClose()
    } else if (key === "Tab") {
      // Restore the invoking control before native Tab/Shift+Tab advances.
      onClose()
    } else if (key === "Enter" || key === " ") {
      event.preventDefault()
      activate(index)
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      const now = event.timeStamp
      const text = (now - search.current.time < 700 ? search.current.text : "") + key.toLocaleLowerCase()
      search.current = { text, time: now }
      const prefix = [...text].every((letter) => letter === text[0]) ? text[0] : text
      const start = prefix.length === 1 ? current + 1 : Math.max(current, 0)
      const ordered = [...enabled.slice(start), ...enabled.slice(0, start)]
      const match = ordered.find((entry) => entries[entry].label.trim().toLocaleLowerCase().startsWith(prefix))
      if (match !== undefined) { setSubmenu(null); focusItem(match) }
    }
  }

  let entryIndex = 0
  const child = submenu && entries[submenu.index]
  return createPortal(
    <div
      ref={panel}
      id={id}
      className={`context-menu workbench-context-menu${className ? ` ${className}` : ""}`}
      data-context-menu-owner={owner}
      role="menu"
      aria-label={ariaLabel ?? (anchor ? undefined : "操作菜单")}
      aria-labelledby={anchor?.id}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onScroll={(event) => { if (event.target === panel.current) setSubmenu(null) }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} role="presentation">
          {groupIndex > 0 && <div className="workbench-context-menu-separator" role="separator" />}
          <div role="group">
            {group.map((item) => {
              const index = entryIndex++
              const hasChildren = Boolean(item.children?.some((children) => children.length))
              const expanded = submenu?.index === index
              return (
                <button
                  key={index}
                  ref={(element) => { buttons.current[index] = element }}
                  id={`${id}-item-${index}`}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  title={item.label}
                  className={`workbench-context-menu-item${item.danger ? " workbench-context-menu-item--danger" : ""}`}
                  tabIndex={active === index && !item.disabled ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  aria-haspopup={hasChildren ? "menu" : undefined}
                  aria-expanded={hasChildren ? expanded : undefined}
                  aria-controls={expanded ? `${id}-submenu-${index}` : undefined}
                  data-action={item.action}
                  onFocus={() => setActive(index)}
                  onPointerMove={(event) => {
                    if (event.pointerType === "touch" || item.disabled) return
                    if (document.activeElement !== event.currentTarget) focusItem(index)
                    openSubmenu(index, false)
                  }}
                  onClick={() => activate(index)}
                >
                  <span className="workbench-context-menu-icon" aria-hidden="true">{item.icon}</span>
                  <span className="workbench-context-menu-label">{item.label}</span>
                  {item.shortcut && <span className="workbench-context-menu-shortcut" aria-hidden="true">{item.shortcut}</span>}
                  {(hasChildren || item.checked !== undefined) && (
                    <span className="workbench-context-menu-trailing" aria-hidden="true">
                      {item.checked && <span className="workbench-context-menu-check">✓</span>}
                      {hasChildren && <span className="workbench-context-menu-chevron">›</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {submenu && child?.children && !child.disabled && (
        <MenuPanel
          key={submenu.index}
          id={`${id}-submenu-${submenu.index}`}
          owner={owner}
          items={child.children}
          anchor={submenu.anchor}
          focusOnOpen={submenu.focus}
          onClose={onClose}
          onAction={onAction}
          onBack={() => { focusItem(submenu.index); setSubmenu(null) }}
        />
      )}
    </div>,
    document.body
  )
}
