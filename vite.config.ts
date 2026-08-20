import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base './' keeps the build portable: it works from a local `vite preview`,
// from https://<user>.github.io/<repo>/ and from any other sub-path.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx instead of the auto-injected script, so we
      // can poll for updates on an interval — see the comment there for why.
      injectRegister: false,
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'מה מבשלים השבוע',
        short_name: 'מה מבשלים',
        description: 'תכנון בישולים שבועי עם רולטת בחירה',
        lang: 'he',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FDF6EC',
        theme_color: '#7A3B12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // Supabase responses are never precached — sync owns freshness, not the SW.
        navigateFallback: 'index.html',
        // Without these two, a newly-installed worker sits in "waiting" and
        // never takes over a tab that's already open — it only ever controls
        // the *next* fresh navigation. skipWaiting activates it the moment it
        // finishes installing; clientsClaim then hands it control of every
        // open tab immediately, which is what actually fires the
        // `controllerchange` main.tsx listens for to reload automatically.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
