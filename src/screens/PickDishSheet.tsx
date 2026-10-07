import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive } from '../db/repo'
import { CoverDaysChips, Sheet, EmptyState } from '../components/ui'
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
  onBack,
  onAssigned,
}: {
  householdId: string
  plan: WeekPlan
  date: string
  settings: HouseholdSettings
  onClose: () => void
  /** Back from the dish list to whatever opened it (see Sheet's onBack). */
  onBack?: () => void
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

  // Back to the list, with the search kept, so a mis-tapped dish is one tap
  // away from the right one.
  const backToList = () => {
    setChosen(null)
    setCovers(1)
  }

  if (chosen) {
    return (
      <Sheet title="שיבוץ ידני" onClose={onClose} onBack={backToList}>
        <p className="muted" style={{ marginTop: 0 }}>
          {dayName(date)} {dayOfMonth(date)} · {chosen.name}
        </p>

        <div className="field">
          <span className="label">כמה ימים המנה הזו תכסה?</span>
          <CoverDaysChips value={covers} max={chosen.max_cover_days} onChange={setCovers} />
        </div>

        <div className="row">
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={backToList}>
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
    <Sheet title={`מה מבשלים ב${dayName(date)}?`} onClose={onClose} onBack={onBack}>
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
          body={search ? 'נסה שם אחר.' : 'אין עדיין מנות במאגר.'}
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
