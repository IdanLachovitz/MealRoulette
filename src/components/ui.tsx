import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
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
        <div className="sheet__grip" />
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
