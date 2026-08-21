import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSessionAffinityToken } from './session-affinity.logic';

const SECRET = 'phase6-affinity-secret';
const on = (companyId: string | undefined, chatId: string | undefined) =>
  deriveSessionAffinityToken({ enabled: true, secret: SECRET, companyId, chatId });

describe('deriveSessionAffinityToken – privacy-safe Phase-6 session affinity (default off)', () => {
  it('is stable for one (company, chat): the same chat reuses the same warm session', () => {
    assert.equal(on('company-1', 'chat-A'), on('company-1', 'chat-A'));
  });

  it('isolates cross-chat: a different chat (same company) gets a different token (collision-resistant)', () => {
    assert.notEqual(on('company-1', 'chat-A'), on('company-1', 'chat-B'));
  });

  it('isolates cross-tenant: a different company (same chat id) gets a different token', () => {
    assert.notEqual(on('company-1', 'chat-A'), on('company-2', 'chat-A'));
  });

  it('gives distinct clusters distinct HMAC pre-images across the field boundary', () => {
    // Length-prefixing makes the PRE-IMAGE injective, so ("ab","c") and ("a","bc") never share HMAC
    // input; token inequality then follows from SHA-256 collision resistance, not a math guarantee.
    assert.notEqual(on('ab', 'c'), on('a', 'bc'));
  });

  it('never encodes raw identifiers: the opaque token contains neither id, is bounded, and is lowercase hex', () => {
    const token = on('company-secret-123', 'chat-secret-xyz')!;
    assert.ok(token);
    assert.doesNotMatch(token, /company-secret-123|chat-secret-xyz/);
    assert.equal(token.length, 32);
    assert.match(token, /^[0-9a-f]{32}$/);
  });

  it('returns undefined (no affinity, unchanged cold-session path) when off, unconfigured, or the cluster is unknown', () => {
    assert.equal(deriveSessionAffinityToken({ enabled: false, secret: SECRET, companyId: 'company-1', chatId: 'chat-A' }), undefined);
    assert.equal(deriveSessionAffinityToken({ enabled: true, secret: undefined, companyId: 'company-1', chatId: 'chat-A' }), undefined);
    assert.equal(on(undefined, 'chat-A'), undefined);
    assert.equal(on('company-1', undefined), undefined);
  });
});
