import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISBURSEMENT_APPROVER_SEARCH_ABOVE, disbursementApproverMatches, disbursementOtherApprovers, disbursementReturnedApprover, disbursementVoucherIsSender, disbursementVoucherSenderSentence, disbursementVoucherSteps, disbursementVoucherPrimary, disbursementVoucherMenu, initialApprover, disbursementVoucherHistory, disbursementCommandBody, disbursementPayeeBasisNote, disbursementCancellationSentence, disbursementCommandToast, disbursementVoucherWaitingLines, disbursementReminderLast } from './disbursement-voucher-journey.logic';
import { disbursementVoucherNextSentence } from './disbursement-vouchers.logic';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';

const detail = (status: DisbursementVoucherDetail['header']['status'], actions = {}) => ({
  header: { status, revision: 1, createdAt: '2026-10-10T16:00:00Z', preparedByUserId: 'maker' },
  preparerName: 'ผู้จัดทำ', requestedApproverName: null, revisions: [], actions,
}) as unknown as DisbursementVoucherDetail;

test('own four steps track each status and cancellation greys every step', () => {
  for (const [status, current] of [['DRAFT', 0], ['PENDING_APPROVAL', 1], ['APPROVED', 2], ['PAID', 3], ['CANCELLED', -1]] as const) {
    const steps = disbursementVoucherSteps(status);
    assert.deepEqual(steps.map(s => s.label), ['เลือกรายการ', 'อนุมัติ', 'จ่าย', 'ใบสำคัญจ่าย']);
    assert.deepEqual(steps.map(s => s.state), steps.map((_, i) => current === -1 || i > current ? 'upcoming' : i === current ? 'current' : 'done'));
  }
});
test('primary and header obey status and server rights including self-approval and pending fallback', () => {
  for (const submit of [false, true]) for (const submitAndApprove of [false, true]) {
    const d = detail('DRAFT', { submit, submitAndApprove });
    assert.equal(disbursementVoucherPrimary(d), submitAndApprove ? 'selfApprove' : submit ? 'submit' : null);
    assert.equal(disbursementVoucherNextSentence(d), submitAndApprove ? 'ตรวจรายการ แล้วกดส่งและอนุมัติได้เลย' : submit ? 'ตรวจรายการ แล้วส่งให้ผู้อนุมัติ' : 'ร่าง ยังไม่ได้ส่งอนุมัติ รอ ผู้จัดทำ ส่งอนุมัติ');
  }
  for (const approve of [false, true]) {
    const d = detail('PENDING_APPROVAL', { approve, return: approve });
    assert.equal(disbursementVoucherPrimary(d), approve ? 'approve' : null);
    assert.equal(disbursementVoucherNextSentence(d), approve ? 'ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้' : 'รอผู้มีสิทธิ์อนุมัติ');
    d.requestedApproverName = 'คุณสมใจ';
    assert.equal(disbursementVoucherNextSentence(d), approve ? 'ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้' : 'รอ คุณสมใจ อนุมัติ');
  }
  for (const status of ['APPROVED', 'PAID', 'CANCELLED'] as const) assert.equal(disbursementVoucherPrimary(detail(status, { pay: true, approve: true, submit: true })), null);
});
test('menu omits unauthorized actions and restricts edit/delete to drafts', () => {
  assert.deepEqual(disbursementVoucherMenu(detail('DRAFT')), ['history']);
  assert.deepEqual(disbursementVoucherMenu(detail('DRAFT', { edit: true, delete: true, withdraw: true, cancel: true })), ['edit', 'delete', 'withdraw', 'cancel', 'history']);
  assert.deepEqual(disbursementVoucherMenu(detail('PENDING_APPROVAL', { edit: true, delete: true, withdraw: true, cancel: false })), ['withdraw', 'history']);
});
test('a long approver list is searched by name and never hides the chosen person', () => {
  const people = ['สมชาย ใจดี', 'สมหญิง รักงาน', 'วิชัย มั่นคง'].map((displayName, index) => ({ userId: `u${index}`, displayName }));
  assert.equal(DISBURSEMENT_APPROVER_SEARCH_ABOVE, 6);
  assert.deepEqual(disbursementApproverMatches(people, '  ', null), people);
  assert.deepEqual(disbursementApproverMatches(people, 'สม', null).map(p => p.userId), ['u0', 'u1']);
  assert.deepEqual(disbursementApproverMatches(people, 'สม รัก', null).map(p => p.userId), ['u1']);
  assert.deepEqual(disbursementApproverMatches(people, 'วิชัย', 'u0').map(p => p.userId), ['u0', 'u2']);
  assert.deepEqual(disbursementApproverMatches(people, 'ไม่มีชื่อนี้', null), []);
});

