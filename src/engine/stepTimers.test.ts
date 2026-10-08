import { describe, expect, it } from 'vitest'
import { formatCountdown, stepTimers } from './stepTimers'

describe('stepTimers', () => {
  it('reads minutes and hours', () => {
    expect(stepTimers('מכניסים לתנור ל-25 דקות')).toEqual([25])
    expect(stepTimers('מבשלים 2 שעות על אש קטנה')).toEqual([120])
    expect(stepTimers('אופים 40 דק׳')).toEqual([40])
  })

  it('times a range at its upper end', () => {
    expect(stepTimers('מטגנים 15-20 דקות עד שמזהיב')).toEqual([20])
  })

  it('reads the word forms', () => {
    expect(stepTimers('משרים חצי שעה')).toEqual([30])
    expect(stepTimers('מבשלים שעתיים')).toEqual([120])
    expect(stepTimers('מבשלים עוד דקה')).toEqual([1])
    expect(stepTimers('צולים שעה וחצי')).toEqual([90])
  })

  it('finds several durations in order, without repeats', () => {
    expect(stepTimers('מטגנים 5 דקות, הופכים ומטגנים עוד 5 דקות, ואז אופים 20 דקות')).toEqual([5, 20])
  })

  it('ignores steps with no duration', () => {
    expect(stepTimers('מערבבים הכל עם 2 כפות שמן')).toEqual([])
  })
})

describe('formatCountdown', () => {
  it('formats minutes and hours', () => {
    expect(formatCountdown(270)).toBe('4:30')
    expect(formatCountdown(3900)).toBe('1:05:00')
    expect(formatCountdown(-3)).toBe('0:00')
  })
})
