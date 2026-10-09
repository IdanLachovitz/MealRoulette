import { describe, expect, it } from 'vitest'
import { dailyReminders } from './reminders'
import type { Component, CookSession, Dish } from '../types'

const session = (extra: Partial<CookSession> = {}): CookSession => ({
  id: 's1',
  household_id: 'h',
  updated_at: '',
  deleted_at: null,
  week_plan_id: 'w',
  cook_date: '2026-10-11',
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
  covered_dates: null,
  ...extra,
})

const dishes = [
  { id: 'd1', name: 'שקשוקה' },
  { id: 'd2', name: 'פסטה' },
] as Dish[]
const components = [
  { id: 'p', name: 'חזה עוף' },
  { id: 'c', name: 'אורז' },
] as Component[]

// Local time, like the phone's clock.
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour)
}

describe('dailyReminders', () => {
  it('reminds at 18:00 local on a cook day, with the dish and its time', () => {
    const [r] = dailyReminders([session()], dishes, components, at('2026-10-09', 10))
    expect(r.fire_at).toBe(at('2026-10-11', 18).toISOString())
    expect(r.title).toBe('היום מבשלים 🍳')
    expect(r.body).toBe('שקשוקה · 40 דק׳')
    expect(r.tag).toBe('cook-2026-10-11')
  })

  it('folds two cookings on one day into one reminder', () => {
    const list = [session(), session({ id: 's2', dish_id: 'd2', estimated_minutes: 50 })]
    const reminders = dailyReminders(list, dishes, components, at('2026-10-09', 10))
    expect(reminders).toHaveLength(1)
    expect(reminders[0].body).toBe('שקשוקה ופסטה · שעה ו־30 דק׳')
  })

  it('names a roulette combo by its parts', () => {
    const combo = session({ source_type: 'combo', dish_id: null, protein_id: 'p', carb_id: 'c' })
    const [r] = dailyReminders([combo], dishes, components, at('2026-10-09', 10))
    expect(r.body).toBe('חזה עוף + אורז · 40 דק׳')
  })

  it('still reminds today before 18:00, but not after', () => {
    const today = session({ cook_date: '2026-10-09' })
    expect(dailyReminders([today], dishes, components, at('2026-10-09', 17))).toHaveLength(1)
    expect(dailyReminders([today], dishes, components, at('2026-10-09', 18))).toHaveLength(0)
  })

  it('skips cooked, deleted, past and too-far days', () => {
    const list = [
      session({ id: 'a', is_cooked: true }),
      session({ id: 'b', deleted_at: '2026-10-01' }),
      session({ id: 'c', cook_date: '2026-10-08' }),
      session({ id: 'd', cook_date: '2026-10-16' }),
    ]
    expect(dailyReminders(list, dishes, components, at('2026-10-09', 10))).toEqual([])
  })

  it('lists the days in date order', () => {
    const list = [session({ id: 'a', cook_date: '2026-10-13' }), session({ id: 'b', cook_date: '2026-10-10' })]
    const tags = dailyReminders(list, dishes, components, at('2026-10-09', 10)).map((r) => r.tag)
    expect(tags).toEqual(['cook-2026-10-10', 'cook-2026-10-13'])
  })
})
