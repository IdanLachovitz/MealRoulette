import { useEffect, useState } from 'react'
import { Sheet } from '../components/ui'
import { useApp } from '../state'
import { dayName, dayOfMonth, weekDates } from '../engine/dates'
import { assignToDay, currentWeekStart, ensureWeekPlan, loadWeek } from '../services/week'
import type { SessionDraft } from '../services/week'
import type { CookSession, DaySlot, WeekPlan } from '../types'

export function AssignSheet({
  householdId,
  draft,
  title,
  onClose,
}: {
  householdId: string
  draft: SessionDraft
  title: string
  onClose: () => void
}) {
  const { settings, toast } = useApp()
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [days, setDays] = useState<DaySlot[]>([])
  const [sessions, setSessions] = useState<CookSession[]>([])
  const [covers, setCovers] = useState(1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const weekStart = currentWeekStart(settings)
      const p = await ensureWeekPlan(householdId, weekStart, settings)
      const loaded = await loadWeek(p.id)
      if (cancelled) return
      setPlan(p)
      setDays(loaded.days)
      setSessions(loaded.sessions)
    })()
    return () => {
      cancelled = true
    }
  }, [householdId, settings])

  const assign = async (date: string) => {
    if (!plan || saving) return
    setSaving(true)
    await assignToDay(householdId, plan, date, draft, settings, covers)
    toast(`שובץ ל${dayName(date)}`)
    onClose()
  }

  const dates = plan ? weekDates(plan.week_start_date) : []

  return (
    <Sheet title="שיבוץ ליום" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {title}
      </p>

      <div className="field">
        <span className="label">כמה ימים הבישול הזה מכסה?</span>
        <div className="chips">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={covers === n}
              onClick={() => setCovers(n)}
            >
              {n === 1 ? 'יום אחד' : `${n} ימים`}
            </button>
          ))}
        </div>
        <span className="field__hint">
          {covers === 1
            ? 'מבשלים ואוכלים באותו יום.'
            : `יום בישול + ${covers - 1} ימי שאריות.`}
        </span>
      </div>

      <div className="stack">
        {dates.map((date) => {
          const day = days.find((d) => d.date === date)
          const session = sessions.find((s) => s.cook_date === date)
          const isNone = day?.role === 'none'
          return (
            <button
              key={date}
              className="day"
              disabled={isNone || session?.is_locked || saving}
              onClick={() => void assign(date)}
            >
              <div className="day__date">
                <div className="day__dow">{dayName(date)}</div>
                <div className="day__num">{dayOfMonth(date)}</div>
              </div>
              <div className="day__body">
                <div className="day__title">
                  {isNone
                    ? 'לא מבשלים ביום הזה'
                    : session
                      ? session.is_locked
                        ? 'נעול'
                        : 'תופס — השיבוץ יחליף'
                      : 'פנוי'}
                </div>
              </div>
              {session?.is_locked && <span className="day__badge">🔒</span>}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
