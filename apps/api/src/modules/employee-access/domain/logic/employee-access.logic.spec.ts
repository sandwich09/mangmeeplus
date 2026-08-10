import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineLinkPackage,
  generateLineLinkToken,
  generateTemporaryPassword,
  generateUsernameCandidate,
  hashIdentityNumber,
  hashLineLinkToken,
  identityLast4,
  maskIdentityNumber,
  normalizeIdentityNumber,
  OWNER_LINE_LINK_TOKEN_TTL_MS,
  roleGrantViolation,
} from './employee-access.logic';

const KEY = Buffer.from('a'.repeat(64), 'hex');

describe('employee-access.logic', () => {
  it('normalizes Thai national ID by stripping dashes', () => {
    assert.equal(normalizeIdentityNumber('1-2345-67890-12-3'), '1234567890123');
  });

  it('normalizes passport by uppercasing', () => {
    assert.equal(normalizeIdentityNumber('ab1234567'), 'AB1234567');
  });

  it('identityLast4 returns last 4 normalized characters', () => {
    assert.equal(identityLast4('1-2345-67890-12-3'), '0123');
  });

  it('maskIdentityNumber renders the spec example format', () => {
    assert.equal(maskIdentityNumber('1234'), '*********1234');
  });

  it('hashIdentityNumber is deterministic for equivalent formatting', () => {
    const a = hashIdentityNumber('1-2345-67890-12-3', KEY);
    const b = hashIdentityNumber('123456789 0123', KEY);
    assert.equal(a, b);
  });

  it('hashIdentityNumber differs for different values or keys', () => {
    const a = hashIdentityNumber('1234567890123', KEY);
    const b = hashIdentityNumber('9999999999999', KEY);
    const c = hashIdentityNumber('1234567890123', Buffer.from('b'.repeat(64), 'hex'));
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it('generateTemporaryPassword produces a non-empty safe-charset string', () => {
    const pw = generateTemporaryPassword();
    assert.ok(pw.length > 0);
    assert.doesNotMatch(pw, /[+/=]/);
  });

  it('generateUsernameCandidate falls back to "emp" for non-ASCII names', () => {
    const username = generateUsernameCandidate('สมชาย ใจดี');
    assert.match(username, /^emp\.[0-9a-f]{6}$/);
  });

  it('generateUsernameCandidate slugifies ASCII names', () => {
    const username = generateUsernameCandidate('Somchai Jaidee');
    assert.match(username, /^somchaijaidee\.[0-9a-f]{6}$/);
  });

  it('generateLineLinkToken returns a token whose hash matches hashLineLinkToken', () => {
    const { rawToken, tokenHash, expiresAt } = generateLineLinkToken();
    assert.equal(hashLineLinkToken(rawToken), tokenHash);
    assert.ok(expiresAt.getTime() > Date.now());
  });

  it('generateLineLinkToken tokens are single use in the sense that raw value never repeats trivially', () => {
    const a = generateLineLinkToken();
    const b = generateLineLinkToken();
    assert.notEqual(a.rawToken, b.rawToken);
  });

  it('buildLineLinkPackage renders the QR locally as an SVG data URI (H-09: bearer link never leaves to a third party)', () => {
    const expiresAt = new Date('2026-07-18T12:00:00.000Z');
    const pkg = buildLineLinkPackage('https://api.example.com/v1', 'raw-token-value', expiresAt);

    assert.equal(pkg.linkUrl, 'https://api.example.com/v1/auth/line/link-page/employee?token=raw-token-value');
    assert.match(pkg.qrImageUrl, /^data:image\/svg\+xml;base64,/);
    assert.ok(!pkg.qrImageUrl.includes('qrserver'));
    const svg = Buffer.from(pkg.qrImageUrl.split(',')[1] ?? '', 'base64').toString('utf8');
    assert.match(svg, /^<svg/);
    // Opaque background: a saved/forwarded QR must stay scannable on dark surfaces.
    assert.ok(svg.includes('<rect width="100%" height="100%" fill="#ffffff"/>'));
    // The token rides inside the QR modules, never as SVG text.
    assert.ok(!svg.includes('raw-token-value'));
    assert.equal(pkg.expiresAt, expiresAt.toISOString());
  });

  it('buildLineLinkPackage QR content differs per token', () => {
    const expiresAt = new Date();
    const a = buildLineLinkPackage('https://api.example.com/v1', 'token-a', expiresAt);
    const b = buildLineLinkPackage('https://api.example.com/v1', 'token-b', expiresAt);
    assert.notEqual(a.qrImageUrl, b.qrImageUrl);
  });

  it('buildLineLinkPackage prefers the LIFF universal link on configured environments', () => {
    const pkg = buildLineLinkPackage(
      'https://uat.example.com/v1',
      'raw-token-value',
      new Date('2026-07-29T12:00:00.000Z'),
      '2010784350-ruzn5beM',
    );

    assert.equal(pkg.linkUrl, 'https://liff.line.me/2010784350-ruzn5beM/employee?token=raw-token-value');
  });

  it('matches the owner LINE link token TTL to the 72h temporary-password window', () => {
    assert.equal(OWNER_LINE_LINK_TOKEN_TTL_MS, 72 * 60 * 60 * 1000);
  });

  it('rejects grants above the granter and requires owner approval for finance roles', () => {
    assert.match(roleGrantViolation([{ key: 'SALES', permissionKeys: ['crm.customer.read'] }], []) ?? '', /does not hold/);
    assert.match(roleGrantViolation([{ key: 'FINANCE', permissionKeys: [] }], []) ?? '', /owner approval/);
    assert.equal(roleGrantViolation([{ key: 'SALES', permissionKeys: ['crm.customer.read'] }], [], true), undefined);
    assert.equal(roleGrantViolation(
      [{ key: 'FINANCE', permissionKeys: ['accounting.payment.create'] }],
      ['accounting.payment.create', 'access.role.financial.assign'],
    ), undefined);
  });
});
