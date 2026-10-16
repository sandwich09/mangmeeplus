/**
 * The seam between a review save and the counterparty registry (spec §7, §8, GAP-4, CON-7).
 * `ensure-vendor-counterparty-from-expense.use-case.spec.ts` covers what the registry decides; this
 * covers what the expense write does with the answer, and the two ways that could go wrong in a way
 * a user would feel: the save failing because the registry did (§8/AC06), and a counterparty row
 * surviving a transaction the caller rolled back.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const audit = { log: async () => undefined } as any;
const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'mem-1', roles: [], permissions: ['expense.review', 'expense.update'],
  scopes: {}, authProvider: 'watchdog',
};

const ADDRESS = '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';

function makeUseCase(options: {
  autoSave?: (input: any) => Promise<any>;
  record?: Record<string, unknown>;
  receiptUploaderUserId?: string | null;
} = {}) {
  const updates: any[] = [];
  const seen: any[] = [];
  const repo = {
    findById: async () => ({
      id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
      currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'),
      captureSource: 'WEB_MANUAL', sourceReimbursementRequestId: null, vendorCounterpartyId: null,
      vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด', vendorTaxIdSnapshot: '0105558123456',
      vendorAddressSnapshot: null, vendorBranchCodeSnapshot: null, vendorEntityKindSnapshot: null,
      aiVerificationSummaryJson: null,
      ...options.record,
    }),
    findPrimaryReceiptUploader: async () => options.receiptUploaderUserId ?? null,
    findByIdWithRelations: async () => ({ lines: [] }),
    updateExpense: async (input: any) => { updates.push(input); return { ...input }; },
    listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
    upsertLines: async () => undefined,
  } as any;
  const ensure = {
    execute: async (_ctx: unknown, input: any) => {
      seen.push(input);
      return options.autoSave
        ? options.autoSave(input)
        : { result: { case: 'CREATE', counterpartyId: 'cp-new', displayName: 'บริษัท ตัวอย่าง จำกัด' }, linkCounterpartyId: 'cp-new' };
    },
  } as any;
  return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax, ensure), updates, seen };
}

describe('a review save and the vendor registry', () => {
  it('GAP-4: writes the counterparty link in the same statement as the rest of the save', async () => {
    const { useCase, updates } = makeUseCase();

    const saved = await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.equal(updates.length, 1, 'no second round trip for the link');
    assert.equal(updates[0].vendorCounterpartyId, 'cp-new');
    assert.equal(saved.vendorCounterpartyAutoSave?.case, 'CREATE');
    assert.equal(saved.vendorCounterpartyAutoSave?.displayName, 'บริษัท ตัวอย่าง จำกัด');
  });

  it('matches on the values this save is about to store, not the ones already on the row', async () => {
    const { useCase, seen } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', { vendorNameSnapshot: 'ร้านชื่อใหม่', vendorAddressSnapshot: ADDRESS, vendorBranchCodeSnapshot: '00001' } as any);

    assert.equal(seen[0].vendorName, 'ร้านชื่อใหม่');
    assert.equal(seen[0].vendorAddressText, ADDRESS);
    assert.equal(seen[0].vendorBranchCode, '00001');
  });

  it('uses the primary receipt file uploader, not the expense creator, for scoped access', async () => {
    const { useCase, seen } = makeUseCase({
      record: { createdByUserId: 'expense-creator', primaryAttachmentId: 'receipt-1' },
      receiptUploaderUserId: 'receipt-uploader',
    });

    await useCase.execute(ctx, 'exp-1', { vendorNameSnapshot: 'ร้านทดสอบ' } as any);

    assert.equal(seen[0].receiptUploaderUserId, 'receipt-uploader');
  });

  it('CON-7: fills the empty taxpayer class from the registry, which is what unblocks a WHT confirm', async () => {
    const { useCase, updates } = makeUseCase({
      autoSave: async () => ({ result: { case: 'NOOP', counterpartyId: 'cp-1' }, fillEntityKind: 'JURISTIC' }),
    });

    await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.equal(updates[0].vendorEntityKindSnapshot, 'JURISTIC');
  });

  it("CON-7: never overrides the reviewer's own choice with the registry's", async () => {
    const { useCase, updates } = makeUseCase({
      autoSave: async () => ({ result: { case: 'NOOP', counterpartyId: 'cp-1' }, fillEntityKind: 'JURISTIC' }),
    });

    await useCase.execute(ctx, 'exp-1', { vendorEntityKindSnapshot: 'INDIVIDUAL' } as any);

    assert.equal(updates[0].vendorEntityKindSnapshot, 'INDIVIDUAL');
  });

  it('§8/AC06: a failed registry write still saves the expense, and says so', async () => {
    const { useCase, updates } = makeUseCase({
      autoSave: async () => ({ result: { case: 'FAILED', failed: true } }),
    });

    const saved = await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.equal(updates.length, 1, 'the expense saved');
    assert.equal(updates[0].vendorAddressSnapshot, ADDRESS);
    assert.equal(updates[0].vendorCounterpartyId, undefined);
    assert.equal(saved.vendorCounterpartyAutoSave?.failed, true,
      'the bar "ยังไม่ได้บันทึกลงทะเบียนคู่ค้า ลองใหม่ได้จากหน้าคู่ค้า" has to have something to key off');
  });

  it('says nothing at all when the registry was skipped (CON-4 and nameless vendors)', async () => {
    const { useCase } = makeUseCase({ autoSave: async () => ({ result: { case: 'SKIPPED' } }) });

    const saved = await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.equal(saved.vendorCounterpartyAutoSave, undefined, 'a skip is not a toast');
  });

  it('passes the two CON-4 markers through so the registry can skip a reimbursement projection', async () => {
    const { useCase, seen } = makeUseCase({
      record: { captureSource: 'API_INTERNAL', sourceReimbursementRequestId: 'rr-1', vendorNameSnapshot: 'เบิกคืนพนักงาน: สมชาย ใจดี' },
      autoSave: async () => ({ result: { case: 'SKIPPED' } }),
    });

    await useCase.execute(ctx, 'exp-1', { note: 'edited' } as any);

    assert.equal(seen[0].captureSource, 'API_INTERNAL');
    assert.equal(seen[0].sourceReimbursementRequestId, 'rr-1');
  });

  /**
   * `line-draft-update.use-case.ts` runs this whole method inside a transaction it then ROLLS BACK
   * to price a preview. The registry write goes to its own connection, so it would outlive that
   * rollback — a shop in the master that the user never saved.
   */
  it('sits out entirely when the caller owns the transaction', async () => {
    const { useCase, seen, updates } = makeUseCase();

    const saved = await useCase.execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any, { db: {} as any });

    assert.deepEqual(seen, [], 'nothing was written that a rollback could not take back');
    assert.equal(updates[0].vendorCounterpartyId, undefined);
    assert.equal(saved.vendorCounterpartyAutoSave, undefined);
  });

  it('still works when the registry is not wired at all', async () => {
    const updates: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
        currency: 'THB', expenseDate: new Date('2026-09-04T00:00:00.000Z'),
        captureSource: 'WEB_MANUAL', sourceReimbursementRequestId: null, vendorCounterpartyId: null,
        vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด', aiVerificationSummaryJson: null,
      }),
      findByIdWithRelations: async () => ({ lines: [] }),
      updateExpense: async (input: any) => { updates.push(input); return { ...input }; },
      listLineChargeKinds: async () => new Map(),
      upsertLines: async () => undefined,
    } as any;

    await new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(ctx, 'exp-1', { vendorAddressSnapshot: ADDRESS } as any);

    assert.equal(updates[0].vendorAddressSnapshot, ADDRESS);
  });
});

it('U1 draft saves suppress merged slips by stored type, requested type or OCR classification', async () => {
  for (const variant of ['stored', 'requested', 'ocr']) {
    const h = makeUseCase({ record: { vendorNameSnapshot: 'TEST FOODS CO',
      sourceDocumentType: variant === 'stored' ? 'TRANSFER_SLIP' : 'RECEIPT',
      ...(variant === 'ocr' ? { aiVerificationSummaryJson: { classification: { documentKind: 'TRANSFER_SLIP' } } } : {}) } });
    await h.useCase.execute(ctx, 'exp-1', variant === 'requested' ? { sourceDocumentType: 'TRANSFER_SLIP' } : { vendorNameSnapshot: 'TEST FOODS CO' });
    assert.equal(h.updates.length, 1, variant);
    assert.deepEqual(h.seen, [], variant);
    assert.equal(h.updates[0].vendorCounterpartyId, undefined, variant);
  }
});
