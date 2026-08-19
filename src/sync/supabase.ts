import type { SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * The anon key is meant to ship in the client bundle — Row Level Security is what
 * actually guards the data, not the key. See supabase/schema.sql for the policies.
 *
 * With no credentials configured the app runs fully local: every screen works,
 * nothing syncs. That is a supported mode, not a broken one.
 */
export const isSyncConfigured = Boolean(url && anonKey)

let clientPromise: Promise<SupabaseClient> | null = null

/**
 * Loaded on demand rather than imported at start-up: the client is ~340 KB and
 * nothing on the first screen needs it, so it must not sit in the critical path
 * (NFR: first load under 2.5s on 3G).
 */
export function getSupabase(): Promise<SupabaseClient> | null {
  if (!isSyncConfigured) return null
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 5 } },
    }),
  )
  return clientPromise
}
