/**
 * The 18:00 "today we're cooking" push reminder, worked out on the phone.
 *
 * The server can't work this out itself: the week only reaches it when the
 * kitchen syncs, and a kitchen that never signed in has nothing there at all.
 * So the phone computes the next few days' reminders from its own data and
 * hands the server a ready schedule (see sync/push.ts), which only has to
 * send each one when its time comes. Re-sent whenever the plan changes, so a
 * session moved, deleted or marked cooked takes its reminder with it.
 *
 * Pure, so which days get a reminder and what it says is unit-tested.
 */
import { addDays, parseISODate, toISODate } from './dates'
import type { Component, CookSession, Dish } from '../types'

export const REMINDER_HOUR = 18

/** How far ahead to schedule. Opening the app at least this often keeps reminders coming. */
export const REMINDER_DAYS_AHEAD = 7

export interface Reminder {
  /** One per cook date, so a re-sent schedule replaces rather than duplicates. */
  tag: string
  fire_at: string
  title: string
  body: string
}

/**
 * One reminder per day that has cooking on it, from `today` on, at 18:00 local
 * time. A day whose 18:00 has already passed, or whose cooking is all marked
 * done, gets none. Leftover days aren't cooking, so they get none either.
 */
export function dailyReminders(
  sessions: CookSession[],
  dishes: Dish[],
  components: Component[],
  now: Date,
): Reminder[] {
  const dishById = new Map(dishes.map((d) => [d.id, d]))
  const compById = new Map(components.map((c) => [c.id, c]))
  const today = toISODate(now)
  const lastDay = addDays(today, REMINDER_DAYS_AHEAD - 1)

  const byDate = new Map<string, CookSession[]>()
  for (const s of sessions) {
    if (s.deleted_at || s.is_cooked || s.cook_date < today || s.cook_date > lastDay) continue
    byDate.set(s.cook_date, [...(byDate.get(s.cook_date) ?? []), s])
  }

  const reminders: Reminder[] = []
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const at = parseISODate(date)
    at.setHours(REMINDER_HOUR, 0, 0, 0)
    if (at.getTime() <= now.getTime()) continue

    const names = list.map((s) => sessionName(s, dishById, compById)).filter(Boolean)
    if (names.length === 0) continue
    const minutes = list.reduce((sum, s) => sum + (s.estimated_minutes || 0), 0)
    reminders.push({
      tag: `cook-${date}`,
      fire_at: at.toISOString(),
      title: 'היום מבשלים 🍳',
      body: joinHebrew(names) + (minutes > 0 ? ` · ${formatMinutes(minutes)}` : ''),
    })
  }
  return reminders
}

function sessionName(
  s: CookSession,
  dishById: Map<string, Dish>,
  compById: Map<string, Component>,
): string {
  if (s.source_type === 'dish') return dishById.get(s.dish_id ?? '')?.name ?? ''
  return [s.protein_id, s.carb_id, s.veg_id]
    .map((id) => (id ? compById.get(id)?.name : null))
    .filter(Boolean)
    .join(' + ')
}

/** "שקשוקה", "שקשוקה ופסטה", "שקשוקה, פסטה ומרק". */
function joinHebrew(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} דק׳`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const h = hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`
  return rest === 0 ? h : `${h} ו־${rest} דק׳`
}
