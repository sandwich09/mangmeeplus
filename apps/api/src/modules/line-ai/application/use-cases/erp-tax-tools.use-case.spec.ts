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
