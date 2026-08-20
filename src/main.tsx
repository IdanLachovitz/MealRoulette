import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Manual service-worker registration (injectRegister: false in vite.config.ts,
 * and this bypasses vite-plugin-pwa's own `virtual:pwa-register` helper too —
 * see why below).
 *
 * GitHub Pages serves every static file, sw.js included, with
 * `Cache-Control: max-age=600`, and there is no way to override that on a
 * static host with no custom-headers support. The previous version of this
 * file polled `registration.update()` on a timer to work around that, on the
 * assumption that calling update() forces a real network fetch — it does not.
 * The fetch it triggers for the sw.js *script itself* is an ordinary HTTP
 * request and is just as bound by that ten-minute Cache-Control as any other
 * asset, unless the registration opts out with `updateViaCache: 'none'`. So a
 * tab open right after a deploy could poll every minute for the next ten and
 * still be comparing the new install against a cached copy of the *old*
 * sw.js, reporting "nothing changed" the whole time — which is why only a
 * hard refresh (bypassing HTTP cache entirely) reliably showed the update.
 *
 * `updateViaCache: 'none'` tells the browser to always hit the network for
 * that one fetch, ignoring the header — this is what actually closes the gap.
 * Everything past registration (waiting for a fresh worker, telling it to
 * skip waiting, reloading once it takes control) is done by hand here because
 * vite-plugin-pwa's `registerSW()` wrapper always registers through
 * workbox-window, which doesn't expose updateViaCache — this is the one part
 * of the flow that has to be manual to get that option in at all.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void (async () => {
    const swUrl = new URL('sw.js', document.baseURI).href
    const registration = await navigator.serviceWorker.register(swUrl, {
      updateViaCache: 'none',
    })

    // The generated sw.js already listens for this message and calls
    // self.skipWaiting() — that's standard Workbox `generateSW` output.
    const applyUpdate = (worker: ServiceWorker) => worker.postMessage({ type: 'SKIP_WAITING' })

    // A worker may already be sitting in "waiting" if this tab loaded right
    // as an earlier check finished installing one.
    if (registration.waiting) applyUpdate(registration.waiting)

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      installing?.addEventListener('statechange', () => {
        // `controller` is only set once a worker has taken control of this
        // page, so its presence here means this install is an update, not
        // the very first activation — the case we want to auto-apply.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          applyUpdate(installing)
        }
      })
    })

    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })

    const check = () => void registration.update()
    window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    window.addEventListener('focus', check)
  })()
}
