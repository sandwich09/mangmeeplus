import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reimbursementPaymentSlipRequired } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  buildClaimTimeline, buildJourneySteps, activeJourneyStep, canAttachPaymentSlip, isLostPaymentRace, opensPaymentFormOnArrival, paymentSaveErrorMessage,
  chosenPaymentSlipChoice, paymentSlipChoices, paymentSlipCount, queueRowOffersPayment, quickPayTarget, savePaymentForm, signedCopyMoveConfirmText,
  slipTargetPayment, validatePaymentForm, type PaymentFormSession, type PaymentFormSlip, type PaymentSlipChoice,
} from './reimbursements.logic';
import { PAYMENT_METHOD_LABELS } from './reimbursements.model';

const here = dirname(fileURLToPath(import.meta.url));
const sourceOf = (...path: string[]) => readFileSync(join(here, ...path), 'utf8');

// Owner decisions 2026-10-01 for the payment step: the payer chooses the method (nothing is
// pre-selected), a bank transfer is recorded with its slip, and the slip is opened by a fixed group.

const METHODS = Object.keys(PAYMENT_METHOD_LABELS);
const ok = { paidAmount: '500', outstandingAmount: '500', paymentMethod: 'CASH' };

describe('payment form rules', () => {
  it('has no method to fall back on: the payer must choose one', () => {
    assert.equal(validatePaymentForm({ ...ok, paymentMethod: '' }), 'กรุณาเลือกวิธีจ่าย');
    // Asked first, so a form opened and submitted untouched says what is missing, not something about amounts.
    assert.equal(validatePaymentForm({ paidAmount: '', outstandingAmount: '500', paymentMethod: '' }), 'กรุณาเลือกวิธีจ่าย');
    for (const paymentMethod of ['CASH', 'OTHER']) assert.equal(validatePaymentForm({ ...ok, paymentMethod }), null, paymentMethod);
  });

  it('requires a slip for a transfer, in the same words the API answers with', () => {
    const transfer = { ...ok, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1' };
    assert.equal(validatePaymentForm(transfer), 'จ่ายด้วยการโอนต้องแนบสลิป');
    assert.equal(validatePaymentForm(transfer), translateApiError('payment_slip_required'));
    assert.equal(validatePaymentForm({ ...transfer, hasSlip: false }), 'จ่ายด้วยการโอนต้องแนบสลิป');
    assert.equal(validatePaymentForm({ ...transfer, hasSlip: true }), null);
    // The reference is asked before the slip, as the API does.
    assert.equal(validatePaymentForm({ ...ok, paymentMethod: 'BANK_TRANSFER' }), 'ต้องระบุเลขอ้างอิงสำหรับการโอนเงิน/เช็ค');
  });

  it('leaves the slip optional for every other method', () => {
    for (const [paymentMethod, paymentReference] of [['CASH', undefined], ['CHEQUE', 'CHQ-1'], ['OTHER', undefined]] as const) {
      assert.equal(validatePaymentForm({ ...ok, paymentMethod, paymentReference }), null, `${paymentMethod} without a slip`);
      assert.equal(validatePaymentForm({ ...ok, paymentMethod, paymentReference, hasSlip: true }), null, `${paymentMethod} with a slip`);
    }
  });

  // The form and the API ask one shared function, so they refuse exactly the same payments.
  it('refuses a slipless payment exactly when the API rule does, for every method the form offers', () => {
    assert.deepEqual(METHODS, ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']);
    for (const paymentMethod of METHODS) {
      for (const hasSlip of [false, true]) {
        const refused = validatePaymentForm({ ...ok, paymentMethod, paymentReference: 'REF-1', hasSlip }) !== null;
        assert.equal(refused, reimbursementPaymentSlipRequired(paymentMethod) && !hasSlip, `${paymentMethod} hasSlip=${hasSlip}`);
      }
    }
  });

  /** A refusal as the API client throws it: the code is the message, with the HTTP status beside it. */
  const refused = (code: string, status: number) => Object.assign(new Error(code), { status });

  it('never tells a payer who has transferred the money to transfer it again', () => {
    assert.equal(
      paymentSaveErrorMessage('slip-upload', refused('payment_slip_invalid', 422), false),
      'อัปโหลดสลิปไม่สำเร็จ ระบบยังไม่ได้บันทึกจ่าย · ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพ ขนาดไม่เกิน 10 MB แล้วลองใหม่',
    );
    const afterSlip = paymentSaveErrorMessage('record', refused('payment_reference_required', 422), true);
    assert.equal(afterSlip, 'แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · ต้องระบุเลขอ้างอิงสำหรับการโอนเงิน/เช็ค · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่');
    assert.equal(paymentSaveErrorMessage('record', refused('partial_payment_not_allowed', 422), false), 'ยังบันทึกจ่ายไม่สำเร็จ · ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น');
    // A connection that dropped: the slip is in, and the next press is the same payment.
    assert.match(paymentSaveErrorMessage('record', new Error('Failed to fetch'), true), /^แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · .+ · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่$/);
    // "บันทึกจ่ายเรียบร้อย" is never part of a failure message.
    for (const text of [afterSlip, paymentSaveErrorMessage('slip-upload', new Error('x'), false)]) assert.doesNotMatch(text, /เรียบร้อย|สำเร็จแล้ว/);
  });

  // Review finding: after a lost race the form said "load the list again" and "press save again" in
  // one breath. Reloading throws away the uploaded slip and the form's key, the two things that make
  // the next press the same payment.
  it('gives one thing to do after a lost race: press save again', () => {
    const lostRace = refused('reimbursement_payment_state_changed', 409);
    assert.equal(isLostPaymentRace(lostRace), true);
    assert.equal(isLostPaymentRace(Object.assign(new Error('API error 409'), { status: 409, code: 'reimbursement_payment_state_changed' })), true);
    for (const other of [refused('payout_destination_changed', 409), refused('reimbursement_payment_already_recorded', 409), new Error('Failed to fetch'), null, 'reimbursement_payment_state_changed']) {
      assert.equal(isLostPaymentRace(other), false);
    }
    for (const slipKept of [true, false]) {
      const text = paymentSaveErrorMessage('record', lostRace, slipKept);
      assert.equal(text, 'ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน กดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่');
      assert.doesNotMatch(text, /โหลด|เปิดใบใหม่|เรียบร้อย/);
    }
    // The page's own banner is the only message: the request raises no second, generic one beside it.
    assert.match(sourceOf('reimbursements.api.ts'), /\/payments`, \{ method: 'POST', body: JSON\.stringify\(body\), suppressErrorToast: true \}\)/);
  });

  // Any other conflict means the claim is not what this page shows. Its own sentence says to open the
  // claim again, and nothing beside it says to press save on this page.
  it('does not ask for another press when the claim itself changed', () => {
    for (const [code, said] of [
      ['payout_destination_changed', 'บัญชีรับเงินของใบนี้เปลี่ยนไปจากที่แสดงไว้ กรุณาเปิดใบใหม่ ตรวจบัญชีที่แสดงล่าสุด แล้วทำรายการอีกครั้ง'],
      ['reimbursement_payment_idempotency_conflict', 'มีการบันทึกการจ่ายด้วยข้อมูลอื่นไปแล้ว กรุณาโหลดรายการใหม่แล้วตรวจสอบ'],
    ] as const) {
      for (const slipKept of [true, false]) {
        const text = paymentSaveErrorMessage('record', refused(code, 409), slipKept);
        assert.equal(text, `ยังบันทึกจ่ายไม่สำเร็จ · ${said}`);
        assert.doesNotMatch(text, /กดบันทึกจ่ายอีกครั้ง|เรียบร้อย/);
      }
    }
  });
});

const approver = 'user-approver';
const requester = 'user-requester';
const slip = (attachmentId: string) => ({ attachmentId, attachedAt: '2026-09-29T03:00:00.000Z' });
const recorded = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-2', paymentNo: 'RBPAY-202609-00002', status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-2',
  paidAmount: '500.0000', currency: 'THB', paidAt: '2026-09-29T03:00:00.000Z', paidByUserId: approver, paidByName: 'สมชาย', slips: [slip('att-slip-2')], ...overrides,
});
const voided = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1', paymentNo: 'RBPAY-202609-00001', status: 'VOIDED', paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1',
  paidAmount: '500.0000', currency: 'THB', paidAt: '2026-09-28T03:00:00.000Z', paidByUserId: approver, paidByName: 'สมชาย',
  voidReason: 'บันทึกเลขอ้างอิงผิด', slips: [slip('att-slip-1')], ...overrides,
});
const claim = (overrides: Record<string, unknown> = {}) => ({
  id: 'rb-1', requestNo: 'RB-202609-00007', requesterUserId: requester, branchId: 'branch-1', status: 'PAID', paymentStatus: 'PAID',
  financeReviewStatus: 'NOT_REQUIRED', financeReviewRequired: false, amount: '500.0000', outstandingAmount: '0.0000', currency: 'THB',
  submittedAt: '2026-09-27T03:00:00.000Z', approvedAt: '2026-09-27T05:00:00.000Z', claimFormLayout: 'TWO_SIGNERS',
  approvalSteps: [{ id: 'step-1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: approver, decidedByName: 'สมชาย', decidedAt: '2026-09-27T05:00:00.000Z' }],
  payments: [recorded()], signatures: [], signedCopies: [], lines: [], duplicateCandidates: [], ...overrides,
});
const declaredCopy = { attachmentId: 'att-copy', fileName: 'สลิปโอนเงิน.jpg', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z', acknowledgedByName: 'สมชาย' };

describe('files already on the claim that can be the slip', () => {
  it('lists the slips of voided payments and the files in ใบเบิกที่เซ็นแล้ว, once each, in plain words', () => {
    const detail = claim({
      status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID',
      payments: [voided(), voided({ id: 'pay-0', paymentNo: 'RBPAY-202609-00000', slips: [slip('att-slip-1'), slip('att-slip-0')] })],
      signedCopies: [declaredCopy],
    });
    const WAS_A_SLIP = 'เคยเป็นสลิปของการจ่ายที่ยกเลิกไปแล้ว ใช้กับการจ่ายครั้งนี้ได้ถ้าเป็นการโอนรายการเดียวกัน';
    assert.deepEqual(paymentSlipChoices(detail), [
      { attachmentId: 'att-slip-1', kind: 'previous-slip', paymentId: 'pay-1', label: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00001', what: WAS_A_SLIP },
      { attachmentId: 'att-slip-0', kind: 'previous-slip', paymentId: 'pay-0', label: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00000 (ไฟล์ที่ 2)', what: WAS_A_SLIP },
      { attachmentId: 'att-copy', kind: 'signed-copy', fileName: 'สลิปโอนเงิน.jpg', label: 'สลิปโอนเงิน.jpg',
        what: 'ไฟล์รูปภาพ · แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่ลงนามครบ' },
    ]);
    // A standing payment's slip is not offered again, and a queue row (no attachments at all) offers nothing.
    assert.deepEqual(paymentSlipChoices(claim()), []);
    assert.deepEqual(paymentSlipChoices({ id: 'rb-1', outstandingAmount: '500.0000' }), []);
  });

  // Upgrade test 2026-10-02: the signed PDF was listed before the e-slip, by a name and nothing else, and was picked as the slip.
  it('lists the pictures among the signed copies before their PDFs, and says of each file what it is on this claim', () => {
    const signedForm = { attachmentId: 'att-form', fileName: 'signed-form-2.pdf', uploadedAt: '2026-09-29T06:00:00.000Z', acknowledgedAt: '2026-09-29T06:00:00.000Z', acknowledgedByName: 'สมชาย' };
    const eslip = { attachmentId: 'att-eslip', fileName: 'eslip-2.JPG', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z', acknowledgedByName: 'สมชาย' };
    const plain = { attachmentId: 'att-plain', fileName: 'หลักฐาน.png', uploadedAt: '2026-09-29T04:00:00.000Z' };
    const before = { attachmentId: 'att-before', fileName: 'ใบเบิกเก่า.pdf', uploadedAt: '2026-09-29T03:00:00.000Z', beforePayoutCorrection: true as const };
    // The API lists them newest first: the signed form on top. The picker puts the pictures first, each group still newest first.
    const choices = paymentSlipChoices(claim({ status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', payments: [], signedCopies: [signedForm, eslip, plain, before] }));
    assert.deepEqual(choices.map((choice) => [choice.label, choice.what]), [
      ['eslip-2.JPG', 'ไฟล์รูปภาพ · แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่ลงนามครบ'],
      ['หลักฐาน.png', 'ไฟล์รูปภาพ · แนบไว้ที่ใบเบิกที่เซ็นแล้ว เป็นไฟล์แนบทั่วไป'],
      ['signed-form-2.pdf', 'ไฟล์ PDF · แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่ลงนามครบ'],
      ['ใบเบิกเก่า.pdf', 'ไฟล์ PDF · แนบไว้ที่ใบเบิกที่เซ็นแล้ว เป็นสำเนาก่อนแก้บัญชีรับเงิน'],
    ]);
    // What the page needs to open each before it is chosen: the file's own name, or the payment a slip belongs to.
    assert.deepEqual(choices.map((choice) => choice.fileName), ['eslip-2.JPG', 'หลักฐาน.png', 'signed-form-2.pdf', 'ใบเบิกเก่า.pdf']);
    assert.equal(paymentSlipChoices(claim({ payments: [voided()], signedCopies: [] }))[0]!.paymentId, 'pay-1');
  });

  it('lets a payment-record holder add slips to a recorded payment only, five at most', () => {
    const payer = ['reimbursement.payment.record'];
    assert.equal(canAttachPaymentSlip(recorded(), payer), true);
    assert.equal(canAttachPaymentSlip(recorded({ slips: undefined }), payer), true, 'a payment recorded before slips existed');
    assert.equal(canAttachPaymentSlip(recorded(), ['reimbursement.finance_review']), false);
    assert.equal(canAttachPaymentSlip(voided(), payer), false, 'a voided payment keeps its slips and takes no more');
    assert.equal(canAttachPaymentSlip(recorded({ slips: [1, 2, 3, 4, 5].map((n) => slip(`att-${n}`)) }), payer), false);
  });

  it('counts slips from the API\'s own count, which a reader gets even when the files are not listed for them', () => {
    // Someone who may not open slips: the payment says how many there are and names none.
    assert.equal(paymentSlipCount(recorded({ slipCount: 2, slips: [] })), 2);
    assert.equal(paymentSlipCount(recorded({ slipCount: 0, slips: [] })), 0);
    // A detail from before the count existed still reads off the list.
    assert.equal(paymentSlipCount(recorded()), 1);
    assert.equal(paymentSlipCount(recorded({ slips: undefined })), 0);
    assert.equal(paymentSlipCount(undefined), 0);
    // The five-file limit follows the count, not the list.
    assert.equal(canAttachPaymentSlip(recorded({ slipCount: 5, slips: [] }), ['reimbursement.payment.record']), false);
    assert.equal(canAttachPaymentSlip(recorded({ slipCount: 4, slips: [] }), ['reimbursement.payment.record']), true);
  });

  // Review S2: moving a file out of ใบเบิกที่เซ็นแล้ว withdraws a "signed on paper" declaration, so it is
  // offered only where it is the fix: the standing payment has no slip. Adding another slip to a
  // payment that has one is done from the payment row, by uploading it.
  it('offers the move to the standing payment only while that payment has no slip', () => {
    const payer = ['reimbursement.payment.record'];
    const without = recorded({ slips: [], slipCount: 0 });
    assert.equal(slipTargetPayment(claim({ payments: [voided(), without] }), payer)?.id, 'pay-2');
    assert.equal(slipTargetPayment(claim({ payments: [recorded({ slips: undefined })] }), payer)?.id, 'pay-2', 'a payment recorded before slips existed');
    // It already carries its slip: no move is offered, though the payment still takes more slips by upload.
    assert.equal(slipTargetPayment(claim({ payments: [voided(), recorded()] }), payer), undefined);
    assert.equal(canAttachPaymentSlip(recorded(), payer), true);
    assert.equal(slipTargetPayment(claim({ payments: [recorded({ slipCount: 1, slips: [] })] }), payer), undefined, 'by the count, not the list');
    // The slip of a voided payment does not stand in for the standing payment's own.
    assert.equal(slipTargetPayment(claim({ payments: [voided(), without] }), payer)?.id, 'pay-2');
    assert.equal(slipTargetPayment(claim({ payments: [voided()] }), payer), undefined, 'nothing to move a file to before a payment stands');
    assert.equal(slipTargetPayment(claim({ payments: [without] }), ['reimbursement.read']), undefined, 'only someone who may record payments');
    assert.equal(slipTargetPayment(claim({ payments: [] }), payer), undefined);
    // The section offers the action from this one answer.
    assert.match(sourceOf('ReimbursementDetailSections.tsx'), /const slipTarget = slipTargetPayment\(detail, permissions\);[\s\S]*?\{slipTarget && \([\s\S]*?onUseSignedCopyAsSlip\(copy, slipTarget\)/);
  });

  it('says what moving a file out of ใบเบิกที่เซ็นแล้ว will do, and mentions a declaration only when one was made', () => {
    const declared = signedCopyMoveConfirmText(declaredCopy, recorded());
    assert.match(declared, /^ไฟล์ สลิปโอนเงิน\.jpg จะย้ายจากรายการใบเบิกที่เซ็นแล้ว ไปเป็นสลิปของการจ่าย RBPAY-202609-00002 โดยไม่ต้องอัปโหลดใหม่ และย้ายกลับไม่ได้ /);
    assert.match(declared, /ระบบจะถอนการยืนยันนั้น ใบเบิกจะไม่นับว่าลงนามบนกระดาษจากไฟล์นี้อีก/);
    assert.match(declared, /เปิดดูได้เฉพาะผู้เบิก ผู้อนุมัติของใบนี้ ผู้ที่บันทึกจ่ายได้ และผู้ตรวจการเงิน$/);
    const archived = signedCopyMoveConfirmText({ fileName: 'scan.pdf' }, recorded());
    assert.doesNotMatch(archived, /ถอนการยืนยัน/);
    // Either way the file does not come back: both are told so before they confirm.
    assert.match(archived, /และย้ายกลับไม่ได้ /);
  });
});

const owner = ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.payment.void'];
const documentStep = (detail: any, userId = approver) => {
  const steps = buildJourneySteps(detail, owner, userId);
  return { active: activeJourneyStep(steps), document: steps.find((step) => step.key === 'document')! };
};

// The API recomputes `documentSignedVia` once the misfiled file leaves the signed copies (see the API
// spec "moving a misfiled slip recomputes how the document was signed"). These are the two claims it
// names, as the detail looks before and after, read the way the claim page and the journey step read it.
describe('a misfiled slip moved to the payment: the page and the journey agree', () => {
  it('a claim whose only paper proof was that file goes back to waiting for signatures', () => {
    const before = claim({ payments: [recorded({ slips: [] })], signedCopies: [declaredCopy], documentSignedVia: 'PAPER' });
    assert.equal(documentStep(before).document.state, 'done');
    assert.match(documentStep(before).document.note ?? '', /^ลงนามบนกระดาษ/);

    const after = claim({ payments: [recorded({ slips: [slip('att-copy')] })], signedCopies: [], documentSignedVia: null });
    const { active, document } = documentStep(after);
    assert.equal(document.state, 'current');
    assert.equal(active?.key, 'document');
    assert.doesNotMatch(document.note ?? '', /ลงนามบนกระดาษ|ลงนามในระบบครบแล้ว/);
    assert.ok(document.actions.includes('sign'), 'the approver is asked to sign again, in the system or on paper');
    assert.ok(document.actions.includes('attach-signed-copy'));
    // Still paid: moving the file changes the document step and nothing about the money.
    assert.equal(buildClaimTimeline(after).at(-1)?.state, 'done');
    assert.deepEqual(paymentSlipChoices(after), [], 'the file is no longer a candidate: it is the slip');
  });

  it('a claim that also had both digital signatures stays done, now signed in the system', () => {
    const signatures = [{ role: 'REQUESTER', signedByName: 'พิม' }, { role: 'APPROVER', signedByName: 'สมชาย' }];
    const before = claim({ payments: [recorded({ slips: [] })], signedCopies: [declaredCopy], signatures, documentSignedVia: 'BOTH' });
    assert.match(documentStep(before).document.note ?? '', /^ลงนามบนกระดาษ/);

    const after = claim({ payments: [recorded({ slips: [slip('att-copy')] })], signedCopies: [], signatures, documentSignedVia: 'DIGITAL' });
    const { document } = documentStep(after);
    assert.equal(document.state, 'done');
    assert.match(document.note ?? '', /^ลงนามในระบบ/);
    assert.doesNotMatch(document.note ?? '', /กระดาษ/);
  });
});

describe('void, then pay again', () => {
  const payer = 'user-payer';
  it('returns the claim to the payment step with the old slip still on the voided record', () => {
    const afterVoid = claim({ status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', outstandingAmount: '500.0000', payments: [voided()], currentDesk: { kind: 'PAYMENT' } });
    const steps = buildJourneySteps(afterVoid, owner, payer);
    const active = activeJourneyStep(steps);
    assert.equal(active?.key, 'payment');
    assert.ok(active?.actions.includes('pay'));
    assert.equal(buildClaimTimeline(afterVoid).at(-1)?.state, 'current', 'the timeline waits for a payment again');
    assert.deepEqual(afterVoid.payments[0]!.slips.map((row: any) => row.attachmentId), ['att-slip-1']);
    // The earlier slip is offered, but a transfer is refused until a slip is actually named.
    assert.deepEqual(paymentSlipChoices(afterVoid).map((choice) => choice.attachmentId), ['att-slip-1']);
    assert.equal(validatePaymentForm({ paidAmount: '500', outstandingAmount: '500', paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-2' }), 'จ่ายด้วยการโอนต้องแนบสลิป');
  });

  it('shows the new payment on the timeline and the journey, and keeps both records apart', () => {
    const repaid = claim({ payments: [voided(), recorded()] });
    const timeline = buildClaimTimeline(repaid).at(-1)!;
    // The row is the standing payment's: its payer and its date, not the voided one's.
    assert.deepEqual([timeline.state, timeline.date], ['done', '2026-09-29T03:00:00.000Z']);
    assert.match(timeline.label, /^จ่ายแล้ว/);
    assert.equal(activeJourneyStep(buildJourneySteps(repaid, owner, payer))?.key, 'document');
    assert.deepEqual(repaid.payments.map((row: any) => [row.status, row.paymentReference, row.slips.map((s: any) => s.attachmentId)]), [
      ['VOIDED', 'TXN-1', ['att-slip-1']],
      ['RECORDED', 'TXN-2', ['att-slip-2']],
    ]);
  });
});

// Review S3: what one press of บันทึกจ่าย does, in order, and what a second press and a retry do.
describe('saving the payment form', () => {
  const transferForm = { paidAmount: '500', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-10-01', paymentReference: 'TXN-9' };
  const picked = (name = 'slip.jpg'): PaymentFormSlip => ({ file: { name } as File });

  /** The form's world: what was sent, in order, and the slip the form holds after each press. */
  function form(options: { uploadFails?: boolean; recordFailures?: number; slip?: PaymentFormSlip | null; form?: typeof transferForm; slipChoices?: PaymentSlipChoice[] } = {}) {
    const calls: unknown[][] = [];
    const busy: boolean[] = [];
    const session: PaymentFormSession = { idempotencyKey: null, saving: false };
    let slip: PaymentFormSlip | null = options.slip === undefined ? picked() : options.slip;
    let recordFailures = options.recordFailures ?? 0;
    let keys = 0;
    let release: (() => void) | undefined;
    const press = () => savePaymentForm({ form: options.form ?? transferForm, outstandingAmount: '500', slip, session, ...(options.slipChoices && { slipChoices: options.slipChoices }) }, {
      uploadSlip: async (file) => {
        calls.push(['upload', file.name]);
        if (release === undefined && held) await new Promise<void>((resolve) => { release = resolve; });
        if (options.uploadFails) throw Object.assign(new Error('API error 503'), { code: 'payment_slip_invalid' });
        return 'att-uploaded';
      },
      recordPayment: async (body) => {
        calls.push(['record', body]);
        if (recordFailures > 0) { recordFailures -= 1; throw Object.assign(new Error('API error 409'), { code: 'reimbursement_payment_state_changed' }); }
        return {};
      },
      onSlipUploaded: (uploaded) => { slip = uploaded; },
      newIdempotencyKey: () => `key-${++keys}`,
      onBusy: (value) => busy.push(value),
    });
    let held = false;
    return {
      press, calls, busy, session,
      slip: () => slip,
      /** The next upload does not finish until `finishUpload()` is called. */
      holdUpload: () => { held = true; },
      finishUpload: () => release?.(),
    };
  }

  it('uploads the picked slip, then records the payment with it and one key', async () => {
    const h = form();
    assert.deepEqual(await h.press(), { status: 'saved' });
    assert.deepEqual(h.calls, [
      ['upload', 'slip.jpg'],
      ['record', { paidAmount: '500', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-10-01T00:00:00.000Z', paymentReference: 'TXN-9', slipAttachmentId: 'att-uploaded', idempotencyKey: 'key-1' }],
    ]);
    assert.deepEqual(h.busy, [true, false]);
    assert.equal(h.session.saving, false);
  });

  it('records with a file already on the claim, or with no slip for cash, without uploading anything', async () => {
    const existing = form({ slip: { attachmentId: 'att-slip-1', name: 'สลิปของการจ่ายที่ยกเลิกแล้ว' } });
    assert.deepEqual(await existing.press(), { status: 'saved' });
    assert.deepEqual(existing.calls.map(([kind, body]: any[]) => [kind, body.slipAttachmentId]), [['record', 'att-slip-1']]);

    const cash = form({ slip: null, form: { ...transferForm, paymentMethod: 'CASH', paymentReference: '' } });
    assert.deepEqual(await cash.press(), { status: 'saved' });
    const [, body] = cash.calls[0] as [string, Record<string, unknown>];
    assert.deepEqual([body['slipAttachmentId'], body['paymentReference'], body['paymentMethod']], [undefined, undefined, 'CASH']);
  });

  // The signed form picked as the slip (upgrade test 2026-10-02). The API refuses a declared copy without the payer's
  // confirmation; the form sends it for a signed copy chosen from its list, which is exactly when it shows the note
  // that the file moves out of ใบเบิกที่เซ็นแล้ว and cannot be moved back, and for nothing else.
  it('confirms the withdrawal with the payment for a signed copy chosen from the list, and for no other slip', async () => {
    const slipChoices = paymentSlipChoices(claim({ payments: [voided()], signedCopies: [declaredCopy, { attachmentId: 'att-scan', fileName: 'scan.pdf' }] }));
    assert.deepEqual(slipChoices.map((choice) => [choice.attachmentId, choice.kind]), [['att-slip-1', 'previous-slip'], ['att-copy', 'signed-copy'], ['att-scan', 'signed-copy']]);
    const sent = async (slip: PaymentFormSlip, choices: PaymentSlipChoice[] | undefined = slipChoices) => {
      const h = form({ slip, ...(choices && { slipChoices: choices }) });
      assert.deepEqual(await h.press(), { status: 'saved' });
      const [, body] = h.calls.at(-1) as [string, Record<string, unknown>];
      return [body['slipAttachmentId'], body['confirmSignedCopyWithdrawal']];
    };
    assert.deepEqual(await sent({ attachmentId: 'att-copy', name: 'สลิปโอนเงิน.jpg' }), ['att-copy', true], 'a declared copy');
    assert.deepEqual(await sent({ attachmentId: 'att-scan', name: 'scan.pdf' }), ['att-scan', true], 'an archive copy: the same note was shown');
    assert.deepEqual(await sent({ attachmentId: 'att-slip-1', name: 'สลิปของการจ่ายที่ยกเลิกแล้ว' }), ['att-slip-1', undefined], 'the slip of a voided payment moves nothing');
    assert.deepEqual(await sent(picked()), ['att-uploaded', undefined], 'a new upload');
    assert.deepEqual(await sent({ attachmentId: 'att-uploaded', name: 'slip.jpg' }), ['att-uploaded', undefined], 'an upload kept after a failed save');

    // The note and the confirmation read one answer: the listed file the form holds.
    for (const choice of slipChoices) {
      assert.equal(chosenPaymentSlipChoice({ attachmentId: choice.attachmentId, name: choice.label }, slipChoices), choice);
    }
    assert.equal(chosenPaymentSlipChoice(picked(), slipChoices), undefined);
    assert.equal(chosenPaymentSlipChoice(null, slipChoices), undefined);
    const formSource = sourceOf('ReimbursementDetailSections.tsx');
    assert.match(formSource, /const attached = paymentSlipChoices\(request\);[\s\S]*?const chosen = chosenPaymentSlipChoice\(slip, attached\);/);
    assert.match(formSource, /\{chosen\?\.kind === 'signed-copy' && \(\s*<p [^>]*data-testid="reimbursement-payment-slip-move-note">[\s\S]*?ย้ายกลับไม่ได้/);
  });

  it('sends nothing for a form that is not ready, and says what is missing', async () => {
    for (const [label, h, text] of [
      ['no method chosen', form({ form: { ...transferForm, paymentMethod: '' } }), 'กรุณาเลือกวิธีจ่าย'],
      ['a transfer without a slip', form({ slip: null }), 'จ่ายด้วยการโอนต้องแนบสลิป'],
    ] as const) {
      assert.deepEqual(await h.press(), { status: 'refused', text }, label);
      assert.deepEqual(h.calls, [], label);
      assert.deepEqual(h.busy, [], `${label}: never shown as sending`);
      assert.equal(h.session.idempotencyKey, null, label);
    }
  });

  it('keeps the uploaded slip when recording fails: the retry sends it again with the same key and uploads nothing', async () => {
    const h = form({ recordFailures: 1 });
    const failed = await h.press();
    assert.equal(failed.status, 'refused');
    // The slip is in, the payment is not: the message says so and does not ask for a new slip or a new transfer.
    assert.equal((failed as { text: string }).text, 'ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน กดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่');
    assert.deepEqual(h.slip(), { attachmentId: 'att-uploaded', name: 'slip.jpg' }, 'the form now holds the uploaded slip, not the file');

    assert.deepEqual(await h.press(), { status: 'saved' });
    assert.deepEqual(h.calls.map(([kind]) => kind), ['upload', 'record', 'record'], 'one upload for two attempts');
    const bodies = h.calls.filter(([kind]) => kind === 'record').map(([, body]) => body as Record<string, unknown>);
    assert.deepEqual(bodies.map((body) => [body['slipAttachmentId'], body['idempotencyKey']]), [['att-uploaded', 'key-1'], ['att-uploaded', 'key-1']],
      'the same slip and the same key: to the API this is the same payment, not a second one');
    assert.deepEqual(h.busy, [true, false, true, false]);
  });

  it('records nothing when the slip upload fails, and says the payment was not saved', async () => {
    const h = form({ uploadFails: true });
    const failed = await h.press();
    assert.equal(failed.status, 'refused');
    assert.match((failed as { text: string }).text, /^อัปโหลดสลิปไม่สำเร็จ ระบบยังไม่ได้บันทึกจ่าย · /);
    assert.deepEqual(h.calls.map(([kind]) => kind), ['upload']);
    assert.equal(h.session.idempotencyKey, null, 'no payment was attempted, so no key is spent');
    assert.deepEqual(h.slip(), picked(), 'the picked file is still in the form to try again');
    assert.equal(h.session.saving, false, 'the form is free for the next press');
  });

  it('does nothing on a second press while the first is still running: one upload, one payment', async () => {
    const h = form();
    h.holdUpload();
    const first = h.press();
    // The first press is in the middle of its upload when the button is pressed again, twice.
    assert.deepEqual(await h.press(), { status: 'ignored' });
    assert.deepEqual(await h.press(), { status: 'ignored' });
    assert.deepEqual(h.calls.map(([kind]) => kind), ['upload']);
    h.finishUpload();
    assert.deepEqual(await first, { status: 'saved' });
    assert.deepEqual(h.calls.map(([kind]) => kind), ['upload', 'record']);
    assert.deepEqual(h.busy, [true, false], 'the ignored presses never touch the busy flag');
  });

  it('is what the payment form runs, with a session that lives as long as the opened form', () => {
    const source = sourceOf('ReimbursementDetailSections.tsx');
    assert.match(source, /const session = useRef<PaymentFormSession>\(\{ idempotencyKey: null, saving: false \}\)/);
    // With the list the form shows: the save confirms the withdrawal for a signed copy chosen from it, and for nothing else.
    assert.match(source, /await savePaymentForm\(\{ form, outstandingAmount: String\(request\.outstandingAmount\), slip, slipChoices: attached, session: session\.current, payout, payer \}/);
    assert.match(source, /onSlipUploaded: setSlip/);
    assert.match(source, /if \(result\.status === 'saved'\) \{ onDone\(\); toast\.success\('บันทึกจ่ายเรียบร้อยแล้ว'\); \}/);
  });
});

// Spec §12.2, §21 (impact audit M13): the payment form is never a dialog on a phone.
describe('quick pay from the finance queue', () => {
  // Review finding: the dialog was decided by width alone (640 px), while the queue lays itself out
  // as a phone, in cards, up to 768 px. The press now says which layout it came from.
  it('opens the claim page\'s payment step from the phone cards, and the dialog from the table', () => {
    assert.deepEqual(quickPayTarget('cards', 'co-1', 'rb-1'), { kind: 'page', href: '/companies/co-1/reimbursements/rb-1?pay=1' });
    assert.deepEqual(quickPayTarget('table', 'co-1', 'rb-1'), { kind: 'dialog' });
    const hub = sourceOf('ReimbursementsPages.tsx');
    // The two layouts are the page's own: cards below md, the table from md. Each button names its own.
    assert.match(hub, /data-testid="reimbursements-finance-table">[\s\S]*?onRecordPayment\(r, 'table'\)[\s\S]*?data-testid="reimbursements-finance-card-list">[\s\S]*?onRecordPayment\(r, 'cards'\)/);
    assert.equal(hub.match(/onRecordPayment\(r, '(?:cards|table)'\)/g)?.length, 2);
    assert.doesNotMatch(hub, /matchMedia|innerWidth/, 'no second measurement of the screen');
  });

  // Review finding: a claim with no branch showed "บันทึกจ่าย", which the API refuses for everyone.
  it('offers the button only for a claim the payment endpoint takes: waiting for payment, with a branch, to a holder of the pay right', () => {
    const row = { status: 'READY_FOR_PAYMENT', branchId: 'branch-1' };
    assert.equal(queueRowOffersPayment(row, owner), true);
    assert.equal(queueRowOffersPayment(row, ['reimbursement.read', 'reimbursement.finance_review']), false);
    for (const branchId of [null, undefined, '']) assert.equal(queueRowOffersPayment({ ...row, branchId }, owner), false, String(branchId));
    for (const status of ['FINANCE_REVIEW', 'PAID', 'PENDING_APPROVAL', 'DRAFT']) assert.equal(queueRowOffersPayment({ ...row, status }, owner), false, status);
    assert.equal(queueRowOffersPayment(null, owner), false);
    const hub = sourceOf('ReimbursementsPages.tsx');
    assert.equal(hub.match(/\{queueRowOffersPayment\(r, permissions\) && <button/g)?.length, 2, 'the table row and the card ask the same question');
    assert.doesNotMatch(hub, /r\.status === 'READY_FOR_PAYMENT' &&/);

    // The claim page: no button, and the step says why and what to do.
    const payable = claim({ status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', outstandingAmount: '500.0000', payments: [], currentDesk: { kind: 'PAYMENT' } });
    const paymentStep = (detail: any) => buildJourneySteps(detail, owner, 'user-payer').find((step) => step.key === 'payment')!;
    assert.ok(paymentStep(payable).actions.includes('pay'));
    for (const branchId of [null, undefined]) {
      const step = paymentStep({ ...payable, branchId });
      assert.ok(!step.actions.includes('pay'), String(branchId));
      assert.equal(step.note, 'ใบนี้ไม่ได้ระบุสาขา ระบบจึงยังบันทึกจ่ายไม่ได้ กรุณาติดต่อผู้ดูแลระบบ');
      assert.equal(opensPaymentFormOnArrival(true, activeJourneyStep(buildJourneySteps({ ...payable, branchId }, owner, 'user-payer'))), false, 'the ?pay=1 link opens no form either');
    }
  });

  it('opens the form on arrival only when the link asked for it and this viewer\'s current step offers the payment', () => {
    const payable = claim({ status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', outstandingAmount: '500.0000', payments: [], currentDesk: { kind: 'PAYMENT' } });
    const stepFor = (detail: any, permissions: string[]) => activeJourneyStep(buildJourneySteps(detail, permissions, 'user-payer'));
    assert.equal(opensPaymentFormOnArrival(true, stepFor(payable, owner)), true);
    assert.equal(opensPaymentFormOnArrival(false, stepFor(payable, owner)), false, 'an ordinary visit never opens it');
    assert.equal(opensPaymentFormOnArrival(true, stepFor(payable, ['reimbursement.read'])), false, 'someone who cannot record a payment');
    assert.equal(opensPaymentFormOnArrival(true, stepFor(claim(), owner)), false, 'a claim that is already paid');
    assert.equal(opensPaymentFormOnArrival(true, undefined), false);
  });

  it('is wired from the queue button to the claim page, and the dialog form mounts once the claim has loaded, never on the bare row', () => {
    const hub = sourceOf('ReimbursementsPages.tsx');
    // One handler for the table button and the card button; the dialog opens only through it.
    assert.match(hub, /const recordPayment = useCallback\(\(row: any, layout: 'cards' \| 'table'\) => \{\s+const target = quickPayTarget\(layout, companyId, row\.id\);/);
    assert.match(hub, /if \(target\.kind === 'page'\) router\.push\(target\.href\);\s+else setPayFor\(row\);/);
    assert.match(hub, /<FinanceQueue \{\.\.\.queueProps\}[^\n>]* onRecordPayment=\{recordPayment\} \/>/);
    assert.equal((hub.match(/setPayFor\(/g) ?? []).length, 3, 'opened in one place, closed in two');
    // The form seeds its state when it mounts, so it mounts once, after the claim read settles, and
    // never on the bare queue row: that row says nothing about the account to pay into.
    assert.match(hub, /const \[claim, setClaim\] = useState<any \| null>\(null\)/);
    assert.match(hub, /\.then\(\(detail\) => \{ if \(active\) setClaim\(detail\); \}\)\s+\.catch\(\(e\) => \{ if \(active\) setFailed\(err\(e\)\); \}\);/);
    assert.doesNotMatch(hub, /setClaim\(request\)/);
    assert.match(hub, /\{claim \? \([\s\S]*?<ClaimPayoutCard companyId=\{companyId\} detail=\{claim\} userId=\{userId\}[^\n]* payStep \/>\s+<PaymentForm companyId=\{companyId\} request=\{claim\} onCancel=\{onClose\} onDone=\{onDone\} \/>[\s\S]*?\) : failed \? \([\s\S]*?\) : <LoadingState label="กำลังเปิดใบเบิก\.\.\." \/>\}/);
    assert.equal(hub.match(/<PaymentForm /g)?.length, 1);
    // A failed read is not a dead end: try again, or go to the claim's own page with the form open.
    assert.match(hub, /<ErrorBanner message=\{`เปิดใบเบิกไม่สำเร็จ จึงยังบันทึกจ่ายจากหน้านี้ไม่ได้ · \$\{failed\}`\} \/>/);
    assert.match(hub, /onClick=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}>ลองอีกครั้ง<\/button>\s+<Link href=\{`\$\{claimPath\}\/\$\{request\.id\}\?pay=1`\} className=\{btnClass\}>เปิดหน้าใบเบิก<\/Link>/);

    const route = sourceOf('..', '..', '..', 'app', '(workspace)', 'companies', '[companyId]', 'reimbursements', '[requestId]', 'page.tsx');
    assert.match(route, /payOnOpen=\{\(searchParams \? await searchParams : \{\}\)\['pay'\] === '1'\}/);
    const page = sourceOf('ReimbursementJourneyPage.tsx');
    assert.match(page, /const payRequested = useRef\(payOnOpen\)/);
    assert.match(page, /if \(opensPaymentFormOnArrival\(payRequested\.current, activeJourneyStep\(buildJourneySteps\(next, permissions, userId\)\)\)\) \{\s+setPayOpen\(true\);/);
    assert.match(page, /payRequested\.current = false;/, 'asked for once: a later re-read never reopens a form the payer closed');
  });
});
