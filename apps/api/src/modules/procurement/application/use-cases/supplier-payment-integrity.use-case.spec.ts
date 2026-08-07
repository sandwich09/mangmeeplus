import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateSupplierPaymentUseCase } from './supplier-payment.use-case.js';

const ctx = (branchIds?: string[]) => ({
  companyId: 'company-1', userId: 'payer-1', requestId: 'request-1',
  permissions: ['procurement.supplier_payment.create', 'procurement.supplier_payment.release'], scopes: branchIds ? { branchIds } : {},
}) as any;

const dto = (overrides: Record<string, unknown> = {}) => ({
  supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-07-14'), method: 'BANK_TRANSFER', currency: 'THB',
  grossAmount: '100', netPaidAmount: '100', allocations: [{ vendorBillId: 'bill-1', amount: '100' }], ...overrides,
}) as any;

const bill = (overrides: Record<string, unknown> = {}) => ({
  id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', branchId: 'branch-1', currency: 'THB',
  status: 'APPROVED', pp36Candidate: false, outstandingAmount: '100', paidAmount: '0', lines: [], ...overrides,
}) as any;

function useCase(repo: any) {
  return new CreateSupplierPaymentUseCase(
    repo, { log: async () => undefined } as any, { append: async () => undefined } as any,
    { execute: async () => assert.fail('number reservation must not run for invalid references') } as any,
    { execute: async () => undefined } as any, {} as any, { isSystemIssuanceOpen: async () => true } as any,
  );
}

function validRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSupplierPaymentByIdempotencyKey: async () => null,
    findSupplierById: async () => ({ id: 'supplier-1', companyId: 'company-1', status: 'ACTIVE' }),
    branchExists: async () => true,
    findSupplierBankAccountById: async () => ({ id: 'bank-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'ACTIVE' }),
    findVendorBillById: async () => bill(),
    // The catalog is global and ACTIVE-only; DRAFT rows read as absent.
    findActiveWhtIncomeCategory: async (code: string) => code === 'WHT_SERVICE_5' ? { code, defaultRate: '3.0000' } : null,
    ...overrides,
  } as any;
}

