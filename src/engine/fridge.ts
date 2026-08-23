/**
 * "What can I make with what's already in the fridge?" — matches the
 * household's dish library against a free-text list of things currently on
 * hand (leftovers, open ingredients, whatever). Pure and local: no dish is
 * ever excluded for lacking a match, it's just ranked lower.
 */
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
