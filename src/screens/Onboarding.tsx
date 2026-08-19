import { useState } from 'react'
import { createHousehold, importSeedLibrary, SEED_COUNTS } from '../db/seed'
import { notifyHouseholdChanged } from '../state'
import { Field } from '../components/ui'

export function Onboarding() {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [diners, setDiners] = useState(2)
  const [name, setName] = useState('המטבח שלנו')
  const [busy, setBusy] = useState(false)

  const finish = async (withSeed: boolean) => {
    setBusy(true)
    const household = await createHousehold(name.trim() || 'המטבח שלנו', diners)
    if (withSeed) await importSeedLibrary(household.id)
    notifyHouseholdChanged()
  }

  return (
    <div className="app">
      <main className="app__main" style={{ paddingTop: 40 }}>
        {step === 0 && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1.4 }}>
              מה מבשלים השבוע
            </h1>
            <p style={{ lineHeight: 1.7, color: 'var(--mut)' }}>
              במקום להחליט כל ערב מה מכינים — מחליטים פעם אחת בשבוע. את מזינה פעם אחת את מה
              שאת יודעת לבשל, והאפליקציה מרכיבה לך שבוע.
            </p>
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: 24 }}
              onClick={() => setStep(1)}
            >
              בואו נתחיל
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>קצת פרטים</h2>
            <Field label="איך לקרוא למטבח שלכם">
              <input
                className="field__input"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="כמה אנשים אוכלים" hint="אפשר לשנות בכל רגע בהגדרות.">
              <div className="chips">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    className="chip"
                    aria-pressed={diners === n}
                    onClick={() => setDiners(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: 20 }}
              onClick={() => setStep(2)}
            >
              המשך
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>המאגר ההתחלתי</h2>
            <p style={{ lineHeight: 1.7, color: 'var(--mut)' }}>
              יש מאגר מוכן עם {SEED_COUNTS.dishes} מנות ו־{SEED_COUNTS.components} רכיבים, כדי
              שלא תתחילי ממסך ריק. הוא לא סגור — אפשר לערוך, לכבות, להדיר ולהוסיף בכל רגע.
            </p>
            <div className="stack" style={{ marginTop: 24 }}>
              <button
                className="btn btn--primary btn--block"
                disabled={busy}
                onClick={() => void finish(true)}
              >
                {busy ? 'מכינה…' : 'כן, טענו את המאגר'}
              </button>
              <button
                className="btn btn--ghost btn--block"
                disabled={busy}
                onClick={() => void finish(false)}
              >
                אתחיל מאפס
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
