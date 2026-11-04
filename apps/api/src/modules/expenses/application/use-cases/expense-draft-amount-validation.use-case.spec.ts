import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { EXPENSE_CALCULATED_ROUNDING_SOURCE } from '@watchdog-bms/contracts';
import type { CreateExpenseDraftInput, RequestContext, UpdateExpenseDraftInput } from '@watchdog-bms/contracts';
import { RecordExpensePaymentUseCase, ConfirmExpenseUseCase, CreateExpenseDraftUseCase, UpdateExpenseDraftUseCase } from './expense-draft.use-case';

const ctx: RequestContext = {
  requestId: 'req-amount-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['expense.create'], scopes: {}, authProvider: 'watchdog',
};

const input = (lines: CreateExpenseDraftInput['lines']): CreateExpenseDraftInput => ({
  captureSource: 'WEB_MANUAL',
  expenseDate: '2026-08-08',
  vatMode: 'NO_VAT',
  lines,
});

function setup(resolveLines?: (lines: any[]) => any[]) {
  const created: any[] = [];
  const upserted: any[] = [];
  const repo = {
    resolveCreateBranchId: async () => 'branch-1',
    getEWhtSetting: async () => ({ used: true }),
    createExpense: async (data: any, withinTx?: (tx: unknown, record: any) => Promise<void>, _db?: unknown, beforeCreate?: (tx: unknown) => Promise<void>) => {
      await beforeCreate?.({});
      const record = { id: 'expense-1', ...data };
      if (withinTx) await withinTx({}, record);
      created.push(data);
      return record;
    },
    upsertLines: async (_companyId: string, _expenseId: string, lines: any[]) => { upserted.push(...lines); },
    // §5.1: an omitted chargeKind on PATCH keeps the stored one, so the update path reads them.
    listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
    deleteDraftExpense: async () => undefined,
  } as any;
  const audit = { log: async () => undefined } as any;
  // The Tax Code resolution is a real collaborator whose output is what gets persisted, while the
  // header totals come from `reconcileExpenseVat`. Overriding it is how a test makes the two
  // disagree - which is the only way the section 5.1 identity assertion can be reached.
  const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: any[]) => (resolveLines ? resolveLines(lines) : lines) } as any;
  const launchGate = { assertLaunchRouteOpen: async () => undefined } as any;
  return { useCase: new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate), created, upserted };
}

describe('CreateExpenseDraftUseCase amount persistence boundary', () => {
  it('R1 persists explicit remittance and clears it when withholding becomes zero (paid path)', async () => {
    for (const whtRemittance of ['PAYER_FILES', 'E_WHT', null] as const) for (const value of ['0', '3']) {
      const { useCase, created } = setup();
      await useCase.execute(ctx, { ...input([{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '100' }]),
        whtInput: { inputType: 'AMOUNT', value }, whtRemittance });
      assert.equal(created[0].whtRemittance, value === '0' ? null : whtRemittance);
    }
  });

  it('R1 refuses invalid remittance before creating a paid draft', async () => {
    const { useCase, created } = setup();
    await assert.rejects(() => useCase.execute(ctx, { ...input([]), whtRemittance: 'BANK' } as any),
      (error: any) => error.getResponse().code === 'expense_wht_remittance_invalid');
    assert.equal(created.length, 0);
  });
  it('persists an exact baht input and accepted WHT without inventing a rate', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, {
      ...input([{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '1234.56' }]),
      whtInput: { inputType: 'AMOUNT', value: '30.01' },
    });
    assert.deepEqual(created[0].whtInputJson, { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' });
    assert.equal(created[0].whtAmount, '30.0100');
    assert.equal(created[0].grandTotalAmount, '1234.5600');
    assert.equal(created[0].netPayableAmount, '1204.5500');
    assert.equal(upserted[0].whtRate, null);
    assert.equal(upserted[0].whtAmount, created[0].whtAmount);
  });

  it('rejects malformed/excess baht source before creating anything', async () => {
    for (const whtInput of [{ inputType: 'AMOUNT', value: '100.01' }, { inputType: 'RATE', value: '3.001' },
      { inputType: 'RATE', value: '3', origin: 'OCR' }]) {
      const { useCase, created, upserted } = setup();
      await assert.rejects(() => useCase.execute(ctx, {
        ...input([{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100' }]),
        whtInput,
      } as any));
      assert.equal(created.length, 0);
      assert.equal(upserted.length, 0);
    }
  });

  it('rejects malformed input before creating a database record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(
      () => useCase.execute(ctx, input([{ lineNumber: 1, description: 'ค่าใช้จ่าย', quantity: '1e3', unitPrice: '100' }])),
      /quantity must be positive and fit Decimal\(18,4\)/,
    );
    assert.equal(created.length, 0);
  });

  it('rejects a multi-line aggregate overflow before creating a database record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(
      () => useCase.execute(ctx, input([
        { lineNumber: 1, description: 'รายการ 1', quantity: '1', unitPrice: '60000000000000' },
        { lineNumber: 2, description: 'รายการ 2', quantity: '1', unitPrice: '60000000000000' },
      ])),
      /aggregate amount exceeds Decimal\(18,4\)/,
    );
    assert.equal(created.length, 0);
  });

  it('persists exact boundary-safe line and header totals', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, input([
      { lineNumber: 1, description: 'รายการมูลค่าสูง', quantity: '1', unitPrice: '99999999999999.99' },
    ]));

    assert.equal(created[0].subtotalAmount, '99999999999999.9900');
    assert.equal(created[0].grandTotalAmount, '99999999999999.9900');
    assert.equal(upserted[0].lineSubtotalAmount, '99999999999999.9900');
  });

  it('creates mixed-VAT lines with independent zero treatment and no invented historical meaning', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, {
      ...input([
        { lineNumber: 1, description: 'Taxable', quantity: '1', unitPrice: '100', vatRate: '0.07' },
        { lineNumber: 2, description: 'Exempt', quantity: '1', unitPrice: '50', vatRate: '0', vatTreatment: 'EXEMPT' },
        { lineNumber: 3, description: 'Legacy zero', quantity: '1', unitPrice: '20', vatRate: '0' },
      ]),
      vatMode: 'VAT_EXCLUDED',
    });
    assert.equal(created[0].grandTotalAmount, '177.0000');
    assert.deepEqual(upserted.map((line) => line.vatTreatment), [null, 'EXEMPT', null]);
    assert.deepEqual(upserted.map((line) => line.vatAmount), ['7.0000', '0.0000', '0.0000']);
  });

  it('rejects a line source that overrides an explicit zero treatment before creating the record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(() => useCase.execute(ctx, {
      ...input([{ lineNumber: 1, description: 'Exempt', quantity: '1', unitPrice: '100', vatRate: '0', vatTreatment: 'EXEMPT' }]),
      vatMode: 'VAT_EXCLUDED',
      vatSource: { inputType: 'NONE', lines: [{ lineNumber: 1, inputType: 'RATE', vatRatePercent: '7' }] },
    }), /requires an explicit zero VAT rate/);
    assert.equal(created.length, 0);
  });
});

