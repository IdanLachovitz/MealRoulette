import { useState } from 'react'
import { AISLES, UNITS } from '../types'
import type { Aisle, Ingredient, Unit } from '../types'

/**
 * Ingredients are optional everywhere — a dish with none still plans and still
 * appears on the shopping list, marked as having none (FR-1.2 acceptance).
 */
export function IngredientsEditor({
  ingredients,
  onChange,
}: {
  ingredients: Ingredient[]
  onChange: (next: Ingredient[]) => void
}) {
  const [open, setOpen] = useState(ingredients.length > 0)

  const update = (index: number, patch: Partial<Ingredient>) => {
    onChange(ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)))
  }

  const add = () => {
    onChange([
      ...ingredients,
      { name: '', quantity: null, unit: null, is_scalable: true, aisle: 'אחר' },
    ])
    setOpen(true)
  }

  return (
    <div className="card" style={{ marginTop: 4 }}>
      <button
        className="row row--between"
        style={{ width: '100%', minHeight: 40 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span style={{ fontSize: 14 }}>
          מצרכים {ingredients.length > 0 && `(${ingredients.length})`}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {ingredients.length === 0 && (
            <p className="field__hint" style={{ marginTop: 0 }}>
              בלי מצרכים המנה עדיין נכנסת לתכנון — היא פשוט לא תוסיף כלום לרשימת הקניות.
            </p>
          )}

          {ingredients.map((ing, i) => (
            <div
              key={i}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                paddingTop: i === 0 ? 0 : 10,
                marginTop: i === 0 ? 0 : 10,
              }}
            >
              <input
                className="field__input"
                style={{ marginBottom: 6 }}
                value={ing.name}
                placeholder="שם המצרך"
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                <input
                  className="field__input"
                  style={{ flex: 1 }}
                  type="number"
                  inputMode="decimal"
                  placeholder="כמות"
                  value={ing.quantity ?? ''}
                  onChange={(e) =>
                    update(i, { quantity: e.target.value ? Number(e.target.value) : null })
                  }
                />
                <select
                  className="field__select"
                  style={{ flex: 1 }}
                  value={ing.unit ?? ''}
                  onChange={(e) => update(i, { unit: (e.target.value || null) as Unit | null })}
                >
                  <option value="">יחידה</option>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <select
                  className="field__select"
                  style={{ flex: 1 }}
                  value={ing.aisle}
                  onChange={(e) => update(i, { aisle: e.target.value as Aisle })}
                >
                  {AISLES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row row--between">
                <label className="field__hint" style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!ing.is_scalable}
                    onChange={(e) => update(i, { is_scalable: !e.target.checked })}
                  />
                  כמות קבועה (מלח, שמן, תבלינים — לא מוכפל לפי סועדים)
                </label>
                <button
                  className="btn btn--sm btn--danger"
                  onClick={() => onChange(ingredients.filter((_, x) => x !== i))}
                >
                  הסרה
                </button>
              </div>
            </div>
          ))}

          <button className="btn btn--sm btn--ghost btn--block" style={{ marginTop: 10 }} onClick={add}>
            ＋ מצרך
          </button>
        </div>
      )}
    </div>
  )
}
