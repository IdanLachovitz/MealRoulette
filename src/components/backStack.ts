/**
 * The phone's own back button (Android's back key or gesture, the browser's
 * back, a swipe from the edge on iOS) steps back through open sheets and
 * popups, the same as the in-app → / ✕ buttons, instead of leaving the app.
 *
 * The app has no routes, so there is nothing in the browser history to go
 * back to. While at least one sheet or popup is open, one extra "guard"
 * history entry is kept on top. Pressing back pops it, which fires popstate;
 * the topmost open layer then runs its own back (or close). If something is
 * still open afterwards (back went one step, or the previous step's sheet
 * opened in its place) a fresh guard goes on, so the next press goes back
 * again. When the last layer is closed from inside the app, the guard is
 * taken off with history.back(), whose popstate is ignored, so the back
 * button never seems to do nothing.
 *
 * Moving from one step to the next usually unmounts one sheet and mounts
 * another in the same React commit, so the layer count can dip to zero and
 * come straight back. The guard is therefore reconciled a tick later, not on
 * every register/unregister, or every step change would pop and re-push
 * history.
 */

export interface HistoryLike {
  pushState(data: unknown, unused: string): void
  back(): void
}

export interface BackStackEnv {
  history: HistoryLike
  addPopListener(listener: () => void): void
  /** Runs `fn` after the current commit has settled. */
  defer(fn: () => void): void
}

export interface BackStack {
  /** Registers an open layer; returns its unregister function. */
  register(onBack: () => void): () => void
}

export function createBackStack(env: BackStackEnv): BackStack {
  const layers: { onBack: () => void }[] = []
  let guarded = false
  let ignoreNextPop = false
  let scheduled = false

  const reconcile = () => {
    scheduled = false
    if (layers.length > 0 && !guarded) {
      env.history.pushState({ mealRouletteSheet: true }, '')
      guarded = true
    } else if (layers.length === 0 && guarded) {
      guarded = false
      ignoreNextPop = true
      env.history.back()
    }
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    env.defer(reconcile)
  }

  env.addPopListener(() => {
    if (ignoreNextPop) {
      ignoreNextPop = false
      return
    }
    if (!guarded) return
    // The press used up the guard; the topmost layer handles it.
    guarded = false
    layers[layers.length - 1]?.onBack()
    schedule()
  })

  return {
    register(onBack) {
      const layer = { onBack }
      layers.push(layer)
      schedule()
      return () => {
        const index = layers.indexOf(layer)
        if (index >= 0) layers.splice(index, 1)
        schedule()
      }
    },
  }
}

let shared: BackStack | null = null

/** The app-wide stack, bound to the real window on first use. */
export function backStack(): BackStack {
  if (!shared) {
    shared = createBackStack({
      history: window.history,
      addPopListener: (listener) => window.addEventListener('popstate', listener),
      defer: (fn) => window.setTimeout(fn, 0),
    })
  }
  return shared
}