describe('e-WHT remittance write authority (R1)', () => {
  const revision = new Date('2026-11-04T00:00:00Z');
  function remittanceHarness(free = false) {
    let record: any = { id: 'expense-1', companyId: ctx.companyId, createdByUserId: ctx.userId,
      branchId: null, status: 'DRAFT', captureSource: 'WEB_UPLOAD', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY',
      vatMode: 'NO_VAT', currency: 'THB', expenseDate: revision, updatedAt: revision, whtAmount: '3', whtRemittance: 'E_WHT' };
    const writes: any[] = [];
    const commercialAccessDb = {
      company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null,
        planTerm: free ? { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0) } : null }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
      billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null },
      salesAttribution: { findUnique: async () => null },
    };
    const repo: any = { commercialAccessDb, getEWhtSetting: async () => ({ used: true }), assertEWhtRemittancePayments: async () => undefined, findById: async () => record, listLineChargeKinds: async () => new Map(),
      updateExpense: async (data: any) => { writes.push(data); record = { ...record, ...data }; return record; } };
    const audit = { log: async () => undefined } as any;
    return { repo, writes, update: new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any),
      create: new CreateExpenseDraftUseCase(repo, audit, {} as any, {} as any),
      confirm: new ConfirmExpenseUseCase(repo, audit, {} as any, {} as any) };
  }
  it('preserves absent remittance, accepts explicit changes and clears explicit null on the paid reviewer path', async () => {
    const h = remittanceHarness();
    const reviewer = { ...ctx, permissions: ['expense.review'] };
    await h.update.execute(reviewer, 'expense-1', { note: 'ตรวจแล้ว' });
    assert.equal(h.writes[0].whtRemittance, undefined);
    for (const whtRemittance of ['PAYER_FILES', 'E_WHT', null] as const) {
      const saved = await h.update.execute(reviewer, 'expense-1', { whtRemittance });
      assert.equal(saved.whtRemittance, whtRemittance);
    }
  });
  it('refuses remittance changes by a paid uploader without review permission', async () => {
    const h = remittanceHarness();
    await assert.rejects(() => h.update.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', { whtRemittance: 'E_WHT' }),
      (error: any) => error.getStatus() === 403);
    assert.equal(h.writes.length, 0);
  });
  it('clears stored e-WHT when a paid reviewer removes withholding', async () => {
    const h = remittanceHarness();
    const saved = await h.update.execute({ ...ctx, permissions: ['expense.review'] }, 'expense-1', {
      lines: [{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '100' }],
      whtInput: { inputType: 'AMOUNT', value: '0' },
    });
    assert.equal(saved.whtAmount, '0.0000');
    assert.equal(saved.whtRemittance, null);
  });
  it('refuses invalid paid updates without writing any expense', async () => {
    const h = remittanceHarness();
    await assert.rejects(() => h.update.execute({ ...ctx, permissions: ['expense.review'] }, 'expense-1', { whtRemittance: 'BANK' } as any),
      (error: any) => error.getResponse().code === 'expense_wht_remittance_invalid');
    assert.equal(h.writes.length, 0);
  });
  it('never opens create, remittance update or confirmation for never-paid free source drafts', async () => {
    const h = remittanceHarness(true);
    // Even stale financial grants cannot turn the free source-draft path into a tax workflow.
    const freeCtx = { ...ctx, permissions: ['expense.create', 'expense.update', 'expense.review', 'expense.confirm'], freeExpenseDrafts: true };
    const denied = (error: any) => error.getStatus() === 403 && error.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY';
    for (const whtRemittance of ['PAYER_FILES', 'E_WHT', null] as const) {
      await assert.rejects(() => h.create.execute(freeCtx, { ...input([]), whtRemittance }), denied);
      await assert.rejects(() => h.update.execute(freeCtx, 'expense-1', { expectedUpdatedAt: revision.toISOString(), whtRemittance }), denied);
    }
    await assert.rejects(() => h.confirm.execute(freeCtx, 'expense-1'), denied);
    const payment = new RecordExpensePaymentUseCase(h.repo, { log: async () => undefined } as any);
    for (const paymentMethod of ['CASH', 'CARD', 'BANK_TRANSFER'] as const) {
      await assert.rejects(() => payment.execute(freeCtx, 'expense-1', { paidAmount: '1', paymentMethod }), denied);
      await assert.rejects(() => payment.previewLineAction(freeCtx, 'expense-1', { paidAmount: '1', paymentMethod }), denied);
    }
    assert.equal(h.writes.length, 0);
  });
  it('R19 reads the setting only for explicit E_WHT and preserves existing e-WHT after disabling', async () => {
    const h = remittanceHarness(); let reads = 0;
    h.repo.getEWhtSetting = async () => { reads++; return { used: false }; };
    const reviewer = { ...ctx, permissions: ['expense.review'] };
    await h.update.execute(reviewer, 'expense-1', {});
    assert.equal(reads, 0);
    await h.update.execute(reviewer, 'expense-1', { whtRemittance: 'E_WHT' });
    assert.equal(reads, 1);
    await h.update.execute(reviewer, 'expense-1', { whtRemittance: 'PAYER_FILES' });
    assert.equal(reads, 1);
    const writes = h.writes.length;
    await assert.rejects(() => h.update.execute(reviewer, 'expense-1', { whtRemittance: 'E_WHT' }),
      (e: any) => e.getStatus() === 422 && e.getResponse().code === 'expense_e_wht_not_enabled');
    assert.equal(h.writes.length, writes);
  });
  it('R4 checks recorded cash/card payments before allowing a paid remittance update', async () => {
    const h = remittanceHarness();
    h.repo.assertEWhtRemittancePayments = async (companyId: string, expenseId: string, requested: string) => {
      assert.equal(companyId, ctx.companyId); assert.equal(expenseId, 'expense-1'); assert.equal(requested, 'E_WHT');
      const { ConflictException } = await import('@nestjs/common');
      throw new ConflictException({ code: 'expense_ewht_cash_payment_exists' });
    };
    await assert.rejects(() => h.update.execute({ ...ctx, permissions: ['expense.review'] }, 'expense-1', { whtRemittance: 'E_WHT' }),
      (e: any) => e.getStatus() === 409 && e.getResponse().code === 'expense_ewht_cash_payment_exists');
    assert.equal(h.writes.length, 0);
  });
});