test('approvers preselect only a sole eligible person', () => {
  assert.equal(initialApprover([]), '');
  assert.equal(initialApprover([{ userId: 'a', displayName: 'ก' }]), 'a');
  assert.equal(initialApprover([{ userId: 'a', displayName: 'ก' }, { userId: 'b', displayName: 'ข' }]), '');
});
test('all command bodies contain version and command id; self-approval uses submit with approveNow true', () => {
  const base = { commandId: 'attempt', expectedVersion: 4 };
  assert.deepEqual(disbursementCommandBody('submit', base, 'approver', 'ignored'), { ...base, requestedApproverUserId: 'approver' });
  assert.deepEqual(disbursementCommandBody('selfApprove', base, '', ''), { ...base, approveNow: true });
  assert.deepEqual(disbursementCommandBody('approve', base, '', 'ignored'), base);
  for (const kind of ['return', 'cancel'] as const) assert.deepEqual(disbursementCommandBody(kind, base, '', ' เพราะรายการซ้ำ '), { ...base, reason: 'เพราะรายการซ้ำ' });
  assert.deepEqual(disbursementCommandBody('withdraw', base, '', ' เพราะรายการซ้ำ '), base);
  assert.deepEqual(disbursementCommandBody('withdraw', base, '', ''), base);
});
test('same attempt reuses command id after a lost reply; edits renew it', () => {
  let minted = 0;
  const mint = () => `command-${++minted}`;
  const first = nextDraftCommand(null, false, mint);
  assert.equal(nextDraftCommand(first, false, mint), first);
  assert.equal(nextDraftCommand(first, true, mint), 'command-2');
});
test('history groups Bangkok days newest first and keeps approval plus later take-back and removed names', () => {
  const d = detail('DRAFT');
  d.revisions = [{ revision: 1, submittedAt: '2026-10-10T16:30:00Z', submittedByUserId: 'maker', submittedByName: 'ผู้จัดทำ', requestedApproverUserId: 'reviewer', requestedApproverName: 'ผู้อนุมัติ ก',
    decision: 'APPROVED', decidedAt: '2026-10-10T16:40:00Z', decidedByUserId: 'maker', decidedByName: 'ผู้จัดทำ',
    postApprovalAction: 'WITHDRAWN', postApprovalAt: '2026-10-10T17:01:00Z', postApprovalByName: null, postApprovalReason: 'เปลี่ยนยอด',
  }] as DisbursementVoucherDetail['revisions'];
  const groups = disbursementVoucherHistory(d);
  assert.deepEqual(groups.map(g => g.day), ['2026-10-11', '2026-10-10']);
  assert.deepEqual(groups.flatMap(g => g.events.map(e => e.label)), ['กลับไปแก้', 'อนุมัติเอง', 'ส่งอนุมัติ ครั้งที่ 1', 'สร้างใบ']);
  assert.equal(groups[0]!.events[0]!.actor, 'ผู้ใช้ที่ไม่อยู่ในร้านแล้ว');
  assert.equal(groups[0]!.events[0]!.reason, 'เปลี่ยนยอด');
});
test('history records return and cancel reasons without duplicating header cancellation', () => {
  const d = detail('CANCELLED');
  d.header.cancelledAt = '2026-10-11T03:00:00Z'; d.header.cancelReason = 'รายการซ้ำ';
  d.revisions = [
    { revision: 1, submittedAt: '2026-10-10T16:30:00Z', submittedByName: null, decision: 'RETURNED', decidedAt: '2026-10-10T16:40:00Z', decidedByName: 'ผู้อนุมัติ', decisionReason: 'แก้ยอด' },
    { revision: 2, submittedAt: '2026-10-11T02:00:00Z', submittedByName: 'ผู้จัดทำ', decision: 'CANCELLED', decidedAt: d.header.cancelledAt, decidedByName: 'ผู้อนุมัติ', decisionReason: 'รายการซ้ำ' },
  ] as DisbursementVoucherDetail['revisions'];
  const events = disbursementVoucherHistory(d).flatMap(g => g.events);
  assert.equal(events.filter(e => e.label === 'ยกเลิกใบ').length, 1);
  assert.equal(events.find(e => e.label === 'ส่งกลับให้แก้แล้ว')?.reason, 'แก้ยอด');
});

