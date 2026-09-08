import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPENSE_CALCULATED_ROUNDING_SOURCE, type RequestContext, type UpdateExpenseDraftInput } from '@watchdog-bms/contracts';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';

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

test('fuel preview uses exact save arithmetic, ignores edited adjustment and performs zero writes', async () => {
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

test('changed quantity, price, added service and deletion remove obsolete auto adjustment; draft remains saveable', async () => {
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

test('printed rounding is preserved separately with VAT plus independent WHT', async () => {
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

test('mixed VAT with source amount preserves exempt goods and has no synthesized rounding', async () => {
  const { useCase, input } = setup([{ ...product, quantity: '1', unitPrice: '239', vatRate: '0' },
    { ...product, id: 'line-2', lineNumber: 2, description: 'Taxed', quantity: '1', unitPrice: '161' }]);
  input.vatSource = { inputType: 'AMOUNT', vatAmount: '10.53' };
  const preview = await useCase.execute(ctx, 'expense-1', input, { previewOnly: true });
  assert.equal(preview.grandTotalAmount, '400.0000'); assert.equal(preview.vatAmount, '10.5300');
  assert.equal(preview.calculatedAdjustmentAmount, '0.0000');
});

test('preview rejects stale, unauthorized, other-tenant, foreign row and invalid amounts without writes', async () => {
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
