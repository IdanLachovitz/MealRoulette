/**
 * Which protein + carb + veg combos make sense together, and drawing one.
 *
 * Every ring used to be drawn on its own, so the wheel happily landed on
 * אטריות אורז + קבב + סלט בוראטה: three fine components that nobody would
 * put on one plate. Components carry no cuisine field, and the library is
 * user-editable, so the cuisine is inferred from each component's name and
 * ingredients by keyword. A component that matches nothing (חזה עוף, אורז
 * לבן, סלט חסה) is neutral and goes with anything, so a library of custom
 * components with no recognisable keywords still draws exactly as before.
 *
 * Pure and seeded like the rest of the roulette, so it is unit-tested
 * without a browser.
 */
import type { Component, ComponentType } from '../types'
import type { Rng } from './rng'

export type Cuisine = 'asian' | 'italian' | 'mideast' | 'homestyle'

/**
 * Keywords per cuisine, matched as substrings of the name and every
 * ingredient name. Kept to words that really pin a cuisine down; generic
 * ones (שום, בצל, עגבנייה) would tag everything and decide nothing. Sides
 * that go with anything stay untagged on purpose: מוקפץ alone (garlic
 * broccoli is fine next to a schnitzel) and מלפפון (the Israeli salad sits
 * next to pasta as happily as next to kebab).
 */
const CUISINE_KEYWORDS: Record<Cuisine, string[]> = {
  asian: ['אטריות', 'נודלס', 'סויה', "ג'ינג'ר", 'ג׳ינג׳ר', "בוק צ'וי", 'בוק צ׳וי', 'טריאקי', 'שומשום', 'סומסום', "צ'ילי מתוק", 'קארי', 'חלב קוקוס', 'וואסאבי', 'מיסו'],
  italian: ['פסטה', 'ספגטי', 'ניוקי', 'ריזוטו', 'פולנטה', 'בוראטה', 'מוצרלה', "קרפצ'יו", 'קרפצ׳יו', 'פרמזן', 'פסטו', 'בזיליקום', 'קייסר', 'טונה'],
  mideast: ['קוסקוס', 'פתיתים', 'אורז צהוב', 'כורכום', 'קבב', 'פרגיות', 'שווארמה', 'טחינה', 'ברוטב אדום', 'כמון', 'בהרט', "מג'דרה", 'מג׳דרה', 'פיתה', 'חומוס'],
  homestyle: ['שניצל', 'נקניקיות', "צ'יפס", 'צ׳יפס', 'פירה', 'המבורגר', 'קציצות', 'תפו"א', 'תפוח אדמה'],
}

/**
 * Cuisine pairs that don't belong on one plate. Asian sides clash with
 * everything else; Italian and Middle Eastern don't mix (פסטה + קבב,
 * קוסקוס + בוראטה). Homestyle is the Israeli weeknight default and sits
 * fine next to Italian (שניצל + פסטה) and Middle Eastern (שניצל + פתיתים).
 */
const CLASHES: [Cuisine, Cuisine][] = [
  ['asian', 'italian'],
  ['asian', 'mideast'],
  ['asian', 'homestyle'],
  ['italian', 'mideast'],
]

/** How much likelier a pair that shares a cuisine is than a neutral pair. */
const SAME_CUISINE_WEIGHT = 3

export function cuisinesOf(component: Pick<Component, 'name' | 'ingredients'>): Set<Cuisine> {
  const text = [component.name, ...component.ingredients.map((i) => i.name)].join(' | ')
  const found = new Set<Cuisine>()
  for (const cuisine of Object.keys(CUISINE_KEYWORDS) as Cuisine[]) {
    if (CUISINE_KEYWORDS[cuisine].some((word) => text.includes(word))) found.add(cuisine)
  }
  return found
}

/**
 * 0 when the two clash, SAME_CUISINE_WEIGHT when they share a cuisine, 1
 * otherwise (including whenever either side is neutral). A component tagged
 * with two cuisines (a custom "פסטה עם קציצות" is Italian and homestyle)
 * clashes only if none of its cuisines get along with the other side's.
 */
export function pairWeight(a: Set<Cuisine>, b: Set<Cuisine>): number {
  if (a.size === 0 || b.size === 0) return 1
  for (const x of a) if (b.has(x)) return SAME_CUISINE_WEIGHT
  const clashes = (x: Cuisine, y: Cuisine) =>
    CLASHES.some(([p, q]) => (p === x && q === y) || (p === y && q === x))
  for (const x of a) for (const y of b) if (!clashes(x, y)) return 1
  return 0
}

/** The product of every pair's weight: one clash rules the combo out. */
export function comboWeight(parts: Pick<Component, 'name' | 'ingredients'>[]): number {
  return weightOfTags(parts.map(cuisinesOf))
}

function weightOfTags(tags: Set<Cuisine>[]): number {
  let weight = 1
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) weight *= pairWeight(tags[i], tags[j])
  }
  return weight
}

/**
 * Draw winners for the `targets` rings, given the rings that keep their
 * current winner (`fixed`: locked rings, or the other rings when only one is
 * re-spun). Every combination of the target pools is weighed against each
 * other and against the fixed parts, and one is picked in proportion to its
 * weight. If every combination clashes (a locked Asian carb with only
 * Italian vegs left), the rings are drawn uniformly instead: a combo that
 * doesn't quite fit beats a wheel that refuses to spin.
 *
 * Libraries are tens of components per ring, so even the full cross product
 * of three rings is a few thousand combos at most.
 */
export function drawCombo<T extends Component>(
  pools: Partial<Record<ComponentType, T[]>>,
  targets: ComponentType[],
  fixed: Partial<Record<ComponentType, T>>,
  rng: Rng,
): Partial<Record<ComponentType, T>> | null {
  if (targets.length === 0) return {}
  if (targets.some((t) => !pools[t]?.length)) return null

  // Read each component's cuisines once, not once per combination.
  const tagsOf = new Map<T, Set<Cuisine>>()
  const tags = (c: T) => {
    let found = tagsOf.get(c)
    if (!found) tagsOf.set(c, (found = cuisinesOf(c)))
    return found
  }
  const fixedTags = Object.values(fixed)
    .filter((p): p is T => !!p)
    .map(tags)
  const combos: { picks: T[]; weight: number }[] = []
  let total = 0
  const walk = (depth: number, picks: T[]) => {
    if (depth === targets.length) {
      const weight = weightOfTags([...fixedTags, ...picks.map(tags)])
      if (weight > 0) {
        combos.push({ picks, weight })
        total += weight
      }
      return
    }
    for (const item of pools[targets[depth]]!) walk(depth + 1, [...picks, item])
  }
  walk(0, [])

  let picks: T[]
  if (total === 0) {
    picks = targets.map((t) => rng.pick(pools[t]!))
  } else {
    let roll = rng.next() * total
    picks = combos[combos.length - 1].picks
    for (const combo of combos) {
      roll -= combo.weight
      if (roll < 0) {
        picks = combo.picks
        break
      }
    }
  }
  return Object.fromEntries(targets.map((t, i) => [t, picks[i]])) as Partial<Record<ComponentType, T>>
}
