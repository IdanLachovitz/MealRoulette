import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import { currentHouseholdId, save } from './db/repo'
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
    return startSync(householdId)
  }, [householdId])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)

    // The status/address bar colour on Android — a live <meta name="theme-color">
    // update, separate from the page's own colours (which theme.css's
    // prefers-color-scheme block already keeps in sync on its own). Resolves
    // to the app's actual white/near-black backgrounds, matching whichever
    // theme is really in effect, "system" included.
    const meta = document.querySelector('meta[name="theme-color"]')
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const paintStatusBar = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      meta?.setAttribute('content', dark ? '#171717' : '#ffffff')
    }
    paintStatusBar()

    // Only matters in "system" mode: the OS can flip its own light/dark
    // setting while this tab stays open, and the meta tag doesn't repaint
    // itself the way the CSS media query does — this is the one piece that
    // still needs a listener.
    if (theme === 'system') {
      media.addEventListener('change', paintStatusBar)
      return () => media.removeEventListener('change', paintStatusBar)
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

  const value = useMemo<AppState>(
    () => ({
      household: household ?? null,
      settings,
      ready,
      updateSettings,
      toast,
      theme,
      setTheme: setThemeState,
    }),
    [household, settings, ready, updateSettings, toast, theme],
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
