import { SOURCE_DOCUMENT_TYPE_LABELS } from '@watchdog-bms/contracts';
import { applyExpenseInputVatPreset, recomputeCompanyExpenseInputVat, assertInputVatRestoreAllowed } from './expense-input-vat';
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
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
      reimbursementLine: { findFirst: async () => null },
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => stored,
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
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async ({ create, update }: any) => {
          const prior = persisted.get(create.lineNumber);
          const line = prior ? { ...prior, ...update } : { id: `line-${create.lineNumber}`, ...create };
          persisted.set(create.lineNumber, line);
          return line;
        },
      },
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: { findFirst: async () => ({ id: 'expense-1', lines: [...persisted.values()], duplicateCandidates: [] }) },
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
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
      expenseLine: {
        deleteMany: async () => ({ count: 0 }),
        upsert: async ({ create }: any) => { persistedLine = { id: 'line-1', ...create }; return persistedLine; },
      },
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: { findFirst: async () => ({ id: 'expense-1', lines: [persistedLine], duplicateCandidates: [] }) },
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
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
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

describe('review save aligns the withholding income type with the payee kind', () => {
  const pairs = [
    ['WHT_SERVICE_3', 'WHT_SERVICE_5', '3'], ['WHT_RENT_IND', 'WHT_RENT_JUR', '5'],
    ['WHT_PROFESSIONAL_IND', 'WHT_PROFESSIONAL_JUR', '3'], ['WHT_ADVERTISING_IND', 'WHT_ADVERTISING_JUR', '2'],
    ['WHT_TRANSPORT_IND', 'WHT_TRANSPORT_JUR', '1'],
    // Future rates are fixtures, not defaults offered by the catalogue.
    ['WHT_PRIZE', 'WHT_PRIZE_JUR', '5'], ['WHT_INTEREST', 'WHT_INTEREST_JUR', '2'], ['WHT_DIVIDEND_IND', 'WHT_DIVIDEND', '7'],
  ];
  const catalog = Object.fromEntries(pairs.flatMap(([ind, jur, rate]) => [[ind, { code: ind, formType: ['WHT_INTEREST', 'WHT_DIVIDEND_IND'].includes(ind) ? 'PND2' : 'PND3', defaultRate: rate, status: 'ACTIVE' }], [jur, { code: jur, formType: 'PND53', defaultRate: rate, status: 'ACTIVE' }]]));
  function save(kind: string | null, code: string, rate: string, categories = catalog) {
    let row: any = { id: 'expense-1', companyId: 'company-1', status: 'NEEDS_REVIEW', vendorEntityKindSnapshot: kind,
      whtCategoryCode: code, whtRate: rate, lines: [], sourceChannelMetadataJson: null };
    let writes = 0;
    const client: any = { $transaction: async (work: any) => work(client), $executeRaw: async () => {},
      attachmentLink: { findMany: async () => [] },
      whtIncomeCategory: { findUnique: async ({ where }: any) => categories[where.code] ?? null },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: { findFirst: async () => row, findFirstOrThrow: async () => row,
        updateMany: async ({ data }: any) => { writes++; row = { ...row, ...data }; return { count: 1 }; } },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    return { run: (input: any = {}) => repo.updateExpense({ id: row.id, companyId: row.companyId, updatedByUserId: 'reviewer', refreshSubstituteEvidence: { requestId: 'review' }, ...input }), writes: () => writes };
  }
  for (const [ind, jur, rate] of pairs) for (const [kind, from, to] of [['INDIVIDUAL', jur, ind], ['JURISTIC', ind, jur]]) {
    it(`${kind}: switches ${from} to ${to} at the same rate`, async () => {
      const result = await save(kind, from, rate).run();
      assert.equal(result.whtCategoryCode, to);
      assert.equal(result.whtRate, rate);
    });
  }
  it('refuses a different rate, a missing or inactive twin, and an income with no twin before writing', async () => {
    for (const h of [save('INDIVIDUAL', 'WHT_SERVICE_5', '5'),
      save('INDIVIDUAL', 'WHT_SERVICE_5', '3', { WHT_SERVICE_5: catalog.WHT_SERVICE_5 }),
      save('INDIVIDUAL', 'WHT_SERVICE_5', '3', { ...catalog, WHT_SERVICE_3: { ...catalog.WHT_SERVICE_3, status: 'DRAFT' } }),
      save('INDIVIDUAL', 'CUSTOM', '3', { CUSTOM: { code: 'CUSTOM', formType: 'PND53', defaultRate: '3', status: 'ACTIVE' } }),
    ]) {
      await assert.rejects(h.run(), (error: any) => error.getResponse().code === 'expense_wht_category_payee_mismatch');
      assert.equal(h.writes(), 0);
    }
  });
  it('checks incoming payee-kind fields even without the web review-refresh flag', async () => {
    const result = await save('JURISTIC', 'WHT_SERVICE_5', '3').run({ refreshSubstituteEvidence: undefined, vendorEntityKindSnapshot: 'INDIVIDUAL' });
    assert.equal(result.whtCategoryCode, 'WHT_SERVICE_3');
    assert.equal(result.vendorEntityKindSnapshot, 'INDIVIDUAL');
  });
  it('normalizes an incoming mismatch even when its twin is already stored', async () => {
    const result = await save('INDIVIDUAL', 'WHT_SERVICE_3', '3').run({ whtCategoryCode: 'WHT_SERVICE_5' });
    assert.equal(result.whtCategoryCode, 'WHT_SERVICE_3');
  });
  it('keeps an individual PND2 type and refuses its unconfirmed company twin', async () => {
    assert.equal((await save('INDIVIDUAL', 'WHT_INTEREST', '2').run()).whtCategoryCode, 'WHT_INTEREST');
    const h = save('JURISTIC', 'WHT_INTEREST', '2', { ...catalog, WHT_INTEREST_JUR: { ...catalog.WHT_INTEREST_JUR, status: 'DRAFT' } });
    await assert.rejects(h.run(), (e: any) => e.getResponse().code === 'expense_wht_category_payee_mismatch');
    assert.equal(h.writes(), 0);
  });
  it('leaves unknown payee kind and an already matching category untouched', async () => {
    for (const kind of [null, 'UNKNOWN', 'JURISTIC']) assert.equal((await save(kind, 'WHT_SERVICE_5', '5').run()).whtCategoryCode, 'WHT_SERVICE_5');
  });
});

describe('one server VAT preset for all capture writers', () => {
  const fact = (status: string) => ({ id: 'fact', status, effectiveFrom: new Date('2026-01-01'), effectiveTo: null, supersededAt: null, answeredAt: new Date('2026-01-01') });
  for (const captureSource of ['WEB_MANUAL', 'WEB_UPLOAD', 'LINE_UPLOAD', 'API_INTERNAL']) it(`applies dated presets for ${captureSource} without changing a human mark`, async () => {
    const tx = { companyVatRegistrationFact: { findMany: async () => [fact('REGISTERED')] } };
    const source = { companyId: 'c1', captureSource, status: 'NEEDS_REVIEW', sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_INCLUDED', vatAmount: '7', expenseDate: new Date('2026-10-01'), inputVatClaimStatus: 'NON_CLAIMABLE' };
    assert.equal((await applyExpenseInputVatPreset(tx, source)).inputVatClaimStatus, 'NEEDS_REVIEW');
    assert.deepEqual(await applyExpenseInputVatPreset(tx, { ...source, buyerAsPrintedJson: { claimStatusBeforeMark: 'NEEDS_REVIEW' } }), {});
    assert.deepEqual(await applyExpenseInputVatPreset(tx, { ...source, status: 'CONFIRMED' }), {});
    tx.companyVatRegistrationFact.findMany = async () => [fact('NOT_REGISTERED')];
    const result = await applyExpenseInputVatPreset(tx, source);
    assert.equal(result.inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal(result.sourceChannelMetadataJson.inputVatPresetReasonCode, 'COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE');
  });
  for (const status of ['REGISTERED', 'NOT_REGISTERED'] as const) it(`recomputes undecided open records when the shop answers ${status}`, async () => {
    const rows = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED'].map((status, id) => ({ id: String(id), companyId: 'c1', status, sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_INCLUDED', vatAmount: '7', expenseDate: new Date('2026-10-01'), sourceChannelMetadataJson: { kept: true } }));
    rows.push({ ...rows[0], id: 'marked', buyerAsPrintedJson: { claimStatusBeforeMark: 'NEEDS_REVIEW' } } as any);
    const writes: any[] = [];
    const tx = { companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: { findMany: async () => rows, updateMany: async (args: any) => writes.push(args) } };
    await recomputeCompanyExpenseInputVat(tx, 'c1', [{ id: 'fact', status, effectiveFrom: '2026-01-01' as any, effectiveTo: null, supersededAt: null, answeredAt: new Date() }]);
    assert.equal(writes.length, 3);
    assert.ok(writes.every(({data}) => data.inputVatClaimStatus === (status === 'REGISTERED' ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE') && data.sourceChannelMetadataJson.kept));
  });
});


it('permits restoring CLAIMABLE only with the dated shop answer and usable evidence', async () => {
  const base = { companyId: 'c1', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX',
    inputVatClaimStatus: 'CLAIMABLE', vatMode: 'VAT_INCLUDED', vatAmount: '7', expenseDate: new Date('2026-10-01'), primaryAttachmentId: 'a1', vendorTaxIdSnapshot: '1234567890123', vendorDocumentNumber: 'INV-1' };
  const tx: any = { companyVatRegistrationFact: { findMany: async () => [] } };
  await assert.rejects(() => assertInputVatRestoreAllowed(tx, base), (error: any) => error.getResponse().code === 'input_vat_company_registration_unanswered');
  tx.companyVatRegistrationFact.findMany = async () => [{ status: 'NOT_REGISTERED', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, supersededAt: null, answeredAt: new Date('2020-01-01') }];
  await assert.rejects(() => assertInputVatRestoreAllowed(tx, base), (error: any) => error.getResponse().code === 'input_vat_not_available_company_not_vat_registered');
  tx.companyVatRegistrationFact.findMany = async () => [{ status: 'REGISTERED', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, supersededAt: null, answeredAt: new Date('2020-01-01') }];
  await assertInputVatRestoreAllowed(tx, base);
  for (const changed of [{ vatAmount: '0' }, { vatMode: 'NO_VAT' }, { taxEvidenceStatus: 'SUPPORTING_ONLY' }, { sourceDocumentType: 'RECEIPT' }, { primaryAttachmentId: null }]) {
    await assert.rejects(() => assertInputVatRestoreAllowed(tx, { ...base, ...changed }));
  }
});


for (const captureSource of ['WEB_MANUAL', 'WEB_UPLOAD', 'LINE_UPLOAD', 'API_INTERNAL']) it(`${captureSource}: persists the same preset per type on create and type changes`, async () => {
  let row: any;
  const tx: any = { $transaction: async (work: any) => work(tx), $executeRaw: async () => 1,
    reimbursementLine: { findFirst: async () => null },
    branch: { findFirst: async () => ({ id: 'b1' }) }, attachmentLink: { findMany: async () => [] },
    companyVatRegistrationFact: { findMany: async () => [] },
    expenseSubstituteReceiptEvidence: { findFirst: async () => null },
    expenseRecord: { create: async ({ data }: any) => row = { id: 'e1', status: 'DRAFT', ...data },
      findFirst: async () => row, findFirstOrThrow: async () => row,
      updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; } } };
  const repo = new PrismaExpenseRepository({ client: tx } as any);
  for (const sourceDocumentType of Object.keys(SOURCE_DOCUMENT_TYPE_LABELS)) {
    const expected = ['TAX_INVOICE', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'].includes(sourceDocumentType) ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE';
    await repo.createExpense({ companyId: 'c1', branchId: 'b1', captureSource, createdByUserId: 'u1', expenseDate: new Date('2026-10-01'),
      sourceDocumentType, vatMode: 'VAT_INCLUDED', vatAmount: '7', inputVatClaimStatus: 'CLAIMABLE' } as any);
    assert.equal(row.inputVatClaimStatus, expected, sourceDocumentType);
    assert.equal(row.sourceChannelMetadataJson.inputVatPresetReasonCode, sourceDocumentType === 'ABBREVIATED_TAX_INVOICE' ? 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE' : expected === 'NEEDS_REVIEW' ? 'INPUT_VAT_REVIEW_REQUIRED' : 'DOCUMENT_NOT_INPUT_VAT_CLAIMABLE');
    await repo.updateExpense({ id: 'e1', companyId: 'c1', updatedByUserId: 'u1', sourceDocumentType: 'TRANSFER_SLIP' });
    assert.equal(row.inputVatClaimStatus, 'NON_CLAIMABLE');
    await repo.updateExpense({ id: 'e1', companyId: 'c1', updatedByUserId: 'u1', sourceDocumentType } as any);
    assert.equal(row.inputVatClaimStatus, expected);
    await repo.updateExpense({ id: 'e1', companyId: 'c1', updatedByUserId: 'u1', vatAmount: '0' });
    assert.equal(row.inputVatClaimStatus, 'NON_CLAIMABLE');
  }
});

// The decision is independent of confirmation; every fact is read inside its transaction.
import { inputVatRecordedBeforeReview, validateInputVatDecision } from './expense-input-vat-decision';
const decisionExpense: any = { id: 'e1', companyId: 'c1', sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_EXCLUDED', vatAmount: '7',
  inputVatClaimStatus: 'NEEDS_REVIEW', taxEvidenceStatus: 'USABLE_FOR_TAX', vendorTaxIdSnapshot: '0100000000001', vendorDocumentNumber: 'INV-1' };
const decisionFacts: any = { registry: { registeredName: 'ร้านเรา', taxId: '0100000000002' }, vatStatus: 'REGISTERED', attachmentIds: ['a1'], buyer: { matchStatus: 'MATCH' }, latestDecision: null };
const decisionInput: any = { toStatus: 'CLAIMABLE', reviewerConditions: ['BUSINESS_USE', 'NOT_PROHIBITED', 'ISSUER_ENTITLED'] };
describe('input VAT decision conditions', () => {
  it('records system facts and all three reviewer answers', () => {
    const conditions = validateInputVatDecision(decisionExpense, decisionFacts, decisionInput, 'reviewer');
    assert.equal(conditions.filter((c: any) => c.source === 'REVIEWER').length, 3);
    assert.ok(conditions.every((c: any) => c.answer === true));
  });
  it('EVID-1 permits a VAT decision from the recorded original paper without an image, keeping all other conditions', () => {
    const assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, note: 'อยู่กับผู้ทำบัญชี' };
    const expense = { ...decisionExpense, aiVerificationSummaryJson: { documentEvidenceDraft: assessment } };
    const conditions = validateInputVatDecision(expense, { ...decisionFacts, attachmentIds: [] }, decisionInput, 'u');
    const paper = conditions.find(condition => condition.code === 'PAPER_ATTACHED')!;
    assert.equal(paper.answer, true); assert.equal(paper.source, 'REVIEWER');
    assert.equal((paper.fact as Record<string, unknown>).originalDocumentAvailable, true);
    assert.throws(() => validateInputVatDecision(expense, { ...decisionFacts, attachmentIds: [], vatStatus: 'UNKNOWN' }, decisionInput, 'u'));
    assert.throws(() => validateInputVatDecision({ ...expense, taxEvidenceStatus: 'SUPPORTING_ONLY' }, { ...decisionFacts, attachmentIds: [] }, decisionInput, 'u'));
  });
  for (const [patch, code] of [
    [{ vatStatus: 'UNKNOWN' }, 'input_vat_company_registration_unanswered'],
    [{ attachmentIds: [] }, 'input_vat_attachment_required'],
    [{ buyer: { matchStatus: 'MISMATCH' } }, 'input_vat_buyer_mismatch'],
    [{ buyer: { matchStatus: 'NOT_PRINTED' } }, 'input_vat_buyer_confirmation_required'],
  ] as const) it(`refuses missing system condition ${code}`, () => assert.throws(
    () => validateInputVatDecision(decisionExpense, { ...decisionFacts, ...patch }, decisionInput, 'u'), (e: any) => e.getResponse().code === code));
  for (const [field, code] of [['vendorTaxIdSnapshot', 'input_vat_seller_tax_id_required'], ['vendorDocumentNumber', 'input_vat_document_number_required']] as const)
    it(`requires ${field}`, () => assert.throws(() => validateInputVatDecision({ ...decisionExpense, [field]: null }, decisionFacts, decisionInput, 'u'), (e: any) => e.getResponse().code === code));
  for (const tick of decisionInput.reviewerConditions) it(`requires reviewer tick ${tick}`, () => assert.throws(
    () => validateInputVatDecision(decisionExpense, decisionFacts, { ...decisionInput, reviewerConditions: decisionInput.reviewerConditions.filter((v: string) => v !== tick) }, 'u'), (e: any) => e.getResponse().code === 'input_vat_conditions_required'));
  it('requires a trimmed reason for NON_CLAIMABLE and changes, with a 500-character maximum', () => {
    for (const input of [{ toStatus: 'NON_CLAIMABLE', reason: ' ' }, { ...decisionInput, reason: 'x'.repeat(501) }, decisionInput])
      assert.throws(() => validateInputVatDecision(decisionExpense, { ...decisionFacts, latestDecision: { id: 'd1' } }, input as any, 'u'));
    assert.ok(validateInputVatDecision(decisionExpense, decisionFacts, { toStatus: 'NON_CLAIMABLE', reason: '  ใช้ส่วนตัว  ' }, 'u'));
  });
  for (const type of Object.keys(SOURCE_DOCUMENT_TYPE_LABELS).filter(type => !['TAX_INVOICE', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'].includes(type))) it(`fixed type ${type} refuses either decision`, () => {
    for (const toStatus of ['CLAIMABLE', 'NON_CLAIMABLE']) assert.throws(() => validateInputVatDecision({ ...decisionExpense, sourceDocumentType: type }, decisionFacts, { ...decisionInput, toStatus, reason: 'ทดสอบ' }, 'u'), (e: any) => e.getResponse().code === 'input_vat_fixed');
  });
  it('accepts an unread buyer block only with reviewer confirmation', () => {
    assert.ok(validateInputVatDecision(decisionExpense, { ...decisionFacts, buyer: { matchStatus: 'NOT_PRINTED' } }, { ...decisionInput, buyerConfirmed: true }, 'u'));
  });
});

import { DecideExpenseInputVatUseCase } from '../application/use-cases/expense-draft.use-case';
function decisionHarness(overrides: any = {}) {
  const state: any = { expense: { ...decisionExpense, status: 'CONFIRMED', expenseDate: new Date('2026-10-01'), primaryAttachmentId: 'a1',
    buyerAsPrintedJson: { name: 'ร้านเรา', taxId: '0100000000002' }, ...overrides }, decisions: [], audits: [], period: null, journal: null };
  const tx: any = {
    companyFeatureEntitlement: { findMany: async () => [] },
    $executeRaw: async () => 1,
    $transaction: async (work: any) => work(tx),
    company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }), findFirstOrThrow: async () => ({ name: 'ร้านเรา', registeredName: 'ร้านเรา', taxId: '0100000000002' }) },
    branch: { findFirst: async () => null }, user: { findUnique: async () => ({ displayName: 'ผู้ตรวจ ก' }) },
    companyVatRegistrationFact: { findMany: async () => [{ status: 'REGISTERED', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, supersededAt: null, answeredAt: new Date('2020-01-01') }] },
    attachmentLink: { findMany: async () => [] }, attachmentObject: { findMany: async () => [{ id: 'a1' }] },
    taxPeriod: { upsert: async () => state.period ?? { status: 'OPEN' }, findFirst: async () => state.period }, journalEntry: { findFirst: async () => state.journal },
    expenseInputVatDecision: { findFirst: async () => state.decisions.at(-1) ?? null,
      create: async ({ data }: any) => { const row = { ...data, id: `d${state.decisions.length + 1}`, decidedAt: new Date() }; state.decisions.push(row); return row; } },
    expenseRecord: { findFirst: async () => state.expense, findFirstOrThrow: async () => state.expense,
      update: async ({ data }: any) => Object.assign(state.expense, data), updateMany: async ({ data }: any) => { Object.assign(state.expense, data); return { count: 1 }; } },
    expenseSubstituteReceiptEvidence: { findFirst: async () => null }, reimbursementLine: { findFirst: async () => null },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
  };
  return { state, tx, repo: new PrismaExpenseRepository({ client: tx } as any), ctx: { companyId: 'c1', userId: 'u1', permissions: ['expense.review'], scopes: {} } as any };
}
describe('input VAT decision transaction', () => {
  it('refuses a non-reviewer before reading or writing', async () => {
    const { repo, ctx, state } = decisionHarness();
    await assert.rejects(() => new DecideExpenseInputVatUseCase(repo).execute({ ...ctx, permissions: ['expense.confirm'] }, 'e1', decisionInput), /expense.review/);
    assert.equal(state.decisions.length, 0);
  });
  it('decides after confirmation, keeps money and status, and returns its audit facts', async () => {
    const { repo, ctx, state } = decisionHarness({ grandTotalAmount: '107', paidAmount: '107' });
    const result = await repo.decideInputVat(ctx, 'e1', decisionInput);
    assert.equal(result.status, 'CLAIMABLE'); assert.equal(result.latestDecision?.decidedByName, 'ผู้ตรวจ ก');
    assert.equal(state.expense.status, 'CONFIRMED'); assert.equal(state.expense.grandTotalAmount, '107'); assert.equal(state.expense.paidAmount, '107');
    assert.equal(state.decisions.length, 1); assert.equal(state.audits[0].action, 'expense.input_vat.decide');
    assert.deepEqual([state.audits[0].metadataJson.before, state.audits[0].metadataJson.after], ['NEEDS_REVIEW', 'CLAIMABLE']);
  });
  for (const [field, code] of [['period', 'tax_period_locked'], ['journal', 'input_vat_posted_journal_immutable']] as const)
    it(`refuses ${field} without a decision or mutation`, async () => {
      const { repo, ctx, state } = decisionHarness(); state[field] = { status: field === 'period' ? 'FILED' : 'POSTED' };
      await assert.rejects(() => repo.decideInputVat(ctx, 'e1', decisionInput), (e: any) => e.getResponse().code === code);
      assert.equal(state.decisions.length, 0); assert.equal(state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
    });
  it('a later type change resets the decision and records why', async () => {
    const { repo, ctx, state } = decisionHarness({ status: 'NEEDS_REVIEW' });
    await repo.decideInputVat(ctx, 'e1', decisionInput);
    await repo.updateExpense({ id: 'e1', companyId: 'c1', sourceDocumentType: 'CUSTOMS_VAT_RECEIPT', updatedByUserId: 'u1' });
    assert.equal(state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
    assert.equal(state.decisions.at(-1).reason, 'เปลี่ยนประเภทเอกสาร');
  });
  it('buyer mark and undo both record a decision', async () => {
    const { repo, state } = decisionHarness({ status: 'NEEDS_REVIEW', buyerAsPrintedJson: { matchStatus: 'MISMATCH', claimStatusBeforeMark: 'NEEDS_REVIEW' } });
    await repo.updateExpense({ id: 'e1', companyId: 'c1', inputVatClaimStatus: 'NON_CLAIMABLE', updatedByUserId: 'u1' });
    await repo.updateExpense({ id: 'e1', companyId: 'c1', inputVatClaimStatus: 'NEEDS_REVIEW', buyerAsPrintedJson: { matchStatus: 'MISMATCH', checkedAt: '2026-10-14T00:00:00Z' }, updatedByUserId: 'u1' });
    assert.equal(state.decisions.length, 2);
    assert.ok(state.decisions.every((row: any) => row.reason === 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง'));
    assert.equal(state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
  });
});

describe('decision preservation and buyer compatibility integrity', () => {
  it('does not overwrite a saved decision when the same type is saved or the shop answer changes', async () => {
    const { repo, ctx, state, tx } = decisionHarness({ status: 'NEEDS_REVIEW' });
    await repo.decideInputVat(ctx, 'e1', decisionInput);
    await repo.updateExpense({ id: 'e1', companyId: 'c1', sourceDocumentType: 'TAX_INVOICE', updatedByUserId: 'u1' });
    assert.equal(state.expense.inputVatClaimStatus, 'CLAIMABLE');
    tx.expenseRecord.findMany = async () => [state.expense];
    await recomputeCompanyExpenseInputVat(tx, 'c1', [{ id: 'f1', status: 'NOT_REGISTERED', effectiveFrom: '2020-01-01' as any, effectiveTo: null, supersededAt: null }]);
    assert.equal(state.expense.inputVatClaimStatus, 'CLAIMABLE');
  });
  it('cannot use the buyer button to decide a fixed type', async () => {
    const { repo } = decisionHarness({ status: 'NEEDS_REVIEW', sourceDocumentType: 'RECEIPT', buyerAsPrintedJson: { matchStatus: 'MISMATCH' } });
    await assert.rejects(() => repo.updateExpense({ id: 'e1', companyId: 'c1', inputVatClaimStatus: 'NON_CLAIMABLE', updatedByUserId: 'u1' }), (e: any) => e.getResponse().code === 'input_vat_fixed');
  });
  it('does not let undo restore CLAIMABLE while the printed buyer still mismatches', async () => {
    const { repo } = decisionHarness({ status: 'NEEDS_REVIEW', inputVatClaimStatus: 'NON_CLAIMABLE', buyerAsPrintedJson: { name: 'ร้านอื่น', taxId: '0100000000009', matchStatus: 'MISMATCH', claimStatusBeforeMark: 'CLAIMABLE' } });
    await assert.rejects(() => repo.updateExpense({ id: 'e1', companyId: 'c1', inputVatClaimStatus: 'CLAIMABLE', updatedByUserId: 'u1' }), (e: any) => e.getResponse().code === 'input_vat_buyer_mismatch');
  });
});

import { resetInputVatDecisionForType } from './expense-input-vat-decision';
it('a reader changing the type resets a prior decision in the same transaction', async () => {
  const { repo, ctx, state, tx } = decisionHarness({ status: 'NEEDS_REVIEW' });
  await repo.decideInputVat(ctx, 'e1', decisionInput);
  const patch = await resetInputVatDecisionForType(tx, state.expense, { ...state.expense, sourceDocumentType: 'CUSTOMS_VAT_RECEIPT' }, ctx);
  assert.equal(patch?.inputVatClaimStatus, 'NEEDS_REVIEW');
  assert.equal(state.decisions.at(-1).reason, 'เปลี่ยนประเภทเอกสาร');
  assert.equal(state.decisions.at(-1).conditionsJson[0].source, 'SYSTEM');
});

it('a readable buyer name without its tax number still needs reviewer confirmation', async () => {
  const { repo, ctx } = decisionHarness({ buyerAsPrintedJson: { name: 'ร้านเรา' } });
  await assert.rejects(() => repo.decideInputVat(ctx, 'e1', decisionInput), (e: any) => e.getResponse().code === 'input_vat_buyer_confirmation_required');
});
it('a type reset leaves waiting VAT eligible for the next shop answer', async () => {
  const { repo, ctx, state, tx } = decisionHarness({ status: 'NEEDS_REVIEW' });
  await repo.decideInputVat(ctx, 'e1', decisionInput);
  await repo.updateExpense({ id: 'e1', companyId: 'c1', sourceDocumentType: 'CUSTOMS_VAT_RECEIPT', updatedByUserId: 'u1' });
  tx.expenseRecord.findMany = async () => [state.expense];
  await recomputeCompanyExpenseInputVat(tx, 'c1', [{ id: 'f1', status: 'NOT_REGISTERED', effectiveFrom: '2020-01-01' as any, effectiveTo: null, supersededAt: null }]);
  assert.equal(state.expense.inputVatClaimStatus, 'NON_CLAIMABLE');
  await recomputeCompanyExpenseInputVat(tx, 'c1', [{ id: 'f2', status: 'REGISTERED', effectiveFrom: '2020-01-01' as any, effectiveTo: null, supersededAt: null }]);
  assert.equal(state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
});
for (const right of ['NEEDS_REVIEW', 'CLAIMABLE', 'NON_CLAIMABLE']) it(`a certificate route presets ${right} to NON_CLAIMABLE`, async () => {
  const { tx, state } = decisionHarness({ status: 'NEEDS_REVIEW', inputVatClaimStatus: right,
    aiVerificationSummaryJson: { documentEvidenceDraft: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', reason: '', attachmentIds: [] } } });
  assert.equal((await applyExpenseInputVatPreset(tx, state.expense)).inputVatClaimStatus, 'NON_CLAIMABLE');
});

it('usable evidence is required for CLAIMABLE, independently of the paper type', () => {
  assert.throws(() => validateInputVatDecision({ ...decisionExpense, taxEvidenceStatus: 'SUPPORTING_ONLY' }, decisionFacts, decisionInput, 'u'),
    (e: any) => e.getResponse().code === 'input_vat_usable_evidence_required');
});
for (const patch of [{ vatAmount: '0' }, { vatMode: 'NO_VAT' }]) it(`no VAT means no decision: ${JSON.stringify(patch)}`, () => {
  assert.throws(() => validateInputVatDecision({ ...decisionExpense, ...patch }, decisionFacts, decisionInput, 'u'), (e: any) => e.getResponse().reasonCode === 'NO_INPUT_VAT');
});
it('a shop not registered on the document date receives its fixed reason', () => {
  assert.throws(() => validateInputVatDecision(decisionExpense, { ...decisionFacts, vatStatus: 'NOT_REGISTERED' }, decisionInput, 'u'),
    (e: any) => e.getResponse().reasonCode === 'COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE');
});

it('a decision rebuilds an existing unposted journal in its transaction: cost, input VAT, cost', async () => {
  const h = decisionHarness({ currency: 'THB', grandTotalAmount: '107', whtAmount: '0', lines: [] });
  const component = { componentKey: 'VAT', snapshot: { taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD',
    taxCurrency: 'THB', sourceCurrency: 'THB', exchangeRate: '1', taxAmount: '7', taxBaseAmount: '100', evidenceStatus: 'VERIFIED' },
    accountAssignments: [{ accountId: 'input-vat', accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT', ruleVersion: 1 }], reportContributions: [] };
  h.tx.expenseRecord.update = async ({ data }: any) => (h.state.expense = { ...h.state.expense, ...data });
  h.state.expense.lines = [{ id: 'l1', lineNumber: 1, taxableAmount: '100', vatAmount: '7', taxComponentsJson: [component] }];
  h.state.journal = { id: 'j1', companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', entryType: 'GENERATED', status: 'DRAFT', periodId: 'p1', lines: [] };
  h.tx.journalEntry.findFirst = async ({ where }: any) => where.status && where.status !== h.state.journal.status ? null : h.state.journal;
  h.tx.journalEntry.update = async ({ data }: any) => { h.state.journal.lines = data.lines.create; return h.state.journal; };
  h.tx.accountingPeriod = { findFirst: async () => ({ id: 'p1', status: 'OPEN' }) };
  h.tx.company.findUniqueOrThrow = async () => ({ baseCurrency: 'THB' });
  h.tx.postingRule = { findMany: async () => [] };
  h.tx.chartOfAccount = { findFirst: async ({ where }: any) => ({ id: where.OR?.[0]?.code ?? where.id, companyId: 'c1', status: 'ACTIVE', isPosting: true }),
    findUnique: async ({ where }: any) => ({ id: where.id, companyId: 'c1', status: 'ACTIVE', isPosting: true }) };
  const { rebuildExpenseDraftJournal } = await import('../../ledger/application/use-cases/journal.use-case');
  const raw: any = { ...h.state.expense, sourceType: 'expense.record', sourceId: 'e1', expenseNumber: 'EXP-1', lines: [{ taxableAmount: '100', vatAmount: '7', taxComponents: [component] }] };
  await rebuildExpenseDraftJournal(h.tx, h.ctx, raw, h.state.journal);
  const check = (claimable: boolean) => {
    const lines = h.state.journal.lines;
    assert.equal(lines.some((l: any) => l.accountId === 'input-vat'), claimable);
    assert.equal(lines.reduce((n: number, l: any) => n + Number(l.debitAmount ?? 0) - Number(l.creditAmount ?? 0), 0), 0);
    assert.equal(h.state.journal.status, 'DRAFT');
  };
  check(false);
  await h.repo.decideInputVat(h.ctx, 'e1', decisionInput); check(true);
  await h.repo.decideInputVat(h.ctx, 'e1', { toStatus: 'NON_CLAIMABLE', reason: 'ใช้ส่วนตัว' }); check(false);
  assert.equal(h.state.decisions.length, 2);
});

it('a posted journal refusal does not offer reopening or claim that reversal unlocks the right', async () => {
  const h = decisionHarness(); h.state.journal = { status: 'POSTED' };
  await assert.rejects(() => h.repo.decideInputVat(h.ctx, 'e1', decisionInput), (error: any) => {
    const refusal = error.getResponse();
    assert.equal(refusal.code, 'input_vat_posted_journal_immutable');
    assert.equal(refusal.message, 'รายจ่ายนี้ลงบัญชีแล้ว จึงเปลี่ยนสิทธิภาษีซื้อไม่ได้ แม้กลับรายการบัญชีแล้ว');
    assert.doesNotMatch(refusal.message, /แก้ไขเอกสาร/);
    return true;
  });
});

it('reads current VAT decision conditions and posted/period restrictions without making a decision', async () => {
  const h = decisionHarness({ vendorTaxIdSnapshot: null });
  let view = await h.repo.inputVatRight('c1', 'e1');
  assert.equal(view.vatStatus, 'REGISTERED');
  assert.equal(view.conditions?.find(c => c.code === 'SELLER_TAX_ID')?.answer, false);
  assert.equal(view.decisionBlocker, null);
  h.state.journal = { status: 'POSTED' };
  view = await h.repo.inputVatRight('c1', 'e1');
  assert.equal(view.decisionBlocker, 'input_vat_posted_journal_immutable');
  assert.equal(h.state.decisions.length, 0);
});

it('reads auto-posting and fixed shop answers without changing any stored right', async () => {
  const h = decisionHarness();
  h.tx.companyFeatureEntitlement.findMany = async () => ['expenses', 'double_entry_ledger', 'expense_auto_post'].map(featureKey => ({ featureKey }));
  assert.equal((await h.repo.inputVatRight('c1', 'e1')).postsToLedger, true);
  h.tx.companyFeatureEntitlement.findMany = async () => [{ featureKey: 'double_entry_ledger' }];
  assert.equal((await h.repo.inputVatRight('c1', 'e1')).postsToLedger, false);
  h.tx.companyVatRegistrationFact.findMany = async () => [{ status: 'NOT_REGISTERED', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, supersededAt: null, answeredAt: new Date('2020-01-01') }];
  const right = await h.repo.inputVatRight('c1', 'e1');
  assert.equal(right.vatStatus, 'NOT_REGISTERED'); assert.equal(right.fixed, true);
  assert.equal(right.reasonCode, 'COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE');
  assert.equal(h.state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
  h.state.period = { status: 'FILED' };
  assert.equal((await h.repo.inputVatRight('c1', 'e1')).decisionBlocker, 'tax_period_locked');
  assert.equal(h.state.decisions.length, 0);
});

it('identifies old confirmed input VAT answers consistently in detail and list reads', () => {
  const old = { status: 'CONFIRMED', sourceDocumentType: 'TAX_INVOICE', inputVatClaimStatus: 'NON_CLAIMABLE' };
  assert.equal(inputVatRecordedBeforeReview(old, false), true);
  assert.equal(inputVatRecordedBeforeReview(old, true), false);
  assert.equal(inputVatRecordedBeforeReview({ ...old, status: 'READY_FOR_CONFIRMATION' }, false), false);
  assert.equal(inputVatRecordedBeforeReview({ ...old, sourceDocumentType: 'RECEIPT' }, false), false);
  assert.equal(inputVatRecordedBeforeReview({ ...old, inputVatClaimStatus: 'CLAIMABLE' }, false), false);
});

for (const field of ['registeredName', 'taxId']) for (const value of [null, '', '   ']) it(`UX8 decision refuses empty shop ${field} (${JSON.stringify(value)}) even with every reviewer tick`, async () => {
  const { repo, ctx, state, tx } = decisionHarness({ buyerAsPrintedJson: {} });
  tx.company.findFirstOrThrow = async () => ({ name: 'ชื่อร้านบนเมนู', registeredName: 'ร้านเรา', taxId: '0100000000002', [field]: value });
  await assert.rejects(() => new DecideExpenseInputVatUseCase(repo).execute(ctx, 'e1', { ...decisionInput, buyerConfirmed: true }),
    (error: any) => error.getResponse().code === 'input_vat_company_identity_required' && error.getResponse().message.includes('ข้อมูลร้าน'));
  assert.equal(state.decisions.length, 0); assert.equal(state.expense.inputVatClaimStatus, 'NEEDS_REVIEW');
  const right = await repo.inputVatRight('c1', 'e1');
  assert.equal(right.conditions?.find(condition => condition.code === 'BUYER_MATCH')?.answer, false);
});
