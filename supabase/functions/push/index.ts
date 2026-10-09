// Supabase Edge Function (Deno) — Web Push for the 18:00 cooking reminder
// and cooking-mode timers. The phone decides what to send and when (see
// src/sync/push.ts); this function stores it and, when pg_cron wakes it
// (supabase/schema.sql), sends whatever has come due.
//
// Actions, all POST { action, ... }:
//   subscribe   { subscription }         — remember this phone's push endpoint
//   unsubscribe { endpoint }             — forget it, and everything queued for it
//   schedule    { endpoint, reminders }  — replace the phone's daily reminders
//   timer       { endpoint, id, fire_at, title, body } — queue one timer
//   cancel      { endpoint, id }         — drop a timer before it goes off
//   send                                 — pg_cron only (x-cron-secret header)
//
// A phone is known only by its endpoint, an unguessable URL from Apple's or
// Google's push service, so there's no login: knowing the endpoint is the
// permission. Endpoints are checked against the real push services so this
// can't be used to POST at arbitrary URLs.
//
// Deploy: supabase functions deploy push --no-verify-jwt
//   (pg_cron calls it without a user JWT; the cron secret guards `send`.)
// Secrets used: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_CRON_SECRET
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.)

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
]
// Caps per phone, so a misbehaving client can't fill the table.
const MAX_DAILY = 14
const MAX_TIMERS = 20
// A message more than this late (the cron was down, say) is dropped, not sent:
// "the rice is ready" an hour later only confuses.
const STALE_MS = 60 * 60_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
  } catch {
    return false
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const validTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  try {
    const body = await req.json()

    switch (body.action) {
      case 'subscribe': {
        const sub = body.subscription
        if (!validEndpoint(sub?.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
          return json({ error: 'bad subscription' }, 400)
        }
        const { error } = await db.from('push_subscriptions').upsert({
          endpoint: sub.endpoint,
          p256dh: text(sub.keys.p256dh, 200),
          auth: text(sub.keys.auth, 100),
          updated_at: new Date().toISOString(),
        })
        if (error) throw error
        return json({ ok: true })
      }

      case 'unsubscribe': {
        if (!validEndpoint(body.endpoint)) return json({ error: 'bad endpoint' }, 400)
        await db.from('push_subscriptions').delete().eq('endpoint', body.endpoint)
        return json({ ok: true })
      }

      case 'schedule': {
        if (!validEndpoint(body.endpoint) || !Array.isArray(body.reminders)) {
          return json({ error: 'bad request' }, 400)
        }
        const rows = body.reminders
          .filter((r: Record<string, unknown>) => validTime(r?.fire_at))
          .slice(0, MAX_DAILY)
          .map((r: Record<string, unknown>) => ({
            endpoint: body.endpoint,
            kind: 'daily',
            tag: text(r.tag, 60) || 'daily',
            fire_at: r.fire_at,
            title: text(r.title, 120),
            body: text(r.body, 300),
          }))
        const { error: delError } = await db
          .from('push_messages')
          .delete()
          .eq('endpoint', body.endpoint)
          .eq('kind', 'daily')
        if (delError) throw delError
        if (rows.length > 0) {
          // Fails with a foreign-key error if the phone was never subscribed
          // (or was dropped as expired) — the client re-subscribes on that.
          const { error } = await db.from('push_messages').insert(rows)
          if (error) return json({ error: 'not subscribed' }, 409)
        }
        return json({ ok: true, scheduled: rows.length })
      }

      case 'timer': {
        if (!validEndpoint(body.endpoint) || typeof body.id !== 'string' || !validTime(body.fire_at)) {
          return json({ error: 'bad request' }, 400)
        }
        const { count } = await db
          .from('push_messages')
          .select('id', { count: 'exact', head: true })
          .eq('endpoint', body.endpoint)
          .eq('kind', 'timer')
        if ((count ?? 0) >= MAX_TIMERS) return json({ error: 'too many timers' }, 429)
        const { error } = await db.from('push_messages').insert({
          id: body.id,
          endpoint: body.endpoint,
          kind: 'timer',
          tag: `timer-${body.id}`,
          fire_at: body.fire_at,
          title: text(body.title, 120),
          body: text(body.body, 300),
        })
        if (error) return json({ error: 'not subscribed' }, 409)
        return json({ ok: true })
      }

      case 'cancel': {
        if (!validEndpoint(body.endpoint) || typeof body.id !== 'string') {
          return json({ error: 'bad request' }, 400)
        }
        await db.from('push_messages').delete().eq('id', body.id).eq('endpoint', body.endpoint)
        return json({ ok: true })
      }

      case 'send': {
        const secret = Deno.env.get('PUSH_CRON_SECRET')
        if (!secret || req.headers.get('x-cron-secret') !== secret) {
          return json({ error: 'forbidden' }, 403)
        }
        return json(await sendDue(db))
      }

      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

interface DueRow {
  endpoint: string
  kind: 'daily' | 'timer'
  tag: string
  fire_at: string
  title: string
  body: string
}

// deno-lint-ignore no-explicit-any
async function sendDue(db: any): Promise<{ sent: number; dropped: number; failures: string[] }> {
  webpush.setVapidDetails(
    'https://idanlachovitz.github.io/MealRoulette/',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  // Claimed by deleting them: if two cron runs overlap, each message is
  // returned to exactly one of them, so nothing is sent twice.
  const cutoff = new Date(Date.now() - 5_000).toISOString()
  const { data: due, error } = await db
    .from('push_messages')
    .delete()
    .lte('fire_at', cutoff)
    .select('endpoint, kind, tag, fire_at, title, body')
  if (error) throw error
  const rows = (due ?? []) as DueRow[]
  if (rows.length === 0) return { sent: 0, dropped: 0, failures: [] }

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('endpoint', [...new Set(rows.map((r) => r.endpoint))])
  const subByEndpoint = new Map(
    ((subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]).map((s) => [s.endpoint, s]),
  )

  let sent = 0
  let dropped = 0
  // Why each send failed, returned to pg_cron — it lands in net._http_response,
  // the one place to look when a notification never arrived.
  const failures: string[] = []
  await Promise.all(
    rows.map(async (row) => {
      const sub = subByEndpoint.get(row.endpoint)
      if (!sub || Date.now() - Date.parse(row.fire_at) > STALE_MS) {
        dropped++
        return
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: row.title, body: row.body, tag: row.tag }),
          { TTL: row.kind === 'timer' ? 600 : 3 * 3600, urgency: 'high' },
        )
        sent++
      } catch (e) {
        dropped++
        // 404/410: the phone unsubscribed or the app was removed — forget it,
        // along with anything else queued for it.
        const status = (e as { statusCode?: number }).statusCode
        failures.push(`${status ?? '-'} ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
        if (status === 404 || status === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', row.endpoint)
        }
      }
    }),
  )
  return { sent, dropped, failures }
}
