/**
 * Shopping-list maths — FR-7. Pure, like the planner, so the scaling and
 * aggregation rules can be tested directly.
 */
import type { Aisle, Component, CookSession, Dish, Ingredient, Unit } from '../types'

export interface SourceLine {
  ingredient: Ingredient
  /** How many servings this session needs of this ingredient's parent item. */
  targetServings: number
  baseServings: number
}

export interface AggregatedItem {
  /** Stable identity across regenerations, so "bought" ticks survive. */
  match_key: string
  name: string
  quantity_text: string
  aisle: Aisle
}

/** FR-7.2 — how many servings one cook session has to produce. */
export function targetServingsFor(
  session: Pick<CookSession, 'covers_days'>,
  diners: number,
  fixedServings: number | null,
): number {
  if (fixedServings && fixedServings > 0) return fixedServings
  return Math.max(1, diners) * Math.max(1, session.covers_days)
}

/** Grams and millilitres are the canonical units we accumulate in. */
const CANONICAL: Partial<Record<Unit, { unit: Unit; factor: number }>> = {
  'ק"ג': { unit: 'גרם', factor: 1000 },
  ליטר: { unit: 'מ"ל', factor: 1000 },
}

function canonicalise(quantity: number, unit: Unit): { quantity: number; unit: Unit } {
  const conv = CANONICAL[unit]
  return conv ? { quantity: quantity * conv.factor, unit: conv.unit } : { quantity, unit }
}

export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function matchKey(name: string, unit: Unit | null): string {
  return `${normaliseName(name)}|${unit ?? ''}`
}

/** FR-7.5 — round up to something you can actually buy. */
export function roundForPurchase(quantity: number, unit: Unit): number {
  switch (unit) {
    case 'גרם':
      // Below 1kg round to the nearest 50g up; above, half-kilos.
      return quantity >= 1000
        ? Math.ceil(quantity / 500) * 500
        : Math.ceil(quantity / 50) * 50
    case 'מ"ל':
      return quantity >= 1000 ? Math.ceil(quantity / 500) * 500 : Math.ceil(quantity / 50) * 50
    case "יח'":
      return Math.ceil(quantity)
    default:
      return Math.round(quantity * 100) / 100
  }
}

/** Present grams as kg (and ml as litres) once they get large enough to read better. */
export function formatQuantity(quantity: number, unit: Unit): string {
  const trim = (n: number) => String(Number(n.toFixed(2)))
  if (unit === 'גרם' && quantity >= 1000) return `${trim(quantity / 1000)} ק"ג`
  if (unit === 'מ"ל' && quantity >= 1000) return `${trim(quantity / 1000)} ליטר`
  return `${trim(quantity)} ${unit}`
}

/**
 * FR-7.4 — merge identical ingredients. Same name + convertible unit collapse into
 * one line; units that cannot be converted stay as separate lines under the same name.
 * EC-9: an ingredient with no quantity still appears, and does not break the maths.
 */
export function aggregate(lines: SourceLine[]): AggregatedItem[] {
  interface Bucket {
    name: string
    aisle: Aisle
    unit: Unit | null
    quantity: number
    hasQuantity: boolean
  }
  const buckets = new Map<string, Bucket>()

  for (const line of lines) {
    const { ingredient, targetServings, baseServings } = line
    const hasQuantity = ingredient.quantity != null && ingredient.unit != null

    let quantity = 0
    let unit: Unit | null = null
    if (hasQuantity) {
      const c = canonicalise(ingredient.quantity as number, ingredient.unit as Unit)
      unit = c.unit
      // FR-7.3 — salt and oil do not scale with the number of diners.
      const factor = ingredient.is_scalable ? targetServings / Math.max(1, baseServings) : 1
      quantity = c.quantity * factor
    }

    const key = matchKey(ingredient.name, unit)
    const existing = buckets.get(key)
    if (existing) {
      existing.quantity += quantity
      existing.hasQuantity = existing.hasQuantity || hasQuantity
    } else {
      buckets.set(key, {
        name: ingredient.name.trim(),
        aisle: ingredient.aisle,
        unit,
        quantity,
        hasQuantity,
      })
    }
  }

  return [...buckets.entries()].map(([key, b]) => ({
    match_key: key,
    name: b.name,
    aisle: b.aisle,
    quantity_text:
      b.hasQuantity && b.unit ? formatQuantity(roundForPurchase(b.quantity, b.unit), b.unit) : '',
  }))
}

export interface BuildListInput {
  sessions: CookSession[]
  dishes: Map<string, Dish>
  components: Map<string, Component>
  diners: number
}

/** FR-7.1 — derive the whole list from the active week's cook sessions. */
export function buildShoppingList(input: BuildListInput): AggregatedItem[] {
  const lines: SourceLine[] = []

  for (const session of input.sessions) {
    if (session.deleted_at) continue

    if (session.source_type === 'dish') {
      const dish = session.dish_id ? input.dishes.get(session.dish_id) : undefined
      if (!dish) continue
      const target = targetServingsFor(session, input.diners, dish.fixed_servings)
      for (const ing of dish.ingredients) {
        lines.push({ ingredient: ing, targetServings: target, baseServings: dish.base_servings })
      }
    } else {
      const ids = [session.protein_id, session.carb_id, session.veg_id]
      const target = targetServingsFor(session, input.diners, null)
      for (const id of ids) {
        const comp = id ? input.components.get(id) : undefined
        if (!comp) continue
        for (const ing of comp.ingredients) {
          lines.push({ ingredient: ing, targetServings: target, baseServings: comp.base_servings })
        }
      }
    }
  }

  return aggregate(lines)
}
