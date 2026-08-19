/**
 * First-run library import.
 *
 * The seed file is the starting point your girlfriend put together — 74 dishes and
 * 28 components. It is not a closed catalogue: everything here is editable, and the
 * three add paths (library +, roulette shortcut, bulk paste) keep it growing.
 */
import seedData from './seed-data.json'
import { db } from './db'
import { newId, now, saveMany, setCurrentHouseholdId } from './repo'
import { DEFAULT_SETTINGS } from '../types'
import type { Component, ComponentType, Dish, Household } from '../types'

interface SeedDish {
  name: string
  prep_time_minutes: number
  max_cover_days: number
  is_active: boolean
  fixed_servings: number | null
  ingredients: unknown[]
}

interface SeedComponent {
  name: string
  type: string
  prep_time_minutes: number
  is_active: boolean
  ingredients: unknown[]
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

/** Import the bundled starter library into an existing household. */
export async function importSeedLibrary(householdId: string): Promise<{
  dishes: number
  components: number
}> {
  const data = seedData as { dishes: SeedDish[]; components: SeedComponent[] }

  const existingDishNames = new Set(
    (await db.dishes.where('household_id').equals(householdId).toArray())
      .filter((d) => !d.deleted_at)
      .map((d) => d.name.trim()),
  )
  const existingComponentNames = new Set(
    (await db.components.where('household_id').equals(householdId).toArray())
      .filter((c) => !c.deleted_at)
      .map((c) => `${c.type}:${c.name.trim()}`),
  )

  const dishes: Dish[] = data.dishes
    .filter((d) => !existingDishNames.has(d.name.trim()))
    .map((d) => ({
      ...blankDish(householdId, d.name, d.prep_time_minutes),
      max_cover_days: d.max_cover_days,
      fixed_servings: d.fixed_servings,
      is_active: d.is_active,
    }))

  const components: Component[] = data.components
    .filter((c) => !existingComponentNames.has(`${c.type}:${c.name.trim()}`))
    .map((c) => ({
      ...blankComponent(householdId, c.name, c.type as ComponentType, c.prep_time_minutes),
      is_active: c.is_active,
    }))

  if (dishes.length) await saveMany('dishes', dishes)
  if (components.length) await saveMany('components', components)

  return { dishes: dishes.length, components: components.length }
}

export const SEED_COUNTS = {
  dishes: (seedData as { dishes: unknown[] }).dishes.length,
  components: (seedData as { components: unknown[] }).components.length,
}
