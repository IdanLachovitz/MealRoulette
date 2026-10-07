import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import { backStack } from './backStack'
import type { TimeFilter } from '../types'

/**
 * Hands the phone's back button to this sheet or popup while it's open (see
 * backStack.ts). Registered once per mount, with the latest handler read
 * through a ref, since callers pass inline functions that change on every
 * render.
 */
function usePhoneBack(handler: () => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  }, [handler])
  useEffect(() => backStack().register(() => ref.current()), [])
}

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
  usePhoneBack(onClose)

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

  // Portaled to document.body — rendered inline, a fixed-position modal can
  // still end up trapped inside an ancestor's stacking context (e.g.
  // .tab-panel's `will-change` for its mount animation) and paint behind
  // the topbar/nav dock instead of above them. Escaping the component tree
  // entirely is what actually guarantees it stacks above everything.
  return createPortal(
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
    </div>,
    document.body,
  )
}

/** Drag the grip down past this and the sheet closes, same as tapping the ✕. */
const SHEET_CLOSE_THRESHOLD = 90

export function Sheet({
  title,
  onClose,
  onBack,
  children,
}: {
  title: string
  onClose: () => void
  /**
   * Set when this sheet is a later step of a flow (picked a dish, now
   * choosing how many days): shows a back button that returns to the
   * previous step, so a mis-tap doesn't mean closing and starting over.
   */
  onBack?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The phone's back button does what the in-app → does, or closes the
  // sheet when this is the first step.
  usePhoneBack(onBack ?? onClose)

  // Callers almost always pass an inline `onClose` (e.g. `() =>
  // setEditing(null)`), so its identity changes on every render of the
  // caller — including ones triggered by a keystroke inside this sheet
  // writing to the db and re-running a live query up the tree. Keeping
  // `onClose` out of the deps (via a ref) means the mount/unmount effect
  // below — which steals focus onto the sheet — only runs once, instead of
  // on every such render and yanking focus out of whatever input the user
  // is actively typing into.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [])

  /**
   * Pulling down from the top of the sheet closes it, while every touch
   * scrolls natively, with the browser's own momentum.
   *
   * Nothing here may stand between the finger and the browser's scrolling.
   * The first version drove scrolling by hand (touch-action: none, scrollTop
   * set on every pointermove), which had no momentum at all. The second
   * gave scrolling back but kept touch-action: pan-y and a non-passive
   * touchmove listener that could preventDefault, and on iPhone the scroll
   * still stopped dead when the finger lifted. So every listener is passive
   * now and the sheet has no touch-action of its own.
   *
   * Nothing needs blocking anyway: when the content is already at the top
   * and the finger moves down, there's nothing for the browser to scroll,
   * so the sheet can simply follow the finger. overscroll-behavior: none
   * (theme.css) stops the browser's own bounce from playing at the same
   * time. The drag writes the transform straight onto the element instead
   * of through React state, so dragging doesn't re-render the sheet's
   * content on every frame.
   */
  useEffect(() => {
    const sheet = ref.current
    if (!sheet) return
    let startY = 0
    let tracking = false
    let dragging = false
    let offset = 0

    const place = (y: number) => {
      offset = y
      sheet.style.transform = y ? `translateY(${y}px)` : ''
      sheet.style.opacity = y ? String(Math.max(0.5, 1 - y / 300)) : ''
    }
    const release = () => {
      if (dragging) {
        if (offset > SHEET_CLOSE_THRESHOLD) {
          onCloseRef.current()
        } else {
          sheet.style.transition = 'transform 0.2s ease, opacity 0.2s ease'
          place(0)
        }
      }
      tracking = false
      dragging = false
    }

    // Closing is only possible when nothing between the finger and the
    // sheet still has room to scroll up, so pulling down inside a scrolled
    // inner list (the dish picker's) scrolls that list back first.
    const atTop = (target: EventTarget | null) => {
      for (let el = target as HTMLElement | null; el && el !== sheet; el = el.parentElement) {
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return false
      }
      return sheet.scrollTop <= 0
    }

    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1 && atTop(e.target)
      dragging = false
      if (tracking) startY = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const dy = e.touches[0].clientY - startY
      if (!dragging) {
        // A first move upward is an ordinary scroll; leave it alone.
        if (dy < 0) {
          tracking = false
          return
        }
        if (dy < 4) return
        dragging = true
        sheet.style.transition = 'none'
      }
      place(Math.max(0, dy))
    }

    const passive = { passive: true }
    sheet.addEventListener('touchstart', onStart, passive)
    sheet.addEventListener('touchmove', onMove, passive)
    sheet.addEventListener('touchend', release, passive)
    sheet.addEventListener('touchcancel', release, passive)
    return () => {
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', release)
      sheet.removeEventListener('touchcancel', release)
    }
  }, [])

  /**
   * With a mouse there's no touch gesture, so the grip strip is the drag
   * handle (wheel scrolling is native). The pointer is only captured once a
   * drag is under way: capturing on pointerdown would retarget a plain
   * click's pointerup and break the buttons inside.
   */
  const mouseDrag = useRef<{ startY: number; offset: number } | null>(null)
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    mouseDrag.current = { startY: e.clientY, offset: 0 }
  }
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mouseDrag.current
    const sheet = ref.current
    if (!drag || !sheet) return
    drag.offset = Math.max(0, e.clientY - drag.startY)
    if (drag.offset > 0) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Only keeps tracking when the cursor strays off the grip.
      }
    }
    sheet.style.transition = 'none'
    sheet.style.transform = drag.offset ? `translateY(${drag.offset}px)` : ''
  }
  const onGripUp = () => {
    const drag = mouseDrag.current
    const sheet = ref.current
    mouseDrag.current = null
    if (!drag || !sheet) return
    if (drag.offset > SHEET_CLOSE_THRESHOLD) return onClose()
    sheet.style.transition = 'transform 0.2s ease'
    sheet.style.transform = ''
  }

  // Portaled to document.body for the same reason as Modal above — rendered
  // inline inside a screen's .tab-panel, this fixed-position sheet was
  // getting trapped in that ancestor's stacking context (from its mount
  // animation's `will-change`) and painting behind the topbar/nav dock
  // instead of above them, cutting off the sheet's own bottom edge.
  return createPortal(
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
      >
        <div
          className="sheet__grip-area"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          <div className="sheet__grip" />
        </div>
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            {/* RTL: "back" points right, toward where the flow started. */}
            {onBack && (
              <button className="btn btn--ghost btn--icon btn--sm" onClick={onBack} aria-label="חזרה">
                →
              </button>
            )}
            <h2 className="sheet__title">{title}</h2>
          </div>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
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

export function Notice({
  children,
  warn,
  onDismiss,
}: {
  children: ReactNode
  warn?: boolean
  /** When set, the notice gets an ✕ that hides it. */
  onDismiss?: () => void
}) {
  return (
    <div className={warn ? 'notice notice--warn' : 'notice'} role="status">
      <Icon name={warn ? 'warning' : 'info'} size={17} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && (
        <button type="button" className="notice__close" onClick={onDismiss} aria-label="הסתרת ההודעה">
          ✕
        </button>
      )}
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
    // A fixed set of four options that must always read as one row — see
    // .chips--fit — rather than the default scrolling `.chips`, which let
    // the last chip run past the edge on a narrow phone.
    <div className="chips chips--fit" role="group" aria-label="סינון לפי זמן הכנה">
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

/**
 * "How many days does this cook cover?" — one chip per day, up to the dish's
 * max_cover_days and no further. The chips past the limit used to show up
 * greyed out, which read as "not right now" rather than "this dish doesn't
 * stretch that far"; now they simply aren't there, and the hint says why.
 */
export function CoverDaysChips({
  value,
  max,
  onChange,
  shortOne = false,
}: {
  value: number
  /** The dish's max_cover_days; 4 (the app-wide ceiling) for a combo. */
  max: number
  onChange: (days: number) => void
  /** "יום" instead of "יום אחד", where the row is tight. */
  shortOne?: boolean
}) {
  const limit = Math.min(4, Math.max(1, max))
  return (
    <>
      <div className="chips">
        {Array.from({ length: limit }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            {n === 1 ? (shortOne ? 'יום' : 'יום אחד') : `${n} ימים`}
          </button>
        ))}
      </div>
      {limit < 4 && (
        <span className="field__hint">
          {limit === 1
            ? 'המנה הזו מוגדרת כמספיקה ליום אחד.'
            : `המנה הזו מוגדרת כמספיקה לעד ${limit} ימים.`}{' '}
          אפשר לשנות במסך המנה.
        </span>
      )}
    </>
  )
}
