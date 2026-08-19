import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { save } from '../db/repo'
import { useApp } from '../state'
import { EmptyState, Notice, Sheet, Switch, TimeFilterChips } from '../components/ui'
import { Wheel, rotationFor } from '../components/Wheel'
import type { RingSpec } from '../components/Wheel'
import {
  DISH_WHEEL_CAPACITY,
  RING_CAPACITY,
  availableComponents,
  availableDishes,
  comboLabel,
  comboMinutes,
  draw,
} from '../engine/roulette'
import type { Drawable } from '../engine/roulette'
import { makeRng, randomSeed } from '../engine/rng'
import type { Component, ComponentType, Dish } from '../types'
import { COMPONENT_LABEL } from '../types'
import { AssignSheet } from './AssignSheet'
import { QuickAddDish } from './QuickAddDish'

type Mode = 'dish' | 'combo'
const RING_ORDER: ComponentType[] = ['protein', 'carb', 'veg']
const SPIN_MS = 3400

interface Slot {
  slices: Drawable[]
  winner: Drawable | null
  rotation: number
  locked: boolean
}

const emptySlot = (): Slot => ({ slices: [], winner: null, rotation: 0, locked: false })

export function RouletteScreen({ householdId }: { householdId: string }) {
  const { settings, updateSettings, toast } = useApp()
  const [mode, setMode] = useState<Mode>('dish')
  const [spinning, setSpinning] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const spinTimer = useRef<number | null>(null)

  const [dishSlot, setDishSlot] = useState<Slot>(emptySlot)
  const [rings, setRings] = useState<Record<ComponentType, Slot>>({
    protein: emptySlot(),
    carb: emptySlot(),
    veg: emptySlot(),
  })

  const maxPrepTime = settings.max_prep_time_filter

  const dishes = useLiveQuery(
    () => db.dishes.where('household_id').equals(householdId).toArray(),
    [householdId],
    [] as Dish[],
  )
  const components = useLiveQuery(
    () => db.components.where('household_id').equals(householdId).toArray(),
    [householdId],
    [] as Component[],
  )

  const dishPool = useMemo(() => availableDishes(dishes ?? [], maxPrepTime), [dishes, maxPrepTime])
  const pools = useMemo(
    () => ({
      protein: availableComponents(components ?? [], 'protein', maxPrepTime),
      carb: availableComponents(components ?? [], 'carb', maxPrepTime),
      veg: availableComponents(components ?? [], 'veg', maxPrepTime),
    }),
    [components, maxPrepTime],
  )

  // FR-3.8 — with no veg components at all the ring disappears and the toggle
  // is disabled, but combo mode itself stays usable.
  const hasVeg = pools.veg.length > 0
  const vegOn = settings.veg_enabled && hasVeg
  const activeRings = useMemo(
    () => (vegOn ? RING_ORDER : (['protein', 'carb'] as ComponentType[])),
    [vegOn],
  )

  // EC-13 — leaving the screen mid-animation stops it and saves nothing.
  useEffect(
    () => () => {
      if (spinTimer.current) window.clearTimeout(spinTimer.current)
    },
    [],
  )

  const finishSpin = useCallback(() => {
    if (spinTimer.current) window.clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => {
      setSpinning(false)
      spinTimer.current = null
    }, SPIN_MS)
  }, [])

  const spinDish = useCallback(() => {
    if (spinning || dishPool.length < 2) return
    const rng = makeRng(randomSeed())
    const result = draw(dishPool, DISH_WHEEL_CAPACITY, rng)
    if (!result) return
    const index = result.slices.findIndex((s) => s.id === result.winner.id)
    setSpinning(true)
    setDishSlot((prev) => ({
      slices: result.slices,
      winner: result.winner,
      locked: false,
      // Keep accumulating turns so the wheel always spins forward.
      rotation:
        Math.ceil(prev.rotation / 360) * 360 +
        rotationFor(result.slices.length, index, 4) +
        1440,
    }))
    finishSpin()
  }, [spinning, dishPool, finishSpin])

  const spinRings = useCallback(
    (only?: ComponentType) => {
      if (spinning) return
      const targets = (only ? [only] : activeRings).filter((t) => !rings[t].locked)
      if (targets.length === 0) return
      if (targets.some((t) => pools[t].length === 0)) return

      const rng = makeRng(randomSeed())
      const next = { ...rings }
      for (const type of targets) {
        const result = draw(pools[type], RING_CAPACITY[type], rng)
        if (!result) continue
        const index = result.slices.findIndex((s) => s.id === result.winner.id)
        const prev = rings[type]
        next[type] = {
          slices: result.slices,
          winner: result.winner,
          locked: prev.locked,
          rotation:
            Math.ceil(prev.rotation / 360) * 360 +
            rotationFor(result.slices.length, index, 4) +
            1440,
        }
      }
      setSpinning(true)
      setRings(next)
      finishSpin()
    },
    [spinning, activeRings, rings, pools, finishSpin],
  )

  const toggleLock = (type: ComponentType) => {
    setRings((r) => ({ ...r, [type]: { ...r[type], locked: !r[type].locked } }))
  }

  /** FR-2.4 — exclude, then immediately spin again, with an undo. */
  const excludeCurrentDish = async () => {
    const winner = dishSlot.winner
    if (!winner) return
    const dish = (dishes ?? []).find((d) => d.id === winner.id)
    if (!dish) return
    await save('dishes', { ...dish, is_excluded: true })
    toast(`"${dish.name}" לא תוצע יותר`, {
      label: 'בטלי',
      onAction: () => void save('dishes', { ...dish, is_excluded: false }),
    })
    setDishSlot(emptySlot())
    window.setTimeout(() => spinDish(), 60)
  }

  const excludeComponent = async (type: ComponentType) => {
    const winner = rings[type].winner
    if (!winner) return
    const comp = (components ?? []).find((c) => c.id === winner.id)
    if (!comp) return
    await save('components', { ...comp, is_excluded: true })
    toast(`"${comp.name}" לא יוצע יותר`, {
      label: 'בטלי',
      onAction: () => void save('components', { ...comp, is_excluded: false }),
    })
    setRings((r) => ({ ...r, [type]: { ...r[type], winner: null } }))
    window.setTimeout(() => spinRings(type), 60)
  }

  const allLocked = activeRings.every((t) => rings[t].locked)
  const comboReady = activeRings.every((t) => rings[t].winner) && !spinning
  const comboParts = activeRings.map((t) => rings[t].winner)

  const ringSpecs: RingSpec[] = activeRings.map((type) => ({
    type,
    slices: rings[type].slices.length
      ? rings[type].slices
      : pools[type].slice(0, RING_CAPACITY[type]),
    winnerIndex: rings[type].winner
      ? rings[type].slices.findIndex((s) => s.id === rings[type].winner!.id)
      : null,
    locked: rings[type].locked,
  }))

  const dishRing: RingSpec = {
    type: 'protein',
    slices: dishSlot.slices.length ? dishSlot.slices : dishPool.slice(0, DISH_WHEEL_CAPACITY),
    winnerIndex: dishSlot.winner
      ? dishSlot.slices.findIndex((s) => s.id === dishSlot.winner!.id)
      : null,
    locked: false,
  }

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 12 }} role="group" aria-label="מצב רולטה">
        <button
          className="segmented__btn"
          aria-pressed={mode === 'dish'}
          onClick={() => setMode('dish')}
        >
          מנה מלאה
        </button>
        <button
          className="segmented__btn"
          aria-pressed={mode === 'combo'}
          onClick={() => setMode('combo')}
        >
          הרכבה
        </button>
      </div>

      <TimeFilterChips
        value={maxPrepTime}
        onChange={(v) => void updateSettings({ max_prep_time_filter: v })}
      />

      {mode === 'dish' ? (
        <DishMode
          pool={dishPool}
          ring={dishRing}
          rotation={dishSlot.rotation}
          winner={dishSlot.winner}
          spinning={spinning}
          hasFilter={maxPrepTime !== null}
          onSpin={spinDish}
          onAssign={() => setAssigning(true)}
          onExclude={excludeCurrentDish}
          onClearFilter={() => void updateSettings({ max_prep_time_filter: null })}
          onAddDish={() => setQuickAdd(true)}
        />
      ) : (
        <ComboMode
          rings={ringSpecs}
          slots={rings}
          activeRings={activeRings}
          rotations={activeRings.map((t) => rings[t].rotation)}
          pools={pools}
          hasVeg={hasVeg}
          vegOn={vegOn}
          spinning={spinning}
          allLocked={allLocked}
          comboReady={comboReady}
          parts={comboParts}
          hasFilter={maxPrepTime !== null}
          onToggleVeg={(v) => void updateSettings({ veg_enabled: v })}
          onSpinAll={() => spinRings()}
          onSpinRing={(t) => spinRings(t)}
          onToggleLock={toggleLock}
          onExcludeRing={excludeComponent}
          onAssign={() => setAssigning(true)}
          onClearFilter={() => void updateSettings({ max_prep_time_filter: null })}
        />
      )}

      {assigning && (
        <AssignSheet
          householdId={householdId}
          draft={
            mode === 'dish'
              ? { source_type: 'dish', dish_id: dishSlot.winner!.id, minutes: dishSlot.winner!.prep_time_minutes }
              : {
                  source_type: 'combo',
                  protein_id: rings.protein.winner?.id ?? null,
                  carb_id: rings.carb.winner?.id ?? null,
                  veg_id: vegOn ? (rings.veg.winner?.id ?? null) : null,
                  minutes: comboMinutes(comboParts),
                }
          }
          title={
            mode === 'dish' ? (dishSlot.winner?.name ?? '') : comboLabel(comboParts)
          }
          onClose={() => setAssigning(false)}
        />
      )}

      {quickAdd && (
        <Sheet title="הוספת מנה מהירה" onClose={() => setQuickAdd(false)}>
          <QuickAddDish householdId={householdId} onDone={() => setQuickAdd(false)} />
        </Sheet>
      )}
    </div>
  )
}

