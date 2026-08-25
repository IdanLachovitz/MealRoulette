import { describe, expect, it } from 'vitest'
import { buildWeekUnits, planLeftoverSwap, planWeekSwap } from './weekSwap'
import type { DaySlotLike, SessionLike } from './weekSwap'

/** A one-week (Sun–Sat) run of plain days, easy to override per test. */
function week(overrides: Record<string, Partial<DaySlotLike>> = {}): DaySlotLike[] {
  const dates = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']
  return dates.map((date) => ({
    date,
    role: 'empty',
    cook_session_id: null,
    ...overrides[date],
  }))
}

function session(id: string, isLocked = false): SessionLike {
  return { id, is_locked: isLocked }
}

describe('buildWeekUnits', () => {
  it('groups a session\'s cook + leftover days into one unit', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'leftovers', cook_session_id: 's1' },
    })
    const units = buildWeekUnits(days, [session('s1')])
    expect(units).toHaveLength(5) // Sun, [Mon-Tue-Wed block], Thu, Fri, Sat
    expect(units[1]).toEqual({
      kind: 'session',
      sessionId: 's1',
      dates: ['2026-08-24', '2026-08-25', '2026-08-26'],
      locked: false,
    })
  })

  it('marks a "לא מבשלים" day distinctly from a plain empty day', () => {
    const days = week({ '2026-08-24': { role: 'none' } })
    const units = buildWeekUnits(days, [])
    expect(units[1]).toEqual({ kind: 'day', date: '2026-08-24', isNone: true })
  })

  it('carries a locked flag from the matching session', () => {
    const days = week({ '2026-08-24': { role: 'cook', cook_session_id: 's1' } })
    const units = buildWeekUnits(days, [session('s1', true)])
    expect(units[1]).toMatchObject({ kind: 'session', locked: true })
  })
})

describe('planWeekSwap — single-day swaps', () => {
  it('swaps two plain empty days', () => {
    const days = week()
    const units = buildWeekUnits(days, [])
    const moves = planWeekSwap(units, '2026-08-24', '2026-08-26')
    // Neither is a session, so there's nothing to persist.
    expect(moves).toEqual([])
  })

  it('swaps a 1-day session with a plain empty day', () => {
    const days = week({ '2026-08-24': { role: 'cook', cook_session_id: 's1' } })
    const units = buildWeekUnits(days, [session('s1')])
    const moves = planWeekSwap(units, '2026-08-24', '2026-08-27')
    expect(moves).toEqual([{ sessionId: 's1', newCookDate: '2026-08-27' }])
  })

  it('swaps two 1-day sessions with each other, in both drag directions', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-27': { role: 'cook', cook_session_id: 's2' },
    })
    const units = buildWeekUnits(days, [session('s1'), session('s2')])

    const forward = planWeekSwap(units, '2026-08-24', '2026-08-27')
    expect(forward).toEqual(
      expect.arrayContaining([
        { sessionId: 's1', newCookDate: '2026-08-27' },
        { sessionId: 's2', newCookDate: '2026-08-24' },
      ]),
    )
    expect(forward).toHaveLength(2)

    const backward = planWeekSwap(units, '2026-08-27', '2026-08-24')
    expect(backward).toEqual(
      expect.arrayContaining([
        { sessionId: 's1', newCookDate: '2026-08-27' },
        { sessionId: 's2', newCookDate: '2026-08-24' },
      ]),
    )
  })
})

describe('planWeekSwap — session blocks (cook day + leftovers)', () => {
  it('drags the whole block: cook day + leftovers move together, in order, ending on the drop target', () => {
    // s1: Mon(cook) Tue(left) Wed(left) — dropped onto empty Sat. Thu and
    // Fri sit between them but carry no data either way, so reflowing
    // through them is unobservable — what's observable is that s1's block
    // still ends up covering the day it was dropped on (Sat), now starting
    // two days earlier (Thu) to fit its own 3-day length.
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'leftovers', cook_session_id: 's1' },
    })
    const units = buildWeekUnits(days, [session('s1')])
    const moves = planWeekSwap(units, '2026-08-24', '2026-08-29')
    expect(moves?.find((m) => m.sessionId === 's1')).toEqual({ sessionId: 's1', newCookDate: '2026-08-27' })
  })

  it('grabbing any day inside the block (not just the cook day) drags the whole block', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
    })
    const units = buildWeekUnits(days, [session('s1')])
    const moves = planWeekSwap(units, '2026-08-25', '2026-08-28')
    expect(moves).toEqual([{ sessionId: 's1', newCookDate: '2026-08-27' }])
  })

  it('swaps two equal-size blocks with no effect on anything outside them', () => {
    // s1: Sun(cook) Mon(left) — s2: Thu(cook) Fri(left). Sat stays put.
    const days = week({
      '2026-08-23': { role: 'cook', cook_session_id: 's1' },
      '2026-08-24': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-27': { role: 'cook', cook_session_id: 's2' },
      '2026-08-28': { role: 'leftovers', cook_session_id: 's2' },
    })
    const units = buildWeekUnits(days, [session('s1'), session('s2')])
    const moves = planWeekSwap(units, '2026-08-23', '2026-08-27')
    expect(moves).toEqual(
      expect.arrayContaining([
        { sessionId: 's1', newCookDate: '2026-08-27' },
        { sessionId: 's2', newCookDate: '2026-08-23' },
      ]),
    )
    expect(moves).toHaveLength(2)
  })
})