test('payee basis wording uses contracts and a removed confirmer has a name sentence', () => {
  const d = detail('PENDING_APPROVAL');
  d.header.payeeBasis = 'TAX_ID';
  assert.equal(disbursementPayeeBasisNote(d), null);
  d.header.payeeBasis = 'SAME_NAME';
  assert.equal(disbursementPayeeBasisNote(d), 'รวมจากชื่อร้านที่ตรงกัน (ไม่มีเลขผู้เสียภาษี)');
  d.header.payeeBasis = 'PREPARER_CONFIRMED'; d.payeeConfirmerName = 'คุณสมใจ';
  assert.equal(disbursementPayeeBasisNote(d), 'รวมด้วยการยืนยันของผู้จัดทำ คุณสมใจ');
  d.payeeConfirmerName = null;
  assert.equal(disbursementPayeeBasisNote(d), 'รวมด้วยการยืนยันของผู้จัดทำ ผู้ใช้ที่ไม่อยู่ในร้านแล้ว');
});
test('history never assigns the latest recipient to earlier revisions and orders same-time events', () => {
  const d = detail('APPROVED'); d.header.revision = 2; d.header.requestedApproverUserId = 'reviewer'; d.requestedApproverName = 'ผู้อนุมัติ';
  d.revisions = [1, 2].map(revision => ({ revision, submittedAt: `2026-10-${revision === 1 ? '10' : '11'}T03:00:00Z`, submittedByUserId: 'maker', submittedByName: 'ผู้จัดทำ', requestedApproverUserId: 'reviewer', requestedApproverName: revision === 1 ? 'ผู้อนุมัติ ก' : 'ผู้อนุมัติ',
    decision: 'APPROVED', decidedAt: `2026-10-${revision === 1 ? '10' : '11'}T03:00:00Z`, decidedByUserId: 'reviewer', decidedByName: 'ผู้อนุมัติ',
  })) as DisbursementVoucherDetail['revisions'];
  const events = disbursementVoucherHistory(d).flatMap(group => group.events);
  assert.equal(events[0]!.label, 'อนุมัติ');
  assert.equal(events[1]!.recipient, 'ผู้อนุมัติ');
  assert.equal(events.find(event => event.key === 'sent-1')!.recipient, 'ผู้อนุมัติ ก');
});
test('cancellation after approval uses header date and reason for the next sentence', () => {
  const d = detail('CANCELLED'); d.header.cancelledAt = '2026-10-11T04:00:00Z'; d.header.cancelReason = 'รายการซ้ำ';
  assert.match(disbursementVoucherNextSentence(d)!, /^ใบนี้ถูกยกเลิกเมื่อ .+ เหตุผล: รายการซ้ำ$/);
});

test('draft cancellation names its actor when the existing reader already exposes that name', () => {
  const d = detail('CANCELLED'); d.header.cancelledByUserId = 'maker'; d.header.cancelledAt = '2026-10-11T03:00:00Z'; d.header.cancelReason = 'รายการซ้ำ'; d.header.cancelledByName = 'ผู้จัดทำ';
  assert.equal(disbursementVoucherHistory(d)[0]!.events[0]!.actor, 'ผู้จัดทำ');
});

test('cancellation copy never promises to undo partial payments or change an already released draft', () => {
  const d = detail('PENDING_APPROVAL');
  d.lines = [{ outstandingAmount: '10400.0000', netPayableAmount: '10400.0000' }] as DisbursementVoucherDetail['lines'];
  const released = 'รายจ่ายในใบกลับไปรอจ่ายตามเดิม เลขที่นี้ไม่ใช้ซ้ำ';
  assert.equal(disbursementCancellationSentence(d), released);
  d.lines[0]!.outstandingAmount = '5200.0000';
  assert.equal(disbursementCancellationSentence(d), released);
  d.header.status = 'APPROVED';
  assert.equal(disbursementCancellationSentence(d), released);
  d.lines[0]!.outstandingAmount = '10400.0000'; d.header.status = 'DRAFT';
  assert.equal(disbursementCancellationSentence(d), null);
  d.header.documentNumber = 'DV-1';
  assert.equal(disbursementCancellationSentence(d), 'ยกเลิกแล้วรายจ่ายในใบกลับไปรอจ่ายตามเดิม');
});

