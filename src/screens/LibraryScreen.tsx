import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, remove, save } from '../db/repo'
import { useApp } from '../state'
import { EmptyState, Field, Notice, Sheet, Switch, TimeFilterChips } from '../components/ui'
import { QuickAddDish } from './QuickAddDish'
import { IngredientsEditor } from './IngredientsEditor'
import { passesTimeFilter } from '../engine/planner'
import type { Component, ComponentType, Dish } from '../types'
import { COMPONENT_LABEL } from '../types'

type Tab = 'dish' | ComponentType

export function LibraryScreen({ householdId }: { householdId: string }) {
  const { settings, updateSettings, toast } = useApp()
  const [tab, setTab] = useState<Tab>('dish')
  const [adding, setAdding] = useState(false)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const [editingComponent, setEditingComponent] = useState<Component | null>(null)
  const [search, setSearch] = useState('')

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

  const filter = settings.max_prep_time_filter
  const query = search.trim().toLowerCase()

  const visible = useMemo(() => {
    const source: (Dish | Component)[] =
      tab === 'dish' ? (dishes ?? []) : (components ?? []).filter((c) => c.type === tab)
    return source
      .filter((item) => passesTimeFilter(item.prep_time_minutes, filter))
      .filter((item) => !query || item.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [tab, dishes, components, filter, query])

  const excludedCount = [...(dishes ?? []), ...(components ?? [])].filter(
    (i) => i.is_excluded,
  ).length

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }} role="tablist">
        {(['dish', 'protein', 'carb', 'veg'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            className="chip"
            aria-selected={tab === t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'dish' ? 'מנות' : COMPONENT_LABEL[t]}
          </button>
        ))}
      </div>

      <input
        className="field__input"
        style={{ marginBottom: 10 }}
        type="search"
        value={search}
        placeholder="חיפוש במאגר"
        onChange={(e) => setSearch(e.target.value)}
      />

      <TimeFilterChips
        value={filter}
        onChange={(v) => void updateSettings({ max_prep_time_filter: v })}
      />

      <div className="row row--between" style={{ margin: '10px 0' }}>
        <span className="label">
          {visible.length} פריטים
          {excludedCount > 0 && ` · ${excludedCount} מודרים`}
        </span>
        <button className="btn btn--sm btn--primary" onClick={() => setAdding(true)}>
          ＋ הוספה
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="📋"
          title={query ? 'אין התאמות לחיפוש' : 'אין כאן עדיין כלום'}
          body={
            query
              ? 'נסי שם אחר, או נקי את החיפוש.'
              : 'שם וזמן הכנה מספיקים כדי לשמור. מצרכים אפשר להשלים אחר כך — או אף פעם.'
          }
          action={
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              הוספה
            </button>
          }
        />
      ) : (
        visible.map((item) => (
          <button
            key={item.id}
            className={`list-row${item.is_active && !item.is_excluded ? '' : ' list-row--off'}`}
            onClick={() =>
              tab === 'dish'
                ? setEditingDish(item as Dish)
                : setEditingComponent(item as Component)
            }
          >
            {tab !== 'dish' && <span className={`dot dot--${tab}`} aria-hidden="true" />}
            <span className="list-row__name">{item.name}</span>
            <span className="item__qty">{item.prep_time_minutes} דק׳</span>
            {item.is_excluded && <span aria-label="מודר">🚫</span>}
            {!item.is_active && !item.is_excluded && <span aria-label="כבוי">💤</span>}
          </button>
        ))
      )}

      {adding && (
        <Sheet title="הוספה למאגר" onClose={() => setAdding(false)}>
          <QuickAddDish
            householdId={householdId}
            defaultKind={tab}
            onDone={() => setAdding(false)}
          />
        </Sheet>
      )}

      {editingDish && (
        <DishSheet
          dish={editingDish}
          householdId={householdId}
          onClose={() => setEditingDish(null)}
          onDeleted={() => {
            toast('המנה נמחקה')
            setEditingDish(null)
          }}
        />
      )}

      {editingComponent && (
        <ComponentSheet
          component={editingComponent}
          onClose={() => setEditingComponent(null)}
          onDeleted={() => {
            toast('הרכיב נמחק')
            setEditingComponent(null)
          }}
        />
      )}
    </div>
  )
}

