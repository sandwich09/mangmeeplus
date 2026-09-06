// Spec §19c: a receipt records the document's own VAT arithmetic (vatMode + line vatRate);
// only inputVatClaimStatus / Tax Code selection are forced by claimability.
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

const receiptLine = {
  lineNumber: 1, description: 'BENLAI', quantity: '1', unitPrice: '542.06', discountAmount: '0', vatRate: '0.07',
};

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const updates: any[] = [];
  const upserted: any[] = [];
  const repo = {
    findById: async () => ({
      id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'NEEDS_REVIEW', vatMode: 'VAT_EXCLUDED',
      currency: 'THB', expenseDate: new Date('2026-07-28T00:00:00.000Z'), aiVerificationSummaryJson: null,
      ...overrides,
    }),
    findByIdWithRelations: async () => ({ lines: [] }),
    updateExpense: async (input: any, withinTransaction?: (tx: unknown) => Promise<void>) => {
      updates.push(input);
      await withinTransaction?.({ transaction: 'expense-update' });
      return input;
    },
    // §5.1: an omitted chargeKind on a replacement PATCH keeps the stored one, so the
    // update path reads them back before it validates.
    listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
    upsertLines: async (_companyId: string, _expenseId: string, lines: any[]) => { upserted.push(...lines); },
  } as any;
  return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), updates, upserted };
}

