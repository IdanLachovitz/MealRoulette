import { describe, expect, it } from 'vitest'
import { comboWeight, cuisinesOf, drawCombo } from './comboPairing'
import { comboIngredients } from './roulette'
import { makeRng } from './rng'
import seed from '../db/seed-data.json'
import type { Component, ComponentType, Ingredient } from '../types'

const ing = (name: string, extra: Partial<Ingredient> = {}): Ingredient => ({
  name,
  quantity: 1,
  unit: 'כוס',
  is_scalable: true,
  aisle: 'אחר',
  ...extra,
})

const comp = (name: string, type: ComponentType, ingredients: Ingredient[] = []): Component =>
  ({
    id: name,
    household_id: 'h',
    name,
    type,
    prep_time_minutes: 20,
    base_servings: 2,
    ingredients,
    is_active: true,
    is_excluded: false,
    updated_at: '',
    deleted_at: null,
  }) as Component

/** The starter library's components, as the app imports them. */
const seedComponents: Component[] = (seed.components as Partial<Component>[]).map((c) =>
  comp(c.name!, c.type as ComponentType, (c.ingredients ?? []) as Ingredient[]),
)
const byName = (name: string) => seedComponents.find((c) => c.name === name)!
const pools = {
  protein: seedComponents.filter((c) => c.type === 'protein'),
  carb: seedComponents.filter((c) => c.type === 'carb'),
  veg: seedComponents.filter((c) => c.type === 'veg'),
}

describe('cuisine tags', () => {
  it('reads the cuisine from the name or the ingredients', () => {
    expect([...cuisinesOf(comp('אטריות אורז', 'carb'))]).toEqual(['asian'])
    expect([...cuisinesOf(comp('סלט', 'veg', [ing('מוצרלה')]))]).toEqual(['italian'])
  })

  it('leaves plain components neutral', () => {
    expect(cuisinesOf(byName('חזה עוף')).size).toBe(0)
    expect(cuisinesOf(byName('אורז לבן')).size).toBe(0)
  })
})

describe('combo weight', () => {
  it('rules out a clash', () => {
    expect(comboWeight([byName('קבב'), byName('אטריות אורז')])).toBe(0)
    expect(comboWeight([byName('בשר טחון'), byName('קוסקוס'), byName('סלט בוראטה')])).toBe(0)
  })

  it('prefers a shared cuisine over a neutral pairing', () => {
    const same = comboWeight([byName('קבב'), byName('קוסקוס')])
    const neutral = comboWeight([byName('חזה עוף'), byName('קוסקוס')])
    expect(same).toBeGreaterThan(neutral)
    expect(neutral).toBeGreaterThan(0)
  })

  it('lets homestyle sit next to Italian and Middle Eastern', () => {
    expect(comboWeight([byName('שניצל'), byName('פסטה')])).toBeGreaterThan(0)
    expect(comboWeight([byName('שניצל'), byName('פתיתים')])).toBeGreaterThan(0)
  })
})

describe('drawCombo', () => {
  it('never draws a clashing combo from the starter library', () => {
    for (let s = 1; s <= 300; s++) {
      const picked = drawCombo(pools, ['protein', 'carb', 'veg'], {}, makeRng(s))!
      expect(comboWeight([picked.protein!, picked.carb!, picked.veg!])).toBeGreaterThan(0)
    }
  })

  it('still varies the result', () => {
    const names = new Set<string>()
    for (let s = 1; s <= 100; s++) {
      const picked = drawCombo(pools, ['protein', 'carb', 'veg'], {}, makeRng(s))!
      names.add(picked.protein!.name)
    }
    expect(names.size).toBeGreaterThan(5)
  })

  it('draws around a locked ring', () => {
    const fixed = { carb: byName('אטריות אורז') }
    for (let s = 1; s <= 100; s++) {
      const picked = drawCombo(pools, ['protein', 'veg'], fixed, makeRng(s))!
      expect(picked.carb).toBeUndefined()
      expect(comboWeight([fixed.carb, picked.protein!, picked.veg!])).toBeGreaterThan(0)
    }
  })

  it('falls back to a plain draw when everything clashes', () => {
    const picked = drawCombo(
      { veg: [byName('סלט בוראטה')] },
      ['veg'],
      { carb: byName('אטריות אורז') },
      makeRng(1),
    )
    expect(picked?.veg?.name).toBe('סלט בוראטה')
  })

  it('returns null when a target ring is empty', () => {
    expect(drawCombo({ protein: [] }, ['protein'], {}, makeRng(1))).toBeNull()
  })
})

describe('comboIngredients', () => {
  it('rescales to the servings, merges shared lines, and marks the mains', () => {
    const protein = comp('עוף', 'protein', [ing('חזה עוף', { quantity: 500, unit: 'גרם' }), ing('שום')])
    const carb = { ...comp('אורז', 'carb', [ing('אורז')]), base_servings: 4 }
    const veg = comp('ירק', 'veg', [ing('ברוקולי'), ing('שום'), ing('מלח', { is_scalable: false })])
    const result = comboIngredients([protein, carb, veg], 4)

    expect(result.find((i) => i.name === 'חזה עוף')).toMatchObject({ quantity: 1000, is_main: true })
    expect(result.find((i) => i.name === 'אורז')).toMatchObject({ quantity: 1, is_main: true })
    expect(result.find((i) => i.name === 'ברוקולי')?.is_main).toBe(false)
    expect(result.filter((i) => i.name === 'שום')).toEqual([expect.objectContaining({ quantity: 4 })])
    expect(result.find((i) => i.name === 'מלח')?.quantity).toBe(1)
  })
})
