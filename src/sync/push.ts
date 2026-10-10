/**
 * Push notifications: the 18:00 "today we're cooking" reminder and
 * cooking-mode timers that still go off with the phone locked.
 *
 * A web app can't schedule a notification on the phone itself, and on an
 * iPhone its code stops running as soon as it's in the background, so both
 * kinds are sent from the server: the phone works out what to send and when,
 * hands that to the `push` edge function, and pg_cron sends each one when it
 * comes due (supabase/functions/push, supabase/schema.sql).
 *
 * Push is per device, like the fridge: whether this phone gets notifications,
 * and which kinds, lives in `meta` and never syncs. It needs the Supabase
 * project (for the function) but not a signed-in kitchen. Like the AI
 * helpers, nothing here throws: a failed call just means no notification.
 */
import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, setMeta } from '../db/db'
import { alive } from '../db/repo'
import { addDays, toISODate } from '../engine/dates'
import { dailyReminders, REMINDER_DAYS_AHEAD } from '../engine/reminders'
import type { Reminder } from '../engine/reminders'
import { getSupabase, isSyncConfigured } from './supabase'

/** The server's VAPID public key — public by design; the private half is a function secret. */
const VAPID_PUBLIC_KEY =
  'BA13fF1ktUvb8NSTCBAbvHl0VZxJD-ATb53mK0Px_aDaqat9O9Cnm-sWBG8R0H3EHLJjdSX5rvU03ypGu-0UQyQ'

export interface PushPrefs {
  daily: boolean
  timers: boolean
}

const PREFS_KEY = 'push_prefs'
const DEFAULT_PREFS: PushPrefs = { daily: true, timers: true }
/** The last schedule sent, so an unchanged week isn't re-sent on every open. */
const SENT_KEY = 'push_daily_sent'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

/**
 * iPhones only allow push for a web app added to the home screen (iOS 16.4+);
 * in Safari itself PushManager just isn't there. That case is worth telling
 * apart from "this phone can't", since it's fixable.
 */
export function pushSupport(): PushSupport {
  if (!isSyncConfigured || !import.meta.env.PROD) return 'unsupported'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok'
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const installed = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !installed ? 'needs-install' : 'unsupported'
}

async function subscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/** On: notification permission given and this phone subscribed. */
export async function isPushEnabled(): Promise<boolean> {
  try {
    return Notification.permission === 'granted' && (await subscription()) !== null
  } catch {
    return false
  }
}

export async function getPushPrefs(): Promise<PushPrefs> {
  return { ...DEFAULT_PREFS, ...(await getMeta<Partial<PushPrefs>>(PREFS_KEY, {})) }
}

export async function setPushPrefs(prefs: PushPrefs): Promise<void> {
  await setMeta(PREFS_KEY, prefs)
  // Turning the reminder off has to clear what's already queued on the server.
  await setMeta(SENT_KEY, null)
  pushChanged()
}

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; status?: number }> {
  const client = await getSupabase()
  if (!client) return { ok: false }
  try {
    const { error } = await client.functions.invoke('push', { body })
    if (!error) return { ok: true }
    const status = (error as { context?: Response }).context?.status
    return { ok: false, status }
  } catch {
    return { ok: false }
  }
}

/**
 * Asks for permission (which must come from a tap — the button in Settings)
 * and registers this phone with the server. Returns why it didn't work, or
 * null when it did.
 */
export async function enablePush(): Promise<string | null> {
  if (pushSupport() !== 'ok') return 'המכשיר הזה לא תומך בהתראות'
  if (Notification.permission === 'denied') {
    return 'ההתראות חסומות. אפשר להפעיל אותן בהגדרות של הטלפון.'
  }
  let sub: PushSubscription
  try {
    // subscribe() goes first, straight from the tap, and asks for permission
    // itself. Safari refuses it as "not from a user gesture" if it comes
    // after awaiting Notification.requestPermission(): by the time the
    // permission prompt is answered, the tap no longer counts.
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return 'האפליקציה עוד נטענת. נסה שוב בעוד רגע.'
    // Some phones never answer at all (Firefox on Android, when its push
    // service can't be reached), which would leave the button on "מפעיל…"
    // forever. Give up after a while and say so instead.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 20_000),
    )
    sub =
      (await registration.pushManager.getSubscription()) ??
      (await Promise.race([
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
        }),
        timeout,
      ]))
  } catch (e) {
    if (e instanceof Error && e.message === 'timeout') {
      return 'הטלפון לא ענה לבקשת ההרשמה להתראות. כנראה שירות ההתראות של הטלפון חסום או לא זמין.'
    }
    // Read again: the prompt inside subscribe() may just have been answered "no".
    if ((Notification.permission as NotificationPermission) === 'denied') {
      return 'ההתראות חסומות. אפשר להפעיל אותן בהגדרות של הטלפון.'
    }
    // The phone's own reason, so a failure can be told apart from the rest.
    return `לא הצלחתי להירשם להתראות (${e instanceof Error ? `${e.name}: ${e.message}` : String(e)})`
  }
  if (!(await call({ action: 'subscribe', subscription: sub.toJSON() })).ok) {
    return 'לא הצלחתי להירשם להתראות. בדוק את החיבור לרשת ונסה שוב.'
  }
  await setMeta(SENT_KEY, null)
  pushChanged()
  return null
}

