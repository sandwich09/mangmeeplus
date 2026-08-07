import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenerateTaxFilingPackageUseCase } from './generate-tax-filing-package.use-case.js';

const ctx = { companyId: 'c1', userId: 'u1', requestId: 'r1' } as any;
function harness(reconciliation: any, issues: any[] = []) {
  const period = { id: 'p1', companyId: 'c1', taxType: 'VAT', formType: 'PP30', periodKey: '2026-07', status: 'REVIEWED', createdAt: new Date(), updatedAt: new Date() };
  const taxRepo = {
    findPeriodById: async () => period,
    findEventsByPeriod: async () => [],
    findIssuesByPeriod: async () => issues,
    updatePeriodStatus: async () => period,
    prisma: { client: {
      taxReportSnapshot: { findFirst: async () => null }, taxReconciliationRun: { findFirst: async () => reconciliation },
      taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg1', ...data, status: 'GENERATED', generatedAt: new Date(), downloadedAt: null, voidedAt: null, filedManuallyAt: null, createdAt: new Date() }) },
    } },
  } as any;
  return new GenerateTaxFilingPackageUseCase(taxRepo, { execute: async () => ({ id: 'seq1', documentNumber: 'TX-1' }) } as any, { execute: async () => undefined } as any, { log: async () => undefined } as any);
}

describe('GenerateTaxFilingPackageUseCase reconciliation gate', () => {
  it('blocks export when there is no current reconciliation', async () => {
    await assert.rejects(() => harness(null).execute(ctx, 'p1', 'REVIEW_JSON'), /reconciliation run is required/);
  });
  it('blocks unreviewed or blocking reconciliation', async () => {
    await assert.rejects(() => harness({ status: 'NEEDS_REVIEW', blockingIssueCount: 1 }).execute(ctx, 'p1', 'REVIEW_JSON'), /must be reviewed/);
  });
  it('allows export after a current reviewed reconciliation with no blockers', async () => {
    const result = await harness({ status: 'REVIEWED', blockingIssueCount: 0, reviewedAt: new Date(), updatedAt: new Date() }).execute(ctx, 'p1', 'REVIEW_JSON');
    assert.equal(result.status, 'GENERATED');
  });
});
