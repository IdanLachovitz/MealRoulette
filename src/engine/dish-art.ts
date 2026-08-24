/**
 * Classifies a dish into a broad kind (soup, pasta, poultry, ...) from its
 * name and ingredients. Originally written to pick a drawn illustration per
 * dish (now replaced by real AI photos — see components/DishArt.tsx), this
 * classification is kept because the weekly AI wizard still uses it to keep
 * its shortlist varied: never more than one dish per kind, so a week never
 * comes back as four different soups just because their names don't overlap.
 *
 * Matching runs over the name first and only falls back to the ingredient list.
 * Ingredients are noisy for this purpose: half the library has potatoes or
 * ground beef somewhere in it, and "חמין" is a stew whatever else is in the pot.
 */

export type DishArtKind =
  | 'soup'
  | 'pasta'
  | 'pastry'
  | 'sandwich'
  | 'wrap'
  | 'cutlet'
  | 'fish'
  | 'patty'
  | 'potato'
  | 'poultry'
  | 'stuffed'
  | 'meat'
  | 'grain'
  | 'beans'
  | 'salad'
  | 'veg'

/**
 * Order is priority: the first rule that matches wins, so the rules are sorted
 * by how strongly the word names the dish rather than a side of it. Chicken
 * outranks pasta and potato because "פרגית בתנור עם תפו״א" is a chicken dish
 * with potatoes next to it, not a potato dish.
 */
const RULES: { kind: DishArtKind; words: string[] }[] = [
  { kind: 'soup', words: ['מרק', 'ציר'] },
  {
    kind: 'pastry',
    // No 'קיש' here: it is a substring of קישואים, which sends every courgette
    // dish to the quiche illustration.
    words: ['בורקס', 'פשטידה', 'פשטידת', 'ג׳חנון', "ג'חנון", 'מלאווח', 'בצק', 'טארט'],
  },
  {
    kind: 'sandwich',
    words: ['המבורגר', 'burger', 'לחמניות', 'טוסט', 'כריך', 'עראיס', 'פיתה', 'פיתות', 'באגט'],
  },
  { kind: 'wrap', words: ['טורטיה', 'טורטיות', 'טאקו', 'טאקוס', 'פחיטס', 'fajita', 'ראפ', 'בוריטו'] },
  { kind: 'poultry', words: ['עוף', 'פרגית', 'פרגיות', 'שוקיים', 'כרעיים', 'chicken', 'הודו'] },
  { kind: 'pasta', words: ['פסטה', 'לזניה', 'אטריות', 'ספגטי', 'נודלס', 'פנה', 'מקרוני'] },
  { kind: 'cutlet', words: ['שניצל', 'שניצלים', 'milanesa', 'נגטס', 'פאנקו'] },
  { kind: 'fish', words: ['סלמון', 'דג', 'טונה', 'חריימה', 'סושי', 'sushi', 'פילה דג', 'בקלה'] },
  { kind: 'patty', words: ['קציצות', 'קציצה', 'קבב', 'קבבים', 'ערוק', 'פלאפל'] },
  { kind: 'stuffed', words: ['ממולא', 'ממולאים', 'קובה', 'מוסקה', 'מלפוף'] },
  {
    kind: 'meat',
    words: ['בשר', 'אסאדו', 'סטרוגנוף', 'חמין', 'אנטרקוט', 'סטייק', 'נקניקיות', 'שוורמה'],
  },
  { kind: 'potato', words: ['צ׳יפס', "צ'יפס", 'תפוח אדמה', 'תפו"א', 'פירה', 'בטטה', 'מפרום'] },
  { kind: 'grain', words: ['אורז', 'קוסקוס', 'פולנטה', 'פתיתים', 'בורגול', 'קינואה', 'גריסים'] },
  { kind: 'beans', words: ['שעועית', 'עדשים', 'חומוס', 'אפונה', 'במיה', 'טבחה'] },
  { kind: 'salad', words: ['סלט', 'חסה', 'ירקות', 'קערת'] },
]

function matches(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w))
}

export function classifyDish(name: string, ingredients: string[] = []): DishArtKind {
  const title = name.toLowerCase()
  for (const rule of RULES) {
    if (matches(title, rule.words)) return rule.kind
  }
  // Nothing in the name — now the ingredients are allowed to decide.
  const body = `${title} ${ingredients.join(' ')}`.toLowerCase()
  for (const rule of RULES) {
    if (matches(body, rule.words)) return rule.kind
  }
  return 'veg'
}

/**
 * Keeps at most one dish per classifyDish category, in the given order —
 * so a list that happens to contain two soups only ever contributes one of
 * them. Used to keep the AI weekly-planning shortlist from suggesting a
 * week with, say, two soups and two pasta dishes even when the names
 * themselves all look different.
 */
export function diversifyByCategory<T extends { name: string; ingredients?: string[] }>(items: T[]): T[] {
  const seen = new Set<DishArtKind>()
  const result: T[] = []
  for (const item of items) {
    const kind = classifyDish(item.name, item.ingredients ?? [])
    if (seen.has(kind)) continue
    seen.add(kind)
    result.push(item)
  }
  return result
}