function DishSheet({
  dish,
  householdId,
  onClose,
  onDeleted,
}: {
  dish: Dish
  householdId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [draft, setDraft] = useState<Dish>(dish)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // EC-3 — deleting a dish that is scheduled has to say what it will break.
  const affected = useLiveQuery(
    async () =>
      alive(await db.cookSessions.toArray()).filter(
        (s) => s.dish_id === dish.id && !s.is_cooked,
      ),
    [dish.id],
    [],
  )

  const patch = (p: Partial<Dish>) => {
    const next = { ...draft, ...p }
    setDraft(next)
    void save('dishes', next)
  }

  return (
    <Sheet title={draft.name} onClose={onClose}>
      <Field label="שם">
        <input
          className="field__input"
          value={draft.name}
          maxLength={60}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onBlur={() => draft.name.trim() && patch({ name: draft.name.trim() })}
        />
      </Field>

      <div className="row" style={{ gap: 10 }}>
        <Field label="זמן הכנה (דק׳)">
          <input
            className="field__input"
            type="number"
            inputMode="numeric"
            value={draft.prep_time_minutes}
            onChange={(e) => patch({ prep_time_minutes: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="לכמה סועדים כתובה">
          <input
            className="field__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.base_servings}
            onChange={(e) => patch({ base_servings: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      </div>

      <Field
        label="מספיק לכמה ימים"
        hint="התקרה שהתכנון מסתמך עליה כשהוא מציע בישול מרוכז."
      >
        <div className="chips">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className="chip"
              aria-pressed={draft.max_cover_days === n}
              onClick={() => patch({ max_cover_days: n })}
            >
              {n === 1 ? 'יום אחד' : `${n} ימים`}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="כמות קבועה (אופציונלי)"
        hint='למנה ש"תמיד בתבנית גדולה" — דורס את חישוב הסועדים ברשימת הקניות.'
      >
        <input
          className="field__input"
          type="number"
          inputMode="numeric"
          placeholder="לפי מספר הסועדים"
          value={draft.fixed_servings ?? ''}
          onChange={(e) =>
            patch({ fixed_servings: e.target.value ? Number(e.target.value) : null })
          }
        />
      </Field>

      <IngredientsEditor
        ingredients={draft.ingredients}
        onChange={(ingredients) => patch({ ingredients })}
      />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14 }}>פעילה</div>
            <div className="field__hint">כיבוי זמני, בלי למחוק.</div>
          </div>
          <Switch
            checked={draft.is_active}
            onChange={(v) => patch({ is_active: v })}
            label="מנה פעילה"
          />
        </div>
        <div className="row row--between">
          <div>
            <div style={{ fontSize: 14 }}>לא להציע לי את זה</div>
            <div className="field__hint">נשארת במאגר, לא נכנסת להגרלות אף פעם.</div>
          </div>
          <Switch
            checked={draft.is_excluded}
            onChange={(v) => patch({ is_excluded: v })}
            label="הדרה"
          />
        </div>
      </div>

      {confirmDelete ? (
        <div style={{ marginTop: 14 }}>
          <Notice warn>
            {affected && affected.length > 0
              ? `המנה משובצת ל־${affected.length} בישולים השבוע. הם יתרוקנו.`
              : 'המחיקה סופית. אפשר במקום זה לכבות את המנה.'}
          </Notice>
          <div className="row">
            <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
              ביטול
            </button>
            <button
              className="btn btn--danger"
              style={{ flex: 1 }}
              onClick={async () => {
                for (const s of affected ?? []) {
                  await save('cook_sessions', { ...s, dish_id: null, estimated_minutes: 0 })
                }
                await remove('dishes', draft)
                onDeleted()
              }}
            >
              מחיקה
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn--danger btn--block"
          style={{ marginTop: 14 }}
          onClick={() => setConfirmDelete(true)}
        >
          מחיקת המנה
        </button>
      )}
      <span className="sr-only">{householdId}</span>
    </Sheet>
  )
}

function ComponentSheet({
  component,
  onClose,
  onDeleted,
}: {
  component: Component
  onClose: () => void
  onDeleted: () => void
}) {
  const [draft, setDraft] = useState<Component>(component)

  const patch = (p: Partial<Component>) => {
    const next = { ...draft, ...p }
    setDraft(next)
    void save('components', next)
  }

  return (
    <Sheet title={draft.name} onClose={onClose}>
      <Field label="שם">
        <input
          className="field__input"
          value={draft.name}
          maxLength={60}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onBlur={() => draft.name.trim() && patch({ name: draft.name.trim() })}
        />
      </Field>

      <Field label="סוג">
        <div className="chips">
          {(['protein', 'carb', 'veg'] as ComponentType[]).map((t) => (
            <button
              key={t}
              className="chip"
              aria-pressed={draft.type === t}
              onClick={() => patch({ type: t })}
            >
              <span className={`dot dot--${t}`} aria-hidden="true" /> {COMPONENT_LABEL[t]}
            </button>
          ))}
        </div>
      </Field>

      <div className="row" style={{ gap: 10 }}>
        <Field label="זמן הכנה (דק׳)">
          <input
            className="field__input"
            type="number"
            inputMode="numeric"
            value={draft.prep_time_minutes}
            onChange={(e) => patch({ prep_time_minutes: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="לכמה סועדים">
          <input
            className="field__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.base_servings}
            onChange={(e) => patch({ base_servings: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      </div>

      <IngredientsEditor
        ingredients={draft.ingredients}
        onChange={(ingredients) => patch({ ingredients })}
      />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 14 }}>פעיל</span>
          <Switch checked={draft.is_active} onChange={(v) => patch({ is_active: v })} label="פעיל" />
        </div>
        <div className="row row--between">
          <span style={{ fontSize: 14 }}>לא להציע לי את זה</span>
          <Switch
            checked={draft.is_excluded}
            onChange={(v) => patch({ is_excluded: v })}
            label="הדרה"
          />
        </div>
      </div>

      <button
        className="btn btn--danger btn--block"
        style={{ marginTop: 14 }}
        onClick={async () => {
          await remove('components', draft)
          onDeleted()
        }}
      >
        מחיקת הרכיב
      </button>
    </Sheet>
  )
}