export async function disablePush(): Promise<void> {
  const sub = await subscription()
  if (sub) {
    await call({ action: 'unsubscribe', endpoint: sub.endpoint })
    await sub.unsubscribe().catch(() => {})
  }
  await setMeta(SENT_KEY, null)
  pushChanged()
}

/**
 * Hands the server this phone's daily reminders, replacing whatever it had.
 * A 409 means the server no longer knows this phone (it dropped it, or the
 * database was reset) — re-register once and try again.
 */
async function sendSchedule(reminders: Reminder[]): Promise<boolean> {
  const sub = await subscription()
  if (!sub) return false
  const body = { action: 'schedule', endpoint: sub.endpoint, reminders }
  const result = await call(body)
  if (result.status !== 409) return result.ok
  if (!(await call({ action: 'subscribe', subscription: sub.toJSON() })).ok) return false
  return (await call(body)).ok
}

/** Queues a cooking-mode timer on the server, so it goes off even with the phone locked. */
export async function scheduleTimerPush(id: string, endsAt: number, label: string): Promise<void> {
  const [sub, prefs] = await Promise.all([subscription(), getPushPrefs()])
  if (!sub || !prefs.timers || Notification.permission !== 'granted') return
  await call({
    action: 'timer',
    endpoint: sub.endpoint,
    id,
    fire_at: new Date(endsAt).toISOString(),
    title: 'הזמן נגמר ⏰',
    body: label,
  })
}

/** The timer was dismissed, or rang in the open app — the server copy isn't needed. */
export async function cancelTimerPush(id: string): Promise<void> {
  const sub = await subscription()
  if (sub) await call({ action: 'cancel', endpoint: sub.endpoint, id })
}

// Settings changes re-run the schedule hook without waiting for a data change.
const listeners = new Set<() => void>()
function pushChanged() {
  listeners.forEach((fn) => fn())
}

/**
 * Keeps the server's copy of this phone's daily reminders matching the plan.
 * Runs from the app shell: on open, whenever the coming days' cooking changes,
 * and when the push settings change. Only sends when the schedule actually
 * differs from the last one sent, so most opens cost nothing.
 */
export function usePushSchedule(householdId: string | undefined) {
  const today = toISODate(new Date())
  const data = useLiveQuery(async () => {
    if (!householdId) return null
    const [sessions, dishes, components] = await Promise.all([
      db.cookSessions
        .where('cook_date')
        .between(today, addDays(today, REMINDER_DAYS_AHEAD), true, true)
        .toArray(),
      db.dishes.where('household_id').equals(householdId).toArray(),
      db.components.where('household_id').equals(householdId).toArray(),
    ])
    return {
      sessions: alive(sessions).filter((s) => s.household_id === householdId),
      dishes,
      components,
    }
  }, [householdId, today])

  useEffect(() => {
    if (!data || pushSupport() !== 'ok') return
    let cancelled = false
    const sync = async () => {
      if (!(await isPushEnabled())) return
      const prefs = await getPushPrefs()
      const reminders = prefs.daily
        ? dailyReminders(data.sessions, data.dishes, data.components, new Date())
        : []
      const signature = JSON.stringify(reminders)
      if (cancelled || signature === (await getMeta<string | null>(SENT_KEY, null))) return
      if (await sendSchedule(reminders)) await setMeta(SENT_KEY, signature)
    }
    void sync()
    listeners.add(sync)
    return () => {
      cancelled = true
      listeners.delete(sync)
    }
  }, [data])
}

function base64UrlToBytes(value: string): ArrayBuffer {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer
}
