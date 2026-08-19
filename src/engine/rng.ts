/**
 * Seeded RNG. The planner and the roulette both draw from this so that a given
 * (library, history, params, seed) always yields the same plan — which is what
 * makes the cooldown and relaxation rules testable without a browser or a wheel.
 */
export interface Rng {
  next(): number
  int(maxExclusive: number): number
  pick<T>(items: readonly T[]): T
}

/** mulberry32 — small, fast, good enough for picking dinner. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive)
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() from empty list')
      return items[int(items.length)]
    },
  }
}

/** Seed derived from a string, so a household+week combination is reproducible. */
export function seedFrom(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0
}
