import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenerateJournalFromSourceUseCase } from './journal.use-case.js';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context.js';
import { requiresReviewedPostingRules } from '../../domain/logic/posting-engine.logic.js';

const ctx = {
  companyId: 'co-1',
  userId: 'user-1',
  requestId: 'req-1',
  permissions: ['journal.entry.post'],
  scopes: {},
} as any;

function harness() {
  const calls = {
    reserved: 0,
    created: 0,
    companyOnly: [] as boolean[],
    accountCodes: [] as string[],
    expenseStatuses: [] as any[],
    documentStatuses: [] as any[],
  };
  const ledgerRepo = {
    findGeneratedJournal: async () => null,
    findPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
    findActivePostingRule: async (_companyId: string, _documentType: string, _ruleKey: string, companyOnly: boolean) => {
      calls.companyOnly.push(companyOnly);
      return null;
    },
    findAccountByCode: async (_companyId: string, code: string) => {
      calls.accountCodes.push(code);
      return null;
    },
    createJournalEntry: async () => {
      calls.created += 1;
      throw new Error('must not create a journal');
    },
  } as any;
  const accountingRepo = {
    findDocumentById: async () => ({
      id: 'invoice-1',
      companyId: 'co-1',
      branchId: null,
      documentType: 'INVOICE',
      documentNumber: 'INV-1',
      status: 'ISSUED',
      documentDate: new Date('2026-07-29T00:00:00.000Z'),
      currency: 'THB',
      vatMode: 'NO_VAT',
      subtotalAmount: '100',
      discountAmount: '0',
      taxableAmount: '100',
      vatAmount: '0',
      whtAmount: '0',
      grandTotalAmount: '100',
      paidAmount: '0',
      outstandingAmount: '100',
      postingStatus: 'pending',
      issuedAt: new Date('2026-07-29T00:00:00.000Z'),
      createdByUserId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      lines: [],
    }),
    updateDocumentPostingStatus: async (_companyId: string, _id: string, update: any) => {
      calls.documentStatuses.push(update);
    },
  } as any;
  const expenseRepo = {
    findByIdWithRelations: async () => ({
      id: 'expense-1',
      companyId: 'co-1',
      branchId: null,
      status: 'CONFIRMED',
      expenseNumber: 'EXP-1',
      expenseDate: new Date('2026-07-29T00:00:00.000Z'),
      currency: 'THB',
      vendorCounterpartyId: null,
      sourceReimbursementRequestId: null,
      grandTotalAmount: '100',
      vatAmount: '0',
      whtAmount: '0',
      paidAmount: '0',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      lines: [],
    }),
    updatePostingStatus: async (_companyId: string, _id: string, update: any) => {
      calls.expenseStatuses.push(update);
    },
  } as any;
  const reserve = {
    execute: async () => {
      calls.reserved += 1;
      return { id: 'reservation-1', documentNumber: 'JV-1' };
    },
  } as any;
  const prisma = {
    client: {
      company: {
        findUnique: async () => ({
          baseCurrency: 'THB',
          chartOfAccountsTemplateKey: 'TH_SME_COA_V1',
          chartOfAccountsTemplateVersion: 1,
          chartOfAccountsTemplateChecksum: 'checksum',
          chartOfAccountsTemplateAppliedAt: new Date(),
        }),
      },
    },
  } as any;
  const useCase = new GenerateJournalFromSourceUseCase(
    ledgerRepo,
    { log: async () => undefined } as any,
    reserve,
    { execute: async () => undefined } as any,
    { append: async () => undefined } as any,
    accountingRepo,
    expenseRepo,
    {} as any,
    {} as any,
    prisma,
  );
  return { useCase, calls };
}

/**
 * Audit CR-2: the same governed company, with its expense categories mapped to reviewed accounts.
 * Before the fix no company could reach this state at all — nothing wrote a PostingRule and the
 * gate threw `posting_rule_missing` for every source.
 */