describe('UpdateExpenseDraftUseCase amount persistence boundary', () => {
  it('rejects malformed replacement lines before tax resolution or persistence', async () => {
    let resolved = false;
    let upserted = false;
    const repo = {
      findById: async () => ({
        id: 'expense-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1',
        status: 'DRAFT', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW',
        vatMode: 'NO_VAT', currency: 'THB', expenseDate: new Date('2026-08-08T00:00:00.000Z'),
      }),
      upsertLines: async () => { upserted = true; },
      // §5.1: an omitted chargeKind on PATCH keeps the stored one, so the update path reads them.
      listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
    } as any;
    const audit = { log: async () => undefined } as any;
    const transactionTax = {
      resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => { resolved = true; return lines; },
    } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, transactionTax);

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
        lines: [{ lineNumber: 1, description: 'ค่าใช้จ่าย', quantity: '1', unitPrice: '100000000000000' }],
      }),
      /unit price must be non-negative and fit Decimal\(18,4\)/,
    );
    assert.equal(resolved, false);
    assert.equal(upserted, false);
  });
});

/**
 * Spec 5.1. The header totals are `reconcileExpenseVat`'s and the persisted lines are whatever
 * `TransactionTaxService.resolveLines` handed back - two sources, one write, and nothing downstream
 * re-derives either from the other. A record written with the two disagreeing is a grand total whose
 * own rows do not add up to it, which is exactly what the charge split makes possible: lose the
 * `chargeKind` on the way through and the goods subtotal silently swallows the service charge.
 */
