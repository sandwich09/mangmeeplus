/**
 * "เตรียมใบเบิก" carries its source (capture appendix §13.4 / §12.3, W04b deviation 8).
 *
 * The page is a .tsx client component this runner cannot import, so the guard is on its source and
 * on the route that feeds it — the same technique `ExpensesPages.qa.spec.ts` uses. What it holds:
 * the id is read from the URL, the SERVER is asked whether that expense may be claimed, and an
 * answer of "no" is printed with its reason instead of leaving a blank draft (the W04b gap).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./ReimbursementCreatePage.tsx', import.meta.url), 'utf8');
const route = readFileSync(
  new URL('../../../app/(workspace)/companies/[companyId]/reimbursements/new/page.tsx', import.meta.url),
  'utf8',
);

test('the route reads ?expenseId= from the search params and passes it down', () => {
  assert.match(route, /searchParams\?: Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(route, /const query = searchParams \? await searchParams : \{\};/);
  assert.match(route, /typeof query\['expenseId'\] === 'string'/);
  assert.match(route, /sourceExpenseId: expenseId/);
});

test('the id is resolved through the server, never trusted as an eligible source', () => {
  assert.match(page, /getReimbursementSourceOptions\(companyId, \{ branchId: selectedBranch, requesterUserId, expenseId: sourceExpenseId \}\)/);
  assert.match(page, /if \(!source\.eligible\) \{ setSourceLinkNotice\(errorMessage\(source\.reason \?\? 'reimbursement_source_unavailable'\)\); return; \}/);
  assert.match(page, /if \(!source\) \{ setSourceLinkNotice\(errorMessage\('reimbursement_source_unavailable'\)\); return; \}/);
});

test('an eligible source becomes line 1 through the same path the picker uses', () => {
  assert.match(page, /setLine\(0, lineFromSource\(source\)\);/);
  // One builder for both, so a source chosen by link and a source chosen by hand cannot differ.
  assert.match(page, /const selectSource = \(index: number, expenseId: string\) => \{[\s\S]*setLine\(index, lineFromSource\(source\)\);/);
  // The facts block renders off the snapshot the line now carries.
  assert.match(page, /sourceExpenseSnapshot: source\.snapshot/);
  assert.match(page, /<ReimbursementSourceFacts/);
});

test('the reason is shown inline, and only once per visit', () => {
  assert.match(page, /\{sourceLinkNotice && <ErrorBanner message=\{`รายการต้นทางที่เลือกมายังเบิกไม่ได้: \$\{sourceLinkNotice\}`\} \/>\}/);
  assert.match(page, /if \(!sourceExpenseId \|\| editing \|\| preselectedRef\.current/, 'never re-applied after the person clears it');
  assert.match(page, /preselectedRef\.current = true;/);
});
