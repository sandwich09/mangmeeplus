/**
 * L-07: gateway copy of the constant-time internal-secret compare.
 * Byte-identity with the API copy is asserted by
 * `apps/api/src/common/security/secret-compare.spec.ts`; this spec covers behaviour.
 */
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, request, ServerResponse, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type ErrorRequestHandler } from 'express';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { gatewayHttpMiddleware } from '../http/gateway-http.middleware';
import type { ProductionServingMode } from '../http/production-maintenance.middleware';
import type { AppLogger } from '../logger/logger.service';
import { DOCUMENT_QA_MEDIA_ROUTE } from '../../modules/line-ai/presentation/http/line-ai-internal.controller';
import { assertInternalSecret, timingSafeStringEqual } from './internal-secret';

describe('assertInternalSecret', () => {
  it('throws when the expected secret is not configured (fail-closed)', () => {
    assert.throws(() => assertInternalSecret('anything', undefined), UnauthorizedException);
    assert.throws(() => assertInternalSecret('anything', ''), UnauthorizedException);
  });

  it('throws when the provided secret is missing or empty', () => {
    assert.throws(() => assertInternalSecret(undefined, 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('', 'expected'), UnauthorizedException);
  });

  it('throws on a mismatch at the same byte length', () => {
    assert.throws(() => assertInternalSecret('expectee', 'expected'), UnauthorizedException);
  });

  it('throws on a mismatch at a different byte length', () => {
    assert.throws(() => assertInternalSecret('wrong', 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('wrong-but-longer', 'expected'), UnauthorizedException);
  });

  it('does not throw when the secret matches', () => {
    assert.doesNotThrow(() => assertInternalSecret('expected', 'expected'));
  });
});

describe('timingSafeStringEqual', () => {
  it('accepts equal strings', () => {
    assert.equal(timingSafeStringEqual('shared-secret', 'shared-secret'), true);
  });

  it('rejects unequal strings of the same byte length', () => {
    assert.equal(timingSafeStringEqual('shared-secret', 'shored-secret'), false);
  });

  it('rejects unequal strings of different byte lengths', () => {
    assert.equal(timingSafeStringEqual('short', 'a-much-longer-secret'), false);
    assert.equal(timingSafeStringEqual('a-much-longer-secret', 'short'), false);
    assert.equal(timingSafeStringEqual('ก', 'a'), false);
  });

  it('handles an empty expected value and an empty supplied value', () => {
    assert.equal(timingSafeStringEqual('supplied', ''), false);
    assert.equal(timingSafeStringEqual('', 'expected'), false);
    assert.equal(timingSafeStringEqual('', ''), true, 'the caller, not the compare, rejects empties');
  });
});

// Real HTTP requests exercise the production middleware order, including incomplete uploads.
function createGateway(config: { secret?: string } = { secret: 'expected' }, mode: ProductionServingMode = 'live') {
  const expected = config.secret;
  const app = express();
  const observations: Array<{ body: unknown; bodyRead: boolean }> = [];
  app.use((req, res, next) => {
    res.once('prefinish', () => observations.push({ body: req.body, bodyRead: req.readableDidRead }));
    next();
  });
  app.use(gatewayHttpMiddleware({ isProduction: false, bodyLimit: '1mb', aiGatewayInternalSecret: expected }, mode));
  app.get('/v1/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/controller-rejection', () => { assertInternalSecret(undefined, expected); });
  app.use((req, res) => {
    if (req.path.startsWith('/v1/internal/')) assertInternalSecret(req.get('x-internal-secret'), expected);
    res.json({ body: req.body ?? null });
  });
  const filter = new AllExceptionsFilter({ error() {} } as unknown as AppLogger, new ExpressAdapter(app));
  app.use(((error, req, res, _next) => {
    filter.catch(error, new ExecutionContextHost([req, res]));
  }) as ErrorRequestHandler);
  return { app, observations };
}

async function startGateway(t: TestContext, config: { secret?: string } = { secret: 'expected' }, mode: ProductionServingMode = 'live') {
  const { app, observations } = createGateway(config, mode);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const { port } = server.address() as AddressInfo;
  return {
    observations,
    send(path: string, options: { body?: string; headers?: OutgoingHttpHeaders; incomplete?: boolean; method?: string } = {}) {
      return new Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: unknown }>((resolve, reject) => {
        const outgoing = request({
          host: '127.0.0.1', port, path, method: options.method ?? 'POST', agent: false,
          headers: { 'content-type': 'application/json', connection: 'keep-alive', ...options.headers },
        }, (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => { body += chunk; });
          incoming.on('error', reject);
          incoming.on('end', () => {
            outgoing.destroy();
            resolve({ status: incoming.statusCode, headers: incoming.headers, body: JSON.parse(body) });
          });
        });
        outgoing.on('error', reject);
        outgoing.setTimeout(2_000, () => outgoing.destroy(new Error('Gateway waited for the upload.')));
        if (options.incomplete) {
          outgoing.flushHeaders();
          if (options.body) outgoing.write(options.body);
        } else {
          outgoing.end(options.body);
        }
      });
    },
  };
}

