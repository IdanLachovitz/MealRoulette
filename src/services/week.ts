/**
 * Everything that turns a plan into stored rows. The decisions are made by the
 * pure engine; this module only persists them.
 */
import { db } from '../db/db'
import { alive, newId, now, remove, save, saveMany } from '../db/repo'
import { addDays, startOfWeek, toISODate, weekDates } from '../engine/dates'
import { planWeek } from '../engine/planner'
import type { PlanResult, PlannerInput } from '../engine/planner'
import { buildShoppingList } from '../engine/shopping'
import { seedFrom } from '../engine/rng'
import type {
  Component,
  CookHistory,
  CookSession,
  DaySlot,
  Dish,
  HouseholdSettings,
  PlanningParams,
  ShoppingItem,
  WeekPlan,
} from '../types'

function base(householdId: string) {
  return { id: newId(), household_id: householdId, updated_at: now(), deleted_at: null }
}

export function currentWeekStart(settings: HouseholdSettings): string {
  return startOfWeek(toISODate(new Date()), settings.week_starts_on)
}

/** Find or create the plan for a week, along with its seven day slots. */
export async function ensureWeekPlan(
  householdId: string,
  weekStart: string,
  settings: HouseholdSettings,
): Promise<WeekPlan> {
  const existing = alive(
    await db.weekPlans.where('household_id').equals(householdId).toArray(),
  ).find((w) => w.week_start_date === weekStart)
  if (existing) return existing

  const plan: WeekPlan = {
    ...base(householdId),
    week_start_date: weekStart,
    planning_params: {
      cook_days_count: settings.default_cook_days_count,
      include_leftovers: true,
      max_prep_time: settings.max_prep_time_filter,
    },
    status: 'draft',
  }
  await save('week_plans', plan)

  const slots: DaySlot[] = weekDates(weekStart).map((date) => ({
    ...base(householdId),
    id: newId(),
    week_plan_id: plan.id,
    date,
    role: 'empty' as const,
    cook_session_id: null,
  }))
  await saveMany('day_slots', slots)

  // EC-10 — moving into a new week archives the previous active one.
  const stale = alive(await db.weekPlans.where('household_id').equals(householdId).toArray()).filter(
    (w) => w.id !== plan.id && w.status === 'active' && w.week_start_date < weekStart,
  )
  for (const old of stale) await save('week_plans', { ...old, status: 'archived' })

  return plan
}

export async function loadWeek(planId: string) {
  const [sessions, days] = await Promise.all([
    db.cookSessions.where('week_plan_id').equals(planId).toArray(),
    db.daySlots.where('week_plan_id').equals(planId).toArray(),
  ])
  return { sessions: alive(sessions), days: alive(days).sort((a, b) => a.date.localeCompare(b.date)) }
}

/** Run the wizard: build a plan with the engine, then write it. FR-4.2. */
export async function runPlanningWizard(
  householdId: string,
  plan: WeekPlan,
  params: PlanningParams,
  settings: HouseholdSettings,
  seed = seedFrom(`${plan.id}:${Date.now()}`),
): Promise<PlanResult> {
  const { sessions, days } = await loadWeek(plan.id)
  const dishes = alive(await db.dishes.where('household_id').equals(householdId).toArray())
  const history = alive(await db.cookHistory.where('household_id').equals(householdId).toArray())

  const locked = sessions.filter((s) => s.is_locked)
  // Re-running the wizard replaces every unlocked session below — capture
  // what they were before that happens, so a re-roll can't repeat a dish the
  // *previous* generation just proposed (see PlannerInput.previousSessionDishIds).
  const previousSessionDishIds = sessions
    .filter((s) => !s.is_locked)
    .map((s) => s.dish_id)
    .filter((id): id is string => !!id)
  const input: PlannerInput = {
    dates: weekDates(plan.week_start_date),
    excludedDates: days.filter((d) => d.role === 'none').map((d) => d.date),
    lockedSessions: locked.map((s) => ({
      cook_date: s.cook_date,
      covers_days: s.covers_days,
      dish_id: s.dish_id,
    })),
    dishes,
    history,
    params,
    settings,
    today: plan.week_start_date,
    seed,
    previousSessionDishIds,
  }

  const result = planWeek(input)

  // Unlocked sessions are replaced wholesale; locked ones survive untouched.
  for (const s of sessions.filter((x) => !x.is_locked)) await remove('cook_sessions', s)

  const lockedByDate = new Map(locked.map((s) => [s.cook_date, s]))
  const created: CookSession[] = []
  const indexToId = new Map<number, string>()

  result.sessions.forEach((draft, index) => {
    const existing = draft.is_locked ? lockedByDate.get(draft.cook_date) : undefined
    if (existing) {
      indexToId.set(index, existing.id)
      return
    }
    const dish = dishes.find((d) => d.id === draft.dish_id)
    const row: CookSession = {
      ...base(householdId),
      id: newId(),
      week_plan_id: plan.id,
      cook_date: draft.cook_date,
      source_type: 'dish',
      dish_id: draft.dish_id,
      protein_id: null,
      carb_id: null,
      veg_id: null,
      covers_days: draft.covers_days,
      servings: dish?.fixed_servings ?? settings.default_diners * draft.covers_days,
      estimated_minutes: draft.estimated_minutes,
      is_locked: false,
      is_cooked: false,
      note: null,
    }
    created.push(row)
    indexToId.set(index, row.id)
  })

  if (created.length) await saveMany('cook_sessions', created)

  const updatedDays = days.map((day) => {
    const assignment = result.days.find((d) => d.date === day.date)
    if (!assignment) return day
    return {
      ...day,
      role: assignment.role,
      cook_session_id:
        assignment.sessionIndex === null ? null : (indexToId.get(assignment.sessionIndex) ?? null),
    }
  })
  await saveMany('day_slots', updatedDays)
  await save('week_plans', { ...plan, planning_params: params })

  return result
}

