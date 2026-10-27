import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('combined web/API proxy 404 handling', () => {
  it('renders the branded page only for browser navigation 404s', async (context) => {
    const api = http.createServer((req, res) => {
      if (req.url === '/v1/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('api-ok');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('api-404');
    });
    const web = http.createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' }).end('branded-404');
    });
    await Promise.all([listen(api), listen(web)]);
    context.after(async () => Promise.all([close(api), close(web)]));

    process.env.API_PORT = String(api.address().port);
    process.env.WEB_PORT = String(web.address().port);
    const { server } = await import(`./web-api-proxy.mjs?test=${Date.now()}`);
    await listen(server);
    context.after(() => close(server));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const browser404 = await fetch(`${origin}/v1/docs`, { headers: { accept: 'text/html' } });
    assert.equal(browser404.status, 404);
    assert.equal(await browser404.text(), 'branded-404');

    const api404 = await fetch(`${origin}/v1/docs`, { headers: { accept: 'application/json' } });
    assert.equal(await api404.text(), 'api-404');

    const existingApi = await fetch(`${origin}/v1/health`, { headers: { accept: 'text/html' } });
    assert.equal(await existingApi.text(), 'api-ok');

    const mutation404 = await fetch(`${origin}/v1/docs`, { method: 'POST', headers: { accept: 'text/html' } });
    assert.equal(await mutation404.text(), 'api-404');
  });
});

describe('combined web/API proxy Halloween draw routing', () => {
  it('forwards only the exact draw pathname to Next with query, body and security headers intact', async (context) => {
    const requests = [];
    const upstream = (name) => http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ upstream: name, method: req.method, url: req.url, body,
        origin: req.headers.origin, forwardedHost: req.headers['x-forwarded-host'],
        cookie: req.headers.cookie, csrf: req.headers['x-csrf-token'] });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ upstream: name }));
    });
    const api = upstream('api'), web = upstream('web');
    await Promise.all([listen(api), listen(web)]);
    context.after(async () => Promise.all([close(api), close(web)]));
    process.env.API_PORT = String(api.address().port);
    process.env.WEB_PORT = String(web.address().port);
    const { server } = await import(`./web-api-proxy.mjs?draw=${Date.now()}`);
    await listen(server);
    context.after(() => close(server));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [path, expected] of [
      ['/api/public/halloween/draw', 'web'],
      ['/api/public/halloween/draw?preview=events&event=halloween', 'web'],
      ['/api/public/halloween/draw/', 'api'],
      ['/api/public/halloween/draw-other', 'api'],
      ['/api/public/home-theme', 'api'],
    ]) {
      const response = await fetch(`${origin}${path}`, { method: 'POST', body: '{}',
        headers: { origin, cookie: 'session=example', 'x-csrf-token': 'example-token' } });
      assert.equal((await response.json()).upstream, expected, path);
      assert.deepEqual(requests.at(-1), { upstream: expected, method: 'POST',
        url: expected === 'web' ? path : path.slice(4), body: '{}', origin,
        forwardedHost: new URL(origin).host, cookie: 'session=example', csrf: 'example-token' });
    }
  });
});

