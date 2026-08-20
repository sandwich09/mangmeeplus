import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCsrfTokenValid,
  isProtectedPagePath,
  isSameOriginRequest,
  requiresCsrfCheck,
  sanitizeNextPath,
} from './middleware.logic';

describe('middleware.logic', () => {
  it('protects workspace and system pages only', () => {
    assert.equal(isProtectedPagePath('/companies/c1/dashboard'), true);
    assert.equal(isProtectedPagePath('/system'), true);
    assert.equal(isProtectedPagePath('/system/partners'), true);
    assert.equal(isProtectedPagePath('/legal-acceptance'), true);
    assert.equal(isProtectedPagePath('/login'), false);
    assert.equal(isProtectedPagePath('/'), false);
    assert.equal(isProtectedPagePath('/systematic'), false);
    assert.equal(isProtectedPagePath('/legal-acceptance-preview'), false);
  });

  it('accepts same-origin Origin headers and rejects cross-origin ones', () => {
    assert.equal(isSameOriginRequest('http://localhost:3000', null, 'localhost:3000'), true);
    assert.equal(isSameOriginRequest('https://evil.example', null, 'localhost:3000'), false);
    assert.equal(isSameOriginRequest('not-a-url', null, 'localhost:3000'), false);
  });

  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    assert.equal(isSameOriginRequest(null, 'same-origin', 'localhost:3000'), true);
    assert.equal(isSameOriginRequest(null, 'none', 'localhost:3000'), true);
    assert.equal(isSameOriginRequest(null, 'cross-site', 'localhost:3000'), false);
    assert.equal(isSameOriginRequest(null, 'same-site', 'localhost:3000'), false);
  });

  it('allows non-browser clients that send neither header', () => {
    assert.equal(isSameOriginRequest(null, null, 'localhost:3000'), true);
  });

  it('requires CSRF only for cookie-authenticated mutations on data routes', () => {
    assert.equal(requiresCsrfCheck('POST', '/api/v1/companies/c1/expenses', true), true);
    assert.equal(requiresCsrfCheck('PATCH', '/api/v1/companies/c1/expenses/e1', true), true);
    assert.equal(requiresCsrfCheck('GET', '/api/v1/companies/c1/expenses', true), false);
    assert.equal(requiresCsrfCheck('POST', '/api/v1/companies/c1/expenses', false), false);
    assert.equal(requiresCsrfCheck('POST', '/api/auth/login', true), false);
  });

  it('validates the double-submit CSRF pair', () => {
    assert.equal(isCsrfTokenValid('abc', 'abc'), true);
    assert.equal(isCsrfTokenValid('abc', 'xyz'), false);
    assert.equal(isCsrfTokenValid(undefined, 'abc'), false);
    assert.equal(isCsrfTokenValid('', ''), false);
  });

  // L-07: the compare must be length-safe and never short-circuit on the first differing byte.
  it('rejects CSRF tokens that differ only in length, in either direction', () => {
    assert.equal(isCsrfTokenValid('abc', 'abcd'), false, 'header longer than cookie');
    assert.equal(isCsrfTokenValid('abcd', 'abc'), false, 'header shorter than cookie');
    assert.equal(isCsrfTokenValid('abc', 'abcabc'), false, 'header is a repeat of the cookie');
    assert.equal(isCsrfTokenValid('abcabc', 'abc'), false, 'cookie is a repeat of the header');
  });

  it('rejects an empty expected value and an empty supplied value without comparing', () => {
    assert.equal(isCsrfTokenValid('', 'abc'), false, 'empty expected cookie is never valid');
    assert.equal(isCsrfTokenValid('abc', ''), false, 'empty supplied header is never valid');
    assert.equal(isCsrfTokenValid(undefined, null), false);
  });

  it('accepts a realistic random token pair and rejects a one-character mutation of it', () => {
    const token = 'a3f9c1d47b2e8056a3f9c1d47b2e8056';
    assert.equal(isCsrfTokenValid(token, token), true);
    assert.equal(isCsrfTokenValid(token, `${token.slice(0, -1)}7`), false, 'differs only in the last byte');
    assert.equal(isCsrfTokenValid(token, `7${token.slice(1)}`), false, 'differs only in the first byte');
  });

  it('sanitizes next-path redirects to same-app paths', () => {
    assert.equal(sanitizeNextPath('/companies/c1/dashboard'), '/companies/c1/dashboard');
    assert.equal(sanitizeNextPath('https://evil.example/x'), null);
    assert.equal(sanitizeNextPath('//evil.example'), null);
    assert.equal(sanitizeNextPath('/\\evil.example'), null);
    assert.equal(sanitizeNextPath('/\tevil.example'), null);
    assert.equal(sanitizeNextPath('/\n/evil.example'), null);
    assert.equal(sanitizeNextPath('/\r/evil.example'), null);
    assert.equal(sanitizeNextPath('/safe\\evil.example'), null);
    assert.equal(sanitizeNextPath(''), null);
    assert.equal(sanitizeNextPath(null), null);
  });
});
