import { describe, expect, it } from 'vitest'
import { planWeek, spreadEvenly } from './planner'
import type { PlannerInput } from './planner'
import { addDays, weekDates } from './dates'
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

describe('planWeek — full-library rotation (no repeat until every dish has had a turn)', () => {
  // dish_cooldown_days: 0 isolates the cycle rule from the day-based cooldown
  // in every test below, so a pick only ever tells us about the cycle logic.
  const noCooldown = { ...DEFAULT_SETTINGS, dish_cooldown_days: 0 }

  it('keeps a dish resting until every other dish has had a more recent turn', () => {
    const dishes = [dish('א'), dish('ב'), dish('ג')]
    const result = planWeek(
      input({
        dishes,
        settings: noCooldown,
        // א is the oldest turn; both ב and ג have gone since — its lap is done.
        history: [history('א', '2026-08-01'), history('ב', '2026-08-05'), history('ג', '2026-08-10')],
        params: { cook_days_count: 1, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.sessions[0].dish_id).toBe('א')
  })

  it('does not offer a dish only one other dish has passed since (lap incomplete)', () => {
    const dishes = [dish('א'), dish('ב'), dish('ג')]
    const result = planWeek(
      input({
        dishes,
        settings: noCooldown,
        // ב has only been passed by ג, not by א — one turn short of a full lap.
        history: [history('א', '2026-08-01'), history('ב', '2026-08-05'), history('ג', '2026-08-10')],
        params: { cook_days_count: 1, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.sessions[0].dish_id).not.toBe('ב')
  })

  it('restarts the lap once every dish has had an equal turn, and says so distinctly', () => {
    const dishes = [dish('א'), dish('ב'), dish('ג')]
    const result = planWeek(
      input({
        dishes,
        settings: noCooldown,
        // All three landed in the same week — no dish has overtaken any other.
        history: [history('א', '2026-08-10'), history('ב', '2026-08-10'), history('ג', '2026-08-10')],
        params: { cook_days_count: 1, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.sessions).toHaveLength(1)
    expect(result.notices.some((n) => n.code === 'cycle_restarted')).toBe(true)
    // The day-based cooldown had options (it's off), so this must not also
    // read as the small-library "cooldown_relaxed" case.
    expect(result.notices.some((n) => n.code === 'cooldown_relaxed')).toBe(false)
  })

  it('still uses cooldown_relaxed, not cycle_restarted, when the library is genuinely too small', () => {
    // A real cooldown (not 0) with every dish freshly cooked: no dish clears
    // the day-based cooldown at all, cycle logic aside.
    const dishes = [dish('א'), dish('ב'), dish('ג')]
    const result = planWeek(
      input({
        dishes,
        history: [
          history('א', '2026-08-15'),
          history('ב', '2026-08-14'),
          history('ג', '2026-08-13'),
        ],
        params: { cook_days_count: 1, include_leftovers: false, max_prep_time: null },
      }),
    )
    expect(result.notices.some((n) => n.code === 'cooldown_relaxed')).toBe(true)
    expect(result.notices.some((n) => n.code === 'cycle_restarted')).toBe(false)
  })

  it('does not repeat the previous plan when re-rolled before anything was cooked', () => {
    // Re-running the wizard on the same week replaces the unlocked sessions
    // outright — nothing gets marked cooked, so CookHistory never grows.
    // Without previousSessionDishIds, the second run would have no memory of
    // the first and could trivially repeat it.
    const dishes = Array.from({ length: 10 }, (_, i) => dish(`מנה ${i + 1}`))
    const first = planWeek(
      input({ dishes, params: { cook_days_count: 3, include_leftovers: false, max_prep_time: null } }),
    )
    const firstIds = first.sessions.map((s) => s.dish_id)

    const second = planWeek(
      input({
        dishes,
        seed: 99999, // a different draw, standing in for "pressed the button again"
        params: { cook_days_count: 3, include_leftovers: false, max_prep_time: null },
        previousSessionDishIds: firstIds,
      }),
    )
    const secondIds = second.sessions.map((s) => s.dish_id)

    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
  })

  it('never repeats a dish across repeated wizard runs until the whole library has cycled', () => {
    // Ten dishes, three cook days a week, cooldown off so only the cycle rule
    // is in play — simulate several consecutive weekly plans and confirm no
    // dish repeats until all ten have appeared at least once.
    const dishes = Array.from({ length: 10 }, (_, i) => dish(`מנה ${i + 1}`))
    let cookHistory: CookHistory[] = []
    const seenBeforeFullCycle = new Set<string>()
    let cycleCompleted = false

    for (let week = 0; week < 4 && !cycleCompleted; week++) {
      const weekStart = addDays('2026-08-01', week * 7)
      const result = planWeek(
        input({
          dishes,
          settings: noCooldown,
          history: cookHistory,
          today: weekStart,
          dates: weekDates(weekStart),
          params: { cook_days_count: 3, include_leftovers: false, max_prep_time: null },
        }),
      )
      for (const s of result.sessions) {
        if (seenBeforeFullCycle.has(s.dish_id)) {
          // Only acceptable once every dish has already appeared once.
          expect(seenBeforeFullCycle.size).toBe(dishes.length)
          cycleCompleted = true
        }
        seenBeforeFullCycle.add(s.dish_id)
      }
      cookHistory = [...cookHistory, ...result.sessions.map((s) => history(s.dish_id, s.cook_date))]
    }

    expect(cycleCompleted).toBe(true)
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

describe('planWeek — preferredDishIds (AI shortlist bias)', () => {
  it('draws only from the shortlist when every entry is fresh', () => {
    const preferredDishIds = ['מנה 1', 'מנה 2', 'מנה 3']
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = planWeek(input({ seed, preferredDishIds }))
      for (const s of result.sessions) {
        expect(preferredDishIds).toContain(s.dish_id)
      }
    }
  })

  it('falls back to the full pool once the shortlist is exhausted, without dropping a day', () => {
    // Only one preferred dish, but three sessions requested — the other two
    // must still come from somewhere, exactly as if no shortlist existed.
    const result = planWeek(input({ preferredDishIds: ['מנה 1'] }))
    expect(result.sessions).toHaveLength(3)
    expect(result.sessions.some((s) => s.dish_id === 'מנה 1')).toBe(true)
  })

  it('ignores shortlist entries that are not eligible (excluded/inactive), same as an empty list', () => {
    const withGarbage = planWeek(input({ seed: 42, preferredDishIds: ['not-a-real-dish'] }))
    const withNone = planWeek(input({ seed: 42 }))
    expect(withGarbage.sessions).toEqual(withNone.sessions)
  })

  it('never overrides a locked session', () => {
    const result = planWeek(
      input({
        preferredDishIds: ['מנה 1', 'מנה 2', 'מנה 3'],
        lockedSessions: [{ cook_date: DATES[0], covers_days: 1, dish_id: 'מנה 9' }],
      }),
    )
    const locked = result.sessions.find((s) => s.cook_date === DATES[0])
    expect(locked?.dish_id).toBe('מנה 9')
    expect(locked?.is_locked).toBe(true)
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
