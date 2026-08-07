import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  AUTO_POST_REQUIRED_FEATURES,
  DrainExpenseAutoPostUseCase,
  EXPENSE_AUTO_POST_WORKER_PERMISSIONS,
  expenseAutoPostCandidateSql,
} from './expense-auto-post.use-case';

describe('DrainExpenseAutoPostUseCase', () => {
  it('queries only clean post-activation accrual candidates', () => {
    const query = expenseAutoPostCandidateSql('co-1', new Date('2026-07-29T00:00:00.000Z'), 20);
    const sql = Array.isArray(query.sql) ? query.sql.join(' ') : String(query.sql);
    assert.match(sql, /"confirmedAt"\s*>=/);
    assert.match(sql, /"postingStatus"::text = 'pending'/);
    assert.match(sql, /NOT IN \('NEEDS_REVIEW', 'NOT_TAX_EVIDENCE'\)/);
    assert.match(sql, /"AttachmentLink"/);
    assert.match(sql, /NOT EXISTS[\s\S]*'expense\.record'/);
  });

  it('posts each candidate as expense.record with least privilege and keeps failures retryable', async () => {
    const generated: Array<{ ctx: any; source: any }> = [];
    const errors: any[] = [];
    const prisma = {
      client: {
        company: { findMany: async () => [{
          id: 'co-1',
          featureEntitlements: [
            { featureKey: 'expense_auto_post', enabled: true, updatedAt: new Date('2026-07-29T00:00:00.000Z') },
            { featureKey: 'double_entry_ledger', enabled: true, updatedAt: new Date('2026-07-28T00:00:00.000Z') },
            { featureKey: 'expenses', enabled: true, updatedAt: new Date('2026-07-27T00:00:00.000Z') },
          ],
        }] },
        $queryRaw: async () => [{ id: 'expense-ok' }, { id: 'expense-bad' }],
      },
    } as any;
    const generator = {
      execute: async (ctx: any, source: any) => {
        generated.push({ ctx, source });
        if (source.sourceId === 'expense-bad') {
          throw new BadRequestException({ code: 'period_closed', message: 'sensitive details omitted' });
        }
      },
    } as any;
    const repo = { updatePostingStatus: async (...args: any[]) => { errors.push(args); } } as any;

    const result = await new DrainExpenseAutoPostUseCase(prisma, generator, repo).execute(500);

    assert.deepEqual(result, { companies: 1, candidates: 2, posted: 1, failed: 1 });
    assert.deepEqual(generated.map((call) => call.source), [
      { companyId: 'co-1', sourceType: 'expense.record', sourceId: 'expense-ok' },
      { companyId: 'co-1', sourceType: 'expense.record', sourceId: 'expense-bad' },
    ]);
    assert.deepEqual(generated[0]?.ctx.permissions, [...EXPENSE_AUTO_POST_WORKER_PERMISSIONS]);
    assert.deepEqual(generated[0]?.ctx.roles, []);
    assert.equal(errors[0]?.[2].postingStatus, 'posting_error');
    assert.match(errors[0]?.[2].postingError, /period_closed/);
    assert.doesNotMatch(errors[0]?.[2].postingError, /sensitive/);
  });

  it('stops when the `expenses` family is frozen, even with both auto-post rows still ON', async () => {
    // Freeze in place (owner decision 2026-08-04): `expense_auto_post` is a TOP-LEVEL family, so
    // disabling `expenses` cascades nothing and both auto-post rows stay ON. This worker mints its
    // own permissions and never meets the resolver chokepoint, so `expenses` has to be in its own
    // required set — otherwise it keeps creating journals from, and writing postingStatus onto, the
    // frozen family's rows.
    let queried = false;
    const prisma = {
      client: {
        company: { findMany: async () => [{
          id: 'co-frozen-expenses',
          featureEntitlements: [
            { featureKey: 'expense_auto_post', enabled: true, updatedAt: new Date('2026-07-29T00:00:00.000Z') },
            { featureKey: 'double_entry_ledger', enabled: true, updatedAt: new Date('2026-07-28T00:00:00.000Z') },
            { featureKey: 'expenses', enabled: false, updatedAt: new Date('2026-08-04T00:00:00.000Z') },
          ],
        }] },
        $queryRaw: async () => { queried = true; return [{ id: 'expense-frozen' }]; },
      },
    } as any;

    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any).execute();

    assert.deepEqual(result, { companies: 0, candidates: 0, posted: 0, failed: 0 });
    assert.equal(queried, false, 'the frozen family\'s expense rows are never even read');
    assert.ok(AUTO_POST_REQUIRED_FEATURES.includes('expenses'));
  });

  it('does nothing when no active company has both entitlements', async () => {
    let queried = false;
    const prisma = {
      client: {
        company: { findMany: async () => [] },
        $queryRaw: async () => { queried = true; return []; },
      },
    } as any;
    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any).execute();
    assert.deepEqual(result, { companies: 0, candidates: 0, posted: 0, failed: 0 });
    assert.equal(queried, false);
  });

  it('probes the unfiltered active company set before excluding a disabled family', async () => {
    const records: Array<[string, string]> = [];
    let flushed = false;
    const prisma = {
      client: {
        // The exact row shape a freeze-in-place disable leaves behind: the rows still exist and
        // still carry their activation timestamp, they are just `enabled: false`. The drain must
        // skip the company instead of reading its expenses (the query below throws if it does not).
        company: { findMany: async () => [{
          id: 'co-disabled',
          featureEntitlements: [
            { featureKey: 'expense_auto_post', enabled: false, updatedAt: new Date('2026-07-29T00:00:00.000Z') },
            { featureKey: 'double_entry_ledger', enabled: false, updatedAt: new Date('2026-07-28T00:00:00.000Z') },
          ],
        }] },
        $queryRaw: async () => { throw new Error('disabled company reached posting query'); },
      },
    } as any;
    const shadow = {
      startSweep: () => ({
        record: async (companyId: string, featureKey: string) => { records.push([companyId, featureKey]); },
        flush: async () => { flushed = true; return {}; },
      }),
    } as any;

    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any, shadow).execute();

    assert.deepEqual(result, { companies: 0, candidates: 0, posted: 0, failed: 0 });
    assert.deepEqual(records, [['co-disabled', 'expense_auto_post']]);
    assert.equal(flushed, true);
  });
});
