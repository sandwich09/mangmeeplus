import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AUTO_POST_REQUIRED_FEATURES,
  DrainExpenseAutoPostUseCase,
  EXPENSE_AUTO_POST_WORKER_PERMISSIONS,
  expenseAutoPostCandidateSql,
  postingFailureCode,
} from './expense-auto-post.use-case';

describe('DrainExpenseAutoPostUseCase', () => {
  it('queries clean post-activation accruals and waits for accrual before each payment', () => {
    const query = expenseAutoPostCandidateSql('co-1', new Date('2026-07-29T00:00:00.000Z'), 20);
    const sql = Array.isArray(query.sql) ? query.sql.join(' ') : String(query.sql);
    assert.match(sql, /"confirmedAt"\s*>=/);
    assert.match(sql, /"postingStatus"::text = 'pending'/);
    assert.match(sql, /NOT IN \('NEEDS_REVIEW', 'NOT_TAX_EVIDENCE'\)/);
    assert.match(sql, /"AttachmentLink"/);
    assert.match(sql, /NOT EXISTS[\s\S]*'expense\.record'/);
    assert.match(sql, /"ExpensePayment"/);
    assert.match(sql, /payment\."createdAt"\s*>=/);
    assert.match(sql, /accrual\."status"::text = 'POSTED'/);
    assert.match(sql, /journal\."sourceType" = 'expense\.payment'/);
  });

  it('posts accrual and payment candidates with least privilege and marks the failing source only', async () => {
    const generated: Array<{ ctx: any; source: any }> = [];
    const expenseErrors: any[] = [];
    const paymentErrors: any[] = [];
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
        $queryRaw: async () => [
          { sourceType: 'expense.record', sourceId: 'expense-ok' },
          { sourceType: 'expense.payment', sourceId: 'payment-bad' },
        ],
      },
    } as any;
    const generator = {
      execute: async (ctx: any, source: any) => {
        generated.push({ ctx, source });
        if (source.sourceId === 'payment-bad') {
          throw new BadRequestException({ code: 'period_closed', message: 'sensitive details omitted' });
        }
      },
    } as any;
    const repo = {
      updatePostingStatus: async (...args: any[]) => { expenseErrors.push(args); },
      updatePaymentPostingStatus: async (...args: any[]) => { paymentErrors.push(args); },
    } as any;

    const result = await new DrainExpenseAutoPostUseCase(prisma, generator, repo, {} as any).execute(500);

    assert.deepEqual(result, { companies: 1, candidates: 2, posted: 1, failed: 1 });
    assert.deepEqual(generated.map((call) => call.source), [
      { companyId: 'co-1', sourceType: 'expense.record', sourceId: 'expense-ok' },
      { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-bad' },
    ]);
    assert.deepEqual(generated[0]?.ctx.permissions, [...EXPENSE_AUTO_POST_WORKER_PERMISSIONS]);
    assert.deepEqual(generated[0]?.ctx.roles, []);
    assert.equal(expenseErrors.length, 0);
    assert.equal(paymentErrors[0]?.[2].postingStatus, 'posting_error');
    assert.match(paymentErrors[0]?.[2].postingError, /period_closed/);
    assert.doesNotMatch(paymentErrors[0]?.[2].postingError, /sensitive/);
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

    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any, {} as any).execute();

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
    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any, {} as any).execute();
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

    const result = await new DrainExpenseAutoPostUseCase(prisma, {} as any, {} as any, {} as any, shadow).execute();

    assert.deepEqual(result, { companies: 0, candidates: 0, posted: 0, failed: 0 });
    assert.deepEqual(records, [['co-disabled', 'expense_auto_post']]);
    assert.equal(flushed, true);
  });
});

