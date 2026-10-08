import { describe, expect, it } from 'vitest'
import { pickFavored } from './favorites'
import { makeRng } from './rng'

describe('pickFavored', () => {
  it('draws exactly like rng.pick when nothing is a favorite', () => {
    const items = ['א', 'ב', 'ג', 'ד']
    for (let seed = 1; seed <= 20; seed++) {
      expect(pickFavored(items, makeRng(seed))).toBe(makeRng(seed).pick(items))
    }
  })

  it('draws a favorite about three times as often', () => {
    const items = [{ id: 'fav', is_favorite: true }, { id: 'a' }, { id: 'b' }]
    let favs = 0
    const runs = 3000
    for (let seed = 1; seed <= runs; seed++) {
      if (pickFavored(items, makeRng(seed)).id === 'fav') favs++
    }
    // 3 / (3 + 1 + 1) = 60%
    expect(favs / runs).toBeGreaterThan(0.55)
    expect(favs / runs).toBeLessThan(0.65)
  })
})
