import { useEffect, useState } from 'react'
import { Sheet } from '../components/ui'
import { generateRecipeWithAi } from '../sync/ai'
import type { AiDish, AiRecipe } from '../sync/ai'

/**
 * Recipes already fetched this session, keyed by the suggestion object itself
 * — closing and reopening the sheet shouldn't cost another AI round-trip, and
 * a new suggestion is a new object, so it never picks up a stale recipe.
 */
const recipeCache = new WeakMap<AiDish, AiRecipe>()

/** The full recipe behind an AI fridge suggestion: amounts, then numbered steps. */
export function AiRecipeSheet({
  dish,
  servings,
  onClose,
}: {
  dish: AiDish
  servings: number
  onClose: () => void
}) {
  const [recipe, setRecipe] = useState<AiRecipe | null>(() => recipeCache.get(dish) ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async () => {
    setLoading(true)
    setFailed(false)
    const result = await generateRecipeWithAi(dish, servings)
    setLoading(false)
    if (result) {
      recipeCache.set(dish, result)
      setRecipe(result)
    } else {
      setFailed(true)
    }
  }

  useEffect(() => {
    if (!recipe) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on open
  }, [])

  return (
    <Sheet title={dish.name} onClose={onClose}>
      {recipe ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            ל־{recipe.servings} סועדים
            {recipe.prep_time_minutes ? ` · כ־${recipe.prep_time_minutes} דק'` : ''}
          </p>

          <div className="label" style={{ marginBottom: 8 }}>
            מצרכים
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            {recipe.ingredients.map((ing, i) => (
              <div
                key={`${ing.name}-${i}`}
                className="row row--between"
                style={{
                  gap: 12,
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <span>{ing.name}</span>
                <span className="muted" style={{ textAlign: 'end' }}>
                  {ing.amount}
                </span>
              </div>
            ))}
          </div>

          <div className="label" style={{ marginBottom: 8 }}>
            אופן ההכנה
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recipe.steps.map((step, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
                <span
                  aria-hidden="true"
                  style={{
                    flex: '0 0 26px',
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--saf-tonal)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ lineHeight: 1.55, paddingTop: 2 }}>{step}</span>
              </li>
            ))}
          </ol>

          {recipe.tips.length > 0 && (
            <div className="card card--flat" style={{ marginTop: 4 }}>
              <div className="label" style={{ marginBottom: 6 }}>
                טיפים
              </div>
              {recipe.tips.map((tip, i) => (
                <p key={i} className="field__hint" style={{ margin: i === 0 ? 0 : '6px 0 0' }}>
                  💡 {tip}
                </p>
              ))}
            </div>
          )}

          <p className="field__hint" style={{ marginTop: 12 }}>
            מתכון שנכתב ע״י AI — כדאי לסמוך על הטעם והעין שלך בדרך.
          </p>
        </>
      ) : failed ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            לא הצלחתי להביא את המתכון כרגע — אולי אין רשת, או שהתכונה עוד לא מוגדרת.
          </p>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => void load()}>
            🔄 לנסות שוב
          </button>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          {loading ? 'כותב את המתכון המלא…' : ''}
        </p>
      )}
    </Sheet>
  )
}
