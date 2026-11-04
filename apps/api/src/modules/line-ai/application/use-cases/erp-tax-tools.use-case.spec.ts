import { LineReadEvidenceService, lineReadResultHash, parseWhtReadChoices, readMemoryEvidence } from '../line-read-evidence.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VoucherListRecentTool, VoucherGetDetailTool, WhtGetMonthSummaryTool, WhtCalculateWithholdingTool } from './erp-advisor-document-tools.use-case';
import { DisbursementVoucherUseCase } from '../../../expenses/application/use-cases/disbursement-voucher.use-case';
import { ListExpensesUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { pnd53PaperDueDay } from '../../../tax/domain/logic/tax-period.logic';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TaxGetCitCalendarTool,
  TaxGetReconciliationSummaryTool,
  TaxGetTaxCodeProfileTool,
  TaxGetTransactionTaxSummaryTool,
  TaxGetUpcomingObligationsTool,
  TaxGetVatSummaryTool,
  TaxGetWhtSummaryTool,
  TaxListMissingDocumentsTool,
} from './erp-tax-tools.use-case';

const baseCtx = {
  requestId: 'req-1',
  companyId: 'company-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  permissions: [],
  branchIds: ['branch-1'],
  locationIds: [],
  locale: 'th-TH',
};

const profilePermissions = ['tax.profile.read', 'tax.config.read'];
const summaryPermissions = ['tax.profile.read', 'tax.period.read', 'tax.report.read', 'tax.event.read', 'tax.review_issue.read'];
const reconciliationPermissions = [...summaryPermissions, 'ledger.journal.read'];

function profile(id: string, key: string) {
  return {
    id,
    companyId: 'company-1',
    name: key,
    sourceSystem: 'SAP_S4HANA',
    sourceProfileKey: key,
    countryCode: 'TH',
    sapClient: '100',
    sapCompanyCode: 'TH01',
    isDefault: true,
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    sourceUrl: 'https://internal.example/source',
    reviewedByUserId: 'reviewer-secret',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    roundingMode: 'HALF_UP',
    roundingScale: 2,
    taxAmountTolerance: '0.01',
  } as any;
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    profile: profile('profile-1', 'TH-S4'),
    periodKey: '2026-07',
    pp30: {
      box1TotalSales: '100.00', box2ZeroRatedSales: '0.00', box3ExemptSales: '0.00',
      box4TaxableSales: '100.00', box5OutputTax: '7.00', box6EligiblePurchases: '50.00',
      box7InputTax: '3.50', box8TaxPayable: '3.50', box9TaxOverpaid: '0.00',
    },
    componentSummary: [{ componentKey: 'VAT', transactionContext: 'DOMESTIC_SALE', eventCount: 1, taxableBase: '100.00', taxAmount: '7.00', evidencePendingCount: 0 }],
    latestReconciliation: {
      id: 'run-1', companyId: 'company-1', branchId: 'branch-1', formType: 'PP30', periodKey: '2026-07',
      status: 'REVIEWED', checksum: 'internal-checksum', blockingIssueCount: 0,
      createdAt: '2026-07-14T00:00:00.000Z', reviewedAt: '2026-07-15T00:00:00.000Z',
    },
    needsReviewCount: 0,
    evidenceReviewPendingCount: 0,
    permissionChecked: true,
    ...overrides,
  } as any;
}

