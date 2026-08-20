/**
 * The weekly planning engine — section 7 of the spec.
 *
 * Deliberately a pure function: it takes the library, the cook history, the
 * wizard parameters and a seed, and returns a plan. No Dexie, no network, no
 * clock. Same inputs + same seed => same plan, which is what the tests rely on.
 */
import type { CookHistory, Dish, HouseholdSettings, PlanningParams, TimeFilter } from '../types'
import { addDays, daysBetween } from './dates'
import { makeRng } from './rng'

export interface LockedSession {
  cook_date: string
  covers_days: number
  dish_id: string | null
}

export interface PlannerInput {
  /** The 7 dates of the week, in order. */
  dates: string[]
  /** Days the user marked "not cooking" (role = none). */
  excludedDates: string[]
  lockedSessions: LockedSession[]
  dishes: Dish[]
  history: CookHistory[]
  params: PlanningParams
  settings: HouseholdSettings
  /** Reference date for cooldown maths — normally the week start. */
  today: string
  seed: number
}

export interface DraftSession {
  cook_date: string
  dish_id: string
  covers_days: number
  estimated_minutes: number
  is_locked: boolean
}

export type NoticeCode =
  | 'cooldown_relaxed'
  | 'repeated_dish'
  | 'coverage_reduced'
  | 'truncated_at_week_end'
  | 'uncovered_days'
  | 'all_locked'
  | 'empty_pool'

export interface Notice {
  code: NoticeCode
  message: string
}

export interface DayAssignment {
  date: string
  role: 'cook' | 'leftovers' | 'none' | 'empty'
  /** Index into PlanResult.sessions, or null. */
  sessionIndex: number | null
}

export interface PlanResult {
  sessions: DraftSession[]
  days: DayAssignment[]
  notices: Notice[]
}

/** Most recent cook date per entity id. */
export function lastCookedMap(history: CookHistory[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const h of history) {
    const prev = map.get(h.entity_id)
    if (!prev || h.cooked_on > prev) map.set(h.entity_id, h.cooked_on)
  }
  return map
}

export function passesTimeFilter(prepMinutes: number, filter: TimeFilter): boolean {
  if (filter.max !== null && prepMinutes > filter.max) return false
  // "מעל 40 דק'" is exclusive, so a 40-minute item belongs to "עד 40" only.
  if (filter.min !== null && prepMinutes <= filter.min) return false
  return true
}

/** Active, not excluded, within the time filter. Spec step 4a. */
export function eligibleDishes(dishes: Dish[], maxPrepTime: number | null): Dish[] {
  return dishes.filter(
    (d) =>
      !d.deleted_at &&
      d.is_active &&
      !d.is_excluded &&
      passesTimeFilter(d.prep_time_minutes, { max: maxPrepTime, min: null }),
  )
}

function isInCooldown(
  dish: Dish,
  lastCooked: Map<string, string>,
  today: string,
  cooldownDays: number,
): boolean {
  const last = lastCooked.get(dish.id)
  if (!last) return false
  return daysBetween(last, today) < cooldownDays
}

