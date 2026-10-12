import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('./DisbursementVoucherCommandDialog.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./disbursement-vouchers.module.css', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../../../app/(workspace)/companies/[companyId]/expenses/disbursement-vouchers/[id]/page.tsx', import.meta.url), 'utf8');

test('document reads require read permission and remain reachable when the menu is hidden', () => {
  assert.match(page, /const canRead = permissions\.includes\('expense\.disbursement\.read'\)/);
  assert.match(page, /if \(!canRead\) return;[\s\S]*?getDisbursementVoucher\(companyId, id\)/);
  assert.match(page, /if \(!canRead\) return <ForbiddenState/);
  assert.doesNotMatch(page + route, /entryOpen|disbursementVoucherWebEntry|canOpenDisbursementVoucherWeb/);
  assert.match(route, /permissions=\{session\?\.permissions \?\? \[\]\}/);
});

test('missing and hidden documents share the not-found state with no existence hint', () => {
  assert.match(page, /status === 404 \? <EmptyState title=\{DISBURSEMENT_VOUCHER_ERROR_WORDS\.disbursement_not_found\} description=""/);
  assert.doesNotMatch(page, /requestId=|stackTrace|\.message\}|อาจถูกลบ/);
  assert.match(page, /if \(\(!canApply \|\| canApply\(\)\) && \(status === 403 \|\| status === 404\)\) \{ setDetail\(null\); setError\(failure\); \}/);
  for (const component of ['LoadingState', 'ErrorState', 'ForbiddenState']) assert.match(page, new RegExp(`<${component}`));
  assert.match(page, /onRetry=\{\(\) => setRetry/);
});

test('the named amount comes first, its make-up only when it differs, and source lines use shared money and date helpers', () => {
  assert.match(page, /styles\.amountLabel[\s\S]*?baht\(display\.amount\)[\s\S]*?!disbursementSameAmount\(summary\.gross, summary\.payout\) && <div>\s*<MoneyRow label=\{t\('expenses\.disbursement\.gross'[\s\S]*?<MoneyRow label=\{t\('expenses\.disbursement\.wht'/);
  assert.match(page, /formatThaiDate\(line\.expenseDate\)/);
  assert.match(page, /line\.vendorName\.trim\(\) !== header\.payeeName\.trim\(\)/);
  assert.match(page, /value=\{line\.outstandingAmount\}/);
  assert.match(page, /className=\{styles\.lineAmount\}>\{baht\(line\.amount\)\}/);
  assert.doesNotMatch(page, /h[-]screen|100v[h]/);
});

test('line cards show nullable one-line descriptions and link receipt access to the expense page for readers', () => {
  assert.match(page, /\{line\.description \?\? <span className="whitespace-nowrap">\{line\.expenseNumber\}<\/span>\}/);
  assert.match(page, /permissions\.includes\('expense\.read'\) && <Link href=\{`\/companies\/\$\{companyId\}\/expenses\/\$\{encodeURIComponent\(line\.expenseId\)\}`\} className=\{ghostClass\}>ดูใบเสร็จ<\/Link>/);
  assert.match(page, /line\.description &&/);
  assert.doesNotMatch(page, /#attachments|#files/);
});

test('one fixed primary follows server rights; edit, delete, take-back, cancel and history use the shared menu', () => {
  assert.match(page, /const primary = disbursementVoucherPrimary\(detail, viewerUserId\)/);
  assert.match(page, /<ThemedSteps steps=\{disbursementVoucherSteps\(header.status\)\}/);
  assert.doesNotMatch(page, /header\.origin !== 'DIRECT_PAYMENT'.*ThemedSteps/);
  // One extra action shows as itself; several sit behind the shared menu, hung from the right of the title row.
  assert.match(page, /menu.length === 1 \? moreEntries : menu.length > 1 && <MoreActions label=\{t\('expenses.disbursement.more', 'th'\)\} align="end">/);
  assert.match(page, /menu.map\(action => action === 'edit'/);
  assert.match(page, /new\?draft=\$\{encodeURIComponent\(id\)\}/);
  const bar = page.slice(page.indexOf('{(primary || hasSenderActions) && <div'), page.indexOf('{dialog &&'));
  assert.equal((bar.match(/className=\{cx\(btnClass/g) ?? []).length, 1);
  assert.match(bar, /setDialog\(primary\)/);
  assert.match(bar, /primary === 'selfApprove'[\s\S]*?setDialog\('submit'\)/);
  assert.match(bar, /detail.actions.return[\s\S]*?setDialog\('return'\)/);
  assert.match(css, /\.journeyBar \{ position: fixed;[\s\S]*?safe-area-inset-bottom/);
  assert.doesNotMatch(page + dialog, /reimbursement.*Steps/);
});

test('a pending sender sees sent-time copy and visible reminder, take-back, and optional self-approval actions', () => {
  assert.match(page, /const isSender = disbursementVoucherIsSender\(detail, viewerUserId\)/);
  assert.match(page, /isSender \? disbursementVoucherSenderSentence\(detail\)/);
  assert.match(page, /hasSenderActions = isSender && \(detail\.actions\.remind \|\| detail\.actions\.withdraw \|\| detail\.actions\.approve\)/);
  assert.match(page, /isSender && detail\.actions\.remind[\s\S]*?setDialog\('remind'\)/);
  assert.match(page, /isSender && detail\.actions\.withdraw[\s\S]*?setDialog\('withdraw'\)/);
  assert.match(page, /isSender && detail\.actions\.approve[\s\S]*?setDialog\('approve'\)/);
  assert.match(page, /sender_can_approve/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.sent_to_wait'], 'ส่งให้ {name} แล้ว เมื่อ {time} รออนุมัติ');
  assert.equal(workspaceDictionary.th['expenses.disbursement.sender_can_approve'], 'คุณมีสิทธิ์อนุมัติด้วย');
});

test('approval review keeps lines before the primary, with informational withholding and the payee basis', () => {
  assert.ok(page.indexOf('lines.map') < page.indexOf('{(primary || hasSenderActions) && <div'));
  assert.match(page, /disbursementPayeeBasisNote\(detail\)/);
  assert.doesNotMatch(dialog, /startedApproval/);
  assert.match(dialog, /kind === 'approve' \? word\('approve_confirm'\)/);
  assert.match(page, /header.status === 'PENDING_APPROVAL' && detail.actions.approve[\s\S]*?value=\{line.whtAmount\}/);
});

test('approver dialog loads eligible people, preselects one and has no send button for an empty list', () => {
  assert.match(dialog, /listDisbursementApprovers\(companyId, detail.header.branchId\)/);
  assert.match(dialog, /setApprover\(initialApprover\(data, preferredApprover\)\)/);
  assert.match(dialog, /people.length === 0 \? <p>\{word\('no_approvers'\)\}/);
  assert.match(dialog, /shownPeople.map\(person => <label/);
  assert.match(dialog, /checked=\{approver === person.userId\}/);
  assert.match(dialog, /const showAction = !choosingApprover \|\| !peopleLoading && !peopleError && people.length > 0/);
  assert.match(dialog, /\{showAction && <button/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.no_approvers'], 'ยังไม่มีผู้มีสิทธิ์อนุมัติใบของสาขานี้ ให้เจ้าของกิจการติ๊กสิทธิ์ "อนุมัติใบเตรียมจ่าย" ให้ตำแหน่งที่ต้องการที่หน้ากำหนดสิทธิ์ แล้วกลับมาส่งอีกครั้ง');
  assert.equal(workspaceDictionary.th['expenses.disbursement.send_help'], 'ผู้ที่เลือกจะได้รับแจ้งเตือน ผู้มีสิทธิ์อนุมัติคนอื่นก็อนุมัติได้เช่นกัน');
});

test('reminder menu opens the same dialog and waiting times follow the header sentence', () => {
  assert.match(page, /action === 'remind' \? 'expenses.disbursement.remind'/);
  assert.match(page, /setDialog\(action\)/);
  assert.match(page, /const waitingLines = isSender \? \[\] : disbursementVoucherWaitingLines\(detail\)/);
  assert.match(page, /\{next && <p>\{next\}<\/p>\}/);
  assert.match(page, /\{waitingLines.map\(line => <p key=\{line\}/);
  assert.match(dialog, /const choosingApprover = kind === 'submit' \|\| kind === 'remind'/);
  assert.match(dialog, /lastReminder && <p className=\{styles.muted\}>\{lastReminder\}/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind'], 'ส่งเตือนอีกครั้ง');
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind_title'], 'ส่งเตือนให้ใคร');
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind_send'], 'ส่งเตือน');
});

test('notice toasts compare the signed-in person from the route through the command dialog', () => {
  assert.match(route, /viewerUserId=\{session\?\.userId \?\? null\}/);
  assert.match(page, /kind=\{dialog\} viewerUserId=\{viewerUserId\}/);
  assert.match(dialog, /disbursementCommandToast\(kind, committed.current, viewerUserId, people\)/);
  assert.doesNotMatch(dialog, /toast.error/);
});

test('self-approval confirms its consequence and uses submit while the other-person link opens selection', () => {
  assert.equal(workspaceDictionary.th['expenses.disbursement.self_confirm'], 'ส่งและอนุมัติใบนี้เองเลย? ระบบจะบันทึกว่าอนุมัติเอง');
  assert.match(dialog, /selfApprove: submitDisbursementVoucher/);
  assert.match(dialog, /kind === 'selfApprove' && <p>\{word\('self_confirm'\)\}/);
  assert.match(dialog, /disbursementCommandToast\(kind, committed.current, viewerUserId, people\)/);
});

test('all dialogs retain typed reasons and show a refusal once inside, with latest-data recovery and no backdrop close', () => {
  assert.match(dialog, /closeOnBackdrop=\{false\}/);
  assert.match(page, /closeOnBackdrop=\{false\}/);
  assert.match(css, /\.modalFooter[\s\S]*?padding-bottom: env\(safe-area-inset-bottom\)/);
  // Seen at 390 px: without the full row the "w-full" buttons were half width, and a hint above the primary button blanked it.
  assert.match(css, /\.modalFooter \{[^}]*width: 100%/);
  assert.match(css, /\.journeyBarInner > button ~ button \{ background: transparent/);
  assert.doesNotMatch(css, /journeyBarInner > button:not\(:first-child\)/);
  assert.match(page, /detail.approvedByName \?\? t\('expenses.disbursement.removed_member'/);
  assert.match(page, /formatThaiDateTime\(header.approvedAt\)/);
  assert.match(dialog, /<CoverLoader active=\{busy\} scope="modal"/);
  assert.match(dialog, /value=\{reason\} required=\{kind !== 'withdraw'\} disabled=\{busy \|\| needsRefresh\}/);
  assert.match(dialog, /catch \(failure\) \{ setError\(failure\); \}/);
  assert.doesNotMatch(dialog, /catch[^{]*\{[^}]*setReason/);
  assert.equal((dialog.match(/apiErrorMessage\(error\)/g) ?? []).length, 1);
  assert.match(dialog, /stale && <button[\s\S]*?reload\(\)/);
  assert.match(dialog, /code === 'disbursement_approver_ineligible'[\s\S]*?setPeopleRetry\(n => n \+ 1\)/);
  assert.match(page, /getDisbursementVoucher\(companyId, id, \{ suppressErrorToast: true \}\)/);
});

test('take-back is optional, approved take-back requires reapproval, and cancel presents the safe choice first', () => {
  assert.equal(workspaceDictionary.th['expenses.disbursement.optional_reason'], 'เหตุผล (ไม่บังคับ)');
  assert.equal(workspaceDictionary.th['expenses.disbursement.withdraw_approved'], 'ต้องส่งอนุมัติใหม่อีกครั้ง');
  assert.match(dialog, /detail.header.status === 'APPROVED'[\s\S]*?withdraw_approved/);
  assert.match(dialog, /kind === 'return' \|\| kind === 'cancel'[\s\S]*?reason.trim\(\).length < 3/);
  const footer = dialog.slice(dialog.indexOf('footer={'), dialog.indexOf('<CoverLoader'));
  assert.ok(footer.indexOf('safeLabel') < footer.indexOf('dangerClass'));
  assert.equal(workspaceDictionary.th['expenses.disbursement.cancel_safe'], 'ไม่ยกเลิก');
  assert.match(dialog, /kind === 'cancel' && cancellationSentence &&/);
  assert.match(dialog, /if \(message\) toast.success\(message\)/);
});

test('attempt retries reuse command id, edits renew it, and completed commands only retry reading', () => {
  assert.match(dialog, /if \(inFlight.current \|\|/);
  assert.match(dialog, /inFlight.current = true; setBusy\(true\)/);
  assert.match(dialog, /nextDraftCommand\(commandId.current, false, \(\) => crypto.randomUUID\(\)\)/);
  assert.match(dialog, /const changeAttempt = \(\) => \{ commandId.current = null;/);
  assert.match(dialog, /changeAttempt\(\); setReason\(event.target.value\)/);
  assert.match(dialog, /changeAttempt\(\); setApprover\(person.userId\)/);
  assert.match(dialog, /if \(!committed.current\) committed.current = kind === 'remind'[\s\S]*?: await commands\[kind\]/);
  assert.match(dialog, /setNeedsRefresh\(true\);\s+await onReload\(\)/);
  assert.match(dialog, /aria-busy=\{busy\}/);
});

test('history opens in the shared sheet grouped by Thai day and time with names and reasons', () => {
  assert.match(page, /history.map\(group => <section/);
  assert.match(page, /formatThaiDate\(group.day\)/);
  assert.match(page, /formatThaiTime\(event.at\)/);
  assert.match(page, /event.actor &&/);
  assert.match(page, /event.recipient &&/);
  assert.match(page, /event.reason &&/);
  assert.doesNotMatch(page, /event\.(submittedByUserId|decidedByUserId)/);
});

test('draft deletion confirms exact copy and stays in the common command dialog', () => {
  for (const [key, copy] of [
    ['confirm_delete', 'ลบฉบับร่างนี้? รายจ่ายในใบจะไม่เปลี่ยนแปลง'],
    ['cancel_delete', 'ไม่ลบ'], ['delete', 'ลบฉบับร่าง'], ['deleted', 'ลบฉบับร่างแล้ว'],
  ] as const) assert.equal(workspaceDictionary.th[`expenses.disbursement.${key}`], copy);
  assert.match(dialog, /kind === 'delete' && <p>\{word\('confirm_delete'\)\}/);
  assert.match(dialog, /await deleteDisbursementVoucherDraft\(companyId, detail.header.id\);\s+toast.success\(word\('deleted'\)\); onDeleted\(\)/);
  assert.match(page, /onDeleted=\{\(\) => router.push\(listHref\)\}/);
});
