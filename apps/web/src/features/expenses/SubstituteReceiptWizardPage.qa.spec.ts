import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./SubstituteReceiptWizardPage.tsx', import.meta.url), 'utf8');

test('pending certificates expose the existing guarded cancellation and revision history', () => {
  assert.ok(source.includes('{!editingPrepared && renderVersionHistory()}'));
  assert.ok(source.includes("canReview && receiptEvidence.status !== 'SUPERSEDED'"));
  assert.ok(source.includes("['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status)"));
  const supersede = source.slice(source.indexOf('const supersede = async'), source.indexOf('const copyWizardLink'));
  assert.ok(supersede.includes("setActiveStep('done')"));
});

test('a cancelled version does not claim successful issuance or offer confirmation next steps', () => {
  const cancelled = source.slice(source.indexOf('const renderCancelledCertificate'), source.indexOf('const renderIssuedCertificate'));
  const issued = source.slice(source.indexOf('const renderIssuedCertificate'), source.indexOf('const renderDoneStep'));
  // The done step shows the issued view for an issued certificate only.
  assert.ok(source.includes("const renderDoneStep = () => (receiptEvidence?.status === 'ISSUED' ? renderIssuedCertificate() : renderCancelledCertificate());"));
  // The cancelled view says it was cancelled and carries none of the issued view's success or next steps.
  assert.ok(cancelled.includes("'expenses.substitute_hub.status_superseded'"));
  for (const issuedOnly of ['done_title', 'done_next_confirm', 'back_to_expense', 'download_pdf', 'status_issued', 'tone="success"', 'สร้างใบเบิกจากใบนี้']) {
    assert.equal(cancelled.includes(issuedOnly), false, issuedOnly);
  }
  // The next step of an issued certificate depends on whose money paid: confirm the expense, or claim it back.
  assert.ok(issued.includes('const nextIsConfirm = !personalAdvance && expenseAwaitsConfirmation;'));
  assert.ok(issued.includes('{personalAdvance && ('));
});

