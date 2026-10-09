// Pulled into the generated service worker (workbox.importScripts in
// vite.config.ts). Shows the notifications the `push` edge function sends
// (supabase/functions/push) and opens the app when one is tapped.
//
// iPhones revoke push for a site whose pushes don't show a notification, so
// every push shows one, even with the app open.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'מה מבשלים', {
      body: data.body || '',
      tag: data.tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      dir: 'rtl',
      lang: 'he',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) return open.focus()
      return self.clients.openWindow(self.registration.scope)
    })(),
  )
})
