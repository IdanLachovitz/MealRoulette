import { describe, expect, it } from 'vitest'
import { planWeek, spreadEvenly } from './planner'
import type { PlannerInput } from './planner'
import { weekDates } from './dates'
import { DEFAULT_SETTINGS } from '../types'
import type { CookHistory, Dish } from '../types'

const WEEK_START = '2026-08-16' // a Sunday
const DATES = weekDates(WEEK_START)

function dish(name: string, overrides: Partial<Dish> = {}): Dish {
  return {
    id: name,
    household_id: 'h',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    name,
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

function history(entityId: string, cookedOn: string): CookHistory {
  return {
    id: `${entityId}-${cookedOn}`,
    household_id: 'h',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    entity_type: 'dish',
    entity_id: entityId,
    cooked_on: cookedOn,
  }
}

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    dates: DATES,
    excludedDates: [],
    lockedSessions: [],
    dishes: Array.from({ length: 10 }, (_, i) => dish(`מנה ${i + 1}`)),
    history: [],
    params: { cook_days_count: 3, include_leftovers: true, max_prep_time: null },
    settings: DEFAULT_SETTINGS,
    today: WEEK_START,
    seed: 12345,
    ...overrides,
  }
}

describe('planWeek — FR-4 acceptance criteria', () => {
  it('creates exactly 3 sessions and covers the rest with leftovers', () => {
    const result = planWeek(input())
    expect(result.sessions).toHaveLength(3)
    const cook = result.days.filter((d) => d.role === 'cook')
    const leftovers = result.days.filter((d) => d.role === 'leftovers')
    expect(cook).toHaveLength(3)
    expect(leftovers.length).toBeGreaterThan(0)
    for (const day of leftovers) {
      expect(day.sessionIndex).not.toBeNull()
    }
  })

  it('with 5 cooks and no leftovers, makes 5 one-day sessions and leaves 2 days empty', () => {
    const result = planWeek(
      input({ params: { cook_days_count: 5, include_leftovers: false, max_prep_time: null } }),
    )
    expect(result.sessions).toHaveLength(5)
    expect(result.sessions.every((s) => s.covers_days === 1)).toBe(true)
    expect(result.days.filter((d) => d.role === 'empty')).toHaveLength(2)
  })

  it('keeps a locked session and only creates the remaining ones (FR-4.3)', () => {
    const result = planWeek(
      input({
        lockedSessions: [{ cook_date: DATES[0], covers_days: 1, dish_id: 'מנה 1' }],
      }),
    )
    expect(result.sessions).toHaveLength(3)
    expect(result.sessions.filter((s) => s.is_locked)).toHaveLength(1)
    const locked = result.sessions.find((s) => s.is_locked)!
    expect(locked.cook_date).toBe(DATES[0])
    expect(locked.dish_id).toBe('מנה 1')
    // The locked dish must not be drawn a second time (FR-5.5).
    expect(result.sessions.filter((s) => s.dish_id === 'מנה 1')).toHaveLength(1)
  })

  it('never schedules anything on a "not cooking" day and does not count it as missing', () => {
    const thursday = DATES[4]
    const result = planWeek(input({ excludedDates: [thursday] }))
    const day = result.days.find((d) => d.date === thursday)!
    expect(day.role).toBe('none')
    expect(day.sessionIndex).toBeNull()
    expect(result.sessions.some((s) => s.cook_date === thursday)).toBe(false)
  })

  it('caps the wizard at the number of free days (EC-15)', () => {
    const result = planWeek(
      input({
        excludedDates: DATES.slice(3),
        params: { cook_days_count: 5, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.sessions).toHaveLength(3)
    expect(result.notices.some((n) => n.code === 'coverage_reduced')).toBe(true)
  })
})

describe('planWeek — FR-5 cooldown, exclusion and repetition', () => {
  it('does not pick a dish cooked 3 days ago when the cooldown is 14', () => {
    const dishes = Array.from({ length: 10 }, (_, i) => dish(`מנה ${i + 1}`))
    const result = planWeek(
      input({ dishes, history: [history('מנה 1', '2026-08-13')] }),
    )
    expect(result.sessions.some((s) => s.dish_id === 'מנה 1')).toBe(false)
  })

  it('relaxes the cooldown rather than leaving a session empty, and says so', () => {
    // Every dish is inside its cooldown window, so relaxation is the only way through.
    const dishes = [dish('א'), dish('ב'), dish('ג')]
    const result = planWeek(
      input({
        dishes,
        history: [
          history('א', '2026-08-15'),
          history('ב', '2026-08-14'),
          history('ג', '2026-08-13'),
        ],
      }),
    )
    expect(result.sessions).toHaveLength(3)
    expect(result.notices.some((n) => n.code === 'cooldown_relaxed')).toBe(true)
  })

  it('relaxes from the oldest cook first', () => {
    const dishes = [dish('טרי'), dish('ישן')]
    const result = planWeek(
      input({
        dishes,
        history: [history('טרי', '2026-08-15'), history('ישן', '2026-08-05')],
        params: { cook_days_count: 1, include_leftovers: true, max_prep_time: null },
      }),
    )
    expect(result.sessions[0].dish_id).toBe('ישן')
  })

  it('never re-admits an excluded dish, even with nothing else available (FR-5.4)', () => {
    const result = planWeek(
      input({
        dishes: [dish('מוקפץ', { is_excluded: true })],
        params: { cook_days_count: 2, include_leftovers: true, max_prep_time: null },
      }),
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.notices.some((n) => n.code === 'empty_pool')).toBe(true)
  })

  it('does not repeat a dish within one week while alternatives exist (FR-5.5)', () => {
    const result = planWeek(input({ params: { cook_days_count: 5, include_leftovers: true, max_prep_time: null } }))
    const ids = result.sessions.map((s) => s.dish_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('repeats a dish only as a last resort, with a notice (FR-5.3)', () => {
    const result = planWeek(
      input({
        dishes: [dish('א'), dish('ב')],
        params: { cook_days_count: 3, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.sessions).toHaveLength(3)
    expect(result.notices.some((n) => n.code === 'repeated_dish')).toBe(true)
  })
})

describe('planWeek — coverage', () => {
  it('reduces coverage and notifies when no dish stretches far enough (EC-16)', () => {
    const dishes = Array.from({ length: 8 }, (_, i) => dish(`מנה ${i + 1}`, { max_cover_days: 1 }))
    const result = planWeek(
      input({ dishes, params: { cook_days_count: 2, include_leftovers: true, max_prep_time: null } }),
    )
    expect(result.sessions.every((s) => s.covers_days === 1)).toBe(true)
    expect(result.notices.some((n) => n.code === 'coverage_reduced')).toBe(true)
  })

  it('truncates coverage at the end of the week (EC-14)', () => {
    const result = planWeek(
      input({
        dishes: [dish('מרק', { max_cover_days: 4 })],
        lockedSessions: [{ cook_date: DATES[6], covers_days: 4, dish_id: 'מרק' }],
        params: { cook_days_count: 1, include_leftovers: true, max_prep_time: null },
      }),
    )
    const session = result.sessions[0]
    expect(session.covers_days).toBe(1)
    expect(result.notices.some((n) => n.code === 'truncated_at_week_end')).toBe(true)
  })

  it('applies the prep-time filter (FR-6.2)', () => {
    const dishes = [
      dish('מהיר', { prep_time_minutes: 15 }),
      dish('איטי', { prep_time_minutes: 90 }),
    ]
    const result = planWeek(
      input({
        dishes,
        params: { cook_days_count: 1, include_leftovers: true, max_prep_time: 20 },
      }),
    )
    expect(result.sessions[0].dish_id).toBe('מהיר')
  })
})

describe('planWeek — determinism', () => {
  it('returns the same plan for the same seed and different plans for different seeds', () => {
    const a = planWeek(input({ seed: 999 }))
    const b = planWeek(input({ seed: 999 }))
    expect(a.sessions).toEqual(b.sessions)

    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
      planWeek(input({ seed: s })).sessions.map((x) => x.dish_id).join(','),
    )
    expect(new Set(seeds).size).toBeGreaterThan(1)
  })
})

describe('spreadEvenly', () => {
  it('spaces cook days out instead of bunching them at the start', () => {
    const slots = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const picked = spreadEvenly(slots, 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
    const indices = picked.map((p) => slots.indexOf(p)).sort((x, y) => x - y)
    expect(indices[indices.length - 1] - indices[0]).toBeGreaterThanOrEqual(4)
  })

  it('never returns duplicates', () => {
    for (let count = 1; count <= 7; count++) {
      const picked = spreadEvenly(['a', 'b', 'c', 'd', 'e', 'f', 'g'], count)
      expect(new Set(picked).size).toBe(picked.length)
    }
  })
})
