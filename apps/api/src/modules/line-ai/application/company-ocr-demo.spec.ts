import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { admitCompanyOcr, companyOcrErrorCode } from './company-ocr-governance';

it('DEMO admissions serialize at three lifetime reads across web/LINE and a month boundary', async () => {
  let tail = Promise.resolve(), count = 0; const locks: string[] = [];
  const db: any = {
    $executeRaw: async (_sql: any, key: string) => { locks.push(key); },
    company: { findUnique: async () => ({ reportClassification: 'DEMO', status: 'ACTIVE' }) },
    companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: true, ocrMonthlyLimit: 3 }) },
    companyOcrUsageEvent: { findUnique: async () => null, count: async () => count, create: async () => ({ id: `read-${++count}` }) },
    companyOcrMonthlyUsage: { findUnique: async () => ({ usedCount: 0 }), upsert: async () => ({ usedCount: count }) },
    companyPlanTerm: { findUnique: async () => null },
  };
  db.$transaction = (run: any) => { const next = tail.then(() => run(db)); tail = next.catch(() => undefined); return next; };
  const outcomes = await Promise.all(['receipt-ocr-web', 'receipt-ocr-line', 'receipt-capture-web', 'receipt-capture-line'].map((sourceRoute, index) => admitCompanyOcr({ client: db } as any,
    { companyId: 'demo', sourceRoute: sourceRoute as any, requestId: `request-${index}`, monthKey: index < 2 ? '2026-11' : '2026-12' })));
  assert.equal(outcomes.filter(result => result.allowed).length, 3); assert.equal(count, 3);
  const refused = outcomes[3]; assert.equal(refused.allowed, false);
  if (refused.allowed) assert.fail();
  assert.equal(companyOcrErrorCode(refused), 'demo_read_limit_reached');
  assert.equal(locks.filter(key => key === 'partner-ocr-config:demo').length, 4);
});
it('ordinary OCR monthly refusals keep their existing error code', () => {
  assert.equal(companyOcrErrorCode({ allowed: false, reason: 'exceeded', usedCount: 3, monthlyLimit: 3 }), 'OCR_MONTHLY_LIMIT_EXCEEDED');
});
