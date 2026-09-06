import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LineSignupSubmitBodyDto, PublicLineSignupController } from './public-line-signup.controller';

// The LIFF page is served BY the API, so this request's Origin is the API host — never the web app.
const REQ = {
  headers: { origin: 'https://api.example.com' },
  protocol: 'https',
  get: () => 'api.example.com',
  socket: { remoteAddress: '203.0.113.10' },
} as any;
const BODY = { idToken: 'aaaa.bbbb.cccc', companyName: 'ร้านมั่งมี', phoneNumber: '0812345678', legal: {} } as any;

/**
 * `sesWebBaseUrl: null` stands for WEB_BASE_URL being unset. `webBaseUrl` is set to the API origin
 * throughout, because that is what the loose accessor returns when only PUBLIC_BASE_URL exists —
 * so any test that passes by reading it is reading the wrong one.
 */
function harness(enabled: boolean, sesWebBaseUrl: string | null = 'https://app.mangmeeplus.com') {
  const calls: string[] = [];
  const submits: any[] = [];
  const rateLimit = {
    assertLineSignupIpAllowed: async () => { calls.push('ip'); },
    assertLineSignupReadAllowed: async () => { calls.push('read'); },
  } as any;
  const submit = {
    execute: async (cmd: any) => { calls.push('submit'); submits.push(cmd); return {} as any; },
  } as any;
  const status = { execute: async () => { calls.push('status'); return null; } } as any;
  return {
    controller: new PublicLineSignupController(
      {
        lineSignupEnabled: enabled,
        sesWebBaseUrl: sesWebBaseUrl ?? undefined,
        webBaseUrl: 'https://api.example.com',
      } as any, rateLimit, submit, status,
    ),
    calls,
    submits,
  };
}

describe('PublicLineSignupController — the flag is the rollback', () => {
  it('closes BOTH routes when LINE_SIGNUP_ENABLED is off, before any work', async () => {
    const h = harness(false);
    await assert.rejects(() => h.controller.create(BODY, REQ), (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.match(JSON.stringify((error as ForbiddenException).getResponse()), /line_signup_disabled/);
      return true;
    });
    await assert.rejects(() => h.controller.readStatus('aaaa.bbbb.cccc', REQ), ForbiddenException);
    // Unlike Flow B's asymmetric switch, nothing here strands a customer mid-flow: this flow
    // issues no links, so there is nobody holding one.
    assert.deepEqual(h.calls, [], 'not even a rate-limit counter is spent while the flag is off');
  });

  it('spends the IP bucket before the verification round trip when the flag is on', async () => {
    const h = harness(true);
    await h.controller.create(BODY, REQ);
    assert.deepEqual(h.calls, ['ip', 'submit']);
  });

  // Review LOW-1: an AUTO_FREE submit persists this base as the owner's handoff URL. Two wrong
  // answers were available — the Origin (the API that served the LIFF page) and the loose
  // `webBaseUrl` accessor (which falls back to the API's own PUBLIC_BASE_URL) — and either one
  // stores an "open my shop" link nobody can follow. Only WEB_BASE_URL is right.
  it('takes the web base from the strict WEB_BASE_URL accessor and nothing else', async () => {
    const h = harness(true);
    await h.controller.create(BODY, REQ);
    assert.equal(h.submits[0].webBaseUrl, 'https://app.mangmeeplus.com');
    assert.notEqual(h.submits[0].webBaseUrl, REQ.headers.origin, 'not the Origin header');
    assert.notEqual(h.submits[0].webBaseUrl, 'https://api.example.com', 'not the loose accessor');
  });

  it('refuses the submit when WEB_BASE_URL is unset rather than storing an API-host link', async () => {
    const h = harness(true, null);
    await assert.rejects(() => h.controller.create(BODY, REQ), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException, 'a deployment fault, not a caller fault');
      // One shared helper, one code — the admin approve path raises the same (review L-1).
      assert.match(JSON.stringify((error as ServiceUnavailableException).getResponse()), /web_base_url_not_configured/);
      return true;
    });
    assert.deepEqual(h.submits, [], 'nothing is created with a link that cannot work');
  });

  it('passes the phone straight through, because the field is required now', async () => {
    const h = harness(true);
    await h.controller.create({ ...BODY, phoneNumber: '081-234-5678' }, REQ);
    assert.equal(h.submits[0].phoneNumber, '081-234-5678', 'raw as typed; the use-case normalises it');
  });

  it('refuses a status read whose header is not even token-shaped', async () => {
    const h = harness(true);
    await assert.rejects(() => h.controller.readStatus(undefined, REQ), UnauthorizedException);
    await assert.rejects(() => h.controller.readStatus('not a jwt', REQ), UnauthorizedException);
    // The bucket is still charged: a malformed probe is exactly what it is there to bound.
    assert.deepEqual(h.calls, ['read', 'read']);
  });
});

/**
 * Owner 2026-09-05 made the phone required. The DTO is the outer half of that rule — it stops a
 * body with no phone at all before a single LINE verification round trip is spent — and the
 * use-case is the inner half. Both are asserted, because either one alone lets a blank through.
 */
describe('LineSignupSubmitBodyDto — the phone is required', () => {
  const validate = (phoneNumber: unknown) => validateSync(
    plainToInstance(LineSignupSubmitBodyDto, {
      idToken: 'aaaa.bbbb.cccc',
      companyName: 'ร้านมั่งมี',
      ...(phoneNumber === undefined ? {} : { phoneNumber }),
      legal: {
        documentVersion: 'v3',
        statementSha256: 'a'.repeat(64),
        releaseFingerprintSha256: 'b'.repeat(64),
        displayChallenge: 'c'.repeat(64),
        locale: 'th',
      },
    }),
  ).filter((error) => error.property === 'phoneNumber');

  it('rejects a body that omits the phone, and one that sends it empty', () => {
    // `@IsNotEmpty` is what rejects the empty string — the pattern itself still admits it, so
    // dropping the decorator makes this assertion fail rather than passing on someone else's rule.
    for (const value of [undefined, '']) {
      assert.notEqual(validate(value).length, 0, `phoneNumber=${JSON.stringify(value)} must not validate`);
    }
  });

  it('accepts the digits, spaces and dashes a shop owner actually types', () => {
    for (const value of ['0812345678', '081-234-5678', '081 234 5678']) {
      assert.deepEqual(validate(value), [], value);
    }
    // Separator-only strings get past the shape rule by design; `requireThaiMobile` is what refuses
    // them, with the code the LIFF page turns into a sentence (see submit-line-signup.use-case.spec).
    assert.deepEqual(validate('- -'), []);
  });
});