export function planWeek(input: PlannerInput): PlanResult {
  const { dates, excludedDates, lockedSessions, dishes, history, params, settings } = input
  const rng = makeRng(input.seed)
  const notices: Notice[] = []
  const pushNotice = (code: NoticeCode, message: string) => {
    if (!notices.some((n) => n.code === code)) notices.push({ code, message })
  }

  const excluded = new Set(excludedDates)
  const availableDates = dates.filter((d) => !excluded.has(d))

  // Step 2 — locked sessions count against the requested quota (FR-4.3).
  const lockedCount = lockedSessions.length
  const requested = Math.min(params.cook_days_count, availableDates.length)
  if (params.cook_days_count > availableDates.length) {
    // EC-15
    pushNotice(
      'coverage_reduced',
      `יש רק ${availableDates.length} ימים פנויים השבוע, אז תכננתי ${availableDates.length} בישולים.`,
    )
  }
  const sessionsNeeded = Math.max(0, requested - lockedCount)

  if (lockedCount > 0 && sessionsNeeded === 0) {
    // EC-5
    pushNotice('all_locked', 'כל הבישולים נעולים. פתחי נעילה כדי לתכנן מחדש.')
  }

  // Step 3 — how many days each cook should stretch to.
  const targetCover = params.include_leftovers
    ? Math.max(1, Math.ceil(availableDates.length / Math.max(1, requested)))
    : 1

  // ---- Step 4: choose a dish per session -------------------------------------
  const lastCooked = lastCookedMap(history)
  const pool0 = eligibleDishes(dishes, params.max_prep_time)

  // Hard rule FR-5.5: a dish already placed this week is out, locked ones included.
  const usedThisWeek = new Set<string>(
    lockedSessions.map((s) => s.dish_id).filter((id): id is string => !!id),
  )

  const pickOne = (): { dish: Dish; covers: number } | null => {
    let cover = targetCover
    while (cover >= 1) {
      const fresh = pool0.filter(
        (d) =>
          !usedThisWeek.has(d.id) &&
          !isInCooldown(d, lastCooked, input.today, settings.dish_cooldown_days) &&
          (cover === 1 || d.max_cover_days >= cover),
      )
      if (fresh.length > 0) {
        const dish = rng.pick(fresh)
        return { dish, covers: Math.min(cover, Math.max(1, dish.max_cover_days)) }
      }

      // Step 4e — relax the cooldown, oldest first (FR-5.3). Excluded dishes are
      // never re-admitted here: exclusion is a decision, not a stock limit (FR-5.4).
      const relaxable = pool0
        .filter((d) => !usedThisWeek.has(d.id) && (cover === 1 || d.max_cover_days >= cover))
        .sort((a, b) => (lastCooked.get(a.id) ?? '').localeCompare(lastCooked.get(b.id) ?? ''))
      if (relaxable.length > 0) {
        pushNotice('cooldown_relaxed', 'חזרתי על מנה שבושלה לאחרונה — המאגר קטן מדי לשבוע שלם.')
        return { dish: relaxable[0], covers: Math.min(cover, Math.max(1, relaxable[0].max_cover_days)) }
      }

      cover -= 1
      if (cover >= 1 && targetCover > 1) {
        // EC-16
        pushNotice(
          'coverage_reduced',
          'אין מספיק מנות שמספיקות לכמה ימים, אז כל בישול מכסה פחות ימים.',
        )
      }
    }

    // Last resort before leaving a day unfed: repeat a dish already in the week.
    // FR-5.5 calls the no-repeat rule hard; FR-5.3's acceptance criterion expects a
    // repeat when the library is genuinely too small. We honour the hard rule as long
    // as any alternative exists, and only break it to avoid an empty session.
    if (pool0.length > 0) {
      pushNotice('repeated_dish', 'המאגר קטן מדי לשבוע שלם, אז מנה אחת חוזרת פעמיים.')
      return { dish: rng.pick(pool0), covers: 1 }
    }

    // EC-1 / EC-4
    pushNotice('empty_pool', 'אין מנות זמינות שעונות על הסינון. נסי לנקות סינון או להוסיף מנה.')
    return null
  }

  const chosen: { dish: Dish; covers: number }[] = []
  for (let i = 0; i < sessionsNeeded; i++) {
    const picked = pickOne()
    if (!picked) break
    chosen.push(picked)
    usedThisWeek.add(picked.dish.id)
  }

  // ---- Step 5: spread the cook days evenly ------------------------------------
  const lockedDates = new Set(lockedSessions.map((s) => s.cook_date))
  const freeDates = availableDates.filter((d) => !lockedDates.has(d))
  const cookDates = spreadEvenly(freeDates, chosen.length)

  const sessions: DraftSession[] = lockedSessions.map((s) => ({
    cook_date: s.cook_date,
    dish_id: s.dish_id ?? '',
    covers_days: s.covers_days,
    estimated_minutes: dishes.find((d) => d.id === s.dish_id)?.prep_time_minutes ?? 0,
    is_locked: true,
  }))
  chosen.forEach((c, i) => {
    sessions.push({
      cook_date: cookDates[i],
      dish_id: c.dish.id,
      covers_days: c.covers,
      estimated_minutes: c.dish.prep_time_minutes,
      is_locked: false,
    })
  })
  sessions.sort((a, b) => a.cook_date.localeCompare(b.cook_date))

  // ---- Steps 6-7: lay the sessions out over the days --------------------------
  const days = layOutDays(dates, excluded, sessions, pushNotice)

  const uncovered = days.filter((d) => d.role === 'empty').length
  if (uncovered > 0) {
    // FR-4.5
    pushNotice(
      'uncovered_days',
      params.include_leftovers
        ? `${uncovered} ימים נשארו בלי כיסוי. אפשר להוסיף בישול או להאריך שאריות.`
        : `${uncovered} ימים נשארו ריקים כי ביקשת בלי שאריות.`,
    )
  }

  return { sessions, days, notices }
}

/** Place `count` picks across `slots` at as-even intervals as possible. */
export function spreadEvenly(slots: string[], count: number): string[] {
  if (count <= 0 || slots.length === 0) return []
  if (count >= slots.length) return slots.slice(0, count)
  const seen = new Set<string>()
  let cursor = 0
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const idx = Math.min(Math.round((i * slots.length) / count), slots.length - 1)
    let pick = slots[idx]
    // Guard against two picks landing on the same slot after rounding.
    while (seen.has(pick)) pick = slots[cursor++ % slots.length]
    seen.add(pick)
    out.push(pick)
  }
  return out
}

function layOutDays(
  dates: string[],
  excluded: Set<string>,
  sessions: DraftSession[],
  pushNotice: (code: NoticeCode, message: string) => void,
): DayAssignment[] {
  const days: DayAssignment[] = dates.map((date) => ({
    date,
    role: excluded.has(date) ? 'none' : 'empty',
    sessionIndex: null,
  }))
  const byDate = new Map(days.map((d) => [d.date, d]))
  const cookDates = new Set(sessions.map((s) => s.cook_date))

  sessions.forEach((s, index) => {
    const cookDay = byDate.get(s.cook_date)
    if (!cookDay) return
    cookDay.role = 'cook'
    cookDay.sessionIndex = index

    // Leftovers land on the following days, skipping "not cooking" days and
    // stopping at the next cook day or at the end of the week (EC-14).
    let placed = 1
    let cursor = s.cook_date
    while (placed < s.covers_days) {
      cursor = addDays(cursor, 1)
      const day = byDate.get(cursor)
      if (!day) {
        pushNotice('truncated_at_week_end', 'בישול אחד נחתך בסוף השבוע — ימי הכיסוי קוצרו.')
        break
      }
      if (day.role === 'none') continue
      if (cookDates.has(cursor)) break
      day.role = 'leftovers'
      day.sessionIndex = index
      placed++
    }
    if (placed < s.covers_days) s.covers_days = placed
  })

  return days
}
