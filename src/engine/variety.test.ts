import { describe, expect, it } from 'vitest'
import { leastRepetitive, similarity } from './variety'
import { planWeek } from './planner'
import { weekDates } from './dates'
import seedData from '../db/seed-data.json'
import { DEFAULT_SETTINGS } from '../types'
import type { Dish, Ingredient } from '../types'

function dish(name: string, ingredients: Partial<Ingredient>[] = [], id = name): Dish {
  return {
    id,
    household_id: 'h',
    updated_at: '',
    deleted_at: null,
    name,
    prep_time_minutes: 40,
    effort: 'בינוני',
    tags: [],
    base_servings: 2,
    fixed_servings: null,
    max_cover_days: 2,
    ingredients: ingredients.map((i) => ({
      name: '',
      quantity: null,
      unit: null,
      is_scalable: true,
      aisle: 'אחר',
      ...i,
    })),
    is_active: true,
    is_excluded: false,
    image_url: null,
    created_by: null,
  }
}

const main = (name: string): Partial<Ingredient> => ({ name, is_main: true })

describe('similarity', () => {
  it('sees two stuffed dishes as alike', () => {
    const mamulaim = dish('ממולאים', [main('אורז'), main('בשר טחון')])
    const cabbage = dish('כרוב ממולא', [main('כרוב'), main('בשר טחון')])
    expect(similarity(mamulaim, cabbage)).toBeGreaterThanOrEqual(2)
  })

  it('counts a shared main protein, loosely matched', () => {
    const kebab = dish('קבבים', [main('בשר טחון לקבב')])
    const lasagna = dish('לזניה', [main('דפי לזניה'), main('בשר טחון')])
    expect(similarity(kebab, lasagna)).toBe(1)
  })

  it('finds nothing in common between unrelated dishes', () => {
    const soup = dish('מרק עגבניות', [main('עגבניות')])
    const salmon = dish('סלמון בטריאקי עם אורז', [main('פילה סלמון'), main('אורז')])
    expect(similarity(soup, salmon)).toBe(0)
  })

  it('does not treat two unrecognised dishes as alike', () => {
    expect(similarity(dish('משהו'), dish('משהו אחר'))).toBe(0)
  })
})

describe('leastRepetitive', () => {
  it('keeps only the candidates least like the week', () => {
    const week = [dish('ממולאים', [main('בשר טחון')])]
    const cabbage = dish('כרוב ממולא', [main('בשר טחון')])
    const soup = dish('מרק עגבניות', [main('עגבניות')])
    expect(leastRepetitive([cabbage, soup], week)).toEqual([soup])
  })

  it('never empties the list', () => {
    const week = [dish('ממולאים')]
    const cabbage = dish('כרוב ממולא')
    expect(leastRepetitive([cabbage], week)).toEqual([cabbage])
  })
})

describe('planWeek — variety across the real starter library', () => {
  const library: Dish[] = (seedData as { dishes: { name: string; prep_time_minutes: number; max_cover_days: number; ingredients: Ingredient[] }[] }).dishes.map(
    (d, i) => ({ ...dish(d.name, [], `d${i}`), prep_time_minutes: d.prep_time_minutes, max_cover_days: d.max_cover_days, ingredients: d.ingredients }),
  )

  it('never puts two dishes of the same kind in one week', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const count of [3, 4, 5]) {
        const plan = planWeek({
          dates: weekDates('2026-09-27'),
          excludedDates: [],
          lockedSessions: [],
          dishes: library,
          history: [],
          params: { cook_days_count: count, include_leftovers: true, max_prep_time: null },
          settings: DEFAULT_SETTINGS,
          today: '2026-09-27',
          seed,
        })
        const picked = plan.sessions.map((s) => library.find((d) => d.id === s.dish_id)!)
        for (let a = 0; a < picked.length; a++) {
          for (let b = a + 1; b < picked.length; b++) {
            expect(similarity(picked[a], picked[b]), `seed ${seed}: ${picked[a].name} / ${picked[b].name}`).toBeLessThan(2)
          }
        }
      }
    }
  })
})
