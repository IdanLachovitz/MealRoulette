import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive } from '../db/repo'
import { Sheet, EmptyState } from '../components/ui'
import { dayName, dayOfMonth } from '../engine/dates'
import { assignToDay } from '../services/week'
import type { Dish, HouseholdSettings, WeekPlan } from '../types'

/**
 * Manually choosing a dish for a specific day, instead of only ever spinning
 * the wheel — the direct-pick path alongside the roulette (not a replacement
 * for it: "I already know what I'm making Tuesday" is a common, ordinary case
 * the wheel shouldn't stand in the way of).
 */
export function PickDishSheet({
  householdId,
  plan,
  date,
  settings,
  onClose,
  onAssigned,
}: {
  householdId: string
  plan: WeekPlan
  date: string
  settings: HouseholdSettings
  onClose: () => void
  onAssigned: (name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<Dish | null>(null)
  const [covers, setCovers] = useState(1)
  const [busy, setBusy] = useState(false)

  const dishes = useLiveQuery(
    async () => alive(await db.dishes.where('household_id').equals(householdId).toArray()),
    [householdId],
    [] as Dish[],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (dishes ?? [])
      .filter((d) => d.is_active && !d.is_excluded)
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [dishes, search])

  const assign = async () => {
    if (!chosen || busy) return
    setBusy(true)
    await assignToDay(
      householdId,
      plan,
      date,
      { source_type: 'dish', dish_id: chosen.id, minutes: chosen.prep_time_minutes },
      settings,
      covers,
    )
    onAssigned(chosen.name)
    onClose()
  }

  if (chosen) {
    return (
      <Sheet title="שיבוץ ידני" onClose={onClose}>
        <p className="muted" style={{ marginTop: 0 }}>
          {dayName(date)} {dayOfMonth(date)} · {chosen.name}
        </p>

        <div className="field">
          <span className="label">כמה ימים המנה הזו תכסה?</span>
          <div className="chips">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className="chip"
                aria-pressed={covers === n}
                disabled={n > Math.max(1, chosen.max_cover_days)}
                onClick={() => setCovers(n)}
              >
                {n === 1 ? 'יום אחד' : `${n} ימים`}
              </button>
            ))}
          </div>
          {chosen.max_cover_days < 4 && (
            <span className="field__hint">
              המנה הזו מוגדרת כמספיקה לעד {chosen.max_cover_days} ימים.
            </span>
          )}
        </div>

        <div className="row">
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setChosen(null)}>
            בחירה אחרת
          </button>
          <button
            className="btn btn--primary"
            style={{ flex: 2 }}
            disabled={busy}
            onClick={() => void assign()}
          >
            שיבוץ ל{dayName(date)}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={`מה מבשלים ב${dayName(date)}?`} onClose={onClose}>
      <input
        className="field__input"
        style={{ marginBottom: 12 }}
        type="search"
        autoFocus
        value={search}
        placeholder="חיפוש במאגר"
        onChange={(e) => setSearch(e.target.value)}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="🍲"
          title={search ? 'אין התאמות לחיפוש' : 'המאגר ריק'}
          body={search ? 'נסי שם אחר.' : 'אין עדיין מנות במאגר.'}
        />
      ) : (
        <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          {visible.map((dish) => (
            <button key={dish.id} className="list-row" onClick={() => setChosen(dish)}>
              <span className="list-row__name">{dish.name}</span>
              <span className="item__qty">{dish.prep_time_minutes} דק׳</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
