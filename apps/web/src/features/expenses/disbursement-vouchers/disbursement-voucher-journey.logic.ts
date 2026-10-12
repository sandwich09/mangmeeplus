import { DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS, todayCivilDate } from '@watchdog-bms/contracts';
import type { ThemedStep } from '@/common/components/steps/ThemedSteps';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementApprover, DisbursementDialogKind, DisbursementHistoryEvent, DisbursementVoucherCommandInput, DisbursementVoucherDetail, SubmitDisbursementVoucherInput, EndDisbursementVoucherInput } from './disbursement-vouchers.model';

import { disbursementDocumentKind } from './disbursement-voucher-document.logic';
import { canReissueDisbursementVoucher } from './disbursement-voucher-reissue.logic';

const words = workspaceDictionary.th;
export function disbursementVoucherSteps(status: DisbursementVoucherDetail['header']['status']): ThemedStep[] {
  const current = { DRAFT: 0, PENDING_APPROVAL: 1, APPROVED: 2, PAID: 3, CANCELLED: -1 }[status];
  return ['items', 'approve', 'pay', 'document'].map((key, index) => ({ key, label: words[`expenses.disbursement.step_${key}` as keyof typeof words],
    state: current < 0 || index > current ? 'upcoming' : index === current ? 'current' : 'done' }));
}
export function disbursementReturnedApprover(detail: DisbursementVoucherDetail, viewerUserId?: string | null): string | null {
  if (!viewerUserId || detail.header.status !== 'DRAFT' || detail.header.preparedByUserId !== viewerUserId || !detail.actions.submit || !detail.actions.submitAndApprove) return null;
  const latest = detail.revisions?.reduce((last, revision) => revision.revision > last.revision ? revision : last, detail.revisions[0]!);
  return latest?.decision === 'RETURNED' && latest.decidedByUserId && latest.decidedByUserId !== viewerUserId ? latest.decidedByUserId : null;
}
export function disbursementVoucherIsSender(detail: DisbursementVoucherDetail, viewerUserId?: string | null): boolean {
  return Boolean(viewerUserId && detail.header.status === 'PENDING_APPROVAL' && detail.header.submittedByUserId === viewerUserId);
}
export function disbursementVoucherPrimary(detail: DisbursementVoucherDetail, viewerUserId?: string | null): 'selfApprove' | 'submit' | 'approve' | null {
  const { header, actions } = detail;
  if (disbursementReturnedApprover(detail, viewerUserId)) return 'submit';
  if (disbursementVoucherIsSender(detail, viewerUserId)) return null;
  if (header.status === 'DRAFT') return actions.submitAndApprove ? 'selfApprove' : actions.submit ? 'submit' : null;
  return header.status === 'PENDING_APPROVAL' && actions.approve ? 'approve' : null;
}
export function disbursementVoucherMenu(detail: DisbursementVoucherDetail): ('edit' | 'delete' | 'withdraw' | 'cancel' | 'reissue' | 'print' | 'remind' | 'history')[] {
  const { header, actions } = detail;
  return [...(header.status === 'DRAFT' && actions.edit ? ['edit' as const] : []), ...(header.status === 'DRAFT' && actions.delete ? ['delete' as const] : []),
    ...(disbursementDocumentKind(header) === 'prepare' ? ['print' as const] : []), ...(header.status === 'PENDING_APPROVAL' && actions.remind ? ['remind' as const] : []), ...(actions.withdraw ? ['withdraw' as const] : []), ...(actions.cancel ? ['cancel' as const] : []), ...(canReissueDisbursementVoucher(detail) ? ['reissue' as const] : []), 'history'];
}
export const disbursementOtherApprovers = (people: DisbursementApprover[], viewerUserId?: string | null) => people.filter(person => person.userId !== viewerUserId);
/** With more people than this, the chooser shows a name search and scrolls inside the dialog. */
export const DISBURSEMENT_APPROVER_SEARCH_ABOVE = 6;
/** People whose name contains every typed word; the chosen person is always kept so a send never targets someone out of sight. */
export function disbursementApproverMatches(people: DisbursementApprover[], query: string, chosen?: string | null) {
  const words = query.trim().toLocaleLowerCase('th').split(/\s+/).filter(Boolean);
  if (!words.length) return people;
  return people.filter(person => person.userId === chosen || words.every(word => person.displayName.toLocaleLowerCase('th').includes(word)));
}
export const initialApprover = (people: DisbursementApprover[], preferred?: string | null) => people.some(person => person.userId === preferred) ? preferred! : people.length === 1 ? people[0]!.userId : '';
export function disbursementCommandBody(kind: Exclude<DisbursementDialogKind, 'delete' | 'remind'>, base: DisbursementVoucherCommandInput, approver: string, reason: string): SubmitDisbursementVoucherInput | EndDisbursementVoucherInput {
  if (kind === 'selfApprove') return { ...base, approveNow: true };
  if (kind === 'submit') return approver ? { ...base, requestedApproverUserId: approver } : base;
  return kind !== 'approve' && reason.trim() ? { ...base, reason: reason.trim() } : base;
}
export function disbursementPayeeBasisNote(detail: DisbursementVoucherDetail) {
  if (detail.header.payeeBasis === 'SAME_NAME') return DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS.sameNameNote;
  if (detail.header.payeeBasis === 'PREPARER_CONFIRMED') return DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS.preparerConfirmedNote.replace('{name}', detail.payeeConfirmerName ?? words['expenses.disbursement.removed_member']);
  return null;
}
export function disbursementCancellationSentence(detail: DisbursementVoucherDetail): string | null {
  if (detail.header.status === 'PENDING_APPROVAL' || detail.header.status === 'APPROVED') return words['expenses.disbursement.cancel_help'];
  return detail.header.status === 'DRAFT' && detail.header.documentNumber ? words['expenses.disbursement.cancel_numbered_draft'] : null;
}
export function disbursementVoucherHistory(detail: DisbursementVoucherDetail) {
  const { header } = detail;
  const person = (name: string | null | undefined) => name ?? words['expenses.disbursement.removed_member'];
  const events: DisbursementHistoryEvent[] = [{ key: 'created', at: header.createdAt, label: words['expenses.disbursement.created'], actor: person(detail.preparerName) }];
  if (header.lastReminderAt) events.push({ key: 'reminder', at: header.lastReminderAt, actor: null,
    label: words['expenses.disbursement.history_reminder'].replace('{name}', person(detail.lastReminderToName)).replace('{time}', formatThaiDateTime(header.lastReminderAt)) });
  if (header.paidRecordedAt) events.push({ key: 'paid', at: header.paidRecordedAt, label: words['expenses.disbursement.pay'], actor: person(detail.paidByName) });
  const labels = { APPROVED: words['expenses.disbursement.approve_document'], RETURNED: words['expenses.disbursement.return'], WITHDRAWN: words['expenses.disbursement.withdraw'], CANCELLED: words['expenses.disbursement.cancel'] };
  for (const revision of detail.revisions) {
    events.push({ key: `sent-${revision.revision}`, at: revision.submittedAt, label: words['expenses.disbursement.history_sent'].replace('{n}', String(revision.revision)), actor: person(revision.submittedByName),
      recipient: revision.requestedApproverUserId ? person(revision.requestedApproverName) : null });
    if (revision.decision && revision.decidedAt) events.push({ key: `decision-${revision.revision}`, at: revision.decidedAt,
      label: revision.decision === 'APPROVED' && revision.submittedByUserId === revision.decidedByUserId ? words['expenses.disbursement.history_self'] : labels[revision.decision],
      actor: person(revision.decidedByName ?? (revision.revision === header.revision && revision.decision === 'RETURNED' ? header.returnedByName ?? detail.returnedByName : revision.revision === header.revision && revision.decision === 'CANCELLED' ? header.cancelledByName ?? detail.cancelledByName : null)), reason: revision.decisionReason });
    if (revision.postApprovalAction && revision.postApprovalAt) events.push({ key: `post-${revision.revision}`, at: revision.postApprovalAt,
      label: labels[revision.postApprovalAction], actor: person(revision.postApprovalByName ?? (revision.revision === header.revision && revision.postApprovalAction === 'CANCELLED' ? header.cancelledByName ?? detail.cancelledByName : null)), reason: revision.postApprovalReason });
  }
  if (header.returnedAt && !events.some(e => e.at === header.returnedAt && e.label === labels.RETURNED)) {
    events.push({ key: 'returned', at: header.returnedAt, label: labels.RETURNED, actor: person(header.returnedByName ?? detail.returnedByName), reason: header.returnReason });
  }
  if (header.cancelledAt && !events.some(e => e.at === header.cancelledAt && e.label === labels.CANCELLED)) {
    events.push({ key: 'cancelled', at: header.cancelledAt, label: labels.CANCELLED, actor: person(header.cancelledByName ?? detail.cancelledByName), reason: header.cancelReason });
  }
  events.reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const groups: { day: string; events: DisbursementHistoryEvent[] }[] = [];
  for (const event of events) {
    const day = todayCivilDate('Asia/Bangkok', new Date(event.at));
    const previous = groups.at(-1);
    if (previous?.day === day) previous.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

/** A draft whose latest sending was sent back: who, when and why, so the preparer reads it on the document itself. */
export function disbursementVoucherReturnNotice(detail: DisbursementVoucherDetail): { title: string; reason: string | null } | null {
  if (detail.header.status !== 'DRAFT' || !detail.revisions?.length) return null;
  const last = detail.revisions.reduce((latest, revision) => revision.revision > latest.revision ? revision : latest);
  if (last.decision !== 'RETURNED') return null;
  const at = last.decidedAt ?? detail.header.returnedAt;
  if (!at) return null;
  const reason = last.decisionReason ?? detail.header.returnReason ?? null;
  return { title: words['expenses.disbursement.returned_notice']
    .replace('{name}', last.decidedByName ?? detail.header.returnedByName ?? detail.returnedByName ?? words['expenses.disbursement.removed_member'])
    .replace('{time}', formatThaiDateTime(at)),
    reason: reason ? words['expenses.disbursement.returned_reason'].replace('{reason}', reason) : null };
}
export function disbursementVoucherWaitingLines({ header }: DisbursementVoucherDetail): string[] {
  if (header.status !== 'PENDING_APPROVAL') return [];
  // The last reminder is said once, with the person's name, by disbursementReminderLast.
  return header.submittedAt ? [words['expenses.disbursement.submitted_at'].replace('{time}', formatThaiDateTime(header.submittedAt))] : [];
}
export function disbursementVoucherSenderSentence(detail: DisbursementVoucherDetail): string | null {
  const { header } = detail;
  if (header.status !== 'PENDING_APPROVAL' || !header.submittedAt) return null;
  const time = formatThaiDateTime(header.submittedAt);
  return detail.requestedApproverName
    ? words['expenses.disbursement.sent_to_wait'].replace('{name}', detail.requestedApproverName).replace('{time}', time)
    : words['expenses.disbursement.sent_to_wait_any'].replace('{time}', time);
}
export function disbursementReminderLast(detail: DisbursementVoucherDetail): string | null {
  if (!detail.header.lastReminderAt || detail.header.submittedAt && Date.parse(detail.header.lastReminderAt) < Date.parse(detail.header.submittedAt)) return null;
  return words['expenses.disbursement.remind_last']
    .replace('{name}', detail.lastReminderToName ?? words['expenses.disbursement.removed_member']).replace('{time}', formatThaiDateTime(detail.header.lastReminderAt));
}
export function disbursementCommandToast(kind: Exclude<DisbursementDialogKind, 'delete'>, header: DisbursementVoucherDetail['header'], viewerUserId: string | null | undefined, people: DisbursementApprover[]): string | null {
  const recipient = kind === 'remind' ? header.lastReminderToUserId : header.requestedApproverUserId;
  const name = people.find(person => person.userId === recipient)?.displayName;
  const notifiesApprover = Boolean(viewerUserId && recipient && recipient !== viewerUserId && name);
  if (kind === 'remind') return notifiesApprover ? words['expenses.disbursement.remind_sent'].replace('{name}', name!) : null;
  if (kind === 'selfApprove') return words['expenses.disbursement.self_sent'].replace('{number}', header.documentNumber!);
  if (kind === 'submit') return words[!header.selfApproved && notifiesApprover ? 'expenses.disbursement.sent_notified' : 'expenses.disbursement.sent']
    .replace('{number}', header.documentNumber!).replace('{name}', name ?? '');
  const notifiesPreparer = Boolean(viewerUserId && header.preparedByUserId !== viewerUserId);
  if (kind === 'approve') return words[notifiesPreparer && !header.selfApproved ? 'expenses.disbursement.approved_notified' : 'expenses.disbursement.approved_toast'];
  if (kind === 'return') return words[notifiesPreparer ? 'expenses.disbursement.returned_notified' : 'expenses.disbursement.returned_toast'];
  if (kind === 'withdraw') return words['expenses.disbursement.withdrawn_toast'];
  if (kind === 'cancel') return words['expenses.disbursement.cancelled_toast'].replace('{number}', header.documentNumber ?? '');
  return null;
}