describe('CreateSupplierPaymentUseCase AP reference integrity', () => {
  it('returns the original payment on the same request id before re-consuming PP36 evidence', async () => {
    const existing = { id: 'payment-1', companyId: 'company-1', status: 'RECORDED', allocations: [] } as any;
    const repo = {
      findSupplierPaymentByIdempotencyKey: async (_companyId: string, key: string) => key === 'request-1' ? existing : null,
      findSupplierById: async () => assert.fail('idempotent retry must stop before source and evidence validation'),
    };
    assert.equal((await useCase(repo).execute(ctx(['branch-1']), dto())).id, 'payment-1');
  });

  it('rejects foreign suppliers and out-of-scope or foreign branches before mutation', async () => {
    await assert.rejects(() => useCase(validRepo({ findSupplierById: async () => null })).execute(ctx(['branch-1']), dto()), /Supplier does not exist/);
    await assert.rejects(() => useCase(validRepo({ findSupplierById: async () => ({ id: 'supplier-1', status: 'ON_HOLD' }) })).execute(ctx(['branch-1']), dto()), /Supplier is not active/);
    await assert.rejects(() => useCase(validRepo()).execute(ctx(['branch-2']), dto()), /outside your assigned branch scope/);
    await assert.rejects(() => useCase(validRepo({ branchExists: async () => false })).execute(ctx(['branch-1']), dto()), /Branch does not exist/);
    await assert.rejects(() => useCase(validRepo()).execute(ctx(['branch-1']), dto({ branchId: undefined })), /branch-scoped user must create the supplier payment in an assigned branch/i);
  });

  it('rejects supplier bank accounts outside the company/supplier and duplicate allocations', async () => {
    await assert.rejects(() => useCase(validRepo({ findSupplierBankAccountById: async () => null })).execute(
      ctx(['branch-1']), dto({ supplierBankAccountId: 'foreign-bank' }),
    ), /bank account is not active or does not belong/);
    await assert.rejects(() => useCase(validRepo()).execute(ctx(['branch-1']), dto({
      allocations: [{ vendorBillId: 'bill-1', amount: '50' }, { vendorBillId: 'bill-1', amount: '50' }],
    })), /Duplicate vendor bill allocations/);
  });

  it('settles sub-satang residue and rejects a real satang overpayment (spec §19d)', async () => {
    const payable = (repo: any) => new CreateSupplierPaymentUseCase(
      repo, { log: async () => undefined } as any, { append: async () => undefined } as any,
      { execute: async () => ({ id: 'reservation-1', documentNumber: 'PAY-1' }) } as any,
      { execute: async () => undefined } as any, {} as any, { isSystemIssuanceOpen: async () => true } as any,
    );
    const recorded: any[] = [];
    const settleRepo = validRepo({
      findVendorBillById: async () => bill({ outstandingAmount: '100.0042' }),
      createSupplierPayment: async (_companyId: string, data: any) => { recorded.push(data); return { id: 'payment-1', status: 'RECORDED', allocations: [] }; },
    });
    assert.equal((await payable(settleRepo).execute(ctx(['branch-1']), dto())).id, 'payment-1');
    assert.equal(recorded[0].allocations[0].amount, '100');

    const overshootRepo = validRepo({
      findVendorBillById: async () => bill({ outstandingAmount: '99.9958' }),
      createSupplierPayment: async () => ({ id: 'payment-2', status: 'RECORDED', allocations: [] }),
    });
    assert.equal((await payable(overshootRepo).execute(ctx(['branch-1']), dto())).id, 'payment-2');

    await assert.rejects(() => useCase(validRepo()).execute(ctx(['branch-1']), dto({
      grossAmount: '100.01', netPaidAmount: '100.01', allocations: [{ vendorBillId: 'bill-1', amount: '100.01' }],
    })), /exceeds outstanding amount/);
  });

  it('requires every allocation to match payment supplier, branch, and currency', async () => {
    await assert.rejects(() => useCase(validRepo({ findVendorBillById: async () => bill({ supplierId: 'supplier-2' }) })).execute(ctx(['branch-1']), dto()), /does not belong to supplier/);
    await assert.rejects(() => useCase(validRepo({ findVendorBillById: async () => bill({ branchId: 'branch-2' }) })).execute(ctx(['branch-1']), dto()), /branch does not match/);
    await assert.rejects(() => useCase(validRepo({ findVendorBillById: async () => bill({ currency: 'USD' }) })).execute(ctx(['branch-1']), dto()), /currency does not match/);
  });
});

