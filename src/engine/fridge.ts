/**
 * "What can I make with what's already in the fridge?" — matches the
 * household's dish library against a free-text list of things currently on
 * hand (leftovers, open ingredients, whatever). Pure and local.
 */
import { normaliseName } from './shopping'
import type { Dish } from '../types'

export interface FridgeMatch {
  dish: Dish
  covered: number
  total: number
  missing: string[]
}

const FINAL_LETTERS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

/**
 * A rough Hebrew stem, enough to tell that two spellings name the same
 * thing: plural endings (ים / ות / יות), a trailing ה, the construct form's
 * י (תפוחי אדמה), a doubled yod (עגבנייה), and final letter forms all go,
 * so עגבניות, עגבניה and עגבנייה all come out as עגבנ. A trailing ת stays:
 * stripping it would make שמנת (cream) the same as שמן (oil).
 */
function stem(word: string): string {
  let w = word.replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c]).replace(/יי/g, 'י')
  const strip = (re: RegExp) => {
    const next = w.replace(re, '')
    if (next.length >= 2) w = next
  }
  strip(/(יות|ימ|ות)$/)
  strip(/ה$/)
  strip(/י$/)
  return w
}

const stems = (name: string) => name.split(' ').map(stem).filter(Boolean)

/**
 * Whether the fridge covers an ingredient. Word by word on stems, either
 * way round: "עגבניות" in the fridge covers "עגבניה", "עוף" covers "חזה
 * עוף", and "בצל סגול" covers a plain "בצל". The old substring test stays
 * as a fallback for names that run together differently.
 */
function haveIt(ingredientName: string, fridge: string[]): boolean {
  const name = normaliseName(ingredientName)
  if (!name) return false
  const nameStems = stems(name)
  const within = (inner: string[], outer: string[]) =>
    inner.length > 0 && inner.every((s) => outer.includes(s))
  return fridge.some((f) => {
    if (!f) return false
    if (name.includes(f) || f.includes(name)) return true
    const fridgeStems = stems(f)
    return within(fridgeStems, nameStems) || within(nameStems, fridgeStems)
  })
}

/**
 * The shopping list's items split into what still has to be bought and what
 * the fridge already has, by the same loose match the dish suggestions use.
 * Rows typed in by hand move too: they used to stay put on the theory that
 * they were added on purpose, but a "חזה עוף" on the list while there's
 * חזה עוף in the fridge reads as the feature not working.
 */
export function splitByFridge<T extends { name: string }>(
  items: T[],
  fridgeItemNames: string[],
): { toBuy: T[]; atHome: T[] } {
  const fridge = fridgeItemNames.map(normaliseName).filter(Boolean)
  const toBuy: T[] = []
  const atHome: T[] = []
  for (const item of items) {
    if (haveIt(item.name, fridge)) atHome.push(item)
    else toBuy.push(item)
  }
  return { toBuy, atHome }
}

/**
 * Ranks active dishes by how much of their ingredient list is already on
 * hand. Only a dish whose *main* ingredient (Ingredient.is_main) is in the
 * fridge counts — having the onion for a salmon dish isn't a reason to
 * suggest it. A dish with no mains marked never matches. Sorted by coverage
 * fraction first (100% — "you can make this right now" — floats to the top
 * regardless of how long the ingredient list is), then by raw count.
 */
export function matchDishesToFridge(dishes: Dish[], fridgeItemNames: string[]): FridgeMatch[] {
  const fridge = fridgeItemNames.map(normaliseName).filter(Boolean)
  if (fridge.length === 0) return []

  const matches: FridgeMatch[] = []
  for (const dish of dishes) {
    if (dish.deleted_at || !dish.is_active || dish.is_excluded) continue
    if (!dish.ingredients.some((ing) => ing.is_main && haveIt(ing.name, fridge))) continue

    const missing: string[] = []
    let covered = 0
    for (const ing of dish.ingredients) {
      if (haveIt(ing.name, fridge)) covered++
      else missing.push(ing.name)
    }
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