test('creation history stays truthful for an issued direct-payment document that never had a draft', () => {
  const d = detail('PAID'); d.header.origin = 'DIRECT_PAYMENT';
  assert.equal(disbursementVoucherHistory(d)[0]!.events[0]!.label, 'สร้างใบ');
});

test('payment history uses the recording time and payer name', () => {
  const d = detail('PAID'); d.header.paidRecordedAt = '2026-10-11T17:00:00Z'; d.paidByName = 'คุณสมใจ';
  const event = disbursementVoucherHistory(d)[0]!.events[0]!;
  assert.equal(event.key, 'paid');
  assert.equal(event.label, 'บันทึกว่าจ่ายแล้ว');
  assert.equal(event.actor, 'คุณสมใจ');
  assert.equal(event.at, d.header.paidRecordedAt);
});


test('history uses each requested approver and the current return/cancel names without guessing ids', () => {
  const d = detail('CANCELLED'); d.header.revision = 2;
  d.header.returnedAt = '2026-10-11T01:00:00Z'; d.header.returnedByName = 'คนส่งกลับให้แก้'; d.header.returnReason = 'แก้รายการ';
  d.header.cancelledAt = '2026-10-11T03:00:00Z'; d.header.cancelledByName = 'คนยกเลิก'; d.header.cancelledByUserId = 'removed';
  d.revisions = [1, 2].map(revision => ({ revision, submittedAt: `2026-10-1${revision - 1}T00:00:00Z`,
    submittedByUserId: 'maker', submittedByName: 'ผู้จัดทำ', requestedApproverUserId: `approver-${revision}`,
    requestedApproverName: revision === 1 ? 'คน ก' : 'คน ข', decision: null,
  })) as DisbursementVoucherDetail['revisions'];
  const events = disbursementVoucherHistory(d).flatMap(group => group.events);
  assert.equal(events.find(event => event.key === 'sent-1')!.recipient, 'คน ก');
  assert.equal(events.find(event => event.key === 'sent-2')!.recipient, 'คน ข');
  assert.equal(events.find(event => event.key === 'returned')!.actor, 'คนส่งกลับให้แก้');
  assert.equal(events.find(event => event.key === 'cancelled')!.actor, 'คนยกเลิก');
  d.header.cancelledByName = null;
  assert.equal(disbursementVoucherHistory(d).flatMap(group => group.events).find(event => event.key === 'cancelled')!.actor, 'ผู้ใช้ที่ไม่อยู่ในร้านแล้ว');
});

test('reminder menu follows the server action only while waiting for approval', () => {
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED'] as const) for (const remind of [false, true]) {
    assert.equal(disbursementVoucherMenu(detail(status, { remind })).includes('remind'), status === 'PENDING_APPROVAL' && remind);
  }
});
test('reminders preselect the requested eligible approver, including a list with several people', () => {
  const people = [{ userId: 'a', displayName: 'เอ' }, { userId: 'b', displayName: 'บี' }];
  assert.equal(initialApprover(people, 'b'), 'b');
  assert.equal(initialApprover(people, null), '');
  assert.equal(initialApprover(people, 'removed'), '');
  assert.equal(initialApprover(people.slice(0, 1), null), 'a');
});


