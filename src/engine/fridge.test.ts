import { describe, expect, it } from 'vitest'
import { matchDishesToFridge } from './fridge'
import type { Dish, Ingredient } from '../types'

function ing(name: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return { name, quantity: 1, unit: "יח'", is_scalable: true, aisle: 'ירקות', ...overrides }
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
    const full = dish({ id: 'full', ingredients: [ing('בצל'), ing('שום')] })
    const partial = dish({ id: 'partial', ingredients: [ing('בצל'), ing('עוף'), ing('אורז')] })
    const [first, second] = matchDishesToFridge([partial, full], ['בצל', 'שום'])
    expect(first.dish.id).toBe('full')
    expect(first.covered).toBe(2)
    expect(second.dish.id).toBe('partial')
    expect(second.covered).toBe(1)
    expect(second.missing).toEqual(['עוף', 'אורז'])
  })

  it('matches loosely, in both directions', () => {
    // Fridge has the specific variety, dish just calls for the general ingredient.
    const d1 = dish({ id: 'd1', ingredients: [ing('בצל')] })
    expect(matchDishesToFridge([d1], ['בצל סגול'])[0]?.covered).toBe(1)

    // Fridge has the general ingredient, dish calls for the specific cut.
    const d2 = dish({ id: 'd2', ingredients: [ing('חזה עוף בקוביות')] })
    expect(matchDishesToFridge([d2], ['עוף'])[0]?.covered).toBe(1)
  })

  it('drops dishes with zero overlap, an empty ingredient list, or an empty fridge', () => {
    const none = dish({ id: 'none', ingredients: [ing('סלמון')] })
    expect(matchDishesToFridge([none], ['בצל'])).toEqual([])

    const empty = dish({ id: 'empty', ingredients: [] })
    expect(matchDishesToFridge([empty], ['בצל'])).toEqual([])

    const some = dish({ id: 'some', ingredients: [ing('בצל')] })
    expect(matchDishesToFridge([some], [])).toEqual([])
  })

  it('skips inactive, excluded, and deleted dishes', () => {
    const inactive = dish({ id: 'a', is_active: false, ingredients: [ing('בצל')] })
    const excluded = dish({ id: 'b', is_excluded: true, ingredients: [ing('בצל')] })
    const deleted = dish({ id: 'c', deleted_at: '2026-01-01', ingredients: [ing('בצל')] })
    expect(matchDishesToFridge([inactive, excluded, deleted], ['בצל'])).toEqual([])
  })
})