describe('planWeekSwap — mismatched block sizes shift only what is between them', () => {
  it('shifts a 1-day session sandwiched between a 3-day block and its swap target', () => {
    // Sun: s1 (cook, covers 3: Sun/Mon/Tue). Wed: s2 (1-day). Thu: s3 (1-day, target).
    // Drag s1 (3 days) onto s3 (1 day). s2 sits strictly between them and
    // must shift to absorb the size difference, without being the thing
    // that was dragged.
    const days = week({
      '2026-08-23': { role: 'cook', cook_session_id: 's1' },
      '2026-08-24': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'cook', cook_session_id: 's2' },
      '2026-08-27': { role: 'cook', cook_session_id: 's3' },
    })
    const units = buildWeekUnits(days, [session('s1'), session('s2'), session('s3')])
    const moves = planWeekSwap(units, '2026-08-23', '2026-08-27')

    // Original order: [s1(3)] [s2(1)] [s3(1)] [Fri] [Sat]
    // Positions 0..2 swap s1 and s3 -> [s3(1)] [s2(1)] [s1(3)]
    // Re-flowed sequentially from Sun (the original span start):
    //   s3 -> Sun (2026-08-23)
    //   s2 -> Mon (2026-08-24)
    //   s1 -> Tue (2026-08-25), spanning Tue/Wed/Thu
    expect(moves).toEqual(
      expect.arrayContaining([
        { sessionId: 's3', newCookDate: '2026-08-23' },
        { sessionId: 's2', newCookDate: '2026-08-24' },
        { sessionId: 's1', newCookDate: '2026-08-25' },
      ]),
    )
    expect(moves).toHaveLength(3)
  })

  it('never touches a session outside the [source, target] span', () => {
    const days = week({
      '2026-08-23': { role: 'cook', cook_session_id: 's1' },
      '2026-08-24': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'cook', cook_session_id: 's2' },
      '2026-08-27': { role: 'cook', cook_session_id: 's3' },
      '2026-08-29': { role: 'cook', cook_session_id: 's4' },
    })
    const units = buildWeekUnits(days, [session('s1'), session('s2'), session('s3'), session('s4')])
    const moves = planWeekSwap(units, '2026-08-23', '2026-08-27')
    expect(moves?.find((m) => m.sessionId === 's4')).toBeUndefined()
  })
})

describe('planWeekSwap — fixed points (locked sessions, "לא מבשלים")', () => {
  it('rejects dragging a locked session', () => {
    const days = week({ '2026-08-24': { role: 'cook', cook_session_id: 's1' } })
    const units = buildWeekUnits(days, [session('s1', true)])
    expect(planWeekSwap(units, '2026-08-24', '2026-08-27')).toBeNull()
  })

  it('rejects dropping onto a locked session', () => {
    const days = week({ '2026-08-24': { role: 'cook', cook_session_id: 's1' } })
    const units = buildWeekUnits(days, [session('s1', true)])
    expect(planWeekSwap(units, '2026-08-27', '2026-08-24')).toBeNull()
  })

  it('rejects a swap that would have to shift a locked session sitting in between', () => {
    const days = week({
      '2026-08-23': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'cook', cook_session_id: 'locked' },
      '2026-08-27': { role: 'cook', cook_session_id: 's2' },
    })
    const units = buildWeekUnits(days, [session('s1'), session('locked', true), session('s2')])
    expect(planWeekSwap(units, '2026-08-23', '2026-08-27')).toBeNull()
  })

  it('rejects dragging or dropping onto a "לא מבשלים" day', () => {
    const days = week({ '2026-08-24': { role: 'none' } })
    const units = buildWeekUnits(days, [])
    expect(planWeekSwap(units, '2026-08-24', '2026-08-27')).toBeNull()
    expect(planWeekSwap(units, '2026-08-27', '2026-08-24')).toBeNull()
  })

  it('rejects a swap that would have to shift a "לא מבשלים" day sitting in between', () => {
    const days = week({ '2026-08-25': { role: 'none' } })
    const units = buildWeekUnits(days, [])
    expect(planWeekSwap(units, '2026-08-23', '2026-08-27')).toBeNull()
  })

  it('still allows a swap that has a fixed point outside the affected span', () => {
    const days = week({ '2026-08-29': { role: 'none' } })
    const units = buildWeekUnits(days, [])
    expect(planWeekSwap(units, '2026-08-23', '2026-08-24')).toEqual([])
  })
})