test('send toasts name the notified approver only for another chosen person and never for self-approval', () => {
  const header = { ...detail('PENDING_APPROVAL').header, documentNumber: 'DV-1', requestedApproverUserId: 'a', selfApproved: false };
  const people = [{ userId: 'a', displayName: 'คุณเอ' }, { userId: 'maker', displayName: 'ผู้จัดทำ' }];
  assert.equal(disbursementCommandToast('submit', header, 'maker', people), 'ส่งอนุมัติแล้ว เลขที่ DV-1 ระบบแจ้ง คุณเอ แล้ว');
  assert.equal(disbursementCommandToast('submit', { ...header, requestedApproverUserId: null }, 'maker', people), 'ส่งอนุมัติแล้ว เลขที่ DV-1');
  assert.equal(disbursementCommandToast('submit', { ...header, requestedApproverUserId: 'maker' }, 'maker', people), 'ส่งอนุมัติแล้ว เลขที่ DV-1');
  assert.equal(disbursementCommandToast('selfApprove', { ...header, selfApproved: true }, 'maker', people), 'ส่งและอนุมัติแล้ว เลขที่ DV-1');
  assert.equal(disbursementCommandToast('submit', header, null, people), 'ส่งอนุมัติแล้ว เลขที่ DV-1');
});
test('approve and return toasts promise a preparer notice only for another person and respect self-approved notice suppression', () => {
  const header = { ...detail('APPROVED').header, selfApproved: false };
  for (const [kind, plain, notified] of [['approve', 'อนุมัติแล้ว', 'อนุมัติแล้ว ระบบแจ้งผู้จัดทำแล้ว'], ['return', 'ส่งกลับให้แก้แล้ว', 'ส่งกลับให้แก้แล้ว ระบบแจ้งผู้จัดทำแล้ว']] as const) {
    assert.equal(disbursementCommandToast(kind, header, 'reviewer', []), notified);
    assert.equal(disbursementCommandToast(kind, header, 'maker', []), plain);
    assert.equal(disbursementCommandToast(kind, header, null, []), plain);
  }
  assert.equal(disbursementCommandToast('approve', { ...header, selfApproved: true }, 'reviewer', []), 'อนุมัติแล้ว');
});
test('reminder toast names the recipient and never promises a self-notice', () => {
  const header = { ...detail('PENDING_APPROVAL').header, lastReminderToUserId: 'a' };
  const people = [{ userId: 'a', displayName: 'คุณเอ' }];
  assert.equal(disbursementCommandToast('remind', header, 'maker', people), 'ส่งเตือน คุณเอ แล้ว');
  assert.equal(disbursementCommandToast('remind', header, 'a', people), null);
});
test('waiting lines show Thai submission and last-reminder times with or without a chosen approver', () => {
  const d = detail('PENDING_APPROVAL'); d.header.submittedAt = '2026-10-11T17:10:00Z';
  assert.deepEqual(disbursementVoucherWaitingLines(d), ['ส่งเมื่อ 12 ต.ค. 2569 00:10 น.']);
  d.header.lastReminderAt = '2026-10-11T18:00:00Z'; d.header.lastReminderToUserId = 'a'; d.lastReminderToName = 'คุณเอ';
  // The reminder is said once, with the name: the waiting lines no longer repeat it without one.
  assert.deepEqual(disbursementVoucherWaitingLines(d), ['ส่งเมื่อ 12 ต.ค. 2569 00:10 น.']);
  assert.equal(disbursementReminderLast(d), 'เตือนล่าสุด: คุณเอ เมื่อ 12 ต.ค. 2569 01:00 น.');
  d.header.requestedApproverUserId = 'a'; assert.equal(disbursementVoucherWaitingLines(d).length, 1);
  d.header.status = 'APPROVED'; assert.deepEqual(disbursementVoucherWaitingLines(d), []);
});
test('history knows only the last reminder, uses its own recipient and invents no sender or earlier reminders', () => {
  const d = detail('PENDING_APPROVAL'); d.header.requestedApproverUserId = 'a'; d.requestedApproverName = 'คุณเอ';
  d.header.lastReminderAt = '2026-10-11T18:00:00Z'; d.header.lastReminderToUserId = 'b'; d.header.reminderCount = 5; d.lastReminderToName = 'คุณบี';
  const reminders = disbursementVoucherHistory(d).flatMap(g => g.events).filter(e => e.key === 'reminder');
  assert.equal(reminders.length, 1); assert.equal(reminders[0]!.label, 'เตือน คุณบี เมื่อ 12 ต.ค. 2569 01:00 น.');
  assert.equal(disbursementVoucherHistory(d)[0]!.events[0]!.key, 'reminder');
  assert.equal(reminders[0]!.actor, null); assert.equal(reminders[0]!.at, d.header.lastReminderAt);
  d.lastReminderToName = null; assert.match(disbursementReminderLast(d)!, /ผู้ใช้ที่ไม่อยู่ในร้านแล้ว/);
  d.header.lastReminderAt = null; assert.equal(disbursementReminderLast(d), null);
  assert.equal(disbursementVoucherHistory(d).flatMap(g => g.events).filter(e => e.key === 'reminder').length, 0);
});

