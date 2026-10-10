import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, save } from '../db/repo'
import { useApp } from '../state'
import { CoverDaysChips, Notice, Sheet, Switch } from '../components/ui'
import { Icon } from '../components/Icon'
import { DishPicture } from '../components/DishArt'
import { PickDishSheet } from './PickDishSheet'
import { cookIngredients, RecipeSteps } from './AiRecipeSheet'
import { dishPhotoUrl } from '../db/photos'
import { generateDishRecipe } from '../sync/ai'
import { addDays, dayName, dayOfMonth, toISODate } from '../engine/dates'
import { stretchSuggestion } from '../engine/stretch'
import type { StretchSuggestion } from '../engine/stretch'
import { spreadEvenly } from '../engine/planner'
import type { Notice as PlanNotice } from '../engine/planner'
import { buildWeekUnits, planLeftoverCookSwap, planLeftoverSwap, planWeekSwap } from '../engine/weekSwap'
import type { WeekUnit } from '../engine/weekSwap'
import {
  currentWeekStart,
  deleteSession,
  ensureWeekPlan,
  markCooked,
  runPlanningWizard,
  setCoversDays,
  setDayRole,
  swapLeftoverDay,
  swapWeekBlock,
} from '../services/week'
import type { Component, CookDayChoice, CookSession, DaySlot, Dish, PlanningParams, WeekPlan } from '../types'

/** How long the settle/snap-back transition on a drag takes. */
const DRAG_SETTLE_MS = 200

interface DragInfo {
  fromDate: string
  /** True when a lone leftover day (not its cook day) was grabbed. */
  isLeftoverOnly: boolean
  /** Every date visually lifted together — just [fromDate] for a lone leftover. */
  blockDates: string[]
  pointerId: number
  startY: number
  /** window.scrollY when the drag began — the transform has to compensate
   *  for any page scroll since then (see applyDragVisual), not just the
   *  pointer's own movement, or auto-scroll makes the card drift away from
   *  the finger the instant the page starts moving underneath it. */
  startScrollY: number
}

interface DragVisual {
  blockDates: string[]
  offsetY: number
  targetDates: string[]
  phase: 'active' | 'settle' | 'snap'
}

/** Progress-ring fill for a "count out of target" stat — never over 100%. */
function ringPct(value: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, Math.round((value / target) * 100))
}

