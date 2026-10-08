/**
 * Roulette draw logic — FR-2, FR-3, FR-5.2 and FR-6.
 *
 * The wheel is only an animation of a decision that has already been made here,
 * so none of this needs a browser to test.
 */
import type { Component, ComponentType, CookHistory, Dish, Ingredient, TimeFilter } from '../types'
import { lastCookedMap, passesTimeFilter } from './planner'
import { daysBetween } from './dates'
import type { Rng } from './rng'
import { pickFavored } from './favorites'

export interface Drawable {
  id: string
  name: string
  prep_time_minutes: number
}

/** FR-5.2 — how long an item stays off the wheel after it was cooked. */
export interface Cooldown {
  history: CookHistory[]
  /** Reference date, YYYY-MM-DD. */
  today: string
  days: number
}

function inCooldown(id: string, lastCooked: Map<string, string>, today: string, days: number) {
  const last = lastCooked.get(id)
  if (!last) return false
  return daysBetween(last, today) < days
}

/**
 * FR-5.2 / FR-5.3 — drop what is still cooling down, but never hand back an
 * empty wheel: if the cooldown would clear the pool completely, it is released
 * for this pool and the caller is told, exactly like the planner's relaxation.
 */
export function applyCooldown<T extends Drawable>(
  pool: T[],
  cooldown: Cooldown | null,
): { pool: T[]; relaxed: boolean } {
  if (!cooldown || cooldown.days <= 0 || pool.length === 0) return { pool, relaxed: false }
  const lastCooked = lastCookedMap(cooldown.history)
  const fresh = pool.filter((p) => !inCooldown(p.id, lastCooked, cooldown.today, cooldown.days))
  if (fresh.length === 0) return { pool, relaxed: true }
  return { pool: fresh, relaxed: false }
}

export function availableDishes(dishes: Dish[], filter: TimeFilter): Dish[] {
  return dishes.filter(
    (d) =>
      !d.deleted_at &&
      d.is_active &&
      !d.is_excluded &&
      passesTimeFilter(d.prep_time_minutes, filter),
  )
}

export function availableComponents(
  components: Component[],
  type: ComponentType,
  filter: TimeFilter,
): Component[] {
  // FR-6.2 — in combo mode each ring is filtered on its own.
  return components.filter(
    (c) =>
      !c.deleted_at &&
      c.type === type &&
      c.is_active &&
      !c.is_excluded &&
      passesTimeFilter(c.prep_time_minutes, filter),
  )
}

export interface Draw<T extends Drawable> {
  winner: T
  /** Every eligible item, in pool order — the wheel is drawn from this. */
  slices: T[]
}

/**
 * Pick a winner from the whole eligible pool, ♥ dishes weighted up (see
 * engine/favorites.ts). The wheel shows that same pool in full, so the
 * number of slices always matches the library.
 */
export function draw<T extends Drawable>(pool: T[], rng: Rng): Draw<T> | null {
  if (pool.length === 0) return null
  return { winner: pickFavored(pool, rng), slices: pool }
}

/** FR-3.7 — a combo takes as long as its slowest part, not the sum. */
export function comboMinutes(parts: (Drawable | null | undefined)[]): number {
  const times = parts.filter(Boolean).map((p) => (p as Drawable).prep_time_minutes)
  return times.length ? Math.max(...times) : 0
}

export function comboLabel(parts: (Drawable | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .map((p) => (p as Drawable).name)
    .join(' + ')
}

/**
 * The ingredient list of a combo saved to the library as a regular dish.
 * Each component's amounts are written for its own base_servings, so they
 * are rescaled to the dish's `servings` first (salt and oil, not scalable,
 * stay as they are). An ingredient two parts share in the same unit (שום in
 * both the protein and the veg) becomes one line with the amounts added up.
 *
 * The protein's and the carb's first ingredient are marked is_main: that's
 * what the dish is built around, and what fridge matching looks for.
 */
export function comboIngredients(parts: Component[], servings: number): Ingredient[] {
  const merged: Ingredient[] = []
  for (const part of parts) {
    const factor = part.base_servings > 0 ? servings / part.base_servings : 1
    part.ingredients.forEach((ing, index) => {
      const quantity =
        ing.quantity !== null && ing.is_scalable
          ? Math.round(ing.quantity * factor * 100) / 100
          : ing.quantity
      const is_main = index === 0 && (part.type === 'protein' || part.type === 'carb')
      const same = merged.find((m) => m.name.trim() === ing.name.trim() && m.unit === ing.unit)
      if (same) {
        if (same.quantity !== null && quantity !== null)
          same.quantity = Math.round((same.quantity + quantity) * 100) / 100
        same.is_main = same.is_main || is_main
      } else {
        merged.push({ ...ing, quantity, is_main })
      }
    })
  }
  return merged
}
