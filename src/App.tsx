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
  // `offset` drives a CSS transform (translateX), not `left` — left/width
  // are layout properties, so animating them forces a layout recalculation
  // on every frame. That's cheap enough on a desktop browser to look fine,
  // but it's exactly the kind of per-frame layout thrash that shows up as
  // real stutter on a phone, especially on one big jump (a tap straight
  // across the bar) rather than the many tiny steps a slow drag produces.
  // transform is compositor-only — same smoothness regardless of distance
  // or device. Width itself never actually changes between tabs (they're
  // equal-width flex items), only on a resize, so it doesn't need to be
  // part of the animated path at all.
  const [pillRect, setPillRect] = useState<{ offset: number; width: number } | null>(null)
  const [pillSettling, setPillSettling] = useState(false)
  const dragPointerId = useRef<number | null>(null)
  // Which tab a finger is currently over mid-drag — separate from `tab`
  // itself so the pill (and the icon colour) can chase the finger live
  // while the actual screen underneath only switches once the finger lifts
  // and that choice is committed. Null whenever there's no drag in progress.
  // Mirrored into a ref alongside the state: a fast drag can fire
  // pointerdown/move/up before React re-renders between them, and reading
  // `dragTab` state from the pointerup closure in that case would still see
  // its value from *before* the drag started — the ref is always current.
  const [dragTab, setDragTab] = useState<Tab | null>(null)
  const dragTabRef = useRef<Tab | null>(null)
  const displayTab = dragTab ?? tab

  const updatePill = useCallback((activeTab: Tab) => {
    const navEl = navRef.current
    const itemEl = itemRefs.current.get(activeTab)
    if (!navEl || !itemEl) {
      setPillRect(null)
      return
    }
    const navBox = navEl.getBoundingClientRect()
    const itemBox = itemEl.getBoundingClientRect()
    setPillRect({ offset: itemBox.left - navBox.left, width: itemBox.width })
  }, [])

  // useLayoutEffect, not useEffect — measuring after paint would let the
  // pill visibly jump into place on first load instead of just appearing
  // where it belongs.
  //
  // `household` is in the deps for a reason that isn't obvious from this
  // effect alone: on a cold load, Shell renders once (maybe several times)
  // before `ready`/`household` resolve, and during that stretch it returns
  // early below with no <nav> in the tree at all — so this effect's first
  // run finds no DOM to measure and leaves pillRect null. Once the real
  // nav mounts, `displayTab` hasn't changed (still the initial 'week'), so
  // without `household` here the effect would never fire again and the
  // pill would just never appear until the next tab switch.
  useLayoutEffect(() => {
    updatePill(displayTab)
  }, [displayTab, updatePill, household])

  useEffect(() => {
    const onResize = () => updatePill(displayTab)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [displayTab, updatePill])

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
  // chasing it the whole way, the same gesture an iOS segmented control
  // uses. Only dragTab moves during the drag itself; the screen underneath
  // stays put until the finger actually lifts, which is what "picks" the
  // tab it's over at that moment — committed to `tab` with a little
  // settle-bounce on the pill, never mid-drag.
  const onNavPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    dragPointerId.current = e.pointerId
    setPillSettling(false)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nice-to-have; its failure shouldn't sink the gesture.
    }
    const hit = tabAt(e.clientX, e.clientY)
    dragTabRef.current = hit
    setDragTab(hit)
  }

  const onNavPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (dragPointerId.current !== e.pointerId) return
    const hit = tabAt(e.clientX, e.clientY)
    dragTabRef.current = hit
    setDragTab(hit)
  }

  const onNavPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (dragPointerId.current !== e.pointerId) return
    dragPointerId.current = null
    if (dragTabRef.current) setTab(dragTabRef.current)
    dragTabRef.current = null
    setDragTab(null)
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
              className="nav__pill"
              style={{ width: pillRect.width, transform: `translateX(${pillRect.offset}px)` }}
            >
              {/* Position (outer, transform) and the settle squash (inner)
                  animate separately on purpose — both are transforms, and
                  one element can't run two independent transform animations
                  (an inline translateX plus a keyframe's scaleX) at once
                  without one silently overwriting the other. */}
              <div
                className={`nav__pill-fill${pillSettling ? ' nav__pill-fill--settle' : ''}`}
                onAnimationEnd={() => setPillSettling(false)}
              />
            </div>
          )}
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el) itemRefs.current.set(t.id, el)
                else itemRefs.current.delete(t.id)
              }}
              className="nav__item"
              aria-current={displayTab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <span className="nav__icon">
                <Icon name={t.icon} size={21} strokeWidth={displayTab === t.id ? 2.2 : 1.7} />
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
