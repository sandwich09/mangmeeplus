import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineAuthorizeUrl,
  decodeLineLoginTxn,
  encodeLineLoginTxn,
  pkceChallengeS256,
  publicOriginFromHeaders,
  randomUrlToken,
  sanitizeReturnTo,
} from './line-login-bff.logic';

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe('line-login-bff.logic', () => {
  // RFC 7636 Appendix B: the published S256 verifier/challenge pair. If this drifts, LINE
  // rejects every code exchange, so the vector is pinned rather than round-tripped.
  it('derives the RFC 7636 S256 challenge', () => {
    assert.equal(
      pkceChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('keeps only same-app relative return paths', () => {
    assert.equal(sanitizeReturnTo('/companies/x'), '/companies/x');
    assert.equal(sanitizeReturnTo(null), null);
    assert.equal(sanitizeReturnTo(undefined), null);
    assert.equal(sanitizeReturnTo(''), null);
    assert.equal(sanitizeReturnTo('//evil.example.com'), null);
    assert.equal(sanitizeReturnTo('/\\evil.example.com'), null);
    assert.equal(sanitizeReturnTo('https://evil.example.com'), null);
    assert.equal(sanitizeReturnTo(`/${'a'.repeat(512)}`), null);
  });

  it('round-trips the transaction and rejects anything it cannot trust', () => {
    const txn = { state: 's1', nonce: 'n1', verifier: 'v1', returnTo: '/companies/x' };
    assert.deepEqual(decodeLineLoginTxn(encodeLineLoginTxn(txn)), txn);
    assert.deepEqual(decodeLineLoginTxn(encodeLineLoginTxn({ state: 's1', nonce: 'n1', verifier: 'v1' })), {
      state: 's1', nonce: 'n1', verifier: 'v1',
    });
    assert.equal(decodeLineLoginTxn(undefined), null);
    assert.equal(decodeLineLoginTxn('not-base64url-json'), null);
    assert.equal(decodeLineLoginTxn(Buffer.from('{"state":"s1"}', 'utf8').toString('base64url')), null);
    assert.equal(decodeLineLoginTxn(Buffer.from('[]', 'utf8').toString('base64url')), null);
  });

  it('builds the LINE authorize URL with every PKCE parameter', () => {
    const url = new URL(buildLineAuthorizeUrl({
      channelId: '2000000001',
      redirectUri: 'https://app.example.com/api/auth/line-login/callback',
      state: 'state-1',
      nonce: 'nonce-1',
      codeChallenge: 'challenge-1',
    }));

    assert.equal(url.origin + url.pathname, 'https://access.line.me/oauth2/v2.1/authorize');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      response_type: 'code',
      client_id: '2000000001',
      redirect_uri: 'https://app.example.com/api/auth/line-login/callback',
      state: 'state-1',
      scope: 'openid profile',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      // P10 §4F: LINE shows the add-friend option on its own consent screen, so linking the
      // account and following the OA are one step. 'normal' asks; it never adds without consent.
      bot_prompt: 'normal',
    });
    // The redirect must survive as one encoded parameter, not leak its own query into LINE's.
    assert.match(url.search, /redirect_uri=https%3A%2F%2Fapp\.example\.com%2Fapi%2Fauth%2Fline-login%2Fcallback/);
  });

  it('trusts the forwarded proto/host over the internal request origin', () => {
    assert.equal(
      publicOriginFromHeaders(headers({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com' }), 'http://localhost:3000'),
      'https://app.example.com',
    );
    // ALB chains append hops; the first one is the client-facing edge.
    assert.equal(
      publicOriginFromHeaders(headers({ 'x-forwarded-proto': 'https, http', host: 'app.example.com, internal' }), 'http://localhost:3000'),
      'https://app.example.com',
    );
    assert.equal(publicOriginFromHeaders(headers({ host: 'app.example.com' }), 'http://localhost:3000'), 'http://localhost:3000');
    assert.equal(publicOriginFromHeaders(headers({}), 'http://localhost:3000'), 'http://localhost:3000');
  });

  it('mints URL-safe tokens long enough to be unguessable', () => {
    const token = randomUrlToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, randomUrlToken());
    assert.match(randomUrlToken(16), /^[A-Za-z0-9_-]{22}$/);
  });
});
