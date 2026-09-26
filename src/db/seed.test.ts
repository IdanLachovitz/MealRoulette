// fake-indexeddb must be set up before db.ts's module-level `new MealDb()`
// runs — that's why this import comes before everything else.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { applySeedMains, blankDish } from './seed'
import seedData from './seed-data.json'
import type { Ingredient } from '../types'

const HOUSEHOLD_ID = 'house-1'
const RICE_DISH = 'אורז לבן עם קוביות בשר ושעועית ברוטב אדום'

const mains = (ingredients: Ingredient[]) =>
  ingredients.filter((ing) => ing.is_main).map((ing) => ing.name)

/** The dish as an earlier seed revision marked it — beans instead of rice. */
function staleRiceDish() {
  const seed = (seedData as { dishes: { name: string; ingredients: Ingredient[] }[] }).dishes.find(
    (d) => d.name === RICE_DISH,
  )!
  return {
    ...blankDish(HOUSEHOLD_ID, RICE_DISH, 60),
    ingredients: seed.ingredients.map(({ is_main: _, ...ing }) =>
      ing.name === 'בשר בקוביות' || ing.name === 'שעועית' ? { ...ing, is_main: true } : ing,
    ),
  }
}

describe('applySeedMains', () => {
  beforeEach(async () => {
    await db.dishes.clear()
    await db.meta.clear()
    await db.outbox.clear()
  })

  it('every seed dish has one or two mains', () => {
    for (const d of (seedData as { dishes: { ingredients: Ingredient[] }[] }).dishes) {
      expect(mains(d.ingredients).length).toBeGreaterThanOrEqual(1)
      expect(mains(d.ingredients).length).toBeLessThanOrEqual(2)
    }
  })

  it('replaces stale marks from an earlier seed revision with the current ones', async () => {
    const dish = staleRiceDish()
    await db.dishes.put(dish)

    expect(await applySeedMains(HOUSEHOLD_ID)).toBe(1)
    expect(mains((await db.dishes.get(dish.id))!.ingredients)).toEqual(['בשר בקוביות', 'אורז לבן'])
  })

  it('runs once per version, so marks changed by hand afterwards survive', async () => {
    const dish = staleRiceDish()
    await db.dishes.put(dish)
    await applySeedMains(HOUSEHOLD_ID)

    await db.dishes.put(dish) // the user sets the marks back by hand
    expect(await applySeedMains(HOUSEHOLD_ID)).toBe(0)
    expect(mains((await db.dishes.get(dish.id))!.ingredients)).toEqual(['בשר בקוביות', 'שעועית'])
  })
})