describe('expense totals identity at the write boundary', () => {
  const bhc = (): CreateExpenseDraftInput => ({
    ...input([
      { lineNumber: 1, description: 'aahaan', quantity: '1', unitPrice: '1520', vatRate: '0.07' },
      { lineNumber: 2, description: 'service charge', chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '152', vatRate: '0.07' },
    ]),
    vatMode: 'VAT_EXCLUDED',
  });

  it('writes the bill when the header and the resolved lines agree', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, bhc());
    assert.equal(created[0].subtotalAmount, '1520.0000');
    assert.equal(created[0].taxableAmount, '1672.0000');
    assert.equal(created[0].grandTotalAmount, '1789.0400');
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null, 'SERVICE_CHARGE']);
  });

  it('refuses the write when tax resolution drops the charge kind', async () => {
    const { useCase, upserted } = setup((lines) => lines.map((line) => ({ ...line, chargeKind: null })));
    await assert.rejects(
      () => useCase.execute(ctx, bhc()),
      /Totals identity: subtotal 1520.0000 is not the 1672.00 the product lines add up to/,
    );
    assert.equal(upserted.length, 0, 'nothing is persisted when the two sides disagree');
  });

  // Finding F8. A printed WHT sends the header back through `applyExpenseWhtInput`, which rebuilds
  // it from the rows `reconcileExpenseVat` returned — so this is the create-side twin of the update
  // path, and while those rows dropped `chargeKind` it rejected the reviewer's own write.
  it('writes the bill when a printed WHT recomputes the header', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, { ...bhc(), whtInput: { inputType: 'RATE', value: '3' } });
    assert.equal(created[0].subtotalAmount, '1520.0000', 'the service charge is not goods');
    assert.equal(created[0].taxableAmount, '1672.0000');
    assert.equal(created[0].grandTotalAmount, '1789.0400');
    // The WHT rule is unchanged: this path withholds against the whole document.
    assert.equal(created[0].whtAmount, '50.1600');
    assert.deepEqual(upserted.map((line) => line.whtAmount), ['45.6000', '4.5600']);
  });

  it('refuses the write when tax resolution moves a line amount', async () => {
    const { useCase, upserted } = setup((lines) => lines.map((line, index) => (index === 0
      ? { ...line, taxableAmount: '999.0000', lineSubtotalAmount: '999.0000' } : line)));
    await assert.rejects(() => useCase.execute(ctx, bhc()), /Totals identity/);
    assert.equal(upserted.length, 0);
  });
});

/**
 * Spec 5.1 PATCH semantics. `lines` is a full replacement, so a client that echoes a stored line
 * back without `chargeKind` was CLEARING it: a service charge silently became a product row, the
 * goods subtotal grew by its amount, and the request answered 200. Absent means "leave this line's
 * kind alone" now; only an explicit null clears one.
 */
describe('chargeKind on a replacement PATCH', () => {
  function updateSetup(stored: Array<[number, { chargeKind: string | null; description: string }]>) {
    const upserted: any[] = [];
    const updated: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'expense-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1',
        status: 'DRAFT', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW',
        vatMode: 'VAT_EXCLUDED', currency: 'THB', expenseDate: new Date('2026-08-08T00:00:00.000Z'),
      }),
      listLineChargeKinds: async () => new Map(stored),
      upsertLines: async (_companyId: string, _expenseId: string, lines: any[]) => { upserted.push(...lines); },
      // The real repository runs the line write inside its own transaction callback, so the fake
      // has to invoke it or nothing is ever upserted.
      updateExpense: async (data: any, withinTx?: (tx: unknown) => Promise<void>) => {
        updated.push(data);
        if (withinTx) await withinTx({});
        return { id: 'expense-1', ...data };
      },
    } as any;
    const audit = { log: async () => undefined } as any;
    const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
    return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), upserted, updated };
  }

  const echoed = (chargeKind?: string | null) => ({
    lines: [
      { lineNumber: 1, description: 'aahaan', quantity: '1', unitPrice: '1520', vatRate: '0.07' },
      { lineNumber: 2, description: 'service charge', quantity: '1', unitPrice: '152', vatRate: '0.07',
        ...(chargeKind !== undefined ? { chargeKind } : {}) },
    ],
  });

  const storedBhc = (): Array<[number, { chargeKind: string | null; description: string }]> => [
    [1, { chargeKind: null, description: 'aahaan' }],
    [2, { chargeKind: 'SERVICE_CHARGE', description: 'service charge' }],
  ];

  it('keeps the stored kind when the field is absent', async () => {
    const { useCase, upserted, updated } = updateSetup(storedBhc());
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', echoed() as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null, 'SERVICE_CHARGE']);
    assert.equal(updated[0].subtotalAmount, '1520.0000', 'the charge did not fall back into the goods subtotal');
    assert.equal(updated[0].grandTotalAmount, '1789.0400');
  });

  it('clears the kind only when null is sent explicitly', async () => {
    const { useCase, upserted, updated } = updateSetup(storedBhc());
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', echoed(null) as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null, null]);
    assert.equal(updated[0].subtotalAmount, '1672.0000', 'cleared explicitly, so it is goods now');
  });

  it('changes the kind when a different one is sent', async () => {
    const { useCase, upserted } = updateSetup(storedBhc());
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', echoed('DELIVERY') as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null, 'DELIVERY']);
  });

  it('validates the kept kind, so an absent field cannot smuggle a charge past the shape rules', async () => {
    const { useCase, upserted } = updateSetup([[1, { chargeKind: 'SERVICE_CHARGE', description: 'service charge' }]]);
    // Line 1 is stored as a charge; echoing it back with quantity 2 must be refused on the kept
    // kind, not accepted because the payload looked like an ordinary product row.
    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
        lines: [{ lineNumber: 1, description: 'service charge', quantity: '2', unitPrice: '76', vatRate: '0.07' }],
      } as any),
      /must have quantity 1/,
    );
    assert.equal(upserted.length, 0);
  });
});

