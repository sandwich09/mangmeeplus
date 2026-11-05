import { sourceDraftState, projectExpenseSourceDraft, applyExpenseSourceDraftInput, assertExpenseSourceDraftComplete } from '../../domain/logic/expense-source-draft.logic';
import { buildInitialLineExpenseDraftContinuation, parseLineExpenseDraftContinuation } from '../../domain/logic/line-expense-draft-conversation.logic';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeVatFields, isStaleOcrApply, ocrLineVatRateUnknown, ocrVatSource, ocrWhtInput, RECEIPT_REVIEW_REASONS, receiptFallbackLineTotal, ReceiptOcrApplyService, reviewReceiptDate, usableItemLines, verifyDiscountAmount } from './receipt-ocr-apply.service';
import { calcLineTotals, expenseTotalsIdentity, expenseTotalsIdentityError } from '../../domain/logic/expense-totals.logic';
import { acceptExpenseVatSource } from '../../domain/logic/expense-vat-reconciliation.logic';

function makeDuplicateRepo(overrides: Record<string, unknown> = {}) {
  return {
    runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>, db: any) => {
      assert.ok(db, 'OCR duplicate detection joins the existing transaction');
      const matched = await detectWithinTx(db);
      return {
        openCandidates: matched.length,
        duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH',
      };
    },
    findByIdWithRelations: async () => ({
      id: 'expense-1',
      primaryAttachmentId: null,
      attachments: [],
      vendorDocumentNumber: null,
      vendorTaxIdSnapshot: null,
      expenseDate: new Date('2026-07-29T00:00:00.000Z'),
      grandTotalAmount: '0',
      vendorCounterpartyId: null,
    }),
    findNearDuplicates: async () => [],
    findExpenseIdsByAttachmentChecksum: async () => [],
    createDuplicateCandidate: async () => undefined,
    updateExpense: async (input: any) => input,
    ...overrides,
  };
}

// Slice 2: the company registry the printed buyer block is compared with.
const BUYER_REGISTRY = {
  taxId: '0994000163011', registeredName: 'บริษัท มั่งมีพลัส จำกัด', displayName: 'มั่งมีพลัส', brandName: null,
  addressJson: { line1: '55/3 ซอยลาดพร้าว 15', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' },
  branchTaxCode: null,
};

// Arithmetic fixtures have no concurrent writer; the source-boundary case below supplies exact revisions.
function makeApplyPrisma(tx: any) {
  return { client: { $transaction: async (fn: any) => fn({
    $executeRaw: async () => 0,
    ...tx,
    companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: { findFirstOrThrow: async () => ({ updatedAt: new Date('2026-09-15T00:00:00.001Z') }), ...tx.expenseRecord },
  }) } };
}

// Spec §19c: a BENLAI card slip prints TAX RATE 7% / TAX AMT 37.94 / TAX Exclude 542.06 / paid 580.00.
// The draft must record the amount actually paid, with the document's own VAT arithmetic.
describe('completeVatFields (spec §19c decision 4)', () => {
  it('resolves the printed rate and VAT_EXCLUDED from a complete BENLAI tax block', () => {
    const out = completeVatFields({ taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00' });
    assert.equal(out.vatRate, '0.0700');
    assert.equal(out.vatMode, 'VAT_EXCLUDED');
    assert.equal(out.subtotalAmount, '542.06');
    assert.equal(out.grandTotalAmount, '580.00');
  });

  it('completes the missing VAT amount from base and total', () => {
    const out = completeVatFields({ taxableAmount: '542.06', grandTotalAmount: '580.00' });
    assert.equal(out.vatAmount, '37.94');
    assert.equal(out.vatRate, '0.0700');
    assert.equal(out.vatMode, 'VAT_EXCLUDED');
  });

  it('completes the missing taxable base from VAT and total', () => {
    const out = completeVatFields({ vatAmount: '37.94', grandTotalAmount: '580.00' });
    assert.equal(out.taxableAmount, '542.06');
    assert.equal(out.subtotalAmount, '542.06');
    assert.equal(out.vatRate, '0.0700');
  });

  it('completes the missing grand total from base and VAT', () => {
    const out = completeVatFields({ taxableAmount: '542.06', vatAmount: '37.94' });
    assert.equal(out.grandTotalAmount, '580.00');
    assert.equal(out.vatMode, 'VAT_EXCLUDED');
  });

  it('keeps a consistent extracted rate but lets the printed arithmetic win over a contradicting one', () => {
    const consistent = completeVatFields({ vatRate: '0.07', taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00' });
    assert.equal(consistent.vatRate, '0.0700');

    const contradicted = completeVatFields({ vatRate: '0.07', taxableAmount: '500.00', vatAmount: '100.00', grandTotalAmount: '600.00' });
    assert.equal(contradicted.vatRate, '0.2000');
  });

  it('invents nothing for a no-VAT cash bill', () => {
    const fields = { grandTotalAmount: '120' };
    assert.deepEqual(completeVatFields(fields), fields);
  });

  it('overrides only NO_VAT/missing modes when the VAT arithmetic is proven', () => {
    const forced = completeVatFields({ vatMode: 'NO_VAT', taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00' });
    assert.equal(forced.vatMode, 'VAT_EXCLUDED');

    const explicit = completeVatFields({ vatMode: 'VAT_INCLUDED', taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00' });
    assert.equal(explicit.vatMode, 'VAT_INCLUDED');
  });

  it('completes nothing for an inconsistent triple – existing mismatch warnings decide', () => {
    const fields = { taxableAmount: '500.00', vatAmount: '37.94', grandTotalAmount: '580.00', vatMode: 'NO_VAT' as const };
    assert.deepEqual(completeVatFields(fields), fields);
  });

  it('refuses completion when the implied rate is insane', () => {
    const out = completeVatFields({ taxableAmount: '100.00', grandTotalAmount: '150.00' });
    assert.equal(out.vatAmount, undefined);
    assert.equal(out.vatRate, undefined);
    assert.equal(out.vatMode, undefined);
    // an unproven base must not become the subtotal: the line unit price is derived from it
    assert.equal(out.subtotalAmount, undefined);
  });

  it('refuses to invent a total from an insanely rated base/VAT pair', () => {
    const fields = { taxableAmount: '100.00', vatAmount: '90.00' };
    assert.deepEqual(completeVatFields(fields), fields);
  });

  it('never mutates the caller input (aiVerifiedFieldsJson provenance)', () => {
    const fields = { taxableAmount: '542.06', grandTotalAmount: '580.00' };
    completeVatFields(fields);
    assert.deepEqual(fields, { taxableAmount: '542.06', grandTotalAmount: '580.00' });
  });
});

// Spec §19g decision 1. The reported Starbucks slip: `11.78 VAT TTL / 168.22 Net TTL / paid 180.00`
// is an ordinary 7% VAT-included document (180 × 7/107 = 11.78). Only the model's failure to read
// the printed VAT is unusual, and that failure must stay visible rather than becoming a zero rate.
describe('ocrLineVatRateUnknown (spec §19g decision 1)', () => {
  it('reports unknown when a VAT mode carries no rate and no VAT amount to derive one from', () => {
    assert.equal(ocrLineVatRateUnknown({ vatMode: 'VAT_INCLUDED', grandTotalAmount: '180.00' }), true);
    assert.equal(ocrLineVatRateUnknown({ vatMode: 'VAT_EXCLUDED', grandTotalAmount: '180.00' }), true);
  });

  it('is not unknown once the document proves or prints a rate', () => {
    assert.equal(ocrLineVatRateUnknown({
      vatMode: 'VAT_INCLUDED', taxableAmount: '168.22', vatAmount: '11.78', grandTotalAmount: '180.00',
    }), false);
    assert.equal(ocrLineVatRateUnknown({ vatMode: 'VAT_EXCLUDED', vatRate: '0', grandTotalAmount: '180.00' }), false);
  });

  it('is not unknown for modes that do not assert VAT', () => {
    assert.equal(ocrLineVatRateUnknown({ vatMode: 'NO_VAT', grandTotalAmount: '180.00' }), false);
    assert.equal(ocrLineVatRateUnknown({ vatMode: 'EXEMPT', grandTotalAmount: '180.00' }), false);
  });
});

// Spec §19i. The same Starbucks slip prints `1 V.SIGNATURE CH 175.00 / * SKUPSIZE1 -15.00 /
// >1 1 SHOT 20.00 / Sub Total 195.00 / Total Discount -15.00 / Total Amount 180.00`. The model
// reported the ฿20.00 extra shot — a positive add-on item — as the discount, and the apply path
// folded it into a ฿200.00 unit price the slip prints nowhere.
describe('verifyDiscountAmount (spec §19i decision 2)', () => {
  it('drops a discount no printed subtotal can prove', () => {
    const out = verifyDiscountAmount({ vatMode: 'VAT_INCLUDED', discountAmount: '20.00', grandTotalAmount: '180.00' });
    assert.equal(out.discountAmount, undefined);
    assert.equal(out.grandTotalAmount, '180.00');
  });

  it('corrects a discount the printed subtotal and total contradict', () => {
    const out = verifyDiscountAmount({
      vatMode: 'VAT_INCLUDED', subtotalAmount: '195.00', discountAmount: '20.00', grandTotalAmount: '180.00',
    });
    assert.equal(out.discountAmount, '15.00');
  });

  it('keeps a discount the printed figures prove, including across additional charges', () => {
    const plain = { vatMode: 'VAT_INCLUDED' as const, subtotalAmount: '195.00', discountAmount: '15.00', grandTotalAmount: '180.00' };
    assert.deepEqual(verifyDiscountAmount(plain), plain);

    const withCharge = {
      vatMode: 'VAT_INCLUDED' as const,
      subtotalAmount: '195.00',
      discountAmount: '15.00',
      grandTotalAmount: '190.00',
      additionalCharges: [{ kind: 'SERVICE_CHARGE' as const, description: 'Service charge', amount: '10.00', evidenceSignal: 'Service charge 10.00' }],
    };
    assert.deepEqual(verifyDiscountAmount(withCharge), withCharge);
  });

  it('proves a VAT_EXCLUDED discount against the ex-VAT base, not the gross', () => {
    const printedBase = verifyDiscountAmount({
      vatMode: 'VAT_EXCLUDED', subtotalAmount: '600.00', discountAmount: '57.94',
      taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00',
    });
    assert.equal(printedBase.discountAmount, '57.94');

    const derivedBase = verifyDiscountAmount({
      vatMode: 'VAT_EXCLUDED', subtotalAmount: '600.00', discountAmount: '57.94',
      vatAmount: '37.94', grandTotalAmount: '580.00',
    });
    assert.equal(derivedBase.discountAmount, '57.94');
  });

  it('stores a discount the document prints negative as a magnitude', () => {
    const out = verifyDiscountAmount({
      vatMode: 'VAT_INCLUDED', subtotalAmount: '195.00', discountAmount: '-15.00', grandTotalAmount: '180.00',
    });
    assert.equal(out.discountAmount, '15.00');
  });

  it('leaves a document that prints no discount untouched', () => {
    const fields = { vatMode: 'VAT_INCLUDED' as const, subtotalAmount: '195.00', grandTotalAmount: '180.00' };
    assert.deepEqual(verifyDiscountAmount(fields), fields);
  });
});

describe('ocrVatSource', () => {
  it('keeps rate and amount independent and does not turn missing text into zero', () => {
    assert.deepEqual(ocrVatSource({}), { inputType: 'NONE' });
    assert.deepEqual(ocrVatSource({ vatAmount: '27.08' }), { inputType: 'AMOUNT', vatAmount: '27.08' });
    assert.deepEqual(ocrVatSource({ vatRate: '0.07' }), { inputType: 'RATE', vatRatePercent: '7.0000' });
    assert.deepEqual(ocrVatSource({ vatRate: '0.07', vatAmount: '27.08' }), {
      inputType: 'BOTH', vatRatePercent: '7.0000', vatAmount: '27.08',
    });
    assert.deepEqual(ocrVatSource({ vatRate: '0', vatAmount: '0' }), {
      inputType: 'BOTH', vatRatePercent: '0.0000', vatAmount: '0.00',
    });
  });
});

async function applyFields(fields: any, vatCaptureSnapshotJson: any = null, existing: Record<string, unknown> = {}, todayIso?: string,
  repoOverrides: Record<string, unknown> = {}, ensureVendorCounterparty?: { execute: (ctx: unknown, input: any) => Promise<any>; resolveOcrVendorName?: (ctx: any, taxId: string) => Promise<string | undefined> }, sourceDocumentType?: any, sourceAttachmentId?: string, ocrDocumentType?: any, sourceOnly = false) {
  const updates: any[] = [];
  const lines: any[] = [];
  const tx = {
    companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
      findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null, vatCaptureSnapshotJson,
        ...(sourceOnly ? { id: 'expense-1', companyId: 'company-1', createdByUserId: 'user-1', status: 'DRAFT', branchId: null } : {}), ...existing }),
      update: async (args: any) => { updates.push(args); },
    },
    expenseCategory: { findFirst: async () => null },
    expenseLine: { deleteMany: async () => undefined, create: async (args: any) => { lines.push(args.data); } },
  };
  if (sourceOnly) Object.assign(tx, {
    $queryRaw: async () => [],
    company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0) } }) },
    billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
    billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null },
    salesAttribution: { findUnique: async () => null },
    companyMembership: { findFirst: async () => ({ branchScopeMode: 'ALL_BRANCHES', branchScopes: [],
      roles: [{ role: { permissions: [{ permission: { key: 'expense.receipt.upload' } }] } }] }) },
    companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'expenses', enabled: true }] },
  });
  const prisma = makeApplyPrisma(tx);
  const result = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo(repoOverrides) as any, ensureVendorCounterparty as any)
    .apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields, { ...(sourceOnly ? { sourceOnly: true } : {}), ...(todayIso ? { todayIso } : {}), ...(sourceDocumentType ? { sourceDocumentType } : {}), ...(sourceAttachmentId ? { sourceAttachmentId } : {}), ...(ocrDocumentType ? { ocrDocumentType } : {}) });
  return { record: updates[0]?.data, line: lines[0], lines, result };
}

