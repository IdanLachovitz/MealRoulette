/**
 * Roulette draw logic — FR-2, FR-3 and FR-3.9.
 *
 * The wheel is only an animation of a decision that has already been made here,
 * so none of this needs a browser to test.
 */
import type { Component, ComponentType, Dish } from '../types'
import { passesTimeFilter } from './planner'
import type { Rng } from './rng'

/** How many slices each ring can hold before it stops being readable. */
export const RING_CAPACITY: Record<ComponentType, number> = {
  protein: 6,
  carb: 6,
  // FR-3.9 — the inner ring is physically narrow. Past this it shows a rotating subset.
  veg: 4,
}

/** FR-2.5 — the single-dish wheel. */
export const DISH_WHEEL_CAPACITY = 12
export const DISH_LABEL_LIMIT = 10

export interface Drawable {
  id: string
  name: string
  prep_time_minutes: number
}

export function availableDishes(dishes: Dish[], maxPrepTime: number | null): Dish[] {
  return dishes.filter(
    (d) =>
      !d.deleted_at &&
      d.is_active &&
      !d.is_excluded &&
      passesTimeFilter(d.prep_time_minutes, maxPrepTime),
  )
}

export function availableComponents(
  components: Component[],
  type: ComponentType,
  maxPrepTime: number | null,
): Component[] {
  // FR-6.2 — in combo mode each ring is filtered on its own.
  return components.filter(
    (c) =>
      !c.deleted_at &&
      c.type === type &&
      c.is_active &&
      !c.is_excluded &&
      passesTimeFilter(c.prep_time_minutes, maxPrepTime),
  )
}

/**
 * Pick the winner from the *whole* eligible pool, then build the visible slice
 * list around it. The winner is always on the wheel, but a large library never
 * makes the wheel unreadable.
 */
export interface Draw<T extends Drawable> {
  winner: T
  slices: T[]
  /** True when the wheel is showing a subset rather than the full pool. */
  isSubset: boolean
}

export function draw<T extends Drawable>(pool: T[], capacity: number, rng: Rng): Draw<T> | null {
  if (pool.length === 0) return null
  const winner = rng.pick(pool)
  if (pool.length <= capacity) {
    return { winner, slices: pool, isSubset: false }
  }

  const others = shuffle(
    pool.filter((p) => p.id !== winner.id),
    rng,
  ).slice(0, capacity - 1)
  // Drop the winner into a random position so it is not always the first slice.
  const slices = [...others]
  slices.splice(rng.int(slices.length + 1), 0, winner)
  return { winner, slices, isSubset: true }
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
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
