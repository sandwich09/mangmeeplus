import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PreviewExpenseBackfillUseCase,
  RunExpenseBackfillUseCase,
  expenseBackfillCandidateSql,
} from './expense-backfill.use-case';

function ctx(permissions = ['expense.read', 'journal.entry.create', 'journal.entry.post']) {
  return {
    companyId: 'co-1',
    userId: 'accountant-1',
    requestId: 'request-1',
    permissions,
    roles: [],
    scopes: { branchIds: ['branch-1'] },
  } as any;
}

describe('PreviewExpenseBackfillUseCase', () => {
  it('returns pre-activation eligible/manual counts, blockers, and bounded samples', async () => {
    const queries: any[] = [];
    let rawCall = 0;
    const prisma = {
      client: {
        company: {
          findFirst: async () => ({
            featureEntitlements: [{ updatedAt: new Date('2026-07-29T00:00:00.000Z') }],
          }),
        },
        $queryRaw: async (query: any) => {
          queries.push(query);
          rawCall += 1;
          if (rawCall === 1) return [{
            totalHistoricalPending: 8n,
            eligibleCount: 5n,
            manualReviewCount: 3n,
            noActiveEvidence: 2n,
            taxEvidenceNeedsReview: 1n,
            notTaxEvidence: 1n,
            vendorNameMissing: 1n,
          }];
          return [{
            id: 'expense-warning',
            expenseNumber: 'EXP-OLD-1',
            vendorNameSnapshot: ' ',
            confirmedAt: new Date('2026-07-01T00:00:00.000Z'),
            taxEvidenceStatus: 'NEEDS_REVIEW',
            activeEvidenceCount: 0,
          }];
        },
      },
    } as any;

    const result = await new PreviewExpenseBackfillUseCase(prisma).execute(ctx(), 10);

    assert.equal(result.activationAt, '2026-07-29T00:00:00.000Z');
    assert.equal(result.totalHistoricalPending, 8);
    assert.equal(result.eligibleCount, 5);
    assert.equal(result.manualReviewCount, 3);
    assert.deepEqual(result.blockerCounts, {
      NO_ACTIVE_EVIDENCE: 2,
      TAX_EVIDENCE_NEEDS_REVIEW: 1,
      NOT_TAX_EVIDENCE: 1,
      VENDOR_NAME_MISSING: 1,
    });
    assert.deepEqual(result.samples[0]?.blockers, [
      'NO_ACTIVE_EVIDENCE',
      'TAX_EVIDENCE_NEEDS_REVIEW',
      'VENDOR_NAME_MISSING',
    ]);
    assert.ok(queries.flatMap((query) => query.values).includes('branch-1'));
  });

  it('requires read and both journal permissions before querying', async () => {
    const useCase = new PreviewExpenseBackfillUseCase({} as any);
    await assert.rejects(() => useCase.execute(ctx(['expense.read'])), ForbiddenException);
  });

  it('fails closed when Auto-post or the ledger is not enabled', async () => {
    const prisma = {
      client: {
        company: { findFirst: async () => null },
      },
    } as any;
    await assert.rejects(
      () => new PreviewExpenseBackfillUseCase(prisma).execute(ctx()),
      (error: unknown) => {
        // spec:333 — feature absence is 403, never 400.
        assert.ok(error instanceof ForbiddenException);
        assert.ok(!(error instanceof BadRequestException));
        assert.equal(error.getStatus(), 403);
        assert.equal((error.getResponse() as any).code, 'expense_auto_post_not_enabled');
        return true;
      },
    );
  });

  it('builds a clean, pre-activation, branch-scoped candidate query', () => {
    const query = expenseBackfillCandidateSql(
      'co-1',
      new Date('2026-07-29T00:00:00.000Z'),
      ['branch-1'],
      20,
    );
    const sql = Array.isArray(query.sql) ? query.sql.join(' ') : String(query.sql);
    assert.match(sql, /"confirmedAt"\s*</);
    assert.match(sql, /"branchId" IS NULL OR expense\."branchId" IN/);
    assert.match(sql, /NOT IN \('NEEDS_REVIEW', 'NOT_TAX_EVIDENCE'\)/);
    assert.match(sql, /NOT EXISTS[\s\S]*'expense\.record'/);
  });
});

describe('RunExpenseBackfillUseCase', () => {
  it('requires explicit confirmation', async () => {
    const useCase = new RunExpenseBackfillUseCase({} as any, {} as any, {} as any, {} as any, {} as any);
    await assert.rejects(
      () => useCase.execute(ctx(), { confirmed: false }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as any).code, 'expense_backfill_confirmation_required');
        return true;
      },
    );
  });

  it('posts only selected eligible rows, keeps failures retryable, and audits only summary counts', async () => {
    let previewCall = 0;
    const preview = {
      execute: async () => {
        previewCall += 1;
        return previewCall === 1
          ? { activationAt: '2026-07-29T00:00:00.000Z', eligibleCount: 2, manualReviewCount: 3 }
          : { activationAt: '2026-07-29T00:00:00.000Z', eligibleCount: 0, manualReviewCount: 3 };
      },
    } as any;
    const prisma = {
      client: {
        $queryRaw: async () => [{ id: 'expense-ok' }, { id: 'expense-closed' }],
      },
    } as any;
    const postedSources: any[] = [];
    const generator = {
      execute: async (_ctx: any, source: any) => {
        postedSources.push(source);
        if (source.sourceId === 'expense-closed') {
          throw new BadRequestException({ code: 'period_closed', message: 'hidden source details' });
        }
      },
    } as any;
    const postingErrors: any[] = [];
    const repo = {
      updatePostingStatus: async (...args: any[]) => { postingErrors.push(args); },
    } as any;
    const auditRows: any[] = [];
    const audit = { log: async (entry: any) => { auditRows.push(entry); } } as any;

    const result = await new RunExpenseBackfillUseCase(
      prisma,
      preview,
      generator,
      repo,
      audit,
    ).execute(ctx(), { confirmed: true, limit: 500 });

    assert.deepEqual(result, {
      activationAt: '2026-07-29T00:00:00.000Z',
      eligibleAtStart: 2,
      attempted: 2,
      posted: 1,
      failed: 1,
      skipped: 3,
      remaining: 0,
    });
    assert.ok(postedSources.every((source) => source.sourceType === 'expense.record'));
    assert.equal(postingErrors[0]?.[2].postingStatus, 'posting_error');
    assert.match(postingErrors[0]?.[2].postingError, /period_closed/);
    assert.doesNotMatch(postingErrors[0]?.[2].postingError, /hidden/);
    assert.equal(auditRows[0]?.action, 'ledger.expense_backfill.run');
    assert.deepEqual(auditRows[0]?.metadataJson, { ...result, limit: 100 });
    assert.equal(JSON.stringify(auditRows[0]).includes('expense-ok'), false);
  });
});
