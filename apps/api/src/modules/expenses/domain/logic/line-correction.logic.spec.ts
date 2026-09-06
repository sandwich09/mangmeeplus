import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendUserNote, canCorrectAmount, evaluateCorrectionHints, withPurposeNote, type CorrectionEvidence, type CorrectionTargetSnapshot } from './line-correction.logic';
import { LINE_CORRECTION_FIELDS } from '@watchdog-bms/contracts';

const TODAY = '2026-08-03';
const target: CorrectionTargetSnapshot = {
  expenseDate: '2026-06-17T00:00:00.000Z',
  grandTotalAmount: '59.0000',
  vendorNameSnapshot: 'ร้านเดิม',
  vendorDocumentNumber: '291326',
  note: 'บิลเงินสด',
};
const evidence = (text: string, todayIso = TODAY): CorrectionEvidence[] => [{ text, todayIso }];

describe('LINE correction guards', () => {
  it('applies a date the message grounds, recording what it replaces', () => {
    const outcome = evaluateCorrectionHints(
      { expenseDate: { to: '2026-07-20' } },
      target,
      evidence('วันที่ออกสารผิดนะ ต้องเป็นวันที่ 20 กรกฎาคม 2569'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'applicable');
    assert.deepEqual(outcome.status === 'applicable' ? outcome.fields.expenseDate : null, { from: '2026-06-17T00:00:00.000Z', to: '2026-07-20' });
  });

  it('grounds a value from the clarification this turn answered, not just the latest message', () => {
    // "แก้ยอดเป็น 590" → clarify which record → "รายการที่ 2": the amount lives in turn one.
    const outcome = evaluateCorrectionHints(
      { amount: { to: '590' } },
      target,
      [{ text: 'รายการที่ 2', todayIso: TODAY }, { text: 'แก้ยอดเป็น 590', todayIso: TODAY }],
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'applicable');
  });

  it('refuses a value the evidence never contained', () => {
    const outcome = evaluateCorrectionHints(
      { amount: { to: '9999' } },
      target,
      evidence('แก้ยอดเป็น 590'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'guidance');
    assert.match(outcome.status === 'guidance' ? outcome.reason : '', /ungrounded_value:amount/);
  });

  it('never writes back the old value when the message names both', () => {
    const both = evidence('เลขเดิม 291326 แก้เป็น 456789');

    // Correct direction stated → applies the new one.
    const forward = evaluateCorrectionHints({ documentNumber: { to: '456789', from: '291326' } }, target, both, LINE_CORRECTION_FIELDS);
    assert.equal(forward.status, 'applicable');
    assert.deepEqual(forward.status === 'applicable' ? forward.fields.documentNumber : null, { from: '291326', to: '456789' });

    // Reversed direction claims the record currently holds 456789 — it does not.
    const backward = evaluateCorrectionHints({ documentNumber: { to: '291326', from: '456789' } }, target, both, LINE_CORRECTION_FIELDS);
    assert.equal(backward.status, 'guidance');
    assert.match(backward.status === 'guidance' ? backward.reason : '', /stale_from:documentNumber/);
  });

  it('asks when two readings compete and the message never says which is being replaced', () => {
    const outcome = evaluateCorrectionHints(
      { amount: { to: '590' } },
      target,
      evidence('ยอด 59 ไม่ใช่ 590'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'clarify');
    assert.equal(outcome.status === 'clarify' ? outcome.field : null, 'amount');
  });

  it('treats a formatting difference as the same value, not a stale one', () => {
    const outcome = evaluateCorrectionHints(
      { amount: { to: '590', from: '59' } },
      target,
      evidence('ยอดเดิม 59 แก้เป็น 590'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'applicable', '59 must match the stored 59.0000');
  });

  it('does nothing when the record already holds the requested value', () => {
    const outcome = evaluateCorrectionHints(
      { documentNumber: { to: '291326' } },
      target,
      evidence('เลขที่ 291326'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'guidance');
    assert.match(outcome.status === 'guidance' ? outcome.reason : '', /already_current/);
  });

  it('aborts the whole turn when one field of several fails', () => {
    const outcome = evaluateCorrectionHints(
      { expenseDate: { to: '2026-07-20' }, vendorName: { to: 'ร้านที่ไม่มีในข้อความ' } },
      target,
      evidence('วันที่ต้องเป็น 20 กรกฎาคม 2569'),
      LINE_CORRECTION_FIELDS,
    );

    assert.equal(outcome.status, 'guidance', 'a partial apply would leave a state nobody asked for');
  });

  it('ignores fields outside the allowlist handed in by the caller', () => {
    const outcome = evaluateCorrectionHints(
      { amount: { to: '590' } },
      target,
      evidence('แก้ยอดเป็น 590'),
      ['expenseDate', 'vendorName'],
    );

    assert.equal(outcome.status, 'guidance');
    assert.match(outcome.status === 'guidance' ? outcome.reason : '', /no_correctable_field/);
  });
});

describe('amount correctability', () => {
  it('allows the single trivial line a text note creates', () => {
    assert.equal(canCorrectAmount({ sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ vatAmount: '0', whtAmount: '0' }] }), true);
    assert.equal(canCorrectAmount({ sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [] }), true);
  });

  it('refuses anything whose lines carry itemisation or tax the write would erase', () => {
    assert.equal(canCorrectAmount({ sourceDocumentType: 'RECEIPT', lines: [{ vatAmount: '0' }] }), false);
    assert.equal(canCorrectAmount({ sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ vatAmount: '0' }, { vatAmount: '0' }] }), false);
    assert.equal(canCorrectAmount({ sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ vatAmount: '7.00' }] }), false);
    assert.equal(canCorrectAmount({ sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ taxCodeDefinitionId: 'tax-i7' }] }), false);
  });

  // Expense spec §5.1: the lane rewrites its single line as a PRODUCT row, so letting it run on a
  // record whose one line is a charge would reclassify a service charge as goods and move it out
  // of the charge total — off the back of a chat message that only mentioned the amount.
  it('refuses a record whose single line is an additional charge', () => {
    for (const chargeKind of ['SERVICE_CHARGE', 'DELIVERY', 'ROUNDING', 'OTHER']) {
      assert.equal(canCorrectAmount({
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ chargeKind, vatAmount: '0', whtAmount: '0' }],
      }), false, chargeKind);
    }
    // An explicit null is still an ordinary product line, exactly as before.
    assert.equal(canCorrectAmount({
      sourceDocumentType: 'EXPENSE_NOTE_TEXT', lines: [{ chargeKind: null, vatAmount: '0', whtAmount: '0' }],
    }), true);
  });
});

