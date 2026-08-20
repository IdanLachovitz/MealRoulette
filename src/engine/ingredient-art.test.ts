import { describe, expect, it } from 'vitest'
import { classifyIngredient } from './ingredient-art'
import seed from '../db/seed-data.json'
import type { Aisle } from '../types'

describe('classifyIngredient', () => {
  it('tells apart ingredients that share an aisle', () => {
    expect(classifyIngredient('חזה עוף', 'בשר ודגים')).toBe('poultry')
    expect(classifyIngredient('פילה סלמון', 'בשר ודגים')).toBe('fish')
    expect(classifyIngredient('בשר טחון', 'בשר ודגים')).toBe('meat')
    expect(classifyIngredient('בצל', 'ירקות')).toBe('vegRound')
    expect(classifyIngredient('חסה', 'ירקות')).toBe('vegLeaf')
  })

  it('falls back to the aisle when the name matches nothing specific', () => {
    expect(classifyIngredient('משהו מוזר', 'קפואים')).toBe('frozen')
    expect(classifyIngredient('משהו מוזר', 'תבלינים')).toBe('spice')
  })

  it('sorts real ingredients from the library the way a shopper would', () => {
    const cases: [string, string][] = [
      ['חלב', 'dairy'],
      ['ביצה', 'egg'],
      ['גבינה מגוררת', 'dairy'],
      ['אורז לבן', 'grain'],
      ['פסטה', 'pasta'],
      ['לחם', 'bread'],
      ['פיתות', 'bread'],
      ['שעועית לבנה', 'legume'],
      ['קשיו', 'nuts'],
      ['תפוח אדמה', 'vegRound'],
      ['עגבניה', 'vegRound'],
      ['פטרוזיליה', 'vegLeaf'],
      ['רוטב סויה', 'sauce'],
      ['דבש', 'sauce'],
      ['פפריקה', 'spice'],
      ['מלח גס', 'spice'],
      ['קמח', 'grain'],
      ['שוקיים עוף', 'poultry'],
      ['קופסת טונה', 'fish'],
    ]
    for (const [name, kind] of cases) {
      expect(`${name} => ${classifyIngredient(name)}`).toBe(`${name} => ${kind}`)
    }
  })

  it('resolves the specific category over a broad word it happens to contain', () => {
    // "פלפל שחור גס" contains "פלפל" (bell pepper), but coarse black pepper
    // is a spice, not a vegetable.
    expect(classifyIngredient('פלפל שחור גס')).toBe('spice')
    // "שמן זית" contains "זית" (olive), but olive oil is a sauce/condiment.
    expect(classifyIngredient('שמן זית')).toBe('sauce')
    expect(classifyIngredient('שמן שומשום')).toBe('sauce')
    // "רוטב בורגר" contains "בורגר" (burger, a bread-rule word for buns), but
    // it is the sauce, not the bun.
    expect(classifyIngredient('רוטב בורגר')).toBe('sauce')
    // "תערובת תבלינים פחיטה" contains "פחיטה", whose tail "חיטה" (wheat) used
    // to falsely match the grain rule.
    expect(classifyIngredient('תערובת תבלינים פחיטה')).toBe('spice')
    // Buns still classify as bread even with "בורגר" sharing the rule.
    expect(classifyIngredient('לחמניות המבורגר')).toBe('bread')
    // Actual olives still classify as a vegetable.
    expect(classifyIngredient('זיתים')).toBe('vegRound')
  })

  it('classifies every ingredient in the real library into a small, non-degenerate set of kinds', () => {
    const counts = new Map<string, number>()
    const seen = new Set<string>()
    for (const d of [...seed.dishes, ...seed.components]) {
      for (const ing of d.ingredients ?? []) {
        if (seen.has(ing.name)) continue
        seen.add(ing.name)
        const kind = classifyIngredient(ing.name, ing.aisle as Aisle)
        counts.set(kind, (counts.get(kind) ?? 0) + 1)
      }
    }
    expect(seen.size).toBeGreaterThan(100)
    expect(counts.size).toBeGreaterThanOrEqual(10)
    // Nothing should dominate a 139-item library the way a single fallback would.
    expect(Math.max(...counts.values())).toBeLessThan(seen.size / 3)
  })
})
