/**
 * How alike two dishes are, for keeping a week varied — so the planner
 * doesn't put ממולאים on Sunday and כרוב ממולא on Thursday just because
 * they're different library entries.
 *
 * Two signals, strongest first:
 * - the same kind of dish (classifyDish: stuffed, soup, pasta, patties, …);
 * - the same main protein (an is_main ingredient that is meat, poultry or
 *   fish — two dishes both built on ground beef).
 * Pure, like the rest of the engine.
 */
import { classifyDish } from './dish-art'
import { classifyIngredient } from './ingredient-art'
import { normaliseName } from './shopping'
import type { Dish } from '../types'

const SAME_KIND = 2
const SAME_PROTEIN = 1

type VarietyDish = Pick<Dish, 'name' | 'ingredients'>

function kindOf(dish: VarietyDish): string | null {
  const kind = classifyDish(dish.name, dish.ingredients.map((i) => i.name))
  // 'veg' is classifyDish's "nothing matched" fallback, not a real kind —
  // two unrecognised dishes aren't alike just because both are unknown.
  return kind === 'veg' ? null : kind
}

function mainProteins(dish: VarietyDish): string[] {
  return dish.ingredients
    .filter((i) => i.is_main && ['meat', 'poultry', 'fish'].includes(classifyIngredient(i.name, i.aisle)))
    .map((i) => normaliseName(i.name))
    .filter(Boolean)
}

/** 0 = nothing in common; higher = more alike. */
export function similarity(a: VarietyDish, b: VarietyDish): number {
  let score = 0
  const kind = kindOf(a)
  if (kind && kind === kindOf(b)) score += SAME_KIND
  const bProteins = mainProteins(b)
  // Loose, like the fridge matcher: "בשר טחון" and "בשר טחון לקבב" are the same meat.
  if (mainProteins(a).some((p) => bProteins.some((q) => p.includes(q) || q.includes(p)))) score += SAME_PROTEIN
  return score
}

/** How much a candidate repeats what the week already has — its worst overlap with any of them. */
export function repetition(candidate: VarietyDish, week: VarietyDish[]): number {
  return week.reduce((worst, d) => Math.max(worst, similarity(candidate, d)), 0)
}

/**
 * The candidates that repeat the week least — every one of them if none
 * repeats anything, or if they all repeat equally. Keeps the input order, so
 * a caller's own ordering (e.g. longest-uncooked first) still decides among them.
 */
export function leastRepetitive<T extends VarietyDish>(candidates: T[], week: VarietyDish[]): T[] {
  if (candidates.length <= 1 || week.length === 0) return candidates
  const scores = candidates.map((c) => repetition(c, week))
  const best = Math.min(...scores)
  return candidates.filter((_, i) => scores[i] === best)
}
