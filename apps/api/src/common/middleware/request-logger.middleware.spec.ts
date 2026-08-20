/**
 * L-09: REQUEST_LOG_ENABLED was parsed by the config layer and silently ignored here, so the
 * flag could not actually turn per-request logging off.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';
import type { AppLogger } from '../logger/logger.service';
import { RequestLoggerMiddleware } from './request-logger.middleware';

function run(requestLogEnabled: boolean, path = '/v1/companies') {
  const lines: Array<Record<string, unknown>> = [];
  const logger = {
    info: (obj: Record<string, unknown>) => void lines.push(obj),
    warn: (obj: Record<string, unknown>) => void lines.push(obj),
    error: (obj: Record<string, unknown>) => void lines.push(obj),
  } as unknown as AppLogger;
  const middleware = new RequestLoggerMiddleware(logger, { requestLogEnabled } as AppConfigService);

  let finish: (() => void) | undefined;
  const req = { method: 'GET', path, headers: { 'x-request-id': 'req-1' } } as unknown as Request;
  const res = { statusCode: 200, on: (event: string, cb: () => void) => { if (event === 'finish') finish = cb; } } as unknown as Response;

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
  });

  it('logs nothing — and still calls next — when REQUEST_LOG_ENABLED is false', () => {
    const { lines, nextCalls } = run(false);
    assert.equal(nextCalls, 1, 'disabling request logging must never drop the request');
    assert.equal(lines.length, 0);
  });

  // FIX-1: `/document-delivery/{token}` carries a bearer credential in the URL, and the shared
  // redactor only ever inspects KEY names — a plain-text path log hands every log reader the document.
  it('masks a delivery token out of the logged path and leaves every other path alone', () => {
    const masked = run(true, `/v1/document-delivery/${'A'.repeat(43)}`);
    assert.equal(masked.lines[0]?.['path'], '/v1/document-delivery/:token');

    assert.equal(run(true).lines[0]?.['path'], '/v1/companies');
    assert.equal(
      run(true, '/v1/companies/c1/expenses/e1').lines[0]?.['path'],
      '/v1/companies/c1/expenses/e1',
    );
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