function DishMode({
  pool,
  ring,
  rotation,
  winner,
  spinning,
  hasFilter,
  onSpin,
  onAssign,
  onExclude,
  onClearFilter,
  onAddDish,
}: {
  pool: Dish[]
  ring: RingSpec
  rotation: number
  winner: Drawable | null
  spinning: boolean
  hasFilter: boolean
  onSpin: () => void
  onAssign: () => void
  onExclude: () => void
  onClearFilter: () => void
  onAddDish: () => void
}) {
  // EC-2 / EC-4 — too few dishes, or a filter that empties the wheel.
  if (pool.length < 2) {
    return (
      <EmptyState
        icon="🍲"
        title={hasFilter ? 'הסינון לא השאיר מספיק מנות' : 'צריך לפחות 2 מנות כדי להגריל'}
        body={
          hasFilter
            ? 'אפשר לנקות את הסינון, או להוסיף מנה שמתאימה לזמן שבחרת.'
            : 'הוסיפי מנה — שם וזמן הכנה מספיקים, כל השאר אפשר להשלים אחר כך.'
        }
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            {hasFilter && (
              <button className="btn btn--ghost" onClick={onClearFilter}>
                נקי סינון
              </button>
            )}
            <button className="btn btn--primary" onClick={onAddDish}>
              הוספת מנה
            </button>
          </div>
        }
      />
    )
  }

  return (
    <div>
      <Wheel
        rings={[ring]}
        rotations={[rotation]}
        hubLabel="סובבי"
        onHubClick={onSpin}
        hubDisabled={false}
        spinning={spinning}
        ariaLabel="גלגל מנות מלאות"
      />

      <div className="result" aria-live="polite">
        {winner && !spinning ? (
          <>
            <div className="display">{winner.name}</div>
            <div className="label" style={{ textAlign: 'center' }}>
              {winner.prep_time_minutes} דק׳ הכנה
            </div>
          </>
        ) : (
          <div className="muted" style={{ textAlign: 'center', paddingTop: 14 }}>
            {spinning ? 'מסובבת…' : `${pool.length} מנות בגלגל`}
          </div>
        )}
      </div>

      {/* FR-2.3 — the four actions after the wheel stops. */}
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="row">
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={!winner || spinning}
            onClick={onAssign}
          >
            שבצי ליום…
          </button>
          <button className="btn btn--ghost" style={{ flex: 1 }} disabled={spinning} onClick={onSpin}>
            {winner ? 'עוד פעם' : 'סובבי'}
          </button>
        </div>
        {winner && !spinning && (
          <button className="btn btn--danger btn--sm btn--block" onClick={onExclude}>
            לא להציע לי את זה
          </button>
        )}
      </div>
    </div>
  )
}