/**
 * The bug the round-1 "absent = keep" fix introduced. `lineNumber` is a POSITION: inserting a goods
 * row renumbers everything below it, so the row arriving as line 2 is not the row that was line 2.
 * Keyed by number alone, a newly typed ของหวาน inherited the service charge sitting under it and the
 * request answered 200 with the dessert stored as SERVICE_CHARGE — and `totalsIdentity` said ok,
 * because it is derived from those same wrong kinds.
 */
describe('chargeKind across a renumbering PATCH', () => {
  function setupWithStored(stored: Array<[number, { chargeKind: string | null; description: string }]>) {
    const upserted: any[] = [];
    const updated: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'expense-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1',
        status: 'DRAFT', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW',
        vatMode: 'VAT_EXCLUDED', currency: 'THB', expenseDate: new Date('2026-08-08T00:00:00.000Z'),
      }),
      listLineChargeKinds: async () => new Map(stored),
      upsertLines: async (_companyId: string, _expenseId: string, lines: any[]) => { upserted.push(...lines); },
      updateExpense: async (data: any, withinTx?: (tx: unknown) => Promise<void>) => {
        updated.push(data);
        if (withinTx) await withinTx({});
        return { id: 'expense-1', ...data };
      },
    } as any;
    const audit = { log: async () => undefined } as any;
    const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
    return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), upserted, updated };
  }

  const stored: Array<[number, { chargeKind: string | null; description: string }]> = [
    [1, { chargeKind: null, description: 'aahaan' }],
    [2, { chargeKind: 'SERVICE_CHARGE', description: 'service charge' }],
  ];

  it('does not hand a new goods row the kind of the charge it displaced', async () => {
    const { useCase, upserted, updated } = setupWithStored(stored);
    // A reviewer typing a dessert: it goes in before the charges, so the charge becomes line 3.
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [
        { lineNumber: 1, description: 'aahaan', quantity: '1', unitPrice: '1520', vatRate: '0.07' },
        { lineNumber: 2, description: 'khong waan', quantity: '1', unitPrice: '120', vatRate: '0.07' },
        { lineNumber: 3, description: 'service charge', quantity: '1', unitPrice: '152', vatRate: '0.07' },
      ],
    } as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null, null, 'SERVICE_CHARGE'],
      'the dessert stays goods and the charge keeps its kind at its new number');
    assert.equal(updated[0].subtotalAmount, '1640.0000', 'the dessert is in the goods subtotal');
    assert.equal(updated[0].taxableAmount, '1792.0000');
  });

  it('drops a kind rather than guess when the row at that number is a different row', async () => {
    const { useCase, upserted } = setupWithStored(stored);
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [{ lineNumber: 2, description: 'something else entirely', quantity: '1', unitPrice: '10', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null]);
  });

  it('refuses to guess when two stored rows share the description', async () => {
    const { useCase, upserted } = setupWithStored([
      [1, { chargeKind: null, description: 'aahaan' }],
      [2, { chargeKind: 'SERVICE_CHARGE', description: 'aahaan' }],
    ]);
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [{ lineNumber: 1, description: 'aahaan', quantity: '1', unitPrice: '100', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), [null], 'ambiguous is not an identity');
  });

  /**
   * The one collision description-matching cannot resolve, pinned so it cannot widen unnoticed: a
   * caller that omits the field AND renames a product to a stored charge row's exact description
   * inherits that kind. Nothing on the wire distinguishes it from "this is that charge row". Far
   * narrower than the line-number version it replaced — a byte-exact description collision rather
   * than any insert — and unreachable from the web form, the LINE lane or the OCR apply, which all
   * state `chargeKind` on every row. Sending the field explicitly is the escape hatch, and making
   * it required is the follow-up.
   */
  it('still inherits a kind when a legacy caller renames a product onto a charge description', async () => {
    const { useCase, upserted } = setupWithStored(stored);
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [{ lineNumber: 1, description: 'service charge', quantity: '1', unitPrice: '120', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), ['SERVICE_CHARGE'],
      'documented residual: the wire format carries no row identity to tell this from a rename');

    // The escape hatch every first-party caller already takes.
    const explicit = setupWithStored(stored);
    await explicit.useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [{ lineNumber: 1, description: 'service charge', chargeKind: null, quantity: '1', unitPrice: '120', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(explicit.upserted.map((line) => line.chargeKind), [null]);
  });

  it('keeps the kind on a charge-only record whose single row is unmoved', async () => {
    const { useCase, upserted, updated } = setupWithStored([[1, { chargeKind: 'SERVICE_CHARGE', description: 'service charge' }]]);
    await useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
      lines: [{ lineNumber: 1, description: 'service charge', quantity: '1', unitPrice: '152', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(upserted.map((line) => line.chargeKind), ['SERVICE_CHARGE']);
    assert.equal(updated[0].subtotalAmount, '0.0000', 'a record that is nothing but a charge has no goods');
    assert.equal(updated[0].taxableAmount, '152.0000');
  });
});


describe('read-only receipt totals and precision', () => {
const ctx = { companyId: 'company-1', userId: 'owner-1', permissions: ['expense.review'], scopes: {}, authProvider: 'watchdog' } as RequestContext;
const revision = '2026-09-09T00:00:00.000Z';
const product = { id: 'line-1', lineNumber: 1, description: 'HIDIESEL', quantity: '61.488', unitPrice: '39.19', discountAmount: '0', vatRate: '0.07', whtRate: null, chargeKind: null };
const automatic = { id: 'line-2', lineNumber: 2, description: 'ปรับเศษจากจำนวนและราคาต่อหน่วย', quantity: '1', unitPrice: '-0.01', discountAmount: '0', vatRate: '0', whtRate: null, chargeKind: 'ROUNDING', sourceLineText: EXPENSE_CALCULATED_ROUNDING_SOURCE };
function setup(storedLines: any[] = [product, automatic], extra: Record<string, unknown> = {}) {
  let record: any = { id: 'expense-1', companyId: ctx.companyId, createdByUserId: ctx.userId, branchId: null,
    status: 'DRAFT', captureSource: 'WEB_UPLOAD', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW',
    currency: 'THB', expenseDate: new Date('2026-09-07'), updatedAt: new Date(revision), vatMode: 'VAT_INCLUDED',
    paidAmount: '0', vatAmount: '157.6400', grandTotalAmount: '2409.7000',
    aiVerifiedFieldsJson: { quantity: '61.488', unitPrice: '39.19', grandTotalAmount: '2409.70' }, ...extra };
  let writes = 0, audits = 0;
  const repo: any = {
    findById: async (company: string) => company === ctx.companyId ? record : null,
    findByIdWithRelations: async (company: string) => company === ctx.companyId ? { ...record, lines: storedLines } : null,
    listLineChargeKinds: async () => new Map(storedLines.map((line) => [line.lineNumber, line])),
    updateExpense: async (patch: any, callback?: (db: any) => Promise<void>) => { writes++; if (callback) await callback({}); record = { ...record, ...patch }; return record; },
    upsertLines: async (_company: string, _expense: string, lines: any[]) => { writes++; storedLines = lines.map((line, i) => ({ ...line, id: line.preserveLineId ?? `new-${i}` })); },
  };
  const useCase = new UpdateExpenseDraftUseCase(repo, { log: async () => { audits++; } } as any,
    { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any);
  const input: UpdateExpenseDraftInput = { expectedUpdatedAt: revision, vatMode: record.vatMode,
    vatSource: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '157.64' },
    lines: storedLines.map(({ sourceLineText, ...line }) => line) };
  return { input, useCase, state: () => ({ writes, audits, storedLines, record }) };
}

it('fuel preview uses exact save arithmetic, ignores edited adjustment and performs zero writes', async () => {
  const { useCase, input, state } = setup();
  input.lines![1]!.unitPrice = '0.003';
  const preview = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true, requireExpectedUpdatedAt: true });
  assert.equal(preview.grandTotalAmount, '2409.7000');
  assert.equal(preview.vatAmount, '157.6400');
  assert.equal(preview.taxableAmount, '2252.0600');
  assert.equal(preview.calculatedAdjustmentAmount, '-0.0100');
  assert.equal(preview.chargesTotalAmount, '0.0000');
  assert.equal(state().writes, 0); assert.equal(state().audits, 0);
  const saved = await useCase.execute(ctx, 'expense-1', input);
  for (const key of ['grandTotalAmount', 'vatAmount', 'taxableAmount', 'netPayableAmount'] as const) assert.equal(saved[key], preview[key]);
  assert.equal(state().storedLines[1].sourceLineText, EXPENSE_CALCULATED_ROUNDING_SOURCE);
  const again = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true });
  assert.equal(again.grandTotalAmount, preview.grandTotalAmount);
});

