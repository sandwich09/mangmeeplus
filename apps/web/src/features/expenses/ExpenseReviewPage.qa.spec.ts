import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import { translateApiError } from '../../common/api/api-error-message';
import { CLAIM_EXPENSE_RECORD_NOTE, canDeleteExpense, claimExpenseRecordNote, isClaimExpenseRecord } from './expenses.model';

const source = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');

test('expense confirmation toast does not promise ledger posting', () => {
  assert.match(source, /ยืนยันเอกสารแล้ว/);
  assert.doesNotMatch(source, /ยืนยันและลงบัญชีเรียบร้อยแล้ว/);
  assert.doesNotMatch(workspaceDictionary.th['expenses.no_receipt_banner'], /ลงบัญชี/);
  for (const key of ['expenses.substitute_wizard.done_next_confirm', 'expenses.substitute_wizard.back_to_expense'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /บัญชี/);
    assert.doesNotMatch(workspaceDictionary.en[key], /accounting|post/i);
  }
});

test('substitute receipt waiting copy does not claim unverified LINE delivery', () => {
  assert.doesNotMatch(workspaceDictionary.th['expenses.substitute_wizard.waiting_help'], /ส่ง.*LINE.*แล้ว/);
  assert.doesNotMatch(workspaceDictionary.en['expenses.substitute_wizard.waiting_help'], /sent.*LINE notification/);
  for (const locale of ['th', 'en'] as const) {
    assert.match(workspaceDictionary[locale]['expenses.substitute_wizard.waiting_help'], /ลิงก์|link/);
  }
});

test('duplicate guidance does not tell a read-only resolver to click an unavailable action', () => {
  assert.doesNotMatch(workspaceDictionary.th['expenses.duplicate_action_required'], /ต้องกด/);
  assert.match(workspaceDictionary.th['expenses.duplicate_action_required'], /ผู้มีสิทธิ์/);
  assert.doesNotMatch(workspaceDictionary.en['expenses.duplicate_action_required'], /you must click/i);
  assert.match(workspaceDictionary.en['expenses.duplicate_action_required'], /authorized reviewer/i);
});

test('confirmed duplicate copy distinguishes the final decision from an unresolved warning', () => {
  assert.match(source, /const isConfirmedDuplicate = detail\.duplicateStatus === 'CONFIRMED_DUPLICATE'/);
  assert.match(source, /isConfirmedDuplicate \? 'expenses\.duplicate_confirmed_title' : 'expenses\.duplicate_warning_title'/);
  assert.match(source, /isConfirmedDuplicate \? 'expenses\.duplicate_confirmed_block' : 'expenses\.duplicate_action_required'/);
  assert.match(source, /hasDuplicates, isConfirmedDuplicate, needsReceiptOrSubstitute/);
  assert.equal((source.match(/title=\{confirmBlockedText \?\? undefined\}/g) ?? []).length, 2);
  assert.equal((source.match(/\{confirmBlockedNotice\}/g) ?? []).length, 1);
  assert.match(source, /\{duplicateBlockMessage\}<\/p>/);
  assert.match(workspaceDictionary.th['expenses.duplicate_confirmed_block'], /ไม่สามารถยืนยันค่าใช้จ่ายซ้ำได้/);
  assert.match(workspaceDictionary.en['expenses.duplicate_confirmed_block'], /cannot be confirmed again/);
});

/**
 * Spec §17.6 (W02-web). A read that ENDED without reading the document offers no way to read it
 * again: the file is saved and the way on is this form. Both reread buttons therefore hang off
 * `readAgainAllowed`, which is the tested rule in expense-capture-status.logic.spec.ts.
 */
