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
