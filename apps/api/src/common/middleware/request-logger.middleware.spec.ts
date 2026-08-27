/**
 * L-09: REQUEST_LOG_ENABLED was parsed by the config layer and silently ignored here, so the
 * flag could not actually turn per-request logging off.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';
import type { AppLogger } from '../logger/logger.service';
import { apiCacheControl, PRIVATE_NO_STORE } from './api-cache-control.middleware';
import {
  MAX_INBOUND_REQUEST_ID_BYTES,
  normalizeRequestId,
  RequestIdMiddleware,
} from './request-id.middleware';
import { RequestLoggerMiddleware } from './request-logger.middleware';

function run(requestLogEnabled: boolean, path = '/v1/companies', statusCode = 200) {
  const lines: Array<Record<string, unknown>> = [];
  const capture = (obj: Record<string, unknown>, msg?: string) => void lines.push({ ...obj, ...(msg ? { msg } : {}) });
  const logger = {
    info: capture,
    warn: capture,
    error: capture,
  } as unknown as AppLogger;
  const middleware = new RequestLoggerMiddleware(logger, { requestLogEnabled } as AppConfigService);

  let finish: (() => void) | undefined;
  const req = { method: 'GET', path, headers: { 'x-request-id': 'req-1' } } as unknown as Request;
  const res = { statusCode, on: (event: string, cb: () => void) => { if (event === 'finish') finish = cb; } } as unknown as Response;

  let nextCalls = 0;
  middleware.use(req, res, (() => { nextCalls += 1; }) as NextFunction);
  finish?.();
  return { lines, nextCalls, res };
}

describe('RequestLoggerMiddleware', () => {
  it('logs one line per request when REQUEST_LOG_ENABLED is true', () => {
    const { lines, nextCalls } = run(true);
    assert.equal(nextCalls, 1, 'the request must always continue');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.['requestId'], 'req-1');
    assert.equal(lines[0]?.['status'], 200);
    assert.equal(lines[0]?.['msg'], 'request');
    const durationMs = lines[0]?.['durationMs'];
    assert.ok(typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0);
  });

  it('logs nothing — and still calls next — when REQUEST_LOG_ENABLED is false', () => {
    const { lines, nextCalls } = run(false);
    assert.equal(nextCalls, 1, 'disabling request logging must never drop the request');
    assert.equal(lines.length, 0);
  });

  it('logs the request path verbatim', () => {
    assert.equal(run(true).lines[0]?.['path'], '/v1/companies');
    assert.equal(
      run(true, '/v1/companies/c1/expenses/e1').lines[0]?.['path'],
      '/v1/companies/c1/expenses/e1',
    );
  });

  it('captures a 500 response for the API alarm', () => {
    const { lines } = run(true, '/v1/health/dependency', 500);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.['status'], 500);
    assert.equal(lines[0]?.['msg'], 'request');
  });

  it('does not even register a finish listener when disabled', () => {
    const listeners: string[] = [];
    const logger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as AppLogger;
    const middleware = new RequestLoggerMiddleware(logger, { requestLogEnabled: false } as AppConfigService);
    middleware.use(
      { method: 'GET', path: '/', headers: {} } as unknown as Request,
      { statusCode: 200, on: (event: string) => void listeners.push(event) } as unknown as Response,
      (() => {}) as NextFunction,
    );
    assert.deepEqual(listeners, []);
  });
});

describe('RequestIdMiddleware', () => {
  it('preserves a bounded caller id so transport retries share one OCR fence', () => {
    const req = { headers: { 'x-request-id': 'ocr-attempt-1' } } as unknown as Request;
    const headers = new Map<string, string>();
    let nextCalls = 0;
    const res = {
      setHeader: (name: string, value: string) => { headers.set(name, value); },
    } as unknown as Response;

    new RequestIdMiddleware().use(req, res, (() => { nextCalls += 1; }) as NextFunction);

    assert.equal(req.headers['x-request-id'], 'ocr-attempt-1');
    assert.equal(headers.get('X-Request-Id'), 'ocr-attempt-1');
    assert.equal(nextCalls, 1);
  });

  it('hashes an oversized id deterministically instead of risking a btree write failure', () => {
    const oversized = 'ก'.repeat(MAX_INBOUND_REQUEST_ID_BYTES);
    const first = normalizeRequestId(oversized);
    const retry = normalizeRequestId(oversized);

    assert.equal(first, retry);
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Buffer.byteLength(first, 'utf8') <= MAX_INBOUND_REQUEST_ID_BYTES);
  });

  it('mints a UUID when the header is absent or blank', () => {
    assert.match(normalizeRequestId(undefined), /^[0-9a-f-]{36}$/);
    assert.match(normalizeRequestId('   '), /^[0-9a-f-]{36}$/);
  });
});

describe('ApiCacheControlMiddleware', () => {
  function runCacheControl(initial?: string) {
    const headers = new Map<string, string>();
    if (initial) headers.set('cache-control', initial);
    const response = {
      hasHeader: (name: string) => headers.has(name.toLowerCase()),
      setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
    } as unknown as Response;
    let nextCalls = 0;

    apiCacheControl(
      {} as Request,
      response,
      (() => { nextCalls += 1; }) as NextFunction,
    );

    return { cacheControl: headers.get('cache-control'), nextCalls };
  }

  it('makes API responses private and non-storable by default', () => {
    assert.deepEqual(runCacheControl(), { cacheControl: PRIVATE_NO_STORE, nextCalls: 1 });
  });

  it('preserves an explicit route cache policy', () => {
    assert.deepEqual(runCacheControl('public, max-age=60'), { cacheControl: 'public, max-age=60', nextCalls: 1 });
  });
});
