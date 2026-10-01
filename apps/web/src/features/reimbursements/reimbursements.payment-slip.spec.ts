import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementPaymentSlipRequired } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  buildClaimTimeline, buildJourneySteps, activeJourneyStep, canAttachPaymentSlip, paymentSaveErrorMessage, paymentSlipChoices,
  signedCopyMoveConfirmText, slipTargetPayment, validatePaymentForm,
} from './reimbursements.logic';
import { PAYMENT_METHOD_LABELS } from './reimbursements.model';

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

  it('never tells a payer who has transferred the money to transfer it again', () => {
    assert.equal(
      paymentSaveErrorMessage('slip-upload', 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', false),
      'อัปโหลดสลิปไม่สำเร็จ ระบบยังไม่ได้บันทึกจ่าย · ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    );
    const afterSlip = paymentSaveErrorMessage('record', 'คำขอถูกแก้ไขระหว่างทำรายการ', true);
    assert.match(afterSlip, /^แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · คำขอถูกแก้ไขระหว่างทำรายการ · /);
    assert.match(afterSlip, /ไม่ต้องแนบสลิปหรือโอนเงินใหม่$/);
    assert.equal(paymentSaveErrorMessage('record', 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น', false), 'ยังบันทึกจ่ายไม่สำเร็จ · ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น');
    // "บันทึกจ่ายเรียบร้อย" is never part of a failure message.
    for (const text of [afterSlip, paymentSaveErrorMessage('slip-upload', 'x', false)]) assert.doesNotMatch(text, /เรียบร้อย|สำเร็จแล้ว/);
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
  id: 'rb-1', requestNo: 'RB-202609-00007', requesterUserId: requester, status: 'PAID', paymentStatus: 'PAID',
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
    assert.deepEqual(paymentSlipChoices(detail), [
      { attachmentId: 'att-slip-1', kind: 'previous-slip', label: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00001' },
      { attachmentId: 'att-slip-0', kind: 'previous-slip', label: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00000 (ไฟล์ที่ 2)' },
      { attachmentId: 'att-copy', kind: 'signed-copy', label: 'สลิปโอนเงิน.jpg · แนบไว้ที่ใบเบิกที่เซ็นแล้ว' },
    ]);
    // A standing payment's slip is not offered again, and a queue row (no attachments at all) offers nothing.
    assert.deepEqual(paymentSlipChoices(claim()), []);
    assert.deepEqual(paymentSlipChoices({ id: 'rb-1', outstandingAmount: '500.0000' }), []);
  });

  it('lets a payment-record holder add slips to a recorded payment only, five at most', () => {
    const payer = ['reimbursement.payment.record'];
    assert.equal(canAttachPaymentSlip(recorded(), payer), true);
    assert.equal(canAttachPaymentSlip(recorded({ slips: undefined }), payer), true, 'a payment recorded before slips existed');
    assert.equal(canAttachPaymentSlip(recorded(), ['reimbursement.finance_review']), false);
    assert.equal(canAttachPaymentSlip(voided(), payer), false, 'a voided payment keeps its slips and takes no more');
    assert.equal(canAttachPaymentSlip(recorded({ slips: [1, 2, 3, 4, 5].map((n) => slip(`att-${n}`)) }), payer), false);
    assert.equal(slipTargetPayment(claim({ payments: [voided(), recorded()] }), payer)?.id, 'pay-2');
    assert.equal(slipTargetPayment(claim({ payments: [voided()] }), payer), undefined, 'nothing to move a file to before a payment stands');
    assert.equal(slipTargetPayment(claim(), ['reimbursement.read']), undefined);
  });

  it('says what moving a file out of ใบเบิกที่เซ็นแล้ว will do, and mentions a declaration only when one was made', () => {
    const declared = signedCopyMoveConfirmText(declaredCopy, recorded());
    assert.match(declared, /^ไฟล์ สลิปโอนเงิน\.jpg จะย้ายจากรายการใบเบิกที่เซ็นแล้ว ไปเป็นสลิปของการจ่าย RBPAY-202609-00002 โดยไม่ต้องอัปโหลดใหม่/);
    assert.match(declared, /ระบบจะถอนการยืนยันนั้น ใบเบิกจะไม่นับว่าลงนามบนกระดาษจากไฟล์นี้อีก/);
    assert.match(declared, /เปิดดูได้เฉพาะผู้เบิก ผู้อนุมัติของใบนี้ ผู้ที่บันทึกจ่ายได้ และผู้ตรวจการเงิน$/);
    const archived = signedCopyMoveConfirmText({ fileName: 'scan.pdf' }, recorded());
    assert.doesNotMatch(archived, /ถอนการยืนยัน/);
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