it('changed quantity, price, added service and deletion remove obsolete auto adjustment; draft remains saveable', async () => {
  for (const edit of [(i: UpdateExpenseDraftInput) => { i.lines![0]!.quantity = '62'; },
    (i: UpdateExpenseDraftInput) => { i.lines![0]!.unitPrice = '40'; },
    (i: UpdateExpenseDraftInput) => { i.lines!.push({ lineNumber: 3, description: 'Delivery', quantity: '1', unitPrice: '100', vatRate: '0', chargeKind: 'DELIVERY' }); },
    (i: UpdateExpenseDraftInput) => { i.lines = [{ lineNumber: 1, description: 'Corrected receipt', quantity: '1', unitPrice: '100', vatRate: '0.07', chargeKind: null }]; }]) {
    const { useCase, input } = setup(); edit(input);
    const preview = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true });
    assert.equal(preview.calculatedAdjustmentAmount, '0.0000');
    assert.notEqual(preview.grandTotalAmount, '2409.7000');
    const saved = await useCase.execute(ctx, 'expense-1', input);
    assert.equal(saved.grandTotalAmount, preview.grandTotalAmount, 'mismatch is retained for final review, not a draft dead end');
  }
});

it('printed rounding is preserved separately with VAT plus independent WHT', async () => {
  const { useCase, input, state } = setup([
    { ...product, quantity: '1', unitPrice: '1360', vatRate: '0.07' },
    { ...automatic, description: 'Service', chargeKind: 'SERVICE_CHARGE', unitPrice: '136', vatRate: '0.07', sourceLineText: 'Service charge 136.00' },
    { ...automatic, id: 'line-3', lineNumber: 3, description: 'Rounding', unitPrice: '-0.72', sourceLineText: 'Rounding -0.72' },
  ], { vatMode: 'VAT_EXCLUDED' });
  input.vatSource = { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '104.72' };
  input.whtInput = { inputType: 'RATE', value: '3', baseAmount: '1000' };
  const preview = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true });
  assert.equal(preview.grandTotalAmount, '1600.0000');
  assert.equal(preview.vatAmount, '104.7200'); assert.equal(preview.whtAmount, '30.0000');
  assert.equal(preview.netPayableAmount, '1570.0000');
  assert.equal(preview.chargesTotalAmount, '136.0000'); assert.equal(preview.printedRoundingAmount, '-0.7200');
  assert.equal(preview.calculatedAdjustmentAmount, '0.0000');
  const saved = await useCase.execute(ctx, 'expense-1', input);
  assert.equal(saved.netPayableAmount, preview.netPayableAmount);
  assert.equal(state().storedLines[2].sourceLineText, 'Rounding -0.72');
});

