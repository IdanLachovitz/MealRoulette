import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import type { TimeFilter } from '../types'

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      style={disabled ? { opacity: 0.4 } : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__dot" />
    </button>
  )
}

/**
 * A small centred dialog, as opposed to Sheet's full-width bottom sheet. Used
 * where the content is a single focused result rather than a form.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <button
          className="btn btn--ghost btn--icon btn--sm modal__close"
          onClick={onClose}
          aria-label="סגירה"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  )
}

/** Drag the grip down past this and the sheet closes, same as tapping the ✕. */
const SHEET_CLOSE_THRESHOLD = 90

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragStartY = useRef<number | null>(null)
  const startScrollTop = useRef(0)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  /**
   * Pulling down anywhere in the sheet closes it — not just the grip, and
   * without fighting the sheet's own scrolling. This can't be done by
   * waiting to see the drag's direction and calling preventDefault() once
   * a close-drag looks likely: on touch, by the time a few pixels of
   * movement have gone by, the browser has usually already committed the
   * gesture to native scrolling, and preventDefault() on a later event
   * can't undo that (this is exactly why the previous version worked with
   * a mouse — no competing native gesture — but not on a phone). .sheet
   * has touch-action: none for that reason: touch scrolling is disabled
   * there entirely, and both scrolling *and* the close-drag are driven
   * from here instead, so there's nothing left for the browser to race us
   * on. Wheel/keyboard scrolling are untouched — touch-action only governs
   * touch/pen panning.
   */
  const onSheetDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY
    startScrollTop.current = ref.current?.scrollTop ?? 0
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nice-to-have (keeps tracking if the pointer strays
      // outside the sheet) — its failure shouldn't sink the gesture.
    }
  }
  const onSheetMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartY.current == null || !ref.current) return
    const delta = e.clientY - dragStartY.current
    // Positive delta (finger/cursor moving down) shrinks scrollTop back
    // toward 0; negative delta (moving up) grows it — the same
    // relationship native touch scrolling has between finger and content.
    const wantScrollTop = startScrollTop.current - delta
    if (wantScrollTop > 0) {
      ref.current.scrollTop = wantScrollTop
      if (dragging) {
        setDragging(false)
        setDragY(0)
      }
      return
    }
    // Nothing left to scroll — from here, further downward motion closes
    // the sheet instead.
    ref.current.scrollTop = 0
    const overshoot = -wantScrollTop
    if (!dragging && overshoot < 6) return
    if (!dragging) setDragging(true)
    setDragY(overshoot)
  }
  const onSheetUp = () => {
    if (dragging) {
      if (dragY > SHEET_CLOSE_THRESHOLD) {
        onClose()
        return
      }
      setDragY(0)
      setDragging(false)
    }
    dragStartY.current = null
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onPointerDown={onSheetDown}
        onPointerMove={onSheetMove}
        onPointerUp={onSheetUp}
        onPointerCancel={onSheetUp}
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragging ? 'none' : undefined,
          opacity: dragY ? Math.max(0.5, 1 - dragY / 300) : undefined,
        }}
      >
        <div className="sheet__grip-area">
          <div className="sheet__grip" />
        </div>
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <h2 className="sheet__title">{title}</h2>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty__title">{title}</div>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  )
}

export function Notice({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'notice notice--warn' : 'notice'} role="status">
      <Icon name={warn ? 'warning' : 'info'} size={17} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

/** Prep-time filter chips — FR-6.1. */
/** FR-6.1 — הכל / עד 20 / עד 40 / מעל 40. */
export const TIME_FILTERS: { label: string; filter: TimeFilter }[] = [
  { label: 'הכל', filter: { max: null, min: null } },
  { label: "עד 20 דק'", filter: { max: 20, min: null } },
  { label: "עד 40 דק'", filter: { max: 40, min: null } },
  { label: "מעל 40 דק'", filter: { max: null, min: 40 } },
]

export function TimeFilterChips({
  value,
  onChange,
}: {
  value: TimeFilter
  onChange: (v: TimeFilter) => void
}) {
  return (
    <div className="chips" role="group" aria-label="סינון לפי זמן הכנה">
      {TIME_FILTERS.map((f) => (
        <button
          key={f.label}
          type="button"
          className="chip"
          aria-pressed={value.max === f.filter.max && value.min === f.filter.min}
          onClick={() => onChange(f.filter)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
