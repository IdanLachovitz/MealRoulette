import { describe, expect, it } from 'vitest'
import { aggregate, buildShoppingList, formatQuantity, targetServingsFor } from './shopping'
import type { Component, CookSession, Dish, Ingredient } from '../types'

function ing(overrides: Partial<Ingredient> = {}): Ingredient {
  return { name: 'בצל', quantity: 1, unit: "יח'", is_scalable: true, aisle: 'ירקות', ...overrides }
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

function session(overrides: Partial<CookSession> = {}): CookSession {
  return {
    id: 's1',
    household_id: 'h',
    updated_at: '',
    deleted_at: null,
    week_plan_id: 'w1',
    cook_date: '2026-08-16',
    source_type: 'dish',
    dish_id: 'd1',
    protein_id: null,
    carb_id: null,
    veg_id: null,
    covers_days: 1,
    servings: 2,
    estimated_minutes: 40,
    is_locked: false,
    is_cooked: false,
    note: null,
    ...overrides,
  }
}

describe('targetServingsFor — FR-7.2', () => {
  it('multiplies diners by covered days', () => {
    expect(targetServingsFor({ covers_days: 3 }, 2, null)).toBe(6)
  })

  it('lets fixed_servings override the diner maths (FR-1.5 / EC-17)', () => {
    expect(targetServingsFor({ covers_days: 1 }, 1, 8)).toBe(8)
    expect(targetServingsFor({ covers_days: 3 }, 2, 8)).toBe(8)
  })
})

describe('buildShoppingList — scaling', () => {
  it('scales 500g for 2 servings up to 1.5kg when 6 servings are needed', () => {
    const d = dish({
      base_servings: 2,
      ingredients: [ing({ name: 'בשר', quantity: 500, unit: 'גרם', aisle: 'בשר ודגים' })],
    })
    const items = buildShoppingList({
      sessions: [session({ covers_days: 3 })],
      dishes: new Map([['d1', d]]),
      components: new Map(),
      diners: 2,
    })
    expect(items).toHaveLength(1)
    expect(items[0].quantity_text).toBe('1.5 ק"ג')
  })

  it('leaves non-scalable ingredients alone (FR-7.3)', () => {
    const d = dish({
      base_servings: 2,
      ingredients: [
        ing({ name: 'מלח', quantity: 1, unit: 'כפית', is_scalable: false, aisle: 'תבלינים' }),
      ],
    })
    const items = buildShoppingList({
      sessions: [session({ covers_days: 3 })],
      dishes: new Map([['d1', d]]),
      components: new Map(),
      diners: 2,
    })
    expect(items[0].quantity_text).toBe('1 כפית')
  })

  it('merges the same ingredient across two sessions (FR-7.4)', () => {
    const a = dish({ id: 'a', base_servings: 2, ingredients: [ing({ quantity: 1 })] })
    const b = dish({ id: 'b', base_servings: 2, ingredients: [ing({ quantity: 2 })] })
    const items = buildShoppingList({
      sessions: [
        session({ id: 's1', dish_id: 'a' }),
        session({ id: 's2', dish_id: 'b' }),
      ],
      dishes: new Map([
        ['a', a],
        ['b', b],
      ]),
      components: new Map(),
      diners: 2,
    })
    expect(items).toHaveLength(1)
    expect(items[0].quantity_text).toBe("3 יח'")
  })

  it('converts kg and g into one line', () => {
    const items = aggregate([
      {
        ingredient: ing({ name: 'חזה עוף', quantity: 500, unit: 'גרם', aisle: 'בשר ודגים' }),
        targetServings: 2,
        baseServings: 2,
      },
      {
        ingredient: ing({ name: 'חזה עוף', quantity: 1, unit: 'ק"ג', aisle: 'בשר ודגים' }),
        targetServings: 2,
        baseServings: 2,
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].quantity_text).toBe('1.5 ק"ג')
  })

  it('keeps non-convertible units on separate lines under the same name (EC-11)', () => {
    const items = aggregate([
      {
        ingredient: ing({ name: 'עגבניות', quantity: 3, unit: "יח'" }),
        targetServings: 2,
        baseServings: 2,
      },
      {
        ingredient: ing({ name: 'עגבניות', quantity: 400, unit: 'גרם' }),
        targetServings: 2,
        baseServings: 2,
      },
    ])
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.name === 'עגבניות')).toBe(true)
  })

  it('keeps an ingredient with no quantity without breaking aggregation (EC-9)', () => {
    const items = aggregate([
      {
        ingredient: ing({ name: 'פטרוזיליה', quantity: null, unit: null }),
        targetServings: 6,
        baseServings: 2,
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].quantity_text).toBe('')
  })

  it('sums the parts of a combo session', () => {
    const comp = (id: string, name: string): Component => ({
      id,
      household_id: 'h',
      updated_at: '',
      deleted_at: null,
      name,
      type: 'protein',
      prep_time_minutes: 25,
      base_servings: 2,
      ingredients: [ing({ name, quantity: 200, unit: 'גרם' })],
      is_active: true,
      is_excluded: false,
    })
    const items = buildShoppingList({
      sessions: [
        session({
          source_type: 'combo',
          dish_id: null,
          protein_id: 'p',
          carb_id: 'c',
          veg_id: null,
          covers_days: 2,
        }),
      ],
      dishes: new Map(),
      components: new Map([
        ['p', comp('p', 'חזה עוף')],
        ['c', comp('c', 'אורז')],
      ]),
      diners: 2,
    })
    expect(items).toHaveLength(2)
    // 200g at base 2 scaled to 4 servings = 400g
    expect(items[0].quantity_text).toBe('400 גרם')
  })

  it('gives stable match keys so "bought" ticks survive a regeneration', () => {
    const first = aggregate([
      { ingredient: ing({ name: 'עגבניות' }), targetServings: 2, baseServings: 2 },
    ])
    const second = aggregate([
      { ingredient: ing({ name: ' עגבניות ' }), targetServings: 6, baseServings: 2 },
    ])
    expect(first[0].match_key).toBe(second[0].match_key)
  })
})

describe('formatQuantity', () => {
  it('promotes large gram and millilitre amounts to kg and litres', () => {
    expect(formatQuantity(1500, 'גרם')).toBe('1.5 ק"ג')
    expect(formatQuantity(900, 'גרם')).toBe('900 גרם')
    expect(formatQuantity(2000, 'מ"ל')).toBe('2 ליטר')
  })
})
