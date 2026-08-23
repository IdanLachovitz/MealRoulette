import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { newId, now } from '../db/repo'
import { EmptyState, Field } from '../components/ui'
import { matchDishesToFridge } from '../engine/fridge'
import type { Dish, FridgeItem } from '../types'

/**
 * "What can I make with what I've got?" — a free-text list of whatever's
 * currently in the fridge (leftovers, an open bag of something, produce
 * that needs using), matched against the dish library. Local-only by
 * design (see FridgeItem) — no household_id filter surprises, no sync.
 */
export function FridgeScreen({ householdId }: { householdId: string }) {
  const [name, setName] = useState('')

  const fridgeItems = useLiveQuery(
    () => db.fridgeItems.where('household_id').equals(householdId).toArray(),
    [householdId],
    [] as FridgeItem[],
  )
  const dishes = useLiveQuery(
    () => db.dishes.where('household_id').equals(householdId).toArray(),
    [householdId],
    [] as Dish[],
  )

  const items = useMemo(
    () => [...(fridgeItems ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [fridgeItems],
  )

  const matches = useMemo(
    () => matchDishesToFridge(dishes ?? [], items.map((i) => i.name)),
    [dishes, items],
  )

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await db.fridgeItems.add({
      id: newId(),
      household_id: householdId,
      name: trimmed,
      created_at: now(),
    })
    setName('')
  }

  return (
    <div>
      <Field label="מה יש לך עכשיו?">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="field__input"
            value={name}
            placeholder="שאריות עוף, עגבניות, חצי בצל…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
          />
          <button className="btn btn--primary btn--icon" aria-label="הוספה למקרר" onClick={() => void add()}>
            ＋
          </button>
        </div>
      </Field>

      {items.length === 0 ? (
        <EmptyState
          icon="🧊"
          title="המקרר ריק"
          body="הוסיפי מה שיש לך עכשיו — שאריות, ירק פתוח, מה שבא ליד — ונציע לך מנות מהמאגר שאפשר להכין מזה."
        />
      ) : (
        <>
          <div className="tag-list">
            {items.map((item) => (
              <span key={item.id} className="chip">
                {item.name}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`הסרת ${item.name}`}
                  onClick={() => void db.fridgeItems.delete(item.id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          <div className="label" style={{ marginBottom: 8 }}>
            אפשר להכין
          </div>
          {matches.length === 0 ? (
            <p className="muted">אין עדיין מנה שמתאימה למה שיש לך — נסי להוסיף עוד פריט.</p>
          ) : (
            matches.map(({ dish, covered, total, missing }) => (
              <div key={dish.id} className="card" style={{ marginBottom: 8 }}>
                <div className="row row--between">
                  <span style={{ fontWeight: 500 }}>{dish.name}</span>
                  <span className="label">
                    {covered}/{total} מרכיבים
                  </span>
                </div>
                {missing.length > 0 && (
                  <p className="field__hint" style={{ marginTop: 4 }}>
                    חסר: {missing.join(', ')}
                  </p>
                )}
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
