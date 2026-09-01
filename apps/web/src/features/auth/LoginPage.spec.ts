import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// `lineLoginAvailable` is set by a mount effect, and effects never run under renderToStaticMarkup,
// so the LINE button is absent from every static render of this page by construction. Ordering is
// therefore asserted against the source, the way the notification page spec asserts its post-mount
// behaviour.
const source = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');

describe('LoginPage qr-approve lane', () => {
  it('leads with LINE login only when a scanned QR sent the user here and the channel exists', () => {
    // UAT 2026-09-01: an anonymous scan is redirected here by /line-qr/[code], and the password
    // form dominated the screen even though the phone had just proved it has LINE installed.
    assert.match(source, /'qr-approve': /);
    assert.match(source, /const qrApproveLead = lineNotice === 'qr-approve' && lineLoginAvailable;/);

    const lead = source.indexOf('{qrApproveLead ? (');
    const form = source.indexOf('<form onSubmit={handleSubmit}');
    const otherLanes = source.indexOf('{qrApproveLead ? null : (');
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