describe('item-11B LINE AI tax adapters', () => {
  it('grounds legitimate empty tax periods, calendars, and issue queries', async () => {
    const emptyRepo = {
      findPeriods: async () => ({ items: [] }),
      findPeriod: async () => null,
      findIssuesByPeriod: async () => [],
    } as any;
    const results = await Promise.all([
      new TaxGetUpcomingObligationsTool(emptyRepo).execute({ ...baseCtx, permissions: ['tax.period.read'] }),
      new TaxGetVatSummaryTool(emptyRepo).execute({ ...baseCtx, permissions: ['tax.period.read', 'tax.event.read'] }, {}),
      new TaxGetWhtSummaryTool(emptyRepo).execute({ ...baseCtx, permissions: ['tax.period.read', 'tax.event.read'] }, {}),
      new TaxGetCitCalendarTool(emptyRepo).execute({ ...baseCtx, permissions: ['tax.period.read'] }),
      new TaxListMissingDocumentsTool(emptyRepo).execute({ ...baseCtx, permissions: ['tax.period.read', 'tax.review_issue.read'] }, {}),
    ]);
    for (const result of results) {
      assert.equal(result.status, 'ok');
      assert.ok(result.sourceRefs.length > 0);
      assert.ok(result.sourceRefs.every((ref) => ref.permissionChecked));
    }
  });

  it('grounds a missing active Tax Code profile as a review-required query result', async () => {
    const tool = new TaxGetTaxCodeProfileTool({ listProfiles: async () => [], listDefinitions: async () => [] } as any);
    const result = await tool.execute({ ...baseCtx, permissions: profilePermissions });
    assert.equal((result.data as any).reasonCode, 'NO_MATCHING_ACTIVE_PROFILE');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
  });
  it('returns review-required without selecting an ambiguous active Tax Code profile', async () => {
    let definitionsCalled = false;
    const tool = new TaxGetTaxCodeProfileTool({
      listProfiles: async () => [profile('profile-1', 'TH-S4'), profile('profile-2', 'TH-ERP')],
      listDefinitions: async () => { definitionsCalled = true; return []; },
    } as any);

    const result = await tool.execute({ ...baseCtx, permissions: profilePermissions }, { externalCode: 'O1' });
    const data = result.data as any;

    assert.equal(result.status, 'ok');
    assert.equal(data.reviewRequired, true);
    assert.equal(data.reasonCode, 'AMBIGUOUS_ACTIVE_PROFILE');
    assert.equal(data.profile, undefined);
    assert.equal(definitionsCalled, false);
    assert.equal(result.sourceRefs.every((ref) => ref.permissionChecked), true);
    assert.equal(JSON.stringify(data).includes('reviewer-secret'), false);
  });

  it('returns the one effective Tax Code definition and redacts reviewer/source metadata', async () => {
    const tool = new TaxGetTaxCodeProfileTool({
      listProfiles: async () => [profile('profile-1', 'TH-S4')],
      listDefinitions: async () => [{
        id: 'definition-1', companyId: 'company-1', profileId: 'profile-1', externalCode: 'O7',
        displayName: 'Output VAT 7%', taxRegime: 'VAT', direction: 'OUTPUT', treatment: 'STANDARD',
        transactionContexts: ['DOMESTIC_SALE'], rate: '7.0000', calculationMethod: 'EXCLUSIVE',
        sapAccountKey: 'MWS', claimabilityDefault: 'NOT_APPLICABLE', evidenceRuleKey: null,
        status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1,
        reviewedByUserId: 'reviewer-secret', reviewedAt: '2026-01-01T00:00:00.000Z',
      }],
    } as any);

    const result = await tool.execute({ ...baseCtx, permissions: profilePermissions }, { externalCode: 'O7', direction: 'OUTPUT' });
    const data = result.data as any;

    assert.equal(data.reviewRequired, false);
    assert.equal(data.definition.externalCode, 'O7');
    assert.equal(data.definition.rate, '7.0000');
    assert.equal(JSON.stringify(data).includes('reviewer-secret'), false);
    assert.equal(JSON.stringify(data).includes('internal.example'), false);
  });

  it('denies a transaction-tax summary branch outside resolved scope before calling tax application', async () => {
    let called = false;
    const tool = new TaxGetTransactionTaxSummaryTool({ execute: async () => { called = true; return summary(); } } as any);

    const result = await tool.execute(
      { ...baseCtx, permissions: summaryPermissions },
      { branchId: 'branch-outside' },
    );

    assert.equal(result.status, 'forbidden');
    assert.equal(called, false);
    assert.deepEqual(result.sourceRefs, []);
  });

  it('applies period/context filters and requires review when no event exists in the requested period', async () => {
    let seenBranches: string[] | undefined;
    const tool = new TaxGetTransactionTaxSummaryTool({
      execute: async (ctx: any) => { seenBranches = ctx.scopes.branchIds; return summary(); },
    } as any);

    const result = await tool.execute(
      { ...baseCtx, permissions: summaryPermissions },
      { periodKey: '2026-06', transactionContext: 'IMPORT_SERVICE', branchId: 'branch-1' },
    );
    const data = result.data as any;

    assert.equal(result.status, 'ok');
    assert.equal(data.coverage, 'LATEST_TRANSACTION_TAX_SNAPSHOT');
    assert.equal(data.reviewRequired, true);
    assert.deepEqual(data.reasonCodes, ['NO_EVENTS_FOR_REQUESTED_PERIOD']);
    assert.equal(data.filtersApplied.periodKey, false);
    assert.equal(data.filtersApplied.transactionContext, true);
    assert.equal(data.pp30, null);
    assert.equal(data.profile, null);
    assert.deepEqual(seenBranches, ['branch-1']);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
  });

  it('returns requested PP36 component snapshots without pretending they are PP30', async () => {
    let seenFilters: any;
    const tool = new TaxGetTransactionTaxSummaryTool({ execute: async (_ctx: any, filters: any) => {
      seenFilters = filters;
      return summary({
        pp30: null,
        componentSummary: [{ componentKey: 'PP36_OUTPUT', transactionContext: 'IMPORT_SERVICE', eventCount: 2, taxableBase: '3500.00', taxAmount: '245.00', evidencePendingCount: 0 }],
        latestReconciliation: { ...summary().latestReconciliation, formType: 'PP36' },
      });
    } } as any);
    const result = await tool.execute({ ...baseCtx, permissions: summaryPermissions }, { periodKey: '2026-07', formType: 'PP36', transactionContext: 'IMPORT_SERVICE' });
    const data = result.data as any;
    assert.deepEqual(seenFilters, { periodKey: '2026-07', formType: 'PP36', transactionContext: 'IMPORT_SERVICE' });
    assert.equal(data.coverage, 'REQUESTED_PP36_SNAPSHOT');
    assert.equal(data.pp30, null);
    assert.equal(data.components[0].componentKey, 'PP36_OUTPUT');
    assert.equal(data.reviewRequired, false);
  });

  it('fails closed when a requested period has no events or reviewed reconciliation', async () => {
    const tool = new TaxGetTransactionTaxSummaryTool({ execute: async () => summary({
      profile: null, pp30: null, componentSummary: [], latestReconciliation: null,
    }) } as any);
    const result = await tool.execute({ ...baseCtx, permissions: summaryPermissions }, { periodKey: '2026-07', formType: 'PP30' });
    const data = result.data as any;
    assert.equal(data.reviewRequired, true);
    assert.deepEqual(data.reasonCodes, ['NO_SNAPSHOT_PROFILE', 'NO_EVENTS_FOR_REQUESTED_PERIOD', 'NO_RECONCILIATION_RUN']);
    assert.equal(data.filtersApplied.periodKey, false);
  });

  it('surfaces source evidence still waiting for review', async () => {
    const tool = new TaxGetTransactionTaxSummaryTool({ execute: async () => summary({ evidenceReviewPendingCount: 2 }) } as any);
    const result = await tool.execute({ ...baseCtx, permissions: summaryPermissions }, { periodKey: '2026-07', formType: 'PP30' });
    const data = result.data as any;
    assert.equal(data.reviewRequired, true);
    assert.deepEqual(data.reasonCodes, ['EVIDENCE_REVIEW_PENDING']);
    assert.equal(data.evidenceReviewPendingCount, 2);
  });

  it('returns only redacted latest reconciliation metadata and flags blocking issues', async () => {
    const tool = new TaxGetReconciliationSummaryTool({
      execute: async () => summary({
        latestReconciliation: {
          ...summary().latestReconciliation,
          status: 'NEEDS_REVIEW',
          blockingIssueCount: 2,
        },
        needsReviewCount: 2,
      }),
    } as any);

    const result = await tool.execute({ ...baseCtx, permissions: reconciliationPermissions }, { periodKey: '2026-07' });
    const data = result.data as any;

    assert.equal(result.status, 'ok');
    assert.equal(data.reviewRequired, true);
    assert.deepEqual(data.reasonCodes, ['BLOCKING_RECONCILIATION_ISSUES']);
    assert.equal(data.reconciliation.blockingIssueCount, 2);
    assert.equal(data.reconciliation.companyId, undefined);
    assert.equal(data.reconciliation.checksum, undefined);
    assert.equal(result.sourceRefs[0]?.entityId, 'run-1');
  });

  it('does not return a latest reconciliation as if it matched another requested period', async () => {
    const tool = new TaxGetReconciliationSummaryTool({ execute: async () => summary() } as any);

    const result = await tool.execute(
      { ...baseCtx, permissions: reconciliationPermissions },
      { periodKey: '2026-06', formType: 'PP30' },
    );
    const data = result.data as any;

    assert.equal(data.reviewRequired, true);
    assert.deepEqual(data.reasonCodes, ['REQUESTED_PERIOD_NOT_LATEST']);
    assert.equal(data.reconciliation, null);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.entityId, undefined);
  });
});

