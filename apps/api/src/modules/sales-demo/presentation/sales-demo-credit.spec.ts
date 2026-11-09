import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SalesDemoService } from '../application/sales-demo.service';
import { SalesDemoLinksController } from './sales-demo.controller';
import { PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';

it('mint defaults to 50, persists product units and validates integer bounds 1–300', async () => {
  const saved: any[] = [];
  const tx: any = { salesDemoLink: { create: async ({ data }: any) => { saved.push(data); return { id: 'link' }; } }, auditLog: { create: async () => {} } };
  const service = new SalesDemoService({ client: { $transaction: async (run: any) => run(tx) } } as any, { webBaseUrl: 'https://app.test' } as any,
    { consume: async () => ({ allowed: true }) } as any, {} as any, {} as any);
  const controller = new SalesDemoLinksController(service), req = { context: { companyId: PLATFORM_TENANT_ID, userId: 'sales', requestId: 'req' } } as any;
  assert.equal((await controller.mint({}, req)).aiCredit, 50); assert.equal(saved[0].aiCreditUnits, 50);
  // The ValidationPipe's DTO instance carries `aiCredit: undefined` when the field was not sent.
  assert.equal((await controller.mint({ aiCredit: undefined }, req)).aiCredit, 50);
  for (const value of [1, 300]) assert.equal((await controller.mint({ aiCredit: value }, req)).aiCredit, value);
  for (const value of [0, 301, -1, 1.1, '80', null, NaN, Infinity]) {
    assert.throws(() => controller.mint({ aiCredit: value } as any, req), (e: any) => e.getStatus() === 400);
    await assert.rejects(service.mint(req.context, value as any), (e: any) => e.getStatus() === 400);
  }
  assert.throws(() => controller.mint({ aiCredit: 80, companyId: 'other' } as any, req));
  assert.equal(saved.length, 4);
});

// Owner 2026-11-09 (spec §11): the edit body is checked by hand so a typo refuses instead of saving nothing.
it('demo link edits accept only credit 1–300, reads 1–50 and expiry 10 minutes to 30 days ahead', () => {
  const { validateUpdate } = require('../application/demo-link-manage');
  const now = new Date('2026-11-09T12:00:00Z');
  assert.deepEqual(validateUpdate({ aiCredit: 120, readLimit: 8 }, now), { aiCredit: 120, readLimit: 8 });
  assert.equal(validateUpdate({ expiresAt: '2026-11-16T12:00:00Z' }, now).expiresAt.toISOString(), '2026-11-16T12:00:00.000Z');
  for (const body of [{}, { aiCredit: 0 }, { aiCredit: 301 }, { readLimit: 51 }, { readLimit: 1.5 }, { aiCredits: 10 },
    { expiresAt: '2026-11-09T12:05:00Z' }, { expiresAt: '2026-12-10T12:00:00Z' }, { expiresAt: 'soon' }, null, []]) {
    assert.throws(() => validateUpdate(body, now), (e: any) => e.getStatus() === 400, JSON.stringify(body));
  }
});