/**
 * Spec `line-ai-draft-control-spec-th.md` §5.3. Two writers share the header note and they want
 * opposite things: a correction ADDS what the user said, while the draft conversation is COLLECTING
 * one field over several turns and must replace its own previous answer. Both used to overwrite the
 * whole column, taking the `'LINE receipt upload'` provenance — the only record that the draft came
 * from a photo in a chat — with it.
 */
describe('the header note keeps its provenance under both writers', () => {
  const PROVENANCE = 'LINE receipt upload';

  it('appends what the user said after the provenance', () => {
    const result = appendUserNote(PROVENANCE, 'มี service charge 10%');
    assert.deepEqual(result, { outcome: 'appended', note: `${PROVENANCE} · ผู้ใช้แจ้ง: มี service charge 10%` });
  });

  it('gives the collected purpose its own segment, behind the provenance', () => {
    assert.equal(withPurposeNote(PROVENANCE, 'เลี้ยงลูกค้า'), `${PROVENANCE} · วัตถุประสงค์: เลี้ยงลูกค้า`);
  });

  it('replaces the previous purpose when the user refines the answer, instead of stacking', () => {
    const first = withPurposeNote(PROVENANCE, 'เลี้ยงลูกค้า');
    const second = withPurposeNote(first, 'เลี้ยงลูกค้า บริษัท ก');

    assert.equal(second, `${PROVENANCE} · วัตถุประสงค์: เลี้ยงลูกค้า บริษัท ก`);
    assert.equal(second.split('วัตถุประสงค์:').length - 1, 1, 'exactly one purpose segment, however many times it is answered');
    assert.ok(second.startsWith(PROVENANCE), 'and the provenance is still the first thing anyone reads');
  });

  it('leaves a correction the user typed alone when the purpose is answered afterwards', () => {
    const corrected = appendUserNote(PROVENANCE, 'ร้าน BHC');
    assert.equal(corrected.outcome, 'appended');
    const withPurpose = withPurposeNote(corrected.note, 'เลี้ยงลูกค้า');

    assert.equal(withPurpose, `${PROVENANCE} · ผู้ใช้แจ้ง: ร้าน BHC · วัตถุประสงค์: เลี้ยงลูกค้า`);
  });

  it('starts a note from nothing without inventing a separator', () => {
    assert.equal(withPurposeNote(null, 'เลี้ยงลูกค้า'), 'วัตถุประสงค์: เลี้ยงลูกค้า');
    assert.equal(withPurposeNote('   ', 'เลี้ยงลูกค้า'), 'วัตถุประสงค์: เลี้ยงลูกค้า');
  });

  it('stays inside the column cap however long the conversation runs', () => {
    assert.ok(withPurposeNote(PROVENANCE.padEnd(495, '!'), 'เลี้ยงลูกค้าอย่างยาวมาก').length <= 500);
  });
});
