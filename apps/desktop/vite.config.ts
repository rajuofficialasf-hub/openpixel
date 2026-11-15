import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri dev server must stay on 1420 (see src-tauri/tauri.conf.json
// devUrl); strictPort fails loudly instead of silently moving ports.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
