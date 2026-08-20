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
 * see why below). Two separate problems had to be fixed for a deploy to reach
 * an already-open tab with zero manual action:
 *
 * 1. Detecting the new version at all. GitHub Pages serves every static file,
 *    sw.js included, with `Cache-Control: max-age=600`, and there is no way
 *    to override that on a static host with no custom-headers support. Just
 *    calling `registration.update()` on a timer doesn't bypass this — that
 *    fetch is an ordinary HTTP request, bound by the same header as any other
 *    asset, unless the registration opts out with `updateViaCache: 'none'`.
 *    Without it, a tab could poll every minute for up to ten and still be
 *    comparing against a cached copy of the *old* sw.js the whole time.
 *
 * 2. Actually taking over the tab once a new worker is found. `skipWaiting`
 *    and `clientsClaim` are set in vite.config.ts's workbox options so a
 *    newly-installed worker activates itself immediately and takes control of
 *    every open tab in scope, instead of sitting in "waiting" until that tab
 *    happens to close and reopen fresh — which, on a phone where tabs are
 *    rarely fully closed, could be indefinitely. That handoff is what fires
 *    `controllerchange` below.
 *
 * `updateViaCache` isn't exposed by vite-plugin-pwa's `registerSW()` helper
 * (it always registers through workbox-window), so registration is done here
 * by hand instead.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void (async () => {
    // Captured before registering: on a page's very first-ever visit there is
    // no prior controller, and skipWaiting+clientsClaim means *that* initial
    // activation also fires `controllerchange` — without this check, every
    // first visit would trigger one pointless extra reload.
    const hadController = !!navigator.serviceWorker.controller

    const swUrl = new URL('sw.js', document.baseURI).href
    const registration = await navigator.serviceWorker.register(swUrl, {
      updateViaCache: 'none',
    })

    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
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
