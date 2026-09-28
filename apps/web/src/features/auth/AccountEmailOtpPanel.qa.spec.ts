import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The panel is a client component whose whole behaviour lives behind `useEffect`/`useState`, so the
// LINE in-app-browser reopen (R-B4, purchase-without-setup §18.2) cannot be exercised without a
// browser. These are source-check guards for the decisions the logic module cannot make on its own.
const source = readFileSync(new URL('./AccountEmailOtpPanel.tsx', import.meta.url), 'utf8');

test('the panel detects the LINE in-app browser on mount', () => {
  assert.match(source, /setInLineBrowser\(isLineInAppBrowser\(navigator\.userAgent\)\)/);
});

test('inside the LINE browser, reauth offers a reopen instead of a dead-end redirect', () => {
  // RV23: `reauthenticate()` sends the browser to /login, which finds no session inside LINE's own
  // browser and lands empty — the fix is to leave that browser first.
  assert.match(source, /const lineReauthButton = inLineBrowser\s*\n\s*\? </);
  assert.match(source, /เปิดหน้านี้ใน Safari\/Chrome/);
  assert.match(source, /ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน/);
  assert.match(source, /onClick=\{reopenOutsideLine\}/);
});

test('reopening outside LINE keeps returning to this page, with channel=line so /login auto-starts LINE', () => {
  assert.match(source, /function reopenOutsideLine\(\) \{/);
  assert.match(source, /url\.searchParams\.set\('channel', 'line'\)/);
  assert.match(source, /window\.location\.assign\(withLineExternalBrowser\(url\.pathname \+ url\.search \+ url\.hash, navigator\.userAgent\)\)/);
});

test('every LINE-reauth entry point renders the same button, not three independent onClick handlers', () => {
  // Three separate `onClick={reauthenticate}` buttons is what R-B4 replaced: none of them knew
  // whether they were being rendered inside LINE's own browser. Exactly one handler remains — the
  // definition inside `lineReauthButton` itself.
  const directHandlers = [...source.matchAll(/onClick=\{reauthenticate\}/g)];
  assert.equal(directHandlers.length, 1, 'reauthenticate must only be wired once, inside lineReauthButton');
  const usages = [...source.matchAll(/\{state\.lineLinked && lineReauthButton\}/g)];
  assert.equal(usages.length, 3, 'all three LINE-reauth entry points share lineReauthButton');
});
