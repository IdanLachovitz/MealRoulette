import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { newId, now } from '../db/repo'
import { EmptyState, Field } from '../components/ui'
import { fullMatchesOnly, matchDishesToFridge } from '../engine/fridge'
import { generateDishWithAi } from '../sync/ai'
import type { AiDish } from '../sync/ai'
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

  const fullMatches = useMemo(
    () => fullMatchesOnly(matchDishesToFridge(dishes ?? [], items.map((i) => i.name))),
    [dishes, items],
  )

  // A real recipe from Groq, opt-in (costs a network round-trip) and only
  // offered once the instant local guess above is the best we've got.
  const itemsKey = items.map((i) => i.name).join('|')
  const [aiDish, setAiDish] = useState<AiDish | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)

  useEffect(() => {
    setAiDish(null)
    setAiError(false)
  }, [itemsKey])

  const askAi = async () => {
    setAiLoading(true)
    setAiError(false)
    const result = await generateDishWithAi(items.map((i) => i.name))
    setAiLoading(false)
    if (result) setAiDish(result)
    else setAiError(true)
  }

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
            אפשר להכין — בלי שום דבר חסר
          </div>
          {fullMatches.length > 0 ? (
            fullMatches.map(({ dish, total }) => (
              <div key={dish.id} className="card" style={{ marginBottom: 8 }}>
                <div className="row row--between">
                  <span style={{ fontWeight: 500 }}>{dish.name}</span>
                  <span className="label">{total} מרכיבים</span>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              אין עדיין מנה מהמאגר שמכוסה לגמרי — אפשר לבקש רעיון מה-AI למטה.
            </p>
          )}

          {/* Always available, even with a reservoir match — a good real
              recipe can still be worth asking for. */}
          {aiDish && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="row row--between">
                <span style={{ fontWeight: 500 }}>{aiDish.name}</span>
                <span className="label">AI · לא מהמאגר</span>
              </div>
              <p className="field__hint" style={{ marginTop: 4 }}>{aiDish.instructions}</p>
              {(() => {
                const fridgeNames = new Set(items.map((i) => i.name))
                const extras = aiDish.ingredients.filter((n) => !fridgeNames.has(n))
                return extras.length > 0 ? (
                  <div className="tag-list" style={{ marginTop: 8 }}>
                    {extras.map((n) => (
                      <span key={n} className="chip" style={{ opacity: 0.8 }}>
                        + {n}
                      </span>
                    ))}
                  </div>
                ) : null
              })()}
              <button
                type="button"
                className="btn btn--ghost"
                style={{ marginTop: 8 }}
                disabled={aiLoading}
                onClick={() => void askAi()}
              >
                {aiLoading ? 'חושבת…' : '🔄 מנה אחרת'}
              </button>
            </div>
          )}
          {!aiDish && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={aiLoading}
              onClick={() => void askAi()}
            >
              {aiLoading ? 'חושב' : '💡 רעיון מה-AI'}
            </button>
          )}
          {aiError && (
            <p className="field__hint" style={{ marginTop: 4 }}>
              לא הצלחתי להתחבר ל-AI כרגע — אולי אין רשת, או שהתכונה עוד לא מוגדרת.
            </p>
          )}
        </>
      )}
    </div>
  )
}
