import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingGetPackageUsageTool, PACKAGE_MANAGER_REQUIRED } from './erp-package-tools.use-case';
import { lineReadResultHash } from '../line-read-evidence.service';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../../../system-partner-management/application/plan-term-limit';

// 10:00 Bangkok on 2026-09-28.
const NOW = new Date('2026-09-28T03:00:00.000Z');
const MANAGER = { companyId: 'c1', userId: 'u1', membershipId: 'm1', permissions: ['ai.tool.invoke', 'company.plan.manage'], locale: 'th' } as any;

type Usage = Record<string, unknown>;
function fakes(options: { term?: Record<string, unknown> | null; usage: Usage; lots?: Array<Record<string, unknown>>; account?: Record<string, unknown> | null }) {
  const calls: string[] = [];
  const prisma = { client: {
    companyPlanTerm: { findUnique: async () => { calls.push('term'); return options.term === undefined ? TERM : options.term; } },
    // The plan-limit counts (planCapacityUsed): the same where-clauses the create gates enforce.
    branch: { count: async (args: any) => { calls.push('branches'); assert.deepEqual(args.where, { companyId: 'c1', status: 'ACTIVE' }); return 4; } },
    companyMembership: { count: async (args: any) => { calls.push('members');
      assert.deepEqual(args.where, { companyId: 'c1', status: 'ACTIVE', roles: { none: { role: PLATFORM_SEAT_EXEMPT_ROLE } } }); return 3; } },
    billingReceiptGrant: { findMany: async () => { calls.push('lots'); return options.lots ?? []; } },
  } };
  const billing = {
    usage: async (companyId: string) => { calls.push('usage'); assert.equal(companyId, 'c1'); return options.usage; },
    account: async () => { calls.push('account'); return options.account ?? null; },
  };
  return { tool: new BillingGetPackageUsageTool(prisma as any, billing as any), calls };
}

const TERM = { tierKey: 'PRO_999', branchLimit: 5, employeeLimit: 10, capacityOverride: null, billingReceiptAccountId: 'acct-1',
  termEndsAt: new Date('2026-10-15T03:00:00.000Z'), termDisabledAt: null };
const PAID_USAGE = { used: 70, limit: 100, remaining: 30, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: '2026-10-15T03:00:00.000Z' };
const LOT = { kind: 'RENEWAL', serviceStart: new Date('2026-09-15T03:00:00.000Z'), serviceEnd: new Date('2026-10-15T03:00:00.000Z') };

