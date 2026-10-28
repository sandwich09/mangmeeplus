import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');

/** The `catch` inside `handleUpload` that decides what happens after a refused AI read. */
function uploadCatchBlock(): string {
  const start = source.indexOf('if (code === RECEIPT_QUOTA_ERROR_CODE || (freeExpenseDrafts && code === \'FREE_DOCUMENT_LIMIT_REACHED\')) {');
  assert.notEqual(start, -1, 'the quota branch is gone — this guard needs rewriting, not deleting');
  const end = source.indexOf("t('expenses.upload_extract_failed_prefix', locale)", start);
  assert.notEqual(end, -1, 'the non-quota path no longer ends in the generic read-failure notice');
  return source.slice(start, end);
}

/**
 * P10-L §15.1 (review F3). The quota branch set the latch and then fell through to `onSuccess`,
 * which routes to the review screen: the upload panel unmounted and took the banner and the
 * disabled button with it, so neither ever painted and the shop could walk straight back and
 * upload into the same wall. Nothing in the type system stops that being reintroduced.
 */
test('the receipt-quota branch stays on the upload tab instead of navigating away', () => {
  const branch = uploadCatchBlock();
  // `notice: null` is the quota answer: nothing lands, so the caller never navigates.
  assert.match(branch, /return \{ expenseId: intent\.expenseId, notice: null \};/, 'the quota branch must return before the caller lands');
  assert.doesNotMatch(branch, /onSuccess\s*\(/, 'onSuccess unmounts this panel — banner and button go with it');
  assert.doesNotMatch(branch, /router\.(push|replace)\s*\(/, 'no navigation out of the upload tab');
  assert.doesNotMatch(branch, /window\.location/, 'no navigation out of the upload tab');
});

test('the quota branch raises the latch; pressing Send returns to its reason without a duplicate upload', () => {
  const branch = uploadCatchBlock();
  assert.match(branch, /setQuotaLatch\(\{\s*monthKey: bangkokMonthKey\(todayCivilDate\(\)\)/);
  // Stamped with a month so the ceiling's own reset on the 1st clears it without a reload.
  assert.match(source, /const quotaBlocked = isReceiptQuotaBlocked\(quotaLatch, todayCivilDate\(\)\)/);
  assert.match(source, /if \(quotaBlocked\) \{ focusExpenseField\(document\.querySelector<HTMLElement>\('\[data-upload-quota\]'\)\); return; \}/);
  assert.match(source, /disabled=\{loading\} aria-busy=\{loading\} data-loading-indicator/);
});

test('the quota banner offers the two things the shop can still do', () => {
  // The receipt IS saved — only the read was refused — so the draft must stay reachable. G18: the
  // package page is where the quota is bought; staff without company.plan.manage cannot buy, so
  // they are told who can instead of being sent to settings, which just bounces them.
  assert.match(source, /canManagePlan\s*\?\s*<Link href=\{`\/companies\/\$\{companyId\}\/billing`\}[^>]*>เปลี่ยนแพ็กเกจ</);
  assert.match(source, /แจ้ง\{THAI_SYSTEM_ROLE_NAMES\.OWNER\}หรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ/);
  // 390 px phones: the link is a 44 px tap target, not a line of underlined text.
  assert.match(source, /<Link href=\{`\/companies\/\$\{companyId\}\/billing`\} className="inline-flex min-h-11 items-center underline">/);
  assert.doesNotMatch(source, /href=\{`\/companies\/\$\{companyId\}\/settings`\}[^>]*>ขอเปลี่ยนแพ็กเกจ/);
  assert.match(source, /blockedExpenseId && \(/);
  assert.match(source, /href=\{`\/companies\/\$\{companyId\}\/expenses\/\$\{blockedExpenseId\}`\}/);
  assert.doesNotMatch(source, /\/companies\/\$\{companyId\}\/renew/);
});

/**
 * Spec §5.1. Two rules the type system cannot hold. First, an additional charge must sort after
 * every product line, so adding a PRODUCT has to insert before the charges — appending it would
 * build the one payload shape the API refuses, and the reviewer would meet the refusal only on
 * save. Second, the charge rows render as their own group, not as more goods lines.
 */
// The RULE is exercised in expense-review-validation.spec.ts against the real model
// (`insertExpenseReviewLine`); this file only checks that the page still delegates to it, because
// the rule silently moving back inline is the way a behavioural test stops covering the button.
test('the add buttons delegate to the shared ordering rule', () => {
  assert.match(source, /const insertLine = \(chargeKind: ExpenseLineChargeKind \| null\) => \{[\s\S]{0,120}insertExpenseReviewLine\(v, chargeKind\)/);
  assert.match(source, /const removeLine = \(index: number\) => \{[\s\S]{0,140}removeExpenseReviewLine\(v, index\)/);
  assert.doesNotMatch(source, /findIndex\(\(line\) => line\.chargeKind != null\)/, 'the ordering rule belongs in the model, where it is tested');
  assert.match(source, /onClick=\{\(\) => insertLine\(null\)\}/);
  assert.match(source, /onClick=\{\(\) => insertLine\('SERVICE_CHARGE'\)\}/);
});

test('charge rows render in their own group, keyed by the shared array index', () => {
  assert.match(source, /const productEntries = entries\.filter\(\(entry\) => entry\.line\.chargeKind == null\);/);
  assert.match(source, /const chargeEntries = entries\.filter\(\(entry\) => entry\.line\.chargeKind != null && !isCalculatedExpenseRounding\(entry\.line\)\);/);
  assert.match(source, /\{productEntries\.map\(\(\{ line, index \}\) => \{/);
  assert.match(source, /\{chargeEntries\.map\(\(\{ line, index \}, chargeIndex\) => \{/);
  assert.match(source, /t\(chargeEntries\.some\(\(\{ line \}\) => line\.chargeKind === 'ROUNDING'\) \? 'expenses\.charges_and_adjustments_section' : 'expenses\.charges_section', locale\)/);
  assert.match(source, /chargeKind === 'ROUNDING' \? 'expenses\.adjustment_amount' : 'expenses\.charge_amount'/);
  assert.match(source, /t\('expenses\.add_charge', locale\)/);
  // One column: at 390px a select beside a money field left neither readable.
  assert.match(source, /<div className="grid grid-cols-1 gap-3">/);
  // No `min="0"` on the charge amount — ปัดเศษ is printed as a deduction and the validator, not the
  // browser, is what refuses a minus sign on every other kind.
  assert.match(source, /<input type="number" step="0\.0001" className=\{validationInputClass\(amountIssue \?\? quantityIssue\)\}/);
});

/**
 * Spec `line-ai-draft-control-spec-th.md` §5.2. Both list layouts (the mobile card and the desktop
 * row) render the two date badges as a pair. A mis-indented duplicate slipped in and painted
 * "อ่านจากบิล" twice on the same row — invisible to the type system and to every logic test.
 */
test('the document-date badge is rendered once per list layout, beside the late badge', () => {
  const dateBadges = source.match(/<DocumentDateBadge\b/g) ?? [];
  const lateBadges = source.match(/<LateDocumentBadge\b/g) ?? [];
  assert.ok(dateBadges.length > 0, 'the badge is rendered at all');
  assert.equal(dateBadges.length, lateBadges.length, 'exactly one date badge per layout that shows the late badge');
  assert.doesNotMatch(source, /<DocumentDateBadge[^>]*\/>\s*<DocumentDateBadge/, 'no row paints the same badge twice');
});

/**
 * Remediation spec §9.2 (web) / B-03. `extractionNotice` lives in a .tsx module this runner cannot
 * import, so the guard is on its source — the same technique the quota guards above use.
 */
test('the money-refusal notices are info, scope-aware, and never the generic failure', () => {
  const notice = source.slice(source.indexOf('export function extractionNotice('), source.indexOf('// ── Upload Panel'));
  for (const code of ['exceeded', 'insufficient', 'unavailable', 'busy']) {
    assert.match(notice, new RegExp(`AI_BUDGET_REFUSAL_CODES\\.${code}`), `${code} needs its own branch`);
  }
  // Tone: nothing broke, so the banner must not shout in red.
  const budgetSection = notice.slice(
    notice.indexOf('AI_BUDGET_REFUSAL_CODES.exceeded'),
    notice.lastIndexOf('  return {'),
  );
  assert.equal((budgetSection.match(/tone: 'info'/g) ?? []).length, 4, 'all four money reasons are info, not error');
  assert.doesNotMatch(budgetSection, /tone: 'error'/);
  assert.doesNotMatch(budgetSection, /expenses\.extract_failed/);
  assert.doesNotMatch(budgetSection, /setTimeout|retry|request\(/i, 'no automatic retry is started from a notice');
  // The scope decides the sentence only where the API can prove it.
  assert.match(notice, /result\.budgetScope === 'OCR'/);
});

/**
 * Appendix §25 (owner decision 2026-09-19). One file is one expense, and so is EACH of several:
 * there is no group lane left, so the panel runs today's single-receipt path N times and no file
 * ever reaches a capture-group route.
 */
test('one file keeps the existing expense path, in the same three requests', () => {
  const one = source.slice(source.indexOf('const uploadOneFile = async ('), source.indexOf('const handleBatchUpload = async (files = selectedFiles, retryIndex?: number)'));
  assert.match(one, /const intent = await initReceiptUpload\(companyId, \{/);
  assert.match(one, /await uploadReceiptFile\(intent\.uploadUrl/);
  assert.match(one, /await completeReceiptUpload\(companyId, intent\.expenseId, intent\.attachmentId, \{ byteSize: file\.size \}\)/);
  assert.match(one, /requestExpenseExtractionWithRecovery\(/);
  const single = source.slice(source.indexOf('const handleUpload = async (files = selectedFiles)'), source.indexOf('/** Rows come from the machine'));
  assert.match(single, /await handleBatchUpload\(files\);/);
  assert.match(source, /else if \(created\.length === 1\) onSuccess\(created\[0\]!\.expenseId, created\[0\]!\.notice\);/);
});

test('several files are N ordinary single uploads — no group, no second screen', () => {
  const batch = source.slice(source.indexOf('const handleBatchUpload = async (files = selectedFiles, retryIndex?: number)'), source.indexOf('const handleUpload = async (files = selectedFiles)'));
  assert.match(batch, /runSingleFileUploads<ExtractionNotice \| null>\(\{/);
  assert.match(batch, /const done = await uploadOneFile\(file\);/);
  // The machine itself is exercised in expense-capture-upload.logic.spec.ts; this is the wiring.
  assert.doesNotMatch(source, /createExpenseCaptureGroup|addExpenseCaptureFile|completeExpenseCaptureFile|runCaptureUpload|writeCaptureManifest/,
    'the capture-group upload lane is withdrawn');
  assert.equal(source.includes('/expenses/capture'), false, 'no web route points at a capture group');
});

test('the batch lands where a single receipt lands: the list, with the newest highlighted', () => {
  assert.match(source, /onBatchSuccess=\{\(created\) => \{ for \(const row of created\) storeExtractionNotice\(row\.expenseId, row\.notice\); router\.push\(`\/companies\/\$\{companyId\}\/expenses\?highlight=\$\{encodeURIComponent\(created\.at\(-1\)!\.expenseId\)\}`\); \}\}/);
  // A refused read latches the banner instead of landing, so nothing claims work that did not happen.
  const batch = source.slice(source.indexOf('const handleBatchUpload = async (files = selectedFiles, retryIndex?: number)'), source.indexOf('const handleUpload = async (files = selectedFiles)'));
  assert.match(batch, /if \(run\.entries\.some\(row => !row\.expenseId \|\| !notices\.current\.has\(row\.expenseId\)\)\) return;/);
});

test('the picker and the dropzone take several files; the camera still takes one photo', () => {
  assert.match(source, /accept="image\/\*" capture="environment" className="sr-only"/);
  assert.doesNotMatch(source, /capture="environment"[^>]*multiple/);
  assert.equal((source.match(/accept=\{RECEIPT_UPLOAD_ACCEPT\} multiple/g) ?? []).length, 2);
});

test('a read that became a durable job says the file is saved, not that it was read', () => {
  const notice = source.slice(source.indexOf('export function extractionNotice('), source.indexOf('// ── Upload Panel'));
  // W07-int: the JOB's existence decides this branch, not how far it has got — the PDF lane
  // answers `{ status: 'ok', readJobId, readStatus: 'QUEUED' }` and a replay of the same file
  // answers the same shape with `readStatus: 'DONE'` and no fields at all.
  assert.match(notice, /const jobNotice = captureReadJobNotice\(result\);/);
  // It has to answer before the success branch, or a pending read reads as "AI อ่านเอกสารแล้ว".
  assert.ok(notice.indexOf('captureReadJobNotice') < notice.indexOf("result.status === 'ok'"));
});

test('the client no longer carries a PDF ceiling of its own', () => {
  assert.doesNotMatch(source, /MAX_PDF_EXTRACTION_BYTES|upload_pdf_too_large/);
  // The 4 MB message is retired in both locales: a 10 MiB PDF is read automatically (§4.1).
  assert.equal('expenses.upload_pdf_too_large' in workspaceDictionary.th, false);
  assert.equal('expenses.upload_pdf_too_large' in workspaceDictionary.en, false);
  assert.match(source, /captureFileRejection\(file, capability\)/);
  assert.match(source, /getExpenseCaptureCapability\(companyId\)/);
});

test('a refused read still leaves the draft reachable and the spinner cleared', () => {
  // A `finally` owns each spinner, so no refusal path can leave one turning.
  assert.match(source, /\} finally \{ setExtracting\(false\); \}/);
  assert.match(source, /finally \{ uploadPending\.current = false; setLoading\(false\); \}/);
  // The notice path carries the draft id, so the file and the draft survive a refusal.
  assert.match(source, /return \{ expenseId: intent\.expenseId, notice: extractionNotice\(outcome\.result, locale\) \};/);
  assert.match(source, /if \(done\.notice\) notices\.current\.set\(done\.expenseId, done\.notice\);/);
  assert.match(source, /onSuccess\(created\[0\]!\.expenseId, created\[0\]!\.notice\)/);
});


test('UX4 VAT mode and every line rate use their printed label as the chooser name', () => {
  for (const id of ['expense-vat-rate-', 'expense-charge-vat-']) {
    const at = source.indexOf('id={`' + id);
    assert.ok(at >= 0);
    assert.match(source.slice(at, at + 180), /aria-label=\{t\('expenses.line_vat_rate', locale\)\}/);
  }
  assert.match(source, /<ThemedSelect id=\{`expense-vat-mode-\$\{detail.id\}`\} aria-label=\{t\('expenses.vat_mode', locale\)\}/);
});

test('UX8 certificate funding calls every shop กิจการ', async () => {
  const { t } = await import('@/common/i18n/workspace-i18n.logic');
  assert.match(source, /กิจการจ่ายเต็มจำนวน/);
  assert.doesNotMatch(source, /บริษัทจ่ายเต็มจำนวน/);
  assert.equal(t('expenses.substitute_wizard.company_payer_help', 'th'), 'กิจการจ่าย: เลือกผู้จ่ายและทราบข้อเท็จจริงของรายจ่าย');
  assert.equal(t('expenses.substitute_wizard.evidence_readiness_description', 'th'), 'ระบบตรวจชนิดหลักฐานตามวิธีจ่ายเงินและนโยบายของกิจการ');
});

test('LIST-1 keeps a monthly list with three metrics and one export beside the search', () => {
  const list = source.slice(source.indexOf('function ExpenseListPage('), source.indexOf('// ──', source.indexOf('function ExpenseListPage(')));
  assert.match(source, /const LIST_PAGE_SIZE = 10;/);
  assert.match(list, /<MetricGrid columns=\{3\} items=\{metricItems\}/);
  for (const removed of ['granularity_day', 'granularity_month', 'vatRightFilter', 'ร้านยังไม่ตอบเรื่อง VAT', 'รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า', 'pagination_showing', 'CAPTURE_SOURCE_LABELS', 'col_expense_number', 'kpi_pending', 'kpi_overdue']) assert.ok(!list.includes(removed), removed);
  assert.doesNotMatch(list, /expenses\/manual/);
  const rows = list.slice(list.indexOf('data-testid="expenses-grid"'));
  assert.doesNotMatch(rows, /expenses\.document_date/);
  assert.equal((list.match(/\{EXPORT_FOR_ACCOUNTANT\}<\/button>/g) ?? []).length, 1);
  // Owner 2026-10-15: beside the search, before the numbers and the rows.
  assert.ok(list.indexOf('{EXPORT_FOR_ACCOUNTANT}</button>') < list.indexOf('data-testid="expenses-summary"'));
  assert.match(list, /setDateOrder\(order => order === 'newest' \? 'oldest' : 'newest'\)/);
  assert.match(list, /<Pagination prominent page=/);
  assert.match(list, /expenseListStatus\(e\)/);
  assert.match(list, /เกินกำหนด.*kpi.overdueCount/);
  assert.match(list, /LateDocumentBadge/); assert.match(list, /DocumentDateBadge/);
});
