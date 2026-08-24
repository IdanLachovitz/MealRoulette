/**
 * "What can I make with what's already in the fridge?" — matches the
 * household's dish library against a free-text list of things currently on
 * hand (leftovers, open ingredients, whatever). Pure and local: no dish is
 * ever excluded for lacking a match, it's just ranked lower.
 */
import { classifyIngredient } from './ingredient-art'
import { normaliseName } from './shopping'
import type { Dish } from '../types'

export interface FridgeMatch {
  dish: Dish
  covered: number
  total: number
  missing: string[]
}

/**
 * Loose containment, same spirit as the ingredient-icon and shelf-guess
 * matchers: "עגבניות שרי" in the fridge should still cover a dish that calls
 * for "עגבניה", and vice versa.
 */
function haveIt(ingredientName: string, fridge: string[]): boolean {
  const name = normaliseName(ingredientName)
  if (!name) return false
  return fridge.some((f) => f && (name.includes(f) || f.includes(name)))
}

/**
 * Ranks active dishes by how much of their ingredient list is already on
 * hand. A dish with zero matches is dropped — with an empty or unrelated
 * fridge list there's nothing useful to say about it. Sorted by coverage
 * fraction first (100% — "you can make this right now" — floats to the top
 * regardless of how long the ingredient list is), then by raw count.
 */
export function matchDishesToFridge(dishes: Dish[], fridgeItemNames: string[]): FridgeMatch[] {
  const fridge = fridgeItemNames.map(normaliseName).filter(Boolean)
  if (fridge.length === 0) return []

  const matches: FridgeMatch[] = []
  for (const dish of dishes) {
    if (dish.deleted_at || !dish.is_active || dish.is_excluded) continue
    if (dish.ingredients.length === 0) continue

    const missing: string[] = []
    let covered = 0
    for (const ing of dish.ingredients) {
      if (haveIt(ing.name, fridge)) covered++
      else missing.push(ing.name)
    }
    if (covered === 0) continue
    matches.push({ dish, covered, total: dish.ingredients.length, missing })
  }

  return matches.sort((a, b) => {
    const fracDiff = b.covered / b.total - a.covered / a.total
    if (Math.abs(fracDiff) > 1e-9) return fracDiff
    return b.covered - a.covered
  })
}

/** Only dishes with nothing missing — "you can cook this right now, as-is". */
export function fullMatchesOnly(matches: FridgeMatch[]): FridgeMatch[] {
  return matches.filter((m) => m.covered === m.total)
}

export interface GeneratedDish {
  name: string
  ingredients: string[]
}

const PROTEIN_KINDS = new Set(['poultry', 'fish', 'meat', 'egg'])
const VEG_KINDS = new Set(['vegRound', 'vegLeaf'])
const CARB_KINDS = new Set(['grain', 'pasta', 'bread', 'legume'])

/** "X, Y ו-Z" — Hebrew's conjunction only goes on the last item. */
function hebrewList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ו${items[items.length - 1]}`
}

/**
 * When nothing in the library is a full match, improvise something from
 * exactly what's on hand — so by construction it has zero missing
 * ingredients. This is a simple templated combination, not a real recipe:
 * the UI must be clear it isn't a curated dish.
 */
export function generateDishFromFridge(fridgeItemNames: string[]): GeneratedDish | null {
  const names = fridgeItemNames.map((n) => n.trim()).filter(Boolean)
  if (names.length === 0) return null

  const proteins = names.filter((n) => PROTEIN_KINDS.has(classifyIngredient(n)))
  const vegs = names.filter((n) => VEG_KINDS.has(classifyIngredient(n)))
  const carbs = names.filter((n) => CARB_KINDS.has(classifyIngredient(n)))

  let name: string
  if (proteins.length && vegs.length) {
    name = `מוקפץ ${hebrewList(proteins)} עם ${hebrewList(vegs)}${carbs.length ? ' ו' + hebrewList(carbs) : ''}`
  } else if (vegs.length && !proteins.length) {
    name = `סלט ${hebrewList(vegs)}`
  } else if (proteins.length && carbs.length) {
    name = `${hebrewList(proteins)} עם ${hebrewList(carbs)}`
  } else {
    name = `אלתור מהמקרר: ${hebrewList(names)}`
  }

  return { name, ingredients: names }
}
