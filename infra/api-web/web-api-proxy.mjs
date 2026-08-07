import http from 'node:http';
import { pathToFileURL } from 'node:url';

const listenPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_PORT || 3001);
const webPort = Number(process.env.WEB_PORT || 3002);

function targetFor(url) {
  const parsed = new URL(url, 'http://localhost');
  // BFF session route handlers (cookie set/clear) live in Next.js, not the ERP API.
  // Keep /api/auth/* on the web server; the /api/v1/* public-API proxy stays below.
  if (parsed.pathname === '/api/auth' || parsed.pathname.startsWith('/api/auth/')) {
    return { port: webPort, path: `${parsed.pathname}${parsed.search}` };
  }
  if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
    parsed.pathname = parsed.pathname.slice(4) || '/';
    return { port: apiPort, path: `${parsed.pathname}${parsed.search}` };
  }
  if (parsed.pathname === '/v1' || parsed.pathname.startsWith('/v1/') || parsed.pathname.startsWith('/local-storage/')) {
    return { port: apiPort, path: `${parsed.pathname}${parsed.search}` };
  }
  return { port: webPort, path: `${parsed.pathname}${parsed.search}` };
}

export function shouldRenderWebNotFound(method, accept, statusCode) {
  return (method === 'GET' || method === 'HEAD') && statusCode === 404 && accept.includes('text/html');
}

export const server = http.createServer((req, res) => {
  const target = targetFor(req.url || '/');
  // Preserve the public host/proto for upstream URL building (publicApiBase reads x-forwarded-*).
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${target.port}`,
    'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
    'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https',
  };
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: target.port,
      path: target.path,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      // Keep JSON 404s for API clients, but browser navigations should use the branded Next page.
      if (target.port === apiPort && shouldRenderWebNotFound(req.method || 'GET', String(req.headers.accept || ''), upstreamRes.statusCode)) {
        upstreamRes.resume();
        const webRequest = http.request(
          {
            hostname: '127.0.0.1',
            port: webPort,
            path: target.path,
            method: req.method,
            headers: { ...headers, host: `127.0.0.1:${webPort}` },
          },
          (webRes) => {
            res.writeHead(webRes.statusCode || 502, webRes.headers);
            webRes.pipe(res);
          },
        );
        webRequest.on('error', () => {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Upstream unavailable');
        });
        webRequest.end();
        return;
      }
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Upstream unavailable');
  });

  req.pipe(upstream);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`web-api-proxy listening on :${listenPort}`);
  });
}