it('mixed VAT with source amount preserves exempt goods and has no synthesized rounding', async () => {
  const { useCase, input } = setup([{ ...product, quantity: '1', unitPrice: '239', vatRate: '0' },
    { ...product, id: 'line-2', lineNumber: 2, description: 'Taxed', quantity: '1', unitPrice: '161' }]);
  input.vatSource = { inputType: 'AMOUNT', vatAmount: '10.53' };
  const preview = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true });
  assert.equal(preview.grandTotalAmount, '400.0000'); assert.equal(preview.vatAmount, '10.5300');
  assert.equal(preview.calculatedAdjustmentAmount, '0.0000');
});

it('preview rejects stale, unauthorized, other-tenant, foreign row and invalid amounts without writes', async () => {
  for (const variant of ['stale', 'permission', 'tenant', 'row', 'amount', 'wht', 'vat-source-shape', 'vat-source-row'] as const) {
    const { useCase, input, state } = setup();
    let actor = ctx;
    if (variant === 'stale') input.expectedUpdatedAt = '2026-09-08T00:00:00Z';
    if (variant === 'permission') actor = { ...ctx, userId: 'other', permissions: ['expense.update'] };
    if (variant === 'tenant') actor = { ...ctx, companyId: 'company-2' };
    if (variant === 'row') input.lines![0]!.id = 'foreign-row';
    if (variant === 'amount') input.lines![0]!.unitPrice = '-10';
    if (variant === 'wht') input.whtInput = { inputType: 'AMOUNT', value: '999999' };
    if (variant === 'vat-source-shape') input.vatSource = { inputType: 'NONE', origin: 'AI', lines: [{ lineNumber: 2, inputType: 'AMOUNT', vatAmount: '0' }] } as any;
    if (variant === 'vat-source-row') input.vatSource = { inputType: 'NONE', lines: [{ lineNumber: 99, inputType: 'AMOUNT', vatAmount: '0' }] };
    await assert.rejects(() => useCase.execute(actor, 'expense-1', input, { previewOnly: true, requireExpectedUpdatedAt: true }),
      (error: any) => variant !== 'stale' || error.getResponse().code === 'EXPENSE_UPDATE_CONFLICT');
    assert.equal(state().writes, 0); assert.equal(state().audits, 0);
  }
});