describe('ReceiptOcrApplyService.apply — receipt uploader scope', () => {
  it('D2: the existing fenced apply persists all 70 assembled PDF rows and exact VAT/total', async () => {
    const result = await applyFields({ vendorName: 'First printed issuer', grandTotalAmount: '7490.00', vatAmount: '490.00',
      vatMode: 'VAT_EXCLUDED', vatRate: '0.07', lines: Array.from({ length: 70 }, (_, row) => ({
        description: `item ${row + 1}`, quantity: '1', unitPrice: '100.00', amount: '100.00', evidenceSignal: `item ${row + 1} 100.00` })) });
    assert.equal(result.lines.length, 70);
    assert.equal(result.record.grandTotalAmount, '7490.0000');
    assert.equal(result.record.vatAmount, '490.0000');
    assert.equal(result.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
  });
  it('OCR-C corrects small Thai OCR names from the unique tax-ID match, retaining raw evidence and reviewer identity', async () => {
    const registered = 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด';
    for (const name of ['บริษัท ออฟฟิศชัพพลายจำลอง จำกัด', 'บริษัท ออฟฟิศซัพพลายพลายจำลอง จำกัด']) {
      for (const matched of [true, false]) {
        const seen: any[] = [];
        const fields = { vendorName: name, vendorTaxId: '0105473325385', grandTotalAmount: '599586.00' };
        const ensure = {
          resolveOcrVendorName: async (context: any, taxId: string) => { seen.push([context.companyId, taxId]); return matched ? registered : undefined; },
          execute: async (_context: any, input: any) => { assert.equal(input.vendorName, matched ? registered : name); return { result: { case: 'NOOP' } }; },
        };
        const result = await applyFields(fields, null, {}, undefined, {}, ensure);
        assert.equal(result.record.vendorNameSnapshot, matched ? registered : name);
        assert.equal(result.record.aiVerifiedFieldsJson.vendorName, name);
        assert.equal(fields.vendorName, name);
        assert.deepEqual(seen, [['company-1', '0105473325385']]);
      }
    }
    const ensure = { resolveOcrVendorName: async () => assert.fail('no lookup without extracted ID or after review'),
      execute: async () => ({ result: { case: 'NOOP' } }) };
    const noId = await applyFields({ vendorName: 'ชัพพลาย', grandTotalAmount: '10.00' }, null, {}, undefined, {}, ensure);
    assert.equal(noId.record.vendorNameSnapshot, 'ชัพพลาย');
    const reviewed = await applyFields({ vendorName: 'ชัพพลาย', vendorTaxId: '0105473325385', grandTotalAmount: '10.00' },
      null, { reviewedAt: new Date() }, undefined, {}, ensure);
    assert.equal(reviewed.record.vendorNameSnapshot, undefined);
  });
  it('uses the uploadedByUserId on the linked source receipt, not the expense creator or OCR actor', async () => {
    const seen: any[] = [];
    const { result } = await applyFields({ vendorName: 'ร้าน OCR', grandTotalAmount: '10.00' }, null, {
      primaryAttachmentId: 'receipt-1', createdByUserId: 'expense-creator', captureSource: 'WEB_MANUAL',
      sourceReimbursementRequestId: null, vendorCounterpartyId: null, vendorNameSnapshot: null,
      vendorTaxIdSnapshot: null, vendorBranchCodeSnapshot: null, vendorAddressSnapshot: null,
      vendorEntityKindSnapshot: null, reviewedAt: null,
    }, undefined, {
      findPrimaryReceiptUploader: async (companyId: string, expenseId: string, attachmentId: string) => {
        assert.deepEqual([companyId, expenseId, attachmentId], ['company-1', 'expense-1', 'receipt-1']);
        return 'receipt-uploader';
      },
    }, {
      execute: async (ctx, input) => {
        seen.push({ ctx, input });
        return { result: { case: 'CREATE', counterpartyId: 'cp-1' }, linkCounterpartyId: 'cp-1' };
      },
    });

    assert.equal(seen[0].ctx.userId, 'user-1');
    assert.equal(seen[0].input.receiptUploaderUserId, 'receipt-uploader');
    assert.equal(result.vendorCounterpartyAutoSave?.counterpartyId, 'cp-1');
  });
});

describe('ReceiptOcrApplyService.apply staleness guard', () => {
  it('returns the original committed revision with duplicate detection in the same transaction', async () => {
    const before = new Date('2026-09-15T00:00:00.000Z');
    const committed = new Date('2026-09-15T00:00:00.002Z');
    const steps: string[] = [];
    const tx = {
      $executeRaw: async () => { steps.push('lock'); },
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ updatedAt: before, expenseCategoryId: null, expenseCategory: null, lines: [] }),
        update: async () => { steps.push('apply'); return { updatedAt: new Date(before.getTime() + 1) }; },
        findFirstOrThrow: async () => { steps.push('revision'); return { updatedAt: committed }; },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const repo = makeDuplicateRepo({ runDuplicateCheck: async (_input: unknown, _detect: unknown, db: unknown) => {
      assert.equal(db, tx, 'duplicate detection must not open a second transaction after OCR commits');
      steps.push('duplicates'); return { openCandidates: 1, duplicateStatus: 'POSSIBLE_DUPLICATE' };
    } });
    const prisma = { client: { $transaction: async (work: (db: typeof tx) => Promise<unknown>) => {
      const result = await work(tx); steps.push('commit'); return result;
    } } };
    const result = await new ReceiptOcrApplyService(prisma as any, repo as any).apply(
      { companyId: 'company-1', userId: 'user-1' }, 'expense-1', { grandTotalAmount: '580' }, { expectedUpdatedAt: before });
    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual((result as any).committedUpdatedAt, committed);
    assert.deepEqual(steps.slice(-4), ['apply', 'duplicates', 'revision', 'commit']);
  });

  function harness(currentUpdatedAt: Date) {
    const writes: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null, updatedAt: currentUpdatedAt }),
        update: async (args: any) => { writes.push(args); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => { writes.push({ deleteLines: true }); }, create: async () => { writes.push({ createLine: true }); } },
    };
    const prisma = makeApplyPrisma(tx);
    return { service: new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any), writes };
  }
  const fields = { grandTotalAmount: '580.00' };

  it('writes nothing when the record moved while the model was thinking', async () => {
    const { service, writes } = harness(new Date('2026-08-03T13:05:00.000Z'));

    const outcome = await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields, {
      expectedUpdatedAt: new Date('2026-08-03T13:00:00.000Z'),
    });

    assert.equal(isStaleOcrApply(outcome), true);
    assert.deepEqual(writes, [], 'a stale OCR result must not undo the correction that landed');
  });

  it('applies normally when the record is untouched', async () => {
    const version = new Date('2026-08-03T13:00:00.000Z');
    const { service, writes } = harness(version);

    const outcome = await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields, { expectedUpdatedAt: version });

    assert.equal(isStaleOcrApply(outcome), false);
    assert.ok(writes.length > 0);
  });

  it('stays backwards compatible for callers that pass no version', async () => {
    const { service, writes } = harness(new Date('2026-08-03T13:05:00.000Z'));

    const outcome = await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields);

    assert.equal(isStaleOcrApply(outcome), false);
    assert.ok(writes.length > 0);
  });
});

describe('ReceiptOcrApplyService.apply — the replaced-file warning (§16.4, W07-int)', () => {
  function harness(summary: Record<string, unknown> | null, primaryAttachmentId: string | null) {
    const writes: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({
          expenseCategoryId: null, expenseCategory: null, lines: [],
          aiVerificationSummaryJson: summary, primaryAttachmentId,
        }),
        update: async (args: any) => { writes.push(args); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    return {
      service: new ReceiptOcrApplyService(makeApplyPrisma(tx) as any, makeDuplicateRepo() as any),
      writes,
    };
  }
  const stale = { status: 'OCR_EXTRACTED_NEEDS_REVIEW', sourceStale: true, sourceAttachmentId: 'att-old' };

  it('retires it when the read is of the file the record carries NOW', async () => {
    const { service, writes } = harness(stale, 'att-new');
    await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1',
      { grandTotalAmount: '580.00' }, { sourceAttachmentId: 'att-new' });
    const summary = writes.find((write) => write.data?.aiVerificationSummaryJson)?.data.aiVerificationSummaryJson;
    assert.ok(summary, 'the summary is rewritten');
    assert.equal('sourceStale' in summary, false);
    assert.equal('sourceAttachmentId' in summary, false);
    assert.equal(summary.status, 'OCR_EXTRACTED_NEEDS_REVIEW', 'and nothing else about it is touched');
  });

  it('leaves it alone when the read is of some other file, or nobody said which', async () => {
    for (const options of [{ sourceAttachmentId: 'att-other' }, {}]) {
      const { service, writes } = harness(stale, 'att-new');
      await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', { grandTotalAmount: '580.00' }, options);
      assert.equal(writes.some((write) => write.data?.aiVerificationSummaryJson), false, JSON.stringify(options));
    }
  });

  it('writes no summary at all when there was no warning to retire', async () => {
    const { service, writes } = harness({ status: 'OCR_EXTRACTED_NEEDS_REVIEW' }, 'att-new');
    await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1',
      { grandTotalAmount: '580.00' }, { sourceAttachmentId: 'att-new' });
    assert.equal(writes.some((write) => write.data?.aiVerificationSummaryJson), false);
  });
});

