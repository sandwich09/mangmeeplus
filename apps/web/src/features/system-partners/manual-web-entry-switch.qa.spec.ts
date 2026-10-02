import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// manual-expense-web-entry-flag spec §8. The switch lives in a 3,600-line page whose effects do not
// run under a static render, so what it is wired to is checked from source; what the operator sees
// is checked in the browser test `e2e/manual-expense-web-entry.spec.ts`.
const page = readFileSync(new URL('./PartnerDetailPage.tsx', import.meta.url), 'utf8');
const section = page.slice(page.indexOf('function PackageMenuSection('), page.indexOf('function EntitlementSwitch('));
const handler = section.slice(section.indexOf('const toggleManualWebEntry = async'), section.indexOf('const saveChanges = async'));

test('the handler under test is the whole of it, and nothing else', () => {
  assert.ok(handler.startsWith('const toggleManualWebEntry = async'));
  assert.ok(handler.trimEnd().endsWith('};'), 'the slice ends where the handler ends');
});

test('the page hands the stored setting to the package section', () => {
  assert.match(page, /<PackageMenuSection [^>]*manualExpenseWebEntry=\{detail\.manualExpenseWebEntry\}/);
});

test('the switch saves through its own command, with the version it was shown', () => {
  assert.match(handler, /await setPartnerManualExpenseWebEntry\(companyId, \{ enabled: next, expectedVersion: webEntry\.version \}\)/);
  // Not an entitlement: it never touches the pending set, the feature command or its review.
  assert.doesNotMatch(handler, /updatePending|setPending|toggleSubmenu|setPartnerFeatures|setReviewOpen|commandId/);
});

test('it asks only before hiding, and saves at once after the answer', () => {
  assert.match(handler, /const lines = webEntryRow\.confirmLines\(next\);/);
  assert.match(handler, /if \(lines\.length > 0 && !\(await confirm\(\{/);
  assert.match(handler, /confirmLabel: MANUAL_WEB_ENTRY_COPY\.confirmHideLabel, cancelLabel: MANUAL_WEB_ENTRY_COPY\.cancelHideLabel/);
});

test('a save keeps the operator\'s unsaved package changes: the result is stored locally, the detail is not reloaded', () => {
  assert.match(handler, /setWebEntry\(saved\);\s+showToast\(saved\.enabled \? MANUAL_WEB_ENTRY_COPY\.savedShown : MANUAL_WEB_ENTRY_COPY\.savedHidden, 'success'\);/);
  const success = handler.slice(0, handler.indexOf('} catch'));
  assert.doesNotMatch(success, /onSaved\(/);
});

test('a 409 says so in Thai and reads the latest value again, without resetting the package changes', () => {
  const failure = handler.slice(handler.indexOf('} catch'));
  assert.match(failure, /showToast\(apiErrorMessage\(err\), 'error'\);/);
  assert.match(failure, /if \(\(err as \{ status\?: number \}\)\.status === 409\) \{\s+const latest = await getPartnerDetail\(companyId\)\.catch\(\(\) => null\);\s+if \(latest\?\.manualExpenseWebEntry\) setWebEntry\(latest\.manualExpenseWebEntry\);/);
  assert.doesNotMatch(failure, /onSaved\(/);
});

test('the switch is locked by the company lock and the saved parent features only, not by the entitlement locks', () => {
  assert.match(section, /disabled=\{fieldsLocked \|\| webEntrySaving \|\| !webEntryRow\.parentOpen\}/);
  assert.match(section, /const webEntryRow = manualWebEntryRow\(entitlements, webEntry \?\? \{ enabled: false \}\);/);
  // The name of the switch is what it controls; its state is aria-checked.
  assert.match(section, /checked=\{webEntry\.enabled\}[\s\S]{0,400}label=\{MANUAL_WEB_ENTRY_COPY\.label\}/);
  // …and pressing it runs the handler above, never the pending set of the feature command.
  assert.match(section, /label=\{MANUAL_WEB_ENTRY_COPY\.label\}\s+onClick=\{\(\) => void toggleManualWebEntry\(\)\}/);
});

test('the submenu list can be opened while the entitlement switches are locked, or the row could not be reached', () => {
  const expander = section.slice(section.indexOf('aria-controls={`submenus-${card.navKey}`}') - 400, section.indexOf('aria-controls={`submenus-${card.navKey}`}'));
  assert.doesNotMatch(expander, /disabled=\{controlsLocked\}/);
});

test('the row shows its texts from the one place, and only under the manual-expense submenu', () => {
  assert.match(section, /\{submenu\.key === MANUAL_WEB_ENTRY_SUBMENU_KEY && webEntry && \(/);
  for (const text of ['MANUAL_WEB_ENTRY_COPY.label', 'MANUAL_WEB_ENTRY_COPY.description', 'webEntryRow.parentOffMessage', 'webEntryRow.uploadOffNote',
    'MANUAL_WEB_ENTRY_COPY.shown', 'MANUAL_WEB_ENTRY_COPY.notShown']) {
    assert.ok(section.includes(text), text);
  }
});
