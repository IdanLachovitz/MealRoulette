/**
 * Picks a small icon for a raw shopping-list ingredient — "בצל", "חזה עוף",
 * "אורז" — as opposed to dish-art.ts, which draws a full plate for a finished
 * dish. An ingredient icon has to work at ~28px next to a line of text, so it
 * is one motif on a tinted background, not a scene.
 *
 * The aisle the ingredient is already filed under (see types.ts Aisle) is a
 * strong prior — meat aisle items are never produce — refined by name so
 * "עוף" and "סלמון", both בשר ודגים, still get different pictures.
 */
import type { Aisle } from '../types'

export type IngredientArtKind =
  | 'poultry'
  | 'fish'
  | 'meat'
  | 'dairy'
  | 'egg'
  | 'grain'
  | 'pasta'
  | 'bread'
  | 'legume'
  | 'vegRound'
  | 'vegLeaf'
  | 'nuts'
  | 'spice'
  | 'sauce'
  | 'frozen'
  | 'other'

interface Rule {
  kind: IngredientArtKind
  words: string[]
}

/**
 * Checked before the aisle default, in order — first match wins. Short,
 * distinctive categories (sauce/spice) are checked before the broad veg and
 * bread buckets, because a generic word like "פלפל" or "בורגר" would otherwise
 * swallow a more specific match later in the string — "רוטב בורגר" (burger
 * sauce) is a sauce, not bread, even though it contains "בורגר".
 */
const NAME_RULES: Rule[] = [
  { kind: 'poultry', words: ['עוף', 'פרגית', 'פרגיות', 'הודו', 'שוקיים', 'כרעיים'] },
  { kind: 'fish', words: ['סלמון', 'דג', 'טונה', 'נורי'] },
  { kind: 'egg', words: ['ביצה', 'ביצים'] },
  { kind: 'dairy', words: ['גבינ', 'שמנת', 'חלב', 'חמאה', 'קוטג', 'בשמל'] },
  { kind: 'sauce', words: ['רוטב', 'דבש', 'חרדל', 'סילאן', 'רסק', 'מיונז', 'פסטו', 'שמן', 'ריבת', 'טחינה'] },
  { kind: 'spice', words: ['תבלין', 'פפריקה', 'קארי', 'מלח', 'פלפל שחור', 'תערובת'] },
  { kind: 'pasta', words: ['פסטה', 'אטריות', 'לזניה', 'ספגטי', 'נודלס', 'מקרוני'] },
  { kind: 'grain', words: ['אורז', 'קוסקוס', 'פתיתים', 'גריסי', 'קינואה', 'גרעיני חיטה', 'תבלין אורז'] },
  { kind: 'bread', words: ['לחם', 'פיתה', 'פיתות', 'טורטיה', 'טורטיות', 'לחמני', 'בורגר', 'בייגל'] },
  { kind: 'legume', words: ['שעועית', 'עדשים', 'חומוס', 'אפונה'] },
  { kind: 'nuts', words: ['קשיו', 'צנובר', 'אגוז', 'ערמונים', 'שקד'] },
  { kind: 'meat', words: ['בשר', 'אסאדו', 'נקניק', 'שניצל'] },
  {
    kind: 'vegLeaf',
    words: ['חסה', 'עלי', 'עלים', 'כרוב', 'בזיליקום', 'רוקט', 'תרד', 'פטרוזיליה', 'שמיר'],
  },
  {
    kind: 'vegRound',
    words: [
      'תפוח אדמה', 'בטטה', 'בצל', 'גזר', 'שום', 'סלק', 'עגבני', 'פלפל', 'קישוא', 'חציל',
      'ברוקולי', 'פטריות', 'במיה', 'מלפפון', 'אבוקדו', 'זיתים',
    ],
  },
  { kind: 'grain', words: ['קמח', 'פירורי לחם', 'קורנפלור', 'דפי לזניה', 'דפי בורקס', 'בצק'] },
]

/** Fallback when a name matches nothing above — the aisle still tells us something. */
const AISLE_DEFAULT: Record<Aisle, IngredientArtKind> = {
  'ירקות': 'vegRound',
  'בשר ודגים': 'meat',
  'מוצרי חלב': 'dairy',
  'יבשים': 'grain',
  'קפואים': 'frozen',
  'תבלינים': 'spice',
  'אחר': 'other',
}

export function classifyIngredient(name: string, aisle?: Aisle): IngredientArtKind {
  const title = name.toLowerCase()
  for (const rule of NAME_RULES) {
    if (rule.words.some((w) => title.includes(w))) return rule.kind
  }
  return aisle ? AISLE_DEFAULT[aisle] : 'other'
}

export interface IngredientPalette {
  bg: string
  fg: string
}

export const INGREDIENT_PALETTES: Record<IngredientArtKind, IngredientPalette> = {
  poultry: { bg: '#f8e2c0', fg: '#c07f2c' },
  fish: { bg: '#dceef5', fg: '#3f89ac' },
  meat: { bg: '#f0d9d2', fg: '#a04a34' },
  dairy: { bg: '#eef2fb', fg: '#5b6fae' },
  egg: { bg: '#faf1d9', fg: '#c99a2e' },
  grain: { bg: '#f6ecd3', fg: '#b8923f' },
  pasta: { bg: '#fbe4d6', fg: '#c8622f' },
  bread: { bg: '#f2e2c9', fg: '#a9793a' },
  legume: { bg: '#eee2cd', fg: '#8a6a3a' },
  vegRound: { bg: '#e3f0d8', fg: '#5c8f3e' },
  vegLeaf: { bg: '#dcecd0', fg: '#4a7a35' },
  nuts: { bg: '#ecdfc8', fg: '#8f6a35' },
  spice: { bg: '#f6ddd3', fg: '#b5552e' },
  sauce: { bg: '#f4e0d3', fg: '#a4562c' },
  frozen: { bg: '#dcedf5', fg: '#4487a8' },
  other: { bg: '#e9e5ee', fg: '#7a6f8c' },
}
