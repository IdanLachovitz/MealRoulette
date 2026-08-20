/**
 * Roulette draw logic — FR-2, FR-3, FR-5.2 and FR-6.
 *
 * The wheel is only an animation of a decision that has already been made here,
 * so none of this needs a browser to test.
 */
import type { Component, ComponentType, CookHistory, Dish, TimeFilter } from '../types'
import { lastCookedMap, passesTimeFilter } from './planner'
import { daysBetween } from './dates'
import type { Rng } from './rng'

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
 * Pick a winner at uniform weight from the whole eligible pool. The wheel shows
 * that same pool in full, so the number of slices always matches the library.
 */
export function draw<T extends Drawable>(pool: T[], rng: Rng): Draw<T> | null {
  if (pool.length === 0) return null
  return { winner: rng.pick(pool), slices: pool }
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
