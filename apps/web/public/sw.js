/**
 * OpenPixel Studio offline Service Worker.
 *
 * - Caches the app shell on install so OpenPixel works offline.
 * - Navigation requests use network-first with cache fallback so
 *   updates arrive immediately online and deep links still open offline.
 * - Same-origin static assets (JS/CSS/fonts/WASM/tessdata) use
 *   stale-while-revalidate so once loaded, every tool works 100% offline.
 */
const CACHE_NAME = 'openpixel-studio-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // SPA navigation: try fresh network first, fall back to cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    )
    return
  }

  // Static assets, WASM binaries, fonts, OCR models: cache-first with
  // background refresh so offline execution is instant.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)

      return cached || networkFetch
    }),
  )
})
