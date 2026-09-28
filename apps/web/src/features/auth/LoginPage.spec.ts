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
  it('recognizes a LINE link by an expired handoff or a `channel=line` next path', () => {
    assert.match(source, /const fromLineLink = !linkMode && \(lineNotice === 'handoff-expired' \|\| \/\[\?&\]channel=line\(\?:&\|\$\)\/\.test\(nextPath \?\? ''\)\);/);
  });

  it('auto-starts LINE login through the in-app-browser escape, carrying `from` and `auto=1`', () => {
    assert.match(source, /window\.location\.assign\(withLineExternalBrowser\(`\$\{lineStartUrl\(nextPath \?\? '\/'\)\}&from=\$\{reason\}&auto=1`, navigator\.userAgent\)\);/);
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

  it('never mentions the password form before LINE in the expired-handoff notice', () => {
    const text = 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบด้วย LINE หรือรหัสผ่านเพื่อเปิดรายการนี้';
    assert.match(source, /'handoff-expired': 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบด้วย LINE หรือรหัสผ่านเพื่อเปิดรายการนี้',/);
    assert.ok(text.indexOf('LINE') < text.indexOf('รหัสผ่าน'), 'LINE must read before รหัสผ่าน in the notice');
  });
});
