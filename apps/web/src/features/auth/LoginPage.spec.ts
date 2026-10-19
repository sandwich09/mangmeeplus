import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Availability is resolved after mount; source checks cover the QR lane's ordering.
// Browser tests cover loading, unavailable, retry and ready states.
const source = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');

describe('LoginPage qr-approve lane', () => {
  it('leads with LINE login only when a scanned QR sent the user here and the channel exists', () => {
    // UAT 2026-09-01: an anonymous scan is redirected here by /line-qr/[code], and the password
    // form dominated the screen even though the phone had just proved it has LINE installed.
    assert.match(source, /'qr-approve': /);
    assert.match(source, /const lineLeadLane = \(lineNotice === 'qr-approve' \|\| fromLineLink\) && lineLoginAvailable;/);

    // R-B5 ขยาย hoisted <form onSubmit={handleSubmit} into `const passwordForm` above `return (`
    // (§3.11), so the literal form tag now sits before every render-order marker in source text —
    // the render-position marker for "where the password form appears" is its JSX reference, not
    // its declaration.
    const lead = source.indexOf('{lineLeadLane ? (');
    const form = source.indexOf('{fromLineLink && lineLoginAvailable ? (');
    const otherLanes = source.indexOf('{lineLeadLane ? null : (');
    assert.ok(lead !== -1 && form !== -1 && otherLanes !== -1);
    assert.ok(lead < form, 'the qr-approve lane renders LINE login above the password form');
    assert.ok(form < otherLanes, 'every other lane keeps LINE login below the password form');
  });

  it('serves both positions from one button, so the return path cannot drift between lanes', () => {
    const handler = source.match(
      /window\.location\.assign\(withLineExternalBrowser\(nextPath \? lineStartUrl\(nextPath\) : '\/api\/auth\/line-login\/start', navigator\.userAgent\)\)/g,
    );
    assert.equal(handler?.length, 1, 'one handler carries `next` and the in-app-browser escape for both positions');
    assert.equal(source.match(/const lineLoginButton = \(/g)?.length, 1);
  });
});

describe('LoginPage R-B5 extended (a LINE link never dead-ends at a password form)', () => {
  it('recognizes a LINE link by an expired handoff, `channel=line` or `openExternalBrowser=1` in next', () => {
    // Review 2026-09-29: most LINE notices link straight to the web with openExternalBrowser=1, and
    // the proxy keeps it inside `next` — `lineLinkReason` (line-in-app-browser.logic) knows both.
    assert.match(source, /const lineLink = lineLinkReason\(nextPath\);/);
    assert.match(source, /const fromLineLink = !linkMode && \(lineNotice === 'handoff-expired' \|\| lineLink !== null\);/);
    assert.match(source, /const reason = lineNotice === 'handoff-expired' \? 'handoff-expired' : lineLink;/);
  });

  it('auto-starts LINE login through the in-app-browser escape, carrying `from` and `auto=1`', () => {
    assert.match(source, /window\.location\.assign\(withLineExternalBrowser\(`\$\{lineStartUrl\(nextPath \?\? '\/'\)\}&from=\$\{reason\}&auto=1`, navigator\.userAgent\)\);/);
  });

  // Review 2026-09-29: the auto-start screen had no way out, and a Back press from LINE's own page
  // bounced straight forward again.
  it('never traps: `auto=0`, a back navigation or a back-forward-cache restore stops the auto-start', () => {
    assert.match(source, /if \(checkingSession \|\| sessionRecoveryUnavailable \|\| !fromLineLink \|\| autoStartSuppressed \|\| accessState === 'CLOSED' \|\| lineLoginState !== 'available'\) return;/);
    assert.match(source, /searchParams\.get\('auto'\) === '0'/);
    assert.match(source, /\?\.type === 'back_forward'/);
    assert.match(source, /window\.addEventListener\('pageshow', onPageShow\);/);
    assert.match(source, /if \(!event\.persisted\) return;\s*setAutoStartSuppressed\(true\);\s*setAutoStartingLine\(false\);/);
  });

  it('offers "เข้าสู่ระบบวิธีอื่น" on the auto-start screen, as a reload with auto=0', () => {
    const autoStarting = source.slice(source.indexOf('if (autoStartingLine) {'), source.indexOf('// P12-3a: the qr-approve lane'));
    assert.match(autoStarting, /otherWay\.set\('auto', '0'\);/);
    assert.match(autoStarting, /<a href=\{`\/login\?\$\{otherWay\.toString\(\)\}`\}[^>]*>\s*เข้าสู่ระบบวิธีอื่น\s*<\/a>/);
  });

  it('returns the auto-starting notice before the password form ever renders', () => {
    const autoStarting = source.indexOf('if (autoStartingLine) {');
    const form = source.indexOf('<form onSubmit={handleSubmit}');
    assert.ok(autoStarting !== -1 && form !== -1);
    assert.ok(autoStarting < form, 'the auto-starting return must come before the form in source order');
  });

  it('folds the password form under a <details> summary only for a LINE-link arrival', () => {
    assert.match(source, /\{fromLineLink && lineLoginAvailable \? \(\s*<details/);
    assert.match(source, /เข้าสู่ระบบด้วยรหัสผ่านแทน/);
  });

  it('never mentions the password form before LINE in the expired-handoff notice, and offers a fresh link', () => {
    const text = 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบด้วย LINE หรือรหัสผ่านเพื่อเปิดรายการนี้ หรือกลับไปที่ LINE แล้วกด บริษัทของฉัน เพื่อรับลิงก์ใหม่';
    assert.ok(source.includes(`'handoff-expired': '${text}',`));
    assert.ok(text.indexOf('LINE') < text.indexOf('รหัสผ่าน'), 'LINE must read before รหัสผ่าน in the notice');
  });
});

describe('LoginPage sign-up', () => {
  it('offers no web sign-up: new shops join through LINE only (owner 2026-10-19)', () => {
    assert.doesNotMatch(source, /href="\/signup"/);
    assert.doesNotMatch(source, /auth\.login\.open_shop|auth\.login\.no_account/);
  });
});