function ComboMode({
  rings,
  slots,
  activeRings,
  rotations,
  pools,
  hasVeg,
  vegOn,
  spinning,
  allLocked,
  comboReady,
  parts,
  hasFilter,
  onToggleVeg,
  onSpinAll,
  onSpinRing,
  onToggleLock,
  onExcludeRing,
  onAssign,
  onClearFilter,
}: {
  rings: RingSpec[]
  slots: Record<ComponentType, Slot>
  activeRings: ComponentType[]
  rotations: number[]
  pools: Record<ComponentType, Component[]>
  hasVeg: boolean
  vegOn: boolean
  spinning: boolean
  allLocked: boolean
  comboReady: boolean
  parts: (Drawable | null)[]
  hasFilter: boolean
  onToggleVeg: (v: boolean) => void
  onSpinAll: () => void
  onSpinRing: (t: ComponentType) => void
  onToggleLock: (t: ComponentType) => void
  onExcludeRing: (t: ComponentType) => void
  onAssign: () => void
  onClearFilter: () => void
}) {
  const missing = activeRings.filter((t) => pools[t].length === 0)
  if (missing.length > 0) {
    return (
      <EmptyState
        icon="🧩"
        title={`חסרים רכיבי ${missing.map((m) => COMPONENT_LABEL[m]).join(' ו')}`}
        body={
          hasFilter
            ? 'ייתכן שהסינון מסתיר אותם. אפשר לנקות סינון, או להוסיף רכיבים במסך המאגר.'
            : 'כדי להרכיב ארוחה צריך לפחות רכיב אחד מכל סוג. אפשר להוסיף במסך המאגר.'
        }
        action={
          hasFilter ? (
            <button className="btn btn--ghost" onClick={onClearFilter}>
              נקי סינון
            </button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div>
      {/* FR-3.3 — the "with veg" toggle sits above the wheel. */}
      <div className="row" style={{ justifyContent: 'center', marginBottom: 6, gap: 8 }}>
        <span className="label">עם ירק</span>
        <Switch
          checked={vegOn}
          onChange={onToggleVeg}
          label="לכלול ירק בהרכבה"
          disabled={!hasVeg}
        />
      </div>
      {!hasVeg && (
        <p className="field__hint" style={{ textAlign: 'center', marginBottom: 8 }}>
          אין רכיבי ירק פעילים במאגר, אז הטבעת השלישית מוסתרת.
        </p>
      )}

      <Wheel
        rings={rings}
        rotations={rotations}
        hubLabel={allLocked ? 'נעול' : 'סובבי'}
        onHubClick={onSpinAll}
        hubDisabled={allLocked}
        spinning={spinning}
        ariaLabel={`גלגל הרכבה: ${activeRings.map((t) => COMPONENT_LABEL[t]).join(', ')}`}
      />

      {/* FR-3.4 / FR-3.5 — lock or spin each ring on its own. */}
      <div className="chips" style={{ justifyContent: 'center', marginTop: 8 }}>
        {activeRings.map((type) => (
          <span key={type} className="row" style={{ gap: 3 }}>
            <button
              type="button"
              className="chip"
              aria-pressed={slots[type].locked}
              onClick={() => onToggleLock(type)}
              style={{ color: slots[type].locked ? `var(--${dotVar(type)})` : undefined }}
            >
              {slots[type].locked ? '🔒' : '🔓'} {COMPONENT_LABEL[type]}
            </button>
            <button
              type="button"
              className="chip"
              aria-label={`סובבי ${COMPONENT_LABEL[type]} בלבד`}
              disabled={spinning || slots[type].locked}
              onClick={() => onSpinRing(type)}
            >
              ↻
            </button>
          </span>
        ))}
      </div>

      <div className="result" aria-live="polite">
        {comboReady ? (
          <>
            <div className="display">{comboLabel(parts)}</div>
            <div className="label" style={{ textAlign: 'center' }}>
              {comboMinutes(parts)} דק׳ · הזמן הארוך מבין הרכיבים
            </div>
          </>
        ) : (
          <div className="muted" style={{ textAlign: 'center', paddingTop: 14 }}>
            {spinning ? 'מסובבת…' : 'סובבי כדי להרכיב ארוחה'}
          </div>
        )}
      </div>

      {allLocked && <Notice warn>כל הרכיבים נעולים. פתחי נעילה כדי לסובב.</Notice>}

      <div className="stack" style={{ marginTop: 10 }}>
        <div className="row">
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={!comboReady}
            onClick={onAssign}
          >
            שבצי ליום…
          </button>
          <button
            className="btn btn--ghost"
            style={{ flex: 1 }}
            disabled={spinning || allLocked}
            onClick={onSpinAll}
          >
            סובבי הכל
          </button>
        </div>
        {comboReady && (
          <div className="row">
            {activeRings.map((type) => (
              <button
                key={type}
                className="btn btn--danger btn--sm"
                style={{ flex: 1 }}
                onClick={() => onExcludeRing(type)}
              >
                לא להציע {COMPONENT_LABEL[type]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function dotVar(type: ComponentType): string {
  return type === 'protein' ? 'beet' : type === 'carb' ? 'pist' : 'veg'
}
