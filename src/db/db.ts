import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type {
  Component,
  CookHistory,
  CookSession,
  DaySlot,
  Dish,
  Household,
  ShoppingItem,
  WeekPlan,
} from '../types'

/**
 * One row per pending write. The UI never waits on this: it writes to the local
 * table, drops a row here, and the sync loop drains it whenever there is network.
 */
export interface OutboxRow {
  seq?: number
  table: SyncTable
  row_id: string
  /** Full row payload — we push whole rows, so a retry is always idempotent. */
  payload: unknown
  queued_at: string
  attempts: number
  last_error: string | null
}

export interface MetaRow {
  key: string
  value: unknown
}

export type SyncTable =
  | 'households'
  | 'dishes'
  | 'components'
  | 'week_plans'
  | 'cook_sessions'
  | 'day_slots'
  | 'cook_history'
  | 'shopping_items'

export class MealDb extends Dexie {
  households!: EntityTable<Household, 'id'>
  dishes!: EntityTable<Dish, 'id'>
  components!: EntityTable<Component, 'id'>
  weekPlans!: EntityTable<WeekPlan, 'id'>
  cookSessions!: EntityTable<CookSession, 'id'>
  daySlots!: EntityTable<DaySlot, 'id'>
  cookHistory!: EntityTable<CookHistory, 'id'>
  shoppingItems!: EntityTable<ShoppingItem, 'id'>
  outbox!: EntityTable<OutboxRow, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('meal-roulette')
    this.version(1).stores({
      households: 'id, updated_at',
      dishes: 'id, household_id, name, is_active, is_excluded, updated_at',
      components: 'id, household_id, type, is_active, is_excluded, updated_at',
      weekPlans: 'id, household_id, week_start_date, status, updated_at',
      cookSessions: 'id, week_plan_id, cook_date, updated_at',
      daySlots: 'id, week_plan_id, date, updated_at',
      cookHistory: 'id, household_id, entity_id, cooked_on, updated_at',
      shoppingItems: 'id, week_plan_id, aisle, updated_at',
      outbox: '++seq, table, row_id',
      meta: 'key',
    })
  }
}

export const db = new MealDb()

/** Table name in Postgres -> Dexie table. */
export const TABLE_MAP = {
  households: () => db.households,
  dishes: () => db.dishes,
  components: () => db.components,
  week_plans: () => db.weekPlans,
  cook_sessions: () => db.cookSessions,
  day_slots: () => db.daySlots,
  cook_history: () => db.cookHistory,
  shopping_items: () => db.shoppingItems,
} as const

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
