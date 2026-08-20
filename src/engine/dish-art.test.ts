import { describe, expect, it } from 'vitest'
import { artRandom, artSeed, classifyDish } from './dish-art'
import seed from '../db/seed-data.json'

describe('classifyDish', () => {
  it('reads the dish name before the ingredient list', () => {
    // Ground beef is in the pot, but a burekas is a pastry.
    expect(classifyDish('בורקס בשר עם צנוברים', ['בשר טחון', 'יריעות בצק'])).toBe('pastry')
    // Potatoes are in the pot, but חמין is a stew.
    expect(classifyDish('חמין', ['תפוח אדמה', 'שעועית', 'בשר לחמין'])).toBe('meat')
    // Rice is on the plate, but the salmon is the dish.
    expect(classifyDish('סלמון בטריאקי עם אורז', ['פילה סלמון', 'אורז'])).toBe('fish')
  })

  it('names the dish by its star, not by its side', () => {
    // Potatoes are a side; the chicken is the dish.
    expect(classifyDish('פרגית בתנור בדבש וחרדל עם תפו"א, בטטה, בצל וגזר')).toBe('poultry')
    expect(classifyDish('פרגיות בתנור בסויה וסילאן עם בצל ובטטה')).toBe('poultry')
    // Noodles are a side here too.
    expect(classifyDish('שוקיים עם אפונה ברוטב אדום ואורז עם אטריות')).toBe('poultry')
    // But with no meat or poultry in the name, the potato is the dish.
    expect(classifyDish("צ'יפס עם רוטב שמנת פטריות")).toBe('potato')
  })

  it('does not mistake קישואים for a קיש', () => {
    expect(classifyDish('קובה קישואים')).toBe('stuffed')
    expect(classifyDish('קישוא ממולא')).toBe('stuffed')
    // A real pastry still classifies as one.
    expect(classifyDish('פשטידת קישואים (Tarta de zucchini)')).toBe('pastry')
  })

  it('falls back to ingredients when the name says nothing', () => {
    expect(classifyDish('ארוחת ערב', ['חזה עוף', 'אורז'])).toBe('poultry')
    expect(classifyDish('משהו טעים', [])).toBe('veg')
  })

  it('sorts the real library the way a person would', () => {
    const cases: [string, string][] = [
      ['מרק עוף', 'soup'],
      ['פסטה בולונז', 'pasta'],
      ['לזניה', 'pasta'],
      ['שניצל', 'cutlet'],
      ['נגטס', 'cutlet'],
      ['חריימה — דג מרוקאי', 'fish'],
      ['עראיס טונה', 'sandwich'],
      ['המבורגרים', 'sandwich'],
      ['טאקוס', 'wrap'],
      ['ג׳חנון', 'pastry'],
      ['פשטידת בצל (Tarta de cebolla)', 'pastry'],
      ['קציצות בשר ברוטב אדום', 'patty'],
      ['קבבים', 'patty'],
      ["צ'יפס עם צ'דר", 'potato'],
      ['עוף בתנור עם אורז וגזר', 'poultry'],
      ['כרוב ממולא', 'stuffed'],
      ['קובה סלק', 'stuffed'],
      ['אסאדו רך', 'meat'],
      ['קוסקוס ברוטב אדום', 'grain'],
      ['טבחה שעועית', 'beans'],
    ]
    for (const [name, kind] of cases) {
      expect(`${name} => ${classifyDish(name)}`).toBe(`${name} => ${kind}`)
    }
  })

  it('gives every dish in the library a kind, and no single kind swallows it', () => {
    const counts = new Map<string, number>()
    for (const d of seed.dishes) {
      const kind = classifyDish(
        d.name,
        (d.ingredients ?? []).map((i: { name: string }) => i.name),
      )
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    // At least eight distinct illustrations across the library, and no kind
    // covering more than a third of it — otherwise the wheel looks samey again.
    expect(counts.size).toBeGreaterThanOrEqual(8)
    expect(Math.max(...counts.values())).toBeLessThan(seed.dishes.length / 3)
  })
})

describe('artSeed / artRandom', () => {
  it('is stable for the same name', () => {
    expect(artSeed('לזניה')).toBe(artSeed('לזניה'))
    expect(artSeed('לזניה')).not.toBe(artSeed('שקשוקה'))
  })

  it('produces a repeatable sequence in [0,1)', () => {
    const a = artRandom(artSeed('לזניה'))
    const b = artRandom(artSeed('לזניה'))
    const first = [a(), a(), a()]
    expect(first).toEqual([b(), b(), b()])
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