describe('ReceiptOcrApplyService.apply', () => {
  it('does not overwrite reviewer VAT source when re-extracted arithmetic disagrees', async () => {
    const prior = {
      version: 1,
      source: {
        inputType: 'AMOUNT', origin: 'REVIEWER', vatRatePercent: null, vatAmount: '27.0800',
        taxableAmount: null, grossAmount: '414.00', capturedAt: '2026-08-20T00:00:00.000Z',
      },
      calculation: {},
      reconciliation: {},
    };
    const { record } = await applyFields({ vatMode: 'VAT_INCLUDED', vatAmount: '20.00', grandTotalAmount: '414.00' }, prior);
    assert.equal(record.vatCaptureSnapshotJson.source.origin, 'REVIEWER');
    assert.equal(record.vatCaptureSnapshotJson.source.vatAmount, '27.0800');
    assert.equal(record.vatCaptureSnapshotJson.reconciliation.status, 'MISMATCH');
    assert.equal(record.vatCaptureSnapshotJson.reconciliation.acceptedSource, 'CALCULATED');
    assert.equal(record.vatAmount, record.vatCaptureSnapshotJson.calculation.vatAmount);
  });

  it('keeps reviewer line evidence reviewable when re-extraction changes the line layout', async () => {
    const prior = {
      version: 1,
      source: {
        inputType: 'NONE', origin: 'REVIEWER', vatRatePercent: null, vatAmount: null,
        taxableAmount: null, grossAmount: '107.00', capturedAt: '2026-08-20T00:00:00.000Z',
        lineSources: [{ lineNumber: 2, inputType: 'AMOUNT', vatAmount: '3.5000', origin: 'REVIEWER' }],
      },
      calculation: {},
      reconciliation: {},
    };
    const { record } = await applyFields({ vatMode: 'VAT_INCLUDED', vatRate: '0.07', grandTotalAmount: '107.00' }, prior);
    assert.equal(record.vatCaptureSnapshotJson.reconciliation.status, 'NEEDS_REVIEW');
    assert.equal(record.vatCaptureSnapshotJson.reconciliation.acceptedSource, 'CALCULATED');
    assert.equal(record.vatCaptureSnapshotJson.source.lineSources[0].lineNumber, 2);
    assert.equal(record.vatAmount, '7.0000');
  });

  it('writes the paid total, the derived line rate, and keeps the raw AI fields for provenance', async () => {
    const updates: any[] = [];
    const lines: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async (args: any) => { updates.push(args); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async (args: any) => { lines.push(args.data); } },
    };
    const prisma = makeApplyPrisma(tx);
    const fields = { taxableAmount: '542.06', vatAmount: '37.94', grandTotalAmount: '580.00', unitPrice: '542.06', quantity: '1' };

    await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any).apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields);

    assert.equal(updates[0].data.vatMode, 'VAT_EXCLUDED');
    assert.equal(updates[0].data.grandTotalAmount, '580.0000');
    assert.equal(updates[0].data.netPayableAmount, '580.0000');
    assert.equal(updates[0].data.vatAmount, '37.9400');
    assert.deepEqual(updates[0].data.aiVerifiedFieldsJson, fields);
    assert.equal(lines[0].unitPrice, '542.0600');
    assert.equal(lines[0].vatRate, '0.0700');
    assert.equal(lines[0].vatAmount, '37.9400');
    assert.equal(lines[0].lineTotalAmount, '580.0000');
  });

  it('keeps the unit price explaining the paid total when the VAT arithmetic is not proven', async () => {
    // taxable 100 vs paid 150 is not a VAT split; a 100 unit price would let the next review
    // save recompute the document down to 100 — the §19c understatement, mirrored.
    const { line } = await applyFields({ taxableAmount: '100.00', grandTotalAmount: '150.00' });
    assert.equal(line.unitPrice, '150.0000');
    assert.equal(line.lineTotalAmount, '150.0000');
    assert.equal(line.vatRate, null);
  });

  it('never turns an unproven discount into a unit price the document does not print (spec §19i)', async () => {
    const { line, record } = await applyFields({
      vatMode: 'VAT_INCLUDED',
      description: 'Starbucks beverages',
      discountAmount: '20.00',
      grandTotalAmount: '180.00',
    });
    assert.equal(line.unitPrice, '180.0000', 'the ฿20 extra shot must not inflate the unit price to ฿200');
    assert.equal(line.discountAmount, '0.0000');
    assert.equal(line.lineTotalAmount, '180.0000');
    assert.equal(record.grandTotalAmount, '180.0000');
  });

  it('records the printed pre-discount price and discount once the subtotal proves them (spec §19i)', async () => {
    const { line } = await applyFields({
      vatMode: 'VAT_INCLUDED',
      subtotalAmount: '195.00',
      discountAmount: '20.00',
      grandTotalAmount: '180.00',
    });
    assert.equal(line.unitPrice, '195.0000');
    assert.equal(line.discountAmount, '15.0000');
    assert.equal(line.lineTotalAmount, '180.0000');
  });

  it('preserves a printed service charge when the review form recomputes VAT and no-VAT receipts', async () => {
    const vatReceipt = await applyFields({
      subtotalAmount: '1000.00',
      taxableAmount: '1100.00',
      vatAmount: '77.00',
      grandTotalAmount: '1177.00',
      vatMode: 'VAT_EXCLUDED',
    });
    assert.equal(vatReceipt.record.subtotalAmount, '1100.0000');
    assert.equal(vatReceipt.line.unitPrice, '1100.0000');
    assert.equal(vatReceipt.line.lineSubtotalAmount, '1100.0000');
    assert.equal(calcLineTotals({ ...vatReceipt.line, vatMode: 'VAT_EXCLUDED' }).lineTotalAmount, '1177.0000');

    const noVatReceipt = await applyFields({
      subtotalAmount: '1000.00',
      grandTotalAmount: '1100.00',
      vatMode: 'NO_VAT',
    });
    assert.equal(noVatReceipt.record.subtotalAmount, '1100.0000');
    assert.equal(noVatReceipt.line.unitPrice, '1100.0000');
    assert.equal(calcLineTotals({ ...noVatReceipt.line, vatMode: 'NO_VAT' }).lineTotalAmount, '1100.0000');
  });

  it('splits a printed service charge into a reconciled line without changing the receipt total', async () => {
    const applied = await applyFields({
      description: 'ค่าอาหาร',
      subtotalAmount: '1000.00',
      taxableAmount: '1100.00',
      vatAmount: '77.00',
      grandTotalAmount: '1177.00',
      vatMode: 'VAT_EXCLUDED',
      additionalCharges: [{
        kind: 'SERVICE_CHARGE',
        description: 'Service charge',
        amount: '100.00',
        evidenceSignal: 'Service charge 100.00',
        confidence: 0.96,
      }],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
    assert.equal(applied.result.chargesApplied, 1);
    assert.equal(applied.lines.length, 2);
    assert.equal(applied.lines[0].unitPrice, '1000.0000');
    assert.equal(applied.lines[1].unitPrice, '100.0000');
    assert.equal(applied.lines[1].vatAmount, '7.0000');
    assert.equal(applied.lines[1].sourceLineText, 'Service charge 100.00');
    assert.equal(applied.record.grandTotalAmount, '1177.0000');
  });

  // UAT 2026-08-14, LINE receipt line-receipt-627291344423616921.jpg — the Royal Pizza Narathiwas 24
  // bill, transcribed exactly: two printed rows (524.00 and 298.00 for two wings), subtotal 822.00,
  // a 25.00 staff discount, VAT 7% included at 52.14, total 797.00. It reached the draft as one
  // summary line, so the reviewer lost the breakdown the document printed. Spec §5 requires a line
  // per row, and the document-level discount must not move the recorded total off 797.00.
  it('splits every printed item row into its own draft line (spec §5)', async () => {
    const applied = await applyFields({
      vendorName: 'Royal Pizza - Narathiwas 24',
      vendorTaxId: '0115559007535',
      expenseDate: '2026-08-12',
      description: 'Royal Pizza',
      subtotalAmount: '822.00',
      discountAmount: '25.00',
      vatRate: '0.07',
      vatAmount: '52.14',
      grandTotalAmount: '797.00',
      vatMode: 'VAT_INCLUDED',
      lines: [
        { description: 'BOGO !12" Half & half pizza', quantity: '1', amount: '524.00', evidenceSignal: 'BOGO !12" Half & half pizza', confidence: 0.94 },
        { description: 'Roasted Wings', quantity: '2', amount: '298.00', evidenceSignal: 'Roasted Wings', confidence: 0.95 },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(applied.result.chargesApplied, 0);
    assert.equal(applied.lines.length, 2);
    assert.deepEqual(applied.lines.map((line: any) => line.description), ['BOGO !12" Half & half pizza', 'Roasted Wings']);
    assert.deepEqual(applied.lines.map((line: any) => line.quantity), ['1.0000', '2.0000']);
    // The bill prints the row amount, not the unit price: two wings for 298.00 is 149.00 each.
    assert.deepEqual(applied.lines.map((line: any) => line.unitPrice), ['524.0000', '149.0000']);
    // The header discount is shared to the satang across its goods rows.
    assert.deepEqual(applied.lines.map((line: any) => line.discountAmount), ['15.9400', '9.0600']);
    assert.deepEqual(applied.lines.map((line: any) => line.lineTotalAmount), ['508.0600', '288.9400']);
    // The per-line VAT split has to add back up to the 52.14 the bill printed.
    assert.deepEqual(applied.lines.map((line: any) => line.vatAmount), ['33.2400', '18.9000']);
    assert.equal(applied.record.vatAmount, '52.1400');
    assert.equal(applied.record.grandTotalAmount, '797.0000', 'the recorded total must not move');
  });

  // W10 D1, from the real 2026-09-19 read of the public FlowAccount ใบกำกับภาษีเต็มรูป template
  // (research note §6): the rows print `250.00` a unit with a 5 % line discount, so the row AMOUNT is
  // already net, and the summary repeats the same 625.00. Applying that discount to a net row
  // under-totalled the draft by 625, so the whole breakdown collapsed into one summary line carrying
  // ITEMS_DID_NOT_RECONCILE — the draft told the reviewer the document contradicted itself.
  it('keeps the item rows when a line discount is repeated in the summary (W10 D1)', async () => {
    const applied = await applyFields({
      vendorName: 'บริษัท โฟลว์แอคเคาท์ ทดสอบ จำกัด',
      vendorTaxId: '0105558096348',
      expenseDate: '2025-02-27',
      subtotalAmount: '12500.00',
      discountAmount: '625.00',
      vatAmount: '776.87',
      grandTotalAmount: '11875.00',
      vatMode: 'VAT_INCLUDED',
      lines: [
        { description: 'เมล็ดกาแฟคั่วเข้ม', quantity: '30', unitPrice: '250.00', amount: '7125.00', evidenceSignal: '30 | 250.00 | 5 % | 7,125.00' },
        { description: 'เมล็ดกาแฟคั่วอ่อน', quantity: '20', unitPrice: '250.00', amount: '4750.00', evidenceSignal: '20 | 250.00 | 5 % | 4,750.00' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES', 'was ITEMS_DID_NOT_RECONCILE');
    assert.equal(applied.lines.length, 2);
    // The printed unit price is kept and the printed discount comes off it ONCE.
    assert.deepEqual(applied.lines.map((line: any) => line.unitPrice), ['250.0000', '250.0000']);
    assert.deepEqual(applied.lines.map((line: any) => line.discountAmount), ['375.0000', '250.0000']);
    assert.deepEqual(applied.lines.map((line: any) => line.lineTotalAmount), ['7125.0000', '4750.0000']);
    assert.equal(applied.record.subtotalAmount, '12500.0000');
    assert.equal(applied.record.discountAmount, '625.0000');
    assert.equal(applied.record.vatAmount, '776.8700');
    assert.equal(applied.record.grandTotalAmount, '11875.0000');
  });

  it('persists a printed zero-priced item through the shared LINE/web OCR apply without NaN', async () => {
    for (const freeAmount of ['0', '0.00', '0.01']) {
      const total = (300 + Number(freeAmount)).toFixed(2);
      const applied = await applyFields({
        vatMode: 'NO_VAT', subtotalAmount: total, grandTotalAmount: total,
        lines: [
          { description: 'สินค้า A', quantity: '1', amount: '100.00' },
          { description: 'สินค้า B', quantity: '2', amount: '200.00' },
          { description: 'รายการแถม', quantity: '1', unitPrice: freeAmount, amount: freeAmount },
        ],
      });
      assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
      assert.equal(applied.lines.length, 3, 'a free item remains a real line');
      assert.equal(applied.lines[2].unitPrice, Number(freeAmount).toFixed(4));
      assert.equal(applied.lines[2].lineTotalAmount, Number(freeAmount).toFixed(4));
      assert.equal(applied.record.grandTotalAmount, Number(total).toFixed(4));
      assert.ok(applied.lines.every((line: any) => Number.isFinite(Number(line.unitPrice))),
        'invalid Decimal strings must not reach the insert boundary');
    }
  });

  it('does not manufacture a zero-priced item from an unreadable amount', async () => {
    for (const amount of ['', 'NaN', 'Infinity', '-1', undefined]) {
      const applied = await applyFields({
        vatMode: 'NO_VAT', grandTotalAmount: '300.00',
        lines: [
          { description: 'สินค้า A', quantity: '1', amount: '300.00' },
          { description: 'ราคาอ่านไม่ได้', quantity: '1', amount },
        ],
      });
      assert.ok(applied.lines.every((line: any) => Number.isFinite(Number(line.unitPrice))));
      assert.equal(applied.lines.some((line: any) => line.description === 'ราคาอ่านไม่ได้'), false);
      assert.equal(applied.record.grandTotalAmount, '300.0000');
    }
  });

  it('keeps a printed per-unit price when it explains the row amount, and adds charges after the items', async () => {
    const applied = await applyFields({
      subtotalAmount: '822.00',
      grandTotalAmount: '904.20',
      vatMode: 'NO_VAT',
      lines: [
        { description: 'พิซซ่า', quantity: '1', unitPrice: '524.00', amount: '524.00', evidenceSignal: 'พิซซ่า' },
        { description: 'ปีกไก่', quantity: '2', unitPrice: '149.00', amount: '298.00', evidenceSignal: 'ปีกไก่' },
      ],
      additionalCharges: [{ kind: 'SERVICE_CHARGE', description: 'Service charge 10%', amount: '82.20', evidenceSignal: 'Service charge' }],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(applied.result.chargesApplied, 1);
    assert.deepEqual(applied.lines.map((line: any) => line.unitPrice), ['524.0000', '149.0000', '82.2000']);
    assert.equal(applied.record.grandTotalAmount, '904.2000');
    // Spec S-1: the charge row is a charge, named in Thai with the percent the bill printed, and it
    // stays out of the goods subtotal while remaining inside the tax base and the total.
    assert.deepEqual(applied.lines.map((line: any) => line.chargeKind), [null, null, 'SERVICE_CHARGE']);
    assert.equal(applied.lines[2].description, 'ค่าบริการ 10%');
    assert.equal(applied.lines[2].sourceLineText, 'Service charge 10%', 'the extractor\u2019s own wording is kept, not replaced by the Thai label');
    assert.equal(applied.record.subtotalAmount, '822.0000');
    assert.equal(applied.record.taxableAmount, '904.2000');
  });

  // A restaurant slip that prints its subtotal and its service charge but has no "TOTAL" box: the
  // fallback used to be `subtotalAmount` alone, so the charge simply vanished from the record and
  // the company under-recorded what it paid.
  it('rebuilds the total from goods, discount and charges when the page printed no grand total', async () => {
    const applied = await applyFields({
      description: 'อาหาร',
      subtotalAmount: '1520.00',
      vatMode: 'NO_VAT',
      additionalCharges: [{ kind: 'SERVICE_CHARGE', description: 'Service charge 10%', amount: '152.00', evidenceSignal: 'Service charge 10% 152.00' }],
    });

    assert.equal(applied.result.chargesApplied, 1);
    assert.deepEqual(applied.lines.map((line: any) => line.chargeKind), [null, 'SERVICE_CHARGE']);
    assert.equal(applied.record.subtotalAmount, '1520.0000');
    assert.equal(applied.record.grandTotalAmount, '1672.0000', 'the service charge is part of what was paid');
  });

  it('adds the printed VAT to the rebuilt total, and never twice on a VAT-included page', () => {
    assert.equal(receiptFallbackLineTotal({ subtotalAmount: '1000.00', vatAmount: '70.00', vatMode: 'VAT_EXCLUDED' } as any), '1070.0000');
    // VAT_INCLUDED already has the tax inside the printed subtotal.
    assert.equal(receiptFallbackLineTotal({ subtotalAmount: '1070.00', vatAmount: '70.00', vatMode: 'VAT_INCLUDED' } as any), '1070.0000');
    assert.equal(receiptFallbackLineTotal({ subtotalAmount: '1000.00', discountAmount: '100.00', vatMode: 'NO_VAT' } as any), '900.0000');
    // A printed grand total always wins, and a page with neither stays unusable.
    assert.equal(receiptFallbackLineTotal({ grandTotalAmount: '1789.04', subtotalAmount: '1.00' } as any), '1789.04');
    assert.equal(receiptFallbackLineTotal({ vatMode: 'NO_VAT' } as any), undefined);
  });

  it('names every charge kind in Thai and keeps a ROUNDING deduction out of the goods subtotal', async () => {
    const applied = await applyFields({
      description: 'อาหาร',
      subtotalAmount: '100.00',
      grandTotalAmount: '135.00',
      vatMode: 'NO_VAT',
      additionalCharges: [
        { kind: 'DELIVERY', description: 'Delivery fee', amount: '20.00', evidenceSignal: 'Delivery' },
        { kind: 'PACKAGING', description: 'Packaging 15 %', amount: '15.00', evidenceSignal: 'Packaging' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
    assert.deepEqual(applied.lines.map((line: any) => line.chargeKind), [null, 'DELIVERY', 'PACKAGING']);
    assert.deepEqual(applied.lines.map((line: any) => line.description), ['อาหาร', 'ค่าส่ง', 'ค่าบรรจุ 15%']);
    assert.equal(applied.record.subtotalAmount, '100.0000', 'the two charges are not goods');
    assert.equal(applied.record.grandTotalAmount, '135.0000');
  });

  it('falls back to the summary line when the item rows contradict the printed total, and says so', async () => {
    // A misread row must never rewrite what the company recorded; the reviewer sees one line and
    // the printed total, not an invented breakdown that happens to be self-consistent.
    // Owner requirement 2026-08-28: the fold is still right, but it may no longer be silent — the
    // rows disagreeing with the total is exactly what an accountant checks first, and a real cash
    // bill (rows 1,040 / total confirmed 7,040) went through here without anyone being told.
    const applied = await applyFields({
      description: 'อาหาร',
      grandTotalAmount: '822.00',
      vatMode: 'NO_VAT',
      lines: [
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า' },
        { description: 'ปีกไก่', quantity: '2', amount: '198.00', evidenceSignal: 'ปีกไก่' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
    assert.equal(applied.result.itemsSumAmount, '722.00', 'the reviewer is given the rows own total, not just told they differ');
    assert.equal(applied.lines.length, 1, 'the record still follows the printed total');
    assert.equal(applied.line.unitPrice, '822.0000');
    assert.equal(applied.record.grandTotalAmount, '822.0000');
  });

  it('ignores a half-readable item block rather than recording part of a bill', async () => {
    const applied = await applyFields({
      grandTotalAmount: '822.00',
      vatMode: 'NO_VAT',
      lines: [
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า' },
        { description: '', quantity: '2', amount: '298.00', evidenceSignal: 'ปีกไก่' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'SUMMARY_LINE');
    assert.equal(applied.lines.length, 1);
  });

  it('splits VAT-included item rows so each line carries its own share of the printed VAT', async () => {
    const applied = await applyFields({
      grandTotalAmount: '214.00',
      vatAmount: '14.00',
      taxableAmount: '200.00',
      vatRate: '0.07',
      vatMode: 'VAT_INCLUDED',
      lines: [
        { description: 'กาแฟ', quantity: '2', amount: '107.00', evidenceSignal: 'กาแฟ' },
        { description: 'ขนมปัง', quantity: '1', amount: '107.00', evidenceSignal: 'ขนมปัง' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.deepEqual(applied.lines.map((line: any) => line.vatAmount), ['7.0000', '7.0000']);
    assert.equal(applied.record.vatAmount, '14.0000');
    assert.equal(applied.record.grandTotalAmount, '214.0000');
  });

  it('supports no-VAT delivery and a VAT-free tip on an otherwise VAT-bearing receipt', async () => {
    const delivery = await applyFields({
      subtotalAmount: '500.00',
      grandTotalAmount: '550.00',
      vatMode: 'NO_VAT',
      additionalCharges: [{
        kind: 'DELIVERY',
        description: 'Delivery',
        amount: '50.00',
        evidenceSignal: 'Delivery 50.00',
      }],
    });
    assert.equal(delivery.result.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
    assert.equal(delivery.lines[1].vatAmount, '0.0000');
    assert.equal(delivery.record.grandTotalAmount, '550.0000');

    const tip = await applyFields({
      subtotalAmount: '100.00',
      taxableAmount: '100.00',
      vatAmount: '7.00',
      vatRate: '0.07',
      grandTotalAmount: '127.00',
      vatMode: 'VAT_EXCLUDED',
      additionalCharges: [{
        kind: 'TIP',
        description: 'Tip',
        amount: '20.00',
        vatRate: '0',
        evidenceSignal: 'Tip 20.00',
      }],
    });
    assert.equal(tip.result.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
    assert.equal(tip.lines[0].vatAmount, '7.0000');
    assert.equal(tip.lines[1].vatRate, '0');
    assert.equal(tip.lines[1].vatAmount, '0.0000');
    assert.equal(tip.record.grandTotalAmount, '127.0000');
  });

  it('stores printed withholding tax as a net-payable reduction, not a gross-total reduction', async () => {
    const applied = await applyFields({
      subtotalAmount: '1000.00',
      taxableAmount: '1000.00',
      grandTotalAmount: '1000.00',
      whtRate: '0.03',
      whtAmount: '30.00',
      vatMode: 'NO_VAT',
    });
    assert.equal(applied.line.whtRate, null, 'the printed amount is authoritative, not an inferred rate');
    assert.deepEqual(applied.record.whtInputJson, { inputType: 'AMOUNT', value: '30.00', origin: 'OCR' });
    assert.equal(applied.line.whtAmount, '30.0000');
    assert.equal(applied.record.grandTotalAmount, '1000.0000');
    assert.equal(applied.record.netPayableAmount, '970.0000');
    assert.equal(applied.record.outstandingAmount, '970.0000');
  });

  it('keeps a non-round-ratio printed WHT amount exact and accepts a rate-only document', async () => {
    const amount = await applyFields({ grandTotalAmount: '1234.56', whtAmount: '30.01', vatMode: 'NO_VAT' });
    assert.equal(amount.record.whtAmount, '30.0100');
    assert.equal(amount.line.whtRate, null);
    const rate = await applyFields({ grandTotalAmount: '1000', whtRate: '0.03', vatMode: 'NO_VAT' });
    assert.equal(rate.record.whtAmount, '30.0000');
    assert.equal(rate.line.whtRate, '0.0300');
    assert.deepEqual(rate.record.whtInputJson, { inputType: 'RATE', value: '3.00', origin: 'OCR' });
    assert.equal(ocrWhtInput({ whtAmount: '-1', whtRate: 'NaN' }), null);
  });

  it('does not replace reviewed WHT, explicit zero-treatment lines or historical mixed rates on OCR retry', async () => {
    for (const existing of [
      { whtInputJson: { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' } },
      { lines: [{ vatTreatment: 'EXEMPT', whtRate: null }, { vatTreatment: 'ZERO_RATED', whtRate: null }] },
      { lines: [{ whtRate: '0.03' }, { whtRate: '0.05' }] },
    ]) {
      const raw = { grandTotalAmount: '500', whtAmount: '15', vatMode: 'NO_VAT' };
      const result = await applyFields(raw, null, existing);
      assert.deepEqual(result.lines, []);
      for (const field of ['whtInputJson', 'whtAmount', 'vatMode', 'vatCaptureSnapshotJson', 'netPayableAmount', 'grandTotalAmount']) {
        assert.equal(field in result.record, false, field);
      }
      assert.deepEqual(result.record.aiVerifiedFieldsJson, raw);
    }
  });

  it('folds unbalanced charges into the safe summary line and requires review', async () => {
    const applied = await applyFields({
      subtotalAmount: '1000.00',
      taxableAmount: '1100.00',
      vatAmount: '77.00',
      vatRate: '0.07',
      grandTotalAmount: '1200.00',
      vatMode: 'VAT_EXCLUDED',
      additionalCharges: [{
        kind: 'SERVICE_CHARGE',
        description: 'Service charge',
        amount: '100.00',
        evidenceSignal: 'Service charge 100.00',
      }],
    });
    assert.equal(applied.result.chargeReconciliationStatus, 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW');
    assert.equal(applied.result.chargesApplied, 0);
    assert.equal(applied.lines.length, 1);
    assert.equal(applied.record.grandTotalAmount, '1200.0000');
    assert.equal(applied.record.aiVerifiedFieldsJson.grandTotalAmount, '1200.00');
    // Spec §5.1: 1,100 + 77 is 1,177, and the page says 1,200 — its own figures contradict each
    // other by more than the charge's VAT, so folding IS right: the printed total is what was
    // paid. What must never happen is folding a printed service charge away in SILENCE. Returning
    // `[]` here left `aiVerificationStatus` at PARTIAL on a draft that had just swallowed one.
    assert.ok(applied.result.reviewReasons.includes(RECEIPT_REVIEW_REASONS.chargesFolded),
      `the fold has to be said out loud, got: ${JSON.stringify(applied.result.reviewReasons)}`);
    assert.equal(applied.record.aiVerificationStatus, 'NEEDS_REVIEW');
  });

  it('says nothing about charges on a bill that printed none', async () => {
    const applied = await applyFields({
      expenseDate: '2026-09-03', grandTotalAmount: '1200.00', vatMode: 'NO_VAT',
    }, null, {}, '2026-09-05');
    assert.equal(applied.result.chargeReconciliationStatus, 'SUMMARY_LINE');
    assert.deepEqual(applied.result.reviewReasons, [], 'no charge, no charge reason');
    assert.equal(applied.record.aiVerificationStatus, 'PARTIAL');
  });

  it('never asserts a 7% line rate for a document that printed no VAT', async () => {
    const { line } = await applyFields({ taxableAmount: '100.00', vatAmount: '0.00', grandTotalAmount: '100.00', vatMode: 'NO_VAT' });
    assert.equal(line.vatRate, null);
    assert.equal(line.vatAmount, '0.0000');
  });

  // Spec §19g decision 1: the reported Starbucks defect. The old fallback wrote '0' here, which
  // reads as a zero-rated supply and drops the whole gross into the tax base.
  it('leaves the line rate unknown when a VAT mode document had no readable VAT', async () => {
    const { line, record } = await applyFields({ vatMode: 'VAT_INCLUDED', grandTotalAmount: '180.00' });
    assert.equal(line.vatRate, null, 'unknown must not be recorded as an explicit zero rate');
    assert.equal(record.grandTotalAmount, '180.0000', 'the amount paid is still recorded exactly');
  });

  it('records the full Starbucks arithmetic once the printed VAT is read', async () => {
    const { line, record } = await applyFields({
      vatMode: 'VAT_INCLUDED', taxableAmount: '168.22', vatAmount: '11.78', grandTotalAmount: '180.00',
    });
    assert.equal(line.vatRate, '0.0700');
    assert.equal(line.vatAmount, '11.7800');
    assert.equal(line.taxableAmount, '168.2200');
    assert.equal(record.grandTotalAmount, '180.0000');
  });

  // §19f decision 3 is untouched by §19g: an explicit zero is data, not an unknown.
  it('keeps an explicitly printed zero rate on a zero-rated document', async () => {
    const { line } = await applyFields({ vatMode: 'VAT_EXCLUDED', vatRate: '0', grandTotalAmount: '180.00' });
    assert.equal(line.vatRate, '0.0000', 'an explicit zero survives completion as a known rate');
    assert.equal(line.vatAmount, '0.0000');
  });

  it('auto-fills one active tenant category on both the header and derived line', async () => {
    const updates: any[] = [];
    const lines: any[] = [];
    const categoryQueries: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async (args: any) => { updates.push(args); },
      },
      expenseCategory: {
        findFirst: async (args: any) => {
          categoryQueries.push(args);
          return { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' };
        },
      },
      expenseLine: {
        deleteMany: async () => undefined,
        create: async (args: any) => { lines.push(args.data); },
      },
    };
    const prisma = makeApplyPrisma(tx);

    const result = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any).apply(
      { companyId: 'company-1', userId: 'user-1' },
      'expense-1',
      {
        grandTotalAmount: '65.00',
        categorySuggestion: {
          expenseCategoryId: 'cat-meals',
          confidence: 0.92,
          evidenceSignals: ['ร้านกาแฟ'],
        },
      },
    );

    assert.equal(updates[0].data.expenseCategoryId, 'cat-meals');
    assert.equal(lines[0].expenseCategoryId, 'cat-meals');
    assert.deepEqual(categoryQueries[0].where, {
      id: 'cat-meals',
      status: 'ACTIVE',
      OR: [{ companyId: 'company-1' }, { companyId: null }],
    });
    assert.deepEqual(result, {
      committedUpdatedAt: new Date('2026-09-15T00:00:00.001Z'),
      candidatesCreated: 0,
      acceptedAmounts: { discountAmount: '0.0000', grandTotalAmount: '65.0000', vatAmount: '0.0000', whtAmount: '0.0000', netPayableAmount: '65.0000', vatMode: 'NO_VAT' },
      categoryId: 'cat-meals',
      categoryName: 'ค่าอาหาร',
      categoryAutoFilled: true,
      categorySuggestion: { expenseCategoryId: 'cat-meals', confidence: 0.92, categoryName: 'ค่าอาหาร' },
      chargeReconciliationStatus: 'SUMMARY_LINE',
      chargesApplied: 0,
      charges: [],
      // Spec §5.2: these fields read no date, so this outcome says so — the draft carries the
      // upload day and the caller has to tell the reviewer that is what it is.
      dateVerified: false,
      dateAssumed: false,
      dateStatus: 'unverified',
      reviewReasons: ['วันที่บนเอกสารยังอ่านไม่ได้ – ใช้วันที่ส่งไว้ก่อน'],
    });
  });

  it('ignores low-confidence or unavailable categories and preserves a reviewed category', async () => {
    const run = async (current: any, confidence: number, resolveCategory: any) => {
      const updates: any[] = [];
      const lines: any[] = [];
      let categoryQueries = 0;
      const tx = {
        companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
          findFirst: async () => current,
          update: async (args: any) => { updates.push(args); },
        },
        expenseCategory: {
          findFirst: async () => {
            categoryQueries += 1;
            return resolveCategory;
          },
        },
        expenseLine: {
          deleteMany: async () => undefined,
          create: async (args: any) => { lines.push(args.data); },
        },
      };
      const prisma = makeApplyPrisma(tx);
      const result = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any).apply(
        { companyId: 'company-1', userId: 'user-1' },
        'expense-1',
        {
          grandTotalAmount: '65.00',
          categorySuggestion: {
            expenseCategoryId: 'cat-meals',
            confidence,
            evidenceSignals: ['ร้านกาแฟ'],
          },
        },
      );
      return { updates, lines, categoryQueries, result };
    };

    // Spec S1-R4: below the bar the category is resolved for the review form but never written —
    // the reviewer is offered it, the server does not decide for them.
    const low = await run({ expenseCategoryId: null, expenseCategory: null }, 0.84, { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.equal(low.categoryQueries, 1);
    assert.equal(low.updates[0].data.expenseCategoryId, undefined);
    assert.equal(low.lines[0].expenseCategoryId, null);
    assert.equal(low.result.categoryAutoFilled, false);
    assert.deepEqual(low.result.categorySuggestion, { expenseCategoryId: 'cat-meals', confidence: 0.84, categoryName: 'ค่าอาหาร' });

    const unavailable = await run({ expenseCategoryId: null, expenseCategory: null }, 0.95, null);
    assert.equal(unavailable.categoryQueries, 1);
    assert.equal(unavailable.updates[0].data.expenseCategoryId, undefined);
    assert.equal(unavailable.lines[0].expenseCategoryId, null);
    assert.equal(unavailable.result.categorySuggestion, undefined, 'a category outside this company or not ACTIVE is not exposed either');

    const reviewed = await run({
      expenseCategoryId: 'cat-reviewed',
      expenseCategory: { id: 'cat-reviewed', name: 'หมวดที่ตรวจแล้ว', companyId: 'company-1' },
    }, 0.99, { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.equal(reviewed.categoryQueries, 0, 'model suggestion must not be queried when Finance already selected a category');
    assert.equal(reviewed.updates[0].data.expenseCategoryId, 'cat-reviewed');
    assert.equal(reviewed.lines[0].expenseCategoryId, 'cat-reviewed');
    assert.equal(reviewed.result.categoryAutoFilled, false);
    assert.equal(reviewed.result.categorySuggestion, undefined);
  });

  // Spec S1-R4 exposure path: the review payload must carry the document-level suggestion even
  // when nothing was auto-filled, and must carry nothing at all when the model proposed nothing.
  it('exposes a below-threshold suggestion, rejects a cross-company one, and stays silent without one', async () => {
    const run = async (fields: any, resolveCategory: any, options: any = {}) => {
      const updates: any[] = [];
      const categoryQueries: any[] = [];
      const tx = {
        companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
          findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
          update: async (args: any) => { updates.push(args); },
        },
        expenseCategory: {
          findFirst: async (args: any) => {
            categoryQueries.push(args);
            return resolveCategory;
          },
        },
        expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
      };
      const prisma = makeApplyPrisma(tx);
      const result = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any).apply(
        { companyId: 'company-1', userId: 'user-1' }, 'expense-1', { grandTotalAmount: '65.00', ...fields }, options,
      );
      return { updates, categoryQueries, result };
    };
    const suggestion = (confidence: number) => ({
      categorySuggestion: { expenseCategoryId: 'cat-meals', confidence, evidenceSignals: ['ร้านกาแฟ'] },
    });

    const exposed = await run(suggestion(0.42), { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.deepEqual(exposed.result.categorySuggestion, { expenseCategoryId: 'cat-meals', confidence: 0.42, categoryName: 'ค่าอาหาร' });
    assert.equal(exposed.result.categoryId, null, 'a recommendation is never applied');
    assert.equal(exposed.updates[0].data.expenseCategoryId, undefined);

    // Company scope is the query itself: another tenant's category cannot match the ACTIVE
    // company-or-global filter, so nothing is exposed and nothing is applied.
    const crossCompany = await run(suggestion(0.95), null);
    assert.deepEqual(crossCompany.categoryQueries[0].where, {
      id: 'cat-meals',
      status: 'ACTIVE',
      OR: [{ companyId: 'company-1' }, { companyId: null }],
    });
    assert.equal(crossCompany.result.categorySuggestion, undefined);
    assert.equal(crossCompany.result.categoryAutoFilled, false);

    const none = await run({}, { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.equal(none.categoryQueries.length, 0);
    assert.equal(none.result.categorySuggestion, undefined);

    // Evidence spans are still mandatory for an OCR suggestion; an unevidenced one is not exposed.
    const unevidenced = await run(
      { categorySuggestion: { expenseCategoryId: 'cat-meals', confidence: 0.9, evidenceSignals: [] } },
      { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' },
    );
    assert.equal(unevidenced.categoryQueries.length, 0);
    assert.equal(unevidenced.result.categorySuggestion, undefined);

    // A weak OCR guess must not shadow a capture hint that clears the bar: auto-fill still wins.
    const hinted = await run(
      suggestion(0.10),
      { id: 'cat-fuel', name: 'ค่าน้ำมัน', companyId: 'company-1' },
      { fallbackCategorySuggestion: { expenseCategoryId: 'cat-fuel', confidence: 0.97 } },
    );
    assert.deepEqual(hinted.categoryQueries[0].where.id, 'cat-fuel');
    assert.equal(hinted.result.categoryAutoFilled, true);
    assert.equal(hinted.result.categoryId, 'cat-fuel');
    assert.deepEqual(hinted.result.categorySuggestion, { expenseCategoryId: 'cat-fuel', confidence: 0.97, categoryName: 'ค่าน้ำมัน' });
  });

  it('automatically flags normalized OCR document fields after applying them', async () => {
    const candidates: any[] = [];
    const statusUpdates: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async () => undefined,
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const prisma = makeApplyPrisma(tx);
    const repo = makeDuplicateRepo({
      findByIdWithRelations: async () => ({
        id: 'expense-1',
        primaryAttachmentId: null,
        attachments: [],
        vendorDocumentNumber: ' ab-123/67 ',
        vendorTaxIdSnapshot: '010-555-123-4567',
        expenseDate: new Date('2026-07-29T00:00:00.000Z'),
        grandTotalAmount: '1,200.00',
        vendorCounterpartyId: null,
      }),
      findNearDuplicates: async () => [{
        id: 'expense-existing',
        checksumSha256: null,
        perceptualHash: null,
        vendorDocumentNumber: 'AB12367',
        vendorTaxId: '0105551234567',
        expenseDate: '2026-07-31T00:00:00.000Z',
        grandTotalAmount: '1200',
        vendorCounterpartyId: null,
      }],
      createDuplicateCandidate: async (...args: any[]) => { candidates.push(args); },
      updateExpense: async (input: any) => { statusUpdates.push(input); return input; },
    });

    const result = await new ReceiptOcrApplyService(prisma as any, repo as any).apply(
      { companyId: 'company-1', userId: 'user-1' },
      'expense-1',
      { documentNumber: 'ab-123/67', vendorTaxId: '0105551234567', expenseDate: '2026-07-29', grandTotalAmount: '1200' },
    );

    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual(candidates[0]?.slice(2, 5), [
      'expense-existing',
      ['same_vendor_document_number', 'same_vendor_tax_id_amount_near_date'],
      50,
    ]);
    assert.equal(statusUpdates.some((update) => 'duplicateStatus' in update), false);
  });

  it('flags the same bill photographed from another angle by normalized vendor, date, and amount', async () => {
    const candidates: any[] = [];
    const statusUpdates: any[] = [];
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async () => undefined,
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const prisma = makeApplyPrisma(tx);
    const repo = makeDuplicateRepo({
      findByIdWithRelations: async () => ({
        id: 'expense-angle-2',
        primaryAttachmentId: 'attachment-angle-2',
        attachments: [{
          id: 'attachment-angle-2',
          purpose: 'expense.receipt.primary',
          checksumSha256: 'angle-2',
          perceptualHash: 'ffffffffffffffff',
        }],
        vendorNameSnapshot: ' ร้าน กาแฟ-ทดสอบ ',
        vendorDocumentNumber: null,
        vendorTaxIdSnapshot: null,
        expenseDate: new Date('2026-07-30T00:00:00.000Z'),
        grandTotalAmount: '120.00',
        vendorCounterpartyId: null,
      }),
      findNearDuplicates: async () => [{
        id: 'expense-angle-1',
        checksumSha256: 'angle-1',
        perceptualHash: '0000000000000000',
        vendorName: 'ร้านกาแฟทดสอบ',
        vendorDocumentNumber: null,
        vendorTaxId: null,
        expenseDate: '2026-07-30T00:00:00.000Z',
        grandTotalAmount: '120',
        vendorCounterpartyId: null,
      }],
      createDuplicateCandidate: async (...args: any[]) => { candidates.push(args); },
      updateExpense: async (input: any) => { statusUpdates.push(input); return input; },
    });

    const result = await new ReceiptOcrApplyService(prisma as any, repo as any).apply(
      { companyId: 'company-1', userId: 'user-1' },
      'expense-angle-2',
      { vendorName: 'ร้าน กาแฟ-ทดสอบ', expenseDate: '2026-07-30', grandTotalAmount: '120' },
    );

    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual(candidates[0]?.slice(2, 5), [
      'expense-angle-1',
      ['same_vendor_date_amount'],
      25,
    ]);
    assert.equal(statusUpdates.some((update) => 'duplicateStatus' in update), false);
  });
});

/**
 * Per-line VAT (Owner 2026-08-28: "VAT ผสมก่อน ... ให้ความสำคัญกับความถูกต้องมาก").
 * A UAT survey of 38 real receipts found 3 that price some rows with VAT and others without,
 * marked with a one-letter code (V taxed; N/P exempt). This boundary re-validates the gateway's
 * suggestion instead of trusting it, and refuses the whole item block on anything malformed —
 * losing the split is recoverable, writing a wrong tax base is not.
 */
describe('usableItemLines per-row VAT', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    description: 'ข้าวผัด', quantity: '1', amount: '100.00', evidenceSignal: 'ข้าวผัด 100.00V', ...over,
  });
  const take = (lines: unknown[]) => usableItemLines({ lines } as any);

  it('accepts a mixed bill: a taxed row beside an exempt row', () => {
    const lines = [row({ vatRate: '0.07' }), row({ description: 'นมสด', vatRate: '0', vatTreatment: 'EXEMPT' })];
    assert.equal(take(lines).length, 2);
  });

  it('accepts the ordinary bill unchanged — no per-row fields at all', () => {
    assert.equal(take([row(), row({ description: 'น้ำเปล่า' })]).length, 2);
  });

  it('refuses the whole block when a rate is not a 0..1 fraction (7 is not 7%)', () => {
    assert.equal(take([row({ vatRate: '7' }), row()]).length, 0);
    assert.equal(take([row({ vatRate: 'seven' }), row()]).length, 0);
  });

  it('refuses a treatment that is not backed by a zero rate', () => {
    assert.equal(take([row({ vatTreatment: 'EXEMPT' }), row()]).length, 0);
    assert.equal(take([row({ vatRate: '0.07', vatTreatment: 'EXEMPT' }), row()]).length, 0);
  });

  it('refuses an unknown treatment code', () => {
    assert.equal(take([row({ vatRate: '0', vatTreatment: 'MAYBE' }), row()]).length, 0);
  });
});

// Owner example 2026-08-28, a Royal Pizza Bravo bill: five paid rows interleaved with the BOGO
// selections the till prints at 0.00. Because a rejected row discards the WHOLE block, treating a
// printed zero as malformed turned a 5-item order into one "AI สรุปยอดรวม" line — silently, since
// the reviewer is never told the breakdown was dropped. A zero is a printed amount.
describe('usableItemLines keeps a bill whose till prints free rows at 0.00', () => {
  it('applies a complete 60-row receipt through reconciliation and preserves its total', async () => {
    const items = Array.from({ length: 60 }, (_, index) => ({ description: `สินค้า ${index + 1}`, amount: '10.00', quantity: '1', evidenceSignal: `สินค้า ${index + 1} 10.00` }));
    const complete = await applyFields({ lines: items, vatMode: 'NO_VAT', grandTotalAmount: '600.00' });
    assert.equal(complete.lines.length, 60);
    assert.equal(complete.record.grandTotalAmount, '600.0000');
    const partial = await applyFields({ lines: items, vatMode: 'NO_VAT', grandTotalAmount: '600.00', missingFields: ['lines'] });
    assert.equal(partial.lines.length, 1, 'flagged partial detail remains source evidence; summary preserves money');
    assert.equal(partial.record.grandTotalAmount, '600.0000');
  });

  it('admits up to 200 complete rows and keeps flagged partial evidence out of financial splitting', () => {
    const lines = Array.from({ length: 200 }, (_, index) => ({ description: `สินค้า ${index + 1}`, amount: '10.00', quantity: '1', evidenceSignal: 'สินค้า 10.00' }));
    assert.equal(usableItemLines({ lines }).length, 200);
    assert.equal(usableItemLines({ lines: [...lines, lines[0]!] }).length, 0);
    assert.equal(usableItemLines({ lines: lines.slice(0, 2), missingFields: ['lines'] }).length, 0);
  });

  const paid = (description: string, amount: string) => ({ description, quantity: '1', amount, evidenceSignal: description });
  const bill = [
    paid('BOGO 12" Half & half pizza', '499.00'),
    paid('- Select Classic Pizza: American pepperoni', '0.00'),
    paid('- Select 1st Pizza: Hawaiian classic', '0.00'),
    paid('BOGO 12" Half & half pizza', '499.00'),
    paid('Roasted Wings', '894.00'),
  ];

  it('keeps every row, including the ones the till printed at zero', () => {
    assert.equal(usableItemLines({ lines: bill } as any).length, 5);
  });

  it('keeps a zero unit price too — the expense model already allows free-of-charge lines', () => {
    const rows = [{ ...paid('Complimentary bread', '0.00'), unitPrice: '0.00' }, paid('Pizza', '499.00')];
    assert.equal(usableItemLines({ lines: rows } as any).length, 2);
  });

  it('still refuses an amount that is not a number at all', () => {
    assert.equal(usableItemLines({ lines: [paid('Pizza', 'ฟรี'), paid('Wings', '894.00')] } as any).length, 0);
  });

  it('still refuses a negative amount, which no till prints as an item row', () => {
    assert.equal(usableItemLines({ lines: [paid('Pizza', '-499.00'), paid('Wings', '894.00')] } as any).length, 0);
  });
});

// Spec `line-ai-draft-control-spec-th.md` §5.2. UAT 2026-09-03: a bill printing 03/09/69 was stored
// with the upload day, the LINE card said "วันที่: ยังไม่ระบุ", and nothing anywhere held both facts.
describe('reviewReceiptDate (spec §5.2)', () => {
  const TODAY = '2026-09-05';

  it('calls an unread date what it is, so the placeholder cannot pass as a reading', () => {
    assert.deepEqual(reviewReceiptDate(undefined, TODAY), { status: 'unverified', verified: false, assumed: false, reason: RECEIPT_REVIEW_REASONS.dateUnverified });
    assert.deepEqual(reviewReceiptDate('03/09/69', TODAY), { status: 'unverified', verified: false, assumed: false, reason: RECEIPT_REVIEW_REASONS.dateUnverified });
  });

  it('accepts a date the document proved', () => {
    assert.deepEqual(reviewReceiptDate('2026-09-03', TODAY), { status: 'verified', verified: true, assumed: false });
    assert.deepEqual(reviewReceiptDate('2026-09-06', TODAY), { status: 'verified', verified: true, assumed: false }, 'one day ahead crosses a timezone, it is not a misread');
  });

  it('flags a date too far from today to be this receipt', () => {
    assert.equal(reviewReceiptDate('2026-09-07', TODAY).reason, RECEIPT_REVIEW_REASONS.dateImplausible);
    assert.equal(reviewReceiptDate('2024-09-04', TODAY).reason, RECEIPT_REVIEW_REASONS.dateImplausible);
    assert.equal(reviewReceiptDate('2024-09-05', TODAY).verified, true, 'exactly two years back is still in range');
  });
});

describe('apply: an unverified date forces review instead of passing silently (spec §5.2)', () => {
  const TODAY = '2026-09-05';

  it('leaves expenseDate unwritten and marks the draft NEEDS_REVIEW when no date was read', async () => {
    const { record, result } = await applyFields({ grandTotalAmount: '580.00' }, null, {}, TODAY);
    assert.equal(record.expenseDate, undefined, 'the placeholder the upload seeded stays; nothing overwrites it');
    assert.equal(record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.equal(result.dateVerified, false);
    assert.deepEqual(result.reviewReasons, [RECEIPT_REVIEW_REASONS.dateUnverified]);
  });

  it('writes a read date and stays PARTIAL', async () => {
    const { record, result } = await applyFields({ grandTotalAmount: '580.00', expenseDate: '2026-09-03' }, null, {}, TODAY);
    assert.equal(record.expenseDate.toISOString().slice(0, 10), '2026-09-03');
    assert.equal(record.aiVerificationStatus, 'PARTIAL');
    assert.equal(result.dateVerified, true);
    assert.deepEqual(result.reviewReasons, []);
  });

  // Spec §5.2 (H2). Receipt mode makes `03/09/69` usable — but only by choosing the วัน/เดือน order
  // and an era. The date stays on the record and does NOT force review; what it must never do is
  // pass as something the page stated outright.
  it('keeps an assumed reading, flags it, and does not force review', async () => {
    const { record, result } = await applyFields({
      grandTotalAmount: '580.00',
      expenseDate: '2026-09-03',
      expenseDateAssumptions: ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era'],
    }, null, {}, TODAY);
    assert.equal(record.expenseDate.toISOString().slice(0, 10), '2026-09-03');
    assert.equal(record.aiVerificationStatus, 'PARTIAL', 'an assumed date is a label, not a defect');
    assert.equal(result.dateVerified, true);
    assert.equal(result.dateAssumed, true);
    assert.equal(result.dateStatus, 'assumed');
    assert.deepEqual(result.dateAssumptions, ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']);
    assert.deepEqual(result.reviewReasons, []);
  });

  it('does not call a plainly printed date assumed', async () => {
    const { result } = await applyFields({
      grandTotalAmount: '580.00', expenseDate: '2026-09-03', expenseDateAssumptions: ['era_read_be'],
    }, null, {}, TODAY);
    assert.equal(result.dateStatus, 'verified', 'พ.ศ. 2569 IS what the page printed — nothing was inferred');
    assert.equal(result.dateAssumed, false);
  });

  it('still stores an out-of-range date, but never as a fact', async () => {
    const { record, result } = await applyFields({ grandTotalAmount: '580.00', expenseDate: '2027-01-01' }, null, {}, TODAY);
    assert.equal(record.expenseDate.toISOString().slice(0, 10), '2027-01-01');
    assert.equal(record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.deepEqual(result.reviewReasons, [RECEIPT_REVIEW_REASONS.dateImplausible]);
  });
});

// Spec §5.1. The BHC bill: ค่าบริการ 10% became a product line taxed at a rate nobody printed, and
// the document's WHT rate was spread onto it — a withholding base no one computed.
describe('apply: additional-charge tax rules (spec §5.1)', () => {
  const TODAY = '2026-09-05';
  const charge = (over: Record<string, unknown> = {}) => ({
    kind: 'SERVICE_CHARGE', description: 'ค่าบริการ 10%', amount: '152.00', evidenceSignal: 'Service charge 10%', ...over,
  });
  // สินค้า 1,520.00 + ค่าบริการ 152.00 = 1,672.00 ฐานภาษี, VAT 7% 117.04, รวม 1,789.04.
  const bhc = {
    vatMode: 'VAT_EXCLUDED' as const, expenseDate: '2026-09-03', subtotalAmount: '1520.00', taxableAmount: '1672.00',
    vatAmount: '117.04', vatRate: '0.07', grandTotalAmount: '1789.04', quantity: '1', unitPrice: '1520.00',
    additionalCharges: [charge()],
  };

  it('keeps the rate the document printed and asks for nothing', async () => {
    const { lines, result } = await applyFields(bhc, null, {}, TODAY);
    assert.equal(result.chargesApplied, 1);
    const row = lines.find((l: any) => l.chargeKind != null);
    assert.equal(row.vatRate, '0.0700', 'the printed document rate is evidence, not a guess');
    assert.deepEqual(result.reviewReasons, []);
  });

  it('never invents 7% for a charge the page priced but never rated', async () => {
    // A printed VAT amount with no rate and no base to derive one from: `defaultLineVatRate`
    // answers 0.0700 here, which is the guess §5.1 forbids on a charge row.
    const { lines, result } = await applyFields(
      { vatMode: 'VAT_EXCLUDED', expenseDate: '2026-09-03', subtotalAmount: '100.00', vatAmount: '7.00', quantity: '1', unitPrice: '100.00', additionalCharges: [charge({ amount: '10.00' })] },
      null, {}, TODAY,
    );
    const row = lines.find((l: any) => l.chargeKind != null);
    assert.equal(row?.vatRate ?? null, null);
    assert.equal(row?.vatTreatment ?? null, null, 'a treatment without a proven rate is a second guess');
    assert.equal(row?.reviewStatus, 'NEEDS_REVIEW');
    assert.deepEqual(result.reviewReasons, [RECEIPT_REVIEW_REASONS.chargeVatUnknown]);
  });

  it('never spreads withholding onto a charge row, and says the base needs checking', async () => {
    const { lines, result } = await applyFields({ ...bhc, whtRate: '0.03' }, null, {}, TODAY);
    const row = lines.find((l: any) => l.chargeKind != null);
    const product = lines.find((l: any) => l.chargeKind == null);
    assert.equal(row.whtRate, null);
    assert.equal(row.whtAmount, '0.0000');
    assert.equal(product.whtRate, '0.0300', 'the printed rate still applies to what it was withheld on');
    assert.equal(product.whtAmount, '45.6000', 'and the whole printed withholding lands on that base');
    assert.deepEqual(result.reviewReasons, [RECEIPT_REVIEW_REASONS.whtWithCharges]);
  });

  // The regression the first cut of §5.1 introduced. Nulling a charge's rate up-front broke
  // reconciliation, the whole split folded, and the charge — with its money — disappeared: a slip
  // printing 100.00 + 10.00 with VAT 7.70 recorded a 100.00 total instead of 117.70.
  it('keeps the charge and the total when the printed VAT proves base + charges', async () => {
    const slip = {
      vatMode: 'VAT_EXCLUDED' as const, expenseDate: '2026-09-03',
      subtotalAmount: '100.00', vatAmount: '7.70', grandTotalAmount: '117.70',
      quantity: '1', unitPrice: '100.00',
      additionalCharges: [charge({ description: 'ค่าบริการ', amount: '10.00' })],
    };
    const { lines, record, result } = await applyFields(slip, null, {}, TODAY);
    assert.equal(result.chargesApplied, 1, 'the charge is a printed row and must survive');
    assert.equal(record.grandTotalAmount, '117.7000', 'and what was paid must not move');
    const row = lines.find((l: any) => l.chargeKind != null);
    assert.equal(row.vatRate, '0.0700', '7.70 over 110.00 IS the proof — no guess, nothing to review');
    assert.deepEqual(result.reviewReasons, []);
  });

  it('keeps an unexplained charge as a reviewable line rather than deleting it', async () => {
    // The page prints a VAT its own base + charge cannot produce at any single rate (7.00 explains
    // the goods alone). Keep both rows, un-rate the charge, and name the gap.
    const slip = {
      vatMode: 'VAT_EXCLUDED' as const, expenseDate: '2026-09-03',
      subtotalAmount: '100.00', vatAmount: '7.00',
      quantity: '1', unitPrice: '100.00',
      additionalCharges: [charge({ description: 'ค่าบริการ', amount: '10.00' })],
    };
    const { lines, result } = await applyFields(slip, null, {}, TODAY);
    assert.equal(result.chargesApplied, 1);
    const row = lines.find((l: any) => l.chargeKind != null);
    assert.equal(row.vatRate ?? null, null);
    assert.equal(row.reviewStatus, 'NEEDS_REVIEW');
    assert.ok(result.reviewReasons.some((reason: string) => reason.startsWith(RECEIPT_REVIEW_REASONS.chargeVatUnknown)));
  });

  it('keeps every kind other than ROUNDING positive', async () => {
    const negative = await applyFields(
      { ...bhc, additionalCharges: [charge({ amount: '-152.00' })] },
      null, {}, TODAY,
    );
    assert.equal(negative.result.chargesApplied, 0, 'money added to a bill is never negative');
  });
});

/**
 * UAT 2026-09-06, build 178d3fb6. Three LINE captures showed a service charge on the chat card and
 * carried NO charge row on the record. Every one of them printed its VAT ADDED ON TOP
 * (130 + 13 = 143 → 7% = 10.01 → 153.01) while the extractor labelled the document VAT_INCLUDED.
 * Read as inclusive the base and the charge come to 143.00, nothing reconciles against the printed
 * 153.01, and the whole bill folded into one summary line. The field sets below are what the UAT
 * database actually stored in `recognizedFields`.
 */
describe('apply: the printed arithmetic decides the VAT mode, not the extractor (UAT 2026-09-06)', () => {
  const TODAY = '2026-09-06';

  /** cmtp9v5bc00931u2uznumjslm — HOUSE TANGO TEMPO ROOM, one Heineken plus ค่าบริการ 10%. */
  const houseTango = {
    vatMode: 'VAT_INCLUDED' as const, vatRate: '0.07', quantity: '1', unitPrice: '130.00',
    subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '153.01',
    additionalCharges: [{
      kind: 'SERVICE_CHARGE' as const, amount: '13.00', vatRate: '0.07', confidence: 0.93,
      description: 'ค่าบริการ (10%)', evidenceSignal: 'ค่าบริการ (10%) 13.00',
    }],
    lines: [], description: 'Heineken bottle x1 with service charge',
    vendorName: 'HOUSE TANGO TEMPO ROOM', documentNumber: '0509202623135963',
    missingFields: ['vendorTaxId', 'expenseDate'],
  };

  /** cmtp9ul5d008e1u2u4yqkx2ee and cmtp9tw7q007o1u2ua08kb0t9 — the same bill captured twice. */
  const bigBill = {
    vatMode: 'VAT_INCLUDED' as const, vatRate: '0.07', quantity: '1', unitPrice: '3680.00',
    subtotalAmount: '3680.00', vatAmount: '283.36', grandTotalAmount: '4331.36',
    additionalCharges: [{
      kind: 'SERVICE_CHARGE' as const, amount: '368.00', vatRate: '0.07', confidence: 0.93,
      description: 'ค่าบริการ (10%)', evidenceSignal: 'ค่าบริการ (10%) 368.00',
    }],
    lines: [],
  };

  it('reads 130 + 13 + VAT 10.01 = 153.01 as VAT added on top, whatever the extractor called it', () => {
    assert.equal(completeVatFields(houseTango).vatMode, 'VAT_EXCLUDED');
    assert.equal(completeVatFields(bigBill).vatMode, 'VAT_EXCLUDED');
  });

  it('still believes a document whose own figures say the VAT is inside', () => {
    assert.equal(completeVatFields({
      vatMode: 'VAT_INCLUDED', subtotalAmount: '100.00', vatAmount: '7.20', grandTotalAmount: '110.00',
      additionalCharges: [{ kind: 'SERVICE_CHARGE', amount: '10.00', description: 'ค่าบริการ', evidenceSignal: 'Service 10.00' }],
    } as never).vatMode, 'VAT_INCLUDED');
  });

  it('keeps the extractor word when neither reading explains the printed total', () => {
    assert.equal(completeVatFields({
      vatMode: 'VAT_INCLUDED', subtotalAmount: '100.00', vatAmount: '7.00', grandTotalAmount: '999.00',
    } as never).vatMode, 'VAT_INCLUDED');
  });

  for (const [name, fields, base, charge, taxable, vat, grand] of [
    ['HOUSE TANGO', houseTango, '130.0000', '13.0000', '143.0000', '10.0100', '153.0100'],
    ['the 4,331.36 bill', bigBill, '3680.0000', '368.0000', '4048.0000', '283.3600', '4331.3600'],
  ] as const) {
    it(`splits ${name} into its base and its printed service charge`, async () => {
      const { lines, record, result } = await applyFields(fields, null, {}, TODAY);

      assert.equal(result.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
      assert.equal(result.chargesApplied, 1);
      assert.equal(result.reviewReasons.includes(RECEIPT_REVIEW_REASONS.chargesFolded), false,
        'nothing was folded, so the reviewer must not be told it was');
      assert.equal(record.vatMode, 'VAT_EXCLUDED');
      assert.equal(record.taxableAmount, taxable);
      assert.equal(record.vatAmount, vat);
      assert.equal(record.grandTotalAmount, grand, 'what the shop paid may never move');

      const product = lines.find((line: any) => line.chargeKind == null);
      const serviceCharge = lines.find((line: any) => line.chargeKind === 'SERVICE_CHARGE');
      assert.equal(lines.length, 2);
      assert.equal(product.unitPrice, base);
      assert.equal(product.vatRate, '0.0700');
      assert.equal(serviceCharge.unitPrice, charge);
      // The charge row keeps the rate string the document printed ('0.07'); the Decimal(18,4)
      // column and every reader normalize it, so compare the rate rather than its spelling.
      assert.equal(Number(serviceCharge.vatRate), 0.07);
    });
  }

  it('hands the persisted charge rows back for the LINE card to print', async () => {
    const { result } = await applyFields(houseTango, null, {}, TODAY);
    assert.deepEqual(result.charges, [{
      kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '13.0000', vatAmount: '0.9100',
    }]);
  });

  /**
   * The Owner's earlier check bill: 270+160+190+30+50+25 = 725 goods, Gratuity 72, and a VAT box
   * printed as a whole 56 baht where 7% of 797 is 55.79. Both readings miss the printed total by
   * that 0.21, so the whole bill used to fold and the gratuity disappeared with it.
   *
   * A whole-baht VAT box is a merchant rounding its own VAT, and a rounded VAT is a fact about the
   * TAX, not about the base: the 0.21 belongs in the VAT, never in a line the document never
   * printed. So the rows stand exactly as printed, the record keeps the computed VAT, and the
   * MISMATCH the reviewer already knows how to answer — "ใช้ยอดตามเอกสาร" — lands it on the invoice.
   */
  const checkBill = {
    vatMode: 'VAT_EXCLUDED' as const, vatRate: '0.07',
    subtotalAmount: '725.00', vatAmount: '56.00', grandTotalAmount: '853.00',
    additionalCharges: [{
      kind: 'SERVICE_CHARGE' as const, amount: '72.00', confidence: 0.9,
      description: 'Gratuity', evidenceSignal: 'Gratuity 72.00',
    }],
    lines: [
      { description: 'อาหาร 1', amount: '270.00', quantity: '1', evidenceSignal: '270.00' },
      { description: 'อาหาร 2', amount: '160.00', quantity: '1', evidenceSignal: '160.00' },
      { description: 'อาหาร 3', amount: '190.00', quantity: '1', evidenceSignal: '190.00' },
      { description: 'อาหาร 4', amount: '30.00', quantity: '1', evidenceSignal: '30.00' },
      { description: 'อาหาร 5', amount: '50.00', quantity: '1', evidenceSignal: '50.00' },
      { description: 'อาหาร 6', amount: '25.00', quantity: '1', evidenceSignal: '25.00' },
    ],
  };

  it('keeps the gratuity and the printed rows when the bill made its VAT a whole baht', async () => {
    const { lines, record, result } = await applyFields(checkBill, null, {}, TODAY);

    assert.equal(result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(result.chargesApplied, 1);
    assert.equal(result.reviewReasons.includes(RECEIPT_REVIEW_REASONS.chargesFolded), false);
    assert.ok(result.reviewReasons.some((reason: string) => reason.startsWith(RECEIPT_REVIEW_REASONS.vatRounding)),
      `the 0.21 the bill rounded is named, not hidden: ${JSON.stringify(result.reviewReasons)}`);
    assert.ok(result.reviewReasons.some((reason: string) => reason.includes('0.21') && reason.includes('ใช้ยอดตามเอกสาร')),
      'and the reviewer is told the one button that records the printed figure');

    assert.equal(lines.length, 7, 'six goods rows and the gratuity — nothing else');
    assert.equal(lines.some((line: any) => line.chargeKind === 'ROUNDING'), false,
      'a whole-baht VAT remainder belongs in the VAT, never in a line the document never printed');
    const serviceCharge = lines.find((line: any) => line.chargeKind === 'SERVICE_CHARGE');
    assert.equal(serviceCharge.unitPrice, '72.0000');
    assert.equal(lines.at(-1).chargeKind, 'SERVICE_CHARGE', 'every charge sorts after every product row');

    assert.equal(record.subtotalAmount, '725.0000', 'the goods are the goods');
    assert.equal(record.taxableAmount, '797.0000', 'the tax base is what the document printed');
    assert.equal(record.vatAmount, '55.7900', 'per-line VAT is rate × taxable, so the record keeps the computed figure');
    assert.equal(record.grandTotalAmount, '852.7900');
    assert.equal(record.vatCaptureSnapshotJson.reconciliation.status, 'MISMATCH',
      'and the existing block still stands between this draft and a confirmation');
  });

  it('holds the §5.1 totals identity on the reconciled record', async () => {
    const { lines, record } = await applyFields(checkBill, null, {}, TODAY);
    assert.equal(expenseTotalsIdentityError({
      vatMode: record.vatMode,
      lines: lines.map((line: any) => ({
        lineSubtotalAmount: line.lineSubtotalAmount, discountAmount: line.discountAmount,
        taxableAmount: line.taxableAmount, vatAmount: line.vatAmount, whtAmount: line.whtAmount,
        lineTotalAmount: line.lineTotalAmount, chargeKind: line.chargeKind,
      })),
      totals: record,
    }), null);
  });

  /**
   * The point of keeping the rows: the record reaches the reviewer as a MISMATCH with every printed
   * row intact, and the button that already exists — "ใช้ยอดตามเอกสาร" — lands it exactly on the tax
   * invoice. The 0.21 goes into the VAT, where the merchant put it, and the tax base never moves.
   */
  it('lands on the printed 797 / 56 / 853 once the reviewer accepts the document amounts', async () => {
    const { lines, record } = await applyFields(checkBill, null, {}, TODAY);
    const expense = {
      ...record,
      whtInputJson: null,
      lines: lines.map((line: any) => ({ ...line })),
    } as any;

    const accepted = acceptExpenseVatSource(expense, { reason: 'ตรวจกับใบเสร็จแล้ว', vatLineNumber: 1 });

    assert.equal(accepted.totals.taxableAmount, '797.0000', 'the tax base is the printed one, untouched');
    assert.equal(accepted.totals.vatAmount, '56.0000', 'and the 0.21 lands in the VAT, where the merchant put it');
    assert.equal(accepted.totals.grandTotalAmount, '853.0000');
    assert.equal(accepted.lines.length, 7, 'accepting the printed VAT invents no line either');
    assert.equal(accepted.snapshot.reconciliation.status, 'REVIEWER_ACCEPTED');

    // Finding F8, FIXED: `reconcileExpenseVat` carries `chargeKind` on the rows it returns, so this
    // acceptance — and `applyExpenseWhtInput` beside it — recompute the header from rows that still
    // know which one is the gratuity. The tax base moved to the printed 797; the goods did not.
    assert.equal(accepted.totals.subtotalAmount, '725.0000', 'the gratuity is a charge, not goods');
    const identityInput = {
      vatMode: record.vatMode,
      totals: accepted.totals,
      // The persisted rows are what a reader compares the header against, and they keep their kind.
      lines: accepted.lines.map((line, index) => ({ ...line.totals, chargeKind: lines[index].chargeKind })),
    };
    assert.equal(expenseTotalsIdentityError(identityInput), null, 'the §5.1 identity holds on the accepted record');
    assert.equal(expenseTotalsIdentity(identityInput).ok, true);
  });

  /**
   * The other direction: a POS that truncates its VAT box to 55 prints a total 0.79 BELOW the
   * computed one. The old ROUNDING synthesis answered that with a NEGATIVE line the bill never
   * printed. Nothing is invented in either direction now — the rows stand and the remainder is named.
   */
  it('keeps the rows and invents no negative line when the bill truncated its VAT down', async () => {
    const { lines, record, result } = await applyFields(
      { ...checkBill, vatAmount: '55.00', grandTotalAmount: '852.00' }, null, {}, TODAY);

    assert.equal(result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(result.chargesApplied, 1);
    assert.equal(lines.length, 7);
    assert.equal(lines.some((line: any) => line.chargeKind === 'ROUNDING'), false);
    assert.ok(result.reviewReasons.some((reason: string) => reason.includes('-0.79')),
      `the remainder is named with its sign: ${JSON.stringify(result.reviewReasons)}`);
    assert.equal(record.vatAmount, '55.7900');
    assert.equal(record.grandTotalAmount, '852.7900');
  });

  it('widens nothing for a satang-precise VAT box: that is a misread, not a rounding', async () => {
    const satangVat = await applyFields({ ...checkBill, vatAmount: '55.50', grandTotalAmount: '852.50' }, null, {}, TODAY);
    assert.equal(satangVat.result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
    assert.equal(satangVat.lines.length, 1);
  });

  /**
   * The window itself, pinned at both edges and in both directions, because the constant is the
   * whole licence: at exactly ฿1.00 the computed VAT is a whole baht too, and one whole baht is not
   * a ROUNDING of another — it is the page disagreeing with itself, so the comparison is strict.
   *
   * The gratuity is the only figure that moves, and it moves only to put the computed VAT where the
   * gap has to land — the printed box is always a whole baht, so the computed side has to carry the
   * fraction:
   *   Gratuity 75.00 → taxable 800.00, computed VAT 56.00  → printed 57 / 55 miss by ±1.00
   *   Gratuity 32.00 → taxable 757.00, computed VAT 52.99  → printed 54 / 52 miss by +1.01 / −0.99
   *   Gratuity 18.00 → taxable 743.00, computed VAT 52.01  → printed 51 / 53 miss by −1.01 / +0.99
   */
  const wholeBahtWindow = (gratuity: string, printedVat: number, taxable: number) => ({
    ...checkBill,
    additionalCharges: [{ ...checkBill.additionalCharges[0], amount: gratuity }],
    vatAmount: printedVat.toFixed(2),
    grandTotalAmount: (taxable + printedVat).toFixed(2),
  });

  for (const [gap, gratuity, printedVat, taxable] of [
    ['+1.00', '75.00', 57, 800],
    ['-1.00', '75.00', 55, 800],
    ['+1.01', '32.00', 54, 757],
    ['-1.01', '18.00', 51, 743],
  ] as const) {
    it(`folds when a whole-baht VAT box misses the computed VAT by ${gap}`, async () => {
      const { lines, result } = await applyFields(wholeBahtWindow(gratuity, printedVat, taxable), null, {}, TODAY);

      assert.equal(result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
      assert.equal(result.chargesApplied, 0);
      assert.equal(lines.length, 1);
      assert.equal(lines.some((line: any) => line.chargeKind != null), false,
        'a gap this wide is not a rounding, so no charge row is kept on its account');
    });
  }

  for (const [gap, gratuity, printedVat, taxable] of [
    ['+0.99', '18.00', 53, 743],
    ['-0.99', '32.00', 52, 757],
  ] as const) {
    it(`keeps the rows when a whole-baht VAT box misses the computed VAT by ${gap}`, async () => {
      const { lines, record, result } = await applyFields(wholeBahtWindow(gratuity, printedVat, taxable), null, {}, TODAY);

      assert.equal(result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
      assert.equal(result.chargesApplied, 1);
      assert.equal(lines.length, 7, 'six goods rows and the gratuity, exactly as printed');
      assert.ok(result.reviewReasons.some((reason: string) =>
        reason.startsWith(RECEIPT_REVIEW_REASONS.vatRounding) && reason.includes(`${gap.replace('+', '')} บาท`)),
        `the remainder is named with its sign: ${JSON.stringify(result.reviewReasons)}`);
      assert.equal(record.vatAmount, (taxable * 0.07).toFixed(4), 'and the record still keeps the computed VAT');
    });
  }

  // A whole baht is the whole licence: a gap this size is the page disagreeing with itself, and the
  // fold — with both numbers — is what the reviewer has to be given.
  it('stops at one baht: a zero-rated tip leaves 5.25 of the printed VAT unexplained', async () => {
    const { lines, result } = await applyFields({
      ...checkBill,
      additionalCharges: [{ ...checkBill.additionalCharges[0], vatRate: '0' }],
    }, null, {}, TODAY);

    assert.equal(result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
    assert.equal(result.chargesApplied, 0);
    assert.equal(lines.length, 1);
  });

  // The rounding is in the VAT box, so the licence covers the VAT and the total it moved — never the
  // tax BASE. A printed `taxableAmount` that misses the rows by more than a satang is the page
  // disagreeing with itself about what was supplied, and no VAT box can excuse it.
  it('never widens the taxable comparison, even with a whole-baht VAT box', async () => {
    const { lines, result } = await applyFields(
      { ...checkBill, taxableAmount: '797.60' }, null, {}, TODAY);

    assert.equal(result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
    assert.equal(lines.length, 1);
  });

  // Rows that do not add up to the printed subtotal are a different disagreement and must keep
  // reaching the reviewer as one.
  it('never widens the subtotal comparison: item rows that miss the printed subtotal still fail', async () => {
    const { lines, result } = await applyFields({
      ...checkBill,
      lines: [...checkBill.lines.slice(0, 5), { description: 'อาหาร 6', amount: '35.00', quantity: '1', evidenceSignal: '35.00' }],
    }, null, {}, TODAY);

    assert.equal(result.chargeReconciliationStatus, 'ITEMS_DID_NOT_RECONCILE');
    assert.equal(result.itemsSumAmount, '735.00');
    assert.equal(lines.length, 1);
    assert.equal(lines.some((line: any) => line.chargeKind != null), false);
  });
});

/** Review findings on the first cut of the VAT-mode fix, each with the case that exposed it. */
describe('apply: what the printed-arithmetic mode may and may not overwrite', () => {
  // P15/P16: EXEMPT and NEEDS_REVIEW are answers about the document's tax POSITION, not readings of
  // its totals. `provenVat` above already refuses to overwrite them; the printed-mode proof must
  // refuse for the same reason, or an exempt supply with a printed VAT box silently becomes taxable.
  it('leaves a deliberate EXEMPT mode alone even when the arithmetic proves VAT was added', () => {
    assert.equal(completeVatFields({
      vatMode: 'EXEMPT', subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '140.01',
    } as never).vatMode, 'EXEMPT');
  });

  it('leaves NEEDS_REVIEW alone', () => {
    assert.equal(completeVatFields({
      vatMode: 'NEEDS_REVIEW', subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '140.01',
    } as never).vatMode, 'NEEDS_REVIEW');
  });

  it('still corrects the modes the extractor only guessed', () => {
    for (const guessed of ['VAT_INCLUDED', 'NO_VAT', 'ห้ามเดา']) {
      assert.equal(completeVatFields({
        vatMode: guessed, subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '140.01',
      } as never).vatMode, 'VAT_EXCLUDED', `${guessed} is a guess the printed arithmetic outranks`);
    }
  });

  // The extractor is a separate service and its output is JSON: `additionalCharges` can be anything.
  // `fields.additionalCharges?.some(...)` threw a TypeError on a string, taking the whole apply with it.
  it('treats a non-array additionalCharges as no charges instead of throwing', () => {
    const out = completeVatFields({
      vatMode: 'VAT_INCLUDED', vatRate: '0.07', subtotalAmount: '130.00', vatAmount: '9.10',
      grandTotalAmount: '139.10', additionalCharges: 'not-an-array',
    } as never);
    // 130.00 + 9.10 = 139.10 is only the printed total once the charge block counts as nothing.
    assert.equal(out.vatMode, 'VAT_EXCLUDED');
    assert.equal(out.vatRate, '0.0700');
  });

  it('survives a non-array additionalCharges through the whole apply', async () => {
    const { lines, result } = await applyFields({
      vatMode: 'VAT_EXCLUDED', vatRate: '0.07', subtotalAmount: '130.00', vatAmount: '9.10',
      grandTotalAmount: '139.10', additionalCharges: 'not-an-array', expenseDate: '2026-09-05',
    }, null, {}, '2026-09-06');
    assert.equal(result.chargesApplied, 0);
    assert.equal(lines.length, 1);
  });
});

/**
 * F5/F12. Two apply outcomes write no lines at all: a rerun that must PRESERVE reviewed lines, and
 * one skipped because the record moved under the OCR round trip. Both returned `charges: []`, which
 * the LINE card reads as "the charges were folded into one total" — and printed that sentence over a
 * record that carries a real SERVICE_CHARGE row. An outcome says what the record HAS.
 */
describe('apply: outcomes that write no lines still report the charges the record carries', () => {
  const persisted = [
    { whtRate: null, vatTreatment: 'ZERO_RATED', chargeKind: null, lineSubtotalAmount: '130.0000', vatAmount: '0.0000' },
    { whtRate: null, vatTreatment: null, chargeKind: 'SERVICE_CHARGE', lineSubtotalAmount: '13.0000', vatAmount: '0.9100' },
  ];

  it('returns the persisted charge rows when a reviewed line layout is preserved', async () => {
    const { lines, result } = await applyFields(
      { vatMode: 'VAT_EXCLUDED', vatRate: '0.07', subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '153.01' },
      null,
      { lines: persisted },
    );

    assert.deepEqual(lines, [], 'a reviewed layout is never rewritten');
    assert.deepEqual(result.charges, [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '13.0000', vatAmount: '0.9100' }]);
  });

  it('returns the persisted charge rows when the apply is skipped as stale', async () => {
    const tx = {
      companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
        findFirst: async () => ({
          expenseCategoryId: null, expenseCategory: null, vatCaptureSnapshotJson: null,
          updatedAt: new Date('2026-08-03T13:05:00.000Z'), lines: persisted,
        }),
        update: async () => { throw new Error('a stale apply must write nothing'); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const prisma = makeApplyPrisma(tx);

    const outcome = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any)
      .apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', { grandTotalAmount: '153.01' }, {
        expectedUpdatedAt: new Date('2026-08-03T13:00:00.000Z'),
      });

    assert.equal(isStaleOcrApply(outcome), true);
    assert.deepEqual(outcome.charges, [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '13.0000', vatAmount: '0.9100' }]);
    // F12: the shape is one type, so no caller may read a field this outcome never filled in.
    assert.deepEqual(outcome.reviewReasons, []);
    assert.equal(outcome.chargesApplied, 0);
    assert.equal(outcome.chargeReconciliationStatus, 'SUMMARY_LINE');
  });
});


describe('receipt tax integrity regressions', () => {
  it('keeps a mixed-tax net summary without inventing a blended rate or discount allocation', async () => {
    const fields = { grandTotalAmount: '15532', subtotalAmount: '14576.73', taxableAmount: '13646.73',
      discountAmount: '345', vatAmount: '955.27', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' };
    const result = await applyFields(fields);
    assert.equal(result.lines.length, 2);
    assert.deepEqual(result.lines.map((line) => line.vatRate), ['0.0700', '0']);
    assert.equal(result.record.grandTotalAmount, '15532.0000');
    assert.equal(result.record.vatAmount, '955.2700');
    assert.equal(result.record.discountAmount, '0.0000', 'net summary already includes discount');
    assert.equal(result.record.aiVerifiedFieldsJson.discountAmount, '345', 'printed discount remains source evidence');
    assert.equal(result.record.vatCaptureSnapshotJson.reconciliation.status, 'MATCHED');
    assert.ok(result.result.reviewReasons.some((reason) => reason.includes('ไม่ต้องหักซ้ำ')));
    assert.ok(result.lines.every((line) => line.reviewStatus === 'NEEDS_REVIEW'));
  });

  it('keeps printed litres and inclusive unit price, with a named one-satang calculated adjustment', async () => {
    const result = await applyFields({ quantity: '61.488', unitPrice: '39.19', subtotalAmount: '2252.06',
      taxableAmount: '2252.06', vatAmount: '157.64', vatRate: '0.07', grandTotalAmount: '2409.70', vatMode: 'VAT_EXCLUDED' });
    assert.equal(result.record.vatMode, 'VAT_INCLUDED');
    assert.equal(result.line.quantity, '61.4880');
    assert.equal(result.line.unitPrice, '39.1900');
    assert.equal(result.lines.at(-1).chargeKind, 'ROUNDING');
    assert.equal(result.lines.at(-1).unitPrice, '-0.01');
    assert.equal(result.record.grandTotalAmount, '2409.7000');
    assert.equal(result.record.vatAmount, '157.6400');
    assert.equal(result.record.taxableAmount, '2252.0600');
  });

  it('does not turn rows on an incomplete page into a final transaction total', () => {
    assert.equal(receiptFallbackLineTotal({ lines: [{ description: 'หน้ารายการสินค้า', quantity: '1', amount: '445', confidence: 0.9, evidenceSignal: 'หน้ารายการสินค้า 445' }] }), undefined);
  });

  it('keeps six mixed-tax grocery rows and printed VAT instead of a blended rate', async () => {
    const amounts = ['219', '20', '105', '18', '18', '20'];
    const fields = { grandTotalAmount: '400', subtotalAmount: '389.47', taxableAmount: '150.47', vatAmount: '10.53', vatRate: '0.07', vatMode: 'VAT_EXCLUDED',
      lines: amounts.map((amount, index) => ({ description: `สินค้า ${index}`, quantity: index === 2 ? '3' : '1', amount,
        evidenceSignal: `สินค้า ${index} ${amount}`, confidence: 0.95, ...(index < 2 ? { vatRate: '0', vatTreatment: 'NON_VAT' } : {}) })) };
    const result = await applyFields(fields);
    assert.equal(result.lines.length, 6);
    assert.equal(result.record.grandTotalAmount, '400.0000');
    assert.equal(result.record.vatAmount, '10.5300');
    assert.equal(result.record.vatMode, 'VAT_INCLUDED');
    assert.deepEqual(result.lines.slice(0, 2).map((line) => line.vatAmount), ['0.0000', '0.0000']);
    assert.equal(result.record.vatCaptureSnapshotJson.reconciliation.status, 'MATCHED');
    assert.equal(result.result.acceptedAmounts?.vatAmount, '10.5300');
  });

  it('keeps service and negative rounding as separate rows with the exact receipt total', async () => {
    const result = await applyFields({ grandTotalAmount: '1600', subtotalAmount: '1360', vatAmount: '104.72', vatRate: '0.07', vatMode: 'VAT_EXCLUDED',
      lines: ['450', '260', '40', '360', '50', '200'].map((amount, i) => ({ description: `อาหาร ${i}`, quantity: '1', amount, evidenceSignal: `อาหาร ${i} ${amount}`, confidence: 0.9 })),
      additionalCharges: [
        { kind: 'SERVICE_CHARGE', description: 'Service charge', amount: '136', vatRate: '0.07', evidenceSignal: 'Service charge 136', confidence: 0.9 },
        { kind: 'ROUNDING', description: 'Rounding', amount: '-0.72', vatRate: '0', evidenceSignal: 'Rounding -0.72', confidence: 0.9 },
      ] });
    assert.equal(result.lines.length, 8);
    assert.equal(result.record.grandTotalAmount, '1600.0000');
    assert.equal(result.record.vatAmount, '104.7200');
    assert.equal(result.lines.at(-1).vatAmount, '0.0000');
    assert.equal(result.lines.at(-1).whtAmount, '0.0000');
    assert.equal(result.lines.at(-1).unitPrice, '-0.7200');
  });

  it('prefills only an evidenced issuer kind and preserves a reviewer identity on reread', async () => {
    const fields = { grandTotalAmount: '70.50', vatMode: 'NO_VAT', whtAmount: '2.71', whtBaseAmount: '270.50',
      vendorName: 'บริษัท ขนส่งตัวอย่าง จำกัด', vendorIdentityEvidence: 'บริษัท ขนส่งตัวอย่าง จำกัด', vendorEntityKind: 'JURISTIC', vendorTaxId: '0100000000001' };
    const initial = await applyFields(fields);
    assert.equal(initial.record.vendorEntityKindSnapshot, 'JURISTIC');
    assert.equal(initial.record.whtInputJson.baseAmount, '270.50');
    assert.equal(initial.record.netPayableAmount, '67.7900');
    const reviewed = await applyFields(fields, null, { vendorEntityKindSnapshot: 'INDIVIDUAL', reviewedAt: new Date('2026-09-01') });
    assert.equal(reviewed.record.vendorEntityKindSnapshot, undefined);
    assert.equal(reviewed.record.vendorNameSnapshot, undefined);
    assert.equal(reviewed.record.vendorTaxIdSnapshot, undefined);
    // CON-5: the address a reviewer typed is in the same protected set, so when OCR starts reading
    // addresses (Phase 4) a re-read of the receipt cannot silently replace it.
    assert.equal(reviewed.record.vendorAddressSnapshot, undefined);
    assert.deepEqual(reviewed.lines, [], 'rereading cannot replace reviewed financial rows');
    assert.equal(reviewed.record.grandTotalAmount, undefined);
    const vatReviewed = await applyFields(fields, { version: 1, source: { origin: 'REVIEWER' } }, {
      lines: [{ whtRate: null, vatTreatment: null, chargeKind: null, lineSubtotalAmount: '70.50', vatAmount: '0' }],
    });
    assert.deepEqual(vatReviewed.lines, []);
    assert.equal(vatReviewed.record.vatCaptureSnapshotJson, undefined);
    const unknown = await applyFields({ ...fields, vendorIdentityEvidence: 'ชื่อลูกค้าไม่ใช่ผู้ขาย' });
    assert.equal(unknown.record.vendorEntityKindSnapshot, undefined);
  });

  it('writes the printed seller address and keeps the buyer block out of every seller column', async () => {
    const fields = {
      grandTotalAmount: '1498.00',
      vendorName: 'บริษัท สยามวัสดุก่อสร้าง จำกัด',
      vendorAddress: '199/8 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120',
      buyerAsPrinted: { name: 'บริษัท มั่งมีพลัส จำกัด', taxId: '0994000163011', branchCode: '00000',
        addressText: '55/3 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900' },
    };
    const result = await applyFields(fields, null, {}, undefined, { getSubstituteCompanyContext: async () => BUYER_REGISTRY });
    assert.equal(result.record.vendorAddressSnapshot, '199/8 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120');
    // A buyer address stored as the vendor's is wrong on every later document that reuses it.
    assert.deepEqual(result.record.aiVerifiedFieldsJson.buyerAsPrinted, fields.buyerAsPrinted);
    assert.notEqual(result.record.vendorAddressSnapshot, fields.buyerAsPrinted.addressText);
    assert.notEqual(result.record.vendorTaxIdSnapshot, fields.buyerAsPrinted.taxId);
  });

  // Slice 2 (vendor-address §5 row 2): the buyer block is compared on the read that produced it.
  it('stores the printed buyer block with its comparison, and changes no tax or claim state (E11)', async () => {
    const buyerAsPrinted = { name: 'บริษัท ร้านอื่น จำกัด', taxId: '0105512345678', branchCode: '00000', addressText: 'ถนนสีลม 10500' };
    const registryReads: Array<[string, string | null]> = [];
    const result = await applyFields({ grandTotalAmount: '1498.00', buyerAsPrinted }, null, { branchId: 'branch-1' }, undefined, {
      getSubstituteCompanyContext: async (companyId: string, branchId: string | null) => { registryReads.push([companyId, branchId]); return BUYER_REGISTRY; },
    });
    const stored = result.record.buyerAsPrintedJson;
    assert.deepEqual(registryReads, [['company-1', 'branch-1']], 'compared against the expense branch');
    assert.equal(stored.matchStatus, 'MISMATCH');
    assert.deepEqual(stored.reasons, ['TAX_ID']);
    assert.deepEqual(stored.differences, [{ reason: 'TAX_ID', printed: '0105512345678', registered: '0994000163011' }]);
    assert.equal(stored.name, buyerAsPrinted.name);
    assert.equal(stored.addressText, buyerAsPrinted.addressText);
    assert.ok(!Number.isNaN(Date.parse(stored.checkedAt)));
    assert.equal('taxEvidenceStatus' in result.record, false);
    assert.equal(result.record.inputVatClaimStatus, 'NON_CLAIMABLE', 'the server preset owns the right, not the buyer comparison');
  });

  it('keeps a confirmed override across a re-read of the same page and drops it when the page changed', async () => {
    const buyerAsPrinted = { name: 'บริษัท ร้านอื่น จำกัด', taxId: '0105512345678' };
    const previous = {
      ...buyerAsPrinted, matchStatus: 'MISMATCH', reasons: ['TAX_ID'],
      differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: '0994000163011' }], checkedAt: '2026-09-20T00:00:00.000Z',
      overrideReason: 'ใบนี้ออกผิดเลข ผู้ขายยืนยันทางอีเมลแล้ว', overriddenByUserId: 'user-9', overriddenAt: '2026-09-20T01:00:00.000Z',
    };
    const repo = { getSubstituteCompanyContext: async () => BUYER_REGISTRY };
    const same = await applyFields({ grandTotalAmount: '10', buyerAsPrinted }, null, { buyerAsPrintedJson: previous }, undefined, repo);
    assert.equal(same.record.buyerAsPrintedJson.overrideReason, previous.overrideReason);
    const changed = await applyFields({ grandTotalAmount: '10', buyerAsPrinted: { ...buyerAsPrinted, taxId: '0105599999999' } },
      null, { buyerAsPrintedJson: previous }, undefined, repo);
    assert.equal(changed.record.buyerAsPrintedJson.overrideReason, undefined);
    // A re-read of a page with no buyer block replaces the stale one instead of leaving it behind.
    const gone = await applyFields({ grandTotalAmount: '10' }, null, { buyerAsPrintedJson: previous }, undefined, repo);
    assert.deepEqual(gone.record.buyerAsPrintedJson, { matchStatus: 'NOT_PRINTED', checkedAt: gone.record.buyerAsPrintedJson.checkedAt });
  });

  it('leaves the column alone when neither this read nor an earlier one printed a buyer block', async () => {
    const result = await applyFields({ grandTotalAmount: '10' });
    assert.equal('buyerAsPrintedJson' in result.record, false);
  });

  it('never replaces an address already on the record (CON-5 and §7 typed-value precedence)', async () => {
    const fields = { grandTotalAmount: '1498.00', vendorAddress: '199/8 ถนนพระราม 3 กรุงเทพฯ 10120' };
    const typedInDraft = await applyFields(fields, null, { vendorAddressSnapshot: '1 ที่อยู่ที่ผู้ตรวจพิมพ์เอง' });
    assert.equal('vendorAddressSnapshot' in typedInDraft.record, false, 'a re-read must not overwrite a human value');
    const reviewed = await applyFields(fields, null, { reviewedAt: new Date('2026-09-01') });
    assert.equal(reviewed.record.vendorAddressSnapshot, undefined, 'and never writes one after review');
  });

  it('does not persist rejected withholding through legacy prepared rates', async () => {
    const result = await applyFields({ grandTotalAmount: '70.50', vatMode: 'NO_VAT', whtRate: '0.5', whtBaseAmount: '270.50' });
    assert.equal(result.record.whtAmount, '0.0000');
    assert.equal(result.record.netPayableAmount, '70.5000');
    assert.ok(result.result.reviewReasons.some((reason) => reason.includes('หัก ณ ที่จ่าย')));
  });
});


describe('OCR preserves an explicitly entered receipt date', () => {
  for (const ocrDate of [undefined, '2026-09-13']) it(`retains user date when OCR returns ${ocrDate ?? 'no date'}`, async () => {
    let written: any;
    const tx = { companyVatRegistrationFact: { findMany: async () => [] },
      expenseRecord: {
      findFirst: async () => ({ expenseDate: new Date('2026-09-12T00:00:00Z'),
        aiVerificationSummaryJson: { dateStatus: 'verified', dateResolution: { expenseDate: '2026-09-12', resolvedByUserId: 'user-1' } }, lines: [] }),
      update: async ({ data }: any) => { written = data; return {}; },
    } };
    const service = new ReceiptOcrApplyService(makeApplyPrisma(tx) as any, makeDuplicateRepo() as any);
    const result = await service.apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', { expenseDate: ocrDate });
    assert.equal('expenseDate' in written, false);
    assert.equal(result.dateStatus, 'verified');
    assert.equal(result.dateVerified, true);
    assert.ok(!result.reviewReasons.includes(RECEIPT_REVIEW_REASONS.dateUnverified));
  });
});

it('R10 Q5c: applying a transfer slip does not create a second registry payee before receipt pairing', async () => {
  for (const sourceDocumentType of [undefined, 'TRANSFER_SLIP']) {
  const result = await applyFields({ vendorName: 'TEST FOODS CO', vendorTaxId: '0105556000011', grandTotalAmount: '500.80' }, null,
    { captureSource: 'LINE_UPLOAD', primaryAttachmentId: 'slip-1', sourceDocumentType: 'TRANSFER_SLIP' }, undefined,
    { findPrimaryReceiptUploader: async () => assert.fail('payment evidence has no supplier registration') },
    { execute: async () => assert.fail('slip payee must not create a supplier'), resolveOcrVendorName: async () => assert.fail('slip must not resolve a supplier') }, sourceDocumentType);
  if (sourceDocumentType) assert.equal(result.record.sourceDocumentType, 'TRANSFER_SLIP');
  assert.equal(result.record.vendorCounterpartyId, undefined);
  assert.equal(result.result.vendorCounterpartyAutoSave, undefined);
  }
});

it('R10 Q2: durable PDF apply stores printed-date provenance atomically and keeps unread dates missing', async () => {
  for (const printedDate of ['2026-09-26', undefined]) {
    const result = await applyFields({ vendorName: 'ร้านบนเอกสาร', grandTotalAmount: '100', ...(printedDate ? { expenseDate: printedDate } : {}),
      missingFields: printedDate ? [] : ['expenseDate'] }, null,
      { primaryAttachmentId: 'pdf-1', expenseDate: new Date('2026-10-16'), aiVerificationSummaryJson: { dateStatus: 'unverified', missingFields: ['expenseDate'], sourceStale: true, sourceAttachmentId: 'old-pdf' } },
      '2026-10-16', {}, undefined, 'TAX_INVOICE', 'pdf-1');
    const summary = result.record.aiVerificationSummaryJson;
    assert.equal(summary.dateStatus, printedDate ? 'verified' : 'unverified');
    assert.equal(summary.recognizedFields.expenseDate, printedDate); assert.equal(summary.missingFields.includes('expenseDate'), !printedDate);
    assert.equal(summary.recognizedFields.vendorName, 'ร้านบนเอกสาร');
    assert.equal(summary.sourceStale, undefined); assert.equal(summary.sourceAttachmentId, undefined);
    if (printedDate) assert.equal(result.record.expenseDate.toISOString().slice(0, 10), printedDate);
    else assert.equal(result.record.expenseDate, undefined);
  }
});


it('R11 T1: retains all 70 recorded PDF rows and the printed whole-bill VAT', async () => {
  const pdf = JSON.parse(readFileSync(resolve(__dirname, '../../domain/logic/fixtures/live-r10-pdf-excerpts.json'), 'utf8'));
  const clean = (value: string) => value.replace(/,/g, '');
  const result = await applyFields({ grandTotalAmount: clean(pdf.total), subtotalAmount: clean(pdf.subtotal),
    vatAmount: clean(pdf.vat), vatMode: 'VAT_EXCLUDED',
    lines: pdf.rows.map((row: any) => ({ ...row, unitPrice: clean(row.unitPrice), amount: clean(row.amount), evidenceSignal: row.evidenceSpan })) });
  assert.equal(result.lines.length, 70, JSON.stringify(result.result));
  assert.equal(result.record.grandTotalAmount, '1123978.2900');
  assert.equal(result.record.vatAmount, '73531.2900');
  assert.equal(result.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
});


it('U1 OCR apply skips transfer-slip classification from both incoming OCR and saved facts on a RECEIPT', async () => {
  for (const saved of [false, true]) {
    const result = await applyFields({ vendorName: 'TEST FOODS CO', vendorTaxId: '0105556000011', grandTotalAmount: '500.80' }, null,
      { captureSource: 'LINE_UPLOAD', primaryAttachmentId: 'slip-1', sourceDocumentType: 'RECEIPT',
        ...(saved ? { aiVerificationSummaryJson: { classification: { documentKind: 'TRANSFER_SLIP' } } } : {}) }, undefined,
      { findPrimaryReceiptUploader: async () => assert.fail('slip must not look up receipt uploader') },
      { execute: async () => assert.fail('slip must not autosave a counterparty'), resolveOcrVendorName: async () => assert.fail('slip must not resolve registry') },
      undefined, undefined, saved ? undefined : 'TRANSFER_SLIP');
    assert.equal(result.record.sourceDocumentType, undefined, 'retain reviewer document type');
    assert.equal(result.record.vendorCounterpartyId, undefined);
  }
});


it('R11 T1: capture source facts round trip 70 and 200 rows and typed text uses the same 200-row bound', () => {
  const categories = [{ id: 'cat', companyId: 'co', status: 'ACTIVE', name: 'สำนักงาน' }] as any;
  const base = { workflowId: 'wf', companyId: 'co', userId: 'u', expenseId: 'ex', chatKeyHash: 'chat', targetRevision: '2026-09-01T00:00:00.000Z', provisionalExpenseDate: '2026-09-01', categories };
  for (const count of [70, 200]) {
    const lines = Array.from({ length: count }, (_, index) => ({ id: `line-${index}`, description: `สินค้า ${index + 1}`,
      quantity: '1', unitPrice: '100', expenseCategoryId: 'cat', chargeKind: null }));
    const expense = { id: 'ex', companyId: 'co', createdByUserId: 'u', captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW',
      updatedAt: new Date(base.targetRevision), expenseDate: new Date('2026-09-01'), vendorNameSnapshot: 'ร้าน ก', lines,
      aiVerificationSummaryJson: { recognizedFields: { expenseDate: '2026-09-01', lines: lines.map(line => ({ ...line, amount: '100' })) },
        chargeReconciliation: { status: 'RECONCILED_ITEM_LINES' } } } as any;
    const state = sourceDraftState(expense, categories)!;
    assert.equal(state.items.length, count);
    assert.equal(state.items.at(-1)!.lineId, `line-${count - 1}`);
    const reloaded = parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(state)))!;
    assert.ok(reloaded); assert.equal(reloaded.items.length, count);
    assert.equal(projectExpenseSourceDraft(reloaded, true).items.length, count);
    const changed = applyExpenseSourceDraftInput(reloaded, { items: reloaded.items.map(item => ({ itemRef: item.itemRef, expenseCategoryId: 'cat' })) }, categories);
    assert.doesNotThrow(() => assertExpenseSourceDraftComplete({ lineExpenseDraftContinuation: changed.state }));
    const hints = { items: lines.map(line => ({ sourceText: `${line.description} 1 100`, description: line.description, quantity: '1', unitPrice: '100' })) };
    assert.equal(buildInitialLineExpenseDraftContinuation({ ...base, messageText: hints.items.map(item => item.sourceText).join(' '), hints }).items.length, count);
  }
});

// Actual model-result fields from the synthetic full-field traces; missing facts are added explicitly.
describe('Fix-up 16 printed rounding and combined discount', () => {
  const D3 = {"vendorName":"ห้างหุ้นส่วนจำกัด ช่างเหล็กวัสดุ","vendorIdentityEvidence":"ห้างหุ้นส่วนจำกัด ช่างเหล็กวัสดุ","vendorEntityKind":"JURISTIC","vendorTaxId":"0123556033444","vendorBranchCode":"00000","vendorAddress":"15/2 หมู่ 4 ต.บางกระสอ อ.เมือง จ.นนทบุรี 11000","documentNumber":"CL-6910-0098","expenseDate":"2026-10-02","description":"วัสดุก่อสร้าง (ปูนซีเมนต์ ทรายหยาบ ตะปู ถุงมือผ้า และอื่นๆ)","vatRate":"0.07","subtotalAmount":"3,039.50","taxableAmount":"2,889.50","vatAmount":"202.27","grandTotalAmount":"3,091.00","currency":"THB","vatMode":"VAT_EXCLUDED","lines":[{"description":"ปูนซีเมนต์ 50 กก.","quantity":"10","amount":"1,450.00","unitPrice":"145.00","evidenceSignal":"ปูนซีเมนต์ 50 กก.","confidence":0.95},{"description":"ทรายหยาบ (คิว)","quantity":"2","amount":"1,300.00","unitPrice":"650.00","evidenceSignal":"ทรายหยาบ (คิว)","confidence":0.95},{"description":"ตะปู 2 นิ้ว (กก.)","quantity":"3","amount":"145.50","unitPrice":"48.50","evidenceSignal":"ตะปู 2 นิ้ว (กก.)","confidence":0.95},{"description":"ถุงมือผ้า","quantity":"12","amount":"144.00","unitPrice":"12.00","evidenceSignal":"ถุงมือผ้า","confidence":0.95}],"confidence":0.93,"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.62,"evidenceSignals":["ปูนซีเมนต์ 50 กก.","ทรายหยาบ (คิว)","ตะปู 2 นิ้ว (กก.)","ช่างเหล็กวัสดุ"]},"expenseDateAssumptions":["order_assumed_day_month","era_resolved_ce"],"missingFields":["discountAmount","additionalCharges"]};
  const R4 = {"vendorName":"บริษัท สุกี้นานา จำกัด","vendorIdentityEvidence":"บริษัท สุกี้นานา จำกัด","vendorEntityKind":"JURISTIC","vendorTaxId":"0105563098761","vendorBranchCode":"00017","documentNumber":"SN17-2610-1188","expenseDate":"2026-10-14","description":"อาหารสุกี้และเครื่องดื่ม (โต๊ะ 21)","vatRate":"0.07","subtotalAmount":"1155.00","taxableAmount":"1270.50","vatAmount":"88.94","grandTotalAmount":"1359.00","currency":"THB","vatMode":"VAT_EXCLUDED","lines":[{"description":"ชุดสุกี้รวมมิตร","quantity":"2","amount":"718.00","unitPrice":"359.00","evidenceSignal":"ชุดสุกี้รวมมิตร","confidence":0.97},{"description":"หมูสไลซ์","quantity":"2","amount":"238.00","unitPrice":"119.00","evidenceSignal":"หมูสไลซ์","confidence":0.97},{"description":"เกี้ยวกุ้ง","quantity":"1","amount":"89.00","unitPrice":"89.00","evidenceSignal":"เกี้ยวกุ้ง","confidence":0.97},{"description":"ชาเขียวเย็น","quantity":"2","amount":"110.00","unitPrice":"55.00","evidenceSignal":"ชาเขียวเย็น","confidence":0.97}],"additionalCharges":[{"kind":"SERVICE_CHARGE","description":"ค่าบริการ (Service Charge) 10%","amount":"115.50","evidenceSignal":"ค่าบริการ (Service Charge) 10%","vatRate":"0.07","confidence":0.97}],"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.72,"evidenceSignals":["ชุดสุกี้รวมมิตร","ชาเขียวเย็น","บริษัท สุกี้นานา จำกัด"]},"expenseDateAssumptions":["era_resolved_ce"],"missingFields":["additionalCharges"]};

  for (const [name, raw, discount, rounding] of [
    ['D3', D3, '150.00', '-0.77'], ['R4', R4, undefined, '-0.44'],
  ] as const) {
    it(`${name}: keeps the printed total, discount, VAT and signed rounding through apply`, async () => {
      const fields = { ...raw, missingFields: [], ...(discount ? { discountAmount: discount } : {}), additionalCharges: [
        ...('additionalCharges' in raw ? raw.additionalCharges : []),
        { kind: 'ROUNDING', description: 'ปัดเศษ', amount: rounding, vatRate: '0', evidenceSignal: `ปัดเศษ ${rounding}` },
      ] };
      assert.equal(verifyDiscountAmount(fields as any).discountAmount, discount);
      const { record, lines } = await applyFields(fields);
      assert.equal(record.grandTotalAmount, Number(raw.grandTotalAmount.replace(/,/g, '')).toFixed(4));
      assert.equal(record.vatAmount, Number(raw.vatAmount).toFixed(4));
      assert.equal(record.discountAmount, Number(discount ?? 0).toFixed(4));
      assert.equal(lines.length, raw.lines.length + fields.additionalCharges.length);
      assert.equal(lines.at(-1).chargeKind, 'ROUNDING');
      assert.equal(lines.at(-1).unitPrice, Number(rounding).toFixed(4));
      assert.equal(lines.at(-1).vatAmount, '0.0000');
      assert.equal(lines.at(-1).whtAmount, '0.0000');
      assert.equal(record.vatCaptureSnapshotJson.reconciliation.status, 'MATCHED');
    });
  }

  it('does not fold settlement rounding into a VAT-exclusive discount when the printed base is absent', () => {
    const fields = { subtotalAmount: '100.00', discountAmount: '10.00', vatMode: 'VAT_EXCLUDED' as const,
      vatAmount: '6.30', grandTotalAmount: '96.00', additionalCharges: [
        { kind: 'ROUNDING' as const, description: 'ปัดเศษ', amount: '-0.30', vatRate: '0', evidenceSignal: 'ปัดเศษ -0.30' }] };
    assert.equal(verifyDiscountAmount(fields).discountAmount, '10.00');
    assert.equal(completeVatFields(fields).taxableAmount, '90.00');
  });
});

describe('marketplace receipt apply safeguards', () => {
  const TODAY = '2026-11-05';
  const amounts = ['5.48', ...Array(13).fill('10.00'), '11.79'];
  const receipt = (gap = '0.06') => ({
    vendorName: 'ร้านสินค้าสังเคราะห์', expenseDate: TODAY, vatMode: 'NO_VAT',
    subtotalAmount: (147.27 + Number(gap)).toFixed(2), discountAmount: '110.00',
    grandTotalAmount: (62.27 + Number(gap)).toFixed(2),
    lines: amounts.map((amount, index) => ({ description: `สินค้าสังเคราะห์ ${index + 1}`,
      quantity: '1', unitPrice: amount, amount, evidenceSignal: `สินค้าสังเคราะห์ ${index + 1}` })),
    additionalCharges: [{ kind: 'DELIVERY', description: 'ค่าจัดส่ง', amount: '25.00', evidenceSignal: 'ค่าจัดส่ง 25.00' }],
  });

  for (const sourceOnly of [false, true]) it(`enforces marketplace safeguards for ${sourceOnly ? 'never-paid source drafts' : 'paid shops'}`, async () => {
    const out = await applyFields({ ...receipt(), documentNumber: '123O' }, null, {}, TODAY,
      {}, undefined, undefined, undefined, undefined, sourceOnly);
    assert.equal(out.lines.length, 17);
    assert.equal(out.record.grandTotalAmount, '62.3300');
    assert.equal(out.record.discountAmount, '110.0000');
    assert.equal(out.record.vendorDocumentNumber, undefined);
    assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.ok(out.result.missingFields?.includes('documentNumber'));
    const folded = await applyFields(receipt('0.11'), null, {}, TODAY,
      {}, undefined, undefined, undefined, undefined, sourceOnly);
    assert.ok(folded.result.missingFields?.includes('lines'));
    assert.ok(folded.record.aiVerificationSummaryJson.missingFields.includes('lines'));
    assert.equal(folded.record.aiVerificationStatus, 'NEEDS_REVIEW');
  });

  for (const sourceOnly of [false, true]) it(`keeps recovered discount and delivery rows for ${sourceOnly ? 'never-paid source drafts' : 'paid shops'}`, async () => {
    const fields = { vendorName: 'ร้านสินค้าสังเคราะห์', expenseDate: TODAY, vatMode: 'NO_VAT',
      subtotalAmount: '232.00', grandTotalAmount: '197.20', lines: [
        { description: 'สินค้าก', quantity: '1', amount: '120.00', evidenceSignal: 'สินค้าก 1 120.00' },
        { description: 'สินค้าข', quantity: '1', amount: '112.00', evidenceSignal: 'สินค้าข 1 112.00' }] };
    const incomplete = await applyFields({ ...fields, missingFields: ['discountAmount', 'additionalCharges'] }, null, {}, TODAY,
      {}, undefined, undefined, undefined, undefined, sourceOnly);
    assert.ok(incomplete.result.missingFields?.includes('lines'));
    assert.equal(incomplete.record.aiVerificationStatus, 'NEEDS_REVIEW');
    const recovered = await applyFields({ ...fields, discountAmount: '82.80', additionalCharges: [
      { kind: 'DELIVERY', description: 'การจัดส่ง', amount: '48.00', evidenceSignal: 'การจัดส่ง 48.00' }] }, null, {}, TODAY,
      {}, undefined, undefined, undefined, undefined, sourceOnly);
    assert.equal(recovered.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(recovered.lines.length, 3);
    assert.equal(recovered.result.chargesApplied, 1);
    assert.equal(recovered.record.grandTotalAmount, '197.2000');
    assert.equal(recovered.record.discountAmount, '82.8000');
  });

  it('spreads a header coupon larger than the first item without losing any printed row', async () => {
    const out = await applyFields(receipt('0'), null, {}, TODAY);
    assert.equal(out.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(out.lines.length, 16);
    assert.equal(out.record.discountAmount, '110.0000');
    assert.equal(out.record.grandTotalAmount, '62.2700');
    assert.equal(out.lines.slice(0, 15).reduce((sum, line) => sum + Number(line.discountAmount), 0).toFixed(2), '110.00');
    assert.ok(out.lines.every(line => Number(line.discountAmount) <= Number(line.lineSubtotalAmount)));
  });

  for (const gap of ['0.01', '-0.01', '0.06', '-0.06', '0.10']) it(`keeps 15 printed rows and the printed total with ${gap} rounding`, async () => {
    const out = await applyFields(receipt(gap), null, {}, TODAY);
    assert.equal(out.result.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(out.lines.length, 17);
    assert.equal(out.record.grandTotalAmount, (62.27 + Number(gap)).toFixed(4));
    const rounding = out.lines.find(line => line.chargeKind === 'ROUNDING');
    assert.equal(Number(rounding.unitPrice), Number(gap));
    assert.equal(rounding.sourceLineText, 'ระบบคำนวณส่วนต่างจากยอดสุทธิที่พิมพ์บนเอกสาร');
    assert.equal(rounding.whtAmount, '0.0000');
    for (const line of out.lines) {
      assert.equal(calcLineTotals({ ...line, vatMode: 'NO_VAT' }).lineTotalAmount, line.lineTotalAmount);
    }
  });

  for (const gap of ['0.11', '-0.11']) it(`reviews a collapse outside the rounding cap ${gap}`, async () => {
    const out = await applyFields(receipt(gap), null, {}, TODAY);
    assert.equal(out.lines.length, 2, 'summary goods and delivery remain visible');
    assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.ok(out.result.missingFields?.includes('lines'));
    assert.ok(out.result.reviewReasons.some(reason => reason.includes('รายการ')));
  });

  it('does not use the document cap to forgive more than one satang per row', async () => {
    const out = await applyFields({ expenseDate: TODAY, vatMode: 'NO_VAT', subtotalAmount: '100.03', grandTotalAmount: '100.03',
      lines: [{ description: 'สินค้า ก', amount: '60.00' }, { description: 'สินค้า ข', amount: '40.00' }] }, null, {}, TODAY);
    assert.equal(out.lines.length, 1);
    assert.equal(out.record.grandTotalAmount, '100.0300');
    assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.ok(out.result.missingFields?.includes('lines'));
  });

  it('preserves an existing reviewed document number and flags gateway-rejected identity fields', async () => {
    const out = await applyFields({ documentNumber: '123O', expenseDate: TODAY, grandTotalAmount: '100.00',
      missingFields: ['vendorName'] }, null, { reviewedAt: new Date(), vendorDocumentNumber: 'INV-123' }, TODAY);
    assert.equal(out.record.vendorDocumentNumber, undefined, 'no update to the reviewed number');
    assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.ok(out.result.missingFields?.includes('vendorName'));
  });

  it('reviews unusable item rows instead of silently keeping just the summary', async () => {
    const fields = receipt('0');
    fields.lines[1]!.amount = 'unreadable';
    const out = await applyFields(fields, null, {}, TODAY);
    assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.ok(out.result.missingFields?.includes('lines'));
    assert.ok(out.result.reviewReasons.length > 0);
  });

  for (const documentNumber of ['123O', 'I123', '123l', '12-O3', '5I78O2', '๑๒๓O']) {
    it(`requires review for numeric-looking document number ${documentNumber}`, async () => {
      const fields = { documentNumber, expenseDate: TODAY, grandTotalAmount: '100.00' };
      const out = await applyFields(fields, null, {}, TODAY);
      assert.equal(out.record.vendorDocumentNumber, undefined);
      assert.equal(out.record.aiVerificationStatus, 'NEEDS_REVIEW');
      assert.ok(out.result.missingFields?.includes('documentNumber'));
      assert.equal(out.record.aiVerifiedFieldsJson.documentNumber, documentNumber, 'raw provenance survives');
    });
  }

  it('keeps ordinary alphanumeric and numeric document numbers', async () => {
    for (const documentNumber of ['INV-0012', 'SO-123', '123-456']) {
      const out = await applyFields({ documentNumber, expenseDate: TODAY, grandTotalAmount: '100' }, null, {}, TODAY);
      assert.equal(out.record.vendorDocumentNumber, documentNumber);
    }
  });
});

it('pins OCR, capture and substitute-receipt row bounds to the shared 200-item contract', async () => {
  const { EXPENSE_MAX_ITEM_LINES, SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS, EXPENSE_CAPTURE_OBSERVATION_LIMITS } = await import('@watchdog-bms/contracts');
  const { MAX_OCR_ITEM_LINES } = await import('./receipt-ocr-apply.service');
  assert.equal(EXPENSE_MAX_ITEM_LINES, 200);
  assert.equal(MAX_OCR_ITEM_LINES, EXPENSE_MAX_ITEM_LINES);
  assert.equal(SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines, EXPENSE_MAX_ITEM_LINES);
  assert.equal(EXPENSE_CAPTURE_OBSERVATION_LIMITS.maxItemsPerWindow, EXPENSE_MAX_ITEM_LINES);
});
