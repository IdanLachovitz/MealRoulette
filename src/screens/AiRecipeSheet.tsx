import { useEffect, useState } from 'react'
import { Sheet } from '../components/ui'
import { generateRecipeWithAi } from '../sync/ai'
import type { AiDish, AiRecipe } from '../sync/ai'
import type { Dish, DishRecipe } from '../types'
import { formatQuantity } from '../engine/shopping'
import { CookMode } from './CookMode'
import type { CookIngredient } from './CookMode'

/**
 * A library dish's ingredients for cooking mode, scaled to `servings` when
 * given (a cook covering 3 days makes 3 days' worth). Salt, oil and spices
 * (is_scalable = false) keep their amount, the same rule as the shopping
 * list's.
 */
export function cookIngredients(dish: Dish, servings?: number): CookIngredient[] {
  const factor = servings && dish.base_servings > 0 ? servings / dish.base_servings : 1
  return dish.ingredients.map((ing) => ({
    name: ing.name,
    amount:
      ing.quantity !== null && ing.unit
        ? formatQuantity(ing.is_scalable ? ing.quantity * factor : ing.quantity, ing.unit)
        : '',
  }))
}

/**
 * Recipes already fetched this session, keyed by the suggestion object itself
 * — closing and reopening the sheet shouldn't cost another AI round-trip, and
 * a new suggestion is a new object, so it never picks up a stale recipe.
 */
const recipeCache = new WeakMap<AiDish, AiRecipe>()
/** Requests in flight, so the sheet and the save button never ask twice at once. */
const pending = new WeakMap<AiDish, Promise<AiRecipe | null>>()

/** Seeds the cache with a recipe kept from an earlier visit, so it isn't fetched again. */
export function rememberRecipe(dish: AiDish, recipe: AiRecipe): void {
  recipeCache.set(dish, recipe)
}

/** The recipe for a suggestion — from this session's cache, or fetched once. */
export function fetchRecipe(dish: AiDish, servings: number): Promise<AiRecipe | null> {
  const cached = recipeCache.get(dish)
  if (cached) return Promise.resolve(cached)
  let request = pending.get(dish)
  if (!request) {
    request = generateRecipeWithAi(dish, servings).then((result) => {
      pending.delete(dish)
      if (result) recipeCache.set(dish, result)
      return result
    })
    pending.set(dish, request)
  }
  return request
}

/** Numbered steps, then any tips — shared by the AI sheet and a saved dish's page. */
export function RecipeSteps({
  recipe,
  cook,
}: {
  recipe: DishRecipe
  /** When set, a "cooking mode" button opens the recipe step by step (see CookMode). */
  cook?: { title: string; ingredients: CookIngredient[] }
}) {
  const [cooking, setCooking] = useState(false)
  return (
    <>
      {cook && recipe.steps.length > 0 && (
        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 12 }}
          onClick={() => setCooking(true)}
        >
          מצב בישול, שלב אחרי שלב 👨‍🍳
        </button>
      )}
      {cooking && cook && (
        <CookMode
          title={cook.title}
          ingredients={cook.ingredients}
          steps={recipe.steps}
          tips={recipe.tips}
          onClose={() => setCooking(false)}
        />
      )}
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
              {tip} 💡
            </p>
          ))}
        </div>
      )}
    </>
  )
}

/** The full recipe behind an AI fridge suggestion: amounts, then numbered steps. */
export function AiRecipeSheet({
  dish,
  servings,
  saved,
  saving,
  onSave,
  onRecipe,
  onClose,
}: {
  dish: AiDish
  servings: number
  /** Already in the library under this name. */
  saved: boolean
  saving: boolean
  onSave: () => void
  /** Called once the recipe is on hand, so the caller can keep it. */
  onRecipe?: (recipe: AiRecipe) => void
  onClose: () => void
}) {
  const [recipe, setRecipe] = useState<AiRecipe | null>(() => recipeCache.get(dish) ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async () => {
    setLoading(true)
    setFailed(false)
    const result = await fetchRecipe(dish, servings)
    setLoading(false)
    if (result) {
      setRecipe(result)
      onRecipe?.(result)
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
          <RecipeSteps recipe={recipe} cook={{ title: dish.name, ingredients: recipe.ingredients }} />

          <p className="field__hint" style={{ marginTop: 12 }}>
            מתכון שנכתב ע״י AI — כדאי לסמוך על הטעם והעין שלך בדרך.
          </p>

          <SaveToLibraryButton saved={saved} saving={saving} onSave={onSave} />
        </>
      ) : failed ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            לא הצלחתי להביא את המתכון כרגע — אולי אין רשת, או שהתכונה עוד לא מוגדרת.
          </p>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => void load()}>
            לנסות שוב 🔄
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

/** Saves the suggestion, recipe included, as a regular library dish. */
export function SaveToLibraryButton({
  saved,
  saving,
  onSave,
  block = true,
}: {
  saved: boolean
  saving: boolean
  onSave: () => void
  block?: boolean
}) {
  return (
    <button
      type="button"
      className={`btn btn--primary${block ? ' btn--block' : ''}`}
      style={block ? { marginTop: 12 } : undefined}
      disabled={saved || saving}
      onClick={onSave}
    >
      {saved ? 'נשמר במאגר ✓' : saving ? 'שומר…' : 'שמירה במאגר 💾'}
    </button>
  )
}
