/**
 * Every write in the app goes through here.
 *
 * The rule from the architecture note: write locally first, update the UI, then
 * queue for the server. Nothing in the UI ever awaits the network.
 */
import { db, getMeta, setMeta, TABLE_MAP } from './db'
import type { SyncTable } from './db'
import type { Synced } from '../types'
import { requestSync } from '../sync/sync'

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function now(): string {
  return new Date().toISOString()
}

export async function currentHouseholdId(): Promise<string> {
  return getMeta<string>('household_id', '')
}

export async function setCurrentHouseholdId(id: string): Promise<void> {
  await setMeta('household_id', id)
}

/** Local write + outbox entry, in one transaction so they cannot diverge. */
export async function save<T extends Synced>(table: SyncTable, row: T): Promise<T> {
  const stamped = { ...row, updated_at: now() }
  await db.transaction('rw', TABLE_MAP[table]() as never, db.outbox, async () => {
    await (TABLE_MAP[table]() as never as { put(v: unknown): Promise<unknown> }).put(stamped)
    await db.outbox.add({
      table,
      row_id: stamped.id,
      payload: stamped,
      queued_at: now(),
      attempts: 0,
      last_error: null,
    })
  })
  requestSync()
  return stamped
}

export async function saveMany<T extends Synced>(table: SyncTable, rows: T[]): Promise<T[]> {
  const stamped = rows.map((r) => ({ ...r, updated_at: now() }))
  await db.transaction('rw', TABLE_MAP[table]() as never, db.outbox, async () => {
    await (TABLE_MAP[table]() as never as { bulkPut(v: unknown[]): Promise<unknown> }).bulkPut(
      stamped,
    )
    await db.outbox.bulkAdd(
      stamped.map((s) => ({
        table,
        row_id: s.id,
        payload: s,
        queued_at: now(),
        attempts: 0,
        last_error: null,
      })),
    )
  })
  requestSync()
  return stamped
}

/**
 * Soft delete. Rows are tombstoned rather than dropped so the other device learns
 * about the deletion on its next pull instead of resurrecting the row.
 */
export async function remove<T extends Synced>(table: SyncTable, row: T): Promise<void> {
  await save(table, { ...row, deleted_at: now() })
}

export function alive<T extends Synced>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => !r.deleted_at)
}
