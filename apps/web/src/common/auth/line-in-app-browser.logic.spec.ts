import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLineInAppBrowser, lineLinkReason, withLineExternalBrowser } from './line-in-app-browser.logic';

const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/14.10.0 LIFF';
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('LINE in-app browser escape (UAT 2026-09-01)', () => {
  it('detects only the LINE in-app browser', () => {
    assert.equal(isLineInAppBrowser(LINE_UA), true);
    assert.equal(isLineInAppBrowser(SAFARI_UA), false);
    // "Outline/" or similar must not match — the marker is the standalone token " Line/".
    assert.equal(isLineInAppBrowser('Mozilla/5.0 Outline/2.0'), false);
  });

  it('appends openExternalBrowser=1 only inside the LINE browser, with correct separators', () => {
    assert.equal(
      withLineExternalBrowser('/api/auth/line-login/start', LINE_UA),
      '/api/auth/line-login/start?openExternalBrowser=1',
    );
    assert.equal(
      withLineExternalBrowser('/api/auth/line-login/start?returnTo=%2Fsignup%2Fwelcome', LINE_UA),
      '/api/auth/line-login/start?returnTo=%2Fsignup%2Fwelcome&openExternalBrowser=1',
    );
    assert.equal(withLineExternalBrowser('/api/auth/line-login/start', SAFARI_UA), '/api/auth/line-login/start');
  });
});

// Review 2026-09-29: most LINE notices link straight to the web with `openExternalBrowser=1`, and
// the login wall keeps it in `next` — that is a LINE link as much as `channel=line` is.
describe('lineLinkReason (R-B5)', () => {
  it('recognises both LINE markers in the query, and nothing else', () => {
    assert.equal(lineLinkReason('/companies/c/billing?channel=line'), 'channel-line');
    assert.equal(lineLinkReason('/companies/c/billing?channel=line&openExternalBrowser=1'), 'channel-line');
    assert.equal(lineLinkReason('/companies/c/expenses/e1?openExternalBrowser=1'), 'line-link');
    assert.equal(lineLinkReason('/companies/c/settings/profile?openExternalBrowser=1#account'), 'line-link');
    for (const other of [null, undefined, '', '/companies/c/dashboard', '/x?channel=liner', '/x?openExternalBrowser=0', '/x#openExternalBrowser=1', '/x?a=1&notopenExternalBrowser=1']) {
      assert.equal(lineLinkReason(other), null, String(other));
    }
  });
});