describe('billing.get_package_usage (advisor spec §5.1)', () => {
  it('refuses a caller who does not manage the package with the typed P8 code, before reading anything', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool, calls } = fakes({ usage: PAID_USAGE });
    const result = await tool.execute({ ...MANAGER, permissions: ['ai.tool.invoke', 'expense.read', 'reimbursement.approve'] });
    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, PACKAGE_MANAGER_REQUIRED);
    assert.equal(result.data, undefined);
    assert.deepEqual(result.sourceRefs, [], 'no package page link for a non-manager');
    assert.deepEqual(calls, []);
  });

  it('answers a paid allowance with its lot period, the projection and the package page link', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool } = fakes({ usage: PAID_USAGE, lots: [LOT, { ...LOT, kind: 'ADD_ON_PAID', serviceStart: new Date('2026-09-20T03:00:00.000Z') }],
      account: { renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub-1', cancelAtPeriodEnd: false, collectionPauseJson: null } });
    const result = await tool.execute(MANAGER);
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, {
      package: { label: 'มืออาชีพ (PRO)', termEndsOn: '2026-10-15', renewal: 'auto' },
      capacity: { branches: { used: 4, limit: 5, remaining: 1 }, members: { used: 3, limit: 10, remaining: 7 } },
      receipts: { used: 70, limit: 100, remaining: 30, cadence: 'paid_period', periodStartOn: '2026-09-15', periodEndsOn: '2026-10-15',
        resetsOn: null, expiresOn: null, additional: null,
        pace: { formula: 'package-pace-v1', projectedUsed: 150, projectedShortfall: 50, daysElapsed: 14, daysLeft: 16, daysInPeriod: 30 },
        paceNote: null },
    }, 'an add-on lot never joins the package period (spec §17.3)');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/billing');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.queryApplied?.accessScope, 'company');
  });

  it('reads the monthly allowance by calendar month, with the reset day the package page prints', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool, calls } = fakes({ term: { ...TERM, tierKey: 'STARTER_249', branchLimit: 1, employeeLimit: 2, billingReceiptAccountId: null },
      usage: { used: 12, limit: 30, remaining: 18, cadence: 'LEGACY_MONTH', resetsAt: '2026-09-30T17:00:00.000Z', expiresAt: null } });
    const receipts = ((await tool.execute(MANAGER)).data as any).receipts;
    assert.equal(receipts.cadence, 'monthly');
    assert.equal(receipts.periodStartOn, '2026-09-01');
    assert.equal(receipts.periodEndsOn, '2026-09-30');
    assert.equal(receipts.resetsOn, '2026-10-01');
    assert.deepEqual(receipts.pace, { formula: 'package-pace-v1', projectedUsed: 13, projectedShortfall: 0, daysElapsed: 28, daysLeft: 2, daysInPeriod: 30 });
    assert.ok(!calls.includes('lots'), 'a monthly allowance reads no paid lot');
  });

  it('gives no projection, only its reason, when paid lots from different periods overlap or it is too early', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const overlap = await fakes({ usage: PAID_USAGE, lots: [LOT, { ...LOT, kind: 'REPEAT', serviceStart: new Date('2026-08-15T03:00:00.000Z') }] }).tool.execute(MANAGER);
    assert.equal((overlap.data as any).receipts.pace, null);
    assert.match((overlap.data as any).receipts.paceNote, /หลายรอบ/);
    assert.equal((overlap.data as any).receipts.periodStartOn, null);
    const early = await fakes({ usage: PAID_USAGE, lots: [{ ...LOT, serviceStart: new Date('2026-09-26T03:00:00.000Z'), serviceEnd: new Date('2026-10-26T03:00:00.000Z') }] }).tool.execute(MANAGER);
    assert.equal((early.data as any).receipts.pace, null);
    assert.match((early.data as any).receipts.paceNote, /ไม่ถึง 7 วัน/);
    const gift = await fakes({ term: { ...TERM, billingReceiptAccountId: null }, usage: { used: 35, limit: 40, remaining: 5, cadence: 'LEGACY_MONTH',
      resetsAt: '2026-09-30T17:00:00.000Z', expiresAt: null, monthlyAllowance: { limit: 30, used: 30, additionalRemaining: 5, additionalExpiresAt: '2026-11-01T03:00:00.000Z' } } }).tool.execute(MANAGER);
    assert.deepEqual((gift.data as any).receipts.additional, { remaining: 5, expiresOn: '2026-11-01' });
    assert.equal((gift.data as any).receipts.pace, null, 'a team gift keeps its own expiry: no single cycle');
  });

  it('names the package from the term tier even during a temporary capacity gift, whose limits it reports', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const capacityOverride = { operationId: '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', accountId: 'acct-1', tierKey: 'ENTERPRISE_1999', branchLimit: 10,
      employeeLimit: 30, effectiveAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-10T00:00:00.000Z' };
    const data = (await fakes({ term: { ...TERM, capacityOverride }, usage: PAID_USAGE, lots: [LOT] }).tool.execute(MANAGER)).data as any;
    assert.equal(data.package.label, 'มืออาชีพ (PRO)');
    assert.deepEqual(data.capacity.branches, { used: 4, limit: 10, remaining: 6 });
  });

  it('carries no price and no other package, and re-reads to the same evidence hash', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool } = fakes({ usage: PAID_USAGE, lots: [LOT] });
    const first = await tool.execute(MANAGER);
    t.mock.timers.tick(90_000);
    const second = await tool.execute(MANAGER);
    const text = JSON.stringify(first.data);
    assert.doesNotMatch(text, /price|satang|amount|baht|บาท/iu);
    for (const other of ['เริ่มต้น', 'เติบโต', 'ธุรกิจ', 'STARTER', 'BASIC', 'ENTERPRISE']) assert.ok(!text.includes(other), other);
    assert.notEqual(first.asOf, second.asOf);
    assert.equal(lineReadResultHash(first), lineReadResultHash(second));
  });

  it('reads the renewal the way the package page does', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const renewal = async (account: Record<string, unknown> | null) =>
      ((await fakes({ usage: PAID_USAGE, lots: [LOT], account }).tool.execute(MANAGER)).data as any).package.renewal;
    assert.equal(await renewal(null), 'none');
    assert.equal(await renewal({ renewalMode: 'PROMPTPAY_ONCE' }), 'one_time');
    assert.equal(await renewal({ renewalMode: 'NONE', baseSubscriptionId: 'sub-1' }), 'auto');
    assert.equal(await renewal({ renewalMode: 'PROMPTPAY_RENEW', cancelAtPeriodEnd: true }), 'none');
  });
});