it('saving a reopened expense keeps recorded payments and derives the remaining balance and payment state', async () => {
  for (const [paid, outstanding, status] of [['40', '2369.7000', 'PARTIALLY_PAID'], ['2409.70', '0.0000', 'PAID']]) {
    const { useCase, input } = setup(undefined, { status: 'NEEDS_REVIEW', paidAmount: paid });
    const saved = await useCase.execute(ctx, 'expense-1', input);
    assert.equal(saved.paidAmount, paid); assert.equal(saved.outstandingAmount, outstanding); assert.equal(saved.paymentStatus, status);
  }
});

});

describe('manual draft seller name', () => {
  it('accepts and trims a supplied seller without creating a counterparty', async () => {
    const { useCase, created } = setup();
    await useCase.execute(ctx, { ...input([]), vendorNameSnapshot: '  ร้านกาแฟ  ' } as any);
    assert.equal(created[0].vendorNameSnapshot, 'ร้านกาแฟ');
    assert.equal(created[0].vendorCounterpartyId, undefined);
  });
  it('refuses an overlong seller with a sentence before creating a draft', async () => {
    const { useCase, created } = setup();
    await assert.rejects(() => useCase.execute(ctx, { ...input([]), vendorNameSnapshot: 'ก'.repeat(201) } as any), /ชื่อผู้ขายยาวเกิน 200 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง/);
    assert.equal(created.length, 0);
  });
  it('keeps an absent seller optional', async () => {
    const { useCase, created } = setup(); await useCase.execute(ctx, input([]));
    assert.equal(created[0].vendorNameSnapshot, undefined);
  });
});


for (const inputVatClaimStatus of ['NON_CLAIMABLE', 'NEEDS_REVIEW', 'CLAIMABLE'] as const) it(`does not accept a human ${inputVatClaimStatus} on creation`, async () => {
  const { useCase, created } = setup();
  await assert.rejects(() => useCase.execute(ctx, { ...input([]), inputVatClaimStatus }), (error: any) => error.getResponse().code === 'expense_input_vat_decision_required');
  assert.equal(created.length, 0);
});

it('preserves each income type and rate through the draft persistence boundary', async () => {
  const { useCase, created, upserted } = setup();
  await useCase.execute(ctx, input([
    { lineNumber: 1, description: 'ค่าเช่า', quantity: '1', unitPrice: '100', whtRate: '0.05', whtCategoryCode: 'WHT_RENT' },
    { lineNumber: 2, description: 'ค่าบริการ', quantity: '1', unitPrice: '200', whtRate: '0.02', whtCategoryCode: 'WHT_SERVICE' },
  ]));
  assert.deepEqual(upserted.map(l => [l.whtCategoryCode, l.whtRate, l.whtAmount]), [['WHT_RENT', '0.05', '5.0000'], ['WHT_SERVICE', '0.02', '4.0000']]);
  assert.equal(created[0].netPayableAmount, '291.0000');
});

describe('R19 paid e-WHT creation and replay', () => {
  it('rejects a new e-WHT before INSERT but replays an exact prior create after disabling', async () => {
    const { PrismaExpenseRepository } = await import('../../infrastructure/prisma-expense.repository');
    const { canonicalFingerprint } = await import('../../../../common/security/canonical-fingerprint');
    let existing: any = null, settingReads = 0;
    const body = { ...input([{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '100' }]),
      idempotencyKey: 'ewht-create-1', whtInput: { inputType: 'AMOUNT' as const, value: '3' }, whtRemittance: 'E_WHT' as const };
    const db: any = { company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      $executeRaw: async () => 0, $transaction: async (work: any) => work(db),
      documentNumber: { findFirst: async () => null },
      expenseRecord: { findFirst: async () => existing, create: async () => assert.fail('disabled new e-WHT must not insert') },
      companyTaxProfile: { findUnique: async () => { settingReads++; return { eWhtUsed: false }; } } };
    const repo = new PrismaExpenseRepository({ client: db } as any);
    repo.resolveCreateBranchId = async () => 'branch-1';
    const uc = new CreateExpenseDraftUseCase(repo, { log: async () => undefined } as any, {} as any, { assertLaunchRouteOpen: async () => undefined } as any);
    await assert.rejects(() => uc.execute(ctx, body), (e: any) => e.getStatus() === 422 && e.getResponse().code === 'expense_e_wht_not_enabled');
    assert.equal(settingReads, 1);
    existing = { id: 'existing-1', companyId: ctx.companyId, createdByUserId: ctx.userId, branchId: 'branch-1', whtRemittance: 'E_WHT',
      expenseDate: new Date(body.expenseDate), draftPayloadHash: canonicalFingerprint({ version: 1, ...body, idempotencyKey: null }) };
    const replayed = await uc.execute(ctx, body);
    assert.equal(replayed.id, existing.id); assert.equal(replayed.whtRemittance, 'E_WHT');
    assert.equal(settingReads, 1, 'an exact replay does not reread the setting');
  });
});
