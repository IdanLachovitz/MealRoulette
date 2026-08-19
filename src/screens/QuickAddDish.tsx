import { useState } from 'react'
import { db } from '../db/db'
import { save, saveMany } from '../db/repo'
import { blankComponent, blankDish } from '../db/seed'
import { Field } from '../components/ui'
import { useApp } from '../state'
import type { ComponentType } from '../types'
import { COMPONENT_LABEL } from '../types'

const NAME_MAX = 60

/**
 * FR-1.2 — name plus prep time is enough to save. Everything else can be filled in
 * later, or never. If adding a dish demanded a form, no dish would get added.
 */
export function QuickAddDish({
  householdId,
  onDone,
  defaultKind = 'dish',
}: {
  householdId: string
  onDone: () => void
  defaultKind?: 'dish' | ComponentType
}) {
  const { toast } = useApp()
  const [tab, setTab] = useState<'single' | 'bulk'>('single')
  const [kind, setKind] = useState<'dish' | ComponentType>(defaultKind)
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('40')
  const [bulk, setBulk] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const addOne = async () => {
    const trimmed = name.trim()
    if (!trimmed) return setError('צריך שם')
    if (trimmed.length > NAME_MAX) return setError(`עד ${NAME_MAX} תווים`)
    const prep = Number(minutes)
    if (!Number.isFinite(prep) || prep <= 0) return setError('זמן הכנה צריך להיות מספר')

    setBusy(true)
    try {
      if (kind === 'dish') {
        // EC / FR-1: dish names are unique inside a household.
        const clash = (await db.dishes.where('household_id').equals(householdId).toArray()).find(
          (d) => !d.deleted_at && d.name.trim() === trimmed,
        )
        if (clash) {
          setError('כבר יש מנה בשם הזה')
          return
        }
        await save('dishes', blankDish(householdId, trimmed, prep))
      } else {
        await save('components', blankComponent(householdId, trimmed, kind, prep))
      }
      toast(`"${trimmed}" נוסף למאגר`)
      setName('')
      setError(null)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  /** Bulk paste — one item per line, useful after a holiday or from a notes app. */
  const addBulk = async () => {
    const lines = [...new Set(bulk.split('\n').map((l) => l.trim()).filter(Boolean))]
    if (lines.length === 0) return setError('אין שורות להוספה')

    setBusy(true)
    try {
      const prep = Number(minutes) || 40
      if (kind === 'dish') {
        const existing = new Set(
          (await db.dishes.where('household_id').equals(householdId).toArray())
            .filter((d) => !d.deleted_at)
            .map((d) => d.name.trim()),
        )
        const rows = lines
          .filter((l) => !existing.has(l) && l.length <= NAME_MAX)
          .map((l) => blankDish(householdId, l, prep))
        if (rows.length) await saveMany('dishes', rows)
        toast(`נוספו ${rows.length} מנות`)
      } else {
        const rows = lines
          .filter((l) => l.length <= NAME_MAX)
          .map((l) => blankComponent(householdId, l, kind, prep))
        if (rows.length) await saveMany('components', rows)
        toast(`נוספו ${rows.length} רכיבים`)
      }
      setBulk('')
      setError(null)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className="segmented__btn" aria-pressed={tab === 'single'} onClick={() => setTab('single')}>
          פריט אחד
        </button>
        <button className="segmented__btn" aria-pressed={tab === 'bulk'} onClick={() => setTab('bulk')}>
          הדבקה מרובה
        </button>
      </div>

      <div className="field">
        <span className="label">סוג</span>
        <div className="chips">
          {(['dish', 'protein', 'carb', 'veg'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === 'dish' ? 'מנה מלאה' : COMPONENT_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'single' ? (
        <>
          <Field label="שם" error={error ?? undefined}>
            <input
              className="field__input"
              value={name}
              maxLength={NAME_MAX}
              autoFocus
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addOne()
              }}
              placeholder="לזניה"
            />
          </Field>
          <div className="counter">
            {name.length}/{NAME_MAX}
          </div>
        </>
      ) : (
        <Field
          label="שורה לכל פריט"
          hint="מדביקים רשימה, כל שורה הופכת לפריט. שורות כפולות מסוננות."
          error={error ?? undefined}
        >
          <textarea
            className="field__textarea"
            value={bulk}
            autoFocus
            onChange={(e) => {
              setBulk(e.target.value)
              setError(null)
            }}
            placeholder={'לזניה\nשקשוקה\nמרק עדשים'}
          />
        </Field>
      )}

      <Field label="זמן הכנה (דקות)" hint="אפשר לשנות אחר כך לכל פריט בנפרד.">
        <input
          className="field__input"
          type="number"
          inputMode="numeric"
          min={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </Field>

      <button
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={() => void (tab === 'single' ? addOne() : addBulk())}
      >
        {tab === 'single' ? 'שמירה' : 'הוספת הכל'}
      </button>
    </div>
  )
}