// 2026-10-01: a claim payout is a posting source the worker drains too, under the rules the
// expense sources already follow. Before this the payment stayed `pending` until someone called
// the generate endpoint by hand, and no screen or worker did.
describe('DrainExpenseAutoPostUseCase — claim payouts', () => {
  const sqlText = (query: { sql: unknown }) => (Array.isArray(query.sql) ? query.sql.join(' ') : String(query.sql));
  const claimBranch = (sql: string) => sql.slice(sql.indexOf(`'reimbursement.payment'::text`));

  it('selects a recorded, pending, post-activation payout only once every claim accrual is posted', () => {
    const sql = sqlText(expenseAutoPostCandidateSql('co-1', new Date('2026-07-29T00:00:00.000Z'), 20));
    const claim = claimBranch(sql);
    assert.match(claim, /FROM "ReimbursementPayment" AS payment/);
    // Same gates as an expense payment: recorded, pending, activation boundary, no journal yet.
    assert.match(claim, /payment\."status"::text = 'RECORDED'/);
    assert.match(claim, /payment\."postingStatus"::text = 'pending'/);
    assert.match(claim, /payment\."createdAt"\s*>=/);
    assert.match(claim, /NOT EXISTS[\s\S]*journal\."sourceType" = 'reimbursement\.payment'[\s\S]*journal\."entryType"::text = 'GENERATED'/);
    // "A settlement waits for its accrual": no claim line may lack a posted accrual…
    assert.match(claim, /NOT EXISTS[\s\S]*FROM "ReimbursementLine" AS line[\s\S]*NOT EXISTS[\s\S]*FROM "ExpenseRecord" AS projection/);
    assert.match(claim, /projection\."sourceReimbursementLineId" = line\."id"/);
    assert.match(claim, /projection\."status"::text = 'CONFIRMED'\s+AND EXISTS \(\s+SELECT 1\s+FROM "JournalEntry" AS accrual[\s\S]*accrual\."sourceType" = 'expense\.record'[\s\S]*accrual\."status"::text = 'POSTED'/);
    // …a suspected duplicate keeps the settlement waiting, a confirmed one needs no accrual.
    assert.match(claim, /NOT IN \('POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'\)/);
    assert.match(claim, /'CONFIRMED_DUPLICATE'\s+AND projection\."postingStatus"::text = 'not_required'/);
    // A voided payout is never a candidate: the void reverses its journal in its own transaction.
    assert.doesNotMatch(claim, /VOIDED/);
    // Company-scoped like every other branch, and ordered after the expense sources of one instant.
    assert.match(claim, /payment\."companyId" = /);
    assert.match(claim, /2 AS "sortOrder"/);
  });

  it('leaves the claim branch out entirely when the reimbursement family is frozen', () => {
    const sql = sqlText(expenseAutoPostCandidateSql('co-1', new Date('2026-07-29T00:00:00.000Z'), 20, false));
    assert.doesNotMatch(sql, /ReimbursementPayment|reimbursement\.payment/);
    assert.match(sql, /"ExpensePayment"/, 'the expense sources are untouched');
  });

  function company(reimbursement?: boolean) {
    return {
      id: 'co-1',
      featureEntitlements: [
        { featureKey: 'expense_auto_post', enabled: true, updatedAt: new Date('2026-07-29T00:00:00.000Z') },
        { featureKey: 'double_entry_ledger', enabled: true, updatedAt: new Date('2026-07-28T00:00:00.000Z') },
        { featureKey: 'expenses', enabled: true, updatedAt: new Date('2026-07-27T00:00:00.000Z') },
        ...(reimbursement === undefined ? [] : [{ featureKey: 'reimbursement', enabled: reimbursement, updatedAt: new Date('2026-07-27T00:00:00.000Z') }]),
      ],
    };
  }

  it('posts a claim payout through the canonical generator and marks only that payment on failure', async () => {
    const generated: any[] = [];
    const expenseWrites: any[] = [];
    const claimWrites: any[] = [];
    let entitlementFilter: string[] = [];
    const prisma = {
      client: {
        company: { findMany: async (args: any) => {
          entitlementFilter = args.select.featureEntitlements.where.featureKey.in;
          return [company(true)];
        } },
        $queryRaw: async () => [
          { sourceType: 'reimbursement.payment', sourceId: 'pay-ok' },
          { sourceType: 'reimbursement.payment', sourceId: 'pay-unmapped' },
        ],
      },
    } as any;
    const generator = {
      execute: async (ctx: any, source: any) => {
        generated.push({ ctx, source });
        // What a company on the standard chart answers today: no reviewed settlement mapping.
        if (source.sourceId === 'pay-unmapped') throw new BadRequestException({ code: 'posting_rule_missing', message: 'internal detail' });
      },
    } as any;
    const expenseRepo = {
      updatePostingStatus: async (...args: any[]) => { expenseWrites.push(args); },
      updatePaymentPostingStatus: async (...args: any[]) => { expenseWrites.push(args); },
    } as any;
    const reimbursementRepo = {
      findPostedGeneratedJournalId: async () => null,
      updatePaymentPostingStatus: async (...args: any[]) => { claimWrites.push(args); return true; },
    } as any;
    const logged: any[] = [];
    const drain = new DrainExpenseAutoPostUseCase(prisma, generator, expenseRepo, reimbursementRepo);
    (drain as any).logger = { warn: (line: unknown) => { logged.push(line); } };

    const result = await drain.execute();

    assert.deepEqual(result, { companies: 1, candidates: 2, posted: 1, failed: 1 });
    // The payment row has no error column, so the reason is kept in one structured line: which
    // payout, which company, and the stable code. Never the exception's free text.
    assert.deepEqual(logged, [{ msg: 'ledger.auto_post.claim_payout_failed', companyId: 'co-1', paymentId: 'pay-unmapped', code: 'posting_rule_missing' }]);
    assert.deepEqual(generated.map((call) => call.source), [
      { companyId: 'co-1', sourceType: 'reimbursement.payment', sourceId: 'pay-ok' },
      { companyId: 'co-1', sourceType: 'reimbursement.payment', sourceId: 'pay-unmapped' },
    ]);
    // No new authority: the worker posts a payout with the permissions it already carried.
    assert.deepEqual(generated[0].ctx.permissions, [...EXPENSE_AUTO_POST_WORKER_PERMISSIONS]);
    assert.deepEqual(generated[0].ctx.roles, []);
    // The failed payout goes to the accountant's worklist; the posted one is the generator's to mark.
    assert.deepEqual(claimWrites, [['co-1', 'pay-unmapped', { postingStatus: 'posting_error' }]]);
    assert.deepEqual(expenseWrites, [], 'an expense row is never blamed for a claim payout');
    // `reimbursement` is read for the freeze, but is NOT a requirement of the drain itself.
    assert.ok(entitlementFilter.includes('reimbursement'));
    assert.equal(AUTO_POST_REQUIRED_FEATURES.includes('reimbursement'), false);
  });

  // Review finding 2026-10-01: the worker's stamp was unguarded. Between reading the candidates and
  // generating, a void can commit, or an accountant (or a second pass) can post the same payout.
  function refusedPayout(repo: { journalId: string | null; recorded: boolean }) {
    const stamps: any[] = [];
    const logged: any[] = [];
    const prisma = {
      client: {
        company: { findMany: async () => [company(true)] },
        $queryRaw: async () => [{ sourceType: 'reimbursement.payment', sourceId: 'pay-1' }],
      },
    } as any;
    const generator = { execute: async () => { throw new BadRequestException({ code: 'reimbursement_payment_not_recorded', message: 'x' }); } } as any;
    const reimbursementRepo = {
      findPostedGeneratedJournalId: async () => repo.journalId,
      // The real stamp writes a RECORDED payment only and says whether it wrote.
      updatePaymentPostingStatus: async (...args: any[]) => { stamps.push(args[2].postingStatus); return repo.recorded; },
    } as any;
    const drain = new DrainExpenseAutoPostUseCase(prisma, generator, {} as any, reimbursementRepo);
    (drain as any).logger = { warn: (line: unknown) => { logged.push(line); } };
    return { drain, stamps, logged };
  }

  it('a payout voided after the candidates were read is neither failed nor posted, and is not logged as a failure', async () => {
    const { drain, logged } = refusedPayout({ journalId: null, recorded: false });
    assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 0, failed: 0 });
    assert.deepEqual(logged, []);
  });

  it('a refused payout that already has a posted settlement is stamped posted, never posting_error', async () => {
    const { drain, stamps, logged } = refusedPayout({ journalId: 'je-1', recorded: true });
    assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
    assert.deepEqual(stamps, ['posted']);
    assert.deepEqual(logged, []);
  });

  it('a refused payout with no settlement is stamped posting_error and its reason is logged', async () => {
    const { drain, stamps, logged } = refusedPayout({ journalId: null, recorded: true });
    assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 0, failed: 1 });
    assert.deepEqual(stamps, ['posting_error']);
    assert.equal(logged[0].code, 'reimbursement_payment_not_recorded');
  });

  it('logs a stable code for every shape of refusal and never free text', () => {
    assert.equal(postingFailureCode(new BadRequestException({ code: 'period_closed', message: 'งวดบัญชีถูกปิดแล้ว' })), 'period_closed');
    // The readiness proof throws its code as the message.
    assert.equal(postingFailureCode(new ConflictException('reimbursement_accrual_not_posted')), 'reimbursement_accrual_not_posted');
    assert.equal(postingFailureCode(Object.assign(new Error('Unique constraint failed on the fields'), { code: 'P2002' })), 'P2002');
    assert.equal(postingFailureCode(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret')), 'AUTO_POST_FAILED');
    assert.equal(postingFailureCode(new ConflictException('Generated journal JV-1 is DRAFT; resolve its posting state')), 'AUTO_POST_FAILED');
    assert.equal(postingFailureCode(undefined), 'AUTO_POST_FAILED');
  });

  for (const [name, reimbursement, expected] of [
    ['an explicit OFF row freezes the claim branch, and the expense sources keep draining', false, false],
    ['an explicit ON row drains claim payouts', true, true],
    ['a company without the row inherits the family from expenses, as the evaluator reads it', undefined, true],
  ] as const) {
    it(name, async () => {
      let sql = '';
      const prisma = {
        client: {
          company: { findMany: async () => [company(reimbursement)] },
          $queryRaw: async (query: any) => { sql = sqlText(query); return [{ sourceType: 'expense.record', sourceId: 'expense-1' }]; },
        },
      } as any;
      const result = await new DrainExpenseAutoPostUseCase(prisma, { execute: async () => undefined } as any, {} as any, {} as any).execute();
      assert.equal(sql.includes('"ReimbursementPayment"'), expected);
      assert.deepEqual(result, { companies: 1, candidates: 1, posted: 1, failed: 0 });
    });
  }
});
