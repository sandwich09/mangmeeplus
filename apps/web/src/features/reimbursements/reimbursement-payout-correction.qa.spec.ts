import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS, isReimbursementPayoutCorrectionReason,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  PAYOUT_CORRECTION_REASONS, emptyPayoutCorrectionForm, payoutCorrectionAccountText, payoutCorrectionCardNote, payoutCorrectionFormError,
  payoutCorrectionInput, payoutCorrectionReasonText, payoutCorrectionRequestError, payoutCorrectionRequestInput, payoutCorrectionSendBackNotes,
  payoutCorrectionSentBackText, type PayoutCorrectionForm,
} from './reimbursement-payout.logic';

/*
 * Payout spec §14 on the web (plan task 3.10, and the web side of 3.11 to 3.13): a claim that waits for payment
 * with a wrong payout account is sent back, its requester gives the account again, and its approvers approve
 * that account alone, on the same claim and number. Who may do which is the server's answer; these tests hold
 * the page to it, and to plain Thai.
 */

const KBANK = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', version: 1 };
const SCB = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountLast4: '1112', version: 2 };

describe('sending a claim back for its payout account: what the form asks and sends', () => {
  it('lists the six fixed reasons in the API\'s own words and order, and prints no code for a reason it does not know', () => {
    assert.deepEqual(PAYOUT_CORRECTION_REASONS.map(([, label]) => label),
      ['เลขบัญชีไม่ถูกต้อง', 'ชื่อบัญชีไม่ตรงกับผู้เบิก', 'ธนาคารไม่ถูกต้อง', 'บัญชีปิดหรือโอนไม่ได้', 'ผู้เบิกขอเปลี่ยนบัญชี', 'อื่น ๆ']);
    assert.deepEqual(PAYOUT_CORRECTION_REASONS.map(([code]) => code), Object.keys(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS));
    for (const [code, label] of PAYOUT_CORRECTION_REASONS) {
      assert.equal(isReimbursementPayoutCorrectionReason(code), true);
      assert.equal(payoutCorrectionReasonText(code), label);
    }
    for (const unknown of ['A_REASON_ADDED_LATER', '', undefined, null, 7]) assert.equal(payoutCorrectionReasonText(unknown), '');
  });

  it('refuses, before asking the API and in the API\'s own sentences, no reason, a note over 500 characters and a note with an account number', () => {
    assert.equal(payoutCorrectionRequestError('', ''), 'กรุณาเลือกเหตุผลที่ส่งกลับให้แก้บัญชีรับเงิน');
    assert.equal(payoutCorrectionRequestError('A_REASON_ADDED_LATER', ''), translateApiError('payout_correction_reason_required'));
    assert.equal(REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, 500);
    assert.equal(payoutCorrectionRequestError('OTHER', 'ก'.repeat(501)), 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร');
    assert.equal(payoutCorrectionRequestError('OTHER', `  ${'ก'.repeat(500)}  `), null, 'the note is trimmed, as the API trims it');
    for (const note of ['โอนเข้า 004-5-67123-4 ไม่ได้', 'เลข 0045671234', 'เบอร์ 081 234 5678']) {
      assert.equal(payoutCorrectionRequestError('ACCOUNT_NUMBER_WRONG', note), translateApiError('note_contains_account_number'), note);
    }
    // The note is optional for every reason, อื่น ๆ included, and a document number or an amount in it is no account number.
    for (const [code] of PAYOUT_CORRECTION_REASONS) assert.equal(payoutCorrectionRequestError(code, ''), null, code);
    assert.equal(payoutCorrectionRequestError('ACCOUNT_UNUSABLE', 'ธนาคารแจ้งว่าไม่พบบัญชีนี้ ใบ RB-202610-00007 ยอด 1614 บาท'), null);
    // Each of the three is a sentence: a label that went missing would let the form send what the API refuses.
    for (const code of ['payout_correction_reason_required', 'payout_correction_note_too_long', 'note_contains_account_number']) assert.ok(translateApiError(code), code);
  });

  it('sends the reason with the trimmed note, and no note at all when none was typed', () => {
    assert.deepEqual(payoutCorrectionRequestInput('ACCOUNT_NUMBER_WRONG', '  ธนาคารแจ้งว่าไม่พบบัญชีนี้ '), { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' });
    assert.deepEqual(payoutCorrectionRequestInput('REQUESTER_ASKED', '   '), { reasonCode: 'REQUESTER_ASKED' });
  });

  it('says who sent it back and why in one sentence, without a name or a reason it does not have', () => {
    assert.equal(payoutCorrectionSentBackText({ byName: 'วราภรณ์ การเงิน', reasonCode: 'ACCOUNT_NUMBER_WRONG' }), 'ส่งกลับให้แก้บัญชีรับเงินโดย วราภรณ์ การเงิน : เลขบัญชีไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ reasonCode: 'BANK_WRONG' }), 'ส่งกลับให้แก้บัญชีรับเงิน : ธนาคารไม่ถูกต้อง');
    assert.equal(payoutCorrectionSentBackText({ byName: 'สมศรี ผู้จัดการ', reasonCode: 'A_REASON_ADDED_LATER' }), 'ส่งกลับให้แก้บัญชีรับเงินโดย สมศรี ผู้จัดการ');
    assert.equal(payoutCorrectionSentBackText(undefined), 'ส่งกลับให้แก้บัญชีรับเงิน');
  });
});

describe('what whoever sends a claim back is told before they confirm (spec §14.1, §14.4)', () => {
  const ready = { payout: KBANK, signatures: [], signedCopies: [] };

  it('says what changes and what does not, and how the claim comes back to the pay step', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes(ready), [
      'ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      'เมื่อผู้เบิกแก้แล้ว ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่ก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที',
    ]);
  });

  // Plan 3.13 and the task's item 7: what is signed is signed on the account in question, and the server removes it at the send-back.
  it('says plainly that signatures in the system are removed and a paper-signed copy stops counting, only where the claim has them', () => {
    const signed = payoutCorrectionSendBackNotes({ ...ready, signatures: [{ role: 'REQUESTER' }, { role: 'APPROVER' }] });
    assert.ok(signed.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(signed.some((note) => note.includes('สำเนา')), false, 'no declared copy on this claim');
    const paper = payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{ acknowledgedAt: '2026-10-01T05:00:00.000Z' }, {}] });
    assert.ok(paper.includes('สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(paper.some((note) => note.includes('ลายเซ็นในระบบ')), false);
    // A file attached without the declaration signed nothing, so nothing is said to be lost.
    assert.equal(payoutCorrectionSendBackNotes({ ...ready, signedCopies: [{}] }).length, 2);
  });

  it('tells a claim sent before claims carried an account that it will get one, and still what happens to its signatures', () => {
    const legacy = payoutCorrectionSendBackNotes({ payout: undefined, signatures: [{ role: 'REQUESTER' }], signedCopies: [] });
    assert.ok(legacy.includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ หลังส่งกลับ ผู้เบิกจะระบุบัญชีรับเงินของใบนี้ได้'));
    assert.ok(legacy.includes('ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่หลังบัญชีใหม่ได้รับอนุมัติ'));
    assert.equal(payoutCorrectionSendBackNotes(ready).some((note) => note.includes('ส่งก่อนมีช่องบัญชีรับเงิน')), false);
  });

  it('says, from the round\'s waiting step, that the claim goes back once more and is not rejected', () => {
    assert.deepEqual(payoutCorrectionSendBackNotes({ ...ready, payoutCorrectionPhase: 'AWAITING_APPROVAL', payout: SCB }),
      ['ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงินอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน']);
  });
});

describe('giving the account of a claim in a round: what the form asks and sends', () => {
  const form = (overrides: Partial<PayoutCorrectionForm> = {}): PayoutCorrectionForm => ({ ...emptyPayoutCorrectionForm(), ...overrides });
  const typed = { payoutKind: 'BANK_ACCOUNT' as const, bankChoice: 'ธนาคารไทยพาณิชย์', bankOther: '', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' };

  it('starts with nothing chosen and asks for a choice: the account in question may be the requester\'s default', () => {
    assert.equal(emptyPayoutCorrectionForm().mode, '');
    assert.deepEqual(payoutCorrectionFormError(form()), { text: 'กรุณาเลือกวิธีรับเงินคืนของใบนี้' });
    assert.equal(payoutCorrectionInput(form(), 'token', true), null);
  });

  it('holds a typed account to the API\'s own format rule and names the field', () => {
    assert.deepEqual(payoutCorrectionFormError(form({ mode: 'SPECIFIED' })), { field: 'bankName', text: 'กรุณาเลือกธนาคาร' });
    assert.equal(payoutCorrectionFormError(form({ mode: 'SPECIFIED', account: { ...typed, accountNumber: '12345' } }))?.field, 'accountNumber');
    assert.equal(payoutCorrectionFormError(form({ mode: 'SPECIFIED', account: typed })), null);
    assert.equal(payoutCorrectionFormError(form({ mode: 'CASH' })), null);
    assert.equal(payoutCorrectionFormError(form({ mode: 'DEFAULT' })), null);
  });

  it('sends cash, the default the page showed by its token, or the typed account as it was typed', () => {
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'CASH' }), undefined, false), { mode: 'CASH' });
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'DEFAULT' }), 'a1b2c3', false), { mode: 'DEFAULT', defaultToken: 'a1b2c3' });
    // No default was shown: nothing is sent that would take an account nobody saw.
    assert.equal(payoutCorrectionInput(form({ mode: 'DEFAULT' }), undefined, true), null);
    assert.deepEqual(payoutCorrectionInput(form({ mode: 'SPECIFIED', account: typed }), 'a1b2c3', true),
      { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '111-2-33444-1112' });
  });

  it('sends "save as the default account" only when it was ticked and the server allows it for this viewer', () => {
    const ticked = form({ mode: 'SPECIFIED', account: typed, saveAsDefault: true });
    assert.equal((payoutCorrectionInput(ticked, undefined, true) as { saveAsDefault?: boolean }).saveAsDefault, true);
    assert.equal('saveAsDefault' in payoutCorrectionInput(ticked, undefined, false)!, false);
    assert.equal('saveAsDefault' in payoutCorrectionInput({ ...ticked, saveAsDefault: false }, undefined, true)!, false);
    // A tick left over from a typed account is never sent with another choice.
    assert.deepEqual(payoutCorrectionInput({ ...ticked, mode: 'CASH' }, undefined, true), { mode: 'CASH' });
  });
});

