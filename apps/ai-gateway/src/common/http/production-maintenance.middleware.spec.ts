import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { parseProductionServingMode, productionMaintenanceMiddleware } from './production-maintenance.middleware';

function request(method: string, url: string): { req: Request; resumed: () => boolean } {
  let didResume = false;
  return {
    req: { method, originalUrl: url, url, resume: () => { didResume = true; } } as unknown as Request,
    resumed: () => didResume,
  };
}

function response(): { res: Response; state: { body?: string; headers: Record<string, string>; status?: number } } {
  const state: { body?: string; headers: Record<string, string>; status?: number } = { headers: {} };
  const res = {
    set statusCode(value: number) { state.status = value; },
    get statusCode() { return state.status ?? 0; },
    setHeader(name: string, value: string | number) { state.headers[name.toLowerCase()] = String(value); },
    end(body?: string) { state.body = body; },
  } as unknown as Response;
  return { res, state };
}

describe('AI gateway production maintenance middleware', () => {
  it('parses the controller-owned serving mode strictly', () => {
    assert.equal(parseProductionServingMode('maintenance_only', true), 'maintenance_only');
    assert.equal(parseProductionServingMode('live', true), 'live');
    assert.equal(parseProductionServingMode(undefined, false), 'live');
    assert.throws(() => parseProductionServingMode(undefined, true), /must be exactly/);
    assert.throws(() => parseProductionServingMode('true', true), /must be exactly/);
  });

  it('stops business requests before body parsing and lets only exact health through', () => {
    const middleware = productionMaintenanceMiddleware('maintenance_only');
    for (const [method, url] of [
      ['POST', '/v1/internal/ai/receipt-ocr'],
      ['POST', '/v1/internal/line-ai/turn'],
      ['GET', '/docs'],
      ['GET', '/v1/health/'],
      ['GET', '/v1/%68ealth'],
    ]) {
      const incoming = request(method, url);
      const outgoing = response();
      let nextCalled = false;
      middleware(incoming.req, outgoing.res, (() => { nextCalled = true; }) as NextFunction);
      assert.equal(nextCalled, false, `${method} ${url}`);
      assert.equal(incoming.resumed(), true, `${method} ${url}`);
      assert.equal(outgoing.state.status, 200, `${method} ${url}`);
      assert.equal(outgoing.state.headers['x-mangmee-maintenance'], 'active');
      assert.match(outgoing.state.body ?? '', /global_maintenance/);
    }

    for (const method of ['GET', 'HEAD']) {
      const incoming = request(method, '/v1/health?probe=1');
      const outgoing = response();
      let nextCalled = false;
      middleware(incoming.req, outgoing.res, (() => { nextCalled = true; }) as NextFunction);
      assert.equal(nextCalled, true);
      assert.equal(incoming.resumed(), false);
      assert.equal(outgoing.state.status, undefined);
    }
  });
});