describe('tax.get_vat_summary period input (period-resolution spec §3.3, P-04)', () => {
  const vatPermissions = ['tax.period.read', 'tax.event.read'];
  function repoFor(seen: string[]) {
    return {
      findPeriod: async (_companyId: string, _formType: string, periodKey: string) => {
        seen.push(periodKey);
        return { id: `period-${periodKey}`, periodKey, status: 'OPEN' };
      },
      findEventsByPeriod: async () => [
        { eventType: 'VAT_OUTPUT', taxAmount: '700.00' },
        { eventType: 'VAT_INPUT', taxAmount: '200.00' },
      ],
    } as any;
  }
  const currentPeriodKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);

  it('reads the period the caller states, and says which period it read', async () => {
    const seen: string[] = [];
    const result = await new TaxGetVatSummaryTool(repoFor(seen)).execute({ ...baseCtx, permissions: vatPermissions }, { periodKey: '2026-08' });
    assert.deepEqual(seen, ['2026-08']);
    assert.equal((result.data as Record<string, unknown>)['periodKey'], '2026-08');
    assert.equal((result.data as Record<string, unknown>)['netVat'], '500.00');
  });

  it('defaults to the CURRENT period, and replaces a malformed key rather than passing it through', async () => {
    const seen: string[] = [];
    const tool = new TaxGetVatSummaryTool(repoFor(seen));
    await tool.execute({ ...baseCtx, permissions: vatPermissions }, {});
    await tool.execute({ ...baseCtx, permissions: vatPermissions }, { periodKey: 'เดือนที่แล้ว' });
    await tool.execute({ ...baseCtx, permissions: vatPermissions }, { periodKey: '2026-08-01' });
    assert.deepEqual(seen, [currentPeriodKey(), currentPeriodKey(), currentPeriodKey()]);
  });
});


