import { useState } from 'react'
import { AppProvider, useApp, useSyncStatus } from './state'
import { WeekScreen } from './screens/WeekScreen'
import { RouletteScreen } from './screens/RouletteScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { ShoppingScreen } from './screens/ShoppingScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Onboarding } from './screens/Onboarding'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import { formatWeekRange } from './engine/dates'
import { currentWeekStart } from './services/week'

type Tab = 'week' | 'roulette' | 'library' | 'shopping' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'week', label: 'השבוע', icon: 'calendar' },
  { id: 'roulette', label: 'רולטה', icon: 'wheel' },
  { id: 'library', label: 'מאגר', icon: 'list' },
  { id: 'shopping', label: 'קניות', icon: 'cart' },
]

function Shell() {
  const { household, ready, settings } = useApp()
  const [tab, setTab] = useState<Tab>('week')
  const sync = useSyncStatus()

  if (!ready) return <div className="app" />
  if (!household) return <Onboarding />

  const titles: Record<Tab, string> = {
    week: 'השבוע',
    roulette: 'רולטה',
    library: 'המאגר',
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
          className="btn btn--ghost btn--icon"
          aria-label="הגדרות"
          aria-pressed={tab === 'settings'}
          onClick={() => setTab(tab === 'settings' ? 'week' : 'settings')}
        >
          <Icon name="sliders" size={19} />
        </button>
      </header>

      <main className="app__main">
        {tab === 'week' && (
          <WeekScreen householdId={household.id} onGoToRoulette={() => setTab('roulette')} />
        )}
        {tab === 'roulette' && <RouletteScreen householdId={household.id} />}
        {tab === 'library' && <LibraryScreen householdId={household.id} />}
        {tab === 'shopping' && <ShoppingScreen householdId={household.id} />}
        {tab === 'settings' && <SettingsScreen householdId={household.id} />}
      </main>

      <div className="nav-dock">
        <nav className="nav" aria-label="ניווט ראשי">
          {TABS.map((t) => (
            <button
              key={t.id}
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