// A supplier payment that withholds tax pays the vendor less than it settles. Every rule below
// exists so the three figures — debt cleared, cash out, tax withheld — can never disagree, because
// the ledger, the ภ.ง.ด. attachment and the 50 ทวิ are each derived from a different one of them.
describe('CreateSupplierPaymentUseCase withholding', () => {
  const recordingUseCase = (repo: any) => new CreateSupplierPaymentUseCase(
    repo, { log: async () => undefined } as any, { append: async () => undefined } as any,
    { execute: async () => ({ id: 'reservation-1', documentNumber: 'PAY-1' }) } as any,
    { execute: async () => undefined } as any, {} as any, { isSystemIssuanceOpen: async () => true } as any,
  );

  // 1,070 of debt (1,000 base + 70 VAT), 3% withheld on the base, 1,040 actually transferred.
  const withheld = (overrides: Record<string, unknown> = {}) => dto({
    grossAmount: '1070', whtAmount: '30', whtCategoryCode: 'WHT_SERVICE_5', whtRate: '3', netPaidAmount: '1040',
    allocations: [{ vendorBillId: 'bill-1', amount: '1070', whtAmount: '30' }], ...overrides,
  });
  const payableRepo = (overrides: Record<string, unknown> = {}) => {
    const recorded: any[] = [];
    const repo = validRepo({
      findVendorBillById: async () => bill({ outstandingAmount: '1070' }),
      createSupplierPayment: async (_companyId: string, data: any) => { recorded.push(data); return { id: 'payment-1', status: 'RECORDED', allocations: [] }; },
      ...overrides,
    });
    return { repo, recorded };
  };

  it('settles the full debt while paying only the net, and records the withholding decision', async () => {
    const { repo, recorded } = payableRepo();
    assert.equal((await recordingUseCase(repo).execute(ctx(['branch-1']), withheld())).id, 'payment-1');
    // The allocation clears all 1,070 even though only 1,040 left the bank — the bill must not stay
    // open by the withheld 30.
    assert.equal(recorded[0].allocations[0].amount, '1070');
    assert.equal(recorded[0].allocations[0].whtAmount, '30');
    assert.equal(recorded[0].netPaidAmount, '1040');
    assert.equal(recorded[0].whtCategoryCode, 'WHT_SERVICE_5');
    assert.equal(recorded[0].whtRate, '3');
  });

  it('still accepts a plain payment where gross equals net', async () => {
    const { repo, recorded } = payableRepo({ findVendorBillById: async () => bill() });
    assert.equal((await recordingUseCase(repo).execute(ctx(['branch-1']), dto())).id, 'payment-1');
    assert.equal(recorded[0].allocations[0].amount, '100');
  });

  it('refuses a second withholding on a bill that already withheld at accrual', async () => {
    const { repo } = payableRepo({ findVendorBillById: async () => bill({ outstandingAmount: '1070', whtAmount: '30' }) });
    await assert.rejects(
      () => recordingUseCase(repo).execute(ctx(['branch-1']), withheld()),
      (error: any) => error.response?.code === 'wht_double_withholding',
    );
  });

  it('demands the income category and a usable rate whenever tax is withheld', async () => {
    const { repo } = payableRepo();
    const run = (overrides: Record<string, unknown>) => recordingUseCase(repo).execute(ctx(['branch-1']), withheld(overrides));
    await assert.rejects(() => run({ whtCategoryCode: undefined }), /whtCategoryCode is required/);
    await assert.rejects(() => run({ whtCategoryCode: '   ' }), /whtCategoryCode is required/);
    await assert.rejects(() => run({ whtRate: undefined }), /whtRate is required/);
    // Zero would make the derived income base (withheld / rate) meaningless, over 100 is not a rate.
    await assert.rejects(() => run({ whtRate: '0' }), /percentage greater than 0 and at most 100/);
    await assert.rejects(() => run({ whtRate: '101' }), /percentage greater than 0 and at most 100/);
    // A code nobody has verified must not reach a 50 ทวิ, whether it is a typo or still DRAFT.
    await assert.rejects(
      () => run({ whtCategoryCode: 'WHT_MADE_UP' }),
      (error: any) => error.response?.code === 'wht_income_category_not_active',
    );
  });

  it('keeps the header, the allocations and the cash in agreement', async () => {
    const { repo } = payableRepo();
    const run = (overrides: Record<string, unknown>) => recordingUseCase(repo).execute(ctx(['branch-1']), withheld(overrides));
    // Allocations must add up to the debt cleared, not to the cash paid.
    await assert.rejects(() => run({ allocations: [{ vendorBillId: 'bill-1', amount: '1040', whtAmount: '30' }] }), /overpayment or unapplied payment/);
    await assert.rejects(() => run({ allocations: [{ vendorBillId: 'bill-1', amount: '1070', whtAmount: '20' }] }), /Allocation withholding must add up/);
    await assert.rejects(() => run({ netPaidAmount: '1070' }), /netPaidAmount must equal grossAmount minus whtAmount/);
    // Tax on an allocation the header never declared would leave the certificate and the ledger
    // disagreeing with the allocations.
    await assert.rejects(() => recordingUseCase(repo).execute(ctx(['branch-1']), dto({
      grossAmount: '1070', netPaidAmount: '1070',
      allocations: [{ vendorBillId: 'bill-1', amount: '1070', whtAmount: '30' }],
    })), /Allocation withholding must add up/);
  });

  it('refuses withholding an entire allocation or a negative amount', async () => {
    const { repo } = payableRepo();
    await assert.rejects(() => recordingUseCase(repo).execute(ctx(['branch-1']), withheld({
      whtAmount: '1070', netPaidAmount: '0', allocations: [{ vendorBillId: 'bill-1', amount: '1070', whtAmount: '1070' }],
    })), /cannot withhold its entire amount/);
    await assert.rejects(() => recordingUseCase(repo).execute(ctx(['branch-1']), withheld({
      whtAmount: '-30', netPaidAmount: '1100',
    })), /whtAmount cannot be negative/);
  });
});
