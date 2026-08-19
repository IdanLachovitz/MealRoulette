import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, save } from '../db/repo'
import { importSeedLibrary, SEED_COUNTS } from '../db/seed'
import { notifyHouseholdChanged, useApp, useSyncStatus } from '../state'
import { EmptyState, Field, Notice, Switch } from '../components/ui'
import { getSupabase, isSyncConfigured } from '../sync/supabase'
import { runSync } from '../sync/sync'
import { currentUserEmail, joinHousehold, registerHousehold, signOut } from '../sync/household'
import { daysBetween, toISODate } from '../engine/dates'
import type { Component, CookHistory, Dish, Household } from '../types'
import { COMPONENT_LABEL } from '../types'

export function SettingsScreen({ householdId }: { householdId: string }) {
  const { household, settings, updateSettings, theme, setTheme, toast } = useApp()
  const [section, setSection] = useState<'settings' | 'history'>('settings')

  if (!household) return null

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button
          className="segmented__btn"
          aria-pressed={section === 'settings'}
          onClick={() => setSection('settings')}
        >
          הגדרות
        </button>
        <button
          className="segmented__btn"
          aria-pressed={section === 'history'}
          onClick={() => setSection('history')}
        >
          היסטוריה
        </button>
      </div>

      {section === 'history' ? (
        <HistorySection householdId={householdId} />
      ) : (
        <>
          <SyncSection household={household} />

          <div className="card">
            <Field label="כמה אנשים אוכלים" hint="בסיס חישוב הכמויות ברשימת הקניות.">
              <input
                className="field__input"
                type="number"
                inputMode="numeric"
                min={1}
                value={settings.default_diners}
                onChange={(e) =>
                  void updateSettings({ default_diners: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </Field>

            <Field label="ברירת מחדל: כמה בישולים בשבוע">
              <div className="chips">
                {[2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className="chip"
                    aria-pressed={settings.default_cook_days_count === n}
                    onClick={() => void updateSettings({ default_cook_days_count: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="צינון מנה (ימים)" hint="מנה שבושלה לא תוגרל שוב בתוך התקופה הזו.">
              <input
                className="field__input"
                type="number"
                inputMode="numeric"
                min={0}
                value={settings.dish_cooldown_days}
                onChange={(e) =>
                  void updateSettings({ dish_cooldown_days: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </Field>

            <Field label="צינון רכיב (ימים)">
              <input
                className="field__input"
                type="number"
                inputMode="numeric"
                min={0}
                value={settings.component_cooldown_days}
                onChange={(e) =>
                  void updateSettings({
                    component_cooldown_days: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </Field>

            <div className="row row--between" style={{ marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 14 }}>טבעת ירק ברולטה</div>
                <div className="field__hint">כשכבוי, ההרכבה חוזרת לשתי טבעות.</div>
              </div>
              <Switch
                checked={settings.veg_enabled}
                onChange={(v) => void updateSettings({ veg_enabled: v })}
                label="טבעת ירק"
              />
            </div>
          </div>

          <div className="card">
            <span className="label">מראה</span>
            <div className="chips" style={{ marginTop: 8 }}>
              {(
                [
                  ['system', 'לפי המכשיר'],
                  ['light', 'בהיר'],
                  ['dark', 'כהה'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className="chip"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <BackupSection householdId={householdId} onToast={toast} />
        </>
      )}
    </div>
  )
}

function SyncSection({ household }: { household: Household }) {
  const { state, pending } = useSyncStatus()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentUserEmail().then(setSignedInAs)
  }, [state])

  const guard = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isSyncConfigured) {
    return (
      <div className="card">
        <span className="label">סנכרון</span>
        <p className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
          הסנכרון כבוי — האפליקציה שומרת הכל על המכשיר הזה בלבד. כדי להדליק אותו צריך
          להזין מפתחות Supabase בקובץ <code>.env</code> ולבנות מחדש. עד אז הכל עובד, פשוט
          לא עובר בין מכשירים.
        </p>
      </div>
    )
  }

  const label: Record<typeof state, string> = {
    off: 'כבוי',
    idle: 'מסונכרן',
    syncing: 'מסנכרן…',
    offline: 'אין רשת — נשמר מקומית',
    error: 'תקלה בסנכרון',
  }

  return (
    <div className="card">
      <div className="row row--between">
        <span className="label">סנכרון</span>
        <span className="muted">
          {label[state]}
          {pending > 0 && ` · ${pending} ממתינים`}
        </span>
      </div>

      {!signedInAs ? (
        <>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <input
              className="field__input"
              type="email"
              inputMode="email"
              value={email}
              placeholder="המייל שלך"
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="btn btn--ghost"
              disabled={!email.includes('@') || busy}
              onClick={() =>
                void guard(async () => {
                  const client = await getSupabase()!
                  // Redirect back to wherever this was opened from — the deployed
                  // site or a local dev server — instead of relying solely on
                  // Supabase's dashboard "Site URL" default.
                  const { error: err } = await client.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.origin + window.location.pathname },
                  })
                  if (err) throw err
                  setSent(true)
                })
              }
            >
              התחברות
            </button>
          </div>
          {sent && (
            <p className="field__hint">
              נשלח קישור התחברות ל־{email}. אחרי שתלחצי עליו, חזרי לכאן.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="field__hint" style={{ marginTop: 8 }}>
            מחוברת כ־{signedInAs}
          </p>

          {/* Two ways in: publish this kitchen, or join the one your partner made. */}
          <div className="stack" style={{ marginTop: 10 }}>
            <button
              className="btn btn--ghost btn--block"
              disabled={busy}
              onClick={() => void guard(() => registerHousehold(household))}
            >
              פרסמי את המטבח הזה לשרת
            </button>

            <div className="row" style={{ gap: 8 }}>
              <input
                className="field__input"
                value={code}
                maxLength={6}
                placeholder="קוד הצטרפות"
                style={{ letterSpacing: '0.2em', textTransform: 'uppercase' }}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                className="btn btn--ghost"
                disabled={code.trim().length !== 6 || busy}
                onClick={() =>
                  void guard(async () => {
                    await joinHousehold(code)
                    notifyHouseholdChanged()
                  })
                }
              >
                הצטרפי
              </button>
            </div>

            <div className="row">
              <button
                className="btn btn--sm btn--ghost"
                style={{ flex: 1 }}
                onClick={() => void runSync()}
              >
                סנכרון עכשיו
              </button>
              <button
                className="btn btn--sm btn--ghost"
                style={{ flex: 1 }}
                onClick={() => void guard(async () => {
                  await signOut()
                  setSignedInAs(null)
                })}
              >
                התנתקות
              </button>
            </div>
          </div>
        </>
      )}

      {error && <p className="field__error">{error}</p>}

      <p className="field__hint" style={{ marginTop: 10 }}>
        קוד הצטרפות למטבח הזה:{' '}
        <strong style={{ letterSpacing: '0.15em' }}>{household.invite_code}</strong>
        {' — '}מסרי אותו לבן/בת הזוג כדי שיצטרפו לאותו מאגר.
      </p>
    </div>
  )
}

function BackupSection({
  householdId,
  onToast,
}: {
  householdId: string
  onToast: (t: string) => void
}) {
  const [busy, setBusy] = useState(false)

  const exportJson = async () => {
    const [dishes, components] = await Promise.all([
      db.dishes.where('household_id').equals(householdId).toArray(),
      db.components.where('household_id').equals(householdId).toArray(),
    ])
    const payload = {
      schema: 'meal-planner v1.1',
      exported_at: new Date().toISOString(),
      dishes: alive(dishes),
      components: alive(components),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meal-library-${toISODate(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card">
      <span className="label">גיבוי ומאגר</span>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn btn--ghost btn--block" onClick={() => void exportJson()}>
          ייצוא המאגר כ־JSON
        </button>
        <button
          className="btn btn--ghost btn--block"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const added = await importSeedLibrary(householdId)
            const parts: string[] = []
            if (added.dishes + added.components > 0) {
              parts.push(`נוספו ${added.dishes} מנות ו־${added.components} רכיבים`)
            }
            if (added.backfilled > 0) {
              parts.push(`עודכנו מצרכים ב־${added.backfilled} פריטים קיימים`)
            }
            onToast(parts.length ? parts.join(' · ') : 'הכל כבר במאגר ומעודכן')
            setBusy(false)
          }}
        >
          ייבוא מאגר ההתחלה ({SEED_COUNTS.dishes} מנות, {SEED_COUNTS.components} רכיבים)
        </button>
      </div>
      <p className="field__hint" style={{ marginTop: 8 }}>
        הייבוא מדלג על פריטים שכבר קיימים ומעדכן מצרכים חסרים בפריטים שכבר יובאו, אז אפשר
        להריץ אותו שוב בלי לשכפל.
      </p>
    </div>
  )
}

/** FR-5.6 — what was cooked, when, and how often over the last three months. */
function HistorySection({ householdId }: { householdId: string }) {
  const history = useLiveQuery(
    async () => alive(await db.cookHistory.where('household_id').equals(householdId).toArray()),
    [householdId],
    [] as CookHistory[],
  )
  const dishes = useLiveQuery(
    async () => alive(await db.dishes.where('household_id').equals(householdId).toArray()),
    [householdId],
    [] as Dish[],
  )
  const components = useLiveQuery(
    async () => alive(await db.components.where('household_id').equals(householdId).toArray()),
    [householdId],
    [] as Component[],
  )

  const today = toISODate(new Date())

  const rows = useMemo(() => {
    const nameOf = new Map<string, string>()
    for (const d of dishes ?? []) nameOf.set(d.id, d.name)
    for (const c of components ?? []) nameOf.set(c.id, c.name)

    const recent = (history ?? []).filter((h) => daysBetween(h.cooked_on, today) <= 92)
    const grouped = new Map<string, { name: string; count: number; last: string; type: string }>()
    for (const h of recent) {
      const key = h.entity_id
      const existing = grouped.get(key)
      if (existing) {
        existing.count++
        if (h.cooked_on > existing.last) existing.last = h.cooked_on
      } else {
        grouped.set(key, {
          name: nameOf.get(h.entity_id) ?? 'פריט שנמחק',
          count: 1,
          last: h.cooked_on,
          type: h.entity_type,
        })
      }
    }
    return [...grouped.values()].sort((a, b) => b.last.localeCompare(a.last))
  }, [history, dishes, components, today])

  const excluded = useMemo(
    () => [
      ...(dishes ?? []).filter((d) => d.is_excluded).map((d) => ({ id: d.id, name: d.name, kind: 'dish' as const })),
      ...(components ?? [])
        .filter((c) => c.is_excluded)
        .map((c) => ({ id: c.id, name: c.name, kind: 'component' as const })),
    ],
    [dishes, components],
  )

  return (
    <div>
      {excluded.length > 0 && (
        <div className="card">
          <span className="label">מודרים — "לא להציע לי את זה"</span>
          <div className="stack" style={{ marginTop: 8 }}>
            {excluded.map((item) => (
              <div key={item.id} className="row row--between">
                <span style={{ fontSize: 14 }}>{item.name}</span>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={async () => {
                    if (item.kind === 'dish') {
                      const dish = (dishes ?? []).find((d) => d.id === item.id)
                      if (dish) await save('dishes', { ...dish, is_excluded: false })
                    } else {
                      const comp = (components ?? []).find((c) => c.id === item.id)
                      if (comp) await save('components', { ...comp, is_excluded: false })
                    }
                  }}
                >
                  החזרה
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="🗓️"
          title="עוד לא בושל כלום"
          body='אחרי שתסמני בישול כ"בושל", הוא יופיע כאן — וגם ייכנס לצינון כדי שלא יחזור מיד.'
        />
      ) : (
        <>
          <Notice>שלושת החודשים האחרונים. הצינון מחושב מהתאריך האחרון בכל שורה.</Notice>
          {rows.map((row) => (
            <div key={row.name + row.last} className="list-row">
              <span className="list-row__name">{row.name}</span>
              <span className="item__qty">
                {row.type !== 'dish' && `${COMPONENT_LABEL[row.type as 'protein']} · `}
                {row.count === 1 ? 'פעם אחת' : `${row.count} פעמים`}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