describe('an account of a round in words, masked', () => {
  it('names the bank, the last 4 digits and the account name, cash as cash, and a claim that had no account as such', () => {
    assert.equal(payoutCorrectionAccountText(KBANK), 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี');
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'BANK_TRANSFER', payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678' }),
      'พร้อมเพย์เบอร์ลงท้าย 5678 · ชื่อบัญชี นาย สมชาย ใจดี');
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'CASH' }), 'รับเป็นเงินสด');
    // The method alone, when the account behind it could not be read.
    assert.equal(payoutCorrectionAccountText({ payoutMethod: 'BANK_TRANSFER' }), 'โอนเข้าบัญชี');
    for (const none of [undefined, null, {}]) assert.equal(payoutCorrectionAccountText(none as never), 'ไม่มีบัญชีในใบ');
  });

  it('tells the reader of the card "การรับเงินคืน" which account they are looking at while the claim is in a round', () => {
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_REQUESTER', payout: KBANK }),
      'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือวิธีรับเงินเดิมของใบ ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_REQUESTER' }), 'ใบนี้ถูกส่งกลับให้ระบุบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้');
    assert.equal(payoutCorrectionCardNote({ payoutCorrectionPhase: 'AWAITING_APPROVAL', payout: SCB }), 'ด้านล่างคือวิธีรับเงินใหม่ที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้');
    assert.equal(payoutCorrectionCardNote({ payout: SCB }), null);
  });
});
