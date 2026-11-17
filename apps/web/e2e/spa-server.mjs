// Static server with SPA fallback, for the e2e suites.
//
// python3 -m http.server 404s deep links (/pdf, /formats, ...), so any
// suite that reloads or deep-links must use this instead — the app is
// a single-page app and every path serves index.html, the same rule
// public/_redirects gives Cloudflare Pages.
//
// Run directly (keeps serving until killed):
//   node apps/web/e2e/spa-server.mjs [port] [dist-dir]
//   # defaults: port 8321, apps/web/dist
//
// Or import it (routing-e2e.mjs does this — it needs its own server
// on 8325 because it tests deep links):
//   import { startSpaServer } from './spa-server.mjs'
//   const server = await startSpaServer({ dist, port })
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

export function startSpaServer({ dist, port, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);
    let file = path.join(dist, urlPath);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2] || 8321);
  const dist = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  await startSpaServer({ dist, port });
  console.log(`SPA server: ${dist} on http://127.0.0.1:${port}`);
}
