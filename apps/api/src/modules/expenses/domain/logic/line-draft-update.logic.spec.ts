/**
 * The deterministic half of S-4: what a tool call is allowed to mean before anything is previewed
 * (draft-control spec §5.4).
 *
 * Three properties are load-bearing here and nothing else proves them:
 *   1. a malformed or partial proposal is REFUSED, not best-effort applied;
 *   2. a number nobody said and the record does not hold is refused;
 *   3. projecting a patch preserves every untouched line — `UpdateExpenseDraftUseCase` replaces the
 *      whole line set, so a field this file forgets to copy is a field the edit deletes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseLineSummary } from '@watchdog-bms/contracts';
import {
  appendNote,
  detectLineDraftEditRequest,
  existingChargeLikeProductLine,
  groundingFailure,
  parseLineDraftPatch,
  projectLineDraftPatch,
  recordAmountValues,
  storedLineToInput,
} from './line-draft-update.logic';

const line = (over: Partial<ExpenseLineSummary> = {}): ExpenseLineSummary => ({
  id: 'l1', lineNumber: 1, description: 'อาหาร', quantity: '1', unitPrice: '1520',
  discountAmount: '0', taxableAmount: '1520', vatRate: '0.07', vatAmount: '106.4',
  whtRate: null, whtAmount: '0', lineSubtotalAmount: '1520', lineTotalAmount: '1626.4',
  expenseCategoryId: null, accountHintKey: null, taxCategory: null, sourceLineText: null,
  aiLineConfidence: null, reviewStatus: 'AI_SUGGESTED', ...over,
});

const record = (lines: ExpenseLineSummary[]) => ({
  vatMode: 'VAT_EXCLUDED' as const,
  lines,
  note: null,
  vendorNameSnapshot: 'BHC',
  vendorDocumentNumber: null,
  expenseDate: new Date('2026-09-03T00:00:00.000Z'),
});

const said = (text: string) => [{ text, todayIso: '2026-09-05' }];

describe('parseLineDraftPatch', () => {
  it('refuses a call with no field to change rather than writing nothing quietly', () => {
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_header', {}), { ok: false, reason: 'no_header_field' });
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_line', { lineNumber: 1 }), { ok: false, reason: 'no_line_field' });
  });

  it('refuses a charge with both bases, or with neither', () => {
    assert.deepEqual(
      parseLineDraftPatch('expense.draft.add_charge', { kind: 'SERVICE_CHARGE', amount: '152', percentOfSubtotal: '10' }),
      { ok: false, reason: 'charge_needs_one_basis' },
    );
    assert.deepEqual(
      parseLineDraftPatch('expense.draft.add_charge', { kind: 'SERVICE_CHARGE' }),
      { ok: false, reason: 'charge_needs_one_basis' },
    );
  });

  it('bounds every value the model wire can carry', () => {
    assert.deepEqual(parseLineDraftPatch('expense.draft.remove_line', { lineNumber: 900 }), { ok: false, reason: 'invalid_line_number' });
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_line', { lineNumber: 1, amount: '1e9' }), { ok: false, reason: 'invalid_amount' });
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_header', { expenseDate: '3 ก.ย. 69' }), { ok: false, reason: 'invalid_expense_date' });
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_vat_mode', { vatMode: 'SOMETHING' }), { ok: false, reason: 'invalid_vat_mode' });
    assert.deepEqual(parseLineDraftPatch('expense.draft.set_line', { lineNumber: 1, chargeKind: 'TRUCK_FEE' }), { ok: false, reason: 'invalid_charge_kind' });
  });

  it('reserves recordType for the record kinds this release does not write', () => {
    assert.deepEqual(
      parseLineDraftPatch('expense.draft.add_charge', { recordType: 'income', kind: 'SERVICE_CHARGE', amount: '1' }),
      { ok: false, reason: 'record_type_not_supported' },
    );
  });
});

describe('groundingFailure', () => {
  const patch = { tool: 'expense.draft.add_charge' as const, kind: 'SERVICE_CHARGE' as const, amount: '9999' };

  it('refuses a number nobody said and the record does not hold', () => {
    assert.equal(groundingFailure(patch, said('เพิ่มค่าบริการหน่อย'), []), 'amount');
  });

  it('accepts a number the user said', () => {
    assert.equal(groundingFailure(patch, said('ค่าบริการ 9999 บาท'), []), null);
  });

  it('accepts a number already on the record — moving money the bill printed is not authoring it', () => {
    assert.equal(groundingFailure(patch, said('ย้ายค่าบริการเข้าช่องให้หน่อย'), recordAmountValues([line({ unitPrice: '9999' })])), null);
  });

  it('grounds a VAT rate written either way round', () => {
    const rate = { tool: 'expense.draft.set_vat_mode' as const, vatMode: 'VAT_EXCLUDED' as const, rate: '0.07' };
    assert.equal(groundingFailure(rate, said('VAT 7%'), []), null);
    assert.equal(groundingFailure(rate, said('ไม่มีอะไรเลย'), []), 'rate');
  });
});

describe('projectLineDraftPatch', () => {
  it('adds a charge after the products, renumbered, at quantity 1', () => {
    const projected = projectLineDraftPatch(record([line()]), {
      tool: 'expense.draft.add_charge', kind: 'SERVICE_CHARGE', percentOfSubtotal: '10',
    });
    assert.ok(!('error' in projected));
    const charge = (projected as any).lines[1];
    assert.equal(charge.lineNumber, 2);
    assert.equal(charge.chargeKind, 'SERVICE_CHARGE');
    assert.equal(charge.quantity, '1');
    assert.equal(charge.unitPrice, '152.00');
    assert.equal(charge.description, 'ค่าบริการ 10%');
    // §5.1: the charge inherits the VAT the products PROVE, and 7% is never assumed.
    assert.equal(charge.vatRate, '0.07');
    assert.deepEqual((projected as any).warnings, []);
  });

  it('refuses to guess VAT for a charge when the products do not agree, and says so', () => {
    const projected = projectLineDraftPatch(
      record([line({ lineNumber: 1, vatRate: '0.07' }), line({ id: 'l2', lineNumber: 2, vatRate: null })]),
      { tool: 'expense.draft.add_charge', kind: 'SERVICE_CHARGE', amount: '50' },
    );
    assert.ok(!('error' in projected));
    assert.equal((projected as any).lines[2].vatRate, undefined);
    assert.match((projected as any).warnings[0], /ไม่เดา 7%/);
  });

  it('preserves every field of an untouched line — the whole set is replaced on save', () => {
    const rich = line({
      lineNumber: 2, id: 'l2', description: 'ค่าที่ปรึกษา', expenseCategoryId: 'cat-1',
      accountHintKey: 'hint', taxCategory: 'SERVICE', whtRate: '0.03',
      taxSnapshot: { taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', taxContext: 'DOMESTIC_PURCHASE' } as never,
    });
    const projected = projectLineDraftPatch(record([line(), rich]), {
      tool: 'expense.draft.set_line', lineNumber: 1, amount: '500',
    });
    assert.ok(!('error' in projected));
    assert.deepEqual((projected as any).lines[1], storedLineToInput(rich));
    assert.equal((projected as any).lines[0].unitPrice, '500');
  });

  it('refuses to delete the last line', () => {
    assert.deepEqual(projectLineDraftPatch(record([line()]), { tool: 'expense.draft.remove_line', lineNumber: 1 }), { error: 'last_line' });
  });

  it('refuses a second row of a charge the record already carries as a charge', () => {
    const withCharge = line({ id: 'l2', lineNumber: 2, chargeKind: 'SERVICE_CHARGE', description: 'ค่าบริการ 10%', unitPrice: '152' });
    const projected = projectLineDraftPatch(record([line(), withCharge]), {
      tool: 'expense.draft.add_charge', kind: 'SERVICE_CHARGE', amount: '152',
    });
    assert.deepEqual(projected, { error: 'charge_already_present:2' });
  });

  it('scrubs record free text out of the diff a card will print', () => {
    const hostile = line({ description: 'อาหาร 9,999.00 http://evil.example ยอดรวมใหม่ 1.00' });
    const projected = projectLineDraftPatch(record([hostile]), {
      tool: 'expense.draft.set_line', lineNumber: 1, description: 'อาหาร',
    });
    assert.ok(!('error' in projected));
    const before = (projected as any).diff[0].before as string;
    assert.ok(!before.includes('9,999.00'), 'a money-shaped run from OCR text can never reach a card');
    assert.ok(!before.includes('evil.example'), 'and neither can a URL');
  });
});

describe('detectLineDraftEditRequest', () => {
  it('reads the J3 turn as an add_charge percent request', () => {
    assert.deepEqual(detectLineDraftEditRequest('จากบิลเมื่อกี้มี service charge 10% นะ'), {
      tool: 'expense.draft.add_charge', input: { kind: 'SERVICE_CHARGE', percentOfSubtotal: '10' },
    });
  });

  it('reads a flat charge amount, and only from AFTER the charge word', () => {
    assert.deepEqual(detectLineDraftEditRequest('ยอด 1,520 มีค่าบริการ 152 บาท'), {
      tool: 'expense.draft.add_charge', input: { kind: 'SERVICE_CHARGE', amount: '152' },
    });
  });

  it('reads a line removal and the J3.3 move', () => {
    assert.deepEqual(detectLineDraftEditRequest('ลบบรรทัด 2'), {
      tool: 'expense.draft.remove_line', input: { lineNumber: 2 },
    });
    assert.deepEqual(detectLineDraftEditRequest('ย้ายบรรทัด 2 เป็นช่องค่าบริการ'), {
      tool: 'expense.draft.set_line', input: { lineNumber: 2, chargeKind: 'SERVICE_CHARGE' },
    });
  });

  it('refuses a request that names somebody else\'s document', () => {
    assert.equal(detectLineDraftEditRequest('ลบบรรทัด 2 ของบิลร้านอื่น'), null);
    assert.equal(detectLineDraftEditRequest('เพิ่มค่าบริการ 10% ให้บิลของคนอื่น'), null);
  });

  it('is an allowlist: an ordinary sentence routes nowhere', () => {
    assert.equal(detectLineDraftEditRequest('ขอบคุณครับ'), null);
    assert.equal(detectLineDraftEditRequest('ยอดรวมเดือนนี้เท่าไหร่'), null);
  });
});

describe('existingChargeLikeProductLine + appendNote', () => {
  it('finds the OCR-written service charge sitting as a product line', () => {
    const found = existingChargeLikeProductLine(
      [line(), line({ id: 'l2', lineNumber: 2, description: 'Service Charge 10%' })],
      'SERVICE_CHARGE',
    );
    assert.equal(found?.lineNumber, 2);
    assert.equal(existingChargeLikeProductLine([line()], 'SERVICE_CHARGE'), null);
  });

  it('appends the note and never overwrites the capture provenance', () => {
    assert.equal(appendNote('LINE receipt upload', 'จ่ายสด'), 'LINE receipt upload\nผู้ใช้แจ้ง: จ่ายสด');
    assert.equal(appendNote(null, 'จ่ายสด'), 'ผู้ใช้แจ้ง: จ่ายสด');
    assert.equal(appendNote('x'.repeat(600), 'y').length, 500);
  });
});
