import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
const history = readFileSync(new URL('./disbursement-voucher-journey.logic.ts', import.meta.url), 'utf8');
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

test('the named amount comes first, gross and positive withholding in metrics, and source lines use shared money and date helpers', () => {
  assert.match(page, /styles.mainCard[\s\S]*?ยอดที่จ่าย[\s\S]*?amountText\(display.amount\)[\s\S]*?hasWht &&[\s\S]*?รวมเป็นเงิน[\s\S]*?หัก ณ ที่จ่าย/);
  assert.doesNotMatch(page, /<MetricGrid/);
  assert.match(page, /formatThaiDate\(line\.expenseDate\)/);
  assert.match(page, /line\.vendorName\.trim\(\) !== header\.payeeName\.trim\(\)/);
  assert.match(page, /amountText\(line.outstandingAmount\)/);
  assert.match(page, /amountText\(line.amount\)/);
  assert.doesNotMatch(page, /h[-]screen|100v[h]/);
});

test('line cards show nullable one-line descriptions and link receipt access to the expense page for readers', () => {
  assert.match(page, /<strong>\{line.description \?\? line.expenseNumber\}/);
  assert.match(page, /permissions.includes\('expense.read'\) \? <Link[\s\S]*?aria-label=\{`เปิดรายจ่าย \$\{line.expenseNumber/);
  // The link opens the expense, not the picture of its receipt: its name says so.
  assert.equal(workspaceDictionary.th['expenses.disbursement.open_expense'], 'เปิดรายจ่าย');
  assert.match(page, /className=\{styles.documentLine\}/);
  assert.doesNotMatch(page, /#attachments|#files/);
});

test('one fixed primary follows server rights; edit, delete, take-back, cancel and history use the shared menu', () => {
  assert.match(page, /const offeredPrimary = disbursementVoucherPrimary\(detail, viewerUserId\)/);
  assert.match(page, /<ThemedSteps steps=\{disbursementVoucherSteps\(header.status\)\}/);
  assert.doesNotMatch(page, /header\.origin !== 'DIRECT_PAYMENT'.*ThemedSteps/);
  // One extra action shows as itself; several sit behind the shared menu, hung from the right of the title row.
  assert.match(page, /menu.length === 1 \? moreEntries : menu.length > 1 && <MoreActions label=\{t\('expenses.disbursement.more', 'th'\)\} align="end">/);
  // Editing is the commonest act on a draft: it is shown as itself beside the menu, never inside it.
  assert.match(page, /disbursementVoucherMenu\(detail\).filter\(action => action !== 'edit'\)/);
  assert.match(page, /editHref && <Link href=\{editHref\} className=\{ghostClass\}>\{t\('common.edit', 'th'\)\}/);
  assert.match(page, /new\?draft=\$\{encodeURIComponent\(id\)\}/);
  const bar = page.slice(page.indexOf('{(primary || hasSenderActions) && <div'), page.indexOf('{dialog &&'));
  assert.equal((bar.match(/className=\{cx\(btnClass/g) ?? []).length, 1);
  assert.match(bar, /setDialog\(primary\)/);
  assert.doesNotMatch(bar, /send_other|setDialog\('submit'\)/);
  assert.match(page, /offeredPrimary === 'selfApprove' \? sendChoice : offeredPrimary/);
  assert.match(bar, /detail.actions.return && <button[\s\S]*?setDialog\('return'\)/);
  assert.match(css, /\.journeyBar \{ position: fixed;[\s\S]*?safe-area-inset-bottom/);
  assert.doesNotMatch(page + dialog, /reimbursement.*Steps/);
});

test('a pending sender sees sent-time copy and visible reminder, take-back, and optional self-approval actions', () => {
  assert.match(page, /const isSender = disbursementVoucherIsSender\(detail, viewerUserId\)/);
  assert.doesNotMatch(page, /จัดทำและส่งโดย/);
  assert.match(history, /header.submittedAt[\s\S]*?detail.submittedByName/);
  assert.match(page, /hasSenderActions = isSender && \(detail\.actions\.remind \|\| detail\.actions\.approve\)/);
  assert.match(page, /isSender && detail\.actions\.remind[\s\S]*?setDialog\('remind'\)/);
  assert.match(page, /isSender && detail\.actions\.approve[\s\S]*?setDialog\('approve'\)/);
  // The sender's bar is one group of two: reminding and approving. Taking the document back is in the menu, and she is never offered to send her own document back.
  const senderBar = page.slice(page.indexOf('{(primary || hasSenderActions) && <div'), page.indexOf('{dialog &&'));
  assert.match(senderBar, /hasSenderActions && <ActionGroup>/);
  assert.doesNotMatch(senderBar, /setDialog\('withdraw'\)/);
  assert.match(page, /action === 'withdraw' \? 'expenses.disbursement.withdraw'/);
  assert.doesNotMatch(page, /sender_can_approve/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.sent_to_wait'], 'ส่งให้ {name} แล้ว เมื่อ {time} รออนุมัติ');
  assert.equal(workspaceDictionary.th['expenses.disbursement.sender_can_approve'], 'คุณมีสิทธิ์อนุมัติด้วย');
});

test('approval review keeps lines before the primary, with informational withholding and the payee basis', () => {
  assert.ok(page.indexOf('lines.map') < page.indexOf('{(primary || hasSenderActions) && <div'));
  assert.match(page, /disbursementPayeeBasisNote\(detail\)/);
  assert.doesNotMatch(dialog, /startedApproval/);
  assert.match(dialog, /word\(kind === 'approve' \? 'approve_confirm' : 'self_confirm_title'\)/);
  assert.match(page, /Number\(line.whtAmount\) > 0[\s\S]*?amountText\(line.whtAmount\)/);
});

test('approver dialog loads eligible people, preselects one and has no send button for an empty list', () => {
  assert.match(dialog, /listDisbursementApprovers\(companyId, detail.header.branchId\)/);
  assert.match(dialog, /setApprover\(canSelfApprove \? viewerUserId! : initialApprover\(data, preferredApprover\)\)/);
  assert.match(dialog, /people.length === 0 \? <p>\{word\('no_approvers'\)\}/);
  assert.match(dialog, /shownPeople.map\(person => <ChoiceRow/);
  assert.match(dialog, /checked=\{approver === person.userId\}/);
  assert.match(dialog, /const showAction = !choosingApprover \|\| !peopleLoading && !peopleError && people.length > 0/);
  assert.match(dialog, /\{showAction && <button/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.no_approvers'], 'ยังไม่มีผู้มีสิทธิ์อนุมัติใบของสาขานี้ ให้เจ้าของกิจการติ๊กสิทธิ์ "อนุมัติใบเตรียมจ่าย" ให้ตำแหน่งที่ต้องการที่หน้ากำหนดสิทธิ์ แล้วกลับมาส่งอีกครั้ง');
  assert.equal(workspaceDictionary.th['expenses.disbursement.send_help'], 'ผู้ที่เลือกจะได้รับแจ้งเตือน ผู้มีสิทธิ์อนุมัติคนอื่นก็อนุมัติได้เช่นกัน');
});

test('reminder menu opens the same dialog and waiting times follow the header sentence', () => {
  assert.match(page, /action === 'remind' \? 'expenses.disbursement.remind'/);
  assert.match(page, /setDialog\(action\)/);
  assert.match(page, /header.status === 'PENDING_APPROVAL' && \(detail.requestedApproverName \|\| lastReminder\)/);
  // A sent-back draft leads with its notice; the standing instruction is not printed above it.
  assert.doesNotMatch(page, /disbursementVoucherNextSentence/);
  assert.match(page, /detail.requestedApproverName && lastReminder[\s\S]*?\{lastReminder\}/);
  assert.match(dialog, /const choosingApprover = kind === 'submit' \|\| kind === 'remind'/);
  assert.match(dialog, /lastReminder && <p className=\{styles.muted\}>\{lastReminder\}/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind'], 'ส่งเตือนอีกครั้ง');
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind_title'], 'ส่งเตือนให้ใคร');
  assert.equal(workspaceDictionary.th['expenses.disbursement.remind_send'], 'ส่งเตือน');
});

test('notice toasts compare the signed-in person from the route through the command dialog', () => {
  assert.match(route, /viewerUserId=\{session\?\.userId \?\? null\}/);
  assert.match(page, /kind=\{dialog\} viewerUserId=\{viewerUserId\}/);
  assert.match(dialog, /disbursementCommandToast\(kind === 'submit' && effectiveKind === 'selfApprove' \? 'selfApprove' : kind, committed.current, viewerUserId, people\)/);
  assert.doesNotMatch(dialog, /toast.error/);
});

test('self-approval confirms its consequence and the one send button opens selection', () => {
  // The question names the amount and the payee in its title, like the approver's question; the body is the consequence.
  assert.equal(workspaceDictionary.th['expenses.disbursement.self_confirm_title'], 'อนุมัติจ่าย {total} ให้ {payee} เองเลย?');
  assert.equal(workspaceDictionary.th['expenses.disbursement.self_confirm'], 'ระบบจะบันทึกว่าอนุมัติเอง');
  assert.match(dialog, /selfApprove: submitDisbursementVoucher/);
  assert.match(dialog, /effectiveKind === 'selfApprove' && <p>\{word\('self_confirm'\)\}/);
  assert.match(dialog, /disbursementCommandToast\(kind === 'submit' && effectiveKind === 'selfApprove' \? 'selfApprove' : kind, committed.current, viewerUserId, people\)/);
});

test('all dialogs retain typed reasons and show a refusal once inside, with latest-data recovery and no backdrop close', () => {
  assert.match(dialog, /closeOnBackdrop=\{false\}/);
  assert.match(page, /closeOnBackdrop=\{false\}/);
  // The footers are plain buttons: the shared dialog lays them out at one size and adds the phone's safe area.
  assert.match(dialog, /footer=\{<>\s*<button type="button" className=\{ghostClass\}/);
  assert.doesNotMatch(page + dialog + css, /modalFooter|w-full sm:w-auto/);
  // Seen at 390 px: a hint above the primary button blanked it.
  assert.match(css, /\.journeyBarInner > button ~ button \{ background: transparent/);
  assert.doesNotMatch(css, /journeyBarInner > button:not\(:first-child\)/);
  assert.match(history, /header.approvedAt[\s\S]*?actor: person\(detail.approvedByName\)/);
  assert.match(dialog, /<CoverLoader active=\{busy\} scope="modal"/);
  assert.match(dialog, /value=\{reason\} required disabled=\{busy \|\| needsRefresh\}/);
  assert.match(dialog, /catch \(failure\) \{ setError\(failure\); \}/);
  assert.doesNotMatch(dialog, /catch[^{]*\{[^}]*setReason/);
  assert.equal((dialog.match(/apiErrorMessage\(error\)/g) ?? []).length, 1);
  assert.match(dialog, /stale && <button[\s\S]*?reload\(\)/);
  assert.match(dialog, /code === 'disbursement_approver_ineligible'[\s\S]*?setPeopleRetry\(n => n \+ 1\)/);
  assert.match(page, /getDisbursementVoucher\(companyId, id, \{ suppressErrorToast: true \}\)/);
});

test('take-back has no reason field, approved take-back requires reapproval, and cancel presents the safe choice first', () => {
  assert.match(dialog, /\(kind === 'return' \|\| kind === 'cancel'\) && <TextareaField/);
  assert.doesNotMatch(dialog, /optional_reason|kind === 'withdraw'[^\n]*TextareaField/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.withdraw_approved'], 'ต้องส่งอนุมัติอีกครั้ง');
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
  assert.match(page, /formatThaiDateTime\(event.at\)/);
  assert.match(page, /event.actor &&/);
  assert.match(page, /event.recipient &&/);
  assert.match(page, /event.reason &&/);
  assert.doesNotMatch(page, /event\.(submittedByUserId|decidedByUserId)/);
});

test('draft deletion confirms exact copy and stays in the common command dialog', () => {
  for (const [key, copy] of [
    ['cancel_delete', 'ไม่ลบ'], ['delete', 'ลบร่าง'], ['deleted', 'ลบร่างแล้ว'],
  ] as const) assert.equal(workspaceDictionary.th[`expenses.disbursement.${key}`], copy);
  assert.match(dialog, /kind === 'delete' \? 'ลบร่างใบเตรียมจ่ายนี้\?'/);
  assert.match(dialog, /\(kind === 'delete' \|\| kind === 'cancel'\) && <><p>\{detail.header.payeeName\}<\/p><p>\{baht\(detail.header.totalAmount\)\}/);
  assert.match(dialog, /await deleteDisbursementVoucherDraft\(companyId, detail.header.id\);\s+toast.success\(word\('deleted'\)\); onDeleted\(\)/);
  assert.match(page, /onDeleted=\{\(\) => router.push\(listHref\)\}/);
});

test('document number precedes the payee heading with one status beneath', () => {
  assert.match(page, /eyebrow=\{<span[\s\S]*?header.documentNumber[\s\S]*?title=\{header.payeeName\} description=\{<span ref=\{statusHeading\}/);
  assert.match(page, /document.title = pageTitle/);
  assert.doesNotMatch(page, /styles.documentNumber|DISBURSEMENT_VOUCHER_WORDS.oncePaid/);
});
test('draft has one send action in ActionGroup and untyped questions close', () => {
  const group = page.slice(page.indexOf('{primary && <ActionGroup>'), page.indexOf('</ActionGroup>', page.indexOf('{primary && <ActionGroup>')));
  assert.equal((group.match(/setDialog\(primary\)/g) ?? []).length, 1);
  assert.doesNotMatch(group, /send_other|primary === 'selfApprove' && detail.actions.submit/);
  assert.match(dialog, /kind === 'return' \? t\('common.cancel', 'th'\) : t\('common.close', 'th'\)/);
});

test('inactive authors remain named and owner recovery appears at the top with the number joined to its label', () => {
  assert.match(history, /person\(detail.preparerName\)/);
  assert.match(history, /person\(detail.submittedByName\)/);
  assert.match(history, /ปิดใช้งานแล้ว/);
  assert.match(page, /ปิดใช้งานแล้ว/);
  assert.match(page, /orphaned && <Notice/);
  assert.match(page, /detail.actions.withdraw && <button[^>]+onClick=\{\(\) => setDialog\('withdraw'\)\}/);
  assert.match(page, /className="mangmee-unit">\{paid[\s\S]*?header.documentNumber \?\? 'ยังไม่มีเลขที่'/);
});