export function WeekScreen({
  householdId,
  onGoToRoulette,
  weekOffset,
  onWeekOffsetChange,
}: {
  householdId: string
  /** `date`: the empty day the spin is for, so the roulette can fill it directly. */
  onGoToRoulette: (date?: string) => void
  /** 0 = the real current week, 1 = next week, -1 = last week, etc. — lifted
   *  to the app shell so the topbar's centered date can show this same
   *  changing week instead of always the real current week. */
  weekOffset: number
  onWeekOffsetChange: (offset: number) => void
}) {
  const { settings, toast } = useApp()
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [notices, setNotices] = useState<PlanNotice[]>([])
  // Stores only the id, not a snapshot of the session — CookSession objects
  // change (is_cooked, is_locked, note…) while the sheet is open, and a
  // captured copy would keep showing stale state until the sheet is closed
  // and reopened. Deriving the live row from sessionById on every render
  // keeps the open sheet in sync with whatever the day list just did.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [chooserDate, setChooserDate] = useState<string | null>(null)
  const [pickingDate, setPickingDate] = useState<string | null>(null)
  // What opened the dish list, so its back button returns there: the
  // "spin or pick" chooser for an empty day, or the cooking sheet whose
  // "pick a different dish" led here.
  const [pickingFrom, setPickingFrom] = useState<'chooser' | { sessionId: string } | null>(null)

  const realWeekStart = currentWeekStart(settings)
  const weekStart = addDays(realWeekStart, weekOffset * 7)
  /** Last week, this week, next week — named, not dated. */
  const weekOptions = useMemo(() => [-1, 0, 1], [])

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
  const editing = editingId ? (sessionById.get(editingId) ?? null) : null

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
        imageUrl: dishPhotoUrl(dish, settings),
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

  // FR-9.3 — dishes that keep longer than they're planned for, next to an
  // empty day: "cook a bigger batch and cover tomorrow too". A dismissed
  // offer stays dismissed for this visit to the screen.
  const [dismissedStretch, setDismissedStretch] = useState<Set<string>>(() => new Set())
  const stretches = useMemo(
    () =>
      sortedSessions
        .filter((s) => !dismissedStretch.has(s.id))
        .map((s) => stretchSuggestion(s, s.dish_id ? dishById.get(s.dish_id) : undefined, sortedDays))
        .filter((s): s is StretchSuggestion => !!s),
    [sortedSessions, sortedDays, dishById, dismissedStretch],
  )

  const covered = sortedDays.filter((d) => d.role === 'cook' || d.role === 'leftovers').length
  const totalMinutes = sortedSessions.reduce((sum, s) => sum + s.estimated_minutes, 0)
  const today = toISODate(new Date())

  // ---- Drag-and-drop reordering (engine/weekSwap.ts has the actual logic) ----
  const sessionsLike = useMemo(
    () => sortedSessions.map((s) => ({ id: s.id, is_locked: s.is_locked })),
    [sortedSessions],
  )
  const weekUnits: WeekUnit[] = useMemo(
    () => buildWeekUnits(sortedDays, sessionsLike),
    [sortedDays, sessionsLike],
  )
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const dragInfo = useRef<DragInfo | null>(null)
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null)
  /** Last known pointer Y, kept live so the auto-scroll loop can recompute
   *  the drag visuals every frame even between actual pointermove events —
   *  the page scrolling under a finger that isn't moving is exactly the
   *  case where no new pointermove fires on its own. */
  const lastClientY = useRef(0)
  const autoScrollRaf = useRef<number | null>(null)

  /**
   * Which card is under the pointer right now. `exclude` must be the
   * dragged block's own dates — those cards are visually translated toward
   * the pointer while dragging, so without excluding them they can end up
   * geometrically overlapping (and matching ahead of) whatever real,
   * unmoving card is actually underneath.
   */
  const hoveredDateAt = (clientY: number, exclude: readonly string[]): string | null => {
    for (const [date, el] of cardRefs.current) {
      if (exclude.includes(date)) continue
      const r = el.getBoundingClientRect()
      if (clientY >= r.top && clientY <= r.bottom) return date
    }
    return null
  }

  /** Null target = invalid drop (matches planWeekSwap/planLeftoverSwap's own null-for-invalid). */
  const targetDatesFor = (info: DragInfo, hovered: string | null): string[] | null => {
    if (!hovered || hovered === info.fromDate || info.blockDates.includes(hovered)) return null
    if (info.isLeftoverOnly) {
      if (planLeftoverSwap(sortedDays, info.fromDate, hovered)) return [hovered]
      return planLeftoverCookSwap(sortedDays, sessionsLike, info.fromDate, hovered) ? [hovered] : null
    }
    const moves = planWeekSwap(weekUnits, info.fromDate, hovered)
    if (!moves) return null
    const unit = weekUnits.find((u) => (u.kind === 'session' ? u.dates.includes(hovered) : u.date === hovered))
    return unit ? (unit.kind === 'session' ? unit.dates : [unit.date]) : [hovered]
  }

  /** Shared by onGripMove and the auto-scroll loop — both need to re-derive
   *  the same visuals (offset, hovered target) from "wherever the pointer
   *  and the page scroll currently are". */
  const applyDragVisual = (info: DragInfo, clientY: number) => {
    // The card's transform has to compensate for page scroll too, not just
    // pointer movement, or it visually drifts away from the pointer the
    // instant auto-scroll starts moving the page underneath it.
    const offsetY = clientY - info.startY + (window.scrollY - info.startScrollY)
    const hovered = hoveredDateAt(clientY, info.blockDates)
    const targetDates = targetDatesFor(info, hovered) ?? []
    setDragVisual({ blockDates: info.blockDates, offsetY, targetDates, phase: 'active' })
  }

  const AUTO_SCROLL_ZONE = 70
  const AUTO_SCROLL_MAX_SPEED = 16

  const stopAutoScroll = () => {
    if (autoScrollRaf.current != null) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = null
    }
  }

  useEffect(() => stopAutoScroll, [])

  /** Runs every frame while the pointer sits in the top/bottom edge zone,
   *  so holding a dragged card near the edge keeps scrolling even though
   *  the finger itself isn't moving. */
  const autoScrollTick = () => {
    const info = dragInfo.current
    if (!info) {
      autoScrollRaf.current = null
      return
    }
    const y = lastClientY.current
    const vh = window.innerHeight
    let speed = 0
    if (y < AUTO_SCROLL_ZONE) {
      speed = -AUTO_SCROLL_MAX_SPEED * (1 - y / AUTO_SCROLL_ZONE)
    } else if (y > vh - AUTO_SCROLL_ZONE) {
      speed = AUTO_SCROLL_MAX_SPEED * (1 - (vh - y) / AUTO_SCROLL_ZONE)
    }
    if (speed !== 0) {
      window.scrollBy(0, speed)
      applyDragVisual(info, y)
    }
    autoScrollRaf.current = requestAnimationFrame(autoScrollTick)
  }

  const onGripDown = (e: ReactPointerEvent<HTMLSpanElement>, day: DaySlot) => {
    e.stopPropagation()
    const isLeftoverOnly = day.role === 'leftovers'
    const blockDates = isLeftoverOnly
      ? [day.date]
      : sortedDays.filter((d) => d.cook_session_id === day.cook_session_id).map((d) => d.date)
    dragInfo.current = {
      fromDate: day.date,
      isLeftoverOnly,
      blockDates,
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollY: window.scrollY,
    }
    lastClientY.current = e.clientY
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nice-to-have; its failure shouldn't sink the drag.
    }
    setDragVisual({ blockDates, offsetY: 0, targetDates: [], phase: 'active' })
    autoScrollRaf.current = requestAnimationFrame(autoScrollTick)
  }

  const onGripMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const info = dragInfo.current
    if (!info) return
    e.preventDefault()
    lastClientY.current = e.clientY
    applyDragVisual(info, e.clientY)
  }

  const onGripUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const info = dragInfo.current
    dragInfo.current = null
    stopAutoScroll()
    if (!info || !plan) {
      setDragVisual(null)
      return
    }
    const hovered = hoveredDateAt(e.clientY, info.blockDates)
    const targetDates = targetDatesFor(info, hovered)

    if (!targetDates || !hovered) {
      // Invalid or outside the list — spring back to the original spot, no data change.
      setDragVisual((v) => (v ? { ...v, offsetY: 0, targetDates: [], phase: 'snap' } : null))
      window.setTimeout(() => setDragVisual(null), DRAG_SETTLE_MS)
      return
    }

    const planId = plan.id
    const { fromDate, isLeftoverOnly } = info
    setDragVisual({ blockDates: info.blockDates, offsetY: 0, targetDates: [], phase: 'settle' })
    window.setTimeout(() => {
      void (isLeftoverOnly
        ? swapLeftoverDay(planId, fromDate, hovered)
        : swapWeekBlock(planId, fromDate, hovered)
      ).then(() => setDragVisual(null))
    }, DRAG_SETTLE_MS)
  }

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
      {/* Centered, not pinned to a side — with just three short options this
          reads as one balanced control regardless of how wide the screen is,
          instead of looking stranded against one edge. flex-wrap is a safety
          net for the narrowest phones, not the expected case. The date for
          the selected week itself now lives centered in the topbar above,
          not duplicated here. */}
      <div
        className="chips"
        style={{ marginBottom: 10, justifyContent: 'center', flexWrap: 'wrap', overflow: 'visible' }}
      >
        {weekOptions.map((offset) => (
          <button
            key={offset}
            className="chip"
            aria-pressed={offset === weekOffset}
            onClick={() => onWeekOffsetChange(offset)}
          >
            {offset === 0 ? 'השבוע' : offset < 0 ? 'שבוע שעבר' : 'שבוע הבא'}
          </button>
        ))}
      </div>

      {/* FR-9.5 — the first two stats have a natural "out of": sessions against
          the week's own cook-day target, covered days against the 7 in a
          week. Kitchen time doesn't (there's no target to be "out of"), so
          it stays a plain number. Collapsed by default behind a compact
          one-line summary — the ring cards are a lot of colour and shadow to
          put above the actual plan every single time. */}
      {statsOpen ? (
      <button
        type="button"
        className="summary"
        style={{ width: '100%', textAlign: 'inherit' }}
        aria-label="הסתרת פרטי השבוע"
        onClick={() => setStatsOpen(false)}
      >
        <div className="summary__cell">
          <div
            className="summary__ring"
            style={{ '--pct': `${ringPct(sortedSessions.length, plan.planning_params.cook_days_count)}%` } as CSSProperties}
          >
            <span className="summary__num">{sortedSessions.length}</span>
          </div>
          <div className="summary__lbl">בישולים</div>
        </div>
        <div className="summary__cell">
          <div className="summary__ring" style={{ '--pct': `${ringPct(covered, 7)}%` } as CSSProperties}>
            <span className="summary__num">{covered}</span>
          </div>
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
      </button>
      ) : (
        <button
          type="button"
          className="row row--between"
          style={{
            marginBottom: 14,
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
          onClick={() => setStatsOpen(true)}
        >
          <span className="label">
            {sortedSessions.length} בישולים · {covered} ימים מכוסים ·{' '}
            {totalMinutes >= 60 ? `${Math.round((totalMinutes / 60) * 10) / 10} ש׳` : `${totalMinutes} דק׳`} מטבח
          </span>
          <span className="label">פרטים ⌄</span>
        </button>
      )}

      {notices.map((n) => (
        <Notice
          key={n.code}
          warn={n.code !== 'cooldown_relaxed' && n.code !== 'cycle_restarted'}
          onDismiss={() => setNotices((prev) => prev.filter((x) => x.code !== n.code))}
        >
          {n.message}
        </Notice>
      ))}

      {stretches.map(({ session, date, coversDays }) => (
        <Notice
          key={session.id}
          onDismiss={() => setDismissedStretch((prev) => new Set(prev).add(session.id))}
        >
          {dishById.get(session.dish_id!)?.name} מספיקה ליותר מיום אחד. אפשר להכין כמות גדולה יותר ב
          {dayName(session.cook_date)} ולכסות גם את {dayName(date)}.{' '}
          <button
            type="button"
            className="btn btn--sm btn--primary"
            style={{ marginTop: 6 }}
            onClick={() => {
              void setCoversDays(session, coversDays, settings)
              toast(`${dayName(date)} מכוסה בשאריות, ורשימת הקניות עודכנה`)
            }}
          >
            להכין יותר 🍲
          </button>
        </Notice>
      ))}

      {libraryEmpty ? (
        <Notice warn>
          המאגר ריק, אז אי אפשר לתכנן עדיין. הוסף מנה במסך המאגר — שם וזמן הכנה מספיקים.
        </Notice>
      ) : (
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => setWizardOpen(true)}
          >
            תכנן לי את השבוע
          </button>
        </div>
      )}

      {/* "What are we cooking today" — today's meal lifted out of the list into
          its own card, so it's the first thing on the screen. Only on the
          current week; tapping it does what tapping today's row does. */}
      {weekOffset === 0 &&
        (() => {
          const day = sortedDays.find((d) => d.date === today)
          if (!day) return null
          const session = day.cook_session_id ? sessionById.get(day.cook_session_id) : undefined
          const pic = pictureFor(session)
          const open = () => {
            if (session) setEditingId(session.id)
            else if (day.role !== 'none') setChooserDate(day.date)
          }
          return (
            <button type="button" className="today" onClick={open}>
              <div className="today__body">
                <span className="today__badge">מה מבשלים היום</span>
                {session ? (
                  <>
                    <span className="today__title">{describe(session)}</span>
                    <span className="today__meta">
                      {day.role === 'leftovers'
                        ? 'שאריות, בלי בישול היום'
                        : `${session.estimated_minutes} דק׳` +
                          (session.covers_days > 1 ? ` · ל־${session.covers_days} ימים` : '')}
                      {session.is_cooked && ' · בושל ✓'}
                    </span>
                  </>
                ) : day.role === 'none' ? (
                  <span className="today__title">היום לא מבשלים</span>
                ) : (
                  <>
                    <span className="today__title">עוד לא נבחרה מנה</span>
                    <span className="today__meta">הקש כדי לבחור מה לבשל</span>
                  </>
                )}
              </div>
              {pic && (
                <DishPicture
                  className="today__shot"
                  name={pic.name}
                  ingredients={pic.ingredients}
                  imageUrl={pic.imageUrl}
                />
              )}
            </button>
          )
        })()}

      <div>
          {sortedDays.map((day) => {
            const session = day.cook_session_id ? sessionById.get(day.cook_session_id) : undefined

            // "Not cooking" is deliberately a bare row with no card, so it can never
            // be confused with a leftovers day at a glance or in greyscale.
            if (day.role === 'none') {
              return (
                <button
                  key={day.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(day.date, el)
                    else cardRefs.current.delete(day.date)
                  }}
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

            // A locked session never accepts (or offers) a drag — dropping
            // on it is always rejected anyway, so there's no point showing
            // a handle that would only ever spring back.
            const canDrag = (day.role === 'cook' || day.role === 'leftovers') && !session?.is_locked
            const isDragMember = dragVisual?.blockDates.includes(day.date) ?? false
            const isDropTarget = dragVisual?.targetDates.includes(day.date) ?? false
            if (isDropTarget) classes.push('day--drop-target')
            if (isDragMember) classes.push(`day--drag-${dragVisual!.phase}`)
            const dragStyle: CSSProperties | undefined = isDragMember
              ? {
                  transform: `translateY(${dragVisual!.offsetY}px)`,
                  transition:
                    dragVisual!.phase === 'active' ? 'none' : `transform ${DRAG_SETTLE_MS}ms var(--ease-em)`,
                }
              : undefined

            return (
              <button
                key={day.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(day.date, el)
                  else cardRefs.current.delete(day.date)
                }}
                className={classes.join(' ')}
                style={dragStyle}
                onClick={() => {
                  if (session) setEditingId(session.id)
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
                      {/* Trimmed to the essentials — the tonal card colour and the
                          "cook" vs "leftovers" position already say what kind of
                          day this is, so the meta line doesn't need to repeat it
                          in words too. */}
                      <div className="day__meta">
                        <span>{session?.estimated_minutes} דק׳</span>
                        {session && session.covers_days > 1 && (
                          <>
                            <span>·</span>
                            <span>ל־{session.covers_days} ימים</span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {/* Leftovers keep just the dish name as the title (no "שאריות
                      מ" prefix eating into the width) — the "שאריות" tag below
                      it carries that distinction instead. */}
                  {day.role === 'leftovers' && (
                    <>
                      <div className="day__title">{describe(session)}</div>
                      <div className="day__meta">
                        <span className="row" style={{ gap: 3 }}>
                          <Icon name="refresh" size={13} />
                          שאריות
                        </span>
                      </div>
                    </>
                  )}
                  {day.role === 'empty' && <div className="day__title">אין תוכנית — הקש לשיבוץ</div>}
                </div>
                {session?.is_locked && (
                  <span className="day__badge">
                    <Icon name="lock" size={15} />
                  </span>
                )}
                {/* Tappable right from the day row, cook or leftover — no
                    need to open the sheet just to mark the meal done. */}
                {session && (day.role === 'cook' || day.role === 'leftovers') && (
                  <span
                    className="day__badge day__badge--check"
                    role="button"
                    aria-pressed={session.is_cooked}
                    aria-label={session.is_cooked ? 'ביטול סימון בושל' : 'סימון כבושל'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void markCooked(householdId, session, !session.is_cooked)
                    }}
                  >
                    <Icon name="check" size={15} strokeWidth={2.6} />
                  </span>
                )}
                {/* The handle, not the whole card, owns the drag gesture — the
                    card itself stays a normal tap target, and the page around
                    it keeps scrolling normally on touch instead of fighting a
                    gesture that covers the entire row. */}
                {canDrag && (
                  <span
                    className="day__grip"
                    role="button"
                    aria-label={
                      day.role === 'leftovers' ? 'גרירת יום השאריות הזה בלבד' : 'גרירת הבישול ליום אחר'
                    }
                    onPointerDown={(e) => onGripDown(e, day)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripUp}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="grip" size={16} />
                  </span>
                )}
              </button>
            )
          })}

          <p className="field__hint" style={{ marginTop: 10 }}>
            הקשה על יום מכוסה פותחת את הבישול. כדי לסמן יום כ"לא מבשלים", פתח אותו ובחר באפשרות. הקשה
            על סימון ה-✓ מסמנת שבושל בלי לפתוח את הבישול.
          </p>
      </div>

      {wizardOpen && (
        <PlanningWizard
          initial={plan.planning_params}
          weekDays={sortedDays.map((d) => ({
            date: d.date,
            notCooking: d.role === 'none',
            locked: sortedSessions.some((s) => s.is_locked && s.cook_date === d.date),
          }))}
          onClose={() => setWizardOpen(false)}
          onRun={runWizard}
        />
      )}

      {editing && (
        <SessionSheet
          session={editing}
          title={describe(editing)}
          picture={pictureFor(editing)}
          dish={editing.dish_id ? dishById.get(editing.dish_id) : undefined}
          day={sortedDays.find((d) => d.date === editing.cook_date)}
          maxCoverDays={
            editing.dish_id ? (dishById.get(editing.dish_id)?.max_cover_days ?? 4) : 4
          }
          onClose={() => setEditingId(null)}
          householdId={householdId}
          onPickDifferent={(date) => {
            setPickingFrom({ sessionId: editing.id })
            setEditingId(null)
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
                onGoToRoulette(chooserDate)
              }}
            >
              <Icon name="wheel" size={16} />
              סובב רולטה
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                setPickingFrom('chooser')
                setPickingDate(chooserDate)
                setChooserDate(null)
              }}
            >
              <Icon name="list" size={16} />
              בחר מנה מהמאגר
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
          onClose={() => {
            setPickingDate(null)
            setPickingFrom(null)
          }}
          onBack={
            pickingFrom
              ? () => {
                  if (pickingFrom === 'chooser') setChooserDate(pickingDate)
                  else setEditingId(pickingFrom.sessionId)
                  setPickingDate(null)
                  setPickingFrom(null)
                }
              : undefined
          }
          onAssigned={(name) => toast(`${name} שובץ ל${dayName(pickingDate)}`)}
        />
      )}
    </div>
  )
}

