// Vendor address spec §6/§8, CON-8 and CON-11: what the review save does with the printed seller
// address and branch code. The rules that matter here are the ones a user would feel — a blank
// branch code stored as `'00000'`, a refused save with no way forward, or an address that survives
// on an expense nobody may edit any more.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const audit = { log: async () => undefined } as any;
const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'mem-1', roles: [], permissions: ['expense.review', 'expense.update'],
  scopes: {}, authProvider: 'watchdog',
};

function makeUseCase(status = 'NEEDS_REVIEW') {
  const updates: any[] = [];
  const repo = {
    findById: async () => ({
      id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status,
      sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
      currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'),
      vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด', vendorAddressSnapshot: null, vendorBranchCodeSnapshot: null,
      aiVerificationSummaryJson: null,
    }),
    findByIdWithRelations: async () => ({ lines: [] }),
    updateExpense: async (input: any) => { updates.push(input); return input; },
    listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
    upsertLines: async () => undefined,
  } as any;
  return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), updates };
}

const ADDRESS = '123/4 หมู่ 5 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';

describe('review save of the printed vendor address', () => {
  it('stores the typed address and branch code on the expense', async () => {
    const { useCase, updates } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS, vendorBranchCodeSnapshot: '00001' } as any);

    assert.equal(updates[0].vendorAddressSnapshot, ADDRESS);
    assert.equal(updates[0].vendorBranchCodeSnapshot, '00001');
  });

  it('clears both to null when the reviewer empties the fields (CON-8)', async () => {
    const { useCase, updates } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: '  ', vendorBranchCodeSnapshot: '' } as any);

    assert.equal(updates[0].vendorAddressSnapshot, null);
    assert.equal(updates[0].vendorBranchCodeSnapshot, null,
      'an empty branch field is not head office — `00000` is a value someone types');
  });

  it('refuses a four-digit branch code before anything is written (CON-8)', async () => {
    const { useCase, updates } = makeUseCase();

    await assert.rejects(
      () => useCase.execute(ctx, 'exp-1', { vendorBranchCodeSnapshot: '0001' } as any),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as { code: string }).code, 'EXPENSE_VENDOR_BRANCH_CODE_INVALID');
        return true;
      },
    );
    assert.deepEqual(updates, [], 'a refused branch code must not half-save the rest of the form');
  });

  it('refuses an address past the column limit rather than truncating it (§8)', async () => {
    const { useCase } = makeUseCase();

    await assert.rejects(
      () => useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: 'ก'.repeat(501) } as any),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as { code: string }).code, 'EXPENSE_VENDOR_ADDRESS_TOO_LONG');
        return true;
      },
    );
  });

  /**
   * CON-11: the address is locked by the SAME rule as every other vendor field — the status gate
   * here, and the repository's material-field funding lock for a claimed expense. No exception of
   * its own, so there is no status in which the address is editable and the vendor name is not.
   */
  it('cannot be edited once the expense leaves the editable statuses (CON-11)', async () => {
    for (const status of ['CONFIRMED', 'VOIDED', 'REJECTED']) {
      const { useCase, updates } = makeUseCase(status);
      await assert.rejects(
        () => useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any),
        (error: unknown) => error instanceof BadRequestException,
      );
      assert.deepEqual(updates, []);
    }
    for (const status of ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']) {
      const { useCase, updates } = makeUseCase(status);
      await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);
      assert.equal(updates[0].vendorAddressSnapshot, ADDRESS);
    }
  });

  /**
   * §8, AC04: a full tax invoice with no address is a review hint, never a gate. The save must not
   * touch the two columns that decide whether the document can be used for tax — a silent
   * NEEDS_REVIEW here would block auto-post, substitute preparation and the VAT_INPUT tax event.
   */
  it('changes no tax-evidence or claim state because an address is missing', async () => {
    const { useCase, updates } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: '' } as any);

    assert.equal('taxEvidenceStatus' in updates[0], false);
    assert.equal('inputVatClaimStatus' in updates[0], false);
    assert.equal('sourceDocumentType' in updates[0], false);
  });
});

/**
 * Slice 2 (§5 row 2, §8): every review or draft save re-checks the printed buyer block against the
 * company registry and the expense branch as they are NOW — and keeps a confirmed override only while
 * it still describes the same mismatch of the same printed values.
 */
