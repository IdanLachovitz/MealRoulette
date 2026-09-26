import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import { currentHouseholdId, save } from './db/repo'
import { applySeedMains } from './db/seed'
import { DEFAULT_SETTINGS } from './types'
import type { Household, HouseholdSettings } from './types'
import { getSyncState, startSync, subscribeSync } from './sync/sync'

interface ToastMessage {
  id: number
  text: string
  actionLabel?: string
  onAction?: () => void
}

interface AppState {
  household: Household | null
  settings: HouseholdSettings
  ready: boolean
  updateSettings: (patch: Partial<HouseholdSettings>) => Promise<void>
  toast: (text: string, action?: { label: string; onAction: () => void }) => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
  /** `theme` with 'system' resolved against the OS preference — what's
   *  actually on screen right now, for UI (like the topbar's sun/moon
   *  toggle) that needs to show or react to the effective mode rather than
   *  the raw three-way setting. */
  resolvedTheme: 'light' | 'dark'
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark' | 'system') ?? 'system',
  )
  // Only consulted while theme === 'system' — tracked live so the topbar
  // toggle's icon flips immediately if the OS switches modes while the app
  // is open, not just on next load.
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    void currentHouseholdId().then((id) => {
      setHouseholdId(id || null)
      setReady(true)
    })
  }, [])

  // Re-read the household id after onboarding writes it.
  const refreshHousehold = useCallback(async () => {
    const id = await currentHouseholdId()
    setHouseholdId(id || null)
  }, [])

  useEffect(() => {
    const handler = () => void refreshHousehold()
    window.addEventListener('household-changed', handler)
    return () => window.removeEventListener('household-changed', handler)
  }, [refreshHousehold])

  const household = useLiveQuery(
    async () => (householdId ? ((await db.households.get(householdId)) ?? null) : null),
    [householdId],
    null,
  )

  useEffect(() => {
    if (!householdId) return
    void applySeedMains(householdId)
    return startSync(householdId)
  }, [householdId])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)

    // The status bar / toolbar colour (Android address bar, iOS Safari's
    // strip that extends up under the notch): index.html has two
    // <meta name="theme-color" media="..."> tags that already handle
    // "system" correctly on their own, via native OS-level media matching —
    // no JS, no flash of the wrong colour, and it's the reliable path since
    // iOS Safari doesn't dependably repaint a single tag whose content
    // attribute changes at runtime. This effect only has to do anything when
    // the in-app choice overrides the OS setting: force both tags to that
    // same colour so whichever one Safari is honouring still shows it, then
    // hand back their own distinct colours when the choice is "system" again
    // so native matching takes back over.
    const light = document.getElementById('theme-color-light')
    const dark = document.getElementById('theme-color-dark')
    // Exact --bg values from theme.css (light/dark), not approximations —
    // this is the status bar blending into the page, so an off-shade here
    // would just trade a white seam for a subtler mismatched one.
    if (theme === 'system') {
      light?.setAttribute('content', '#f7f3f8')
      dark?.setAttribute('content', '#15110d')
    } else {
      const color = theme === 'dark' ? '#15110d' : '#f7f3f8'
      light?.setAttribute('content', color)
      dark?.setAttribute('content', color)
    }
  }, [theme])

  // Merged with the defaults so a household saved before a settings key existed
  // still reads a real value for it instead of undefined.
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(household?.settings ?? {}) }),
    [household?.settings],
  )

  const updateSettings = useCallback(
    async (patch: Partial<HouseholdSettings>) => {
      if (!household) return
      await save('households', { ...household, settings: { ...household.settings, ...patch } })
    },
    [household],
  )

  const toast = useCallback(
    (text: string, action?: { label: string; onAction: () => void }) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [
        ...t,
        { id, text, actionLabel: action?.label, onAction: action?.onAction },
      ])
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
    },
    [],
  )

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme

  const value = useMemo<AppState>(
    () => ({
      household: household ?? null,
      settings,
      ready,
      updateSettings,
      toast,
      theme,
      setTheme: setThemeState,
      resolvedTheme,
    }),
    [household, settings, ready, updateSettings, toast, theme, resolvedTheme],
  )

  const current = toasts[toasts.length - 1]

  return (
    <Ctx.Provider value={value}>
      {children}
      {current && (
        <div className="toast" role="status" aria-live="polite">
          <span style={{ flex: 1 }}>{current.text}</span>
          {current.actionLabel && (
            <button
              className="toast__action"
              onClick={() => {
                current.onAction?.()
                setToasts((t) => t.filter((x) => x.id !== current.id))
              }}
            >
              {current.actionLabel}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  )
}

export function notifyHouseholdChanged(): void {
  window.dispatchEvent(new Event('household-changed'))
}

/** Small hook so the top bar can show sync status without prop-drilling. */
export function useSyncStatus() {
  const [status, setStatus] = useState(getSyncState())
  useEffect(() => subscribeSync(() => setStatus(getSyncState())), [])
  return status
}
