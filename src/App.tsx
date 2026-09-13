import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AppProvider, useApp, useSyncStatus } from './state'
import { WeekScreen } from './screens/WeekScreen'
import { RouletteScreen } from './screens/RouletteScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { FridgeScreen } from './screens/FridgeScreen'
import { ShoppingScreen } from './screens/ShoppingScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Onboarding } from './screens/Onboarding'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import { formatWeekRange } from './engine/dates'
import { currentWeekStart } from './services/week'

type Tab = 'week' | 'roulette' | 'library' | 'fridge' | 'shopping' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'week', label: 'השבוע', icon: 'calendar' },
  { id: 'roulette', label: 'רולטה', icon: 'wheel' },
  { id: 'library', label: 'מאגר', icon: 'list' },
  { id: 'fridge', label: 'במקרר', icon: 'fridge' },
  { id: 'shopping', label: 'קניות', icon: 'cart' },
]

function Shell() {
  const { household, ready, settings } = useApp()
  const [tab, setTab] = useState<Tab>('week')
  const sync = useSyncStatus()

  // "Glass capsule dock" — one pill that slides to whichever tab is active,
  // rather than each tab drawing its own. navRef anchors the pill's
  // position; itemRefs is how its left/width get measured against the
  // actual button rects (equal-width flex items today, but this stays
  // correct even if that ever changes).
  const navRef = useRef<HTMLElement>(null)
  const itemRefs = useRef(new Map<Tab, HTMLButtonElement>())
  const [pillRect, setPillRect] = useState<{ left: number; width: number } | null>(null)
  const [pillSettling, setPillSettling] = useState(false)
  const dragPointerId = useRef<number | null>(null)

  const updatePill = useCallback((activeTab: Tab) => {
    const navEl = navRef.current
    const itemEl = itemRefs.current.get(activeTab)
    if (!navEl || !itemEl) {
      setPillRect(null)
      return
    }
    const navBox = navEl.getBoundingClientRect()
    const itemBox = itemEl.getBoundingClientRect()
    setPillRect({ left: itemBox.left - navBox.left, width: itemBox.width })
  }, [])

  // useLayoutEffect, not useEffect — measuring after paint would let the
  // pill visibly jump into place on first load instead of just appearing
  // where it belongs.
  useLayoutEffect(() => {
    updatePill(tab)
  }, [tab, updatePill])

  useEffect(() => {
    const onResize = () => updatePill(tab)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [tab, updatePill])

  /** Which tab, if any, sits under this point right now. */
  const tabAt = (clientX: number, clientY: number): Tab | null => {
    for (const [id, el] of itemRefs.current) {
      const r = el.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return id
    }
    return null
  }

  // The drag lives on the bar itself, not on each button — that's what lets
  // a finger land on one tab and slide across the others with the pill
  // chasing it the whole way, switching tab (and its content underneath)
  // live as each one passes under the finger, the same gesture an iOS
  // segmented control uses. Lifting the finger is what "picks" the tab
  // it's currently over, marked with a little settle-bounce on the pill —
  // dragging never has to end back where it started.
  const onNavPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    dragPointerId.current = e.pointerId
    setPillSettling(false)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nice-to-have; its failure shouldn't sink the gesture.
    }
    const hit = tabAt(e.clientX, e.clientY)
    if (hit) setTab(hit)
  }

  const onNavPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (dragPointerId.current !== e.pointerId) return
    const hit = tabAt(e.clientX, e.clientY)
    if (hit) setTab(hit)
  }

  const onNavPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (dragPointerId.current !== e.pointerId) return
    dragPointerId.current = null
    setPillSettling(true)
  }

  if (!ready) return <div className="app" />
  if (!household) return <Onboarding />

  const titles: Record<Tab, string> = {
    week: 'השבוע',
    roulette: 'רולטה',
    library: 'המאגר',
    fridge: 'במקרר',
    shopping: 'רשימת קניות',
    settings: 'הגדרות',
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          {titles[tab]}
          {tab === 'week' && (
            <>
              {' '}
              <span className="topbar__sub">{formatWeekRange(currentWeekStart(settings))}</span>
            </>
          )}
        </h1>

        {sync.state === 'offline' && (
          <span className="row label" style={{ gap: 4 }} title="נשמר מקומית, יסונכרן כשתהיה רשת">
            <Icon name="signal-off" size={14} />
            לא מחובר
          </span>
        )}
        {sync.state === 'syncing' && <span className="label">מסנכרן…</span>}

        <button
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="הגדרות"
          aria-pressed={tab === 'settings'}
          onClick={() => setTab(tab === 'settings' ? 'week' : 'settings')}
        >
          <Icon name="gear" size={17} />
        </button>
      </header>

      <main className="app__main">
        {/* Keyed by tab so React remounts (not patches) the panel on every
            switch — that's what makes the fade/rise-in animation below
            replay every time, instead of only on first load. */}
        <div key={tab} className="tab-panel">
          {tab === 'week' && (
            <WeekScreen householdId={household.id} onGoToRoulette={() => setTab('roulette')} />
          )}
          {tab === 'roulette' && (
            <RouletteScreen householdId={household.id} onGoToLibrary={() => setTab('library')} />
          )}
          {tab === 'library' && <LibraryScreen householdId={household.id} />}
          {tab === 'fridge' && <FridgeScreen householdId={household.id} />}
          {tab === 'shopping' && <ShoppingScreen householdId={household.id} />}
          {tab === 'settings' && <SettingsScreen householdId={household.id} />}
        </div>
      </main>

      <div className="nav-dock">
        <nav
          ref={navRef}
          className="nav"
          aria-label="ניווט ראשי"
          onPointerDown={onNavPointerDown}
          onPointerMove={onNavPointerMove}
          onPointerUp={onNavPointerUp}
          onPointerCancel={onNavPointerUp}
        >
          {pillRect && (
            <div
              className={`nav__pill${pillSettling ? ' nav__pill--settle' : ''}`}
              style={{ left: pillRect.left, width: pillRect.width }}
              onAnimationEnd={() => setPillSettling(false)}
            />
          )}
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el) itemRefs.current.set(t.id, el)
                else itemRefs.current.delete(t.id)
              }}
              className="nav__item"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <span className="nav__icon">
                <Icon name={t.icon} size={21} strokeWidth={tab === t.id ? 2.2 : 1.7} />
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
