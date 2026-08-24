import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { newId, now } from '../db/repo'
import { EmptyState, Field } from '../components/ui'
import { fullMatchesOnly, generateDishFromFridge, matchDishesToFridge } from '../engine/fridge'
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
  // Nothing in the library covers everything on hand — improvise something
  // from exactly what's there instead, so it never comes up short either.
  // (The AI button below stays available regardless of fullMatches — a
  // reservoir match doesn't mean you don't also want a fresh idea.)
  const generated = useMemo(
    () => (fullMatches.length === 0 ? generateDishFromFridge(items.map((i) => i.name)) : null),
    [fullMatches, items],
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
          ) : generated ? (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="row row--between">
                <span style={{ fontWeight: 500 }}>{generated.name}</span>
                <span className="label">לא מהמאגר</span>
              </div>
              <p className="field__hint" style={{ marginTop: 4 }}>
                אין עדיין מנה מהמאגר שמכוסה לגמרי — זה רעיון פשוט מהמצרכים שהזנת, לא מתכון קבוע.
              </p>
            </div>
          ) : (
            <p className="muted">אין עדיין מנה שמתאימה למה שיש לך — נסי להוסיף עוד פריט.</p>
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
            </div>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={aiLoading}
            onClick={() => void askAi()}
          >
            {aiLoading ? 'חושבת…' : '✨ בקשי רעיון עם מתכון אמיתי מ-AI'}
          </button>
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
