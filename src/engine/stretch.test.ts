import { describe, expect, it } from 'vitest'
import { stretchSuggestion } from './stretch'
import type { CookSession, DaySlot, Dish } from '../types'

const session = (extra: Partial<CookSession> = {}): CookSession => ({
  id: 's1',
  household_id: 'h',
  updated_at: '',
  deleted_at: null,
  week_plan_id: 'w',
  cook_date: '2026-10-04',
  source_type: 'dish',
  dish_id: 'd1',
  protein_id: null,
  carb_id: null,
  veg_id: null,
  covers_days: 1,
  servings: 2,
  estimated_minutes: 30,
  is_locked: false,
  is_cooked: false,
  note: null,
  covered_dates: null,
  ...extra,
})

const dish = (maxCoverDays: number) => ({ id: 'd1', max_cover_days: maxCoverDays }) as Dish

const day = (date: string, role: DaySlot['role']): DaySlot => ({
  id: date,
  household_id: 'h',
  updated_at: '',
  deleted_at: null,
  week_plan_id: 'w',
  date,
  role,
  cook_session_id: null,
})

const week = (roles: Record<string, DaySlot['role']>) =>
  Object.entries(roles).map(([date, role]) => day(date, role))

describe('stretchSuggestion', () => {
  it('offers the empty next day when the dish keeps longer', () => {
    const days = week({ '2026-10-04': 'cook', '2026-10-05': 'empty' })
    expect(stretchSuggestion(session(), dish(2), days)).toMatchObject({
      date: '2026-10-05',
      coversDays: 2,
    })
  })

  it('looks past the days already covered', () => {
    const days = week({ '2026-10-04': 'cook', '2026-10-05': 'leftovers', '2026-10-06': 'empty' })
    expect(stretchSuggestion(session({ covers_days: 2 }), dish(3), days)?.date).toBe('2026-10-06')
  })

  it('stays quiet when the dish is already stretched as far as it goes', () => {
    const days = week({ '2026-10-04': 'cook', '2026-10-05': 'empty' })
    expect(stretchSuggestion(session(), dish(1), days)).toBeNull()
  })

  it('stays quiet when the next day is taken, not cooking, or outside the week', () => {
    const s = session()
    expect(stretchSuggestion(s, dish(2), week({ '2026-10-05': 'cook' }))).toBeNull()
    expect(stretchSuggestion(s, dish(2), week({ '2026-10-05': 'none' }))).toBeNull()
    expect(stretchSuggestion(s, dish(2), week({ '2026-10-04': 'cook' }))).toBeNull()
  })

  it('skips combos, cooked sessions and hand-placed leftovers', () => {
    const days = week({ '2026-10-05': 'empty' })
    expect(stretchSuggestion(session({ source_type: 'combo' }), dish(2), days)).toBeNull()
    expect(stretchSuggestion(session({ is_cooked: true }), dish(2), days)).toBeNull()
    expect(stretchSuggestion(session({ covered_dates: [] }), dish(2), days)).toBeNull()
  })
})
