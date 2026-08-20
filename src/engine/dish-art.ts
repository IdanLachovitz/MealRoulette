/**
 * Picks the illustration for a dish from the dish itself — no network, no
 * stored asset, and the same dish always gets the same picture.
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

/** Stable 32-bit hash so a dish keeps the same picture between sessions. */
export function artSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small deterministic generator for the per-dish variation. */
export function artRandom(seed: number): () => number {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }
}

export interface ArtPalette {
  bg1: string
  bg2: string
  plate: string
  plateEdge: string
  food1: string
  food2: string
  accent: string
}

export const PALETTES: Record<DishArtKind, ArtPalette> = {
  soup: {
    bg1: '#f6ddc0', bg2: '#e8b27a', plate: '#fff6ea', plateEdge: '#e5cdb2',
    food1: '#d8762c', food2: '#b8541c', accent: '#5f8a3f',
  },
  pasta: {
    bg1: '#fadfd4', bg2: '#e8a693', plate: '#fff8f2', plateEdge: '#e6cfc3',
    food1: '#f0c060', food2: '#c8392f', accent: '#4f8a44',
  },
  pastry: {
    bg1: '#f8e6c6', bg2: '#e0b878', plate: '#fffaf0', plateEdge: '#e7d5b8',
    food1: '#dda449', food2: '#b1782c', accent: '#8a6a3a',
  },
  sandwich: {
    bg1: '#fae3c8', bg2: '#e5b381', plate: '#fff8ef', plateEdge: '#e6d2ba',
    food1: '#e0a856', food2: '#a05a2c', accent: '#5f9440',
  },
  wrap: {
    bg1: '#fbe6cd', bg2: '#e7bd8c', plate: '#fff9f1', plateEdge: '#e8d6bd',
    food1: '#eccb92', food2: '#c46a3a', accent: '#6a9a45',
  },
  cutlet: {
    bg1: '#fbe8c8', bg2: '#e9bd76', plate: '#fffaf1', plateEdge: '#e9d8ba',
    food1: '#e2a94e', food2: '#b87a2a', accent: '#e8d24a',
  },
  fish: {
    bg1: '#d9ecf3', bg2: '#9cc6d8', plate: '#f7fbfd', plateEdge: '#cfdfe6',
    food1: '#ef8f6a', food2: '#d76a48', accent: '#e8d24a',
  },
  patty: {
    bg1: '#f6ddc9', bg2: '#dfa885', plate: '#fff8f2', plateEdge: '#e5d0c1',
    food1: '#a4623a', food2: '#7d4525', accent: '#5f9440',
  },
  potato: {
    bg1: '#fbeccb', bg2: '#eccb84', plate: '#fffbf0', plateEdge: '#eadcb9',
    food1: '#f0c552', food2: '#cf9a2c', accent: '#c0432f',
  },
  poultry: {
    bg1: '#fbe7c4', bg2: '#e9c078', plate: '#fffaf0', plateEdge: '#e9d8b6',
    food1: '#dda94e', food2: '#b57a30', accent: '#6a9a45',
  },
  stuffed: {
    bg1: '#f3e0cd', bg2: '#d9ab8b', plate: '#fdf7f1', plateEdge: '#e3d0c0',
    food1: '#c85a3c', food2: '#8f6f3e', accent: '#5f8a3f',
  },
  meat: {
    bg1: '#efdcd2', bg2: '#c99a86', plate: '#fdf6f2', plateEdge: '#e0cec5',
    food1: '#8d4a2e', food2: '#63301c', accent: '#5f8a3f',
  },
  grain: {
    bg1: '#f9eed6', bg2: '#e6d0a0', plate: '#fffcf4', plateEdge: '#ebdfc4',
    food1: '#f2e2bd', food2: '#d8bd83', accent: '#5f9440',
  },
  beans: {
    bg1: '#f2e2cd', bg2: '#d9b98c', plate: '#fdf8f0', plateEdge: '#e5d6bf',
    food1: '#b5652f', food2: '#8a4a22', accent: '#5f8a3f',
  },
  salad: {
    bg1: '#e4f0d6', bg2: '#adcf8e', plate: '#fbfdf7', plateEdge: '#d8e3cb',
    food1: '#63a544', food2: '#3f7a2e', accent: '#c0432f',
  },
  veg: {
    bg1: '#eaeedc', bg2: '#bcc9a0', plate: '#fbfcf6', plateEdge: '#dbe1cc',
    food1: '#7fa04a', food2: '#4f7a3a', accent: '#d8762c',
  },
}