describe('review save re-checks the printed buyer block', () => {
  const REGISTRY = {
    taxId: '0994000163011', registeredName: 'บริษัท มั่งมีพลัส จำกัด', displayName: 'มั่งมีพลัส', brandName: null,
    addressJson: { line1: '55/3 ซอยลาดพร้าว 15', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' },
  };
  const PRINTED = { name: 'บริษัท มั่งมีพลัส จำกัด', taxId: '0994000163011', branchCode: '00001' };
  const CONFIRMED = {
    ...PRINTED, matchStatus: 'MISMATCH', reasons: ['BRANCH'],
    differences: [{ reason: 'BRANCH', printed: '00001', registered: '00000' }], checkedAt: '2026-09-20T00:00:00.000Z',
    overrideReason: 'ผู้ขายออกใบในนามสาขา 1 ตามสัญญาเช่า', overriddenByUserId: 'user-9', overriddenAt: '2026-09-20T01:00:00.000Z',
  };

  function makeBuyerUseCase(record: Record<string, unknown>, branchTaxCodes: Record<string, string | null> = {}) {
    const updates: any[] = [];
    const registryReads: Array<string | null> = [];
    const repo = {
      findById: async () => ({
        id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED', inputVatClaimStatus: 'CLAIMABLE',
        currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'), vendorNameSnapshot: 'ร้านวัสดุ',
        aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null, buyerAsPrintedJson: null, ...record,
      }),
      findByIdWithRelations: async () => ({ lines: [] }),
      updateExpense: async (input: any) => { updates.push(input); return input; },
      listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
      upsertLines: async () => undefined,
      getSubstituteCompanyContext: async (_companyId: string, branchId: string | null) => {
        registryReads.push(branchId);
        return { ...REGISTRY, branchTaxCode: branchId ? branchTaxCodes[branchId] ?? null : null };
      },
    } as any;
    return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), updates, registryReads };
  }

  it('checks a draft read before the column existed from its aiVerifiedFieldsJson (no backfill script)', async () => {
    const { useCase, updates, registryReads } = makeBuyerUseCase({ aiVerifiedFieldsJson: { buyerAsPrinted: PRINTED } });

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.deepEqual(registryReads, [null]);
    assert.equal(updates[0].buyerAsPrintedJson.matchStatus, 'MISMATCH');
    assert.deepEqual(updates[0].buyerAsPrintedJson.reasons, ['BRANCH']);
    assert.equal(updates[0].buyerAsPrintedJson.branchCode, '00001');
    assert.equal('taxEvidenceStatus' in updates[0], false, 'E11: a mismatch never moves tax evidence');
    assert.equal('inputVatClaimStatus' in updates[0], false, 'E11: a mismatch never moves claimability');
  });

  it('re-checks against the branch this save moves the expense to', async () => {
    const { useCase, updates, registryReads } = makeBuyerUseCase({ buyerAsPrintedJson: CONFIRMED }, { 'branch-1': '00001' });

    await useCase.execute(ctx, 'exp-1', { branchId: 'branch-1' } as any);

    assert.deepEqual(registryReads, ['branch-1']);
    assert.equal(updates[0].buyerAsPrintedJson.matchStatus, 'MATCH');
    assert.equal(updates[0].buyerAsPrintedJson.overrideReason, undefined, 'a match has nothing left to confirm');
  });

  it('keeps the override while the same mismatch of the same printed values stands', async () => {
    const { useCase, updates } = makeBuyerUseCase({ buyerAsPrintedJson: CONFIRMED });

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    const stored = updates[0].buyerAsPrintedJson;
    assert.equal(stored.overrideReason, CONFIRMED.overrideReason);
    assert.equal(stored.overriddenByUserId, 'user-9');
    assert.notEqual(stored.checkedAt, CONFIRMED.checkedAt, 're-checked, with a new timestamp');
  });

  it('drops the override when the registry now gives another reason', async () => {
    const { useCase, updates } = makeBuyerUseCase({ buyerAsPrintedJson: { ...CONFIRMED, taxId: '0105512345678' } });

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.deepEqual(updates[0].buyerAsPrintedJson.reasons, ['TAX_ID']);
    assert.equal(updates[0].buyerAsPrintedJson.overrideReason, undefined);
  });

  it('writes nothing and reads no registry for an expense that never had a buyer block', async () => {
    const { useCase, updates, registryReads } = makeBuyerUseCase({ aiVerifiedFieldsJson: { grandTotalAmount: '10' } });

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.deepEqual(registryReads, []);
    assert.equal('buyerAsPrintedJson' in updates[0], false);
  });
});

/**
 * Controller review of d0cceba7, fix 1: what "ทำเครื่องหมายใบนี้ใช้ภาษีซื้อไม่ได้" did to an expense whose
 * lines carry a Tax Code. The review-fields save writes the HEADER claim status and nothing else — it
 * never resolves or rewrites a line, so the line's claimable Tax Code survives the mark untouched. The
 * tax half (sync-tax-events-components spec) shows ภ.พ.30 is built from exactly that line.
 */