export interface SessionDraft {
  source_type: 'dish' | 'combo'
  dish_id?: string | null
  protein_id?: string | null
  carb_id?: string | null
  veg_id?: string | null
  minutes: number
}

/** FR-2.3 / FR-3.6 — put a roulette result onto a day. */
export async function assignToDay(
  householdId: string,
  plan: WeekPlan,
  date: string,
  draft: SessionDraft,
  settings: HouseholdSettings,
  coversDays = 1,
): Promise<CookSession> {
  const { sessions, days } = await loadWeek(plan.id)

  // One cook per day: replace whatever unlocked session was already there.
  const clash = sessions.find((s) => s.cook_date === date && !s.is_locked)
  if (clash) await remove('cook_sessions', clash)

  const dish = draft.dish_id ? await db.dishes.get(draft.dish_id) : undefined
  const session: CookSession = {
    ...base(householdId),
    id: newId(),
    week_plan_id: plan.id,
    cook_date: date,
    source_type: draft.source_type,
    dish_id: draft.dish_id ?? null,
    protein_id: draft.protein_id ?? null,
    carb_id: draft.carb_id ?? null,
    veg_id: draft.veg_id ?? null,
    covers_days: coversDays,
    servings: dish?.fixed_servings ?? settings.default_diners * coversDays,
    estimated_minutes: draft.minutes,
    is_locked: false,
    is_cooked: false,
    note: null,
  }
  await save('cook_sessions', session)
  await relayoutDays(plan.id, days, [...sessions.filter((s) => s.id !== clash?.id), session])
  return session
}

/** FR-4.7 — changing coverage immediately re-flows the leftover days. */
export async function setCoversDays(
  session: CookSession,
  coversDays: number,
  settings: HouseholdSettings,
): Promise<void> {
  const dish = session.dish_id ? await db.dishes.get(session.dish_id) : undefined
  await save('cook_sessions', {
    ...session,
    covers_days: coversDays,
    servings: dish?.fixed_servings ?? settings.default_diners * coversDays,
  })
  const { sessions, days } = await loadWeek(session.week_plan_id)
  await relayoutDays(session.week_plan_id, days, sessions)
}

export async function deleteSession(session: CookSession): Promise<void> {
  await remove('cook_sessions', session)
  const { sessions, days } = await loadWeek(session.week_plan_id)
  await relayoutDays(session.week_plan_id, days, sessions)
}

export async function setDayRole(day: DaySlot, role: DaySlot['role']): Promise<void> {
  await save('day_slots', { ...day, role, cook_session_id: null })
  const { sessions, days } = await loadWeek(day.week_plan_id)
  await relayoutDays(
    day.week_plan_id,
    days.map((d) => (d.id === day.id ? { ...d, role, cook_session_id: null } : d)),
    sessions,
  )
}

/**
 * Recompute which day belongs to which session. Days the user marked "not cooking"
 * are preserved; everything else is derived from the sessions.
 */
