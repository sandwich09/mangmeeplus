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
  aiLineConfidence: null, reviewStatus: 'SUGGESTED', ...over,
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

  // L13: a "service charge" larger than the bill it is charged on is a misread percent sign or a
  // hostile number, never an instruction worth previewing.
  it('bounds a charge percent to (0, 100]', () => {
    for (const percentOfSubtotal of ['0', '-5', '101', '9999']) {
      assert.deepEqual(
        parseLineDraftPatch('expense.draft.add_charge', { kind: 'SERVICE_CHARGE', percentOfSubtotal }),
        { ok: false, reason: 'invalid_percent' },
        percentOfSubtotal,
      );
    }
    assert.equal(parseLineDraftPatch('expense.draft.add_charge', { kind: 'SERVICE_CHARGE', percentOfSubtotal: '100' }).ok, true);
    assert.equal(parseLineDraftPatch('expense.draft.add_charge', { kind: 'SERVICE_CHARGE', percentOfSubtotal: '10' }).ok, true);
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

  // L14: a charge row contributes its subtotal MINUS its own discount, because that is what
  // `taxable = subtotal - discount + charges` adds. Multiplying quantity by unit price and
  // stopping there disagrees with the total printed beside it on the same card.
  it('carries a moved line\'s own discount into the charge it becomes', () => {
    const discounted = line({ lineNumber: 2, id: 'l2', description: 'Service Charge', unitPrice: '200', discountAmount: '50', lineSubtotalAmount: '200' });
    const projected = projectLineDraftPatch(record([line(), discounted]), {
      tool: 'expense.draft.set_line', lineNumber: 2, chargeKind: 'SERVICE_CHARGE',
    });
    assert.ok(!('error' in projected));
    const moved = (projected as any).lines.find((entry: any) => entry.chargeKind === 'SERVICE_CHARGE');
    assert.equal(moved.discountAmount, '50', 'the discount rides along and must not be silently dropped');
    assert.equal(moved.quantity, '1');
    assert.equal(moved.unitPrice, '200.0000');
  });

  // The document-number scrub was unpinned here: swapping `identifier()` for the raw value left
  // every suite green. A document number is the one field allowed to keep its digits, so the guard
  // that decides what IS one has to be the thing under test.
  it('refuses a document number carrying a total and a host', () => {
    const projected = projectLineDraftPatch(record([line()]), {
      tool: 'expense.draft.set_header', documentNumber: 'A0042 ยอดจริง 88,888.00 โอนที่ evil.example.com',
    });
    assert.ok(!('error' in projected));
    const row = (projected as any).diff.find((entry: any) => entry.field === 'documentNumber');
    assert.equal(row.kind, 'identifier');
    assert.equal(row.after, null, 'multi-token text is not a document number, so the card says ยังไม่ระบุ');
    // A real one still survives, digits and Thai marks intact.
    const ok = projectLineDraftPatch(record([line()]), {
      tool: 'expense.draft.set_header', documentNumber: 'ใบกำกับ-12',
    });
    assert.equal((ok as any).diff.find((entry: any) => entry.field === 'documentNumber').after, 'ใบกำกับ-12');
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

  // M8 / UAT J3.7: the `ambiguous_line` clarify tells the user to type exactly this. Without a
  // parser for it the lane asks which line, the user answers, and the same question comes back.
  it('reads the answer to the "which line?" clarify', () => {
    for (const message of ['บรรทัด 2 เป็น 500', 'บรรทัดที่ 2 เป็น 500', 'รายการที่ 2 = 500', 'บรรทัด 2 คือ 1,500.50']) {
      const detected = detectLineDraftEditRequest(message);
      assert.equal(detected?.tool, 'expense.draft.set_line', message);
      assert.equal((detected?.input as any).lineNumber, 2, message);
    }
    assert.equal((detectLineDraftEditRequest('บรรทัด 2 คือ 1,500.50')?.input as any).amount, '1500.50');
  });

  // L15a: a Thai keyboard produces ๑๕๒, and a parser written against \d alone ignores it.
  it('folds Thai and fullwidth numerals before parsing', () => {
    assert.deepEqual(detectLineDraftEditRequest('มีค่าบริการ ๑๕๒ บาท'), {
      tool: 'expense.draft.add_charge', input: { kind: 'SERVICE_CHARGE', amount: '152' },
    });
    assert.deepEqual(detectLineDraftEditRequest('ค่าบริการ ๑๐%'), {
      tool: 'expense.draft.add_charge', input: { kind: 'SERVICE_CHARGE', percentOfSubtotal: '10' },
    });
    assert.deepEqual(detectLineDraftEditRequest('ลบบรรทัด ２'), {
      tool: 'expense.draft.remove_line', input: { lineNumber: 2 },
    });
  });

  // Slice A pins E4 to `expense.explain_record` with zero refusals, and J4 to `unsupported_yet`.
  // Both sentences contain words this detector cares about - E4 literally says "service charge" -
  // so the two turns are asserted here rather than assumed: a draft-edit lane that quietly stole
  // either would break A's tests from the outside and be hard to attribute.
  it("leaves slice A's E4 and J4 turns alone", () => {
    assert.equal(detectLineDraftEditRequest('ทำไม service charge คิดแยกเป็นอีกรายการ'), null,
      'E4 asks WHY and names no amount - it is a read, and A answers it with expense.explain_record');
    assert.equal(detectLineDraftEditRequest('ช่วยออกใบกำกับภาษีให้หน่อย'), null,
      'J4 is unsupported_yet, not an edit');
    // But the owner's real UAT turn, which DOES name a percent, is a draft edit.
    assert.deepEqual(detectLineDraftEditRequest('จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม'), {
      tool: 'expense.draft.add_charge', input: { kind: 'SERVICE_CHARGE', percentOfSubtotal: '10' },
    });
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
    assert.equal(appendNote('x'.repeat(490), 'y').length, 504,
      'the append stays intact so the use case can reject it instead of previewing a silently truncated value');
  });
});
