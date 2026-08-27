import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';

const taxSnapshot: TransactionTaxSnapshot = {
  taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', taxProfileKey: 'SAP_S4_TH_CURRENT', taxProfileVersion: 2,
  roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
  taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7',
  sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-15',
  taxBaseAmount: '100.000', taxAmount: '7.000', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
};

describe('PrismaExpenseRepository tax snapshot mapping', () => {
  it('round-trips WHT input with header money on create and version-checked update', async () => {
    let stored: any;
    let updateWhere: any;
    let sameTransaction = false;
    const client: any = {
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseRecord: {
        create: async ({ data }: any) => { stored = { id: 'expense-1', ...data }; return stored; },
        updateMany: async ({ where, data }: any) => { updateWhere = where; stored = { ...stored, ...data }; return { count: 1 }; },
        findFirstOrThrow: async () => stored,
      },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    const source = { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' } as const;
    const created = await repo.createExpense({ companyId: 'company-1', branchId: 'branch-1',
      captureSource: 'WEB_MANUAL', expenseDate: new Date('2026-08-27'), vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE', createdByUserId: 'user-1',
      whtInputJson: source, whtAmount: '30.0100', subtotalAmount: '1234.5600', discountAmount: '0',
      taxableAmount: '1234.5600', vatAmount: '0', grandTotalAmount: '1234.5600',
      netPayableAmount: '1204.5500', outstandingAmount: '1204.5500',
    });
    assert.deepEqual(created.whtInputJson, source);
    assert.equal(created.whtAmount, '30.0100');
    const expectedUpdatedAt = new Date('2026-08-27T12:00:00Z');
    const updated = await repo.updateExpense({ id: 'expense-1', companyId: 'company-1', updatedByUserId: 'user-1',
      expectedUpdatedAt, whtInputJson: { inputType: 'RATE', value: '3', origin: 'REVIEWER' },
      whtAmount: '37.0400', netPayableAmount: '1197.5200', outstandingAmount: '1197.5200',
    }, async (tx) => { sameTransaction = tx === client; });
    assert.equal(updateWhere.expectedUpdatedAt, undefined);
    assert.deepEqual(updateWhere.updatedAt, expectedUpdatedAt);
    assert.equal(sameTransaction, true);
    assert.deepEqual(updated.whtInputJson, { inputType: 'RATE', value: '3', origin: 'REVIEWER' });
    assert.equal(updated.whtAmount, '37.0400');
    assert.equal(updated.netPayableAmount, '1197.5200');
  });

  it('round-trips explicit zero treatments on create/update and keeps historical zero unknown', async () => {
    const persisted = new Map<number, any>();
    const client: any = {
      journalEntry: { findMany: async () => [] },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async ({ create, update }: any) => {
          const prior = persisted.get(create.lineNumber);
          const line = prior ? { ...prior, ...update } : { id: `line-${create.lineNumber}`, ...create };
          persisted.set(create.lineNumber, line);
          return line;
        },
      },
      expenseRecord: { findFirst: async () => ({ id: 'expense-1', lines: [...persisted.values()], duplicateCandidates: [] }) },
      attachmentLink: { findMany: async () => [] },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    const treatments = ['ZERO_RATED', 'EXEMPT', 'NON_VAT', undefined] as const;
    const lines = treatments.map((vatTreatment, index) => ({
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: index + 1, description: 'Zero VAT', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '0', vatTreatment, vatAmount: '0', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '100', expenseCategoryId: null, accountHintKey: null, taxCategory: null,
    }));
    await repo.upsertLines('company-1', 'expense-1', lines);
    assert.deepEqual((await repo.findByIdWithRelations('company-1', 'expense-1'))?.lines.map((line) => line.vatTreatment), ['ZERO_RATED', 'EXEMPT', 'NON_VAT', null]);
    await repo.upsertLines('company-1', 'expense-1', lines.map((line) => ({ ...line, description: 'Edited' })));
    assert.deepEqual((await repo.findByIdWithRelations('company-1', 'expense-1'))?.lines.map((line) => line.vatTreatment), ['ZERO_RATED', 'EXEMPT', 'NON_VAT', null]);
  });

  it('round-trips the resolver rounding policy through ExpenseLine', async () => {
    let persistedLine: any;
    const client: any = {
      // Added by the expense auto-post work (#59): findByIdWithRelations now reads
      // generated journals to resolve the entry number. No journals in these fixtures.
      journalEntry: { findMany: async () => [] },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async ({ create }: any) => { persistedLine = { id: 'line-1', ...create }; return persistedLine; },
      },
      expenseRecord: { findFirst: async () => ({ id: 'expense-1', lines: [persistedLine], duplicateCandidates: [] }) },
      attachmentLink: { findMany: async () => [] },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    await repo.upsertLines('company-1', 'expense-1', [{
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '7', vatAmount: '7', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '107', expenseCategoryId: null, accountHintKey: null, taxCategory: null, taxSnapshot,
    }]);
    const result = await repo.findByIdWithRelations('company-1', 'expense-1');
    assert.deepEqual([
      persistedLine.roundingModeSnapshot, persistedLine.roundingScaleSnapshot, persistedLine.taxAmountToleranceSnapshot,
    ], ['HALF_EVEN', 3, '0.005']);
    assert.deepEqual([
      result?.lines[0]?.taxSnapshot?.roundingMode,
      result?.lines[0]?.taxSnapshot?.roundingScale,
      result?.lines[0]?.taxSnapshot?.taxAmountTolerance,
    ], ['HALF_EVEN', 3, '0.005']);
  });

  it('does not leak resolver-only tax fields into Prisma create or update data', async () => {
    let upsertInput: any;
    const client: any = {
      // Added by the expense auto-post work (#59): findByIdWithRelations now reads
      // generated journals to resolve the entry number. No journals in these fixtures.
      journalEntry: { findMany: async () => [] },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async () => undefined,
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async (input: any) => { upsertInput = input; return input.create; },
      },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    await repo.upsertLines('company-1', 'expense-1', [{
      expenseId: 'expense-1', companyId: 'company-1', lineNumber: 1, description: 'Imported service', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '0.07', vatAmount: '7', whtRate: null, whtAmount: '0',
      lineSubtotalAmount: '100', lineTotalAmount: '107', expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', sourceLineId: 'source-line-1', transactionContext: 'IMPORT_SERVICE',
      evidenceRefs: ['attachment-1'], authoritativeCustomsValue: '100', authoritativeDutyAmount: '1', authoritativeExciseAmount: '2',
      authoritativeOtherTaxAmount: '3', authoritativeImportVatAmount: '7', taxSnapshot, taxComponents: [],
    } as any]);

    const resolverOnlyFields = [
      'externalTaxCode', 'sourceLineId', 'transactionContext', 'evidenceRefs', 'authoritativeCustomsValue',
      'authoritativeDutyAmount', 'authoritativeExciseAmount', 'authoritativeOtherTaxAmount', 'authoritativeImportVatAmount',
      'taxSnapshot', 'taxComponents',
    ];
    for (const field of resolverOnlyFields) {
      assert.equal(field in upsertInput.create, false, `${field} leaked into create`);
      assert.equal(field in upsertInput.update, false, `${field} leaked into update`);
    }
  });
});

function category(
  id: string,
  companyId: string | null,
  status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
  options: { accountHintKey?: string; bootstrap?: boolean } = {},
) {
  return {
    id,
    companyId,
    name: id,
    accountHintKey: options.accountHintKey ?? `expense.${id}`,
    defaultInputTaxCode: null,
    status,
    sortOrder: 0,
    ledgerAccountReviewedByUserId: options.bootstrap ? 'system:expense-category-bootstrap' : null,
  };
}

describe('PrismaExpenseRepository expense category precedence', () => {
  it('uses only company-owned active categories once the canonical set was bootstrapped', async () => {
    const rows = [category('company-active', 'company-1', 'ACTIVE', { bootstrap: true }), category('global-active', null), category('company-archived', 'company-1', 'ARCHIVED', { bootstrap: true })];
    const repo = new PrismaExpenseRepository({ client: { expenseCategory: { findMany: async () => rows } } } as any);

    assert.deepEqual((await repo.listCategories('company-1')).map((item) => item.id), ['company-active']);
    assert.deepEqual((await repo.listAllCategories('company-1')).map((item) => item.id), ['company-active', 'company-archived']);
  });

  it('does not restore global defaults when every company-owned category is archived', async () => {
    const rows = [category('company-archived', 'company-1', 'ARCHIVED', { bootstrap: true }), category('global-active', null)];
    const repo = new PrismaExpenseRepository({ client: { expenseCategory: { findMany: async () => rows } } } as any);

    assert.deepEqual(await repo.listCategories('company-1'), []);
  });

  it('keeps non-conflicting global fallback for a partial legacy set and prefers company collisions', async () => {
    const own = category('ค่าเดินทาง', 'company-1', 'ACTIVE', { accountHintKey: 'expense.travel' });
    const rows = [
      own,
      category('เดินทางชื่อเก่า', null, 'ACTIVE', { accountHintKey: 'expense.travel' }),
      category('ค่าเดินทาง', null, 'ACTIVE', { accountHintKey: 'expense.legacy_travel' }),
      category('ค่าอาหาร', null, 'ACTIVE', { accountHintKey: 'expense.meals' }),
    ];
    const repo = new PrismaExpenseRepository({ client: { expenseCategory: { findMany: async () => rows } } } as any);

    assert.deepEqual((await repo.listCategories('company-1')).map((item) => item.id), ['ค่าเดินทาง', 'ค่าอาหาร']);
  });

  it('keeps global defaults as a compatibility fallback for companies without their own rows', async () => {
    const rows = [category('global-active', null), category('global-archived', null, 'ARCHIVED')];
    const repo = new PrismaExpenseRepository({ client: { expenseCategory: { findMany: async () => rows } } } as any);

    assert.deepEqual((await repo.listCategories('legacy-company')).map((item) => item.id), ['global-active']);
    assert.deepEqual((await repo.listAllCategories('legacy-company')).map((item) => item.id), ['global-active', 'global-archived']);
  });
});