test('a draft whose latest sending was sent back says who, when and why; a later sending or another status says nothing', async () => {
  const { disbursementVoucherReturnNotice } = await import('./disbursement-voucher-journey.logic');
  const d = detail('DRAFT');
  assert.equal(disbursementVoucherReturnNotice(d), null);
  d.revisions = [{ revision: 1, decision: 'RETURNED', decidedByName: 'คุณสมใจ', decidedAt: '2026-10-11T17:10:00Z', decisionReason: 'ยอดไม่ตรง' }] as DisbursementVoucherDetail['revisions'];
  assert.deepEqual(disbursementVoucherReturnNotice(d), { title: 'ถูกส่งกลับให้แก้โดย คุณสมใจ เมื่อ 12 ต.ค. 2569 00:10 น.', reason: 'เหตุผล: ยอดไม่ตรง' });
  d.revisions = [...d.revisions, { revision: 2, decision: 'WITHDRAWN', decidedAt: '2026-10-11T18:00:00Z' }] as DisbursementVoucherDetail['revisions'];
  assert.equal(disbursementVoucherReturnNotice(d), null);
  d.revisions = d.revisions.slice(0, 1); d.header.status = 'PENDING_APPROVAL';
  assert.equal(disbursementVoucherReturnNotice(d), null);
});

test('take-back and cancellation toast name what succeeded', () => {
  const header = { ...detail('DRAFT').header, documentNumber: 'DV-1' };
  assert.equal(disbursementCommandToast('withdraw', header, 'maker', []), 'กลับไปแก้แล้ว');
  assert.equal(disbursementCommandToast('cancel', header, 'maker', []), 'ยกเลิกใบเลขที่ DV-1 แล้ว');
});

test('the last reminder line belongs to the current sending, never to an earlier round', () => {
  const d = detail('PENDING_APPROVAL'); d.lastReminderToName = 'คุณเอ';
  d.header.submittedAt = '2026-10-11T22:10:00Z'; d.header.lastReminderAt = '2026-10-11T22:08:00Z';
  assert.equal(disbursementReminderLast(d), null);
  d.header.lastReminderAt = '2026-10-11T22:10:00Z'; assert.match(disbursementReminderLast(d)!, /คุณเอ/);
  d.header.lastReminderAt = '2026-10-12T05:11:00+07:00'; assert.match(disbursementReminderLast(d)!, /05:11/);
  d.header.submittedAt = null; assert.match(disbursementReminderLast(d)!, /คุณเอ/);
  d.header.lastReminderAt = null; assert.equal(disbursementReminderLast(d), null);
});

 test('another eligible approver sees who was asked; the requested viewer keeps the review sentence', () => {
  const d = detail('PENDING_APPROVAL', { approve: true, return: true });
  d.header.requestedApproverUserId = 'a'; d.requestedApproverName = 'ศิริพร';
  assert.equal(disbursementVoucherNextSentence(d, 'other-approver'), 'รอ ศิริพร อนุมัติ คุณมีสิทธิ์อนุมัติด้วย จะอนุมัติหรือส่งกลับให้แก้เองก็ได้');
  assert.equal(disbursementVoucherNextSentence(d, 'a'), 'ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้');
  d.header.requestedApproverUserId = null;
  assert.equal(disbursementVoucherNextSentence(d, 'other-approver'), 'ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้');
  // A reader who may approve but not send back (their own document, or its authors are switched off) is not told to.
  const own = detail('PENDING_APPROVAL', { approve: true, return: false });
  own.header.requestedApproverUserId = 'a'; own.requestedApproverName = 'ศิริพร';
  assert.equal(disbursementVoucherNextSentence(own, 'maker'), 'รอ ศิริพร อนุมัติ คุณมีสิทธิ์อนุมัติด้วย จะอนุมัติเองก็ได้');
  own.header.requestedApproverUserId = null;
  assert.equal(disbursementVoucherNextSentence(own, 'maker'), 'ตรวจรายการ แล้วอนุมัติ');
 });
 test('a returned draft keeps self approval primary and prefers its reviewer when sending to another', () => {
  const d = detail('DRAFT', { submit: true, submitAndApprove: true });
  d.revisions = [{ revision: 1, decision: 'RETURNED', decidedByUserId: 'reviewer' }] as any;
  assert.equal(disbursementReturnedApprover(d, 'maker'), 'reviewer');
  assert.equal(disbursementVoucherPrimary(d, 'maker'), 'selfApprove');
  assert.equal(disbursementVoucherNextSentence(d, 'maker'), 'ตรวจรายการ แล้วส่งให้ผู้อนุมัติ');
  assert.equal(initialApprover([{ userId: 'reviewer' }, { userId: 'other' }] as any, disbursementReturnedApprover(d, 'maker')), 'reviewer');
  assert.equal(disbursementReturnedApprover(d, 'reviewer'), null);
  d.revisions[0]!.decidedByUserId = 'maker'; assert.equal(disbursementVoucherPrimary(d, 'maker'), 'selfApprove');
  d.revisions[0]!.decision = 'WITHDRAWN'; assert.equal(disbursementReturnedApprover(d, 'maker'), null);
  d.revisions = []; assert.equal(disbursementVoucherPrimary(d, 'maker'), 'selfApprove');
 });