const unauthorizedBody = { message: 'Invalid internal secret.', error: 'Unauthorized', statusCode: 401 };
const authenticated = { 'x-internal-secret': 'expected' };

describe('internal authentication before body parsing', () => {
  it('refuses malformed internal JSON before stream consumption without a listener', async () => {
    const { app, observations } = createGateway();
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    const req = new IncomingMessage(socket as Socket);
    req.method = 'POST';
    req.url = '/v1/internal/ai/receipt-ocr';
    req.headers = { 'content-type': 'application/json', 'content-length': '1' };
    const res = new ServerResponse(req);
    res.assignSocket(socket as Socket);
    await new Promise<void>((resolve, reject) => {
      res.once('finish', resolve);
      socket.once('error', reject);
      app(req, res);
      req.push(Buffer.from('{'));
      req.push(null);
    });
    socket.destroy();
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString().split('\r\n\r\n')[1]), unauthorizedBody);
    assert.equal(res.getHeader('connection'), 'close');
    assert.deepEqual(observations, [{ body: undefined, bodyRead: false }]);
  });

  it('rejects missing secrets before malformed JSON is read', async (t) => {
    const gateway = await startGateway(t);
    const result = await gateway.send('/v1/internal/ai/receipt-ocr', { body: '{' });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, unauthorizedBody);
    assert.equal(result.headers.connection, 'close');
    assert.deepEqual(gateway.observations, [{ body: undefined, bodyRead: false }]);
  });

  it('rejects an anonymous document-QA upload over 96 MB without waiting for its body', async (t) => {
    const gateway = await startGateway(t);
    const result = await gateway.send(DOCUMENT_QA_MEDIA_ROUTE, {
      headers: { 'content-length': 96 * 1024 * 1024 + 1 }, incomplete: true,
    });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, unauthorizedBody);
    assert.equal(result.headers.connection, 'close');
    assert.deepEqual(gateway.observations, [{ body: undefined, bodyRead: false }]);
  });

  it('rejects an unfinished anonymous chunked upload without reading its chunks', async (t) => {
    const gateway = await startGateway(t);
    const result = await gateway.send('/v1/internal/ai/receipt-ocr', {
      headers: { 'transfer-encoding': 'chunked' }, body: '{', incomplete: true,
    });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, unauthorizedBody);
    assert.equal(result.headers.connection, 'close');
    assert.deepEqual(gateway.observations, [{ body: undefined, bodyRead: false }]);
  });

  it('returns the controller/filter 401 JSON for both missing and wrong secrets', async (t) => {
    const gateway = await startGateway(t);
    const controller = await gateway.send('/controller-rejection', { method: 'GET' });
    assert.equal(controller.status, 401);
    assert.deepEqual(controller.body, unauthorizedBody);
    for (const headers of [{}, { 'x-internal-secret': 'wrong' }]) {
      const result = await gateway.send('/v1/internal/ai/receipt-ocr', { headers, body: '{}' });
      assert.equal(result.status, controller.status);
      assert.deepEqual(result.body, controller.body);
      assert.equal(result.headers.connection, 'close');
      assert.deepEqual(gateway.observations.at(-1), { body: undefined, bodyRead: false });
    }
  });

  it('preserves authenticated JSON parsing and its malformed-body 400', async (t) => {
    const gateway = await startGateway(t);
    const malformed = await gateway.send('/v1/internal/ai/receipt-ocr', { headers: authenticated, body: '{' });
    assert.equal(malformed.status, 400);
    const valid = await gateway.send('/v1/internal/ai/receipt-ocr', { headers: authenticated, body: '{"ok":true}' });
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body, { body: { ok: true } });
  });

  it('leaves health and paths outside the internal prefix unchanged', async (t) => {
    const gateway = await startGateway(t);
    const health = await gateway.send('/v1/health', { method: 'GET' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });
    for (const path of ['/outside', '/v1/internal-other']) {
      const valid = await gateway.send(path, { body: '{"ok":true}' });
      assert.equal(valid.status, 200);
      assert.deepEqual(valid.body, { body: { ok: true } });
      assert.equal((await gateway.send(path, { body: '{' })).status, 400);
    }
  });

  it('fails closed on all internal route families when the configured secret is absent or empty', async (t) => {
    for (const expected of [undefined, '']) {
      const gateway = await startGateway(t, { secret: expected });
      for (const path of ['/v1/internal/ai/receipt-ocr', DOCUMENT_QA_MEDIA_ROUTE, '/v1/internal/ai/line-turn', '/v1/internal/future/route', '/V1/INTERNAL/ai/receipt-ocr']) {
        const result = await gateway.send(path, { headers: authenticated, body: '{' });
        assert.equal(result.status, 401);
        assert.deepEqual(result.body, unauthorizedBody);
        assert.deepEqual(gateway.observations.at(-1), { body: undefined, bodyRead: false });
      }
    }
  });

  it('keeps maintenance ahead of internal authentication and every parser', async (t) => {
    const gateway = await startGateway(t, { secret: 'expected' }, 'maintenance_only');
    const result = await gateway.send('/v1/internal/ai/receipt-ocr', { body: '{' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { statusCode: 200, code: 'global_maintenance', message: 'Service temporarily unavailable.' });
    assert.equal(result.headers['x-mangmee-maintenance'], 'active');
    assert.equal((await gateway.send('/v1/health', { method: 'GET' })).status, 200);
  });

  it('preserves the global, 16 MB media and 96 MB document-QA parser limits', async (t) => {
    const gateway = await startGateway(t);
    const aboveGlobal = ' '.repeat(1024 * 1024) + '{}';
    for (const route of ['receipt-ocr', 'bank-statement-extract', 'line-intake-route', 'capture-read', 'capture-extract', 'line-document-qa']) {
      const result = await gateway.send(`/v1/internal/ai/${route}`, { headers: authenticated, body: aboveGlobal });
      assert.equal(result.status, 200, route);
      assert.deepEqual(result.body, { body: {} });
    }
    for (const route of ['line-turn', 'receipt-ocr-extra']) {
      const result = await gateway.send(`/v1/internal/ai/${route}`, { headers: authenticated, body: aboveGlobal });
      assert.equal(result.status, 413, route);
    }
    const aboveMedia = ' '.repeat(16 * 1024 * 1024) + '{}';
    assert.equal((await gateway.send('/v1/internal/ai/receipt-ocr', { headers: authenticated, body: aboveMedia })).status, 413);
    assert.equal((await gateway.send(DOCUMENT_QA_MEDIA_ROUTE, { headers: authenticated, body: aboveMedia })).status, 200);
    const aboveDocument = ' '.repeat(96 * 1024 * 1024) + '{}';
    assert.equal((await gateway.send(DOCUMENT_QA_MEDIA_ROUTE, { headers: authenticated, body: aboveDocument })).status, 413);
  });
});
