/**
 * First-run library import.
 *
 * The seed file is the starting point your girlfriend put together — 74 dishes and
 * 28 components. It is not a closed catalogue: everything here is editable, and the
 * three add paths (library +, roulette shortcut, bulk paste) keep it growing.
 */
import seedData from './seed-data.json'
import { db } from './db'
import { newId, now, save, saveMany, setCurrentHouseholdId } from './repo'
import { DEFAULT_SETTINGS } from '../types'
import type { Component, ComponentType, Dish, Household, Ingredient } from '../types'

interface SeedDish {
  name: string
  prep_time_minutes: number
  max_cover_days: number
  is_active: boolean
  fixed_servings: number | null
  ingredients: Ingredient[]
  image_url?: string
}

interface SeedComponent {
  name: string
  type: string
  prep_time_minutes: number
  is_active: boolean
  ingredients: Ingredient[]
}

export function makeInviteCode(): string {
  // No 0/O/1/I — this gets read aloud and typed on a phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
    '',
  )
}

export function blankDish(householdId: string, name: string, prepTime: number): Dish {
  return {
    id: newId(),
    household_id: householdId,
    updated_at: now(),
    deleted_at: null,
    name: name.trim(),
    prep_time_minutes: prepTime,
    effort: 'בינוני',
    tags: [],
    base_servings: DEFAULT_SETTINGS.default_diners,
    fixed_servings: null,
    max_cover_days: 1,
    ingredients: [],
    is_active: true,
    is_excluded: false,
    image_url: null,
    created_by: null,
  }
}

export function blankComponent(
  householdId: string,
  name: string,
  type: ComponentType,
  prepTime: number,
): Component {
  return {
    id: newId(),
    household_id: householdId,
    updated_at: now(),
    deleted_at: null,
    name: name.trim(),
    type,
    prep_time_minutes: prepTime,
    base_servings: DEFAULT_SETTINGS.default_diners,
    ingredients: [],
    is_active: true,
    is_excluded: false,
  }
}

export async function createHousehold(name = 'המטבח שלנו', diners = 2): Promise<Household> {
  const household: Household = {
    id: newId(),
    household_id: '',
    updated_at: now(),
    deleted_at: null,
    name,
    invite_code: makeInviteCode(),
    settings: { ...DEFAULT_SETTINGS, default_diners: diners },
  }
  household.household_id = household.id
  await db.households.put(household)
  await setCurrentHouseholdId(household.id)
  return household
}

/** A seed dish's image_url is a path relative to the app root (e.g. "dish-photos/dish-01.jpg"). */
function seedImageUrl(path: string | undefined): string | null {
  return path ? import.meta.env.BASE_URL + path : null
}

/**
 * Import the bundled starter library into a household.
 *
 * Safe to run more than once: a seed item whose name isn't in the household
 * yet gets inserted. A seed item that's already there is normally left alone
 * (it may have been edited since) — the exceptions are ingredients and the
 * photo, which get backfilled onto an already-imported item that still has
 * none, so a household that imported before that data existed picks it up
 * on the next import without losing any other edits or duplicating anything.
 * A dish with its own photo (AI-generated or manually uploaded) is never
 * overwritten by the seed's bundled one.
 */
export async function importSeedLibrary(householdId: string): Promise<{
  dishes: number
  components: number
  backfilled: number
}> {
  const data = seedData as { dishes: SeedDish[]; components: SeedComponent[] }

  const existingDishes = (await db.dishes.where('household_id').equals(householdId).toArray()).filter(
    (d) => !d.deleted_at,
  )
  const existingComponents = (
    await db.components.where('household_id').equals(householdId).toArray()
  ).filter((c) => !c.deleted_at)

  const dishByName = new Map(existingDishes.map((d) => [d.name.trim(), d]))
  const componentByKey = new Map(existingComponents.map((c) => [`${c.type}:${c.name.trim()}`, c]))

  const newDishes: Dish[] = []
  const backfillDishes: Dish[] = []
  for (const d of data.dishes) {
    const existing = dishByName.get(d.name.trim())
    if (!existing) {
      newDishes.push({
        ...blankDish(householdId, d.name, d.prep_time_minutes),
        max_cover_days: d.max_cover_days,
        fixed_servings: d.fixed_servings,
        is_active: d.is_active,
        ingredients: d.ingredients,
        image_url: seedImageUrl(d.image_url),
      })
    } else {
      const patch: Partial<Dish> = {}
      if (existing.ingredients.length === 0 && d.ingredients.length > 0) patch.ingredients = d.ingredients
      if (!existing.image_url && d.image_url) patch.image_url = seedImageUrl(d.image_url)
      if (Object.keys(patch).length > 0) backfillDishes.push({ ...existing, ...patch })
    }
  }

  const newComponents: Component[] = []
  const backfillComponents: Component[] = []
  for (const c of data.components) {
    const key = `${c.type}:${c.name.trim()}`
    const existing = componentByKey.get(key)
    if (!existing) {
      newComponents.push({
        ...blankComponent(householdId, c.name, c.type as ComponentType, c.prep_time_minutes),
        is_active: c.is_active,
        ingredients: c.ingredients,
      })
    } else if (existing.ingredients.length === 0 && c.ingredients.length > 0) {
      backfillComponents.push({ ...existing, ingredients: c.ingredients })
    }
  }

  if (newDishes.length) await saveMany('dishes', newDishes)
  if (newComponents.length) await saveMany('components', newComponents)
  for (const d of backfillDishes) await save('dishes', d)
  for (const c of backfillComponents) await save('components', c)

  return {
    dishes: newDishes.length,
    components: newComponents.length,
    backfilled: backfillDishes.length + backfillComponents.length,
  }
}

export const SEED_COUNTS = {
  dishes: (seedData as { dishes: unknown[] }).dishes.length,
  components: (seedData as { components: unknown[] }).components.length,
}
