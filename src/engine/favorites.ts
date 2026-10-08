/**
 * ♥ dishes (Dish.is_favorite) come up more often, in the roulette and in the
 * planner alike. Its own module because both of those import it, and
 * roulette.ts already imports from planner.ts.
 */
import type { Rng } from './rng'

/** How much likelier a ♥ dish is to be drawn than any other. */
export const FAVORITE_WEIGHT = 3

/**
 * Pick one item, with ♥ dishes FAVORITE_WEIGHT times as likely. With no
 * favorite in the pool this is exactly rng.pick, same draws for the same
 * seed, so a library without favorites behaves as it always did.
 */
export function pickFavored<T>(items: readonly T[], rng: Rng): T {
  const weight = (item: T) => ((item as { is_favorite?: boolean | null }).is_favorite ? FAVORITE_WEIGHT : 1)
  if (!items.some((item) => weight(item) !== 1)) return rng.pick(items)
  let roll = rng.next() * items.reduce((sum, item) => sum + weight(item), 0)
  for (const item of items) {
    roll -= weight(item)
    if (roll < 0) return item
  }
  return items[items.length - 1]
}
