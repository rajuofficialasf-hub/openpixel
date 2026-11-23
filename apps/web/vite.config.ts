import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serve `/wasm/*.js` directly from `public/wasm/` in dev mode so
 * `import(/* @vite-ignore *\/ '/wasm/openpixel_wasm.js')` does not
 * trip Vite's "files in /public cannot be imported" transform error.
 */
function servePublicWasm(): Plugin {
  return {
    name: 'serve-public-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = req.url?.split('?')[0]
        if (cleanUrl && cleanUrl.startsWith('/wasm/') && cleanUrl.endsWith('.js')) {
          const filePath = path.resolve(server.config.publicDir, cleanUrl.slice(1))
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            fs.createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [servePublicWasm(), react()],
})
