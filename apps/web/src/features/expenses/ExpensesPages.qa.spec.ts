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
test('adding a product inserts it before the charges, and adding a charge appends', () => {
  assert.match(source, /const firstCharge = v\.lines\.findIndex\(\(line\) => line\.chargeKind != null\);/);
  assert.match(source, /const at = chargeKind !== null \|\| firstCharge < 0 \? v\.lines\.length : firstCharge;/);
  // The VAT source is keyed by line number, so an insert in the middle has to shift it.
  assert.match(source, /lineNumber: sourceLine\.lineNumber > at \? sourceLine\.lineNumber \+ 1 : sourceLine\.lineNumber/);
  assert.match(source, /onClick=\{\(\) => insertLine\(null\)\}/);
  assert.match(source, /onClick=\{\(\) => insertLine\('SERVICE_CHARGE'\)\}/);
});

test('charge rows render in their own group, keyed by the shared array index', () => {
  assert.match(source, /const productEntries = entries\.filter\(\(entry\) => entry\.line\.chargeKind == null\);/);
  assert.match(source, /const chargeEntries = entries\.filter\(\(entry\) => entry\.line\.chargeKind != null\);/);
  assert.match(source, /\{productEntries\.map\(\(\{ line, index \}\) => \{/);
  assert.match(source, /\{chargeEntries\.map\(\(\{ line, index \}\) => \{/);
  assert.match(source, /t\('expenses\.charges_section', locale\)/);
  assert.match(source, /t\('expenses\.add_charge', locale\)/);
  // One column: at 390px a select beside a money field left neither readable.
  assert.match(source, /<div className="grid grid-cols-1 gap-3">/);
  // No `min="0"` on the charge amount — ปัดเศษ is printed as a deduction and the validator, not the
  // browser, is what refuses a minus sign on every other kind.
  assert.match(source, /<input type="number" step="0\.0001" className=\{validationInputClass\(amountIssue \?\? quantityIssue\)\}/);
});
