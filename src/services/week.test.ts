// fake-indexeddb must be set up before db.ts's module-level `new MealDb()`
// runs — that's why this import comes before everything else.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { addDays } from '../engine/dates'
import { swapLeftoverDay, swapWeekBlock } from './week'
import type { CookSession, DaySlot } from '../types'

const PLAN_ID = 'plan-1'
const HOUSEHOLD_ID = 'house-1'
const WEEK_DATES = [
  '2026-08-23',
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
]

function makeDay(date: string, role: DaySlot['role'] = 'empty', cook_session_id: string | null = null): DaySlot {
  return {
    id: `day-${date}`,
    household_id: HOUSEHOLD_ID,
    updated_at: '',
    deleted_at: null,
    week_plan_id: PLAN_ID,
    date,
    role,
    cook_session_id,
  }
}

function makeSession(overrides: Partial<CookSession> & { id: string; cook_date: string }): CookSession {
  return {
    household_id: HOUSEHOLD_ID,
    updated_at: '',
    deleted_at: null,
    week_plan_id: PLAN_ID,
    source_type: 'dish',
    dish_id: 'dish-1',
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
    ...overrides,
  }
}

/** Seeds a fresh 7-day plan with the given sessions and matching day roles. */
async function seedWeek(sessions: CookSession[]) {
  await db.cookSessions.clear()
  await db.daySlots.clear()

  const days = WEEK_DATES.map((date) => makeDay(date))
  for (const s of sessions) {
    const cookDay = days.find((d) => d.date === s.cook_date)
    if (cookDay) {
      cookDay.role = 'cook'
      cookDay.cook_session_id = s.id
    }
    const leftoverDates = s.covered_dates ?? []
    for (const date of leftoverDates) {
      const day = days.find((d) => d.date === date)
      if (day) {
        day.role = 'leftovers'
        day.cook_session_id = s.id
      }
    }
  }
  await db.daySlots.bulkPut(days)
  await db.cookSessions.bulkPut(sessions)
}

async function dayRow(date: string) {
  return db.daySlots.get(`day-${date}`)
}

describe('swapWeekBlock — regression: covered_dates must travel with a whole-block move', () => {
  beforeEach(async () => {
    // s1: cooks Sun(23), with a custom (non-contiguous) leftover on Wed(26)
    // — arranged earlier via an isolated single-leftover-day drag.
    const s1 = makeSession({ id: 's1', cook_date: '2026-08-23', covers_days: 2, covered_dates: ['2026-08-26'] })
    // s2: a plain 1-day session on Fri(28).
    const s2 = makeSession({ id: 's2', cook_date: '2026-08-28', dish_id: 'dish-2' })
    await seedWeek([s1, s2])
  })

  it('shifts covered_dates by the same delta as cook_date when the block moves', async () => {
    const ok = await swapWeekBlock(PLAN_ID, '2026-08-23', '2026-08-28')
    expect(ok).toBe(true)

    const s1After = await db.cookSessions.get('s1')
    // s1 moved from Sun(23) to wherever the reflow placed it — the custom
    // leftover (originally 3 days after cook_date, at Wed/26) must still be
    // exactly 3 days after wherever cook_date landed now, not still at 26.
    expect(s1After?.covered_dates).toEqual([addDays(s1After!.cook_date, 3)])
  })

  it('never leaves a leftover day pointing at a session that no longer owns that date', async () => {
    // This is the exact bug reported: after a swap, some day was still
    // labelled "leftovers of X" while X had moved elsewhere, or another
    // session now occupied that date without the day list knowing.
    await swapWeekBlock(PLAN_ID, '2026-08-23', '2026-08-28')

    const allSessions = await db.cookSessions.toArray()
    const allDays = await db.daySlots.toArray()
    for (const day of allDays) {
      if (!day.cook_session_id) continue
      const owner = allSessions.find((s) => s.id === day.cook_session_id)
      expect(owner, `day ${day.date} points at a session that doesn't exist`).toBeTruthy()
      if (day.role === 'leftovers') {
        const stillLinked =
          owner!.covered_dates?.includes(day.date) ??
          // Derived (no covered_dates): must fall within [cook_date, cook_date + covers_days).
          (day.date >= owner!.cook_date && day.date < addDays(owner!.cook_date, owner!.covers_days))
        expect(stillLinked, `${day.date} claims to be a leftover of ${owner!.id} but isn't within its span`).toBe(
          true,
        )
      }
    }
  })
})

describe('swapLeftoverDay — cannot land before its own cook day', () => {
  beforeEach(async () => {
    const s1 = makeSession({ id: 's1', cook_date: '2026-08-26', covers_days: 2, covered_dates: ['2026-08-27'] })
    await seedWeek([s1])
  })

  it('rejects dragging a leftover to a date before its cook day', async () => {
    const ok = await swapLeftoverDay(PLAN_ID, '2026-08-27', '2026-08-23')
    expect(ok).toBe(false)
    const s1After = await db.cookSessions.get('s1')
    expect(s1After?.covered_dates).toEqual(['2026-08-27']) // untouched
  })

  it('still allows dragging it to a later date', async () => {
    const ok = await swapLeftoverDay(PLAN_ID, '2026-08-27', '2026-08-29')
    expect(ok).toBe(true)
    const s1After = await db.cookSessions.get('s1')
    expect(s1After?.covered_dates).toEqual(['2026-08-29'])
    expect((await dayRow('2026-08-27'))?.role).toBe('empty')
    expect((await dayRow('2026-08-29'))?.role).toBe('leftovers')
  })
})

describe('swapLeftoverDay — swapping between two sessions rejects one landing before the other\'s cook day', () => {
  it('rejects when the target session\'s cook day is after the source leftover date being offered to it', async () => {
    // s1 cooks Sun(23), leftover Mon(24). s2 cooks Thu(27), leftover Fri(28).
    // Dragging s1's Mon(24) leftover onto s2's Fri(28) leftover would hand
    // s2 a "leftover" on Mon(24) — before s2's own cook day (27). Invalid.
    const s1 = makeSession({ id: 's1', cook_date: '2026-08-23', covers_days: 2, covered_dates: ['2026-08-24'] })
    const s2 = makeSession({
      id: 's2',
      cook_date: '2026-08-27',
      covers_days: 2,
      covered_dates: ['2026-08-28'],
      dish_id: 'dish-2',
    })
    await seedWeek([s1, s2])

    const ok = await swapLeftoverDay(PLAN_ID, '2026-08-24', '2026-08-28')
    expect(ok).toBe(false)
    expect((await db.cookSessions.get('s1'))?.covered_dates).toEqual(['2026-08-24'])
    expect((await db.cookSessions.get('s2'))?.covered_dates).toEqual(['2026-08-28'])
  })
})

