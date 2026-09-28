import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// RV30 (purchase-without-setup §18.3): the locked shell used to require a manual reload after
// buying a package from inside it. `WorkspaceLayoutClient` re-reads the plan-term notice and swaps
// shells in place; the wiring lives behind `useEffect`, so it is checked from source, not rendered.
const source = readFileSync(new URL('./WorkspaceLayout.tsx', import.meta.url), 'utf8');

test('the locked shell listens for PLAN_TERM_CHANGED, focus and visibility — a running shop does not', () => {
  assert.match(source, /if \(notice\?\.derivedState !== 'EXPIRED'\) return;/);
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

test('the re-read is driven by a revision counter, not by re-subscribing on every notice change', () => {
  assert.match(source, /const \[revision, setRevision\] = useState\(0\)/);
  assert.match(source, /const bump = \(\) => setRevision\(\(n\) => n \+ 1\)/);
  assert.match(source, /\}, \[companyId, revision, router\]\);/);
});