describe('round 5A sold-pack document advisor reads', () => {
  const permissions = ['expense.disbursement.read', 'expense.read_own', 'wht.certificate.read', 'wht.pnd53.read', 'expense.create'];
  const ctx = { ...baseCtx, permissions };
  const catalog = [{ code: 'CAT_SERVICE', nameTh: 'ค่าบริการมาตรฐาน', formType: 'PND53', defaultRate: '3.0000' },
    { code: 'CAT_AD', nameTh: 'ค่าโฆษณา', formType: 'PND53', defaultRate: '2.0000' }];
  const data = (r: any) => r.data as any;

  it('denies every new read before accessing the source when permission is absent', async () => {
    const noSource = new Proxy({}, { get: () => { throw new Error('must not read source'); } });
    for (const tool of [new VoucherListRecentTool(noSource as any), new VoucherGetDetailTool(noSource as any),
      new WhtGetMonthSummaryTool(noSource as any, noSource as any), new WhtCalculateWithholdingTool(noSource as any)]) {
      assert.equal((await tool.execute(baseCtx, {})).status, 'forbidden', tool.toolName);
    }
  });

  it('voucher reads call the real web use-case with tenant, own and branch scope intact', async () => {
    const seen: any[] = [];
    const repo = { list: async (scope: any) => { seen.push(scope); return { rows: [], total: 0, counts: {}, names: new Map(), amountsInEffect: new Map() }; },
      findVisible: async (scope: any, id: string) => { seen.push({ ...scope, id }); return null; } };
    const useCase = new DisbursementVoucherUseCase(repo as any, {} as any, new ListExpensesUseCase({} as any), {} as any);
    const list = new VoucherListRecentTool(useCase), detail = new VoucherGetDetailTool(useCase);
    assert.equal((await list.execute(ctx, { branchId: 'branch-1' })).status, 'ok');
    assert.deepEqual(seen[0], { companyId: 'company-1', createdByUserId: 'user-1', scopes: { branchIds: ['branch-1'], locationIds: [] }, relatedUserId: undefined });
    await assert.rejects(() => list.execute(ctx, { branchId: 'branch-other' }), ForbiddenException);
    assert.equal(seen.length, 1, 'out-of-scope branch does not reach voucher repository');
    await assert.rejects(() => detail.execute(ctx, { voucherId: 'hidden-or-other-tenant' }), NotFoundException);
    assert.equal(seen[1].companyId, ctx.companyId); assert.equal(seen[1].createdByUserId, ctx.userId);
    assert.deepEqual(seen[1].scopes.branchIds, ctx.branchIds);
    await assert.rejects(() => list.execute({ ...ctx, permissions: ['expense.disbursement.read'] }, {}), ForbiddenException);
  });

  it('projects voucher detail without bank/account/audit or action controls', async () => {
    let readCtx: any;
    const tool = new VoucherGetDetailTool({ get: async (c: any) => { readCtx = c; return { header: { id: 'v1', documentNumber: 'PV-1', status: 'PAID', payeeName: 'ผู้รับ', totalAmount: '900.0000', paidDate: '2026-10-01', plannedPayDate: null, payeeAccountLast4: '1234' }, lines: [{ expenseNumber: 'EXP-1', amount: '900.0000' }], actions: { pay: true } }; } } as any);
    const r = await tool.execute(ctx, { voucherId: 'v1' });
    assert.equal(readCtx.userId, ctx.userId); assert.equal(readCtx.membershipId, ctx.membershipId);
    assert.deepEqual(readCtx.scopes.branchIds, ctx.branchIds);
    assert.equal(data(r).totalAmount, '900.0000'); assert.match(data(r).message, /จ่ายแล้ว/);
    assert.equal(data(r).actions, undefined); assert.doesNotMatch(JSON.stringify(r.data), /1234/);
  });

  function handoff(id: string, status: string, gross: string, withheld: string, overrides: any = {}) {
    return { id, status, sourceBranchId: 'branch-1', currentCertificate: null, externalCertificateNumber: status === 'EXTERNAL_LINKED' ? 'EXT-1' : null,
      prefill: { paymentDate: '2026-10-02', formType: 'PND53', grossAmount: gross, withheldAmount: withheld,
        incomeCategoryCode: 'CAT_SERVICE', incomeCategoryName: 'ค่าบริการมาตรฐาน', payeeSnapshot: { name: 'ผู้รับ' } }, ...overrides };
  }
  it('R8 partly certified expense contributes only its remainder', async () => {
    const source = { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' };
    const required = handoff('required', 'REQUIRED', '10000', '100', source);
    const certificate = handoff('issued', 'SYSTEM_ISSUED', '5000', '50', {
      ...source, currentCertificate: { paymentDate: '2026-10-01', grossAmount: '5000', withheldAmount: '50', incomeCategoryCode: 'CAT_SERVICE', incomeCategoryName: 'ค่าบริการมาตรฐาน', payee: { name: 'ผู้รับ' } },
    });
    const run = async (rows: any[]) => data(await new WhtGetMonthSummaryTool({ listPaged: async () => ({ rows, total: rows.length, pageSize: 100 }) } as any, {} as any)
      .execute({ ...ctx, permissions: ['wht.certificate.read'] }, { periodKey: '2026-10' }));
    const snapshot = JSON.stringify([required, certificate]);
    const partial = await run([required, certificate, certificate]);
    assert.equal(partial.totalIncome ?? partial.totalPaid, '10000.00'); assert.equal(partial.totalDocumentWithholding, '100.00');
    assert.equal(partial.certificateItemCount, 2); assert.equal(partial.certificateCount, 1);
    assert.equal(partial.countBasis, 'certificate_worklist_including_unpaid');
    assert.equal(JSON.stringify([required, certificate]), snapshot, 'projection never changes shared DTOs');
    const external = handoff('external', 'EXTERNAL_LINKED', '5000', '50', source);
    const cancelled = handoff('cancelled', 'CANCELLED', '9000', '90', source);
    const full = await run([required, certificate, external, cancelled]);
    assert.equal(full.totalIncome, '10000.00'); assert.equal(full.certificateItemCount, 2); assert.equal(full.certificateCount, 2);
    const payment = handoff('payment', 'REQUIRED', '5000', '50', { ...source, prefill: { ...required.prefill, expensePaymentId: 'payment-2', grossAmount: '5000', withheldAmount: '50', expenseTotals: { grossAmount: '10000', withheldAmount: '100' } } });
    assert.equal((await run([payment, certificate])).totalIncome, '10000.00', 'payment-specific required is not reduced again');
    assert.equal((await run([required, { ...certificate, sourcePaymentId: 'other' }])).totalIncome, '15000.00', 'sources cannot reduce each other');
    assert.equal((await run([required, { ...certificate, sourcePaymentType: 'supplier.payment' }])).totalIncome, '15000.00');
    const unpaid = await run([required]);
    assert.equal(unpaid.totalIncome, '10000.00'); assert.equal(unpaid.certificateCount, 0);
    assert.doesNotMatch(unpaid.message, /จากการจ่าย|ค้างชำระ/);
  });

  it('R8 cross-month certificates are subtracted before month selection', async () => {
    const source = { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' };
    const required = handoff('required', 'REQUIRED', '10000', '100', source);
    const prior = handoff('prior', 'EXTERNAL_LINKED', '5000', '50', { ...source, prefill: { ...required.prefill, paymentDate: '2026-09-30', grossAmount: '5000', withheldAmount: '50', expensePaymentId: 'payment-1' } });
    const filler = Array.from({ length: 101 }, (_, i) => handoff(`unpaid-${i}`, 'REQUIRED', '0.10', '0.01', { sourcePaymentType: 'expense.record', sourcePaymentId: `unpaid-${i}` }));
    const rows = [required, ...filler, prior];
    const pages: number[] = [];
    const r = data(await new WhtGetMonthSummaryTool({ listPaged: async (c: any, query: any) => {
      assert.equal(c.companyId, ctx.companyId); assert.deepEqual(c.scopes.branchIds, ctx.branchIds);
      assert.equal(query.periodKey, undefined); pages.push(query.page);
      return { rows: rows.slice((query.page - 1) * 100, query.page * 100), total: rows.length, pageSize: 100 };
    } } as any, {} as any).execute({ ...ctx, permissions: ['wht.certificate.read'] }, { periodKey: '2026-10' }));
    assert.deepEqual(pages, [1, 2]); assert.equal(r.totalIncome ?? r.totalPaid, '5010.10'); assert.equal(r.totalDocumentWithholding, '51.01');
    assert.equal(r.certificateCount, 0); assert.equal(r.certificateItemCount, 102);
  });

  it('sums every page of seeded paid/certificate figures and only active scoped PND53 events', async () => {
    const rows = [handoff('1', 'SYSTEM_ISSUED', '1000.10', '30.00'), handoff('2', 'EXTERNAL_LINKED', '2000.20', '60.01'),
      handoff('3', 'REQUIRED', '500.05', '15.00'), handoff('4', 'CANCELLED', '9000', '270'),
      handoff('5', 'SYSTEM_ISSUED', '8000', '240', { prefill: { ...handoff('5', 'SYSTEM_ISSUED', '8000', '240').prefill, paymentDate: '2026-09-30' } })];
    const seen: any[] = [];
    const handoffs = { listPaged: async (c: any, query: any) => { seen.push([c, query]); const page = query.page; return { rows: rows.slice((page - 1) * 2, page * 2), total: rows.length, pageSize: 2 }; } };
    const repo = { findPeriod: async (...args: any[]) => { assert.deepEqual(args, ['company-1', 'PND53', '2026-10']); return { id: 'period', status: 'OPEN', dueDate: new Date('2026-11-09Z') }; },
      findEventsByPeriod: async (...args: any[]) => { assert.deepEqual(args, ['company-1', 'period', 'ACTIVE']); return [
        { eventType: 'WHT_PND53', branchId: 'branch-1', taxAmount: '105.01' },
        { eventType: 'WHT_PND53', branchId: 'branch-other', taxAmount: '9999.00' },
        { eventType: 'VAT_INPUT', branchId: 'branch-1', taxAmount: '777.00' }]; } };
    const r = data(await new WhtGetMonthSummaryTool(handoffs as any, repo as any).execute(ctx, { periodKey: '2026-10', branchId: 'branch-1' }));
    assert.equal(seen.length, 3); assert.equal(seen[0][0].companyId, ctx.companyId); assert.deepEqual(seen[0][0].scopes.branchIds, ctx.branchIds);
    assert.equal(r.certificateCount, 2); assert.equal(r.certificateItemCount, 3); assert.equal(r.totalIncome, '3500.35'); assert.equal(r.totalDocumentWithholding, '105.01');
    assert.deepEqual(r.byIncomeType, [{ incomeCategoryName: 'ค่าบริการมาตรฐาน', itemCount: 3, totalIncome: '3500.35', totalDocumentWithholding: '105.01' }]);
    assert.equal(r.remittance.totalWithheld, '105.01'); assert.equal(r.remittance.dueDate, '2026-11-09'); assert.equal(r.remittance.dueDateBasis, 'configured_period');
    assert.equal(r.issuedCertificates.length, 2); assert.equal(r.issuedCertificates[1].number, 'EXT-1'); assert.doesNotMatch(r.message, /จากการจ่าย|ค้างชำระ/);
    assert.match(r.message, /รายการที่คุณดูได้เดือน ตุลาคม 2569/); assert.doesNotMatch(r.message, /2026-10|2026-11-09/);
  });

  it('refuses an outside branch before reads and keeps missing remittance separate from its calendar deadline', async () => {
    let calls = 0;
    const tool = new WhtGetMonthSummaryTool({ listPaged: async () => { calls++; return { rows: [], pageSize: 100, total: 0 }; } } as any,
      { findPeriod: async () => { calls++; return null; } } as any);
    assert.equal((await tool.execute(ctx, { branchId: 'other' })).status, 'forbidden'); assert.equal(calls, 0);
    const r = data(await tool.execute(ctx, { periodKey: '2026-10' })); assert.equal(r.remittance, null); assert.match(r.message, /รายการที่คุณดูได้เดือน/);
    assert.equal(pnd53PaperDueDay('2026-12'), '2027-01-07');
    await assert.rejects(() => tool.execute(ctx, { periodKey: '2026-13' }));
  });

  it('does not read certificates or remittance without each source permission', async () => {
    const noRead = { listPaged: async () => { throw new Error('no certificate permission'); } };
    const repo = { findPeriod: async () => null };
    assert.equal(data(await new WhtGetMonthSummaryTool(noRead as any, repo as any).execute({ ...ctx, permissions: ['wht.pnd53.read'] }, {})).certificateCount, null);
    const noTax = { findPeriod: async () => { throw new Error('no remittance permission'); } };
    const certificateOnly = data(await new WhtGetMonthSummaryTool({ listPaged: async () => ({ rows: [], total: 0, pageSize: 100 }) } as any, noTax as any)
      .execute({ ...ctx, permissions: ['wht.certificate.read'] }, {}));
    assert.equal(certificateOnly.remittance, null); assert.equal(certificateOnly.dueDate, null);
    assert.doesNotMatch(certificateOnly.message, /กำหนดยื่น|due/);
  });

  it('uses the live catalog rate and existing half-up satang arithmetic, never a model rate', async () => {
    let seen: any;
    const tool = new WhtCalculateWithholdingTool({ execute: async (c: any) => { seen = c; return catalog; } } as any);
    const r = data(await tool.execute({ ...ctx, groundingText: 'ค่าบริการมาตรฐาน ฐานก่อนภาษี 1000.50 บาท' }, { incomeCategoryCode: 'CAT_SERVICE', baseAmount: '1000.50', rate: '99' } as any));
    const verified = data(await tool.execute({ ...ctx, groundingText: 'wrong or absent gateway text',
      inputEvidence: { parts: [{ rawText: 'ค่าบริการมาตรฐาน ฐานก่อนภาษี 1000.50 บาท' }] } as any }, { incomeCategoryCode: 'CAT_SERVICE', baseAmount: '1000.50' }));
    assert.equal(verified.withheldAmount, '30.02', 'semantic v2 grounds against API-verified input evidence');
    assert.equal(data(await tool.execute({ ...ctx, groundingText: 'ค่าบริการมาตรฐาน 1000.50 บาท' }, { baseAmount: '1000.50' })).withheldAmount, '30.02', 'exact explicit catalog name resolves without a model-proposed code');
    assert.equal(r.ratePercent, '3.0000'); assert.equal(r.withheldAmount, '30.02'); assert.equal(r.netBeforeVat, '970.48');
    assert.match(r.message, /ถ้าใช้ฐานก่อนภาษีมูลค่าเพิ่ม/); assert.equal(seen.companyId, ctx.companyId); assert.deepEqual(seen.scopes.branchIds, ctx.branchIds);
    const changed = new WhtCalculateWithholdingTool({ execute: async () => [{ ...catalog[0], defaultRate: '5' }] } as any);
    assert.equal(data(await changed.execute({ ...ctx, groundingText: 'ค่าบริการมาตรฐาน 1000' }, { incomeCategoryCode: 'CAT_SERVICE', baseAmount: '1000' })).withheldAmount, '50.00');
  });

  it('asks with catalog message buttons when type is unknown, guessed, retired or only called ค่าจ้าง', async () => {
    const tool = new WhtCalculateWithholdingTool({ execute: async () => catalog } as any);
    for (const incomeCategoryCode of [undefined, 'CAT_SERVICE', 'RETIRED']) {
      const r = data(await tool.execute({ ...ctx, groundingText: 'จ่ายค่าจ้าง 1,000 บาท ต้องหักเท่าไหร่' }, { incomeCategoryCode, baseAmount: '1000' }));
      assert.equal(r.needsIncomeType, true); assert.equal(r.withheldAmount, undefined); assert.equal(r.readChoices.length, 2);
      assert.ok(r.readChoices.every((c: any) => catalog.some(x => c.text.includes(x.nameTh))));
      assert.doesNotMatch(JSON.stringify(r.readChoices), /CAT_SERVICE|RETIRED/);
    }
    const r = data(await tool.execute({ ...ctx, groundingText: 'ค่าโฆษณา 1000' }, { incomeCategoryCode: 'CAT_AD', baseAmount: '9999' }));
    assert.equal(r.needsAmount, true); assert.equal(r.withheldAmount, undefined);
  });
});


describe('round 5A catalog read proof and voucher understanding memory', () => {
  it('stores only accepted calculation grounding and catalog choices and binds them to the API turn', async () => {
    let saved: any, where: any;
    const tx = { $executeRaw: async () => {}, lineReadEvidence: { count: async () => 0, create: async ({ data }: any) => { saved = data; return { id: 'proof' }; } } };
    const service = new LineReadEvidenceService({ client: { $transaction: async (fn: any) => fn(tx), lineReadEvidence: { findMany: async (query: any) => { where = query.where; return [saved]; } } } } as any, {} as any, new Map());
    const ctx = { ...baseCtx, permissions: ['expense.create'], chatKeyHash: 'a'.repeat(16), groundingText: 'จ่ายค่าจ้างให้คุณเอก 1000 บาท ข้อมูลส่วนตัวไม่เก็บ' };
    const tool = new WhtCalculateWithholdingTool({ execute: async () => [{ code: 'CAT', nameTh: 'ค่าบริการ (นิติบุคคล)', defaultRate: '3', formType: 'PND53' }] } as any);
    const input = { baseAmount: '1000' }, r = await tool.execute(ctx, input);
    await service.record(ctx, input, r);
    assert.equal(saved.inputJson.whtGrounding, '1000.00'); assert.doesNotMatch(JSON.stringify(saved.inputJson), /คุณเอก|ข้อมูลส่วนตัวไม่เก็บ/);
    const replay = await tool.execute({ ...ctx, groundingText: saved.inputJson.whtGrounding }, input);
    assert.equal(lineReadResultHash(replay), lineReadResultHash(r), 'delivery re-verification preserves the catalog clarification');
    const request = { requestId: ctx.requestId, userContext: { companyId: ctx.companyId, internalUserId: ctx.userId, membershipId: ctx.membershipId, chatKeyHash: ctx.chatKeyHash } } as any;
    const response = { refused: false, toolCalls: [{ name: tool.toolName, status: 'ok' }] } as any;
    const choices = await service.whtReadChoicesForTurn(request, response);
    assert.equal(choices?.length, 1); assert.equal(where.companyId, ctx.companyId); assert.equal(where.userId, ctx.userId);
    assert.equal(where.membershipId, ctx.membershipId); assert.equal(where.requestId, ctx.requestId);
    assert.equal(await service.whtReadChoicesForTurn({ ...request, userContext: { ...request.userContext, chatKeyHash: 'b'.repeat(16) } }, response), undefined);
    assert.equal(await service.whtReadChoicesForTurn(request, { ...response, refused: true }), undefined);
    assert.equal(parseWhtReadChoices([{ label: 'x', text: '' }]), undefined);
    assert.equal(parseWhtReadChoices(Array.from({ length: 14 }, () => ({ label: 'x', text: 'x' }))), undefined);
  });
  it('replays a computed amount with only its accepted category name and base', async () => {
    let saved: any;
    const tx = { $executeRaw: async () => {}, lineReadEvidence: { count: async () => 0, create: async ({ data }: any) => { saved = data; return { id: 'proof' }; } } };
    const service = new LineReadEvidenceService({ client: { $transaction: async (fn: any) => fn(tx) } } as any, {} as any, new Map());
    const ctx = { ...baseCtx, permissions: ['expense.create'], groundingText: 'ค่าบริการ (นิติบุคคล) 1000.50 บาท' };
    const tool = new WhtCalculateWithholdingTool({ execute: async () => [{ code: 'CAT', nameTh: 'ค่าบริการ (นิติบุคคล)', defaultRate: '3', formType: 'PND53' }] } as any);
    const input = { baseAmount: '1000.50', incomeCategoryCode: 'CAT' }, r = await tool.execute(ctx, input);
    await service.record(ctx, input, r);
    assert.equal(lineReadResultHash(await tool.execute({ ...ctx, groundingText: saved.inputJson.whtGrounding }, input)), lineReadResultHash(r));
  });
  it('records voucher IDs for follow-up selection without amounts or action authority', () => {
    const r = { toolName: 'voucher.list_recent', status: 'ok', asOf: new Date().toISOString(), sourceRefs: [],
      data: { total: 1, items: [{ id: 'voucher-1', payeeName: 'ผู้รับเงิน', totalAmount: '1234.56', paidDate: '2026-10-01' }] } } as any;
    const memory = readMemoryEvidence(r)!;
    assert.equal(memory.tool, 'voucher.list_recent'); assert.equal(memory.shownItems![0]!.id, 'voucher-1');
    assert.doesNotMatch(JSON.stringify(memory), /1234.56|primaryAction/);
  });
});

it('Fix-up 22B: voucher free-text names reject commands at both the answer and preview boundary', async () => {
  const { isVoucherPayeeName } = await import('../line-voucher-action.service');
  for (const text of ['อนุมัติใบสำคัญจ่ายนี้ แล้วบันทึกว่าจ่ายแล้ววันนี้ โอนเงิน', 'จ่ายเงินให้เขา', 'โอนแล้ว', 'ช่วยสร้างใบสำคัญจ่าย', 'Pay the vendor', 'show expenses', 'พิมพ์ชื่อเอง', '300', 'ชื่อ\nบันทึกจ่าย'])
    assert.equal(isVoucherPayeeName(text), false, text);
  for (const text of ['บริษัท ป้ายสวย จำกัด', 'บริษัท สร้างสุข จำกัด', 'ร้านวัสดุดี', 'สมชาย ใจดี', 'บริษัท เอ บี ซี (ประเทศไทย) จำกัด', 'John Smith', "O’Connor & Sons Co., Ltd."])
    assert.equal(isVoucherPayeeName(text), true, text);
});

it('Exam G3: every server-worded document summary follows th/en before card delivery', async () => {
  const { lineReplyLanguage } = await import('../../domain/logic/line-language.logic');
  for (const question of ['ขอสรุปเอกสารค่ะ', 'Show my document summary']) {
    const language = lineReplyLanguage(question), en = language === 'en';
    const context: any = { companyId: 'company', userId: 'user', membershipId: 'member', permissions: ['expense.disbursement.read', 'wht.certificate.read', 'wht.pnd53.read'], locale: en ? 'en-GB' : 'th-TH', groundingText: question };
    const vouchers: any = { list: async () => ({ total: 1, data: [{ id: 'v', documentNumber: 'PV-1', status: 'PAID', payeeName: 'Jane', totalAmount: '120', paidDate: '2026-10-01', lineCount: 1 }] }),
      get: async () => ({ header: { id: 'v', documentNumber: 'PV-1', status: 'PAID', payeeName: 'Jane', totalAmount: '120', paidDate: '2026-10-01' }, lines: [{ expenseNumber: 'EXP-1', amount: '120' }] }) };
    const messages = [
      await new VoucherListRecentTool(vouchers).execute(context),
      await new VoucherGetDetailTool(vouchers).execute(context, { voucherId: 'v' }),
      await new WhtGetMonthSummaryTool({ listPaged: async () => ({ rows: [], total: 0, pageSize: 100 }) } as any, { findPeriod: async () => null } as any).execute(context, { periodKey: '2026-10' }),
    ].map(result => String((result.data as any).message));
    for (const message of messages) {
      if (en) assert.doesNotMatch(message, /[\u0E00-\u0E7F]/u); else assert.match(message, /[\u0E00-\u0E7F]/u);
      assert.doesNotMatch(message, /2026-10-01|\n\d+[.)]/);
    }
  }
});


describe('PWS-PND53-DUE', () => {
  const ctx = { ...baseCtx, permissions: ['wht.pnd53.read', 'wht.certificate.read'], groundingText: 'ภงด.53 ต้องยื่นเมื่อไหร่' };
  const noCertificates = { listPaged: async () => assert.fail('due-date help does not read certificates') };
  const data = (result: any) => result.data as any;
  for (const configured of [true, false]) it(`uses the configured date or default 7th, configured=${configured}`, async () => {
    const tool = new WhtGetMonthSummaryTool(noCertificates as any, {
      findPeriod: async () => ({ id: 'period', status: 'OPEN', dueDate: configured ? new Date('2026-11-09Z') : null }),
      findEventsByPeriod: async () => assert.fail('due-date help does not read amounts'),
    } as any);
    const result = data(await tool.execute(ctx, { periodKey: '2026-10', dueDateOnly: true }));
    assert.equal(result.dueDate, configured ? '2026-11-09' : '2026-11-07');
    assert.equal(result.message, `ภ.ง.ด.53 ของเดือนตุลาคม 2569 ต้องยื่นภายใน ${configured ? '9' : '7'} พ.ย. 2569 ค่ะ`);
  });
  it('computes a date without a period row', async () => {
    const result = data(await new WhtGetMonthSummaryTool(noCertificates as any, { findPeriod: async () => null } as any)
      .execute(ctx, { periodKey: '2026-12', dueDateOnly: true }));
    assert.equal(result.dueDate, '2027-01-07');
    assert.equal(result.message, 'ภ.ง.ด.53 ของเดือนธันวาคม 2569 ต้องยื่นภายใน 7 ม.ค. 2570 ค่ะ');
  });
  for (const configured of [true, false]) for (const offset of [-1, 0, 1]) it(`chooses the Bangkok month before/on/after the due date, configured=${configured}, offset=${offset}`, async t => {
    const day = (configured ? 9 : 7) + offset;
    // At 00:30 Bangkok it is still the previous day in UTC.
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, day - 1, 17, 30) });
    const seen: string[] = [];
    const tool = new WhtGetMonthSummaryTool(noCertificates as any, { findPeriod: async (_company: string, _form: string, key: string) => {
      seen.push(key); return configured && key === '2026-10' ? { id: 'period', dueDate: new Date('2026-11-09Z') } : null;
    } } as any);
    const result = data(await tool.execute(ctx, { dueDateOnly: true }));
    assert.equal(result.periodKey, offset <= 0 ? '2026-10' : '2026-11');
    assert.equal(result.dueDate, offset <= 0 ? `2026-11-${configured ? '09' : '07'}` : '2026-12-07');
    assert.deepEqual(seen, offset <= 0 ? ['2026-10'] : ['2026-10', '2026-11']);
  });
  for (const [question, expected] of [
    ['ภงด.53 เดือนมีนาคมต้องยื่นเมื่อไหร่', '2026-03'],
    ['ภงด.53 เดือนธันวาคมต้องยื่นเมื่อไหร่', '2026-12'],
    ['ภงด.53 เดือนมกราคม 2570 ต้องยื่นเมื่อไหร่', '2027-01'],
    ['when is PND53 for October 2026 due?', '2026-10'],
  ]) it(`uses a named month with this year as default: ${question}`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 4) });
    const result = data(await new WhtGetMonthSummaryTool(noCertificates as any, { findPeriod: async () => null } as any)
      .execute({ ...ctx, groundingText: question }, { dueDateOnly: true }));
    assert.equal(result.periodKey, expected);
    if (question.startsWith('when')) assert.equal(result.message, 'PND53 for October 2026 is due by 7 Nov 2026.');
  });
  for (const periodExists of [true, false]) for (const certificatesReadable of [true, false]) it(`a certificate reader still gets the summary due date, periodExists=${periodExists}, certificatesReadable=${certificatesReadable}`, async () => {
    const result = data(await new WhtGetMonthSummaryTool({ listPaged: async () => ({ rows: [], total: 0, pageSize: 100 }) } as any,
      { findPeriod: async () => periodExists ? { id: 'period', status: 'OPEN', dueDate: new Date('2026-11-09Z') } : null,
        findEventsByPeriod: async () => [] } as any)
      .execute({ ...ctx, permissions: ['wht.pnd53.read', ...(certificatesReadable ? ['wht.certificate.read'] : [])] }, { periodKey: '2026-10' }));
    assert.match(result.message, new RegExp(`กำหนดยื่น ${periodExists ? '9' : '7'} พ.ย. 2569`));
  });
  it('denies due-date help to certificate-only and free-draft permission sets before reading', async () => {
    const noRead = new Proxy({}, { get: () => assert.fail('no source read without PND53 permission') });
    const tool = new WhtGetMonthSummaryTool(noRead as any, noRead as any);
    for (const permissions of [['wht.certificate.read'], ['expense.read_own', 'expense.receipt.line_upload']])
      assert.equal((await tool.execute({ ...ctx, permissions }, { dueDateOnly: true })).status, 'forbidden');
  });
});
