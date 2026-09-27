/**
 * Turning an AI fridge suggestion (generate-dish + generate-recipe) into a
 * regular library dish. Pure — the caller saves the result.
 */
import { classifyIngredient, guessAisle } from './ingredient-art'
import { normaliseName } from './shopping'
import type { AiDish, AiRecipe } from '../sync/ai'
import type { Ingredient, Unit } from '../types'

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(ק"ג|ק״ג|קילו|קילוגרם)/, 'ק"ג'],
  [/^(גרם|גר'|גר׳|ג'|ג׳)/, 'גרם'],
  [/^(מ"ל|מ״ל|מיליליטר)/, 'מ"ל'],
  [/^(ליטר|ליטרים)/, 'ליטר'],
  [/^(כפיות|כפית)/, 'כפית'],
  [/^(כפות|כף)/, 'כף'],
  [/^(כוסות|כוס)/, 'כוס'],
  [/^(יחידות|יחידה|יח'|יח׳)/, "יח'"],
]

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

/**
 * "400 גרם", "1 ½ כוס", "1/2 כפית", "2-3 יחידות" → quantity + one of the
 * app's units. A range takes its low end. Anything else — "2 שיני", "חופן",
 * "לפי הטעם" — comes back with no unit, since a guessed unit would put the
 * wrong amount on the shopping list.
 */
export function parseAmount(text: string): { quantity: number | null; unit: Unit | null } {
  const match = text
    .trim()
    .match(/^(\d+\/\d+|\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔]|\d+\/\d+)?(?:\s*[-–]\s*[\d.,½¼¾/]+)?\s*(.*)$/)
  if (!match) return { quantity: null, unit: null }
  const [, whole, fraction, rest] = match
  const value = (token: string) => {
    if (FRACTIONS[token] != null) return FRACTIONS[token]
    const [num, den] = token.split('/').map((n) => Number(n.replace(',', '.')))
    return den === undefined ? num : den ? num / den : NaN
  }
  let quantity: number | null = whole ? value(whole) : null
  if (fraction) quantity = (quantity ?? 0) + value(fraction)
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return { quantity: null, unit: null }
  const unit = UNIT_WORDS.find(([re]) => re.test(rest.trim()))?.[1] ?? null
  return unit ? { quantity: Math.round(quantity * 100) / 100, unit } : { quantity: null, unit: null }
}

/** Salt, oil, water and spices don't scale with diners (FR-7.3). */
function isFixedAmount(name: string): boolean {
  return classifyIngredient(name) === 'spice' || /מלח|שמן|מים|פלפל שחור/.test(name)
}

/**
 * The recipe's ingredients as library ingredients. An amount the app can't
 * express in its units stays readable in the name — "שום (2 שיני)" — rather
 * than being dropped. The fridge items the dish was built around become its
 * main ingredients (at most two, the recipe's own order), so the saved dish
 * turns up in later fridge searches for them.
 */
export function aiRecipeIngredients(recipe: AiRecipe, fridgeItems: string[]): Ingredient[] {
  const fridge = fridgeItems.map(normaliseName).filter(Boolean)
  const onHand = (name: string) => {
    const n = normaliseName(name)
    return fridge.some((f) => n.includes(f) || f.includes(n))
  }

  let mains = 0
  const ingredients = recipe.ingredients.map(({ name, amount }): Ingredient => {
    const { quantity, unit } = parseAmount(amount)
    const main = mains < 2 && onHand(name)
    if (main) mains++
    return {
      name: unit || !amount ? name : `${name} (${amount})`,
      quantity,
      unit,
      is_scalable: !isFixedAmount(name),
      aisle: guessAisle(name),
      ...(main ? { is_main: true } : {}),
    }
  })
  // The model occasionally renames what it was given ("חזה עוף" for "עוף"
  // usually still matches, but not always) — a dish needs a main to be found.
  if (mains === 0 && ingredients.length > 0) ingredients[0] = { ...ingredients[0], is_main: true }
  return ingredients
}

/** The library dish fields that come from the suggestion; the caller adds id, household and so on. */
export function aiDishFields(dish: AiDish, recipe: AiRecipe, fridgeItems: string[]) {
  return {
    name: dish.name.trim(),
    prep_time_minutes: recipe.prep_time_minutes ?? 40,
    base_servings: recipe.servings,
    ingredients: aiRecipeIngredients(recipe, fridgeItems),
    recipe: { steps: recipe.steps, tips: recipe.tips },
  }
}
