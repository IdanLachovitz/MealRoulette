import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePhoneBack } from '../components/ui'
import { formatCountdown, stepTimers } from '../engine/stepTimers'
import { newId } from '../db/repo'
import { cancelTimerPush, scheduleTimerPush } from '../sync/push'

export interface CookIngredient {
  name: string
  /** Ready to show: "500 גרם", "2 כפות", or '' when there's no amount. */
  amount: string
}

interface RunningTimer {
  id: number
  /** The server's copy, a push that goes off with the phone locked (sync/push.ts). */
  pushId: string
  label: string
  endsAt: number
  done: boolean
}

/**
 * Cooking mode: the recipe one step at a time, big enough to read from the
 * counter. Ingredients come first, as their own page, then each step; a step
 * that names a duration ("אופים 25 דקות") gets a timer button for it (see
 * engine/stepTimers.ts). Running timers stay in a bar at the bottom across
 * steps, and ring when they're done.
 *
 * The screen is kept awake while this is open (Screen Wake Lock), since a
 * phone dimming with flour on your hands is the whole problem. The phone's
 * back button goes to the previous step, and closes from the first one.
 */
export function CookMode({
  title,
  ingredients,
  steps,
  tips,
  onClose,
}: {
  title: string
  ingredients: CookIngredient[]
  steps: string[]
  tips: string[]
  onClose: () => void
}) {
  const pages: ({ kind: 'ingredients' } | { kind: 'step'; index: number })[] = [
    ...(ingredients.length > 0 ? [{ kind: 'ingredients' as const }] : []),
    ...steps.map((_, index) => ({ kind: 'step' as const, index })),
  ]
  const [page, setPage] = useState(0)
  const [timers, setTimers] = useState<RunningTimer[]>([])
  const [now, setNow] = useState(() => Date.now())
  const nextTimerId = useRef(1)

  const current = pages[page]
  const last = page === pages.length - 1
  usePhoneBack(() => (page > 0 ? setPage(page - 1) : onClose()))

  useKeepAwake()

  // One tick a second while anything is counting down; a timer that reaches
  // zero rings once and stays in the bar, marked done, until dismissed.
  const running = timers.some((t) => !t.done)
  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [running])
  // A timer that rang here, on screen, cancels its push so the phone doesn't
  // announce it twice. One that ran out while the app was hidden keeps it:
  // that push is how it was heard.
  useEffect(() => {
    const due = timers.filter((t) => !t.done && t.endsAt <= now)
    if (due.length === 0) return
    ring()
    if (document.visibilityState === 'visible') due.forEach((t) => void cancelTimerPush(t.pushId))
    setTimers((list) => list.map((t) => (!t.done && t.endsAt <= now ? { ...t, done: true } : t)))
  }, [now, timers])

  // Leaving cooking mode drops its timers, so their pushes go too.
  const timersRef = useRef(timers)
  timersRef.current = timers
  useEffect(
    () => () => timersRef.current.filter((t) => !t.done).forEach((t) => void cancelTimerPush(t.pushId)),
    [],
  )

  const startTimer = (minutes: number) => {
    unlockAudio()
    const id = nextTimerId.current++
    const pushId = newId()
    const label = current?.kind === 'step' ? `שלב ${current.index + 1} · ${minutes} דק׳` : `${minutes} דק׳`
    const endsAt = Date.now() + minutes * 60_000
    setNow(Date.now())
    setTimers((list) => [...list, { id, pushId, label, endsAt, done: false }])
    void scheduleTimerPush(pushId, endsAt, `${title} · ${label}`)
  }

  const dismissTimer = (timer: RunningTimer) => {
    setTimers((list) => list.filter((x) => x.id !== timer.id))
    if (!timer.done) void cancelTimerPush(timer.pushId)
  }

  return createPortal(
    <div className="cook" role="dialog" aria-modal="true" aria-label={`מצב בישול: ${title}`}>
      <div className="cook__head">
        <div style={{ minWidth: 0 }}>
          <div className="cook__title">{title}</div>
          <div className="label">
            {current?.kind === 'ingredients'
              ? 'מצרכים'
              : `שלב ${(current?.kind === 'step' ? current.index : 0) + 1} מתוך ${steps.length}`}
          </div>
        </div>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="יציאה ממצב בישול">
          ✕
        </button>
      </div>

      <div className="cook__progress" aria-hidden="true">
        <div style={{ width: `${((page + 1) / Math.max(1, pages.length)) * 100}%` }} />
      </div>

      <div className="cook__body" key={page}>
        {current?.kind === 'ingredients' ? (
          <ul className="cook__ingredients">
            {ingredients.map((ing, i) => (
              <li key={i}>
                <span>{ing.name}</span>
                {ing.amount && <span className="cook__amount">{ing.amount}</span>}
              </li>
            ))}
          </ul>
        ) : current?.kind === 'step' ? (
          <>
            <p className="cook__step">{steps[current.index]}</p>
            {stepTimers(steps[current.index]).length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
                {stepTimers(steps[current.index]).map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => startTimer(minutes)}
                  >
                    טיימר {minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} ש׳` : `${minutes} דק׳`} ⏱️
                  </button>
                ))}
              </div>
            )}
            {last && tips.length > 0 && (
              <div className="card card--flat" style={{ marginTop: 22 }}>
                <div className="label" style={{ marginBottom: 6 }}>
                  טיפים
                </div>
                {tips.map((tip, i) => (
                  <p key={i} className="field__hint" style={{ margin: i === 0 ? 0 : '6px 0 0', fontSize: 15 }}>
                    {tip} 💡
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">אין עדיין שלבים למתכון הזה.</p>
        )}
      </div>

      {timers.length > 0 && (
        <div className="cook__timers" aria-live="polite">
          {timers.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`cook__timer${t.done ? ' cook__timer--done' : ''}`}
              onClick={() => dismissTimer(t)}
              aria-label={t.done ? `${t.label} הסתיים, הקשה לסגירה` : `${t.label}, הקשה לביטול`}
            >
              <span>{t.done ? 'הזמן נגמר ⏰' : formatCountdown((t.endsAt - now) / 1000)}</span>
              <span className="label">{t.label} ✕</span>
            </button>
          ))}
        </div>
      )}

      <div className="cook__nav">
        <button
          type="button"
          className="btn btn--ghost"
          style={{ flex: 1 }}
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          → הקודם
        </button>
        {last ? (
          <button type="button" className="btn btn--primary" style={{ flex: 2 }} onClick={onClose}>
            סיימתי, בתיאבון 🍽️
          </button>
        ) : (
          <button type="button" className="btn btn--primary" style={{ flex: 2 }} onClick={() => setPage(page + 1)}>
            הבא ←
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Keeps the screen on while cooking mode is open. The browser drops the lock
 * whenever the page is hidden (switching apps, locking the phone), so it's
 * asked for again each time the page comes back. Where the API is missing
 * (older iPhones) this quietly does nothing.
 */
function useKeepAwake() {
  useEffect(() => {
    type Lock = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Lock> } }
    if (!nav.wakeLock) return
    let lock: Lock | null = null
    let active = true
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      nav.wakeLock!.request('screen').then(
        (l) => {
          if (active) lock = l
          else void l.release()
        },
        () => {},
      )
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => {})
    }
  }, [])
}

// iPhones only let a page make sound after a tap has started its audio, so
// the context is created (or resumed) when a timer is started, and the ring
// itself later plays through that same context.
let audio: AudioContext | null = null
function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audio ??= new Ctx()
    void audio.resume()
  } catch {
    audio = null
  }
}

/** Three short beeps, plus a buzz where the phone supports it. */
function ring() {
  navigator.vibrate?.([300, 150, 300, 150, 300])
  if (!audio) return
  const start = audio.currentTime
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, start + i * 0.45)
    gain.gain.exponentialRampToValueAtTime(0.4, start + i * 0.45 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.45 + 0.3)
    osc.connect(gain).connect(audio.destination)
    osc.start(start + i * 0.45)
    osc.stop(start + i * 0.45 + 0.32)
  }
}
