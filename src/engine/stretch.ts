/**
 * FR-9.3 — "make more and cover tomorrow too". When a dish that keeps for
 * several days (max_cover_days) is cooked for fewer days than that, and the
 * day right after what it covers is still empty, the app offers to cook a
 * bigger batch and cover that day with leftovers. Accepting is just
 * setCoversDays(covers_days + 1), which also rescales the shopping list.
 *
 * Pure, so the rule is unit-tested without the week screen.
 */
import { addDays } from './dates'
import type { CookSession, DaySlot, Dish } from '../types'

export interface StretchSuggestion {
  session: CookSession
  /** The empty day the bigger batch would cover. */
  date: string
  coversDays: number
}

export function stretchSuggestion(
  session: CookSession,
  dish: Dish | undefined,
  days: DaySlot[],
): StretchSuggestion | null {
  // A combo has no dish row and so no max_cover_days of its own to go by.
  if (!dish || session.source_type !== 'dish') return null
  if (session.is_cooked || session.covers_days >= dish.max_cover_days) return null
  // Leftover days dragged to arbitrary dates aren't a plain "one more day".
  if (session.covered_dates) return null

  const date = addDays(session.cook_date, session.covers_days)
  const next = days.find((d) => d.date === date)
  // Off the end of the week, a day marked "not cooking", or already taken.
  if (!next || next.role !== 'empty') return null
  return { session, date, coversDays: session.covers_days + 1 }
}