async function relayoutDays(
  planId: string,
  days: DaySlot[],
  sessions: CookSession[],
): Promise<void> {
  const live = sessions.filter((s) => !s.deleted_at)
  const byDate = new Map(days.map((d) => [d.date, { ...d }]))
  for (const day of byDate.values()) {
    if (day.role === 'none') continue
    day.role = 'empty'
    day.cook_session_id = null
  }

  const cookDates = new Set(live.map((s) => s.cook_date))
  for (const session of live) {
    const cookDay = byDate.get(session.cook_date)
    if (!cookDay) continue
    cookDay.role = 'cook'
    cookDay.cook_session_id = session.id

    let placed = 1
    let cursor = session.cook_date
    while (placed < session.covers_days) {
      cursor = addDays(cursor, 1)
      const day = byDate.get(cursor)
      if (!day) break
      if (day.role === 'none') continue
      if (cookDates.has(cursor)) break
      day.role = 'leftovers'
      day.cook_session_id = session.id
      placed++
    }
  }

  await saveMany(
    'day_slots',
    [...byDate.values()].filter((d) => {
      const original = days.find((o) => o.id === d.id)
      return !original || original.role !== d.role || original.cook_session_id !== d.cook_session_id
    }),
  )
  void planId
}

/** FR-5.1 — one history row per component that took part. */
export async function markCooked(
  householdId: string,
  session: CookSession,
  cooked: boolean,
): Promise<void> {
  await save('cook_sessions', { ...session, is_cooked: cooked })

  const existing = alive(
    await db.cookHistory.where('household_id').equals(householdId).toArray(),
  ).filter((h) => h.cooked_on === session.cook_date)

  if (!cooked) {
    const ids = [session.dish_id, session.protein_id, session.carb_id, session.veg_id].filter(
      Boolean,
    )
    for (const row of existing.filter((h) => ids.includes(h.entity_id))) {
      await remove('cook_history', row)
    }
    return
  }

  const entries: CookHistory[] = []
  const push = (entity_type: CookHistory['entity_type'], entity_id: string | null) => {
    if (!entity_id) return
    if (existing.some((h) => h.entity_id === entity_id)) return
    entries.push({
      ...base(householdId),
      id: newId(),
      entity_type,
      entity_id,
      cooked_on: session.cook_date,
    })
  }

  if (session.source_type === 'dish') {
    push('dish', session.dish_id)
  } else {
    push('protein', session.protein_id)
    push('carb', session.carb_id)
    push('veg', session.veg_id)
  }
  if (entries.length) await saveMany('cook_history', entries)
}

/**
 * FR-7 — rebuild the automatic part of the list.
 * Manual rows survive untouched, and check marks survive for any auto row that is
 * still on the list (FR-7.6 / FR-7.7 / EC-20).
 */
export async function regenerateShoppingList(
  householdId: string,
  plan: WeekPlan,
  diners: number,
): Promise<void> {
  const { sessions } = await loadWeek(plan.id)
  const [dishes, components, existing] = await Promise.all([
    db.dishes.where('household_id').equals(householdId).toArray(),
    db.components.where('household_id').equals(householdId).toArray(),
    db.shoppingItems.where('week_plan_id').equals(plan.id).toArray(),
  ])

  const computed = buildShoppingList({
    sessions,
    dishes: new Map(dishes.map((d) => [d.id, d])),
    components: new Map(components.map((c) => [c.id, c])),
    diners,
  })

  const live = alive(existing)
  const previousAuto = new Map(live.filter((i) => i.source === 'auto').map((i) => [i.match_key, i]))

  const rows: ShoppingItem[] = computed.map((item) => {
    const prev = previousAuto.get(item.match_key)
    return {
      ...base(householdId),
      id: prev?.id ?? newId(),
      week_plan_id: plan.id,
      name: item.name,
      quantity_text: item.quantity_text,
      aisle: item.aisle,
      source: 'auto',
      is_checked: prev?.is_checked ?? false,
      match_key: item.match_key,
    }
  })

  const keptKeys = new Set(computed.map((c) => c.match_key))
  for (const stale of previousAuto.values()) {
    if (!keptKeys.has(stale.match_key)) await remove('shopping_items', stale)
  }

  if (rows.length) await saveMany('shopping_items', rows)
}

/** FR-4.8 — confirming the plan activates the week and builds the list. */
export async function activateWeek(
  householdId: string,
  plan: WeekPlan,
  diners: number,
): Promise<void> {
  await save('week_plans', { ...plan, status: 'active' })
  await regenerateShoppingList(householdId, plan, diners)
}

export type { Dish, Component }
