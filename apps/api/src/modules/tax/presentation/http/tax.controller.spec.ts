import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaxController } from './tax.controller.js';

const ctx = { companyId: 'company-1', userId: 'user-1', roles: ['ACCOUNTANT'], permissions: [], scopes: {}, requestId: 'request-1' } as any;

function controller(repo: any) {
  const noop = {} as any;
  return new TaxController(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => undefined } as any);
}

/** Wraps a repo with a companyTaxProfile.findUnique stub (null → default ACCOUNTANT reviewer). */
function withProfile(repo: any, taxReviewerRole: string | null = null) {
  const client = repo.prisma?.client ?? {};
  return {
    ...repo,
    prisma: { client: { ...client, companyTaxProfile: { findUnique: async () => (taxReviewerRole === null ? null : { companyId: 'company-1', taxReviewerRole }) } } },
  };
}

describe('TaxController tenant and filing transition gates', () => {
  it('does not resolve a review issue outside the request company', async () => {
    let resolved = false;
    const value = controller(withProfile({
      prisma: { client: { taxReviewIssue: { findFirst: async ({ where }: any) => {
        assert.equal(where.companyId, 'company-1');
        return null;
      } } } },
      resolveIssue: async () => { resolved = true; },
    }));
    await assert.rejects(() => value.resolveIssue(ctx, 'company-1', 'foreign-issue', { note: 'checked' }), /not found/i);
    assert.equal(resolved, false);
  });

  it('requires an exported period before mark-filed', async () => {
    const value = controller(withProfile({
      findPeriodById: async (companyId: string) => ({ id: 'period-1', companyId, status: 'REVIEWED', formType: 'PP30', periodKey: '2026-07' }),
    }));
    await assert.rejects(() => value.markFiled(ctx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('rejects a route company that differs from the authenticated company', async () => {
    const value = controller({});
    await assert.rejects(() => value.markPaid(ctx, 'company-2', 'period-1', {}), /company/i);
  });
});

describe('narrow PND53 routes', () => {
  it('lists only PND53 periods for the authenticated company', async () => {
    const value = controller({
      findPeriods: async (companyId: string, filters: unknown) => {
        assert.equal(companyId, 'company-1');
        assert.deepEqual(filters, { taxType: 'WHT', formType: 'PND53', pageSize: 100 });
        return { items: [], total: 0 };
      },
    });
    assert.deepEqual(await value.listPnd53Periods(ctx, 'company-1'), { items: [], total: 0 });
    await assert.rejects(() => value.listPnd53Periods(ctx, 'company-2'), /company/i);
  });

  it('refuses export and event reads for a VAT or PND3 period before calling the report service', async () => {
    for (const formType of ['PP30', 'PND3']) {
      const value = controller({
        findPeriodById: async () => ({ id: 'other-period', formType, periodKey: '2026-09' }),
      });
      await assert.rejects(() => value.exportPnd53(ctx, 'company-1', 'other-period', { exportFormat: 'PDF' }), /PND53 period not found/);
      await assert.rejects(() => value.listPnd53Events(ctx, 'company-1', 'other-period'), /PND53 period not found/);
      await assert.rejects(() => value.listPnd53Issues(ctx, 'company-1', 'other-period'), /PND53 period not found/);
      await assert.rejects(() => value.markPnd53Filed(ctx, 'company-1', 'other-period', {}), /PND53 period not found/);
    }
  });
});

describe('GAP-04 taxReviewerRole enforcement', () => {
  // A period stuck at REVIEWED so mark-filed reaches its transition guard only after the reviewer-role gate passes.
  const reviewedPeriodRepo = (taxReviewerRole: string | null) => withProfile({
    findPeriodById: async (companyId: string) => ({ id: 'period-1', companyId, status: 'REVIEWED', formType: 'PP30', periodKey: '2026-07' }),
  }, taxReviewerRole);

  it('lets the default ACCOUNTANT reviewer through the gate (no profile row)', async () => {
    const value = controller(reviewedPeriodRepo(null));
    // ACCOUNTANT clears the reviewer gate, then fails the later transition guard, not a 403.
    await assert.rejects(() => value.markFiled(ctx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('blocks a FINANCE user (holds permission, wrong reviewer role) with 403 tax_reviewer_role_required', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    const value = controller(reviewedPeriodRepo(null)); // default reviewer = ACCOUNTANT
    await assert.rejects(
      () => value.markFiled(financeCtx, 'company-1', 'period-1', {}),
      (err: any) => {
        assert.equal(err?.response?.code, 'tax_reviewer_role_required');
        assert.match(err?.response?.message, /ACCOUNTANT/);
        return true;
      },
    );
  });

  it('OWNER passes the gate regardless of configured reviewer role', async () => {
    const ownerCtx = { ...ctx, roles: ['OWNER'] };
    const value = controller(reviewedPeriodRepo('FINANCE'));
    await assert.rejects(() => value.markFiled(ownerCtx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('with reviewer role FINANCE, a FINANCE user passes and an ACCOUNTANT is blocked', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    const passRepo = reviewedPeriodRepo('FINANCE');
    await assert.rejects(() => controller(passRepo).markFiled(financeCtx, 'company-1', 'period-1', {}), /current reviewed export package/i);

    const blockRepo = reviewedPeriodRepo('FINANCE');
    await assert.rejects(
      () => controller(blockRepo).markFiled(ctx, 'company-1', 'period-1', {}),
      (err: any) => {
        assert.equal(err?.response?.code, 'tax_reviewer_role_required');
        assert.match(err?.response?.message, /FINANCE/);
        return true;
      },
    );
  });

  it('gates resolveIssue on the reviewer role too', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    let resolved = false;
    const value = controller(withProfile({
      prisma: { client: { taxReviewIssue: { findFirst: async () => { resolved = true; return null; } } } },
      resolveIssue: async () => { resolved = true; },
    }, null));
    await assert.rejects(
      () => value.resolveIssue(financeCtx, 'company-1', 'issue-1', { note: 'x' }),
      (err: any) => { assert.equal(err?.response?.code, 'tax_reviewer_role_required'); return true; },
    );
    assert.equal(resolved, false); // rejected before touching the issue
  });
});
