import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// manual-expense-web-entry-flag spec §9.1: every web entrance to the manual expense page goes
// through ONE predicate, `canOpenManualWeb`. The entrances live in server pages and in large client
// pages whose effects do not run under a static render, so the wiring is checked from source — and
// the browser test `e2e/manual-expense-web-entry.spec.ts` checks what the user sees.
const WEB = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(WEB, path), 'utf8');
const COMPANY = 'app/(workspace)/companies/[companyId]';

function sources(dir: string): string[] {
  return readdirSync(join(WEB, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('the server pages hand the one predicate to every screen that links to the manual page', () => {
  assert.match(read(`${COMPANY}/expenses/manual/page.tsx`), /manualEntryOpen=\{canOpenManualWeb\(session, companyId\)\}/);
  assert.match(read(`${COMPANY}/expenses/page.tsx`), /manualEntryOpen=\{canOpenManualWeb\(session, companyId\)\}/);
  assert.match(read(`${COMPANY}/income-expense-ledger/page.tsx`), /canOpenManualExpense=\{canOpenManualWeb\(session, companyId\)\}/);
  assert.match(read(`${COMPANY}/ai-suggestions/page.tsx`), /canOpenManualExpense=\{canOpenManualWeb\(session, companyId\)\}/);
});

test('the manual page always renders the hub: the server never answers 403 or redirects because of the setting', () => {
  const page = read(`${COMPANY}/expenses/manual/page.tsx`);
  assert.doesNotMatch(page, /redirect\(|notFound\(|requireRoutePermission|forbidden/i);
  assert.match(page, /return <ExpensesHubPage [^>]*tab="manual"/);
});

test('the sidebar item is built from the same predicate, by the layout that owns the session', () => {
  const layout = read('src/features/web-core-workspace/WorkspaceLayout.tsx');
  assert.match(layout, /buildNavItems\(filteredModules, companyId, locale, ICON_MAP, session\.permissions, session\.roles, canOpenManual\)/);
  assert.match(layout, /const canOpenManual = canOpenManualWeb\(session, companyId\);/);
});

test('the expense list and the ledger offer the manual page only through the value they were handed', () => {
  const lines = (path: string) => read(path).split('\n').filter((line) => line.includes('/expenses/manual'));

  const list = lines('src/features/expenses/ExpensesPages.tsx');
  assert.equal(list.length, 1);
  assert.match(list[0]!, /\{canOpenManual && <Link /);

  const ledger = read('src/features/accounting-documents/IncomeExpenseLedgerPage.tsx');
  // The button, the empty state and the card's own condition: no entrance left on the bare permission.
  assert.doesNotMatch(ledger, /includes\('expense\.create'\)/);
  assert.equal(lines('src/features/accounting-documents/IncomeExpenseLedgerPage.tsx').length, 2);
  assert.match(ledger, /: canOpenManualExpense\n\s+\? \{ href: `\/companies\/\$\{companyId\}\/expenses\/manual`/);
  assert.match(ledger, /\{canOpenManualExpense && <Link href=\{`\/companies\/\$\{companyId\}\/expenses\/manual`\}/);
  assert.match(ledger, /\{\(canCreateSalesRoot \|\| canUploadExpense \|\| canOpenManualExpense\) && \(/);
});

test('the manual tab renders by its admission: the not-enabled state, the form, or the form with its note', () => {
  const hub = read('src/features/expenses/ExpensesPages.tsx');
  // Admission is state of the mounted hub, fed by the prop; left out, the permission decides.
  assert.match(hub, /const canOpenManual = manualEntryOpen \?\? caps\.canCreate;/);
  assert.match(hub, /const \[manualAdmitted, setManualAdmitted\] = useState\(canOpenManual\);/);
  assert.match(hub, /const manualAdmittedNow = nextManualEntryAdmission\(manualAdmitted, canOpenManual\);/);
  assert.match(hub, /const manualView = manualEntryView\(manualAdmittedNow, canOpenManual\);/);
  // A revoked permission still wins (the Forbidden state), and the not-enabled state replaces the
  // whole create area — it is not rendered inside the branch fieldset.
  assert.match(hub, /const manualNotEnabled = tab === 'manual' && !forbidden && manualView === 'not_enabled';/);
  assert.match(hub, /\{forbidden \? <StateBanner error="Forbidden" \/> : manualNotEnabled \? <ManualExpenseEntryNotEnabled companyId=\{companyId\} caps=\{caps\} \/> : \(/);
  assert.match(hub, /<ManualExpensePanel [^>]*entryClosed=\{manualView === 'form_closed'\}/);
  // The note stands only while an entry is in progress: not once the draft is saved.
  assert.match(hub, /\{entryClosed && !savedExpenseId && <p role="status"[^>]*>\{t\('expenses\.manual_entry_closed_notice', locale\)\}<\/p>\}/);
});

test('the guide page applies the company setting to the result of the pinned guide', () => {
  const page = read(`${COMPANY}/user-guide/expenses/page.tsx`);
  assert.match(page, /manualExpenseWebEntryShown\(session\) \? guide : withManualEntryNotEnabled\(guide\)/);
});

test('no other file links to the manual page: a new entrance must come here and take the predicate', () => {
  const linking = [...sources('src'), ...sources('app')]
    // The route, not the `manual-expense-entry.logic` import path.
    .filter((path) => /(?:expenses|\$\{expenses\})\/manual(?![-\w])/.test(read(path)))
    .map((path) => relative('.', path)).sort();
  assert.deepEqual(linking, [
    // The return link out of the manual form itself (spec §9.1): it lands on the page's own admission.
    'src/features/tax/TransactionTaxLineSelector.tsx',
    // The pinned guide: its shortcut is removed by `withManualEntryNotEnabled`, not here.
    'src/features/user-guide/expenses-guide.content.ts',
    'src/features/user-guide/expenses-guide-manual-entry.ts',
    'src/features/ai-suggestions/ai-suggestions.logic.ts',
    'src/features/web-core-workspace/web-core-workspace.logic.ts',
    'src/features/expenses/ExpensesPages.tsx',
    'src/features/accounting-documents/IncomeExpenseLedgerPage.tsx',
  ].sort());
});
