/**
 * Push-then-pull sync loop.
 *
 * Push: drain the outbox, oldest first. A failed row stays queued and is retried.
 * Pull: ask the server for everything in this household changed since our last
 *       watermark, and merge it in.
 *
 * Conflicts are Last Write Wins on updated_at, with one exception: a locally
 * locked cook session wins even against a newer remote write, because a lock is
 * an explicit "do not touch this" from the user (FR-4.3).
 */
import { db, getMeta, setMeta, TABLE_MAP } from '../db/db'
import type { SyncTable } from '../db/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CookSession, Synced } from '../types'
import { getSupabase, isSyncConfigured } from './supabase'

const WATERMARK_KEY = 'sync_watermark'
const TABLES: SyncTable[] = [
  'households',
  'dishes',
  'components',
  'week_plans',
  'cook_sessions',
  'day_slots',
  'cook_history',
  'shopping_items',
]

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error'

let state: SyncState = isSyncConfigured ? 'idle' : 'off'
let pendingCount = 0
let running = false
let queuedAgain = false
const listeners = new Set<() => void>()

export function getSyncState(): { state: SyncState; pending: number } {
  return { state, pending: pendingCount }
}

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(next: SyncState) {
  state = next
  listeners.forEach((l) => l())
}

/** Fire-and-forget nudge. Safe to call on every write. */
export function requestSync(): void {
  if (!isSyncConfigured) return
  if (running) {
    queuedAgain = true
    return
  }
  void runSync()
}

export async function runSync(): Promise<void> {
  if (!isSyncConfigured) return
  if (running) {
    queuedAgain = true
    return
  }
  running = true
  emit('syncing')

  try {
    const client = await getSupabase()!
    const { data } = await client.auth.getSession()
    if (!data.session) {
      // Not signed in yet — stay local, the outbox keeps everything safe.
      pendingCount = await db.outbox.count()
      emit('idle')
      return
    }
    await push(client)
    await pull(client)
    pendingCount = await db.outbox.count()
    emit('idle')
  } catch (err) {
    pendingCount = await db.outbox.count()
    emit(navigator.onLine ? 'error' : 'offline')
    console.warn('[sync]', err)
  } finally {
    running = false
    if (queuedAgain) {
      queuedAgain = false
      void runSync()
    }
  }
}

async function push(client: SupabaseClient): Promise<void> {
  const batch = await db.outbox.orderBy('seq').limit(200).toArray()
  if (batch.length === 0) return

  // Collapse repeated writes to the same row — only the last payload matters.
  const latest = new Map<string, (typeof batch)[number]>()
  for (const row of batch) latest.set(`${row.table}:${row.row_id}`, row)

  const byTable = new Map<SyncTable, unknown[]>()
  for (const row of latest.values()) {
    const list = byTable.get(row.table) ?? []
    list.push(row.payload)
    byTable.set(row.table, list)
  }

  for (const [table, rows] of byTable) {
    const { error } = await client.from(table).upsert(rows as never[], { onConflict: 'id' })
    if (error) throw error
  }

  await db.outbox.bulkDelete(batch.map((b) => b.seq!).filter(Boolean) as number[])
}

async function pull(client: SupabaseClient): Promise<void> {
  const since = await getMeta<string>(WATERMARK_KEY, '1970-01-01T00:00:00Z')
  let newest = since

  for (const table of TABLES) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(1000)
    if (error) throw error
    if (!data || data.length === 0) continue

    await applyRemote(table, data as Synced[])
    const last = data[data.length - 1] as Synced
    if (last.updated_at > newest) newest = last.updated_at
  }

  if (newest !== since) await setMeta(WATERMARK_KEY, newest)
}

/** Merge a batch of server rows into the local tables under the LWW rules. */
export async function applyRemote(table: SyncTable, rows: Synced[]): Promise<void> {
  const dexieTable = TABLE_MAP[table]() as unknown as {
    get(id: string): Promise<Synced | undefined>
    bulkPut(rows: unknown[]): Promise<unknown>
  }

  const toWrite: Synced[] = []
  for (const remote of rows) {
    const local = await dexieTable.get(remote.id)
    if (local && shouldKeepLocal(table, local, remote)) continue
    toWrite.push(remote)
  }
  if (toWrite.length) await dexieTable.bulkPut(toWrite)
}

export function shouldKeepLocal(table: SyncTable, local: Synced, remote: Synced): boolean {
  // A locked session is the user saying "leave this alone" — it outranks recency.
  if (table === 'cook_sessions') {
    const localSession = local as CookSession
    const remoteSession = remote as CookSession
    if (localSession.is_locked && !remoteSession.is_locked) return true
  }
  return local.updated_at > remote.updated_at
}

/** Realtime + connectivity wiring. Called once at start-up. */
export function startSync(householdId: string): () => void {
  if (!isSyncConfigured) return () => {}

  // The client arrives asynchronously now that it is a lazy chunk, so the teardown
  // has to cope with a channel that may not exist yet.
  let teardownChannel: (() => void) | null = null
  let cancelled = false
  void getSupabase()!.then((client) => {
    if (cancelled) return
    const channel = client
      .channel(`household:${householdId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', filter: `household_id=eq.${householdId}` },
        () => requestSync(),
      )
      .subscribe()
    teardownChannel = () => void client.removeChannel(channel)
  })

  const onOnline = () => requestSync()
  const onVisible = () => {
    if (document.visibilityState === 'visible') requestSync()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', () => emit('offline'))
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(requestSync, 60_000)

  void runSync()

  return () => {
    cancelled = true
    teardownChannel?.()
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
