import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_PAID_TIERS, billingOffer, type BillingCatalog, type BillingPolicy, type BillingTaxTreatment } from '@watchdog-bms/contracts';
import { BillingGetPackageCatalogTool, BillingGetPackageUsageTool, PACKAGE_MANAGER_REQUIRED } from './erp-package-tools.use-case';
import { lineReadResultHash } from '../line-read-evidence.service';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../../../system-partner-management/application/plan-term-limit';

// 10:00 Bangkok on 2026-09-28.
const NOW = new Date('2026-09-28T03:00:00.000Z');
const MANAGER = { companyId: 'c1', userId: 'u1', membershipId: 'm1', permissions: ['ai.tool.invoke', 'company.plan.manage'], locale: 'th' } as any;

type Usage = Record<string, unknown>;
function fakes(options: { term?: Record<string, unknown> | null; usage: Usage; lots?: Array<Record<string, unknown>> }) {
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
    const { tool } = fakes({ usage: PAID_USAGE, lots: [LOT, { ...LOT, kind: 'ADD_ON_PAID', serviceStart: new Date('2026-09-20T03:00:00.000Z') }] });
    const result = await tool.execute(MANAGER);
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, {
      package: { label: 'มืออาชีพ', termEndsOn: '2026-10-15' },
      capacity: { branches: { used: 4, limit: 5, remaining: 1 }, members: { used: 3, limit: 10, remaining: 7 } },
      receipts: { used: 70, limit: 100, remaining: 30, cadence: 'ตามรอบที่ชำระ', periodStartOn: '2026-09-15', periodEndsOn: '2026-10-15',
        resetsOn: null, expiresOn: null, additional: null,
        pace: { projectedUsed: 150, projectedShortfall: 50, daysElapsed: 14, daysLeft: 16, daysInPeriod: 30 },
        paceNote: null },
    }, 'an add-on lot never joins the package period (spec §17.3)');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/billing');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.queryApplied?.accessScope, 'company');
    assert.equal(result.basisVersion, 'package-pace-v1', 'the formula id rides the result, never the data an answer reads');
  });

  it('reads the monthly allowance by calendar month, with the reset day the package page prints', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool, calls } = fakes({ term: { ...TERM, tierKey: 'STARTER_249', branchLimit: 1, employeeLimit: 2, billingReceiptAccountId: null },
      usage: { used: 12, limit: 30, remaining: 18, cadence: 'LEGACY_MONTH', resetsAt: '2026-09-30T17:00:00.000Z', expiresAt: null } });
    const receipts = ((await tool.execute(MANAGER)).data as any).receipts;
    assert.equal(receipts.cadence, 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน');
    assert.equal(receipts.periodStartOn, '2026-09-01');
    assert.equal(receipts.periodEndsOn, '2026-09-30');
    assert.equal(receipts.resetsOn, '2026-10-01');
    assert.deepEqual(receipts.pace, { projectedUsed: 13, projectedShortfall: 0, daysElapsed: 28, daysLeft: 2, daysInPeriod: 30 });
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
    assert.equal(data.package.label, 'มืออาชีพ');
    assert.deepEqual(data.capacity.branches, { used: 4, limit: 10, remaining: 6 });
  });

  it('carries no price, no other package and no code an answer could repeat, and re-reads to the same evidence hash', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { tool } = fakes({ usage: PAID_USAGE, lots: [LOT] });
    const first = await tool.execute(MANAGER);
    t.mock.timers.tick(90_000);
    const second = await tool.execute(MANAGER);
    const text = JSON.stringify(first.data);
    assert.doesNotMatch(text, /price|satang|amount|baht|บาท/iu);
    for (const other of ['เริ่มต้น', 'เติบโต', 'ธุรกิจ', 'STARTER', 'BASIC', 'ENTERPRISE']) assert.ok(!text.includes(other), other);
    // Eval 2026-09-30: "(renewal: none)" reached a customer. Every value is plain Thai, a number or a civil date.
    const strings = JSON.stringify(first.data).match(/:"[^"]*"/gu) ?? [];
    assert.deepEqual(strings.filter((value) => /[A-Za-z]/u.test(value.replace('(PRO)', ''))), []);
    assert.notEqual(first.asOf, second.asOf);
    assert.equal(lineReadResultHash(first), lineReadResultHash(second));
  });
});

/** What BillingService.catalog() returns: billingOffer for every paid tier and interval under the ACTIVE policy. */
function catalog(taxTreatment: BillingTaxTreatment | null, policy: Partial<BillingPolicy> | null = null): BillingCatalog {
  const offers = BILLING_PAID_TIERS.flatMap((tier) => (['month', 'year'] as const).map((interval) => {
    const offer = billingOffer(tier, interval, policy);
    // Sales open, as in production; ENTERPRISE stays "coming soon" while its Prices are unbound.
    if (offer.availability === 'UNAVAILABLE') { offer.availability = 'AVAILABLE'; offer.reason = null; }
    return offer;
  }));
  return { schemaVersion: 1, mode: 'LIVE', policyRevision: 'rev-1', catalogRevision: 'catalog-1', generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30_000).toISOString(), taxTreatment, offers, aiMonthlyBudgetSatang: 123_456 };
}
const STAFF = { ...MANAGER, permissions: ['ai.tool.invoke', 'expense.read'] };
const catalogTool = (value: () => BillingCatalog) => new BillingGetPackageCatalogTool({ catalog: async () => value() } as any);

