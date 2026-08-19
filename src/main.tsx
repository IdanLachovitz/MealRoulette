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
 * Manual service-worker registration (injectRegister: false in vite.config.ts).
 *
 * GitHub Pages serves sw.js with `Cache-Control: max-age=600` and there is no
 * way to override that on a static host with no custom-headers support, so the
 * browser's own update check — which only fires occasionally and respects that
 * cache — can sit on a stale service worker for up to ten minutes after a
 * deploy, or longer if the tab is never fully closed and reopened. Polling
 * registration.update() ourselves forces a real network check regardless of
 * that header, so a running tab picks up a new deploy within a minute.
 */
if ('serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        const check = () => void registration.update()
        window.setInterval(check, 60_000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        window.addEventListener('focus', check)
      },
      onNeedRefresh() {
        void updateSW(true)
      },
    })
  })
}
