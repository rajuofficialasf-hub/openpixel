// Local forward proxy for Playwright: the VM egress proxy demands preemptive
// Proxy-Authorization (curl sends it from the URL; Chromium waits for a 407
// that never completes the tunnel). This proxy listens on 127.0.0.1:18080,
// adds the auth header itself, and forwards to the VM egress proxy.
// The egress token rotates per exec session, so the upstream + auth are read
// from this process's own env (HTTPS_PROXY) at startup — never hardcode.
// Only CONNECT (HTTPS) is forwarded — the live site is HTTPS-only; stray
// plain-HTTP requests get a fast 204 so they can never crash the proxy.
// Listens on loopback only. Ephemeral (/tmp) — never commit.
import http from 'node:http';
import net from 'node:net';

const upstream = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || '');
if (!upstream.hostname) {
  console.error('no HTTPS_PROXY in env');
  process.exit(1);
}
const UPSTREAM_HOST = upstream.hostname;
const UPSTREAM_PORT = Number(upstream.port) || 3128;
const AUTH =
  'Basic ' +
  Buffer.from(
    `${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`,
  ).toString('base64');
const LISTEN_PORT = 18080;

// One bad request must never kill the proxy mid-run.
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e.message));

const server = http.createServer((req, res) => {
  res.writeHead(204);
  res.end();
});

server.on('connect', (req, socket, _head) => {
  try {
    const up = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
      up.write(
        `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${AUTH}\r\n\r\n`,
      );
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const header = buf.slice(0, idx).toString();
        if (!/^HTTP\/1\.[01] 200/.test(header)) {
          console.error('upstream CONNECT rejected:', header.split('\r\n')[0]);
          socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          up.destroy();
          return;
        }
        up.off('data', onData);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest = buf.slice(idx + 4);
        if (rest.length) socket.write(rest); // first bytes of the tunneled stream
        up.pipe(socket);
        socket.pipe(up);
      };
      up.on('data', onData);
      up.on('error', (e) => {
        console.error('upstream error:', e.message);
        socket.end();
      });
    });
    up.on('error', (e) => {
      console.error('connect error:', e.message);
      socket.end();
    });
    socket.on('error', () => up.destroy());
  } catch (e) {
    console.error('connect handler error:', e.message);
    socket.end();
  }
});

server.listen(LISTEN_PORT, '127.0.0.1', () =>
  console.log(`egress forward proxy listening on 127.0.0.1:${LISTEN_PORT}`),
);
