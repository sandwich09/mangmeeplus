import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeVatFields, isStaleOcrApply, ocrLineVatRateUnknown, ReceiptOcrApplyService, verifyDiscountAmount } from './receipt-ocr-apply.service';
import { calcLineTotals } from '../../domain/logic/expense-totals.logic';

function makeDuplicateRepo(overrides: Record<string, unknown> = {}) {
  return {
    runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
      const matched = await detectWithinTx({ marker: 'tx' });
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

async function applyFields(fields: any) {
  const updates: any[] = [];
  const lines: any[] = [];
  const tx = {
    expenseRecord: {
      findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
      update: async (args: any) => { updates.push(args); },
    },
    expenseCategory: { findFirst: async () => null },
    expenseLine: { deleteMany: async () => undefined, create: async (args: any) => { lines.push(args.data); } },
  };
  const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
  const result = await new ReceiptOcrApplyService(prisma as any, makeDuplicateRepo() as any).apply({ companyId: 'company-1', userId: 'user-1' }, 'expense-1', fields);
  return { record: updates[0]?.data, line: lines[0], lines, result };
}

describe('ReceiptOcrApplyService.apply staleness guard', () => {
  function harness(currentUpdatedAt: Date) {
    const writes: any[] = [];
    const tx = {
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null, updatedAt: currentUpdatedAt }),
        update: async (args: any) => { writes.push(args); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => { writes.push({ deleteLines: true }); }, create: async () => { writes.push({ createLine: true }); } },
    };
    const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
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

describe('ReceiptOcrApplyService.apply', () => {
  it('writes the paid total, the derived line rate, and keeps the raw AI fields for provenance', async () => {
    const updates: any[] = [];
    const lines: any[] = [];
    const tx = {
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async (args: any) => { updates.push(args); },
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async (args: any) => { lines.push(args.data); } },
    };
    const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
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
    // The staff discount has no printed row, so it sits on the first item: 524 − 25 = 499.
    assert.deepEqual(applied.lines.map((line: any) => line.discountAmount), ['25.0000', '0.0000']);
    assert.deepEqual(applied.lines.map((line: any) => line.lineTotalAmount), ['499.0000', '298.0000']);
    // The per-line VAT split has to add back up to the 52.14 the bill printed.
    assert.deepEqual(applied.lines.map((line: any) => line.vatAmount), ['32.6400', '19.5000']);
    assert.equal(applied.record.vatAmount, '52.1400');
    assert.equal(applied.record.grandTotalAmount, '797.0000', 'the recorded total must not move');
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
  });

  it('falls back to the summary line when the item rows contradict the printed total', async () => {
    // A misread row must never rewrite what the company recorded; the reviewer sees one line and
    // the printed total, not an invented breakdown that happens to be self-consistent.
    const applied = await applyFields({
      description: 'อาหาร',
      grandTotalAmount: '822.00',
      vatMode: 'NO_VAT',
      lines: [
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า' },
        { description: 'ปีกไก่', quantity: '2', amount: '198.00', evidenceSignal: 'ปีกไก่' },
      ],
    });

    assert.equal(applied.result.chargeReconciliationStatus, 'SUMMARY_LINE');
    assert.equal(applied.lines.length, 1);
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
    assert.equal(applied.line.whtRate, '0.0300');
    assert.equal(applied.line.whtAmount, '30.0000');
    assert.equal(applied.record.grandTotalAmount, '1000.0000');
    assert.equal(applied.record.netPayableAmount, '970.0000');
    assert.equal(applied.record.outstandingAmount, '970.0000');
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
    const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };

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
      candidatesCreated: 0,
      categoryId: 'cat-meals',
      categoryName: 'ค่าอาหาร',
      categoryAutoFilled: true,
      chargeReconciliationStatus: 'SUMMARY_LINE',
      chargesApplied: 0,
    });
  });

  it('ignores low-confidence or unavailable categories and preserves a reviewed category', async () => {
    const run = async (current: any, confidence: number, resolveCategory: any) => {
      const updates: any[] = [];
      const lines: any[] = [];
      let categoryQueries = 0;
      const tx = {
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
      const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
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

    const low = await run({ expenseCategoryId: null, expenseCategory: null }, 0.84, { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.equal(low.categoryQueries, 0);
    assert.equal(low.updates[0].data.expenseCategoryId, undefined);
    assert.equal(low.lines[0].expenseCategoryId, null);
    assert.equal(low.result.categoryAutoFilled, false);

    const unavailable = await run({ expenseCategoryId: null, expenseCategory: null }, 0.95, null);
    assert.equal(unavailable.categoryQueries, 1);
    assert.equal(unavailable.updates[0].data.expenseCategoryId, undefined);
    assert.equal(unavailable.lines[0].expenseCategoryId, null);

    const reviewed = await run({
      expenseCategoryId: 'cat-reviewed',
      expenseCategory: { id: 'cat-reviewed', name: 'หมวดที่ตรวจแล้ว', companyId: 'company-1' },
    }, 0.99, { id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' });
    assert.equal(reviewed.categoryQueries, 0, 'model suggestion must not be queried when Finance already selected a category');
    assert.equal(reviewed.updates[0].data.expenseCategoryId, 'cat-reviewed');
    assert.equal(reviewed.lines[0].expenseCategoryId, 'cat-reviewed');
    assert.equal(reviewed.result.categoryAutoFilled, false);
  });

  it('automatically flags normalized OCR document fields after applying them', async () => {
    const candidates: any[] = [];
    const statusUpdates: any[] = [];
    const tx = {
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async () => undefined,
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
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
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async () => undefined,
      },
      expenseCategory: { findFirst: async () => null },
      expenseLine: { deleteMany: async () => undefined, create: async () => undefined },
    };
    const prisma = { client: { $transaction: async (fn: any) => fn(tx) } };
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
