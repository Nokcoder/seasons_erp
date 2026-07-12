import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const VIEWPORT_MARGIN = 8

export interface TooltipProps {
  /** Main tooltip text. Keep to a short sentence or two. */
  content: ReactNode
  /** Optional secondary line, rendered dimmer below `content` — for a caveat or extra detail. */
  note?: ReactNode
  /**
   * Trigger content. Should be non-interactive (text/icon) — the trigger renders as a
   * <button>, so nesting a link/input/button inside it is invalid HTML. If omitted, a
   * small info-circle icon is rendered as the trigger.
   */
  children?: ReactNode
  /** Accessible name for the trigger. Required (and otherwise only) used when `children` is omitted. */
  label?: string
  /** Preferred side; flips automatically if there isn't room. Default 'top'. */
  side?: 'top' | 'bottom'
  /** Underline the trigger to signal it's hoverable. Defaults to true when `children` is text-like. */
  underline?: boolean
  /** Extra classes on the trigger button. */
  className?: string
  /** Tooltip panel width in px. Default 224. */
  width?: number
}

/**
 * Shared hover/focus/tap tooltip. Renders the panel into a portal on `document.body` and
 * positions it with `position: fixed` from a measured trigger rect, so it can't be clipped by
 * a scrollable/overflow-hidden ancestor (e.g. a horizontally-scrolling table wrapper) the way
 * an absolutely-positioned in-flow panel can.
 */
export default function Tooltip({
  content,
  note,
  children,
  label,
  side = 'top',
  underline = children != null,
  className = '',
  width = 224,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [coords, setCoords] = useState({ top: -9999, left: -9999 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tooltipId = useId()

  const close = useCallback(() => { setOpen(false); setReady(false) }, [])

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    const t = trigger.getBoundingClientRect()
    const p = panel.getBoundingClientRect()

    let top: number
    if (side === 'top') {
      top = t.top - p.height - GAP
      if (top < VIEWPORT_MARGIN) top = t.bottom + GAP // flip to bottom if it wouldn't fit above
    } else {
      top = t.bottom + GAP
      if (top + p.height > window.innerHeight - VIEWPORT_MARGIN) top = t.top - p.height - GAP // flip to top
    }

    let left = t.left + t.width / 2 - p.width / 2
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - p.width - VIEWPORT_MARGIN)

    setCoords({ top, left })
  }, [side])

  // Measure-then-place: the panel must exist in the DOM to know its own height before we can
  // pick top-vs-bottom, so position is computed one frame after mount rather than up front.
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    setReady(true)
  }, [open, reposition, content, note])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, reposition, close])

  const isIcon = children == null
  const triggerClassName = [
    'bg-transparent border-0 p-0 m-0 font-inherit text-inherit text-left cursor-help',
    isIcon
      ? 'inline-flex items-center align-middle t-text-3 hover:t-text-1 focus-visible:t-text-1'
      : 'inline align-baseline',
    underline ? 'underline decoration-dotted decoration-[var(--tx-3)] underline-offset-2' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-describedby={open ? tooltipId : undefined}
        aria-label={isIcon ? label : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
      >
        {isIcon ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7.2v4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
          </svg>
        ) : children}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          id={tooltipId}
          role="tooltip"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width, opacity: ready ? 1 : 0 }}
          className="pointer-events-none z-[100] t-bg-elevated border t-border-strong rounded-md shadow-xl px-2.5 py-2 text-[10px] leading-relaxed transition-opacity duration-100"
        >
          <div className="t-text-1">{content}</div>
          {note != null && <div className="mt-1 t-text-3">{note}</div>}
        </div>,
        document.body,
      )}
    </>
  )
}
