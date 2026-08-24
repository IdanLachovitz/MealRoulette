import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, save } from '../db/repo'
import { useApp } from '../state'
import { EmptyState, Modal, Notice, Sheet, Switch, TimeFilterChips } from '../components/ui'
import { Icon } from '../components/Icon'
import { Wheel, rotationFor } from '../components/Wheel'
import { DishPicture } from '../components/DishArt'
import { generateDishImageWithAi } from '../sync/ai'
import type { RingSpec } from '../components/Wheel'
import {
  applyCooldown,
  availableComponents,
  availableDishes,
  comboLabel,
  comboMinutes,
  draw,
} from '../engine/roulette'
import type { Drawable } from '../engine/roulette'
import { makeRng, randomSeed } from '../engine/rng'
import { toISODate } from '../engine/dates'
import type { Component, ComponentType, CookHistory, Dish } from '../types'
import { COMPONENT_LABEL, COMPONENT_LABEL_PLURAL, isFiltered } from '../types'
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

export function RouletteScreen({
  householdId,
  onGoToLibrary,
}: {
  householdId: string
  onGoToLibrary?: () => void
}) {
  const { settings, updateSettings, toast } = useApp()
  const [mode, setMode] = useState<Mode>('dish')
  const [spinning, setSpinning] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  /** The dish result window, opened when the full-meal wheel stops. */
  const [showResult, setShowResult] = useState(false)
  const spinTimer = useRef<number | null>(null)

  const [dishSlot, setDishSlot] = useState<Slot>(emptySlot)
  const [rings, setRings] = useState<Record<ComponentType, Slot>>({
    protein: emptySlot(),
    carb: emptySlot(),
    veg: emptySlot(),
  })

  const timeFilter = useMemo(
    () => ({ max: settings.max_prep_time_filter, min: settings.min_prep_time_filter }),
    [settings.max_prep_time_filter, settings.min_prep_time_filter],
  )
  const hasFilter = isFiltered(timeFilter)
  const today = useMemo(() => toISODate(new Date()), [])

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
  const history = useLiveQuery(
    async () => alive(await db.cookHistory.where('household_id').equals(householdId).toArray()),
    [householdId],
    [] as CookHistory[],
  )

  const dishPool = useMemo(() => availableDishes(dishes ?? [], timeFilter), [dishes, timeFilter])

  // FR-5.2 — a component cooked inside `component_cooldown_days` stays off its
  // ring. FR-5.3's relaxation applies: if that empties a ring, it comes back.
  const ringPools = useMemo(() => {
    const cooldown = {
      history: history ?? [],
      today,
      days: settings.component_cooldown_days,
    }
    const build = (type: ComponentType) => {
      const all = availableComponents(components ?? [], type, timeFilter)
      const { pool, relaxed } = applyCooldown(all, cooldown)
      return { pool, relaxed, cooling: all.length - pool.length }
    }
    return { protein: build('protein'), carb: build('carb'), veg: build('veg') }
  }, [components, timeFilter, history, today, settings.component_cooldown_days])

  const pools = useMemo(
    () => ({
      protein: ringPools.protein.pool,
      carb: ringPools.carb.pool,
      veg: ringPools.veg.pool,
    }),
    [ringPools],
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

  const finishSpin = useCallback((onStopped?: () => void) => {
    if (spinTimer.current) window.clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => {
      setSpinning(false)
      spinTimer.current = null
      onStopped?.()
    }, SPIN_MS)
  }, [])

  /**
   * `excludingId` drops an item for this spin only. FR-2.4 re-spins the instant
   * a dish is excluded, and the Dexie query that would remove it has not
   * necessarily re-rendered yet — without this the wheel can hand back the dish
   * the user just rejected.
   */
  const spinDish = useCallback(
    (excludingId?: string) => {
      const pool = excludingId ? dishPool.filter((d) => d.id !== excludingId) : dishPool
      if (spinning || pool.length < 2) return
      const rng = makeRng(randomSeed())
      const result = draw(pool, rng)
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
      // The result window opens itself once the wheel has actually stopped.
      finishSpin(() => setShowResult(true))
    },
    [spinning, dishPool, finishSpin],
  )

  const spinRings = useCallback(
    (only?: ComponentType, excludingId?: string) => {
      if (spinning) return
      const targets = (only ? [only] : activeRings).filter((t) => !rings[t].locked)
      if (targets.length === 0) return
      // Same freshness problem as spinDish — the excluded component has to go
      // now, not whenever the Dexie query re-renders.
      const poolFor = (t: ComponentType) =>
        excludingId ? pools[t].filter((c) => c.id !== excludingId) : pools[t]
      if (targets.some((t) => poolFor(t).length === 0)) return

      const rng = makeRng(randomSeed())
      const next = { ...rings }
      for (const type of targets) {
        const result = draw(poolFor(type), rng)
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
      // Same trick as the dish wheel: open the result window once the
      // animation has actually finished, but only once every active ring
      // (not just the one(s) just spun — a lock could mean the others
      // already had winners) has landed on something.
      finishSpin(() => {
        if (activeRings.every((t) => next[t].winner)) setShowResult(true)
      })
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
    // Close the window while the wheel re-spins; it reopens on the new result.
    setShowResult(false)
    setDishSlot(emptySlot())
    spinDish(dish.id)
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
    setShowResult(false)
    setRings((r) => ({ ...r, [type]: { ...r[type], winner: null } }))
    spinRings(type, comp.id)
  }

  const allLocked = activeRings.every((t) => rings[t].locked)
  const comboReady = activeRings.every((t) => rings[t].winner) && !spinning
  const comboParts = activeRings.map((t) => rings[t].winner)

  // The picture prompt wants ingredients, not just the three names — same
  // detail level a real dish gets. Only resolved when there's actually a
  // combo to look up, since components can be a long list.
  const comboIngredientNames = useMemo(() => {
    if (!comboReady) return []
    const ids = new Set(comboParts.filter((p): p is Drawable => !!p).map((p) => p.id))
    return (components ?? [])
      .filter((c) => ids.has(c.id))
      .flatMap((c) => c.ingredients.map((i) => i.name))
  }, [comboReady, comboParts, components])

  // Every eligible item gets a slice, before and after a spin — the wheel is
  // as big as the library, never a fixed number of wedges.
  const ringSpecs: RingSpec[] = activeRings.map((type) => ({
    type,
    slices: rings[type].slices.length ? rings[type].slices : pools[type],
    winnerIndex: rings[type].winner
      ? rings[type].slices.findIndex((s) => s.id === rings[type].winner!.id)
      : null,
    locked: rings[type].locked,
  }))

  const dishRing: RingSpec = {
    type: 'protein',
    slices: dishSlot.slices.length ? dishSlot.slices : dishPool,
    winnerIndex: dishSlot.winner
      ? dishSlot.slices.findIndex((s) => s.id === dishSlot.winner!.id)
      : null,
    locked: false,
  }

  // The wheel only carries id/name/minutes; the result window needs the whole
  // row for the photo.
  const winnerDish = dishSlot.winner
    ? ((dishes ?? []).find((d) => d.id === dishSlot.winner!.id) ?? null)
    : null

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
        value={timeFilter}
        onChange={(v) =>
          void updateSettings({ max_prep_time_filter: v.max, min_prep_time_filter: v.min })
        }
      />

      {mode === 'dish' ? (
        <DishMode
          pool={dishPool}
          ring={dishRing}
          rotation={dishSlot.rotation}
          winner={dishSlot.winner}
          spinning={spinning}
          hasFilter={hasFilter}
          onSpin={spinDish}
          onAssign={() => setAssigning(true)}
          onExclude={excludeCurrentDish}
          onClearFilter={() =>
            void updateSettings({ max_prep_time_filter: null, min_prep_time_filter: null })
          }
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
          hasFilter={hasFilter}
          cooling={activeRings.reduce((sum, t) => sum + ringPools[t].cooling, 0)}
          relaxedRings={activeRings.filter((t) => ringPools[t].relaxed)}
          onToggleVeg={(v) => void updateSettings({ veg_enabled: v })}
          onSpinAll={() => spinRings()}
          onSpinRing={(t) => spinRings(t)}
          onToggleLock={toggleLock}
          onExcludeRing={excludeComponent}
          onAssign={() => setAssigning(true)}
          onClearFilter={() =>
            void updateSettings({ max_prep_time_filter: null, min_prep_time_filter: null })
          }
          onGoToLibrary={onGoToLibrary}
        />
      )}

      {/* FR-2.3 — the result window: the dish, its photo, and the decisions. */}
      {showResult && mode === 'dish' && !spinning && winnerDish && (
        <DishResultModal
          dish={winnerDish}
          onAssign={() => {
            setShowResult(false)
            setAssigning(true)
          }}
          onSpinAgain={() => {
            setShowResult(false)
            spinDish()
          }}
          onExclude={excludeCurrentDish}
          onClose={() => setShowResult(false)}
        />
      )}

      {/* Same window, but the "dish" is whatever the three rings landed on —
          generated fresh each time, since a combo has no photo of its own. */}
      {showResult && mode === 'combo' && !spinning && comboReady && (
        <ComboResultModal
          parts={comboParts}
          ingredients={comboIngredientNames}
          activeRings={activeRings}
          onAssign={() => {
            setShowResult(false)
            setAssigning(true)
          }}
          onSpinAgain={() => {
            setShowResult(false)
            spinRings()
          }}
          onExcludeRing={excludeComponent}
          onClose={() => setShowResult(false)}
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

/**
 * The window that opens when the full-meal wheel stops: the photo, the name
 * under it, and the three decisions from FR-2.3 — assign, spin again, exclude.
 */
function DishResultModal({
  dish,
  onAssign,
  onSpinAgain,
  onExclude,
  onClose,
}: {
  dish: Dish
  onAssign: () => void
  onSpinAgain: () => void
  onExclude: () => void
  onClose: () => void
}) {
  return (
    <Modal title={dish.name} onClose={onClose}>
      <div className="dish-shot-wrap">
        <DishPicture className="dish-shot" name={dish.name} imageUrl={dish.image_url} />
        <div className="dish-shot__caption">{dish.name}</div>
      </div>

      <div style={{ textAlign: 'center', margin: '10px 0 4px' }}>
        <div className="label">{dish.prep_time_minutes} דק׳ הכנה</div>
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        <button className="btn btn--primary btn--block" onClick={onAssign}>
          שבץ ליום…
        </button>
        <button className="btn btn--ghost btn--block" onClick={onSpinAgain}>
          עוד פעם
        </button>
        <button className="btn btn--danger btn--sm btn--block" onClick={onExclude}>
          לא להציע לי את זה
        </button>
      </div>
    </Modal>
  )
}

/**
 * Combo mode's counterpart to DishResultModal — a combo has no photo of its
 * own (only dishes carry image_url), so one is generated fresh for the
 * specific protein+carb+veg this spin landed on, the moment the window
 * opens. Regenerates whenever the combo itself changes (a new spin, or an
 * exclude-and-respin on one ring), never reuses a stale photo from the
 * previous result.
 */
function ComboResultModal({
  parts,
  ingredients,
  activeRings,
  onAssign,
  onSpinAgain,
  onExcludeRing,
  onClose,
}: {
  parts: (Drawable | null)[]
  ingredients: string[]
  activeRings: ComponentType[]
  onAssign: () => void
  onSpinAgain: () => void
  onExcludeRing: (type: ComponentType) => void
  onClose: () => void
}) {
  const label = comboLabel(parts)
  const minutes = comboMinutes(parts)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setImageUrl(null)
    void generateDishImageWithAi(label, ingredients).then((url) => {
      if (!cancelled) {
        setImageUrl(url)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ingredients is
    // derived from `label`'s own components; re-running on label alone is enough.
  }, [label])

  return (
    <Modal title={label} onClose={onClose}>
      {loading ? (
        <div className="dish-shot dish-shot--empty dish-shot--loading">🎨</div>
      ) : (
        <div className="dish-shot-wrap">
          <DishPicture className="dish-shot" name={label} imageUrl={imageUrl} />
          <div className="dish-shot__caption">{label}</div>
        </div>
      )}
      {loading && (
        <p className="label" style={{ textAlign: 'center', marginTop: 8 }}>
          יוצרת תמונה…
        </p>
      )}

      <div style={{ textAlign: 'center', margin: '10px 0 4px' }}>
        <div className="label">{minutes} דק׳ הכנה</div>
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        <button className="btn btn--primary btn--block" onClick={onAssign}>
          שבץ ליום…
        </button>
        <button className="btn btn--ghost btn--block" onClick={onSpinAgain}>
          עוד פעם
        </button>
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
      </div>
    </Modal>
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
        hubLabel="Spin"
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
            {spinning ? 'מסובב…' : `${pool.length} מנות בגלגל`}
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
            שבץ ליום…
          </button>
          <button className="btn btn--ghost" style={{ flex: 1 }} disabled={spinning} onClick={onSpin}>
            {winner ? 'עוד פעם' : 'סובב'}
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
  cooling,
  relaxedRings,
  onToggleVeg,
  onSpinAll,
  onSpinRing,
  onToggleLock,
  onExcludeRing,
  onAssign,
  onClearFilter,
  onGoToLibrary,
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
  /** How many eligible components are sitting out their cooldown right now. */
  cooling: number
  /** Rings whose cooldown had to be released so they would not be empty. */
  relaxedRings: ComponentType[]
  onToggleVeg: (v: boolean) => void
  onSpinAll: () => void
  onSpinRing: (t: ComponentType) => void
  onToggleLock: (t: ComponentType) => void
  onExcludeRing: (t: ComponentType) => void
  onAssign: () => void
  onClearFilter: () => void
  onGoToLibrary?: () => void
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
          <div className="row" style={{ justifyContent: 'center' }}>
            {hasFilter && (
              <button className="btn btn--ghost" onClick={onClearFilter}>
                נקי סינון
              </button>
            )}
            {onGoToLibrary && (
              <button className="btn btn--primary" onClick={onGoToLibrary}>
                למסך המאגר
              </button>
            )}
          </div>
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
          {hasFilter
            ? 'אין רכיבי ירק שעומדים בסינון הזמן, אז הטבעת השלישית מוסתרת.'
            : 'אין רכיבי ירק פעילים במאגר, אז הטבעת השלישית מוסתרת.'}
        </p>
      )}

      <Wheel
        rings={rings}
        rotations={rotations}
        hubLabel={allLocked ? 'נעול' : 'Spin'}
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
            >
              <Icon name={slots[type].locked ? 'lock' : 'lockOpen'} size={13} /> {COMPONENT_LABEL[type]}
            </button>
            <button
              type="button"
              className="chip"
              aria-label={`Spin ${COMPONENT_LABEL[type]} בלבד`}
              disabled={spinning || slots[type].locked}
              onClick={() => onSpinRing(type)}
            >
              ↻
            </button>
          </span>
        ))}
      </div>

      {/* Same reassurance the dish wheel gives: how much is actually in play. */}
      <p className="field__hint" style={{ textAlign: 'center', marginTop: 6 }}>
        {activeRings
          .map(
            (t) =>
              `${pools[t].length} ${
                pools[t].length === 1 ? COMPONENT_LABEL[t] : COMPONENT_LABEL_PLURAL[t]
              }`,
          )
          .join(' · ')}{' '}
        בגלגל
      </p>

      {/* FR-5.2 — say why an item is missing, so it does not read as a bug. */}
      {cooling > 0 && (
        <p className="field__hint" style={{ textAlign: 'center' }}>
          {cooling === 1 ? 'רכיב אחד בצינון' : `${cooling} רכיבים בצינון`} ולא מופיע
          {cooling === 1 ? '' : 'ים'} בגלגל
        </p>
      )}
      {relaxedRings.length > 0 && (
        <Notice>
          כל רכיבי ה{relaxedRings.map((t) => COMPONENT_LABEL[t]).join(' וה')} בצינון — החזרתי אותם
          לגלגל כדי שיהיה ממה להגריל.
        </Notice>
      )}

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
            {spinning ? 'מסובב…' : 'סובב כדי להרכיב ארוחה'}
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
            שבץ ליום…
          </button>
          <button
            className="btn btn--ghost"
            style={{ flex: 1 }}
            disabled={spinning || allLocked}
            onClick={onSpinAll}
          >
            סובב הכל
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
