import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (no webfont CDN — the site stays self-contained):
// Inter for Latin, Noto Sans Bengali for Bangla. Latin subsets only
// for Inter; Bengali subsets only for Noto Sans Bengali.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/noto-sans-bengali/bengali-400.css'
import '@fontsource/noto-sans-bengali/bengali-500.css'
import '@fontsource/noto-sans-bengali/bengali-600.css'
import '@fontsource/noto-sans-bengali/bengali-700.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the offline PWA service worker in production builds only so
// Vite dev HMR stays completely uncached and instant.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
