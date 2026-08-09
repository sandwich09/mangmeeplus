import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ListExpenseAccountBindingsUseCase,
  SetExpenseAccountBindingUseCase,
} from './expense-account-binding.use-case.js';

const ctx = (permissions: string[]) => ({
  companyId: 'co-1', userId: 'user-1', requestId: 'req-1', permissions,
} as any);

/** One usable company account (5320-01) plus categories in every binding state. */
function harness(options: { categories?: any[] } = {}) {
  const calls = { updates: [] as any[], audits: [] as any[], accountWhere: [] as any[] };
  const categories = options.categories ?? [
    { id: 'cat-fuel', name: 'ค่าน้ำมัน', status: 'ACTIVE', accountHintKey: 'FUEL', ledgerAccountCode: '5320-01' },
    { id: 'cat-phone', name: 'ค่าโทรศัพท์', status: 'ACTIVE', accountHintKey: 'PHONE', ledgerAccountCode: null },
    { id: 'cat-stale', name: 'หมวดเก่า', status: 'ACTIVE', accountHintKey: 'OLD', ledgerAccountCode: '9999-99' },
  ];
  const prisma = {
    client: {
      expenseCategory: {
        findMany: async () => categories,
        findFirst: async ({ where }: any) =>
          categories.find((category) => category.id === where.id && where.companyId === 'co-1') ?? null,
        update: async (args: any) => { calls.updates.push(args); return args; },
      },
      chartOfAccount: {
        findMany: async ({ where }: any) => {
          calls.accountWhere.push(where);
          // Only 5320-01 satisfies ACTIVE + isPosting + !isControlled for this company. 9999-99 (the
          // suspense control account) and anything unknown fall out of the same query the readiness
          // check uses, so they never come back as usable.
          const codes: string[] = where.code.in;
          return codes.includes('5320-01') ? [{ id: 'acc-1', code: '5320-01', nameTh: 'ค่าซ่อมแซม' }] : [];
        },
      },
    },
  } as any;
  const audit = { log: async (entry: any) => { calls.audits.push(entry); } } as any;
  return { calls, prisma, audit };
}

describe('ListExpenseAccountBindingsUseCase', () => {
  it('marks a category postable only when its code resolves to a usable company account', async () => {
    const { prisma } = harness();
    const rows = await new ListExpenseAccountBindingsUseCase(prisma).execute(ctx(['ledger.posting-rule.read']));

    assert.deepEqual(
      rows.map((row) => [row.categoryId, row.postable]),
      [['cat-fuel', true], ['cat-phone', false], ['cat-stale', false]],
    );
    // An unmapped category and one pointing at an unusable account are both not-postable, but the
    // operator has to tell them apart to know what to fix.
    assert.equal(rows[1]!.ledgerAccountCode, null);
    assert.equal(rows[2]!.ledgerAccountCode, '9999-99');
    assert.equal(rows[0]!.ledgerAccountNameTh, 'ค่าซ่อมแซม');
  });

  it('refuses a caller without the posting-rule read permission', async () => {
    const { prisma } = harness();
    await assert.rejects(
      () => new ListExpenseAccountBindingsUseCase(prisma).execute(ctx(['expense.category.manage'])),
      /ledger.posting-rule.read/,
    );
  });
});

describe('SetExpenseAccountBindingUseCase', () => {
  it('binds a category to a usable account and audits the before/after pair', async () => {
    const { prisma, audit, calls } = harness();
    const result = await new SetExpenseAccountBindingUseCase(prisma, audit)
      .execute(ctx(['ledger.posting-rule.manage']), 'cat-phone', { ledgerAccountCode: '5320-01' });

    assert.equal(result.postable, true);
    assert.equal(result.ledgerAccountCode, '5320-01');
    assert.deepEqual(calls.updates[0].data, { ledgerAccountCode: '5320-01' });
    assert.equal(calls.audits[0].action, 'ledger.expense-account-binding.set');
    assert.equal(calls.audits[0].riskLevel, 'HIGH');
    assert.deepEqual(calls.audits[0].metadataJson.from, null);
    assert.equal(calls.audits[0].metadataJson.to, '5320-01');
  });

  it('clears a binding when given null, returning the category to unreviewed', async () => {
    const { prisma, audit, calls } = harness();
    const result = await new SetExpenseAccountBindingUseCase(prisma, audit)
      .execute(ctx(['ledger.posting-rule.manage']), 'cat-fuel', { ledgerAccountCode: null });

    assert.equal(result.ledgerAccountCode, null);
    assert.equal(result.postable, false);
    assert.deepEqual(calls.updates[0].data, { ledgerAccountCode: null });
    assert.equal(calls.audits[0].metadataJson.from, '5320-01');
  });

  // The control account is exactly what a "just point it somewhere" answer would reach for, and the
  // readiness check rejects it, so the writer must refuse it at the source.
  it('rejects the suspense control account and writes nothing', async () => {
    const { prisma, audit, calls } = harness();
    await assert.rejects(
      () => new SetExpenseAccountBindingUseCase(prisma, audit)
        .execute(ctx(['ledger.posting-rule.manage']), 'cat-phone', { ledgerAccountCode: '9999-99' }),
      (error: any) => error.getResponse?.().code === 'ledger_account_not_postable',
    );
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
  });

  it('only ever looks up accounts owned by the caller company', async () => {
    const { prisma, audit, calls } = harness();
    await new SetExpenseAccountBindingUseCase(prisma, audit)
      .execute(ctx(['ledger.posting-rule.manage']), 'cat-phone', { ledgerAccountCode: '5320-01' });

    // Not `{ OR: [{ companyId }, { companyId: null }] }` like the posting-time lookup: a shared
    // system account must never become one tenant's reviewed expense mapping.
    assert.equal(calls.accountWhere[0].companyId, 'co-1');
    assert.equal(calls.accountWhere[0].isControlled, false);
    assert.equal(calls.accountWhere[0].isPosting, true);
    assert.equal(calls.accountWhere[0].status, 'ACTIVE');
  });

  it('reports a category from another company as not found', async () => {
    const { prisma, audit } = harness();
    await assert.rejects(
      () => new SetExpenseAccountBindingUseCase(prisma, audit)
        .execute({ ...ctx(['ledger.posting-rule.manage']), companyId: 'co-2' }, 'cat-fuel', { ledgerAccountCode: '5320-01' }),
      /not found/i,
    );
  });

  it('refuses a caller holding only the read permission', async () => {
    const { prisma, audit, calls } = harness();
    await assert.rejects(
      () => new SetExpenseAccountBindingUseCase(prisma, audit)
        .execute(ctx(['ledger.posting-rule.read']), 'cat-phone', { ledgerAccountCode: '5320-01' }),
      /ledger.posting-rule.manage/,
    );
    assert.equal(calls.updates.length, 0);
  });
});
