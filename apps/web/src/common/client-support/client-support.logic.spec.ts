import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyWebClient,
  isCompatibilityExemptPath,
  shouldShowCompatibilityNotice,
} from './client-support.logic';

const IOS_15_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/13.20.0';

describe('client support classification', () => {
  it('blocks only positively recognized clients below the web support floor', () => {
    const cases: Array<[string, 'supported' | 'unsupported' | 'unknown']> = [
      [IOS_15_LINE, 'unsupported'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 FxiOS/125.0', 'unsupported'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 CriOS/111.0.0.0', 'supported'],
      ['Mozilla/5.0 (Linux; Android 9; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36', 'unsupported'],
      ['Mozilla/5.0 (Linux; Android 10; Pixel) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36', 'unsupported'],
      ['Mozilla/5.0 (Linux; Android 10; Pixel) AppleWebKit/537.36 Chrome/111.0.0.0 Mobile Safari/537.36', 'supported'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 Version/16.3 Safari/605.1.15', 'unsupported'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 Version/16.4 Safari/605.1.15', 'supported'],
      ['Mozilla/5.0 Chrome/110.0.0.0 Safari/537.36', 'unsupported'],
      ['Mozilla/5.0 Chrome/111.0.0.0 Safari/537.36', 'supported'],
      ['Mozilla/5.0 Chrome/111.0.0.0 Safari/537.36 Edg/110.0.0.0', 'unsupported'],
      ['Mozilla/5.0 Chrome/111.0.0.0 Safari/537.36 Edg/111.0.0.0', 'supported'],
      ['Mozilla/5.0 Gecko/20100101 Firefox/110.0', 'unsupported'],
      ['Mozilla/5.0 Gecko/20100101 Firefox/111.0', 'supported'],
      ['', 'unknown'],
      ['CustomClient/1.0', 'unknown'],
      ['Mozilla/5.0 HeadlessChrome/100.0.0.0', 'unknown'],
    ];
    for (const [userAgent, expected] of cases) assert.equal(classifyWebClient(userAgent), expected, userAgent);
  });

  it('resolves the iOS version before an iOS browser brand', () => {
    assert.equal(
      classifyWebClient('Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) Mobile/15E148 CriOS/125.0.0.0'),
      'unsupported',
    );
  });
});

describe('compatibility notice routing', () => {
  it('keeps legal, maintenance, compatibility, API, and static paths reachable', () => {
    for (const path of [
      '/privacy', '/terms', '/data-deletion', '/maintenance', '/unsupported-browser',
      '/legal/releases/2026-08', '/api/v1/auth/me', '/brand/logo.svg',
    ]) assert.equal(isCompatibilityExemptPath(path), true, path);
  });

  // P12-3b: the notice puts the requested path in `?next=`, so gating this route would render a
  // page with a bearer token in its URL. The exchange redirects first; the notice fires there.
  it('never gates the LINE handoff route, so a token cannot reach a rendered URL', () => {
    assert.equal(isCompatibilityExemptPath('/l/AbCdEfGhIjKlMnOpQrStUvWxYz012345'), true);
    assert.equal(shouldShowCompatibilityNotice({
      pathname: '/l/AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      method: 'GET',
      accept: 'text/html,application/xhtml+xml',
      fetchDestination: 'document',
      userAgent: IOS_15_LINE,
    }), false);
    // The destination it redirects to is still gated, which is where the notice belongs.
    assert.equal(isCompatibilityExemptPath('/companies/co-1/expenses/exp-1'), false);
  });

  it('gates only safe HTML navigations', () => {
    const base = {
      pathname: '/login',
      method: 'GET',
      accept: 'text/html,application/xhtml+xml',
      fetchDestination: 'document',
      userAgent: IOS_15_LINE,
    };
    assert.equal(shouldShowCompatibilityNotice(base), true);
    assert.equal(shouldShowCompatibilityNotice({ ...base, method: 'POST' }), false);
    assert.equal(shouldShowCompatibilityNotice({ ...base, accept: 'application/json' }), false);
    assert.equal(shouldShowCompatibilityNotice({ ...base, fetchDestination: 'image' }), false);
    assert.equal(shouldShowCompatibilityNotice({ ...base, userAgent: 'CustomClient/1.0' }), false);
  });
});
