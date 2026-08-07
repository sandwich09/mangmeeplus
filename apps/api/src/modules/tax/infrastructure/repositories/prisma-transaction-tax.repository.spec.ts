import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaTransactionTaxRepository } from './prisma-transaction-tax.repository.js';

describe('PrismaTransactionTaxRepository agent summary', () => {
  it('uses the historical event profile and profile-aware rounding for the requested period', async () => {
    let profileWhere: any;
    let reconciliationWhere: any;
    let countWhere: any;
    let evidenceWhere: any;
    const profile = {
      id: 'profile-1', companyId: 'c1', name: 'Historical', sourceSystem: 'SAP_S4HANA', sourceProfileKey: 'TH-S4',
      countryCode: 'TH', sapClient: null, sapCompanyCode: null, status: 'RETIRED', isDefault: true,
      effectiveFrom: new Date('2026-01-01'), effectiveTo: null, sourceUrl: null, reviewedByUserId: 'u1', reviewedAt: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), version: 1,
      roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
    };
    const reconciliation = { id: 'run-current', companyId: 'c1', branchId: 'b1', formType: 'PP30', periodKey: '2026-07', status: 'REVIEWED', checksum: 'x', blockingIssueCount: 2, createdAt: new Date(), reviewedAt: new Date() };
    const event = {
      periodKey: '2026-07', eventDate: new Date('2026-07-15'), componentKey: 'VAT', taxContextSnapshot: 'DOMESTIC_SALE',
      taxableBase: '100.005', taxAmount: '7.005', taxEvidenceReviewStatus: 'VERIFIED',
      taxProfileKeySnapshot: 'TH-S4', taxProfileVersionSnapshot: 1,
      roundingModeSnapshot: 'HALF_EVEN', roundingScaleSnapshot: 3, taxAmountToleranceSnapshot: '0.005',
      reportContributionsJson: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT', amount: '7.005' }],
    };
    const client = {
      companyTaxCodeProfile: { findMany: async (query: any) => { profileWhere = query.where; assert.equal(query.take, 2); return [profile]; } },
      taxEvent: {
        findFirst: async () => event,
        findMany: async () => [event],
      },
      taxReconciliationRun: { findFirst: async (query: any) => { reconciliationWhere = query.where; return reconciliation; } },
      taxReconciliationLine: { count: async (query: any) => { countWhere = query.where; return 2; } },
      tradeTaxEvidence: { count: async (query: any) => { evidenceWhere = query.where; return 1; } },
    };
    const summary = await new PrismaTransactionTaxRepository({ client } as any).latestAgentSummary('c1', ['b1']);
    assert.deepEqual(profileWhere, { companyId: 'c1', sourceProfileKey: 'TH-S4', version: 1 });
    assert.equal(reconciliationWhere.formType, 'PP30');
    assert.equal(reconciliationWhere.periodKey, '2026-07');
    assert.deepEqual(countWhere, { runId: 'run-current', blocking: true });
    assert.equal(evidenceWhere.status, 'REVIEW_REQUIRED');
    assert.equal(evidenceWhere.evidenceDate.gte.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(evidenceWhere.evidenceDate.lt.toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(summary.profile?.id, 'profile-1');
    assert.equal(summary.profile?.status, 'RETIRED');
    assert.equal(summary.pp30?.box5OutputTax, '7.005');
    assert.equal(summary.componentSummary[0]?.taxAmount, '7.005');
    assert.equal(summary.needsReviewCount, 2);
    assert.equal(summary.evidenceReviewPendingCount, 1);
  });

  it('does not substitute a current profile when the requested period has no event snapshot', async () => {
    const client = {
      companyTaxCodeProfile: { findMany: async () => { throw new Error('profile lookup must not run'); } },
      taxEvent: { findFirst: async () => null, findMany: async () => [] },
      taxReconciliationRun: { findFirst: async () => null },
      taxReconciliationLine: { count: async () => 0 },
      tradeTaxEvidence: { count: async () => 0 },
    };
    const summary = await new PrismaTransactionTaxRepository({ client } as any).latestAgentSummary('c1', ['b1'], { periodKey: '2026-06', formType: 'PP30' });
    assert.equal(summary.periodKey, '2026-06');
    assert.equal(summary.profile, null);
    assert.equal(summary.pp30, null);
    assert.deepEqual(summary.componentSummary, []);
  });
});

describe('PrismaTransactionTaxRepository legacy scalar remediation', () => {
  const sourceRow = (postingStatus = 'pending') => ({
    id: 'd1', companyId: 'c1', branchId: null, documentDate: new Date('2026-07-14'), currency: 'THB',
    documentType: 'TAX_INVOICE', status: 'ISSUED', postingStatus, journalEntryId: postingStatus === 'posted' ? 'j1' : null,
    updatedAt: new Date('2026-07-14T10:00:00.000Z'),
    lines: [{
      id: 'l1', companyId: 'c1', documentId: 'd1', updatedAt: new Date('2026-07-14T09:00:00.000Z'),
      lineSubtotalAmount: '100', lineTotalAmount: '107', taxEvidenceReviewStatus: 'REVIEW_REQUIRED', taxRegimeSnapshot: 'VAT',
      taxDirectionSnapshot: 'OUTPUT', taxTreatmentSnapshot: 'STANDARD', taxContextSnapshot: 'DOMESTIC_SALE', taxRateSnapshot: '7',
      taxBaseAmount: '100', transactionTaxAmount: '7', externalTaxCodeSnapshot: 'O7', taxCodeDefinitionId: 'def-o7', taxComponentsJson: null,
    }],
  });

  it('discovers only scalar candidates and marks filed or posted sources immutable', async () => {
    const client = {
      accountingDocument: { findFirst: async () => sourceRow('posted') },
      taxPeriod: { findFirst: async () => ({ id: 'period-filed' }) },
      taxEvent: { findFirst: async () => null },
    };
    const result = await new PrismaTransactionTaxRepository({ client } as any).findLegacyRemediationSource('c1', 'accounting.document', 'd1');
    assert.equal(result?.lines.length, 1);
    assert.deepEqual(result?.blockers.sort(), ['source_already_posted', 'tax_period_already_filed']);
  });

  it('rechecks source and line versions before one serializable enrichment', async () => {
    let update: any;
    let isolation: any;
    const client: any = {
      accountingDocument: { findFirst: async () => sourceRow() },
      accountingDocumentLine: { updateMany: async (query: any) => { update = query; return { count: 1 }; } },
      taxPeriod: { findFirst: async () => null },
      taxEvent: { findFirst: async () => null },
    };
    client.$transaction = async (fn: (tx: any) => unknown, options: any) => { isolation = options; return fn(client); };
    const preview = {
      snapshot: {
        taxCodeDefinitionId: 'def-o7', externalTaxCode: 'O7', taxProfileKey: 'SAP_ERP_TH_LEGACY', taxProfileVersion: 1,
        roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
        taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_SALE', taxRate: '7',
        taxBaseAmount: '100.00', taxAmount: '7.00', claimability: 'NOT_APPLICABLE', evidenceStatus: 'VERIFIED',
        accountRuleVersion: 2, reportRuleVersion: 3,
      },
      components: [{ componentKey: 'VAT', snapshot: {}, accountAssignments: [{ accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'a1', postingSide: 'CREDIT', ruleVersion: 2 }] }],
    } as any;
    const count = await new PrismaTransactionTaxRepository({ client } as any).applyLegacyRemediation(
      'c1', 'accounting.document', 'd1', '2026-07-14T10:00:00.000Z',
      [{ sourceLineId: 'l1', expectedUpdatedAt: '2026-07-14T09:00:00.000Z', preview }],
    );
    assert.equal(count, 1);
    assert.equal(isolation.isolationLevel, 'Serializable');
    assert.equal(update.where.documentId, 'd1');
    assert.equal(update.data.transactionTaxAmount, '7.00');
    assert.deepEqual([
      update.data.roundingModeSnapshot, update.data.roundingScaleSnapshot, update.data.taxAmountToleranceSnapshot,
    ], ['HALF_EVEN', 3, '0.005']);
    assert.equal(update.data.taxComponentsJson.length, 1);
  });

  it('does not update a source that became posted after preview', async () => {
    let updated = false;
    const client: any = {
      accountingDocument: { findFirst: async () => sourceRow('posted') },
      accountingDocumentLine: { updateMany: async () => { updated = true; return { count: 1 }; } },
      taxPeriod: { findFirst: async () => null }, taxEvent: { findFirst: async () => null },
    };
    client.$transaction = async (fn: (tx: any) => unknown) => fn(client);
    await assert.rejects(() => new PrismaTransactionTaxRepository({ client } as any).applyLegacyRemediation(
      'c1', 'accounting.document', 'd1', '2026-07-14T10:00:00.000Z', [],
    ), /source_changed_or_locked/);
    assert.equal(updated, false);
  });
});
