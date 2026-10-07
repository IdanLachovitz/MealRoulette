import { describe, expect, it } from 'vitest'
import { createBackStack } from './backStack'

/** A fake browser: a history depth, a popstate listener and a manual tick. */
function fakeEnv() {
  let depth = 1
  let listener: () => void = () => {}
  let queue: (() => void)[] = []
  const env = {
    history: {
      pushState: () => {
        depth++
      },
      // Like the real thing: going back fires popstate (asynchronously).
      back: () => {
        depth--
        queue.push(() => listener())
      },
    },
    addPopListener: (l: () => void) => {
      listener = l
    },
    defer: (fn: () => void) => {
      queue.push(fn)
    },
  }
  const tick = () => {
    while (queue.length) {
      const run = queue
      queue = []
      run.forEach((fn) => fn())
    }
  }
  /** The user presses the phone's back button. */
  const pressBack = () => {
    depth--
    listener()
    tick()
  }
  return { env, tick, pressBack, depth: () => depth }
}

describe('back stack', () => {
  it('adds one guard entry while something is open, and back closes it', () => {
    const f = fakeEnv()
    const stack = createBackStack(f.env)
    let closed = false
    let unregister = () => {}
    unregister = stack.register(() => {
      closed = true
      unregister()
    })
    f.tick()
    expect(f.depth()).toBe(2)

    f.pressBack()
    expect(closed).toBe(true)
    expect(f.depth()).toBe(1)
  })

  it('removes the guard when the layer is closed from inside the app', () => {
    const f = fakeEnv()
    const stack = createBackStack(f.env)
    const unregister = stack.register(() => {})
    f.tick()
    unregister()
    f.tick()
    expect(f.depth()).toBe(1)
  })

  it('keeps a single guard across a step change in one commit', () => {
    const f = fakeEnv()
    const stack = createBackStack(f.env)
    const first = stack.register(() => {})
    f.tick()
    first()
    stack.register(() => {})
    f.tick()
    expect(f.depth()).toBe(2)
  })

  it('goes back one step at a time, then closes', () => {
    const f = fakeEnv()
    const stack = createBackStack(f.env)
    const steps: string[] = []
    // Step 2 goes back to step 1, which closes on the next press.
    let unregisterStep1 = () => {}
    const openStep1 = () => {
      unregisterStep1 = stack.register(() => {
        steps.push('close')
        unregisterStep1()
      })
    }
    openStep1()
    f.tick()
    unregisterStep1()
    const unregisterStep2 = stack.register(() => {
      steps.push('back')
      unregisterStep2()
      openStep1()
    })
    f.tick()
    expect(f.depth()).toBe(2)

    f.pressBack()
    expect(steps).toEqual(['back'])
    expect(f.depth()).toBe(2)

    f.pressBack()
    expect(steps).toEqual(['back', 'close'])
    expect(f.depth()).toBe(1)
  })

  it('sends back to the topmost layer', () => {
    const f = fakeEnv()
    const stack = createBackStack(f.env)
    const hits: string[] = []
    stack.register(() => hits.push('bottom'))
    const top = stack.register(() => {
      hits.push('top')
      top()
    })
    f.tick()
    f.pressBack()
    expect(hits).toEqual(['top'])
  })
})
