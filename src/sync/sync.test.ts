import { describe, expect, it } from 'vitest'
import { shouldKeepLocal } from './sync'
import type { CookSession, Synced } from '../types'

function row(updatedAt: string, extra: Partial<CookSession> = {}): Synced {
  return {
    id: 's1',
    household_id: 'h',
    updated_at: updatedAt,
    deleted_at: null,
    ...extra,
  } as Synced
}

describe('conflict resolution', () => {
  it('takes the newer write (LWW)', () => {
    expect(shouldKeepLocal('dishes', row('2026-08-19T10:00:00Z'), row('2026-08-19T11:00:00Z'))).toBe(
      false,
    )
    expect(shouldKeepLocal('dishes', row('2026-08-19T12:00:00Z'), row('2026-08-19T11:00:00Z'))).toBe(
      true,
    )
  })

  it('lets a locally locked session beat a newer remote unlock', () => {
    const local = row('2026-08-19T10:00:00Z', { is_locked: true })
    const remote = row('2026-08-19T11:00:00Z', { is_locked: false })
    expect(shouldKeepLocal('cook_sessions', local, remote)).toBe(true)
  })

  it('still accepts a newer remote write when the local session is not locked', () => {
    const local = row('2026-08-19T10:00:00Z', { is_locked: false })
    const remote = row('2026-08-19T11:00:00Z', { is_locked: false })
    expect(shouldKeepLocal('cook_sessions', local, remote)).toBe(false)
  })

  it('accepts a remote lock arriving from the other device', () => {
    const local = row('2026-08-19T10:00:00Z', { is_locked: false })
    const remote = row('2026-08-19T11:00:00Z', { is_locked: true })
    expect(shouldKeepLocal('cook_sessions', local, remote)).toBe(false)
  })
})
