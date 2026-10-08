/**
 * Timers for cooking mode, read out of a recipe step's own text: "אופים 25
 * דקות" gets a 25-minute timer button, without the recipe having to store
 * timers separately. Recipes are AI-written Hebrew, so this covers the ways
 * it actually writes a duration: a number of minutes or hours, a range
 * ("15-20 דקות", timed at the upper end so nothing comes out underdone),
 * and the word forms (דקה, חצי שעה, רבע שעה, שעה, שעתיים).
 */

/** Minutes for each duration the step mentions, in order, without repeats. */
export function stepTimers(step: string): number[] {
  const found: { at: number; minutes: number }[] = []
  const add = (at: number, minutes: number) => {
    if (minutes > 0 && minutes <= 24 * 60) found.push({ at, minutes: Math.round(minutes) })
  }
  // Word forms first, and blanked out afterwards, so "חצי שעה" isn't also
  // read as "שעה".
  let text = step
  const words: [RegExp, number][] = [
    [/שעה וחצי/g, 90],
    [/חצי שעה/g, 30],
    [/רבע שעה/g, 15],
    [/שלושת רבעי שעה/g, 45],
    [/שעתיים/g, 120],
    [/(?<![\d.])\s?שעה(?!\s*ו)/g, 60],
    [/(?<![\d.])\s?דקה(?!\s*ו)/g, 1],
  ]
  for (const [pattern, minutes] of words) {
    text = text.replace(pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2] as number
      add(offset, minutes)
      return ' '.repeat(match.length)
    })
  }

  const numeric = /(\d+(?:\.\d+)?)(?:\s*[-–עד]+\s*(\d+(?:\.\d+)?))?\s*(דקות|דקה|דק['׳]?|שעות|שעה)/g
  for (const m of text.matchAll(numeric)) {
    const value = Number(m[2] ?? m[1])
    const perUnit = m[3].startsWith('ש') ? 60 : 1
    add(m.index ?? 0, value * perUnit)
  }

  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.minutes))]
}

/** "1:05:00" / "4:30" for a countdown of `seconds`. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
