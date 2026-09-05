import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import type { CreateExpenseDraftInput, RequestContext } from '@watchdog-bms/contracts';
import { CreateExpenseDraftUseCase, UpdateExpenseDraftUseCase } from './expense-draft.use-case';

const ctx: RequestContext = {
  requestId: 'req-amount-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['expense.create'], scopes: {}, authProvider: 'watchdog',
};

const input = (lines: CreateExpenseDraftInput['lines']): CreateExpenseDraftInput => ({
  captureSource: 'WEB_MANUAL',
  expenseDate: '2026-08-08',
  vatMode: 'NO_VAT',
  inputVatClaimStatus: 'NON_CLAIMABLE',
  lines,
});

function setup(resolveLines?: (lines: any[]) => any[]) {
  const created: any[] = [];
  const upserted: any[] = [];
  const repo = {
    resolveCreateBranchId: async () => 'branch-1',
    createExpense: async (data: any) => {
      created.push(data);
      return { id: 'expense-1', ...data };
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
