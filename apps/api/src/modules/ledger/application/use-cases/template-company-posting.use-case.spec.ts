import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenerateJournalFromSourceUseCase } from './journal.use-case.js';
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

describe('template-company posting fallback gate', () => {
  it('fails closed even when provenance is only partially stamped', () => {
    assert.equal(requiresReviewedPostingRules({ chartOfAccountsTemplateKey: 'TH_SME_COA_V1' }), true);
    assert.equal(requiresReviewedPostingRules({}), false);
  });

  for (const source of [
    { sourceType: 'accounting.document', sourceId: 'invoice-1', forbiddenLegacyCode: '1210-00' },
    { sourceType: 'expense.record', sourceId: 'expense-1', forbiddenLegacyCode: '5310-01' },
  ]) {
    it(`rejects ${source.sourceType} before legacy code ${source.forbiddenLegacyCode} or a journal number is used`, async () => {
      const { useCase, calls } = harness();
      await assert.rejects(
        () => useCase.execute(ctx, source),
        (error: any) => error.getResponse?.().code === 'posting_rule_missing',
      );
      assert.equal(calls.reserved, 0);
      assert.equal(calls.created, 0);
      assert.deepEqual(calls.companyOnly, [true]);
      assert.equal(calls.accountCodes.includes(source.forbiddenLegacyCode), false);
      const statuses = source.sourceType === 'expense.record' ? calls.expenseStatuses : calls.documentStatuses;
      assert.deepEqual(statuses.map((status) => status.postingStatus), ['pending', 'posting_error']);
      assert.equal(statuses.at(-1)?.postingError, 'posting_rule_missing');
    });
  }
});
