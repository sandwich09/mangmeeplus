import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TransactionTaxController } from './transaction-tax.controller.js';

const ctx = { companyId: 'c1' } as any;

describe('TransactionTaxController route tenant boundary', () => {
  it('rejects mismatched company routes for reads and mutations', () => {
    const controller = new TransactionTaxController({ listProfiles: () => [], createProfile: () => ({}) } as any, {} as any, {} as any, {} as any);
    assert.throws(() => controller.listProfiles(ctx, 'other-company'), /does not match/);
    assert.throws(() => controller.createProfile(ctx, 'other-company', {} as any), /does not match/);
  });

  it('delegates when the route company matches request context', () => {
    let called = false;
    const controller = new TransactionTaxController({ listProfiles: () => { called = true; return []; } } as any, {} as any, {} as any, {} as any);
    assert.deepEqual(controller.listProfiles(ctx, 'c1'), []);
    assert.equal(called, true);
  });

  it('keeps legacy remediation preview/apply behind the route tenant boundary', () => {
    const controller = new TransactionTaxController({ previewLegacyRemediation: () => ({}), applyLegacyRemediation: () => ({}) } as any, {} as any, {} as any, {} as any);
    const body = { sourceType: 'accounting.document', sourceId: 'd1', lines: [] } as any;
    assert.throws(() => controller.previewLegacyRemediation(ctx, 'other-company', body), /does not match/);
    assert.throws(() => controller.applyLegacyRemediation(ctx, 'other-company', body), /does not match/);
    assert.deepEqual(controller.previewLegacyRemediation(ctx, 'c1', body), {});
    assert.deepEqual(controller.applyLegacyRemediation(ctx, 'c1', body), {});
  });

  it('keeps profile import preview/apply behind the route tenant boundary', async () => {
    const codeImport = { preview: async () => ({ checksum: 'c1' }), apply: async () => ({ imported: 1 }) };
    const controller = new TransactionTaxController({} as any, {} as any, codeImport as any, {} as any);
    const body = { format: 'JSON', content: '[]' } as any;
    assert.throws(() => controller.previewProfileImport(ctx, 'other-company', 'p1', body), /does not match/);
    assert.deepEqual(await controller.previewProfileImport(ctx, 'c1', 'p1', body), { checksum: 'c1' });
  });

  it('keeps profile readiness behind the route tenant boundary', () => {
    const controller = new TransactionTaxController({ getProfileReadiness: () => ({ canActivate: false }) } as any, {} as any, {} as any, {} as any);
    assert.throws(() => controller.getProfileReadiness(ctx, 'other-company', 'p1'), /does not match/);
    assert.deepEqual(controller.getProfileReadiness(ctx, 'c1', 'p1'), { canActivate: false });
  });

  // GAP-04: certifying a reconciliation run is a tax-reviewer duty, so it takes
  // the same company taxReviewerRole gate as mark-filed / resolve-issue.
  describe('reviewReconciliation taxReviewerRole gate', () => {
    const taxRepo = (reviewerRole: string | null) => ({
      prisma: { client: { companyTaxProfile: { findUnique: async () => (reviewerRole === null ? null : { taxReviewerRole: reviewerRole }) } } },
    });
    const reconciliation = { review: async () => ({ status: 'REVIEWED' }) };

    it('blocks a permission-holder who lacks the reviewer role', async () => {
      const controller = new TransactionTaxController({} as any, reconciliation as any, {} as any, taxRepo('ACCOUNTANT') as any);
      await assert.rejects(
        () => controller.reviewReconciliation({ companyId: 'c1', roles: ['FINANCE'] } as any, 'c1', 'run1', {}),
        /Tax reviewer role/,
      );
    });

    it('allows the configured reviewer role and defaults to ACCOUNTANT when no profile exists', async () => {
      const configured = new TransactionTaxController({} as any, reconciliation as any, {} as any, taxRepo('FINANCE') as any);
      assert.deepEqual(await configured.reviewReconciliation({ companyId: 'c1', roles: ['FINANCE'] } as any, 'c1', 'run1', {}), { status: 'REVIEWED' });
      const fallback = new TransactionTaxController({} as any, reconciliation as any, {} as any, taxRepo(null) as any);
      assert.deepEqual(await fallback.reviewReconciliation({ companyId: 'c1', roles: ['ACCOUNTANT'] } as any, 'c1', 'run1', {}), { status: 'REVIEWED' });
    });

    it('always allows OWNER', async () => {
      const controller = new TransactionTaxController({} as any, reconciliation as any, {} as any, taxRepo('ACCOUNTANT') as any);
      assert.deepEqual(await controller.reviewReconciliation({ companyId: 'c1', roles: ['OWNER'] } as any, 'c1', 'run1', {}), { status: 'REVIEWED' });
    });
  });
});
