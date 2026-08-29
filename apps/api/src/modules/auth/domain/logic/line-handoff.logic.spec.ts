import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  HANDOFF_PATH_PREFIX,
  LINE_HANDOFF_TOKEN_TTL_MS,
  generateLineHandoffToken,
  hashLineHandoffToken,
  isSafeHandoffPath,
  lineHandoffUrl,
} from './line-handoff.logic';

const COMPANY = 'co-1';
/** Spelled by code point so no raw control byte ever lands in this source file. */
const ctrl = (code: number) => String.fromCharCode(code);

describe('generateLineHandoffToken', () => {
  it('mints a 24-byte base64url secret whose sha256 is what the caller stores', () => {
    const { rawToken, tokenHash } = generateLineHandoffToken();
    // 24 bytes → 32 base64url characters, no padding and no URL-unsafe alphabet, so the token
    // survives a chat message and a path segment untouched.
    assert.equal(rawToken.length, 32);
    assert.match(rawToken, /^[A-Za-z0-9_-]+$/);
    assert.equal(tokenHash, createHash('sha256').update(rawToken).digest('hex'));
    assert.equal(tokenHash.length, 64);
    assert.notEqual(tokenHash, rawToken, 'the raw token must never be what is persisted');
  });

  it('hashes stably, so an exchange can find the row it minted', () => {
    const { rawToken, tokenHash } = generateLineHandoffToken();
    assert.equal(hashLineHandoffToken(rawToken), tokenHash);
    assert.equal(hashLineHandoffToken(rawToken), hashLineHandoffToken(rawToken));
  });

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateLineHandoffToken().rawToken));
    assert.equal(seen.size, 200);
  });

  it('expires 15 minutes out by default (owner decision Q3), and honours an explicit TTL', () => {
    assert.equal(LINE_HANDOFF_TOKEN_TTL_MS, 15 * 60_000);
    const before = Date.now();
    const { expiresAt } = generateLineHandoffToken();
    const after = Date.now();
    assert.ok(expiresAt.getTime() >= before + LINE_HANDOFF_TOKEN_TTL_MS);
    assert.ok(expiresAt.getTime() <= after + LINE_HANDOFF_TOKEN_TTL_MS);

    const short = generateLineHandoffToken(1000);
    assert.ok(short.expiresAt.getTime() - Date.now() <= 1000);
  });
});

describe('isSafeHandoffPath', () => {
  it('accepts the tenant root and any path inside it, with query and hash', () => {
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}`, COMPANY), true);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/`, COMPANY), true);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/expenses/exp-1`, COMPANY), true);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/expenses?status=DRAFT`, COMPANY), true);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/expenses/exp-1#tab`, COMPANY), true);
  });

  it('refuses another company, including a prefix that only looks like this one', () => {
    assert.equal(isSafeHandoffPath('/companies/co-2/expenses/exp-1', COMPANY), false);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}-evil/expenses`, COMPANY), false);
    assert.equal(isSafeHandoffPath('/companies', COMPANY), false);
    assert.equal(isSafeHandoffPath('/system/platform-access', COMPANY), false);
  });

  it('refuses traversal that resolves out of the tenant root', () => {
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/../co-2/expenses`, COMPANY), false);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}/expenses/../../co-2`, COMPANY), false);
    assert.equal(isSafeHandoffPath('/../etc/passwd', COMPANY), false);
    // Encoded separators would survive a naive prefix check and be decoded by the browser after it.
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}%2f..%2fco-2`, COMPANY), false);
    assert.equal(isSafeHandoffPath(`/companies/${COMPANY}%5c..%5cco-2`, COMPANY), false);
  });

  it('refuses protocol-relative and absolute URLs', () => {
    assert.equal(isSafeHandoffPath('//evil.example/companies/co-1', COMPANY), false);
    assert.equal(isSafeHandoffPath('https://evil.example/companies/co-1', COMPANY), false);
    assert.equal(isSafeHandoffPath('javascript:alert(1)', COMPANY), false);
    // A backslash is a path separator to browsers, so `/\evil.example` is protocol-relative there.
    assert.equal(isSafeHandoffPath('/\\evil.example/companies/co-1', COMPANY), false);
  });

  it('refuses control characters browsers strip before parsing', () => {
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) {
      assert.equal(
        isSafeHandoffPath(`/${ctrl(code)}/evil.example`, COMPANY),
        false,
        `U+${code.toString(16).padStart(4, '0')} must not survive the check`,
      );
      assert.equal(
        isSafeHandoffPath(`/companies/${COMPANY}/exp${ctrl(code)}enses`, COMPANY),
        false,
        `U+${code.toString(16).padStart(4, '0')} inside the path must not survive either`,
      );
    }
  });

  it('refuses anything that does not start with a slash, and the empty path', () => {
    assert.equal(isSafeHandoffPath('companies/co-1/expenses', COMPANY), false);
    assert.equal(isSafeHandoffPath('', COMPANY), false);
    assert.equal(isSafeHandoffPath(undefined as unknown as string, COMPANY), false);
  });

  it('refuses a path longer than 512 characters', () => {
    const long = `/companies/${COMPANY}/expenses/${'a'.repeat(512)}`;
    assert.ok(long.length > 512);
    assert.equal(isSafeHandoffPath(long, COMPANY), false);
    const atLimit = `/companies/${COMPANY}/e`.padEnd(512, 'x');
    assert.equal(atLimit.length, 512);
    assert.equal(isSafeHandoffPath(atLimit, COMPANY), true);
  });

  it('compares against the encoded company id, so a slash in an id cannot widen the root', () => {
    // Not reachable with cuid ids; asserted so the encode is not quietly dropped later.
    assert.equal(isSafeHandoffPath('/companies/a/b/expenses', 'a/b'), false);
  });
});

describe('lineHandoffUrl', () => {
  it('builds <web>/l/<token> and tolerates a trailing slash on the base', () => {
    assert.equal(lineHandoffUrl('https://uat.mangmeeplus.com', 'tok-1'), 'https://uat.mangmeeplus.com/l/tok-1');
    assert.equal(lineHandoffUrl('https://uat.mangmeeplus.com/', 'tok-1'), 'https://uat.mangmeeplus.com/l/tok-1');
    assert.equal(HANDOFF_PATH_PREFIX, '/l/');
  });

  it('sits outside /companies/, so the cookie-less page bounce cannot intercept it', () => {
    const url = new URL(lineHandoffUrl('https://uat.mangmeeplus.com', 'tok-1'));
    assert.ok(!url.pathname.startsWith('/companies/'));
  });
});
