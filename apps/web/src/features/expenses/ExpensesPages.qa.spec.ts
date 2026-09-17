import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');

/** The `catch` inside `handleUpload` that decides what happens after a refused AI read. */
function uploadCatchBlock(): string {
  const start = source.indexOf('if (apiErrorCode(e) === RECEIPT_QUOTA_ERROR_CODE) {');
  assert.notEqual(start, -1, 'the quota branch is gone — this guard needs rewriting, not deleting');
  const end = source.indexOf('onSuccess(intent.expenseId, notice);', start);
  assert.notEqual(end, -1, 'the non-quota path no longer ends in onSuccess');
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
  assert.match(branch, /\breturn;/, 'the quota branch must return before onSuccess');
  assert.doesNotMatch(branch, /onSuccess\s*\(/, 'onSuccess unmounts this panel — banner and button go with it');
  assert.doesNotMatch(branch, /router\.(push|replace)\s*\(/, 'no navigation out of the upload tab');
  assert.doesNotMatch(branch, /window\.location/, 'no navigation out of the upload tab');
});

test('the quota branch raises the latch that paints the banner and disables the button', () => {
  const branch = uploadCatchBlock();
  assert.match(branch, /setQuotaLatch\(\{\s*monthKey: bangkokMonthKey\(todayCivilDate\(\)\)/);
  // Stamped with a month so the ceiling's own reset on the 1st clears it without a reload.
  assert.match(source, /const quotaBlocked = isReceiptQuotaBlocked\(quotaLatch, todayCivilDate\(\)\)/);
  assert.match(source, /disabled=\{loading \|\| preparing \|\| quotaBlocked\}/);
});

test('the quota banner offers the two things the shop can still do', () => {
  // The receipt IS saved — only the read was refused — so the draft must stay reachable, and the
  // upgrade link must go somewhere true. `/renew` is the P29 expired-term screen and this shop has
  // not expired, so settings is the closest honest route until L-E ships the plan page.
  assert.match(source, /href=\{`\/companies\/\$\{companyId\}\/settings`\}[^>]*>ขอเปลี่ยนแพ็กเกจ</);
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

test('a refused read still leaves the draft reachable and the spinner cleared', () => {
  // `finally` owns both spinners, so no refusal path can leave one turning.
  assert.match(source, /finally \{ setLoading\(false\); setExtracting\(false\); \}/);
  // The notice path ends in onSuccess, which carries the draft id — the file and draft survive.
  assert.match(source, /notice = extractionNotice\(outcome\.result, locale\);/);
  assert.match(source, /onSuccess\(intent\.expenseId, notice\);/);
});