test('cancelled payment header leaves the cause and typed reason to the banner', () => {
  const d = detail('CANCELLED'); d.header.cancelledAt = '2026-10-12T03:00:00Z'; d.header.cancelledAfterPaid = true;
  d.header.cancelReason = 'การจ่ายของรายการ EX-1 ถูกยกเลิก'; d.lines = [{ expensePaymentId: 'p', paymentInEffect: false, expenseNumber: 'EX-1' }] as any;
  assert.equal(disbursementVoucherNextSentence(d), 'ใบนี้ถูกยกเลิกเมื่อ 12 ต.ค. 2569');
});

test('send-to-another approver choices exclude the sender before preselection and empty-state checks', () => {
  const people = [{ userId: 'maker', name: 'ผู้จัดทำ' }, { userId: 'reviewer', name: 'ผู้อนุมัติ' }] as any;
  assert.deepEqual(disbursementOtherApprovers(people, 'maker'), [people[1]]);
  assert.equal(initialApprover(disbursementOtherApprovers(people, 'maker'), 'maker'), 'reviewer');
  assert.deepEqual(disbursementOtherApprovers([people[0]], 'maker'), []);
  assert.deepEqual(disbursementOtherApprovers(people, null), people);
});

test('the pending sender gets a sent-time sentence and visible-action state, while the named approver keeps the review primary', () => {
  const d = detail('PENDING_APPROVAL', { approve: true, remind: true, withdraw: true });
  d.header.submittedByUserId = 'maker'; d.header.submittedAt = '2026-10-11T22:10:00Z';
  d.header.requestedApproverUserId = 'reviewer'; d.requestedApproverName = 'ศิริพร';
  assert.equal(disbursementVoucherIsSender(d, 'maker'), true);
  assert.equal(disbursementVoucherPrimary(d, 'maker'), null);
  assert.equal(disbursementVoucherSenderSentence(d), 'ส่งให้ ศิริพร แล้ว เมื่อ 12 ต.ค. 2569 05:10 น. รออนุมัติ');
  assert.equal(disbursementVoucherPrimary(d, 'reviewer'), 'approve');
  assert.equal(disbursementVoucherIsSender(d, 'reviewer'), false);
  d.header.requestedApproverUserId = null; d.requestedApproverName = null;
  assert.equal(disbursementVoucherSenderSentence(d), 'ส่งแล้ว เมื่อ 12 ต.ค. 2569 05:10 น. รอผู้มีสิทธิ์อนุมัติ');
});

test('VOUCH-DOC3 history retains header-only send and approval facts without duplicating revision events', () => {
  const d = detail('PAID');
  d.header.submittedAt = '2026-10-15T01:00:00Z'; d.header.approvedAt = '2026-10-15T02:00:00Z';
  d.submittedByName = 'ผู้ส่ง'; d.approvedByName = 'ผู้อนุมัติ'; d.preparerActive = false; d.senderActive = false;
  const events = disbursementVoucherHistory(d).flatMap(group => group.events);
  assert.match(events.find(event => event.key === 'created')!.actor!, /ปิดใช้งานแล้ว/);
  assert.equal(events.find(event => event.key === 'submitted')!.actor, 'ผู้ส่ง (ปิดใช้งานแล้ว)');
  assert.equal(events.find(event => event.key === 'approved')!.actor, 'ผู้อนุมัติ');
  d.revisions = [{ revision: 1, submittedAt: d.header.submittedAt, submittedByUserId: d.header.submittedByUserId, submittedByName: 'ผู้ส่ง', decision: 'APPROVED', decidedAt: d.header.approvedAt, decidedByName: 'ผู้อนุมัติ' }] as any;
  const revised = disbursementVoucherHistory(d).flatMap(group => group.events);
  assert.equal(revised.filter(event => event.at === d.header.submittedAt).length, 1);
  assert.equal(revised.filter(event => event.at === d.header.approvedAt).length, 1);
});