test('cancelling a certificate is asked once, through the one dialog, on the certificate page only', () => {
  const hub = readFileSync(new URL('./SubstituteReceiptHubPage.tsx', import.meta.url), 'utf8');
  const dialog = readFileSync(new URL('./SubstituteReceiptCancelDialog.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('<SubstituteReceiptCancelDialog'));
  // No second confirmation and no one-press cancel beside it.
  assert.equal(source.includes('ยืนยันยกเลิกเอกสารอีกครั้ง'), false);
  assert.equal(source.includes('run(supersede)'), false);
  // The list opens the certificate; it does not cancel from a row menu any more.
  assert.equal(hub.includes('supersedeSubstituteReceipt'), false);
  assert.equal(hub.includes('role="menu"'), false);
  // Title names the document, the two buttons name the two outcomes, a typed reason is guarded.
  assert.ok(dialog.includes('title={`ยกเลิกใบรับรอง ${documentNumber}`}'));
  assert.ok(dialog.includes('>ไม่ยกเลิก</button>'));
  assert.ok(dialog.includes('>ยกเลิกใบรับรอง</button>'));
  assert.ok(dialog.includes("dirty={reason.trim() !== '' && !busy}"));
});

// W06 §12.3 (the two ways back to the capture group) and the group certificate prefill were
// withdrawn with the group screens on 2026-09-19 (appendix §25): the expense page is the only
// way back now, and no web surface reads a capture group any more.

test('no surface links back to a capture group any more (appendix §25)', () => {
  assert.equal(source.includes('captureGroup'), false);
  assert.equal(source.includes('/expenses/capture/'), false);
});


test('owner-self signing reads once and issues directly from the same signing form', () => {
  assert.ok(source.includes("policy?.canCertifyAndApprove === true && canConfirm"));
  assert.ok(source.includes("receiptEvidence?.signatureMode === 'DIGITAL' && receiptEvidence.payerUserId === userId"));
  assert.ok(source.includes("...(combinedSigning && { approvalAcknowledged: true })"));
  assert.ok(source.includes("if (result.status === 'ISSUED')"));
  assert.ok(source.includes("setInfo('เซ็นและออกใบรับรองแล้ว')"));
  assert.ok(source.includes("combinedSigning ? 'เซ็นและออกใบรับรอง'"));
  assert.ok(source.includes('รับรองว่าจ่ายจริงเพื่อร้านและใช้ใบเสร็จประกอบไม่ได้ ตรวจเอกสารและหลักฐานแล้ว และอนุมัติให้ออกใบรับรอง'));
  assert.ok(source.includes('<FormActionBar>'));
});


test('loads paged searchable candidates from the server and grants own preparation without granting correction', () => {
  assert.ok(source.includes('listSubstituteReceiptCandidates(companyId, { branchId: branchId || undefined, search: candidateQuery, page: candidatePage, pageSize: 5 })'));
  assert.ok(!source.includes('listCandidateExpenses'));
  assert.ok(!source.includes('MAX_CANDIDATE_DETAIL_LOOKUPS'));
  assert.ok(source.includes('canStart && detail?.createdByUserId === userId'));
  assert.ok(source.includes('const canEditPrepared = Boolean(canReview'));
  assert.ok(source.includes('uploadSubstituteReceiptEvidence(companyId, detail.id, file, purpose)'));
  assert.ok(source.includes('Pagination prominent page={candidatePagination.page}'));
});

test('shop completion links require both route access and edit permission', () => {
  assert.match(source, /permissions.includes\('company.setup.read'\)/);
  assert.match(source, /permissions.includes\('company.legal_identity.manage'\)/);
  assert.match(source, /ให้เจ้าของกิจการหรือผู้ดูแลร้านกรอกข้อมูลร้านก่อน/);
});

test('certificate actions live in the page column and the signing policy names its actors', () => {
  assert.doesNotMatch(source, /<nav[^>]*><FormActionBar>/);
  assert.match(source, /\{wizardActions && <FormActionBar>/);
  assert.match(source, /role="navigation" aria-label="การนำทางใบรับรอง"/);
  assert.match(source, /defaultCertifierId\(items, userId, policy\?\.approvalMode\)/);
  assert.match(source, /required searchable wrapLabel value=\{payerId\}/);
  assert.match(source, /เจ้าของกิจการเซ็นรับรองและอนุมัติได้ในครั้งเดียว/);
  assert.match(source, /รอเจ้าของกิจการตรวจและออกใบรับรอง/);
  assert.match(source, /useState<ExpensePaymentMethod>\('BANK_TRANSFER'\)/);
  assert.doesNotMatch(source, /บันทึกการตรวจ|DocumentReviewSection/);
});
test('candidate rows stretch their left-aligned contents and use the shared pager', () => {
  assert.match(source, /flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', whiteSpace: 'normal'/);
  assert.match(source, /<Pagination prominent page=\{candidatePagination.page\}/);
});
test('certificate load failure offers retry and selected expense survives the login return URL', () => {
  assert.match(source, /returnUrl.searchParams.set\('expenseId', nextDetail.id\)/);
  assert.match(source, /window.history.replaceState/);
  assert.match(source, /<Notice tone="error" action=\{<button[^>]+onClick=\{\(\) => window.location.reload\(\)\}[^>]*>ลองอีกครั้ง/);
});

test('a person who cannot put the expense right is stopped at the first step, and the line under the button stays short', () => {
  // Seen at 390 px as a staff member: the first step let her through with no category on the line, the
  // next step refused her after she had typed everything, and its bar grew to four lines of sentence.
  assert.match(source, /const unrepairablePrerequisites = canReview \? \[\] : \(expensePrerequisites\?\.missing \?\? \[\]\)\.filter\(\(issue\) => issue !== 'renderability'\)/);
  assert.match(source, /\.\.\.unrepairablePrerequisites\.map\(\(issue\) => \(\{ label: PREREQUISITE_NAMES\[issue\]/);
  assert.match(source, /reviewedCategory: 'หมวดหมู่ของรายการ', category: 'หมวดหมู่ของรายการ'/);
  assert.match(source, /PREREQUISITE_NAMES\[unrepairableCause\] \?\? INELIGIBLE_CAUSE_TEXT\[unrepairableCause\]/);
});


test('UX4 the shop detour carries its expense and restores visit typing after loading before writing again', () => {
  assert.match(source, /settings\/profile\?returnTo=\$\{encodeURIComponent\(`/);
  assert.match(source, /substitute-receipts\/new\?expenseId=\$\{detail.id\}/);
  assert.match(source, /const initializeDraft[^]*?setDraftHydratedFor\(null\)/);
  const restore = source.slice(source.indexOf('const draftScopeId'), source.indexOf('// The guard has to be a ref'));
  assert.match(restore, /if \(loading \|\| !userId \|\| !draftScopeId \|\| draftHydratedFor === draftScopeId\) return/);
  assert.match(restore, /if \(loading \|\| !userId \|\| !draftScopeId \|\| !draftStep \|\| draftHydratedFor !== draftScopeId/);
  for (const field of ['ActiveStep(stored.step)', 'PayeeName(stored.payeeName)', 'MissingReason(stored.missingReason)', 'BusinessPurpose(stored.businessPurpose)']) assert.ok(restore.includes(`set${field}`));
});


test('SUB-DOC header owns guarded document actions and one status badge with separate amount and facts', () => {
  const header = source.slice(source.lastIndexOf('<MangmeePage'));
  assert.match(header, /className="mangmee-flat"/);
  assert.match(header, />กลับไปรายการ<\/Link>/);
  assert.doesNotMatch(source, /<BackLink/);
  assert.match(header, /meta=\{receiptEvidence && <MangmeeBadge/);
  assert.match(header, /<MoreActions label="เพิ่มเติม"/);
  assert.match(header, /canCorrectNames && <button/);
  assert.match(header, /canCancelHere && <button[^]*?ยกเลิกใบรับรองนี้/);
  assert.match(header, /className=\{btnClass\}[^]*?>ดาวน์โหลด PDF<\/button>/);
  assert.match(header, /label: 'จำนวนเงิน', value: amountText\(detail.grandTotalAmount\), unit: 'บาท'/);
  for (const label of ['ผู้รับเงิน', 'วันที่จ่าย', 'จ่ายจาก', 'ค่าใช้จ่าย']) assert.ok(header.includes(`>${label}</dt>`));
  const history = source.slice(source.indexOf('const renderVersionHistory'), source.indexOf('const canEditPrepared'));
  assert.doesNotMatch(history, /<button|<Notice/);
  assert.match(history, /text-gray-500.*ยกเลิกใบนี้จากหน้านี้ไม่ได้/);
  const issued = source.slice(source.indexOf('const renderIssuedCertificate'), source.indexOf('const renderDoneStep'));
  assert.doesNotMatch(issued, /MangmeeBadge|downloadSubstituteReceiptPdf|run\(openIssuedPdf\)/);
  assert.doesNotMatch(source, /baht\(|item.blockedReason/);
});

test('SUB-DOC signing stays pressable and invalid presses focus inline reasons above the sticky bar', () => {
  assert.doesNotMatch(source, /disabled=\{busy \|\| (certify|approve)Blockers/);
  assert.match(source, /checkSigning\(Boolean\(previewChecksum\), certificationAcknowledged\)/);
  assert.match(source, /checkSigning\(certifiedPreviewed, approvalAcknowledged\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => focusExpenseField/);
  for (const field of ['preview', 'signature', 'acknowledgement']) assert.ok(source.includes(`id="substitute-sign-${field}"`));
  assert.match(source, /signingAttempted && !certificationAcknowledged && <p role="alert"/);
  assert.match(source, /signingAttempted && !approvalAcknowledged && <p role="alert"/);
  assert.match(source, /wizardActions \? 'pb-8'/);
  const paper = readFileSync(new URL('./SubstitutePaperSigningPanel.tsx', import.meta.url), 'utf8');
  assert.match(paper, /focusExpenseField\(panelRef.current\?\.querySelector/);
  assert.match(paper, /if \(samePersonRefused \|\| acceptMissing.length > 0 \|\| !viewedHash\)/);
  assert.doesNotMatch(paper, /disabled=\{busy \|\| samePersonRefused\}/);
});

test('company-funded e-WHT restricts payment methods and uses the same conditional date warning', () => {
  assert.match(source, /detail.whtRemittance !== 'E_WHT' \|\| fundingSource !== 'COMPANY' \|\| eWhtPaymentMethodAllowed\(method\)/);
  assert.match(source, /fundingSource === 'COMPANY' && expenseEWhtPaymentWarning\(detail.whtRemittance, detail.whtCategoryCode, detail.whtRate, paymentDate\)/);
  assert.match(source, /E_WHT_WORDS\['W-P2'\]/);
});
