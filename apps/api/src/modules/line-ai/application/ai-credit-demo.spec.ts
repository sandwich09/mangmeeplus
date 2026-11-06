import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUDGET_REFUSAL_CODES, DEMO_CREDIT_EXHAUSTED_TEXT, DEMO_CREDIT_INSUFFICIENT_TEXT } from '@watchdog-bms/contracts';
import { planAiCreditFunding, readAiCreditBalance, applyAiCreditGrant } from './ai-credit-ledger';
import { buildAiBudgetExceededMessage } from '../domain/logic/line-business-card.logic';

const at = new Date('2026-11-06T00:00:00Z');
function world(classification: string, spent = 0) {
  const lot = { id: 'sales', sourceKind: 'SALES_EVENT', units: 8000, availableAt: at, expiresAt: new Date('2027-11-06'), revokedAt: null };
  return { company: { findUnique: async () => ({ reportClassification: classification }) },
    companyPlanTerm: { findUnique: async () => null },
    aiCreditGrant: { findMany: async () => [lot], findFirst: async () => assert.fail('DEMO cannot use a pinned package lot') },
    aiCreditEntry: { groupBy: async () => spent ? [{ grantId: 'sales', kind: 'CONSUME', _sum: { units: -spent } }] : [] },
    aiBudgetReservation: { findMany: async () => [] } };
}
const input = { companyId: 'demo', units: 100, asOf: at, now: at, allowance: () => ({ units: 8000, source: 'DEFAULT' as const }) };
it('DEMO uses only SALES_EVENT credit without a package cycle, even with a pinned package key', async () => {
  const db = world('DEMO');
  assert.deepEqual(await planAiCreditFunding(db, input), { ok: true, cycleKey: 'demo:demo', allocations: [{ grantId: 'sales', units: 100 }] });
  assert.deepEqual(await planAiCreditFunding(db, { ...input, pinnedCycleKey: 'other-package' }), await planAiCreditFunding(db, input));
  const balance = await readAiCreditBalance(db, { ...input, at });
  assert.equal(balance.cycle, null); assert.equal(balance.packageRemainingUnits, 0); assert.equal(balance.totalRemainingUnits, 8000);
});
it('non-DEMO still requires a package even with a SALES_EVENT lot', async () => {
  for (const type of ['CUSTOMER', 'TEST', 'INTERNAL']) assert.deepEqual(await planAiCreditFunding(world(type), input), { ok: false, cause: 'PACKAGE_REQUIRED', availableUnits: 0 });
});
it('spent and insufficient DEMO lots refuse with the specified Thai wording and signup URI', async () => {
  assert.deepEqual(await planAiCreditFunding(world('DEMO', 8000), input), { ok: false, cause: 'EXHAUSTED', availableUnits: 0 });
  assert.deepEqual(await planAiCreditFunding(world('DEMO', 7950), input), { ok: false, cause: 'INSUFFICIENT', availableUnits: 50 });
  const reply = buildAiBudgetExceededMessage(false, { budgetScope: 'CHAT' }, true, 'th', 'https://app.test/base', true);
  assert.equal(reply.type, 'text'); assert.equal((reply as any).text, DEMO_CREDIT_EXHAUSTED_TEXT);
  assert.deepEqual(reply.quickReply?.items[0].action, { type: 'uri', label: 'เปิดร้านจริงฟรี', uri: 'https://app.test/' });
  const short = buildAiBudgetExceededMessage(false, { budgetScope: 'CHAT', budgetErrorCode: AI_BUDGET_REFUSAL_CODES.insufficient }, true, 'th', 'https://app.test/base', true);
  assert.equal((short as any).text, DEMO_CREDIT_INSUFFICIENT_TEXT);
});
it('sales grant is exact, idempotent and refuses changed source data', async () => {
  let saved: any;
  const db = { aiCreditGrant: { findUnique: async () => saved, create: async ({ data }: any) => saved = { id: 'lot', ...data } } };
  const grant = { companyId: 'demo', billingAccountId: null, sourceKind: 'SALES_EVENT' as const, sourceKey: 'sales-demo:link', sourceHash: 'hash', units: 8000, at };
  assert.equal((await applyAiCreditGrant(db, grant)).units, 8000);
  assert.equal((await applyAiCreditGrant(db, grant)).replayed, true);
  await assert.rejects(applyAiCreditGrant(db, { ...grant, sourceHash: 'changed' }), /source_changed/);
});
