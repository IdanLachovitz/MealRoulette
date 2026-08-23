import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, save } from '../db/repo'
import { useApp } from '../state'
import { Notice, Sheet, Switch } from '../components/ui'
import { Icon } from '../components/Icon'
import { DishPicture } from '../components/DishArt'
import { PickDishSheet } from './PickDishSheet'
import { addDays, dayName, dayOfMonth, formatWeekRange, toISODate } from '../engine/dates'
import type { Notice as PlanNotice } from '../engine/planner'
import {
  currentWeekStart,
  deleteSession,
  ensureWeekPlan,
  markCooked,
  runPlanningWizard,
  setCoversDays,
  setDayRole,
} from '../services/week'
import type { Component, CookSession, DaySlot, Dish, PlanningParams, WeekPlan } from '../types'

export function WeekScreen({
  householdId,
  onGoToRoulette,
}: {
  householdId: string
  onGoToRoulette: () => void
}) {
  const { settings, toast } = useApp()
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [notices, setNotices] = useState<PlanNotice[]>([])
  const [editing, setEditing] = useState<CookSession | null>(null)
  const [view, setView] = useState<'days' | 'sessions'>('days')
  const [chooserDate, setChooserDate] = useState<string | null>(null)
  const [pickingDate, setPickingDate] = useState<string | null>(null)
  /** 0 = the real current week, 1 = next week, -1 = last week, etc. */
  const [weekOffset, setWeekOffset] = useState(0)

  const realWeekStart = currentWeekStart(settings)
  const weekStart = addDays(realWeekStart, weekOffset * 7)
  /** A scrollable strip of nearby weeks to jump between — a bit of the past, mostly ahead. */
  const weekOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => i - 2),
    [],
  )

  useEffect(() => {
    void ensureWeekPlan(householdId, weekStart, settings).then(setPlan)
  }, [householdId, weekStart, settings])

  const days = useLiveQuery(
    async () => (plan ? alive(await db.daySlots.where('week_plan_id').equals(plan.id).toArray()) : []),
    [plan?.id],
    [] as DaySlot[],
  )
  const sessions = useLiveQuery(
    async () =>
      plan ? alive(await db.cookSessions.where('week_plan_id').equals(plan.id).toArray()) : [],
    [plan?.id],
    [] as CookSession[],
  )
  const dishes = useLiveQuery(
    () => db.dishes.where('household_id').equals(householdId).toArray(),
    [householdId],
    [] as Dish[],
  )
  const components = useLiveQuery(
    () => db.components.where('household_id').equals(householdId).toArray(),
    [householdId],
    [],
  )

  const dishById = useMemo(() => new Map((dishes ?? []).map((d) => [d.id, d])), [dishes])
  const compById = useMemo(
    () => new Map((components ?? []).map((c) => [c.id, c])),
    [components],
  )
  const sessionById = useMemo(
    () => new Map((sessions ?? []).map((s) => [s.id, s])),
    [sessions],
  )

  const describe = (session: CookSession | undefined): string => {
    if (!session) return ''
    if (session.source_type === 'dish') {
      return dishById.get(session.dish_id ?? '')?.name ?? 'מנה שנמחקה'
    }
    return [session.protein_id, session.carb_id, session.veg_id]
      .map((id) => (id ? compById.get(id)?.name : null))
      .filter(Boolean)
      .join(' + ')
  }

  /**
   * What to draw for a session. A combo has no dish row and so no photo, but its
   * label ("חזה עוף + אורז + ברוקולי") classifies just as well as a dish name
   * does, so it still gets a picture of roughly the right food.
   */
  const pictureFor = (session: CookSession | undefined) => {
    if (!session) return null
    if (session.source_type === 'dish') {
      const dish = dishById.get(session.dish_id ?? '')
      if (!dish) return null
      return {
        name: dish.name,
        ingredients: dish.ingredients.map((i) => i.name),
        imageUrl: dish.image_url,
      }
    }
    const parts = [session.protein_id, session.carb_id, session.veg_id]
      .map((id) => (id ? compById.get(id) : undefined))
      .filter((c): c is Component => !!c)
    if (parts.length === 0) return null
    return {
      name: parts.map((c) => c.name).join(' + '),
      ingredients: parts.flatMap((c) => c.ingredients.map((i) => i.name)),
      imageUrl: null,
    }
  }

  const sortedDays = useMemo(
    () => [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [days],
  )
  const sortedSessions = useMemo(
    () => [...(sessions ?? [])].sort((a, b) => a.cook_date.localeCompare(b.cook_date)),
    [sessions],
  )

  const covered = sortedDays.filter((d) => d.role === 'cook' || d.role === 'leftovers').length
  const totalMinutes = sortedSessions.reduce((sum, s) => sum + s.estimated_minutes, 0)
  const today = toISODate(new Date())

  const runWizard = async (params: PlanningParams) => {
    if (!plan) return
    const result = await runPlanningWizard(householdId, plan, params, settings)
    setNotices(result.notices)
    setWizardOpen(false)
    toast(`נוצרו ${result.sessions.length} בישולים`)
  }

  if (!plan) return <div className="muted">טוען…</div>

  const libraryEmpty = (dishes ?? []).filter((d) => !d.deleted_at && d.is_active).length === 0

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {weekOptions.map((offset) => (
          <button
            key={offset}
            className="chip"
            aria-pressed={offset === weekOffset}
            onClick={() => setWeekOffset(offset)}
          >
            {offset === 0 ? 'השבוע' : formatWeekRange(addDays(realWeekStart, offset * 7))}
          </button>
        ))}
      </div>

      <div className="row row--between" style={{ marginBottom: 10 }}>
        <span className="label">{formatWeekRange(plan.week_start_date)}</span>
        <div className="row" style={{ gap: 4 }}>
          <button
            className="chip"
            aria-pressed={view === 'days'}
            onClick={() => setView('days')}
          >
            ימים
          </button>
          <button
            className="chip"
            aria-pressed={view === 'sessions'}
            onClick={() => setView('sessions')}
          >
            בישולים
          </button>
        </div>
      </div>

      {/* FR-9.5 */}
      <div className="summary">
        <div className="summary__cell">
          <div className="summary__num">{sortedSessions.length}</div>
          <div className="summary__lbl">בישולים</div>
        </div>
        <div className="summary__cell">
          <div className="summary__num">{covered}</div>
          <div className="summary__lbl">ימים מכוסים</div>
        </div>
        <div className="summary__cell">
          <div className="summary__num">
            {totalMinutes >= 60
              ? `${Math.round((totalMinutes / 60) * 10) / 10} ש׳`
              : `${totalMinutes} דק׳`}
          </div>
          <div className="summary__lbl">מטבח השבוע</div>
        </div>
      </div>

      {notices.map((n) => (
        <Notice key={n.code} warn={n.code !== 'cooldown_relaxed' && n.code !== 'cycle_restarted'}>
          {n.message}
        </Notice>
      ))}

      {libraryEmpty ? (
        <Notice warn>
          המאגר ריק, אז אי אפשר לתכנן עדיין. הוסיפי מנה במסך המאגר — שם וזמן הכנה מספיקים.
        </Notice>
      ) : (
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => setWizardOpen(true)}
          >
            תכנני לי את השבוע
          </button>
        </div>
      )}

      {view === 'days' ? (
        <div>
          {sortedDays.map((day) => {
            const session = day.cook_session_id ? sessionById.get(day.cook_session_id) : undefined

            // "Not cooking" is deliberately a bare row with no card, so it can never
            // be confused with a leftovers day at a glance or in greyscale.
            if (day.role === 'none') {
              return (
                <button
                  key={day.id}
                  className="day day--none"
                  onClick={() => void setDayRole(day, 'empty')}
                >
                  <div className="day__date">
                    <div className="day__dow">{dayName(day.date)}</div>
                    <div className="day__num">{dayOfMonth(day.date)}</div>
                  </div>
                  <div className="day__body">
                    <div className="muted">לא מבשלים</div>
                  </div>
                </button>
              )
            }

            const classes = ['day']
            if (day.date === today) classes.push('day--today')
            if (day.role === 'cook') classes.push('day--cook')
            if (day.role === 'leftovers') classes.push('day--leftovers')
            if (day.role === 'empty') classes.push('day--empty')

            return (
              <button
                key={day.id}
                className={classes.join(' ')}
                onClick={() => {
                  if (session) setEditing(session)
                  else setChooserDate(day.date)
                }}
              >
                <div className="day__date">
                  <div className="day__dow">{dayName(day.date)}</div>
                  <div className="day__num">{dayOfMonth(day.date)}</div>
                </div>
                {/* The picture sits between the date and the name, so the row
                    reads day → what → details. Only days with something planned
                    get one; an empty day keeps its dashed, deliberately bare look. */}
                {(() => {
                  const pic = pictureFor(session)
                  return pic ? (
                    <DishPicture
                      className="day__shot"
                      name={pic.name}
                      ingredients={pic.ingredients}
                      imageUrl={pic.imageUrl}
                    />
                  ) : null
                })()}
                <div className="day__body">
                  {day.role === 'cook' && (
                    <>
                      <div className="day__title">{describe(session)}</div>
                      <div className="day__meta">
                        <span className="row" style={{ gap: 3 }}>
                          <Icon name="flame" size={13} />
                          מבשלים
                        </span>
                        <span>·</span>
                        <span>{session?.estimated_minutes} דק׳</span>
                        {session && session.covers_days > 1 && (
                          <>
                            <span>·</span>
                            <span>מספיק ל־{session.covers_days} ימים</span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {/* Leftovers always name their source, which is the other half of
                      the distinction from a "not cooking" day. */}
                  {day.role === 'leftovers' && (
                    <>
                      <div className="day__title">שאריות מ{describe(session)}</div>
                      <div className="day__meta">
                        <span className="row" style={{ gap: 3 }}>
                          <Icon name="refresh" size={13} />
                          בלי לבשל
                        </span>
                      </div>
                    </>
                  )}
                  {day.role === 'empty' && <div className="day__title">אין תוכנית — הקישי לשיבוץ</div>}
                </div>
                {session?.is_locked && (
                  <span className="day__badge">
                    <Icon name="lock" size={15} />
                  </span>
                )}
                {session?.is_cooked && (
                  <span className="day__badge" style={{ color: 'var(--pist)' }}>
                    <Icon name="check" size={16} strokeWidth={2.4} />
                  </span>
                )}
              </button>
            )
          })}

          <p className="field__hint" style={{ marginTop: 10 }}>
            הקשה על יום מכוסה פותחת את הבישול. כדי לסמן יום כ"לא מבשלים", פתחי אותו ובחרי באפשרות.
          </p>
        </div>
      ) : (
        <SessionsView
          sessions={sortedSessions}
          describe={describe}
          dishById={dishById}
          onEdit={setEditing}
          onToggleCooked={(s) => void markCooked(householdId, s, !s.is_cooked)}
        />
      )}

      {wizardOpen && (
        <PlanningWizard
          initial={plan.planning_params}
          maxCookDays={sortedDays.filter((d) => d.role !== 'none').length}
          onClose={() => setWizardOpen(false)}
          onRun={runWizard}
        />
      )}

      {editing && (
        <SessionSheet
          session={editing}
          title={describe(editing)}
          day={sortedDays.find((d) => d.date === editing.cook_date)}
          maxCoverDays={
            editing.dish_id ? (dishById.get(editing.dish_id)?.max_cover_days ?? 4) : 4
          }
          onClose={() => setEditing(null)}
          householdId={householdId}
          onPickDifferent={(date) => {
            setEditing(null)
            setPickingDate(date)
          }}
        />
      )}

      {/* Tapping an unplanned day asks how to fill it — spin, or pick straight
          from the library — rather than assuming the wheel is always wanted. */}
      {chooserDate && (
        <Sheet title={`מה מבשלים ב${dayName(chooserDate)}?`} onClose={() => setChooserDate(null)}>
          <div className="stack">
            <button
              className="btn btn--primary btn--block"
              onClick={() => {
                setChooserDate(null)
                onGoToRoulette()
              }}
            >
              <Icon name="wheel" size={16} />
              סובבי רולטה
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                setPickingDate(chooserDate)
                setChooserDate(null)
              }}
            >
              <Icon name="list" size={16} />
              בחרי מנה מהמאגר
            </button>
          </div>
        </Sheet>
      )}

      {pickingDate && (
        <PickDishSheet
          householdId={householdId}
          plan={plan}
          date={pickingDate}
          settings={settings}
          onClose={() => setPickingDate(null)}
          onAssigned={(name) => toast(`${name} שובץ ל${dayName(pickingDate)}`)}
        />
      )}
    </div>
  )
}

