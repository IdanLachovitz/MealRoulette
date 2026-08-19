import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { alive, newId, now, remove, save } from '../db/repo'
import { useApp } from '../state'
import { EmptyState, Field, Sheet } from '../components/ui'
import { currentWeekStart, ensureWeekPlan, regenerateShoppingList } from '../services/week'
import { AISLES } from '../types'
import type { Aisle, ShoppingItem, WeekPlan } from '../types'

export function ShoppingScreen({ householdId }: { householdId: string }) {
  const { settings, toast } = useApp()
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void ensureWeekPlan(householdId, currentWeekStart(settings), settings).then(setPlan)
  }, [householdId, settings])

  const items = useLiveQuery(
    async () =>
      plan ? alive(await db.shoppingItems.where('week_plan_id').equals(plan.id).toArray()) : [],
    [plan?.id],
    [] as ShoppingItem[],
  )

  const grouped = useMemo(() => {
    const map = new Map<Aisle, ShoppingItem[]>()
    for (const aisle of AISLES) map.set(aisle, [])
    for (const item of items ?? []) {
      map.get(item.aisle)?.push(item)
    }
    // FR-7.7 — checked items sink to the bottom of their group.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1
        return a.name.localeCompare(b.name, 'he')
      })
    }
    return [...map.entries()].filter(([, list]) => list.length > 0)
  }, [items])

  const total = items?.length ?? 0
  const done = items?.filter((i) => i.is_checked).length ?? 0

  /** FR-7.8 — plain text, so it pastes straight into WhatsApp. */
  const shareText = () => {
    const lines: string[] = ['רשימת קניות']
    for (const [aisle, list] of grouped) {
      lines.push('', `— ${aisle} —`)
      for (const item of list) {
        lines.push(`${item.is_checked ? '✓' : '•'} ${item.name}${item.quantity_text ? ` — ${item.quantity_text}` : ''}`)
      }
    }
    return lines.join('\n')
  }

  const share = async () => {
    const text = shareText()
    if (navigator.share) {
      try {
        await navigator.share({ title: 'רשימת קניות', text })
        return
      } catch {
        // User dismissed the share sheet — fall through to clipboard.
      }
    }
    await navigator.clipboard.writeText(text)
    toast('הרשימה הועתקה')
  }

  if (!plan) return <div className="muted">טוען…</div>

  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <span className="label">
          {done}/{total} נקנו
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn btn--sm btn--ghost"
            onClick={async () => {
              await regenerateShoppingList(householdId, plan, settings.default_diners)
              toast('הרשימה חושבה מחדש')
            }}
          >
            ↻ רענון
          </button>
          <button className="btn btn--sm btn--ghost" onClick={() => void share()} disabled={total === 0}>
            שיתוף
          </button>
          <button className="btn btn--sm btn--primary" onClick={() => setAdding(true)}>
            ＋
          </button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          icon="🛒"
          title="הרשימה ריקה"
          body="הרשימה נבנית מהבישולים של השבוע. אחרי שתתכנני שבוע — ותוסיפי מצרכים למנות — היא תתמלא לבד."
          action={
            <button className="btn btn--ghost" onClick={() => setAdding(true)}>
              הוספה ידנית
            </button>
          }
        />
      ) : (
        grouped.map(([aisle, list]) => (
          <div key={aisle} className="aisle">
            <div className="aisle__head">
              <span>{aisle}</span>
              <span>{list.filter((i) => i.is_checked).length}/{list.length}</span>
            </div>
            {list.map((item) => (
              <div key={item.id} className={`item${item.is_checked ? ' item--checked' : ''}`}>
                <button
                  className="row"
                  style={{ flex: 1, gap: 10, minHeight: 32 }}
                  aria-pressed={item.is_checked}
                  onClick={() => void save('shopping_items', { ...item, is_checked: !item.is_checked })}
                >
                  <span className="item__box" aria-hidden="true">
                    {item.is_checked ? '✓' : ''}
                  </span>
                  <span className="item__name">{item.name}</span>
                  {item.quantity_text && <span className="item__qty">{item.quantity_text}</span>}
                </button>
                {item.source === 'manual' && (
                  <button
                    className="btn btn--sm btn--danger"
                    aria-label={`מחיקת ${item.name}`}
                    onClick={() => void remove('shopping_items', item)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      {adding && (
        <ManualItemSheet
          householdId={householdId}
          planId={plan.id}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function ManualItemSheet({
  householdId,
  planId,
  onClose,
}: {
  householdId: string
  planId: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [aisle, setAisle] = useState<Aisle>('אחר')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    // Manual rows survive every regeneration of the automatic part (FR-7.6).
    await save('shopping_items', {
      id: newId(),
      household_id: householdId,
      updated_at: now(),
      deleted_at: null,
      week_plan_id: planId,
      name: trimmed,
      quantity_text: qty.trim(),
      aisle,
      source: 'manual',
      is_checked: false,
      match_key: `manual:${newId()}`,
    })
    onClose()
  }

  return (
    <Sheet title="הוספה לרשימה" onClose={onClose}>
      <Field label="מה צריך">
        <input
          className="field__input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder="נייר סופג"
        />
      </Field>
      <Field label="כמות (אופציונלי)">
        <input
          className="field__input"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="2 חבילות"
        />
      </Field>
      <Field label="מדף">
        <select
          className="field__select"
          value={aisle}
          onChange={(e) => setAisle(e.target.value as Aisle)}
        >
          {AISLES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
      <button className="btn btn--primary btn--block" onClick={() => void add()}>
        הוספה
      </button>
    </Sheet>
  )
}
