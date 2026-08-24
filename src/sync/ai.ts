/**
 * Optional, network-only AI helpers — thin proxies to Groq's free API via
 * Supabase Edge Functions (see supabase/functions/). Every failure path —
 * sync not configured, offline, the function erroring — resolves to null
 * rather than throwing, so callers can always fall back to a local
 * alternative without their own try/catch.
 */
import { isSyncConfigured, getSupabase } from './supabase'

export interface AiDish {
  name: string
  instructions: string
  ingredients: string[]
}

export async function generateDishWithAi(ingredients: string[]): Promise<AiDish | null> {
  if (!isSyncConfigured) return null
  const client = await getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client.functions.invoke('generate-dish', {
      body: { ingredients },
    })
    if (error || !data?.name) return null
    return data as AiDish
  } catch {
    return null
  }
}

/**
 * One-time picture generation for a dish with no photo yet (see
 * supabase/functions/generate-dish-image): Groq writes an English
 * food-photography prompt from the Hebrew name, an authenticated
 * Pollinations.ai request renders it, and the function hands back a ready
 * data URL — same shape as a manually uploaded photo, so it drops straight
 * into Dish.image_url.
 *
 * This used to fetch the image from the browser instead of here, because
 * Pollinations' *anonymous* tier is rate-limited per source and Supabase
 * Edge Functions share egress IPs across unrelated projects — that shared
 * anonymous pool was saturated well beyond anything our own traffic caused.
 * Now that the function authenticates with a real Pollinations API key
 * (POLLINATIONS_API_KEY), quota is tracked by account, not by source IP, so
 * that workaround is no longer needed.
 */
export async function generateDishImageWithAi(
  name: string,
  ingredients: string[],
): Promise<string | null> {
  if (!isSyncConfigured) return null
  const client = await getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client.functions.invoke('generate-dish-image', {
      body: { name, ingredients },
    })
    if (error || typeof data?.image_data_url !== 'string') return null
    return data.image_data_url
  } catch {
    return null
  }
}

export interface CandidateDish {
  id: string
  name: string
  prep_time_minutes: number
}

/**
 * Optional preference signal for the weekly wizard (see
 * PlannerInput.preferredDishIds) — asks "pick-week-dishes" for a varied
 * shortlist from the given candidates. Never throws, never required: an
 * empty/null result just means the planner falls back to its own picks.
 */
export async function pickWeekDishesWithAi(
  candidates: CandidateDish[],
  count: number,
  recentNames: string[],
): Promise<string[] | null> {
  if (!isSyncConfigured || candidates.length === 0 || count < 1) return null
  const client = await getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client.functions.invoke('pick-week-dishes', {
      body: { dishes: candidates, count, recentNames },
    })
    if (error || !Array.isArray(data?.dish_ids)) return null
    const validIds = new Set(candidates.map((c) => c.id))
    const picked = data.dish_ids.filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id))
    return picked.length > 0 ? picked : null
  } catch {
    return null
  }
}
