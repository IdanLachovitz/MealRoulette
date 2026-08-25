/**
 * Pure logic for drag-and-drop reordering in the week's day list.
 *
 * The week is viewed as a sequence of "units": either a plain day (empty,
 * or the fixed "לא מבשלים" marker) or a whole cook session — its cook day
 * plus every day currently linked to it as leftovers, moving as one block.
 *
 * The core operation (planWeekSwap) is a *positional* swap: the two units
 * being dragged/dropped trade places in the week's date sequence, and every
 * unit strictly between their two original positions is re-flowed to fill
 * the resulting gap or overlap — this is what lets a 3-day session and a
 * 1-day meal swap without losing or overlapping a day. Units outside that
 * span never change date. A locked session or a "לא מבשלים" day is a fixed
 * point: it can be dragged or targeted directly (that's an intentional
 * action), but blocks the whole operation if it would otherwise have to be
 * reflowed as a side effect of moving two *other* units past it.
 *
 * planLeftoverSwap is the separate, narrower case of dragging a single
 * leftover day on its own (not its cook day) — it relocates just that one
 * day, leaving the rest of its session's block untouched.
 */
import { addDays } from './dates'

export type SwapDayRole = 'cook' | 'leftovers' | 'none' | 'empty'

export interface DaySlotLike {
  date: string
  role: SwapDayRole
  cook_session_id: string | null
}

export interface SessionLike {
  id: string
  is_locked: boolean
}

export interface WeekUnitDay {
  kind: 'day'
  date: string
  isNone: boolean
}

export interface WeekUnitSession {
  kind: 'session'
  sessionId: string
  /** Every date currently linked to this session (cook + leftovers), sorted ascending. */
  dates: string[]
  locked: boolean
}

export type WeekUnit = WeekUnitDay | WeekUnitSession

/** Groups a week's DaySlot rows into the block-or-plain-day units above. */
export function buildWeekUnits(days: DaySlotLike[], sessions: SessionLike[]): WeekUnit[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const lockedById = new Map(sessions.map((s) => [s.id, s.is_locked]))
  const seen = new Set<string>()
  const units: WeekUnit[] = []
  for (const day of sorted) {
    if (day.cook_session_id) {
      if (seen.has(day.cook_session_id)) continue
      seen.add(day.cook_session_id)
      const dates = sorted.filter((d) => d.cook_session_id === day.cook_session_id).map((d) => d.date)
      units.push({
        kind: 'session',
        sessionId: day.cook_session_id,
        dates,
        locked: lockedById.get(day.cook_session_id) ?? false,
      })
    } else {
      units.push({ kind: 'day', date: day.date, isNone: day.role === 'none' })
    }
  }
  return units
}

function unitSize(u: WeekUnit): number {
  return u.kind === 'session' ? u.dates.length : 1
}
function unitContains(u: WeekUnit, date: string): boolean {
  return u.kind === 'session' ? u.dates.includes(date) : u.date === date
}
function unitFirstDate(u: WeekUnit): string {
  return u.kind === 'session' ? u.dates[0] : u.date
}
/** A fixed point: draggable/droppable directly, but never moved as a side effect. */
function isFixed(u: WeekUnit): boolean {
  return u.kind === 'session' ? u.locked : u.isNone
}

export interface SessionMove {
  sessionId: string
  newCookDate: string
}

/**
 * The plan for dragging the unit at `fromDate` onto the unit at `toDate` —
 * which sessions change cook_date, and to what. Returns null when the drop
 * is invalid: onto itself, onto (or dragging) a locked session or a "לא
 * מבשלים" day, or with one of those sitting between the two positions.
 */
export function planWeekSwap(units: WeekUnit[], fromDate: string, toDate: string): SessionMove[] | null {
  const idxA = units.findIndex((u) => unitContains(u, fromDate))
  const idxB = units.findIndex((u) => unitContains(u, toDate))
  if (idxA === -1 || idxB === -1 || idxA === idxB) return null

  const unitA = units[idxA]
  const unitB = units[idxB]
  if (isFixed(unitA) || isFixed(unitB)) return null

  const lo = Math.min(idxA, idxB)
  const hi = Math.max(idxA, idxB)
  for (let i = lo + 1; i < hi; i++) {
    if (isFixed(units[i])) return null
  }

  const reordered = [...units]
  ;[reordered[idxA], reordered[idxB]] = [reordered[idxB], reordered[idxA]]

  const moves: SessionMove[] = []
  let cursor = unitFirstDate(units[lo])
  for (let i = lo; i <= hi; i++) {
    const u = reordered[i]
    if (u.kind === 'session' && u.dates[0] !== cursor) {
      moves.push({ sessionId: u.sessionId, newCookDate: cursor })
    }
    cursor = addDays(cursor, unitSize(u))
  }
  return moves
}

export interface LeftoverMove {
  sessionId: string
  /** The session's full new leftover-date list (cook_date excluded), sorted. */
  coveredDates: string[]
}

/**
 * Dragging one leftover day by itself relocates only that day. A valid
 * target is a plain empty day, or a leftover day of a *different* session —
 * never a cook day (that's a session's anchor, not an interchangeable
 * slot) and never "לא מבשלים" (a fixed marker, same rule as the block swap).
 */
export function planLeftoverSwap(days: DaySlotLike[], fromDate: string, toDate: string): LeftoverMove[] | null {
  if (fromDate === toDate) return null
  const byDate = new Map(days.map((d) => [d.date, d]))
  const from = byDate.get(fromDate)
  const to = byDate.get(toDate)
  if (!from || !to) return null
  if (from.role !== 'leftovers') return null
  if (to.role === 'none' || to.role === 'cook') return null
  if (to.role === 'leftovers' && to.cook_session_id === from.cook_session_id) return null

  const sourceSessionId = from.cook_session_id!
  // A leftover can't land before its own cook day — you can't have leftovers
  // of something you haven't cooked yet.
  const sourceCookDate = cookDateOf(days, sourceSessionId)
  if (sourceCookDate && toDate < sourceCookDate) return null

  const sourceRest = days
    .filter((d) => d.cook_session_id === sourceSessionId && d.role === 'leftovers' && d.date !== fromDate)
    .map((d) => d.date)

  if (to.role === 'leftovers') {
    const targetSessionId = to.cook_session_id!
    const targetCookDate = cookDateOf(days, targetSessionId)
    if (targetCookDate && fromDate < targetCookDate) return null

    const targetRest = days
      .filter((d) => d.cook_session_id === targetSessionId && d.role === 'leftovers' && d.date !== toDate)
      .map((d) => d.date)
    return [
      { sessionId: sourceSessionId, coveredDates: [...sourceRest, toDate].sort() },
      { sessionId: targetSessionId, coveredDates: [...targetRest, fromDate].sort() },
    ]
  }

  return [{ sessionId: sourceSessionId, coveredDates: [...sourceRest, toDate].sort() }]
}

function cookDateOf(days: DaySlotLike[], sessionId: string): string | undefined {
  return days.find((d) => d.role === 'cook' && d.cook_session_id === sessionId)?.date
}