describe('billing.get_package_catalog (advisor spec §5.1a, owner 2026-09-30)', () => {
  it('lists every package on sale from the billing catalog: prices, limits, receipts and menus, for any caller', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const result = await catalogTool(() => catalog('NOT_VAT_REGISTERED')).execute(STAFF);
    assert.equal(result.status, 'ok');
    const data = result.data as any;
    assert.deepEqual(data.packages.map((item: any) => [item.name, item.monthly.price, item.yearly.price, item.branches, item.users, item.monthly.receiptReads]), [
      ['เริ่มต้น 249 บาท', '249', '2,490', 1, 2, 30], ['เติบโต 499 บาท', '499', '4,990', 2, 5, 50],
      ['มืออาชีพ 999 บาท', '999', '9,990', 5, 10, 100], ['ธุรกิจ 1,999 บาท', '1,999', '19,990', 10, 30, 500]]);
    assert.deepEqual(data.packages[0], {
      name: 'เริ่มต้น 249 บาท', branches: 1, users: 2,
      monthly: { price: '249', payable: '249', receiptReads: 30 },
      yearly: { price: '2,490', payable: '2,490', receiptReads: 360, months: 12, averagePerMonth: '207.50', savingVersusMonthly: '498', pricedAsMonths: 10 },
      menus: ['ผู้ช่วย AI ทาง LINE', 'หน้าแรก', 'ค่าใช้จ่ายและใบเสร็จ', 'การเบิกจ่าย', 'พนักงานและสิทธิ์', 'การแจ้งเตือน'],
    });
    const enterprise = data.packages[3];
    assert.deepEqual(enterprise.menus.filter((menu: string) => !data.packages[0].menus.includes(menu)), ['ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ', 'ออกหนังสือรับรอง 50 ทวิในระบบ']);
    assert.equal(enterprise.monthly.notOnSale, 'เร็ว ๆ นี้ ยังไม่เปิดให้ซื้อ');
    assert.equal(data.vatNote, 'ราคานี้ไม่มี VAT บวกเพิ่ม ยอดที่ชำระเท่ากับราคา');
    assert.equal(data.aiCreditPerMonth, 50);
    assert.deepEqual(result.sourceRefs.map((ref) => ref.webPath), [undefined], 'no package page link for someone who cannot buy');
    assert.equal((await catalogTool(() => catalog(null)).execute(MANAGER)).sourceRefs[0]!.webPath, '/companies/c1/billing');
  });

  it('gives the net amount payable with VAT exactly as a purchase quote charges it', async () => {
    const starter = async (tax: BillingTaxTreatment | null) => ((await catalogTool(() => catalog(tax)).execute(STAFF)).data as any);
    const exclusive = await starter('EXCLUSIVE_VAT_7');
    assert.deepEqual([exclusive.packages[0].monthly.price, exclusive.packages[0].monthly.vat, exclusive.packages[0].monthly.payable], ['249', '17.43', '266.43']);
    assert.deepEqual([exclusive.packages[0].yearly.price, exclusive.packages[0].yearly.vat, exclusive.packages[0].yearly.payable], ['2,490', '174.30', '2,664.30']);
    assert.equal(exclusive.vatNote, 'ราคานี้ยังไม่รวม VAT 7% ยอดที่ชำระสุทธิคือราคารวม VAT');
    const inclusive = await starter('INCLUSIVE_VAT_7');
    assert.deepEqual([inclusive.packages[0].monthly.price, inclusive.packages[0].monthly.vat, inclusive.packages[0].monthly.payable], ['249', '16.29', '249']);
    assert.equal(inclusive.vatNote, 'ราคานี้รวม VAT 7% แล้ว ยอดที่ชำระคือราคานี้');
    // No VAT, or no policy to say: never an invented VAT figure.
    for (const tax of ['NOT_VAT_REGISTERED', null] as const) assert.equal((await starter(tax)).packages[0].monthly.vat, undefined);
    assert.equal((await starter(null)).vatNote, 'ยังไม่มีข้อมูลว่าราคานี้มี VAT หรือไม่');
  });

  it('follows the ACTIVE policy prices, and never lets a cost, a budget or a code reach the answer', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const policy = { offerTerms: { STARTER_249: { monthlyPriceSatang: 19_900, annualPriceSatang: 189_000, monthlyReceiptAllowance: 40 } } };
    const tool = catalogTool(() => catalog('NOT_VAT_REGISTERED', policy));
    const first = await tool.execute(MANAGER);
    const starter = (first.data as any).packages[0];
    assert.deepEqual(starter.monthly, { price: '199', payable: '199', receiptReads: 40 });
    assert.equal(starter.yearly.price, '1,890');
    assert.equal(starter.yearly.pricedAsMonths, undefined, 'no "pay N months" line unless the yearly price is exactly N monthly prices');
    const text = JSON.stringify(first.data);
    assert.doesNotMatch(text, /satang|budget|cost|revision|margin|fee/iu);
    assert.doesNotMatch(text, /STARTER_249|"(?:month|year)"|AVAILABLE/u);
    assert.ok(!text.includes('123456') && !text.includes('1,234.56'), 'the AI safety budget never leaves the catalog');
    const strings = text.match(/:"[^"]*"/gu) ?? [];
    assert.deepEqual(strings.filter((value) => /[A-Za-z]/u.test(value.replace(/\((?:STARTER|BASIC|PRO|ENTERPRISE)\)|VAT|AI|LINE/gu, ''))), []);
    t.mock.timers.tick(90_000);
    const second = await tool.execute(MANAGER);
    assert.notEqual(first.asOf, second.asOf);
    assert.equal(lineReadResultHash(first), lineReadResultHash(second), 'catalog stamps and read time never enter the evidence');
  });
});
