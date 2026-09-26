import { describe, expect, it } from 'vitest'
import { fullMatchesOnly, matchDishesToFridge } from './fridge'
import type { Dish, Ingredient } from '../types'

function ing(name: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return { name, quantity: 1, unit: "יח'", is_scalable: true, aisle: 'ירקות', ...overrides }
}

function main(name: string): Ingredient {
  return ing(name, { is_main: true })
}

function dish(overrides: Partial<Dish> = {}): Dish {
  return {
    id: 'd1',
    household_id: 'h',
    updated_at: '',
    deleted_at: null,
    name: 'מנה',
    prep_time_minutes: 40,
    effort: 'בינוני',
    tags: [],
    base_servings: 2,
    fixed_servings: null,
    max_cover_days: 2,
    ingredients: [],
    is_active: true,
    is_excluded: false,
    image_url: null,
    created_by: null,
    ...overrides,
  }
}

describe('matchDishesToFridge', () => {
  it('ranks a fully-covered dish above a partially-covered one', () => {
    const full = dish({ id: 'full', ingredients: [main('בצל'), ing('שום')] })
    const partial = dish({ id: 'partial', ingredients: [main('בצל'), ing('עוף'), ing('אורז')] })
    const [first, second] = matchDishesToFridge([partial, full], ['בצל', 'שום'])
    expect(first.dish.id).toBe('full')
    expect(first.covered).toBe(2)
    expect(second.dish.id).toBe('partial')
    expect(second.covered).toBe(1)
    expect(second.missing).toEqual(['עוף', 'אורז'])
  })

  it('only suggests a dish when a main ingredient is on hand', () => {
    // The fridge covers the side ingredients but not the salmon the dish is built around.
    const salmon = dish({ id: 'salmon', ingredients: [main('פילה סלמון'), ing('בצל'), ing('שום')] })
    expect(matchDishesToFridge([salmon], ['בצל', 'שום'])).toEqual([])

    // One main of two is enough, and it keeps the full ingredient count.
    const rice = dish({ id: 'rice', ingredients: [main('בשר בקוביות'), main('אורז לבן'), ing('שעועית')] })
    const [match] = matchDishesToFridge([rice], ['אורז'])
    expect(match?.covered).toBe(1)
    expect(match?.missing).toEqual(['בשר בקוביות', 'שעועית'])
  })

  it('never matches a dish with no main ingredient marked', () => {
    const unmarked = dish({ id: 'unmarked', ingredients: [ing('בצל'), ing('שום')] })
    expect(matchDishesToFridge([unmarked], ['בצל', 'שום'])).toEqual([])
  })

  it('matches loosely, in both directions', () => {
    // Fridge has the specific variety, dish just calls for the general ingredient.
    const d1 = dish({ id: 'd1', ingredients: [main('בצל')] })
    expect(matchDishesToFridge([d1], ['בצל סגול'])[0]?.covered).toBe(1)

    // Fridge has the general ingredient, dish calls for the specific cut.
    const d2 = dish({ id: 'd2', ingredients: [main('חזה עוף בקוביות')] })
    expect(matchDishesToFridge([d2], ['עוף'])[0]?.covered).toBe(1)
  })

  it('drops dishes with zero overlap, an empty ingredient list, or an empty fridge', () => {
    const none = dish({ id: 'none', ingredients: [main('סלמון')] })
    expect(matchDishesToFridge([none], ['בצל'])).toEqual([])

    const empty = dish({ id: 'empty', ingredients: [] })
    expect(matchDishesToFridge([empty], ['בצל'])).toEqual([])

    const some = dish({ id: 'some', ingredients: [main('בצל')] })
    expect(matchDishesToFridge([some], [])).toEqual([])
  })

  it('skips inactive, excluded, and deleted dishes', () => {
    const inactive = dish({ id: 'a', is_active: false, ingredients: [main('בצל')] })
    const excluded = dish({ id: 'b', is_excluded: true, ingredients: [main('בצל')] })
    const deleted = dish({ id: 'c', deleted_at: '2026-01-01', ingredients: [main('בצל')] })
    expect(matchDishesToFridge([inactive, excluded, deleted], ['בצל'])).toEqual([])
  })
})

describe('fullMatchesOnly', () => {
  it('keeps only dishes with nothing missing', () => {
    const full = dish({ id: 'full', ingredients: [main('בצל'), ing('שום')] })
    const partial = dish({ id: 'partial', ingredients: [main('בצל'), ing('עוף')] })
    const kept = fullMatchesOnly(matchDishesToFridge([full, partial], ['בצל', 'שום']))
    expect(kept.map((m) => m.dish.id)).toEqual(['full'])
  })
})