describe('the header mark on an expense whose lines carry a Tax Code', () => {
  it('writes only the header claim status and leaves the line Tax Code alone', async () => {
    const updates: any[] = [];
    let resolveCalls = 0;
    let upsertCalls = 0;
    const repo = {
      findById: async () => ({
        id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_EXCLUDED', inputVatClaimStatus: 'CLAIMABLE',
        currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'), vendorNameSnapshot: 'ร้านวัสดุ',
        aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null, buyerAsPrintedJson: null,
        lines: [{ id: 'line-1', taxCodeDefinitionId: 'def-v7', externalTaxCode: 'V7', claimability: 'CLAIMABLE' }],
      }),
      findByIdWithRelations: async () => ({ lines: [] }),
      updateExpense: async (input: any) => { updates.push(input); return input; },
      listLineChargeKinds: async () => new Map(),
      upsertLines: async () => { upsertCalls += 1; },
    } as any;
    const tax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => { resolveCalls += 1; return lines; } } as any;

    await new UpdateExpenseDraftUseCase(repo, audit, tax).execute(ctx, 'exp-1',
      { expectedUpdatedAt: '2026-09-04T00:00:00.000Z', inputVatClaimStatus: 'NON_CLAIMABLE' } as any);

    assert.equal(updates[0].inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal(resolveCalls, 0, 'no line is re-resolved: the V7 snapshot stays CLAIMABLE');
    assert.equal(upsertCalls, 0, 'no line is rewritten');
    assert.equal('lines' in updates[0], false);
  });
});

/**
 * Review fix 2: one misclick on "ทำเครื่องหมายใบนี้ใช้ภาษีซื้อไม่ได้" must not strand an invoice's input
 * VAT. The mark stamps the status it replaced in the same write; the undo sends that value back through
 * the same review save, which restores it and drops the stamp.
 */
describe('buyer mark → undo restores the original claim status', () => {
  const REGISTRY = {
    taxId: '0994000163011', registeredName: 'บริษัท มั่งมีพลัส จำกัด', displayName: 'มั่งมีพลัส', brandName: null, addressJson: null,
    branchTaxCode: null, branchAddressJson: null,
  };
  const MISMATCH = {
    taxId: '0105512345678', matchStatus: 'MISMATCH', reasons: ['TAX_ID'],
    differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: '0994000163011' }], checkedAt: '2026-09-20T00:00:00.000Z',
  };

  function statefulUseCase(initial: Record<string, unknown>) {
    const row: Record<string, any> = {
      id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_EXCLUDED',
      currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'), vendorNameSnapshot: 'ร้านวัสดุ',
      aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null, buyerAsPrintedJson: MISMATCH, ...initial,
    };
    const repo = {
      findById: async () => ({ ...row }),
      findByIdWithRelations: async () => ({ lines: [] }),
      updateExpense: async (input: any) => { Object.assign(row, input); return { ...row }; },
      listLineChargeKinds: async () => new Map(),
      upsertLines: async () => undefined,
      getSubstituteCompanyContext: async () => REGISTRY,
    } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, transactionTax);
    const save = (input: Record<string, unknown>) => useCase.execute(ctx, 'exp-1', { expectedUpdatedAt: '2026-09-04T00:00:00.000Z', ...input } as any);
    return { row, save };
  }

  for (const original of ['CLAIMABLE', 'NEEDS_REVIEW'] as const) {
    it(`restores ${original} after mark, an unrelated save, and undo`, async () => {
      const { row, save } = statefulUseCase({ inputVatClaimStatus: original });

      await save({ inputVatClaimStatus: 'NON_CLAIMABLE' });
      assert.equal(row.inputVatClaimStatus, 'NON_CLAIMABLE');
      assert.equal(row.buyerAsPrintedJson.claimStatusBeforeMark, original, 'stamped in the same write as the mark');

      await save({ vendorAddressSnapshot: ADDRESS });
      assert.equal(row.buyerAsPrintedJson.claimStatusBeforeMark, original, 'an ordinary save re-checks without losing the way back');

      await save({ inputVatClaimStatus: row.buyerAsPrintedJson.claimStatusBeforeMark });
      assert.equal(row.inputVatClaimStatus, original);
      assert.equal(row.buyerAsPrintedJson.claimStatusBeforeMark, undefined, 'nothing left to take back');
      assert.equal(row.buyerAsPrintedJson.matchStatus, 'MISMATCH', 'the warning itself is untouched');
    });
  }

  it('does not stamp a NON_CLAIMABLE the document type forces', async () => {
    const { row, save } = statefulUseCase({ inputVatClaimStatus: 'CLAIMABLE' });

    await save({ sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE' });

    assert.equal(row.inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal(row.buyerAsPrintedJson.claimStatusBeforeMark, undefined);
  });
});