function postingHarness() {
  const created: any[] = [];
  const audits: any[] = [];
  const expense = {
    id: 'expense-1', companyId: 'co-1', branchId: null, status: 'CONFIRMED', expenseNumber: 'EXP-1',
    expenseDate: new Date('2026-07-29T00:00:00.000Z'), currency: 'THB', vendorCounterpartyId: null,
    sourceReimbursementRequestId: null, expenseCategoryId: null,
    grandTotalAmount: '1000', vatAmount: '0', whtAmount: '0', paidAmount: '0',
    inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY',
    lines: [
      { id: 'line-1', lineNumber: 1, taxableAmount: '700', vatAmount: '0', whtAmount: '0', expenseCategoryId: 'cat-fuel' },
      { id: 'line-2', lineNumber: 2, taxableAmount: '300', vatAmount: '0', whtAmount: '0', expenseCategoryId: 'cat-phone' },
    ],
  };
  const useCase = new GenerateJournalFromSourceUseCase(
    {
      findGeneratedJournal: async () => null,
      findPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
      findActivePostingRule: async () => null,
      findAccountByCode: async (_companyId: string, code: string) => ({ id: `acc:${code}` }),
      createJournalEntry: async (entry: any) => { created.push(entry); return { ...entry, id: 'jv-1', lines: entry.lines, createdAt: new Date(), entryDate: entry.entryDate, status: 'POSTED' }; },
      postJournalEntry: async () => undefined,
    } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
    { execute: async () => ({ id: 'reservation-1', documentNumber: 'JV-1' }) } as any,
    { execute: async () => undefined } as any,
    { append: async () => undefined } as any,
    {} as any,
    { findByIdWithRelations: async () => expense, updatePostingStatus: async () => undefined } as any,
    {} as any,
    {} as any,
    {
      client: {
        company: {
          findUnique: async () => ({
            baseCurrency: 'THB', chartOfAccountsTemplateKey: 'TH_SME_COA_V1', chartOfAccountsTemplateVersion: 1,
            chartOfAccountsTemplateChecksum: 'checksum', chartOfAccountsTemplateAppliedAt: new Date(),
          }),
        },
        expenseCategory: {
          findMany: async () => [
            { id: 'cat-fuel', ledgerAccountCode: '5320-01' },
            { id: 'cat-phone', ledgerAccountCode: '5330-01' },
          ],
        },
      },
    } as any,
  );
  return { useCase, created, expense, audits };
}