/** FR-9 — the "when am I standing in the kitchen" view. */
function SessionsView({
  sessions,
  describe,
  dishById,
  onEdit,
  onToggleCooked,
}: {
  sessions: CookSession[]
  describe: (s: CookSession | undefined) => string
  dishById: Map<string, Dish>
  onEdit: (s: CookSession) => void
  onToggleCooked: (s: CookSession) => void
}) {
  if (sessions.length === 0) {
    return <p className="muted">אין עדיין בישולים השבוע.</p>
  }

  return (
    <div>
      {sessions.map((s) => {
        const dish = s.dish_id ? dishById.get(s.dish_id) : undefined
        // FR-9.3 — a dish that can stretch further than it was scheduled for.
        const canExtend = dish && dish.max_cover_days > s.covers_days
        return (
          <div key={s.id} className="card">
            <div className="row row--between">
              <div style={{ flex: 1 }}>
                <div className="label">
                  {dayName(s.cook_date)} · {dayOfMonth(s.cook_date)}
                </div>
                <div style={{ fontSize: 15, marginTop: 2 }}>{describe(s)}</div>
                <div className="day__meta">
                  <span>{s.estimated_minutes} דק׳</span>
                  <span>·</span>
                  <span>{s.servings} מנות</span>
                  <span>·</span>
                  <span>מכסה {s.covers_days === 1 ? 'יום אחד' : `${s.covers_days} ימים`}</span>
                </div>
              </div>
              <button
                className="btn btn--sm btn--subtle"
                aria-pressed={s.is_cooked}
                onClick={() => onToggleCooked(s)}
              >
                {s.is_cooked && <Icon name="check" size={14} strokeWidth={2.4} />}
                {s.is_cooked ? 'בושל' : 'סמני בושל'}
              </button>
            </div>

            {canExtend && (
              <p className="field__hint" style={{ marginTop: 8 }}>
                אפשר להכפיל — המנה הזו מספיקה לעד {dish!.max_cover_days} ימים.
              </p>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn--sm btn--ghost" onClick={() => onEdit(s)}>
                עריכה
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** FR-4.1 — the three-question wizard. */
function PlanningWizard({
  initial,
  maxCookDays,
  onClose,
  onRun,
}: {
  initial: PlanningParams
  maxCookDays: number
  onClose: () => void
  onRun: (p: PlanningParams) => Promise<void>
}) {
  const [count, setCount] = useState(Math.min(initial.cook_days_count, Math.max(1, maxCookDays)))
  const [leftovers, setLeftovers] = useState(initial.include_leftovers)
  const [maxPrep, setMaxPrep] = useState<number | null>(initial.max_prep_time)
  const [busy, setBusy] = useState(false)

  // EC-15 — never offer more cook days than there are free days.
  const options = [2, 3, 4, 5].filter((n) => n <= Math.max(2, maxCookDays))

  return (
    <Sheet title="תכנני לי את השבוע" onClose={onClose}>
      <div className="field">
        <span className="label">כמה פעמים לבשל השבוע?</span>
        <div className="chips">
          {options.map((n) => (
            <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        {maxCookDays < 5 && (
          <span className="field__hint">יש {maxCookDays} ימים פנויים השבוע.</span>
        )}
      </div>

      <div className="field">
        <div className="row row--between">
          <span className="label">לשלב שאריות?</span>
          <Switch checked={leftovers} onChange={setLeftovers} label="לשלב שאריות" />
        </div>
        <span className="field__hint">
          {leftovers
            ? 'כל בישול יכסה גם את היום או היומיים שאחריו.'
            : 'כל בישול מכסה יום אחד. ימים שלא נכנסו יישארו ריקים.'}
        </span>
      </div>

      <div className="field">
        <span className="label">זמן הכנה מקסימלי</span>
        <div className="chips">
          {[
            { label: 'עד 20', value: 20 },
            { label: 'עד 40', value: 40 },
            { label: 'ללא הגבלה', value: null },
          ].map((o) => (
            <button
              key={o.label}
              className="chip"
              aria-pressed={maxPrep === o.value}
              onClick={() => setMaxPrep(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void onRun({
            cook_days_count: count,
            include_leftovers: leftovers,
            max_prep_time: maxPrep,
          }).finally(() => setBusy(false))
        }}
      >
        {busy ? 'מתכננת…' : 'תכנני'}
      </button>
    </Sheet>
  )
}

function SessionSheet({
  session,
  title,
  day,
  maxCoverDays,
  onClose,
  householdId,
  onPickDifferent,
}: {
  session: CookSession
  title: string
  day: DaySlot | undefined
  maxCoverDays: number
  onClose: () => void
  householdId: string
  onPickDifferent: (date: string) => void
}) {
  const { settings, toast } = useApp()
  const [note, setNote] = useState(session.note ?? '')

  return (
    <Sheet title={title || 'בישול'} onClose={onClose}>
      <div className="field">
        <span className="label">כמה ימים זה מכסה?</span>
        <div className="chips">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className="chip"
              aria-pressed={session.covers_days === n}
              disabled={n > Math.max(1, maxCoverDays)}
              onClick={() => void setCoversDays(session, n, settings)}
            >
              {n === 1 ? 'יום' : `${n} ימים`}
            </button>
          ))}
        </div>
        {maxCoverDays < 4 && (
          <span className="field__hint">
            המנה הזו מוגדרת כמספיקה לעד {maxCoverDays} ימים. אפשר לשנות במסך המנה.
          </span>
        )}
      </div>

      <div className="field">
        <span className="label">הערה</span>
        <input
          className="field__input"
          value={note}
          maxLength={120}
          placeholder="להוציא מהמקפיא בבוקר"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void save('cook_sessions', { ...session, note: note.trim() || null })}
        />
      </div>

      <div className="stack">
        <button
          className="btn btn--ghost btn--block"
          onClick={() => onPickDifferent(session.cook_date)}
        >
          <Icon name="list" size={16} />
          בחרי מנה אחרת מהמאגר
        </button>
        <button
          className="btn btn--ghost btn--block"
          onClick={() => void save('cook_sessions', { ...session, is_locked: !session.is_locked })}
        >
          <Icon name={session.is_locked ? 'lockOpen' : 'lock'} size={16} />
          {session.is_locked ? 'ביטול נעילה' : 'נעילה — תכנון מחדש לא ישנה את זה'}
        </button>
        <button
          className="btn btn--subtle btn--block"
          onClick={() => void markCooked(householdId, session, !session.is_cooked)}
        >
          {session.is_cooked ? 'ביטול סימון "בושל"' : 'סמני כבושל'}
        </button>
        {day && (
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              void setDayRole(day, day.role === 'none' ? 'empty' : 'none')
              onClose()
            }}
          >
            {day.role === 'none' ? 'החזרת היום לתכנון' : 'סמני "לא מבשלים" ביום הזה'}
          </button>
        )}
        <button
          className="btn btn--danger btn--block"
          onClick={() => {
            void deleteSession(session, settings)
            toast('הבישול נמחק')
            onClose()
          }}
        >
          מחיקת הבישול
        </button>
      </div>
    </Sheet>
  )
}