describe('UpdateExpenseDraftUseCase VAT decoupling (spec §19c)', () => {
  it('saves a 25-baht inclusive receipt from an explicit rate or amount-only source without adding VAT again', async () => {
    for (const source of [{ inputType: 'NONE' }, { inputType: 'AMOUNT', vatAmount: '1.64' }] as const) {
      const { useCase, updates, upserted } = makeUseCase();
      await useCase.execute(ctx, 'exp-1', {
        vatMode: 'VAT_INCLUDED', vatSource: source,
        lines: [{ ...receiptLine, unitPrice: '25', vatRate: source.inputType === 'NONE' ? '0.07' : '' }],
      });
      assert.equal(updates[0].grandTotalAmount, '25.0000');
      assert.equal(updates[0].taxableAmount, '23.3600');
      assert.equal(updates[0].vatAmount, '1.6400');
      assert.equal(upserted[0].lineTotalAmount, '25.0000');
      assert.notEqual(upserted[0].vatRate, null);
    }
  });

  it('keeps saved baht WHT on reload and edits even when the legacy caller sends a different rate', async () => {
    const saved = { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' };
    const { useCase, updates, upserted } = makeUseCase({ whtInputJson: saved });
    await useCase.execute(ctx, 'exp-1', {
      lines: [{ ...receiptLine, unitPrice: '2345.67', discountAmount: '5', whtRate: '0.03' }],
    });
    assert.equal(updates[0].whtAmount, '30.0100');
    assert.equal(upserted[0].whtAmount, '30.0100');
    assert.equal(upserted[0].whtRate, null);
    assert.equal(updates[0].whtInputJson, undefined, 'omitted source keeps stored intent');
  });

  it('switches baht to percent explicitly and keeps gross separate from payable', async () => {
    const { useCase, updates, upserted } = makeUseCase({ whtInputJson: { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' } });
    await useCase.execute(ctx, 'exp-1', {
      vatMode: 'VAT_INCLUDED', whtInput: { inputType: 'RATE', value: '3' },
      lines: [{ ...receiptLine, unitPrice: '1070' }],
    });
    assert.equal(updates[0].whtAmount, '30.0000');
    assert.equal(upserted[0].whtRate, '0.0300');
    assert.equal(updates[0].grandTotalAmount, '1070.0000');
    assert.equal(updates[0].netPayableAmount, '1040.0000');
    assert.deepEqual(updates[0].whtInputJson, { inputType: 'RATE', value: '3', origin: 'REVIEWER' });
  });

  it('does not collapse historical mixed WHT rates when no whole-bill input exists', async () => {
    const { useCase, updates, upserted } = makeUseCase();
    await useCase.execute(ctx, 'exp-1', { lines: [
      { ...receiptLine, unitPrice: '1000', whtRate: '0.03' },
      { ...receiptLine, lineNumber: 2, unitPrice: '500', whtRate: '0.05' },
    ] });
    assert.deepEqual(upserted.map((line) => line.whtRate), ['0.03', '0.05']);
    assert.equal(updates[0].whtAmount, '55.0000');
    assert.equal(updates[0].whtInputJson, undefined);
  });

  it('blocks lowering the pre-VAT base below saved baht WHT without persisting a partial change', async () => {
    const { useCase, updates, upserted } = makeUseCase({ whtInputJson: { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' } });
    await assert.rejects(() => useCase.execute(ctx, 'exp-1', { lines: [{ ...receiptLine, unitPrice: '30' }] }), /pre-VAT/);
    await assert.rejects(() => useCase.execute(ctx, 'exp-1', { whtInput: { inputType: 'RATE', value: '3' } }), /lines are required/);
    await assert.rejects(() => useCase.execute(ctx, 'exp-1', { vatMode: 'VAT_INCLUDED' }), /lines are required/);
    assert.equal(updates.length, 0);
    assert.equal(upserted.length, 0);
  });

  it('persists source, accepted line VAT, and the calculation snapshot in one review update', async () => {
    const { useCase, updates, upserted } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', {
      vatMode: 'VAT_EXCLUDED',
      vatSource: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '37.95' },
      lines: [receiptLine],
    } as any);

    assert.equal(updates[0].vatCaptureSnapshotJson.source.vatAmount, '37.9500');
    assert.equal(updates[0].vatCaptureSnapshotJson.calculation.vatAmount, '37.9400');
    assert.equal(updates[0].vatCaptureSnapshotJson.reconciliation.status, 'MATCHED');
    assert.equal(updates[0].vatAmount, '37.9500');
    assert.equal(upserted[0].vatAmount, '37.9500');
  });

  it('keeps the reviewer VAT mode and line rate on a receipt while forcing NON_CLAIMABLE', async () => {
    const { useCase, updates, upserted } = makeUseCase();

    await useCase.execute(ctx, 'exp-1', { vatMode: 'VAT_EXCLUDED', lines: [receiptLine] } as any);

    assert.equal(updates[0].vatMode, 'VAT_EXCLUDED');
    assert.equal(updates[0].inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.ok(Math.abs(Number(updates[0].grandTotalAmount) - 580) < 0.01, `expected ~580, got ${updates[0].grandTotalAmount}`);
    assert.ok(Math.abs(Number(updates[0].netPayableAmount) - 580) < 0.01);
    assert.equal(upserted[0].vatRate, '0.07');
    assert.ok(Math.abs(Number(upserted[0].vatAmount) - 37.94) < 0.01, `expected ~37.94, got ${upserted[0].vatAmount}`);
    assert.ok(Math.abs(Number(upserted[0].taxableAmount) - 542.06) < 0.01);
  });

  // Plan 13.11.B: "mismatch ต้องไม่ทำให้บันทึก draft หายหรือเป็นทางตัน" — only final confirmation
  // blocks. The draft keeps every value the reviewer typed and records which line to come back to.
  it('saves a mixed-VAT draft whose document total does not reconcile, naming the line to fix', async () => {
    const { useCase, updates, upserted } = makeUseCase();

    const saved = await useCase.execute(ctx, 'exp-1', {
      vatMode: 'VAT_EXCLUDED',
      vatSource: { inputType: 'AMOUNT', vatAmount: '8.00' },
      lines: [
        { lineNumber: 1, description: 'สินค้า', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0.07' },
        { lineNumber: 2, description: 'ผัก', quantity: '1', unitPrice: '50', discountAmount: '0', vatRate: '0' },
      ],
    } as any);

    assert.ok(saved, 'the draft save must succeed despite the mismatch');
    assert.equal(updates[0].vatCaptureSnapshotJson.reconciliation.status, 'MISMATCH');
    assert.deepEqual(updates[0].vatCaptureSnapshotJson.reconciliation.attentionLineNumbers, [1]);
    // Both figures survive: the printed 8.00 and the calculated 7.00 on the VAT base alone.
    assert.equal(updates[0].vatCaptureSnapshotJson.source.vatAmount, '8.0000');
    assert.equal(updates[0].vatCaptureSnapshotJson.calculation.vatAmount, '7.0000');
    assert.equal(updates[0].vatCaptureSnapshotJson.calculation.vatBaseAmount, '100.0000');
    assert.equal(upserted[1].vatAmount, '0.0000');
  });

  it('still rejects claiming input VAT on a receipt', async () => {
    const { useCase } = makeUseCase();
    await assert.rejects(
      () => useCase.execute(ctx, 'exp-1', { inputVatClaimStatus: 'CLAIMABLE' } as any),
      /cannot claim input VAT/,
    );
  });

  it('retains all zero treatments with mixed VAT, discounts, rounding residuals, and mismatch gates', async () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      for (const vatAmount of ['7.01', '8.00']) {
        const { useCase, updates, upserted } = makeUseCase();
        await useCase.execute(ctx, 'exp-1', {
          vatMode,
          vatSource: { inputType: 'AMOUNT', vatAmount },
          lines: [
            { lineNumber: 1, description: 'Taxable', quantity: '1', unitPrice: vatMode === 'VAT_INCLUDED' ? '127' : '120', discountAmount: '20', vatRate: '0.07' },
            { lineNumber: 2, description: 'Exempt', quantity: '1', unitPrice: '500', discountAmount: '50', vatRate: '0', vatTreatment: 'EXEMPT' },
            { lineNumber: 3, description: 'Zero-rated', quantity: '1', unitPrice: '20', vatRate: '0', vatTreatment: 'ZERO_RATED' },
            { lineNumber: 4, description: 'Non-VAT', quantity: '1', unitPrice: '30', vatRate: '0', vatTreatment: 'NON_VAT' },
          ],
        });
        const matched = vatAmount === '7.01';
        const snapshot = updates[0].vatCaptureSnapshotJson;
        assert.equal(snapshot.reconciliation.status, matched ? 'MATCHED' : 'MISMATCH');
        assert.equal(updates[0].discountAmount, '70.0000');
        assert.equal(updates[0].vatAmount, matched ? '7.0100' : '7.0000');
        assert.equal(updates[0].grandTotalAmount, matched && vatMode === 'VAT_EXCLUDED' ? '607.0100' : '607.0000');
        assert.deepEqual(upserted.map((line) => line.vatTreatment), [null, 'EXEMPT', 'ZERO_RATED', 'NON_VAT']);
        assert.deepEqual(upserted.slice(1).map((line) => [line.taxableAmount, line.vatAmount]), [
          ['450.0000', '0.0000'], ['20.0000', '0.0000'], ['30.0000', '0.0000'],
        ]);
        assert.deepEqual(snapshot.calculation.lineResults.slice(1).map((line: any) => line.residualAdjustment), ['0.0000', '0.0000', '0.0000']);
        if (!matched) assert.deepEqual(snapshot.reconciliation.attentionLineNumbers, [1]);
      }
    }
  });

  it('rejects zero-treatment/source-rate conflicts on update without writing', async () => {
    const { useCase, updates, upserted } = makeUseCase();
    await assert.rejects(() => useCase.execute(ctx, 'exp-1', {
      vatMode: 'VAT_EXCLUDED',
      vatSource: { inputType: 'NONE', lines: [{ lineNumber: 1, inputType: 'RATE', vatRatePercent: '7' }] },
      lines: [{ lineNumber: 1, description: 'Exempt', quantity: '1', unitPrice: '100', vatRate: '0', vatTreatment: 'EXEMPT' }],
    }), /requires an explicit zero VAT rate/);
    assert.equal(updates.length, 0);
    assert.equal(upserted.length, 0);
  });

  // Spec §19h: same write-path treatment as a receipt — the abbreviated invoice keeps its printed
  // VAT arithmetic (§19c) but can never carry a Tax Code or claim input VAT.
  it('rejects claiming input VAT and Tax Codes on an abbreviated tax invoice', async () => {
    const claim = makeUseCase({ sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY' });
    await assert.rejects(
      () => claim.useCase.execute(ctx, 'exp-1', { inputVatClaimStatus: 'CLAIMABLE' } as any),
      /cannot claim input VAT/,
    );

    const taxCode = makeUseCase({ sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY' });
    await assert.rejects(
      () => taxCode.useCase.execute(ctx, 'exp-1', { lines: [{ ...receiptLine, taxCodeDefinitionId: 'tax-o7' }] } as any),
      /cannot retain a Tax Code/,
    );
  });

  it('keeps the printed VAT on an abbreviated tax invoice — non-claimable is not zero VAT', async () => {
    const { useCase, updates, upserted } = makeUseCase({
      sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY',
    });

    await useCase.execute(ctx, 'exp-1', { vatMode: 'VAT_EXCLUDED', lines: [receiptLine] } as any);

    assert.equal(upserted[0].vatRate, '0.07');
    assert.ok(Math.abs(Number(upserted[0].vatAmount) - 37.94) < 0.01, `expected ~37.94, got ${upserted[0].vatAmount}`);
    assert.equal(updates[0].inputVatClaimStatus, 'NON_CLAIMABLE');
  });

  it('still rejects a Tax Code selection on a receipt', async () => {
    const { useCase } = makeUseCase();
    await assert.rejects(
      () => useCase.execute(ctx, 'exp-1', { lines: [{ ...receiptLine, taxCodeDefinitionId: 'tax-o7' }] } as any),
      /cannot retain a Tax Code/,
    );
  });

  // RA-18: without this the reviewer's ภ.ง.ด.3/53 choice would be accepted and dropped.
  it('forwards the payee taxpayer class to the repository, and only when sent', async () => {
    const picked = makeUseCase();
    await picked.useCase.execute(ctx, 'exp-1', { vendorEntityKindSnapshot: 'INDIVIDUAL' } as any);
    assert.equal(picked.updates[0].vendorEntityKindSnapshot, 'INDIVIDUAL');

    const untouched = makeUseCase();
    await untouched.useCase.execute(ctx, 'exp-1', { vendorDocumentNumber: 'INV-2' } as any);
    assert.equal('vendorEntityKindSnapshot' in untouched.updates[0], false);
  });

  // The substitute-receipt panel now saves its in-progress reason through this path; before the
  // pass-through the PATCH accepted the field in its contract and silently discarded it.
  it('forwards the missing receipt reason, clears it when blanked, and only when sent', async () => {
    const saved = makeUseCase();
    await saved.useCase.execute(ctx, 'exp-1', { missingReceiptReason: ' ร้านไม่ออกใบเสร็จ ' } as any);
    assert.equal(saved.updates[0].missingReceiptReason, 'ร้านไม่ออกใบเสร็จ');

    const cleared = makeUseCase();
    await cleared.useCase.execute(ctx, 'exp-1', { missingReceiptReason: '   ' } as any);
    assert.equal(cleared.updates[0].missingReceiptReason, null, 'blank clears the substitute path, it must not store an empty string');

    const untouched = makeUseCase();
    await untouched.useCase.execute(ctx, 'exp-1', { vendorDocumentNumber: 'INV-2' } as any);
    assert.equal('missingReceiptReason' in untouched.updates[0], false);
  });

  // Same dropped-field class as the reason above: accepted by the contract, never written.
  it('forwards the received date, due date, and internal memo, and only when sent', async () => {
    const sent = makeUseCase();
    await sent.useCase.execute(ctx, 'exp-1', { receivedAt: '2026-08-01', dueDate: '2026-08-31', internalMemo: 'รอบิลตัวจริงจากผู้ขาย' } as any);
    assert.deepEqual(sent.updates[0].receivedAt, new Date('2026-08-01'));
    assert.deepEqual(sent.updates[0].dueDate, new Date('2026-08-31'));
    assert.equal(sent.updates[0].internalMemo, 'รอบิลตัวจริงจากผู้ขาย');

    const cleared = makeUseCase();
    await cleared.useCase.execute(ctx, 'exp-1', { dueDate: '' } as any);
    assert.equal(cleared.updates[0].dueDate, null, 'blank clears the due date, it must not persist an Invalid Date');

    const untouched = makeUseCase();
    await untouched.useCase.execute(ctx, 'exp-1', { vendorDocumentNumber: 'INV-2' } as any);
    assert.equal('receivedAt' in untouched.updates[0], false);
    assert.equal('dueDate' in untouched.updates[0], false);
    assert.equal('internalMemo' in untouched.updates[0], false);
  });

  it('leaves the stored VAT mode untouched when the reviewer does not send one', async () => {
    const { useCase, updates, upserted } = makeUseCase({ taxEvidenceStatus: 'SUPPORTING_ONLY' });

    await useCase.execute(ctx, 'exp-1', { lines: [receiptLine] } as any);

    assert.equal('vatMode' in updates[0], false, 'no vatMode write means the stored VAT_EXCLUDED survives');
    assert.equal(updates[0].inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.ok(Math.abs(Number(upserted[0].vatAmount) - 37.94) < 0.01, 'totals still use the stored VAT_EXCLUDED mode');
  });
});

// The confirm gate used to clear on any reviewer save (`reviewedAt >= aiVerifiedAt`), so unrelated
// writes — a substitute-receipt draft save, a classification override — silently accepted an amount
// that disagreed with the receipt. Acceptance is now explicit and bound to the accepted figure.
describe('UpdateExpenseDraftUseCase OCR total acknowledgement', () => {
  const mismatched = { aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' }, grandTotalAmount: '1177.00' };
  const acknowledgement = { acknowledged: true, acknowledgedTotalAmount: '1177.00', reason: 'ใบเสร็จระบุ 1,177 บาท AI อ่านยอดก่อนหักส่วนลด' };

  it('records the acknowledgement against the accepted figure', async () => {
    const { useCase, updates } = makeUseCase(mismatched);

    await useCase.execute(ctx, 'exp-1', { ocrTotalAcknowledgement: acknowledgement } as any);

    const resolution = updates[0].aiVerificationSummaryJson.totalMismatchResolution;
    assert.equal(resolution.acknowledged, true);
    assert.equal(resolution.acknowledgedTotalAmount, '1177.00');
    assert.equal(resolution.resolvedByUserId, 'user-1');
    assert.equal(resolution.reason, 'ใบเสร็จระบุ 1,177 บาท AI อ่านยอดก่อนหักส่วนลด');
  });

  it('rejects an acknowledgement of a figure the expense no longer carries', async () => {
    const { useCase } = makeUseCase(mismatched);
    await assert.rejects(
      () => useCase.execute(ctx, 'exp-1', { ocrTotalAcknowledgement: { ...acknowledgement, acknowledgedTotalAmount: '1150.00' } } as any),
      /no longer matches this expense/,
    );
  });

  it('rejects an acknowledgement with no difference to accept, and one with no reason', async () => {
    const agreeing = makeUseCase({ aiVerifiedFieldsJson: { grandTotalAmount: '1177.00' }, grandTotalAmount: '1177.00' });
    await assert.rejects(
      () => agreeing.useCase.execute(ctx, 'exp-1', { ocrTotalAcknowledgement: { ...acknowledgement } } as any),
      /No OCR grand total difference to acknowledge/,
    );

    const unexplained = makeUseCase(mismatched);
    await assert.rejects(
      () => unexplained.useCase.execute(ctx, 'exp-1', { ocrTotalAcknowledgement: { ...acknowledgement, reason: '   ' } } as any),
      /reason is required/,
    );
  });

  it('binds to the total this patch leaves behind, not the one it started with', async () => {
    // Reviewer edits the lines to 580 and accepts that figure in the same call.
    const { useCase, updates } = makeUseCase({ aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' }, grandTotalAmount: '1177.00' });

    await useCase.execute(ctx, 'exp-1', {
      lines: [receiptLine],
      ocrTotalAcknowledgement: { ...acknowledgement, acknowledgedTotalAmount: '580.00' },
    } as any);

    assert.equal(updates[0].aiVerificationSummaryJson.totalMismatchResolution.acknowledgedTotalAmount, updates[0].grandTotalAmount);
  });

  it('needs expense.review, not merely expense.update', async () => {
    const { useCase } = makeUseCase(mismatched);
    const owner = { ...ctx, permissions: ['expense.update'] };
    await assert.rejects(
      () => useCase.execute(owner, 'exp-1', { ocrTotalAcknowledgement: acknowledgement } as any),
      /expense.review for OCR total acknowledgement/,
    );
  });
});