describe('template-company posting with reviewed category bindings', () => {
  it('omits a zero category allocation without creating an invalid empty journal line', async () => {
    const { useCase, created, expense } = postingHarness();
    expense.grandTotalAmount = '700';
    expense.lines[1]!.taxableAmount = '0';
    await useCase.execute(ctx, { sourceType: 'expense.record', sourceId: 'expense-1' });
    assert.equal(created[0].lines.length, 2);
    assert.equal(created[0].lines.some((line: any) => line.accountId === 'acc:5330-01'), false);
  });

  it('posts a negative settlement adjustment as a positive credit on its reviewed account', async () => {
    const { useCase, created, expense } = postingHarness();
    expense.grandTotalAmount = '699.28';
    expense.lines[1]!.taxableAmount = '-0.72';
    await useCase.execute(ctx, { sourceType: 'expense.record', sourceId: 'expense-1' });
    assert.equal(created.length, 1);
    const adjustment = created[0].lines.find((line: any) => line.accountId === 'acc:5330-01');
    assert.equal(Number(adjustment.creditAmount), 0.72);
    assert.equal(Number(adjustment.debitAmount ?? 0), 0);
    assert.ok(created[0].lines.every((line: any) => Number(line.debitAmount ?? 0) >= 0 && Number(line.creditAmount ?? 0) >= 0));
    assert.equal(created[0].lines.reduce((sum: number, line: any) => sum + Math.round(Number(line.debitAmount ?? 0) * 100) - Math.round(Number(line.creditAmount ?? 0) * 100), 0), 0);
  });

  it('posts a governed company to its reviewed per-category accounts', async () => {
    const { useCase, created } = postingHarness();

    await useCase.execute(ctx, { sourceType: 'expense.record', sourceId: 'expense-1' });

    assert.equal(created.length, 1, 'a journal is created');
    const lines = created[0].lines as Array<{ accountId: string; debitAmount?: string; creditAmount?: string }>;
    // Each category reaches its own reviewed account, and none of them is the legacy 5310-01
    // (เงินเดือน) that every expense used to land on.
    assert.deepEqual(lines.map((line) => line.accountId).sort(), ['acc:2120-01', 'acc:5320-01', 'acc:5330-01']);
    assert.equal(lines.some((line) => line.accountId.includes('5310-01')), false);
    const debit = lines.reduce((total, line) => total + Number(line.debitAmount ?? 0), 0);
    const credit = lines.reduce((total, line) => total + Number(line.creditAmount ?? 0), 0);
    assert.equal(debit, 1000);
    assert.equal(credit, 1000);
  });

  it('refuses rather than guesses when one category is still unmapped', async () => {
    const { useCase, created } = postingHarness();
    (useCase as any).prisma.client.expenseCategory.findMany = async () => [{ id: 'cat-fuel', ledgerAccountCode: '5320-01' }];

    await assert.rejects(
      () => useCase.execute(ctx, { sourceType: 'expense.record', sourceId: 'expense-1' }),
      (error: any) => error.getResponse?.().code === 'expense_account_unmapped:cat-phone',
    );
    assert.equal(created.length, 0);
  });

  // The auto-post worker runs this use case under `systemWorkerContext`, whose id is no User row.
  // Written as a USER actor the row fails the `actorUserId` FK and `AuditService.log` drops it, so
  // a journal the system posted, or refused to post, left no audit record at all.
  it('audits what the auto-post worker generates as a SYSTEM actor named by the worker', async () => {
    const worker = systemWorkerContext({
      requestId: 'req-worker', companyId: 'co-1', permissions: ['journal.entry.post'], authSubject: 'expense-auto-post-worker',
    });
    const posted = postingHarness();
    await posted.useCase.execute(worker, { sourceType: 'expense.record', sourceId: 'expense-1' });

    const refused = postingHarness();
    (refused.useCase as any).prisma.client.expenseCategory.findMany = async () => [{ id: 'cat-fuel', ledgerAccountCode: '5320-01' }];
    await assert.rejects(() => refused.useCase.execute(worker, { sourceType: 'expense.record', sourceId: 'expense-1' }));

    for (const [row, result] of [[posted.audits[0], 'SUCCESS'], [refused.audits[0], 'FAILED']] as const) {
      assert.equal(row.action, 'ledger.journal.generate');
      assert.equal(row.result, result);
      assert.equal(row.actorType, 'SYSTEM');
      assert.equal(row.actorRefId, 'expense-auto-post-worker');
      assert.equal(row.actorUserId, undefined, 'the worker id never enters the User FK');
    }
  });

  it('keeps a person who generates a journal as the USER actor', async () => {
    const { useCase, audits } = postingHarness();
    await useCase.execute(ctx, { sourceType: 'expense.record', sourceId: 'expense-1' });
    assert.equal(audits[0].actorUserId, 'user-1');
    assert.equal(audits[0].actorType, undefined);
    assert.equal(audits[0].actorRefId, undefined);
  });
});

describe('template-company posting fallback gate', () => {
  it('fails closed even when provenance is only partially stamped', () => {
    assert.equal(requiresReviewedPostingRules({ chartOfAccountsTemplateKey: 'TH_SME_COA_V1' }), true);
    assert.equal(requiresReviewedPostingRules({}), false);
  });

  // Audit CR-2: expense accrual now resolves reviewed per-category bindings instead of throwing a
  // blanket `posting_rule_missing`, so its refusal carries a more specific code. What this gate
  // protects is unchanged and is what the assertions below check: a governed company never reaches
  // a legacy `DEFAULT_ACCOUNT_CODES` account, never consumes a journal number, and lands on
  // `posting_error` carrying the reason.
  for (const source of [
    { sourceType: 'accounting.document', sourceId: 'invoice-1', forbiddenLegacyCode: '1210-00', expectedCode: 'posting_rule_missing' },
    { sourceType: 'expense.record', sourceId: 'expense-1', forbiddenLegacyCode: '5310-01', expectedCode: 'expense_allocation_base_zero' },
  ]) {
    it(`rejects ${source.sourceType} before legacy code ${source.forbiddenLegacyCode} or a journal number is used`, async () => {
      const { useCase, calls } = harness();
      await assert.rejects(
        () => useCase.execute(ctx, source),
        (error: any) => error.getResponse?.().code === source.expectedCode,
      );
      assert.equal(calls.reserved, 0);
      assert.equal(calls.created, 0);
      assert.deepEqual(calls.companyOnly, [true]);
      assert.equal(calls.accountCodes.includes(source.forbiddenLegacyCode), false);
      const statuses = source.sourceType === 'expense.record' ? calls.expenseStatuses : calls.documentStatuses;
      assert.deepEqual(statuses.map((status) => status.postingStatus), ['pending', 'posting_error']);
      assert.equal(statuses.at(-1)?.postingError, source.expectedCode);
    });
  }
});
