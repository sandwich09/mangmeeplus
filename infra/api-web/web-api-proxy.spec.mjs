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
