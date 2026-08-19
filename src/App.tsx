import { useState } from 'react'
import { AppProvider, useApp, useSyncStatus } from './state'
import { WeekScreen } from './screens/WeekScreen'
import { RouletteScreen } from './screens/RouletteScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { ShoppingScreen } from './screens/ShoppingScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Onboarding } from './screens/Onboarding'
import { formatWeekRange } from './engine/dates'
import { currentWeekStart } from './services/week'

type Tab = 'week' | 'roulette' | 'library' | 'shopping' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'week', label: 'השבוע', icon: '🗓️' },
  { id: 'roulette', label: 'רולטה', icon: '🎯' },
  { id: 'library', label: 'מאגר', icon: '📋' },
  { id: 'shopping', label: 'קניות', icon: '🛒' },
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
          <span className="label" title="נשמר מקומית, יסונכרן כשתהיה רשת">
            ⌁ לא מחובר
          </span>
        )}
        {sync.state === 'syncing' && <span className="label">מסנכרן…</span>}

        <button
          className="btn btn--sm btn--ghost"
          aria-label="הגדרות"
          aria-pressed={tab === 'settings'}
          onClick={() => setTab(tab === 'settings' ? 'week' : 'settings')}
        >
          ⚙︎
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

      <nav className="nav" aria-label="ניווט ראשי">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="nav__item"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="nav__icon" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
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