describe('combined web/API proxy global maintenance mode', () => {
  it('keeps login/system onboarding available while blocking every customer business ingress', async (context) => {
    const apiRequests = [];
    const webRequests = [];
    const api = http.createServer((req, res) => {
      apiRequests.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', path: req.url }));
    });
    const web = http.createServer((req, res) => {
      webRequests.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/html' }).end('login-shell-maintenance');
    });
    await Promise.all([listen(api), listen(web)]);
    context.after(async () => Promise.all([close(api), close(web)]));

    process.env.API_PORT = String(api.address().port);
    process.env.WEB_PORT = String(web.address().port);
    process.env.GLOBAL_MAINTENANCE_MODE = 'true';
    process.env.PRODUCTION_SERVING_MODE = 'maintenance_only';
    const { server } = await import(`./web-api-proxy.mjs?maintenance=${Date.now()}`);
    await listen(server);
    context.after(() => {
      delete process.env.GLOBAL_MAINTENANCE_MODE;
      delete process.env.PRODUCTION_SERVING_MODE;
      return close(server);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    const forwarded = [
      ['GET', '/'],
      ['GET', '/login'],
      ['GET', '/privacy'],
      ['GET', '/_next/static/app.js'],
      ['POST', '/api/auth/login'],
      ['GET', '/api/v1/auth/me'],
      ['GET', '/v1/auth/platform-access'],
      ['GET', '/v1/system/platform-access'],
    ];
    for (const [method, path] of forwarded) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: { accept: path.startsWith('/v1') || path.startsWith('/api/v1') ? 'application/json' : 'text/html' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.headers.get('x-mangmee-maintenance'), 'active', `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    }

    const blocked = [
      ['POST', '/api/public/halloween/draw'],
      ['POST', '/api/public/halloween/draw?preview=events&event=halloween'],
      ['POST', '/system/platform-access'],
      ['POST', '/v1/line/webhook'],
      ['POST', '/v1/webhooks/line'],
      ['POST', '/v1/crm/line/webhook/channel-key'],
      ['PUT', '/v1/companies/co-1/expenses/ex-1'],
      ['POST', '/local-storage/upload'],
      ['GET', '/v1/health/'],
      ['GET', '//v1/health'],
      ['GET', '/v1/%68ealth'],
      ['GET', '/api/v1/health'],
    ];
    for (const [method, path] of blocked) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: { accept: path.startsWith('/v1') || path.startsWith('/api') ? 'application/json' : 'text/html' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.headers.get('x-mangmee-maintenance'), 'active', `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.deepEqual(webRequests, [
      'GET /',
      'GET /login',
      'GET /privacy',
      'GET /_next/static/app.js',
      'POST /api/auth/login',
    ]);
    assert.deepEqual(apiRequests, [
      'GET /v1/auth/me',
      'GET /v1/auth/platform-access',
      'GET /v1/system/platform-access',
    ]);

    for (const path of ['/v1/health?probe=1', '/v1/internal/health/readiness']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.headers.get('x-mangmee-maintenance'), null);
      assert.equal((await response.json()).status, 'ok');
    }
    assert.deepEqual(apiRequests.slice(-2), [
      'GET /v1/health?probe=1',
      'GET /v1/internal/health/readiness',
    ]);

    const head = await fetch(`${origin}/login`, { method: 'HEAD' });
    assert.equal(head.headers.get('x-mangmee-maintenance'), 'active');
    assert.equal(await head.text(), '');
    assert.equal(webRequests.at(-1), 'HEAD /login');
  });

  it('rejects a malformed maintenance setting instead of failing open', async () => {
    process.env.GLOBAL_MAINTENANCE_MODE = 'TRUE';
    process.env.PRODUCTION_SERVING_MODE = 'maintenance_only';
    try {
      await assert.rejects(
        import(`./web-api-proxy.mjs?invalid-maintenance=${Date.now()}`),
        /GLOBAL_MAINTENANCE_MODE must be exactly true or false/,
      );
    } finally {
      delete process.env.GLOBAL_MAINTENANCE_MODE;
      delete process.env.PRODUCTION_SERVING_MODE;
    }
  });

  it('rejects a missing or contradictory canonical production serving mode', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      delete process.env.PRODUCTION_SERVING_MODE;
      process.env.GLOBAL_MAINTENANCE_MODE = 'true';
      await assert.rejects(
        import(`./web-api-proxy.mjs?missing-serving-mode=${Date.now()}`),
        /PRODUCTION_SERVING_MODE must be exactly maintenance_only or live/,
      );

      process.env.PRODUCTION_SERVING_MODE = 'live';
      await assert.rejects(
        import(`./web-api-proxy.mjs?contradictory-serving-mode=${Date.now()}`),
        /GLOBAL_MAINTENANCE_MODE must match PRODUCTION_SERVING_MODE/,
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      delete process.env.GLOBAL_MAINTENANCE_MODE;
      delete process.env.PRODUCTION_SERVING_MODE;
    }
  });
});
