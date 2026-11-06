import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// RV30 (purchase-without-setup §18.3): the locked shell used to require a manual reload after
// buying a package from inside it. `WorkspaceLayoutClient` re-reads the plan-term notice and swaps
// shells in place; the wiring lives behind `useEffect`, so it is checked from source, not rendered.
const source = readFileSync(new URL('./WorkspaceLayout.tsx', import.meta.url), 'utf8');

test('locked and billing recovery shells listen for changes; ordinary running business pages use their access context', () => {
  assert.match(source, /if \(notice\?\.derivedState !== 'EXPIRED' && !isBillingCustomerRecoveryPath\(pathname \?\? '', companyId\)\) return;/);
  assert.match(source, /window\.addEventListener\(PLAN_TERM_CHANGED_EVENT, bump\)/);
  assert.match(source, /window\.addEventListener\('focus', bump\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', onVisible\)/);
  assert.match(source, /document\.visibilityState === 'visible'/);
});

test('leaving EXPIRED refreshes the server layout, so stale session/permissions do not survive the unlock', () => {
  assert.match(source, /const unlocked = result !== null && lockedRef\.current && result\.derivedState !== 'EXPIRED'/);
  assert.match(source, /if \(unlocked\) router\.refresh\(\)/);
});

test('a swallowed notice-fetch failure (null) is never read as an unlock', () => {
  // fetchPlanTermNotice() turns every failure into `null` — the RV30 §9 residual risk this guards:
  // `result !== null &&` must gate `unlocked`, or an endpoint outage reads as "package bought".
  assert.match(source, /result !== null && lockedRef\.current/);
});

test('a failed re-read (null) while locked leaves the shell locked instead of storing "no notice"', () => {
  // Review 2026-09-29: `setLoaded({ notice: null })` swapped a locked shop into the business shell on
  // any notice outage. The early return must sit before `setLoaded`, or the guard above is moot.
  const guard = source.indexOf('if (result === null && lockedRef.current) return;');
  assert.ok(guard > 0, 'the null-while-locked guard exists');
  assert.ok(guard < source.indexOf('setLoaded({ companyId, notice: result, cardRenewal:'), 'and runs before the notice is stored');
});

test('the re-read is driven by a revision counter, not by re-subscribing on every notice change', () => {
  assert.match(source, /const \[revision, setRevision\] = useState\(0\)/);
  assert.match(source, /const bump = \(\) => setRevision\(\(n\) => n \+ 1\)/);
  assert.match(source, /\}, \[companyId, revision, router\]\);/);
});

test('the package row uses the shell notice once, keeps it on billing paths, and sits before people and settings', () => {
  assert.equal((source.match(/fetchPlanTermNotice\(companyId\)/g) ?? []).length, 1);
  assert.match(source, /cardRenewal: !!status && cardRenewalRunning\(status\)/);
  assert.match(source, /notice=\{notice\} cardRenewal=\{loaded\?\.cardRenewal\}/);
  assert.match(source, /packageMenuTrailing\(notice, cardRenewal\)/);
  assert.match(source, /'billing',\s*'roles',\s*'settings'/);
  assert.match(source, /employeePageMenuKey\(companyId, pathname, navItems\) \?\? resolveMenuKey\(pathname, collectMenuTargets\(navItems\)\)/);
});


test('demo shell hides package navigation, renewal reminders and purchase recovery while keeping the demo banner', () => {
  assert.match(source, /!\(session\.isDemo && item\.key === 'billing'\)/);
  assert.match(source, /sidebarFooter=\{!freeExpenseDrafts && !session\.isDemo \?/);
  assert.match(source, /banner=\{session\.isDemo \? <DemoSessionBanner/);
});