describe('planWeekSwap — invalid drops', () => {
  it('rejects dropping a unit onto itself', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
    })
    const units = buildWeekUnits(days, [session('s1')])
    expect(planWeekSwap(units, '2026-08-24', '2026-08-25')).toBeNull()
  })

  it('returns null for a date outside the week', () => {
    const units = buildWeekUnits(week(), [])
    expect(planWeekSwap(units, '2026-08-24', '2099-01-01')).toBeNull()
  })
})

describe('planLeftoverSwap — dragging one leftover day on its own', () => {
  it('moves a leftover day onto a plain empty day, leaving the cook day untouched', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
    })
    const moves = planLeftoverSwap(days, '2026-08-25', '2026-08-28')
    expect(moves).toEqual([{ sessionId: 's1', coveredDates: ['2026-08-28'] }])
  })

  it('swaps a leftover day with a leftover of a different session', () => {
    // Both leftover dates must land on/after the *other* session's cook
    // day too, so both cook early — 24 and 25 — with their leftovers
    // further out, at 26 and 27.
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-26': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-25': { role: 'cook', cook_session_id: 's2' },
      '2026-08-27': { role: 'leftovers', cook_session_id: 's2' },
    })
    const moves = planLeftoverSwap(days, '2026-08-26', '2026-08-27')
    expect(moves).toEqual(
      expect.arrayContaining([
        { sessionId: 's1', coveredDates: ['2026-08-27'] },
        { sessionId: 's2', coveredDates: ['2026-08-26'] },
      ]),
    )
  })

  it('leaves the rest of a multi-leftover session\'s dates untouched', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'leftovers', cook_session_id: 's1' },
    })
    const moves = planLeftoverSwap(days, '2026-08-25', '2026-08-29')
    expect(moves).toEqual([{ sessionId: 's1', coveredDates: ['2026-08-26', '2026-08-29'] }])
  })

  it('rejects dragging a cook day through this function', () => {
    const days = week({ '2026-08-24': { role: 'cook', cook_session_id: 's1' } })
    expect(planLeftoverSwap(days, '2026-08-24', '2026-08-27')).toBeNull()
  })

  it('rejects targeting a cook day', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-27': { role: 'cook', cook_session_id: 's2' },
    })
    expect(planLeftoverSwap(days, '2026-08-25', '2026-08-27')).toBeNull()
  })

  it('rejects targeting "לא מבשלים"', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-27': { role: 'none' },
    })
    expect(planLeftoverSwap(days, '2026-08-25', '2026-08-27')).toBeNull()
  })

  it('rejects targeting another leftover day of the same session', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-26': { role: 'leftovers', cook_session_id: 's1' },
    })
    expect(planLeftoverSwap(days, '2026-08-25', '2026-08-26')).toBeNull()
  })

  it("rejects landing before the leftover's own cook day", () => {
    const days = week({
      '2026-08-26': { role: 'cook', cook_session_id: 's1' },
      '2026-08-27': { role: 'leftovers', cook_session_id: 's1' },
    })
    expect(planLeftoverSwap(days, '2026-08-27', '2026-08-23')).toBeNull()
    expect(planLeftoverSwap(days, '2026-08-27', '2026-08-25')).toBeNull()
  })

  it('allows landing on or after the cook day', () => {
    const days = week({
      '2026-08-24': { role: 'cook', cook_session_id: 's1' },
      '2026-08-25': { role: 'leftovers', cook_session_id: 's1' },
    })
    expect(planLeftoverSwap(days, '2026-08-25', '2026-08-24')).toBeNull() // still the cook day
    expect(planLeftoverSwap(days, '2026-08-25', '2026-08-29')).toEqual([
      { sessionId: 's1', coveredDates: ['2026-08-29'] },
    ])
  })

  it("rejects a leftover<->leftover swap that would place either one before the other session's cook day", () => {
    const days = week({
      '2026-08-23': { role: 'cook', cook_session_id: 's1' },
      '2026-08-24': { role: 'leftovers', cook_session_id: 's1' },
      '2026-08-27': { role: 'cook', cook_session_id: 's2' },
      '2026-08-28': { role: 'leftovers', cook_session_id: 's2' },
    })
    // s1's leftover (24) is before s2's cook day (27) — handing it to s2
    // would give s2 a "leftover" that predates its own cook day.
    expect(planLeftoverSwap(days, '2026-08-24', '2026-08-28')).toBeNull()
  })
})