test('neither reread button survives a terminal read failure or an error notice', () => {
  assert.equal((source.match(/readAgainAllowed/g) ?? []).length, 3, 'one rule, both buttons, one definition');
  assert.doesNotMatch(source, /\{canExtract && \(\s*<button/);
  assert.match(source, /captureReadAgainAllowed\(\{\s*canExtract, readStatus: readState\?\.status \?\? null, noticeTone: notice\?\.tone \?\? null,/);
  for (const key of ['expenses.extract_failed', 'expenses.upload_extract_failed_suffix', 'expenses.extract_no_attachment'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /อ่านเอกสารอีกครั้ง|ลองอ่าน/, key);
  }
  assert.match(workspaceDictionary.th['expenses.extract_failed'], /เก็บไฟล์ไว้แล้ว/);
});

test('the read state is shown beside the file, not only as a toast', () => {
  const notices = source.slice(source.indexOf('const noticesBlock = ('), source.indexOf('const postingCard'));
  assert.match(notices, /readNotice && \(readNotice\.tone === 'error'/);
  assert.match(notices, /aiMap\?\.\['sourceStale'\] === true && <InfoBanner message=\{t\('expenses\.capture\.source_stale'/);
  assert.doesNotMatch(notices, /toast\./, 'a persisted notice, not a toast that scrolls away');
});

test('polling follows the durable job and never starts a read of its own', () => {
  assert.match(source, /if \(!detail\?\.primaryAttachmentId\) return;/);
  assert.match(source, /getExpenseReadStatus\(companyId, expenseId\)/);
  assert.match(source, /if \(\(file\?\.status === 'DONE' \|\| file\?\.status === 'PARTIAL'\) && file\.applied !== false\)/);
  assert.match(source, /}, 3_000\);/);
});

/** Spec §16.4: the two file intents, each with the identity the server checks. */
test('replace carries the revision, the expected primary and a reused operation id', () => {
  const replace = source.slice(source.indexOf('const attachPrimaryReceipt'), source.indexOf('const appendSupportingReceipt'));
  assert.match(replace, /intent: 'replace'/);
  assert.match(replace, /expectedUpdatedAt: detail\.updatedAt/);
  assert.match(replace, /expectedPrimaryAttachmentId: detail\.primaryAttachmentId/);
  assert.match(replace, /operationId,/);
  assert.match(source, /const key = `\$\{intent\}:\$\{revision\}:\$\{file\.name\}:\$\{file\.size\}`/);
});

test('append adds supporting evidence and never names a primary to swap', () => {
  const append = source.slice(source.indexOf('const appendSupportingReceipt'), source.indexOf('const checkDuplicates'));
  assert.match(append, /'expense\.receipt\.supporting'/);
  assert.match(append, /intent: 'append', expectedUpdatedAt: detail\.updatedAt, operationId/);
  assert.doesNotMatch(append, /expectedPrimaryAttachmentId/);
});

test('a conflict offers the latest data instead of a silent retry', () => {
  assert.match(source, /code === 'expense_revision_conflict' \|\| code === 'expense_receipt_replace_conflict'/);
  assert.match(source, /\{\(error \|\| paymentNotice \|\| correctionError\) && conflictReload && \(/);
  assert.match(source, /expenses\.capture\.reload_latest/);
});

test('more than one document in a file says what was created, not where to go (appendix §25)', () => {
  // The READ JOB decides it whenever there is one — the API derives `multiDocument` from the
  // assembled observation, which is the same fact the split ran on. The OCR classification stays
  // only for the synchronous single-image lane, which has no job at all.
  assert.match(source, /readState\s*\?\s*readState\.multiDocument === true/);
  assert.match(source, /contentKind === 'MULTI_DOCUMENT'/);
  // …and a DONE the API says was NOT applied does not send the page to re-read an unchanged draft.
  assert.match(source, /file\?\.status === 'DONE' \|\| file\?\.status === 'PARTIAL'\) && file\.applied !== false/);
  // The ids come off the job, so the notice can never promise records the engine did not create.
  assert.match(source, /const splitExpenseIds = readState\?\.splitExpenseIds \?\? \[\];/);
  assert.match(source, /t\('expenses\.capture\.auto_split', locale\)\.replace\('\{count\}'/);
  assert.match(source, /href=\{`\/companies\/\$\{companyId\}\/expenses\/\$\{encodeURIComponent\(id\)\}`\}/);
  assert.match(workspaceDictionary.th['expenses.capture.auto_split'], /สร้างรายการเพิ่มให้แล้ว/);
  // No button, no second screen, and nothing that navigates to a capture group.
  assert.equal(source.includes('expenses.capture.split_to_group'), false);
  assert.equal(source.includes('convertExpenseToCaptureGroup'), false);
  assert.equal(source.includes('/expenses/capture/'), false);
});

// DETAIL-2a: this card shows the total, not a second arithmetic breakdown; the form keeps the lines.
test('the review metrics use the live total including charges and rounding, plus applicable tax amounts', () => {
  const card = source.slice(source.indexOf('const moneyCard ='), source.indexOf('const vendorCard ='));
  assert.match(card, /<MetricGrid columns=\{2\}/);
  assert.match(card, /label: 'ยอดรวม', value: amountText\(money.grandTotalAmount\), unit: 'บาท'/);
  assert.match(card, /moneyHasVat[\s\S]*amountText\(money.vatAmount\)/);
  assert.match(card, /moneyHasWht[\s\S]*amountText\(money.whtAmount\)[\s\S]*amountText\(money.netPayableAmount\)/);
  assert.doesNotMatch(card, /<MoneyRow|<StatusBadge|bg-brand-50/);
  for (const locale of ['th', 'en'] as const) {
    assert.ok(workspaceDictionary[locale]['expenses.charges_total'].trim().length > 0);
  }
  // Customer-facing Thai carries no "+" characters (spec §3).
  for (const key of ['expenses.charges_total', 'expenses.charges_section', 'expenses.add_charge', 'expenses.no_charges'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /\+/, key);
  }
});

/**
 * §5.1 read side. The money rows are the stored header while the lines are stored separately, so a
 * record written before that rule — or by anything bypassing the draft use-cases — can have the two
 * disagree. Printing the header alone would state a total its own lines contradict.
 */
test('the money card warns when the stored record does not add up', () => {
  assert.match(source, /detail\.totalsIdentity\?\.ok === false && \(/);
  assert.match(source, /t\('expenses\.totals_identity_warning', locale\)/);
  // Branch on `ok`: a subtotal-only drift has a correct grand total and therefore a zero gap.
  assert.doesNotMatch(source, /totalsIdentity\.gapAmount\s*(!==|===|>|<)/);
  for (const locale of ['th', 'en'] as const) {
    assert.ok(workspaceDictionary[locale]['expenses.totals_identity_warning'].trim().length > 0);
  }
  assert.doesNotMatch(workspaceDictionary.th['expenses.totals_identity_warning'], /\+/);
});

// WHT certificate system issuance plan §4.2: both confirm buttons (guided step + approver-only)
// must go through the SAME handler, so the post-confirm WHT prompt logic lives in exactly one
// place — not duplicated per button, which could drift.
test('both confirm buttons call the shared doConfirm handler, not a duplicated inline confirmExpense', () => {
  assert.equal((source.match(/onClick=\{\(\) => void doConfirm\(\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /onClick=\{\(\) => doAction\(\(\) => confirmExpense/);
});

test('the persistent WHT action uses the same server capability after confirmation and on later visits', () => {
  assert.match(source, /canIssueExpenseWhtCertificate\(detail, whtHandoff, uiPermissions\)/);
  assert.doesNotMatch(source, /whtIssuePrompt/);
});

test('issuing from the persistent action downloads the PDF immediately and reloads the expense blockers', () => {
  assert.match(source, /await issueSystemWhtCertificate\(companyId, whtHandoff\.id, \{ paymentId \}\)/);
  assert.match(source, /downloadArtifact\(result\.pdfArtifact\)/);
  assert.match(source, /setWhtHandoff\(\{ \.\.\.whtHandoff, status: 'SYSTEM_ISSUED'/);
});

test('the handoff is re-read for every confirmed withholding revision and includes required and issued documents', () => {
  assert.match(source, /detail\.status !== 'CONFIRMED' \|\| !\(Number\(detail\.whtAmount\) > 0\)/);
  assert.match(source, /listWhtHandoffs\(companyId, \{ sourcePaymentId: expenseId \}\)/);
  assert.match(source, /detail\?\.updatedAt, permissions/);
});

test('the correction form and replacement button render through the shared accounts-payable-mirrored predicates', () => {
  assert.match(source, /\{canCorrectWhtCertificate\(whtHandoff, uiPermissions\) && \(/);
  assert.match(source, /\{!correctOpen && canIssueWhtReplacementCopy\(whtHandoff, uiPermissions\) && \(/);
});

test('correcting calls the correction endpoint and downloads the returned PDF immediately, requiring a reason', () => {
  assert.match(source, /await correctSystemWhtCertificate\(companyId, whtHandoff\.id, \{/);
  assert.match(source, /disabled=\{correctBusy \|\| !correctForm\.reason\.trim\(\) \|\| !correctionHasChanges\}/);
});

test('issuing a replacement copy calls the replacement-copy endpoint with no form', () => {
  assert.match(source, /await issueSystemWhtReplacementCopy\(companyId, whtHandoff\.id\)/);
});

/**
 * A claim's expense record ends with its claim: cancelling the claim voids it. The API refuses to void,
 * reject or delete it from the expense screen, which used to strand the claim. So the screen offers none
 * of the three for such a record, whatever the viewer holds, and says where to go instead.
 */
test('a claim\'s expense record offers no void, reject or delete here, and says where to cancel it', () => {
  const claimRecord = { status: 'REJECTED', grandTotalAmount: '100.00', paymentStatus: 'UNPAID', createdByUserId: 'u1', sourceReimbursementRequestId: 'claim-1' } as const;
  const everything = { canDelete: true, canUpdate: true };
  assert.equal(isClaimExpenseRecord(claimRecord), true);
  assert.equal(isClaimExpenseRecord({ sourceReimbursementRequestId: null }), false);
  assert.equal(isClaimExpenseRecord({}), false);
  // The same rejected record with no claim is deletable; the claim's own is not, even for its creator with every right.
  assert.equal(canDeleteExpense({ ...claimRecord, sourceReimbursementRequestId: null }, 'u1', everything), true);
  assert.equal(canDeleteExpense(claimRecord, 'u1', everything), false);

  // The page takes all three from that one rule.
  assert.match(source, /const claimRecord = isClaimExpenseRecord\(detail\);/);
  assert.match(source, /const canReject = caps\.canReject && !claimRecord;/);
  assert.equal((source.match(/caps\.canReject/g) ?? []).length, 1, 'the reject button reads the gated flag everywhere');
  assert.match(source, /const canCancelFinancialExpense = !claimedSource && !claimRecord && canVoidExpenseFinancialState\(detail\);/);
  assert.match(source, /const canDelete = canDeleteExpense\(detail, userId, caps\);/);
  // And it says where to go, with a link to the claim.
  assert.match(source, /const claimNote = claimExpenseRecordNote\(detail\);/);
  assert.match(source, /\{claimNote && <span[^>]*>\{claimNote\}<\/span>\}/);
  assert.match(source, /\{claimRecord && <Link[^>]*href=\{`\/companies\/\$\{companyId\}\/reimbursements\/\$\{detail\.sourceReimbursementRequestId\}`\}>เปิดใบเบิก<\/Link>\}/);
  // The note is for a record that can still be ended. Cancelling the claim leaves its records voided: there
  // the link stays and the note goes, because nothing is left to cancel, here or at the claim.
  for (const status of ['READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED']) assert.equal(claimExpenseRecordNote({ ...claimRecord, status }), CLAIM_EXPENSE_RECORD_NOTE, status);
  assert.equal(claimExpenseRecordNote({ ...claimRecord, status: 'VOIDED' }), null);
  assert.equal(claimExpenseRecordNote({ ...claimRecord, sourceReimbursementRequestId: null }), null);
  for (const text of [CLAIM_EXPENSE_RECORD_NOTE, translateApiError('expense_belongs_to_reimbursement')!]) {
    assert.match(text, /ให้ยกเลิกที่ใบเบิกในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง/u);
    assert.doesNotMatch(text, /[A-Za-z_]{3,}/u, 'plain Thai: no code or key');
  }
});


test('PWS-WORDS accepted VAT differences name the actual confirm button without promising posting', () => {
  const form = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
  assert.match(form, /กด “ยืนยันเอกสาร” เพื่อใช้ยอดตามเอกสารและเก็บเหตุผลไว้/);
  assert.doesNotMatch(form, /กด “ยืนยันและลงบัญชี”/);
});


test('PWS-MONEY names VAT and withholding calculation amounts without changing the fields', () => {
  const words = workspaceDictionary.th;
  assert.equal(words['expenses.taxable_base'], 'ยอดที่ใช้คิด VAT');
  assert.equal(words['expenses.taxable_base_ex_vat'], 'ยอดก่อน VAT');
  assert.equal(words['expenses.vat'], 'VAT');
  assert.equal(words['expenses.wht_base'], 'ยอดที่ใช้คิดหัก ณ ที่จ่าย (บาท)');
  assert.equal(words['expenses.v_wht_base'], 'กรอกยอดที่ใช้คิดหัก ณ ที่จ่ายตั้งแต่ 0 และทศนิยมไม่เกิน 2 ตำแหน่ง');
});

test('PWS-CAPTURE describes draft preparation without promising reading, accounting or a refund', () => {
  assert.equal(workspaceDictionary.th['expenses.upload_what_desc'], 'ส่งใบเสร็จให้ระบบอ่านและเก็บเป็นร่างเพื่อตรวจ');
  assert.equal(workspaceDictionary.th['expenses.check_bill_accounting_details'], 'ประเภทเอกสาร VAT และหมวดค่าใช้จ่าย');
  assert.equal(workspaceDictionary.th['expenses.tab_categories_desc'], 'จัดกลุ่มค่าใช้จ่ายให้ค้นหาและส่งให้ผู้ทำบัญชี');
});