/** FR-4.1 — the three-question wizard. */
const PREP_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'עד 20', value: 20 },
  { label: 'עד 40', value: 40 },
  { label: 'ללא הגבלה', value: null },
]

function PlanningWizard({
  initial,
  weekDays,
  onClose,
  onRun,
}: {
  initial: PlanningParams
  weekDays: { date: string; notCooking: boolean; locked: boolean }[]
  onClose: () => void
  onRun: (p: PlanningParams) => Promise<void>
}) {
  // A day marked "not cooking" or holding a locked session isn't the
  // wizard's to plan (EC-15, FR-4.3), so it can't be picked.
  const pickable = weekDays.filter((d) => !d.notCooking && !d.locked).map((d) => d.date)

  // Start from this week's last choice; a week never planned this way gets
  // the old count spread evenly, each with the old single time limit.
  const [chosen, setChosen] = useState<Map<string, number | null>>(() => {
    const previous = (initial.cook_days ?? []).filter((c) => pickable.includes(c.date))
    if (previous.length > 0) return new Map(previous.map((c) => [c.date, c.max_prep_time]))
    const spread = spreadEvenly(pickable, Math.min(initial.cook_days_count, pickable.length))
    return new Map(spread.map((date) => [date, initial.max_prep_time]))
  })
  const [leftovers, setLeftovers] = useState(initial.include_leftovers)
  const [busy, setBusy] = useState(false)

  // Quick mode: just how many times and how long — the planner spreads the days.
  // EC-15 — never offer more cook days than there are free days.
  const maxCookDays = weekDays.filter((d) => !d.notCooking).length
  const countOptions = [2, 3, 4, 5].filter((n) => n <= Math.max(2, maxCookDays))
  const [count, setCount] = useState(Math.min(initial.cook_days_count, Math.max(1, maxCookDays)))
  const [maxPrep, setMaxPrep] = useState<number | null>(initial.max_prep_time)

  const run = (params: PlanningParams) => {
    setBusy(true)
    void onRun(params).finally(() => setBusy(false))
  }

  const toggle = (date: string) =>
    setChosen((prev) => {
      const next = new Map(prev)
      if (next.has(date)) next.delete(date)
      else next.set(date, initial.max_prep_time)
      return next
    })
  const setPrep = (date: string, value: number | null) =>
    setChosen((prev) => new Map(prev).set(date, value))

  return (
    <Sheet title="תכנן לי את השבוע" onClose={onClose}>
      <div className="field">
        <div className="row row--between">
          <span className="label">לשלב שאריות?</span>
          <Switch checked={leftovers} onChange={setLeftovers} label="לשלב שאריות" />
        </div>
        <span className="field__hint">
          {leftovers
            ? 'כל בישול יכסה גם את הימים שאחריו, עד הבישול הבא.'
            : 'כל בישול מכסה יום אחד. ימים בלי בישול יישארו ריקים.'}
        </span>
      </div>

      <div className="field">
        <span className="label">כמה פעמים לבשל השבוע?</span>
        <div className="chips">
          {countOptions.map((n) => (
            <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        {maxCookDays < 5 && <span className="field__hint">יש {maxCookDays} ימים פנויים השבוע.</span>}
      </div>

      <div className="field">
        <span className="label">זמן הכנה מקסימלי</span>
        <div className="chips">
          {PREP_OPTIONS.map((o) => (
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
        onClick={() =>
          run({ cook_days_count: count, include_leftovers: leftovers, max_prep_time: maxPrep, cook_days: null })
        }
      >
        {busy ? 'מתכנן…' : 'תכנן'}
      </button>

      <div className="label" style={{ textAlign: 'center', margin: '18px 0 4px' }}>
        או לבחור ימים בעצמך
      </div>

      <div className="field">
        <span className="label">באילו ימים מבשלים, וכמה זמן יש?</span>
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          {weekDays.map((d) => {
            const on = chosen.has(d.date)
            const disabled = d.notCooking || d.locked
            return (
              <div
                key={d.date}
                className="card card--flat"
                style={{ padding: '8px 10px', opacity: disabled ? 0.55 : 1 }}
              >
                <div className="row row--between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => toggle(d.date)}
                  >
                    {dayName(d.date)} {dayOfMonth(d.date)}
                  </button>
                  {disabled ? (
                    <span className="field__hint">{d.locked ? 'בישול נעול' : 'לא מבשלים'}</span>
                  ) : on ? (
                    <div className="chips" style={{ margin: 0 }}>
                      {PREP_OPTIONS.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          className="chip"
                          aria-pressed={chosen.get(d.date) === o.value}
                          onClick={() => setPrep(d.date, o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <button
        className="btn btn--primary btn--block"
        disabled={busy || chosen.size === 0}
        onClick={() => {
          const cookDays: CookDayChoice[] = [...chosen]
            .map(([date, max_prep_time]) => ({ date, max_prep_time }))
            .sort((a, b) => a.date.localeCompare(b.date))
          run({
            cook_days_count: cookDays.length,
            include_leftovers: leftovers,
            max_prep_time: maxPrep,
            cook_days: cookDays,
          })
        }}
      >
        {busy ? 'מתכנן…' : chosen.size === 0 ? 'בחר לפחות יום אחד' : `תכנן ${chosen.size} בישולים`}
      </button>
    </Sheet>
  )
}

function SessionSheet({
  session,
  title,
  picture,
  dish,
  day,
  maxCoverDays,
  onClose,
  householdId,
  onPickDifferent,
}: {
  session: CookSession
  title: string
  picture: { name: string; ingredients: string[]; imageUrl: string | null } | null
  /** The library dish, for a dish session — undefined for a roulette combo. */
  dish: Dish | undefined
  day: DaySlot | undefined
  maxCoverDays: number
  onClose: () => void
  householdId: string
  onPickDifferent: (date: string) => void
}) {
  const { settings, toast } = useApp()
  const [note, setNote] = useState(session.note ?? '')
  const [recipeBusy, setRecipeBusy] = useState(false)

  /** Writes (or rewrites) the dish's recipe and saves it onto the library dish. */
  const onGenerateRecipe = async () => {
    if (!dish) return
    setRecipeBusy(true)
    try {
      const recipe = await generateDishRecipe(dish)
      if (!recipe) {
        toast('לא הצלחתי לכתוב מתכון. אפשר לנסות שוב.')
        return
      }
      // Re-read so an edit made on another screen meanwhile isn't overwritten.
      const current = await db.dishes.get(dish.id)
      if (current) await save('dishes', { ...current, recipe })
    } finally {
      setRecipeBusy(false)
    }
  }

  const recipeButton = dish && (
    <button
      type="button"
      className="btn btn--ghost btn--block"
      style={{ marginTop: 10 }}
      disabled={recipeBusy}
      onClick={() => void onGenerateRecipe()}
    >
      {recipeBusy ? 'כותב מתכון…' : dish.recipe ? 'מתכון חדש (AI) 🔄' : 'יצירת מתכון (AI) 📖'}
    </button>
  )

  return (
    <Sheet title={title || 'בישול'} onClose={onClose}>
      {/* The picture is the first thing shown — same treatment as the dish's
          own screen in the library, just here too instead of a name-only sheet. */}
      {picture && (
        <div style={{ marginBottom: 12 }}>
          <DishPicture
            className="dish-shot"
            name={picture.name}
            ingredients={picture.ingredients}
            imageUrl={picture.imageUrl}
          />
        </div>
      )}

      {/* On the day you cook, the recipe is what you open this for. */}
      {dish?.recipe && dish.recipe.steps.length > 0 ? (
        <div className="field">
          <span className="label">מצרכים · ל־{dish.base_servings} סועדים</span>
          <div className="card" style={{ margin: '6px 0 14px' }}>
            {dish.ingredients.map((ing, i) => (
              <div
                key={`${ing.name}-${i}`}
                className="row row--between"
                style={{ gap: 12, padding: '6px 0', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <span>{ing.name}</span>
                {ing.quantity != null && ing.unit && (
                  <span className="muted" style={{ textAlign: 'end' }}>
                    {ing.quantity} {ing.unit}
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="label" style={{ display: 'block', marginBottom: 8 }}>
            אופן ההכנה
          </span>
          {/* Amounts for this cook as planned: covering three days means
              cooking three days' worth. */}
          <RecipeSteps
            recipe={dish.recipe}
            cook={{ title: dish.name, ingredients: cookIngredients(dish, session.servings) }}
          />
          {recipeButton}
        </div>
      ) : dish ? (
        <div className="field">
          <span className="field__hint">אין עדיין מתכון למנה הזו.</span>
          {recipeButton}
        </div>
      ) : null}

      <div className="field">
        <span className="label">כמה ימים זה מכסה?</span>
        <CoverDaysChips
          value={session.covers_days}
          max={maxCoverDays}
          onChange={(n) => void setCoversDays(session, n, settings)}
          shortOne
        />
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
          בחר מנה אחרת מהמאגר
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
          {session.is_cooked ? 'ביטול סימון "בושל"' : 'סמן כבושל'}
        </button>
        {day && (
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              void setDayRole(day, day.role === 'none' ? 'empty' : 'none')
              onClose()
            }}
          >
            {day.role === 'none' ? 'החזרת היום לתכנון' : 'סמן "לא מבשלים" ביום הזה'}
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
