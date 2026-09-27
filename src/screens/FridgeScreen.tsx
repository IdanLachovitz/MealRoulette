import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { newId, now } from '../db/repo'
import { EmptyState, Field } from '../components/ui'
import { fullMatchesOnly, matchDishesToFridge } from '../engine/fridge'
import { generateDishWithAi } from '../sync/ai'
import type { AiDish } from '../sync/ai'
import { useApp } from '../state'
import { AiRecipeSheet } from './AiRecipeSheet'
import type { FridgeItem } from '../types'

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
  // No default: undefined while loading, so an empty library isn't mistaken
  // for "nothing matches" and doesn't fire the automatic AI request below.
  const dishes = useLiveQuery(
    () => db.dishes.where('household_id').equals(householdId).toArray(),
    [householdId],
  )

  const items = useMemo(
    () => [...(fridgeItems ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [fridgeItems],
  )

  const matches = useMemo(
    () => matchDishesToFridge(dishes ?? [], items.map((i) => i.name)),
    [dishes, items],
  )
  const fullMatches = useMemo(() => fullMatchesOnly(matches), [matches])
  // Every other dish built around something you have, with exactly what's
  // missing — so it reads as a shopping list, not just a "no".
  const partialMatches = useMemo(() => matches.filter((m) => m.covered < m.total), [matches])
  const noLibraryMatch = dishes !== undefined && items.length > 0 && matches.length === 0

  // A real recipe from Groq. Asked for automatically when nothing in the
  // library is built around what's in the fridge; otherwise opt-in, since it
  // costs a network round-trip.
  const itemsKey = items.map((i) => i.name).join('|')
  const latestItemsKey = useRef(itemsKey)
  latestItemsKey.current = itemsKey
  const [aiDish, setAiDish] = useState<AiDish | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const { settings } = useApp()

  useEffect(() => {
    setAiDish(null)
    setAiError(false)
    setAiLoading(false)
    setRecipeOpen(false)
  }, [itemsKey])

  const askAi = async (names: string[], key: string) => {
    setAiLoading(true)
    setAiError(false)
    const result = await generateDishWithAi(names)
    // The fridge changed while this was in flight — the answer is for a list
    // that no longer exists, and a newer request (if any) owns the state now.
    if (latestItemsKey.current !== key) return
    setAiLoading(false)
    if (result) setAiDish(result)
    else setAiError(true)
  }

  useEffect(() => {
    if (!noLibraryMatch) return
    // Short delay so adding several items in a row asks once, not per item.
    const names = items.map((i) => i.name)
    const timer = setTimeout(() => void askAi(names, itemsKey), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items is new on
    // every live-query tick; itemsKey is the stable stand-in for its contents.
  }, [noLibraryMatch, itemsKey])

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
          body="הוסף מה שיש לך עכשיו — שאריות, ירק פתוח, מה שבא ליד — ונציע לך מנות מהמאגר שאפשר להכין מזה."
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

          {noLibraryMatch ? (
            <p className="muted">
              אין במאגר מנה שהמרכיב העיקרי שלה נמצא אצלך
              {aiLoading ? ' — מבקש רעיון מה-AI…' : aiDish ? ' — הנה רעיון מה-AI:' : '.'}
            </p>
          ) : (
            <>
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
                  אין עדיין מנה מהמאגר שמכוסה לגמרי — אבל יש מנות שהמרכיב העיקרי שלהן אצלך, למטה.
                </p>
              )}
            </>
          )}

          {/* Built around something you have, but not fully covered —
              exactly what's missing, so it's a shopping list, not just a "no" */}
          {partialMatches.length > 0 && (
            <>
              <div className="label" style={{ marginBottom: 8, marginTop: 14 }}>
                יש לך את העיקר — חסר עוד
              </div>
              {partialMatches.map(({ dish, missing, covered, total }) => (
                <div key={dish.id} className="card" style={{ marginBottom: 8 }}>
                  <div className="row row--between">
                    <span style={{ fontWeight: 500 }}>{dish.name}</span>
                    <span className="label">
                      {covered}/{total} מרכיבים
                    </span>
                  </div>
                  <p className="field__hint" style={{ marginTop: 4 }}>חסר:</p>
                  <div className="tag-list" style={{ marginTop: 4 }}>
                    {missing.map((m) => (
                      <span key={m} className="chip" style={{ opacity: 0.8 }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Automatic when the library has nothing; otherwise still available —
              a good real recipe can be worth asking for anyway. */}
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
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--primary" onClick={() => setRecipeOpen(true)}>
                  📖 למתכון המלא
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={aiLoading}
                  onClick={() => void askAi(items.map((i) => i.name), itemsKey)}
                >
                  {aiLoading ? 'חושב…' : '🔄 מנה אחרת'}
                </button>
              </div>
            </div>
          )}
          {!aiDish && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={aiLoading}
              onClick={() => void askAi(items.map((i) => i.name), itemsKey)}
            >
              {aiLoading ? 'חושב…' : noLibraryMatch ? '🔄 לנסות שוב' : '💡 רעיון מה-AI'}
            </button>
          )}
          {aiError && (
            <p className="field__hint" style={{ marginTop: 4 }}>
              לא הצלחתי להתחבר ל-AI כרגע — אולי אין רשת, או שהתכונה עוד לא מוגדרת.
            </p>
          )}
        </>
      )}

      {recipeOpen && aiDish && (
        <AiRecipeSheet
          dish={aiDish}
          servings={settings.default_diners}
          onClose={() => setRecipeOpen(false)}
        />
      )}
    </div>
  )
}
