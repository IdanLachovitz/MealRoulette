/**
 * Optional, network-only upgrade over engine/fridge.ts's local template
 * generator: asks the "generate-dish" Supabase Edge Function (a thin proxy
 * to Groq's free API — see supabase/functions/generate-dish) for a real
 * suggestion using only the given ingredients.
 *
 * Every failure path — sync not configured, offline, the function erroring —
 * resolves to null rather than throwing, so callers can always fall back to
 * the instant local generator without their own try/catch.
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
