// Domain model — mirrors section 5 of the spec (meal-planner-spec-he-v1.1.md).

export type ComponentType = 'protein' | 'carb' | 'veg'
export type Effort = 'קל' | 'בינוני' | 'מושקע'
export type Unit = 'גרם' | 'ק"ג' | 'יח\'' | 'כוס' | 'כף' | 'כפית' | 'מ"ל' | 'ליטר'
export type Aisle = 'ירקות' | 'בשר ודגים' | 'מוצרי חלב' | 'יבשים' | 'קפואים' | 'תבלינים' | 'אחר'

export const AISLES: Aisle[] = ['ירקות', 'בשר ודגים', 'מוצרי חלב', 'יבשים', 'קפואים', 'תבלינים', 'אחר']
export const UNITS: Unit[] = ['גרם', 'ק"ג', "יח'", 'כוס', 'כף', 'כפית', 'מ"ל', 'ליטר']
export const COMPONENT_LABEL: Record<ComponentType, string> = {
  protein: 'חלבון',
  carb: 'פחמימה',
  veg: 'ירק',
}

export interface Ingredient {
  name: string
  quantity: number | null
  unit: Unit | null
  /** Salt, oil, spices — not multiplied by diners. Spec FR-7.3. */
  is_scalable: boolean
  aisle: Aisle
}

/** Fields every synced row carries, for the write queue and LWW resolution. */
export interface Synced {
  id: string
  household_id: string
  updated_at: string
  deleted_at: string | null
}

export interface Dish extends Synced {
  name: string
  prep_time_minutes: number
  effort: Effort
  tags: string[]
  base_servings: number
  /** When set, the dish is always cooked in this amount regardless of diners. */
  fixed_servings: number | null
  /** Ceiling on how many days one cook of this dish can cover. */
  max_cover_days: number
  ingredients: Ingredient[]
  is_active: boolean
  /** "Never suggest this to me" — never released by the cooldown-relaxation pass. */
  is_excluded: boolean
  image_url: string | null
  created_by: string | null
}

export interface Component extends Synced {
  name: string
  type: ComponentType
  prep_time_minutes: number
  base_servings: number
  ingredients: Ingredient[]
  is_active: boolean
  is_excluded: boolean
}

export type WeekStatus = 'draft' | 'active' | 'archived'

export interface PlanningParams {
  cook_days_count: number
  include_leftovers: boolean
  /** null = no limit */
  max_prep_time: number | null
}

export interface WeekPlan extends Synced {
  week_start_date: string // YYYY-MM-DD
  planning_params: PlanningParams
  status: WeekStatus
}

export type SourceType = 'dish' | 'combo'

export interface CookSession extends Synced {
  week_plan_id: string
  cook_date: string
  source_type: SourceType
  dish_id: string | null
  protein_id: string | null
  carb_id: string | null
  veg_id: string | null
  /** 1..4, includes the cook day itself. */
  covers_days: number
  servings: number
  estimated_minutes: number
  is_locked: boolean
  is_cooked: boolean
  note: string | null
}

export type DayRole = 'cook' | 'leftovers' | 'none' | 'empty'

export interface DaySlot extends Synced {
  week_plan_id: string
  date: string
  role: DayRole
  cook_session_id: string | null
}

export type HistoryEntity = 'dish' | 'protein' | 'carb' | 'veg'

export interface CookHistory extends Synced {
  entity_type: HistoryEntity
  entity_id: string
  cooked_on: string
}

export interface ShoppingItem extends Synced {
  week_plan_id: string
  name: string
  quantity_text: string
  aisle: Aisle
  source: 'auto' | 'manual'
  is_checked: boolean
  /** Stable key used to re-match auto items across regenerations, so check marks survive. */
  match_key: string
}

export interface HouseholdSettings {
  default_diners: number
  dish_cooldown_days: number
  component_cooldown_days: number
  veg_enabled: boolean
  week_starts_on: 0 | 1
  default_cook_days_count: number
  max_prep_time_filter: number | null
}

export const DEFAULT_SETTINGS: HouseholdSettings = {
  default_diners: 2,
  dish_cooldown_days: 14,
  component_cooldown_days: 5,
  veg_enabled: true,
  week_starts_on: 0,
  default_cook_days_count: 3,
  max_prep_time_filter: null,
}

export interface Household extends Synced {
  name: string
  invite_code: string
  settings: HouseholdSettings
}
