/**
 * Household registration and joining.
 *
 * These two calls are the bridge between "a kitchen that exists on this phone"
 * and "a kitchen the server will let this account read". Everything else in the
 * sync layer assumes membership already exists, because RLS refuses every row
 * until it does.
 */
import { db, setMeta } from '../db/db'
import { setCurrentHouseholdId } from '../db/repo'
import { getSupabase } from './supabase'
import { runSync } from './sync'
import type { Household } from '../types'

/** Push the local kitchen to the server and make the signed-in user a member. */
export async function registerHousehold(household: Household): Promise<void> {
  const client = await getSupabase()
  if (!client) throw new Error('סנכרון לא מוגדר')

  const { error } = await client.rpc('create_household', {
    p_id: household.id,
    p_name: household.name,
    p_invite_code: household.invite_code,
    p_settings: household.settings,
  })
  if (error) throw error

  await runSync()
}

/**
 * Join the partner's kitchen with their 6-character code.
 *
 * The local library is left untouched rather than merged: the joiner switches to
 * the shared household, and their own dishes stay behind under the old id. That
 * is recoverable (export/import), whereas a silent merge is not.
 */
export async function joinHousehold(code: string): Promise<Household> {
  const client = await getSupabase()
  if (!client) throw new Error('סנכרון לא מוגדר')

  const { data, error } = await client.rpc('join_household', {
    p_invite_code: code.trim().toUpperCase(),
  })
  if (error) throw error
  if (!data) throw new Error('הקוד לא נמצא')

  const remote = (Array.isArray(data) ? data[0] : data) as Household
  await db.households.put({ ...remote, household_id: remote.id, deleted_at: null })
  await setCurrentHouseholdId(remote.id)

  // Re-pull from the beginning of time so the joined library arrives in full.
  await setMeta('sync_watermark', '1970-01-01T00:00:00Z')
  await runSync()

  return remote
}

export async function signOut(): Promise<void> {
  const client = await getSupabase()
  await client?.auth.signOut()
}

export async function currentUserEmail(): Promise<string | null> {
  const client = await getSupabase()
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session?.user.email ?? null
}
