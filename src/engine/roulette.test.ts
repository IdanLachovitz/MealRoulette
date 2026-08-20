import { describe, expect, it } from 'vitest'
import {
  applyCooldown,
  availableComponents,
  availableDishes,
  comboLabel,
  comboMinutes,
  draw,
} from './roulette'
import { passesTimeFilter } from './planner'
import { makeRng } from './rng'
import type { Component, CookHistory, Dish } from '../types'

const dish = (name: string, minutes: number, extra: Partial<Dish> = {}): Dish =>
  ({
    id: name,
    household_id: 'h',
    name,
    prep_time_minutes: minutes,
    effort: 'קל',
    tags: [],
    base_servings: 2,
    fixed_servings: null,
    max_cover_days: 1,
    ingredients: [],
    is_active: true,
    is_excluded: false,
    updated_at: '',
    deleted_at: null,
    ...extra,
  }) as unknown as Dish

const comp = (
  name: string,
  type: Component['type'],
  minutes: number,
  extra: Partial<Component> = {},
): Component =>
  ({
    id: name,
    household_id: 'h',
    name,
    type,
    prep_time_minutes: minutes,
    base_servings: 2,
    ingredients: [],
    is_active: true,
    is_excluded: false,
    updated_at: '',
    deleted_at: null,
    ...extra,
  }) as unknown as Component

const cooked = (id: string, on: string): CookHistory =>
  ({
    id: `${id}-${on}`,
    household_id: 'h',
    entity_type: 'protein',
    entity_id: id,
    cooked_on: on,
    updated_at: '',
    deleted_at: null,
  }) as unknown as CookHistory

// FR-6.1 — הכל / עד 20 / עד 40 / מעל 40
describe('time filter', () => {
  it('keeps everything with no bounds', () => {
    expect(passesTimeFilter(15, { max: null, min: null })).toBe(true)
    expect(passesTimeFilter(90, { max: null, min: null })).toBe(true)
  })

  it('treats "עד 40" as inclusive', () => {
    expect(passesTimeFilter(40, { max: 40, min: null })).toBe(true)
    expect(passesTimeFilter(41, { max: 40, min: null })).toBe(false)
  })

  it('treats "מעל 40" as exclusive, so 40 belongs to "עד 40" only', () => {
    expect(passesTimeFilter(40, { max: null, min: 40 })).toBe(false)
    expect(passesTimeFilter(41, { max: null, min: 40 })).toBe(true)
    expect(passesTimeFilter(20, { max: null, min: 40 })).toBe(false)
  })

  it('filters the dish pool by "מעל 40"', () => {
    const pool = [dish('סלט', 10), dish('שקשוקה', 40), dish('חמין', 180)]
    expect(availableDishes(pool, { max: null, min: 40 }).map((d) => d.name)).toEqual(['חמין'])
    expect(availableDishes(pool, { max: 40, min: null }).map((d) => d.name)).toEqual([
      'סלט',
      'שקשוקה',
    ])
  })

  it('filters each ring on its own (FR-6.2)', () => {
    const comps = [comp('עוף', 'protein', 60), comp('אורז', 'carb', 20), comp('סלט', 'veg', 5)]
    expect(availableComponents(comps, 'protein', { max: null, min: 40 })).toHaveLength(1)
    expect(availableComponents(comps, 'carb', { max: null, min: 40 })).toHaveLength(0)
  })
})

// FR-5.2 / FR-5.3
describe('component cooldown', () => {
  const pool = [comp('עוף', 'protein', 30), comp('דג', 'protein', 20), comp('טופו', 'protein', 15)]
  const today = '2026-08-20'

  it('drops a component cooked inside the cooldown window', () => {
    const { pool: fresh, relaxed } = applyCooldown(pool, {
      history: [cooked('עוף', '2026-08-18')],
      today,
      days: 5,
    })
    expect(fresh.map((c) => c.name)).toEqual(['דג', 'טופו'])
    expect(relaxed).toBe(false)
  })

  it('keeps a component whose cooldown has expired', () => {
    const { pool: fresh } = applyCooldown(pool, {
      history: [cooked('עוף', '2026-08-10')],
      today,
      days: 5,
    })
    expect(fresh).toHaveLength(3)
  })

  it('counts the boundary day as free — 5 days after cooking is allowed', () => {
    const { pool: fresh } = applyCooldown(pool, {
      history: [cooked('עוף', '2026-08-15')],
      today,
      days: 5,
    })
    expect(fresh.map((c) => c.name)).toContain('עוף')
  })

  it('releases the cooldown rather than leaving an empty ring (FR-5.3)', () => {
    const { pool: fresh, relaxed } = applyCooldown(pool, {
      history: [cooked('עוף', today), cooked('דג', today), cooked('טופו', today)],
      today,
      days: 5,
    })
    expect(fresh).toHaveLength(3)
    expect(relaxed).toBe(true)
  })

  it('does nothing when the cooldown is switched off', () => {
    const { pool: fresh } = applyCooldown(pool, {
      history: [cooked('עוף', today)],
      today,
      days: 0,
    })
    expect(fresh).toHaveLength(3)
  })
})

describe('draw', () => {
  it('puts every eligible item on the wheel', () => {
    const pool = Array.from({ length: 23 }, (_, i) => dish(`מנה ${i}`, 30))
    const result = draw(pool, makeRng(1))
    expect(result?.slices).toHaveLength(23)
  })

  it('always picks the winner from the pool that is shown', () => {
    const pool = Array.from({ length: 40 }, (_, i) => dish(`מנה ${i}`, 30))
    for (let seed = 0; seed < 25; seed++) {
      const result = draw(pool, makeRng(seed))!
      expect(result.slices.some((s) => s.id === result.winner.id)).toBe(true)
    }
  })

  it('can eventually reach every item in a large pool', () => {
    const pool = Array.from({ length: 12 }, (_, i) => dish(`מנה ${i}`, 30))
    const seen = new Set<string>()
    for (let seed = 0; seed < 500; seed++) seen.add(draw(pool, makeRng(seed))!.winner.id)
    expect(seen.size).toBe(12)
  })

  it('returns null for an empty pool', () => {
    expect(draw([], makeRng(1))).toBeNull()
  })
})

// FR-3.7 / FR-3.6
describe('combo result', () => {
  it('takes the longest part, not the sum', () => {
    expect(comboMinutes([dish('א', 25), dish('ב', 45), dish('ג', 20)])).toBe(45)
  })

  it('labels only the parts that exist', () => {
    expect(comboLabel([dish('חזה עוף', 25), dish('בורגול', 20), null])).toBe('חזה עוף + בורגול')
  })
})
