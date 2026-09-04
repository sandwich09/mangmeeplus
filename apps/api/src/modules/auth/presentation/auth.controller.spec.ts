import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, HttpException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../common/pipes/validation-pipe.options';
import { AuthRateLimitService } from '../application/auth-rate-limit.service';
import { LineLoginVerifierAdapter } from '../infrastructure/line-login-verifier.adapter';
import { SetAiAssistantPreferenceUseCase } from '../application/use-cases/set-ai-assistant-preference.use-case';
import { CURRENT_LEGAL_DOCUMENTS, LEGAL_ACCEPTANCE_STATEMENT_VERSION } from '@watchdog-bms/contracts';
import { AcceptLegalDocumentsDto, AuthController, EmployeeLineLinkDto, LineExchangeDto, LineLinkDto, PasswordResetRequestDto } from './auth.controller';
import { LIFF_PAGE_SCRIPT } from '../../../common/security/liff-page.security';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

function makeController(config: Record<string, unknown> = {}): AuthController {
  const stub = {} as any;
  return new AuthController(
    { lineLiffId: '1234567890-test', isLocal: false, ...config } as any,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub,
  );
}

/**
 * Every construction below is positional, so a new constructor parameter silently shifts whatever
 * a test placed by hand — `rateLimit` lands on `legalAcceptance` and the test still "passes" while
 * exercising nothing. Two branches each grew the last stub row from five entries to six
 * independently, and the merged constructor needed seven; nothing said so, because a missing
 * trailing argument is `undefined` and the suites run through tsx, which does not typecheck.
 *
 * This pins the arity and the positions the tests below actually depend on. If it fails, do NOT
 * pad the rows until it goes green — re-read the constructor and re-count by name.
 */
describe('AuthController constructor shape', () => {
  const NAMED_POSITIONS: ReadonlyArray<readonly [number, string]> = [
    [2, 'prisma'], [11, 'changePassword'], [13, 'notifyPasswordResetRequest'],
    [15, 'setAiAssistantPreferenceUseCase'], [19, 'authRateLimit'], [20, 'legalAcceptance'],
  ];

  it('has the arity and the parameter order the positional stubs assume', () => {
    const source = readFileSync(join(__dirname, 'auth.controller.ts'), 'utf8');
    const start = source.indexOf('constructor(', source.indexOf('export class AuthController'));
    const params = [...source.slice(start, source.indexOf(') {}', start)).matchAll(/private readonly (\w+):/g)]
      .map((match) => match[1]!);

    assert.equal(params.length, 30, 'constructor arity changed: re-count the stub rows BY NAME');
    assert.equal(params.at(-1), 'audit', 'the optional audit param must stay last');
    for (const [position, name] of NAMED_POSITIONS) {
      assert.equal(params[position - 1], name, `parameter #${position} moved; the stub rows now place a fake on the wrong dependency`);
    }
  });
});

function request(url: string) {
  return {
    url,
    headers: {},
    protocol: 'https',
    get: () => 'api.example.test',
  } as any;
}

function responseHeaders(method: (...args: any[]) => unknown): Record<string, string> {
  return Object.fromEntries(
    ((Reflect.getMetadata(HEADERS_METADATA, method) ?? []) as Array<{ name: string; value: string }>)
      .map(({ name, value }) => [name.toLowerCase(), value]),
  );
}

function assertOnlyExternalScripts(html: string): void {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  for (const [, attributes, body] of scripts) {
    assert.match(attributes!, /\bsrc="[^"]+"/);
    assert.equal(body!.trim(), '');
  }
}

function runLiffClientGate(userAgent: string) {
  const elements: Record<string, Record<string, any>> = {
    status: { textContent: '' },
    detail: { textContent: '' },
    register: { disabled: false, addEventListener() {} },
    'open-line': { hidden: true, href: '' },
    'client-notice': { hidden: true },
    'liff-content': { hidden: false },
  };
  runInNewContext(LIFF_PAGE_SCRIPT, {
    document: {
      body: { dataset: { liffMode: 'customer', liffId: '', apiBase: '', devMode: 'false', oaAddUrl: '' } },
      getElementById: (id: string) => elements[id] ?? null,
      // The signup/waiting cards' "ปิด" buttons are bound by selector; this page has none.
      querySelectorAll: () => [],
    },
    navigator: { userAgent },
    location: { href: 'https://api.example.test/v1/auth/line/customer-register-page', origin: 'https://api.example.test', search: '' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    URL,
    URLSearchParams,
    setTimeout,
    fetch: globalThis.fetch,
  });
  return elements;
}

describe('AuthController password reset request', () => {
  it('does not let a spoofed first XFF hop create a fresh password-reset bucket', async () => {
    const rateLimit = new AuthRateLimitService({
      passwordResetRequestMaxPerIdentifier: 10,
      passwordResetRequestMaxPerIp: 1,
      passwordResetRequestWindowSeconds: 60,
    } as any);
    const stub = {} as any;
    const calls: unknown[] = [];
    const notifyPasswordResetRequest = {
      execute: async (input: unknown) => { calls.push(input); return { message: 'generic' }; },
    } as any;
    const controller = new AuthController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, notifyPasswordResetRequest, stub, stub, stub, stub, stub, rateLimit, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub,
    );

    const body = await controller.requestPasswordResetNotice({ username: 'first' }, {
      headers: { 'x-forwarded-for': 'spoof-a, 198.51.100.8' },
      socket: { remoteAddress: '10.0.0.5' },
    } as any);

    assert.deepEqual(body, { message: 'generic' });
    assert.equal((calls[0] as any).username, 'first');
    assert.ok((calls[0] as any).requestId);

    await assert.rejects(
      () => controller.requestPasswordResetNotice({ username: 'second' }, {
        headers: { 'x-forwarded-for': 'spoof-b, 198.51.100.8' },
        socket: { remoteAddress: '10.0.0.5' },
      } as any),
      HttpException,
    );
    assert.equal(calls.length, 1, 'a rate-limited request must never reach the use case');
  });

  // L-06: `alice`, `Alice` and `ALICE` used to occupy three buckets, multiplying the
  // per-identifier quota by every case permutation of the same account name.
  it('puts case-variant identifiers in one rate-limit bucket', async () => {
    const rateLimit = new AuthRateLimitService({
      passwordResetRequestMaxPerIdentifier: 2,
      passwordResetRequestMaxPerIp: 100,
      passwordResetRequestWindowSeconds: 60,
    } as any);
    const stub = {} as any;
    const notifyPasswordResetRequest = { execute: async () => ({ message: 'generic' }) } as any;
    const controller = new AuthController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, notifyPasswordResetRequest, stub, stub, stub, stub, stub, rateLimit, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub,
    );
    const req = { headers: {}, socket: { remoteAddress: '198.51.100.9' } } as any;

    await controller.requestPasswordResetNotice({ username: 'alice' }, req);
    await controller.requestPasswordResetNotice({ username: '  Alice ' }, req);
    await assert.rejects(
      () => controller.requestPasswordResetNotice({ username: 'ALICE' }, req),
      HttpException,
      'the third case permutation must draw on the same exhausted bucket',
    );
  });
});

describe('legal acceptance DTO boundary', () => {
  const valid = {
    termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
    privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
    statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    termsAccepted: true,
    privacyAcknowledged: true,
    deletionAcknowledged: true,
    locale: 'th',
    displayChallenge: 'a'.repeat(64),
  };

  it('accepts only explicit true confirmations', async () => {
    await pipe.transform(valid, { type: 'body', metatype: AcceptLegalDocumentsDto });
    for (const body of [
      { ...valid, termsAccepted: false },
      { ...valid, privacyAcknowledged: 'true' },
      { ...valid, deletionAcknowledged: undefined },
      { ...valid, displayChallenge: 'not-a-sha256' },
    ]) {
      await assert.rejects(
        () => pipe.transform(body, { type: 'body', metatype: AcceptLegalDocumentsDto }),
        BadRequestException,
      );
    }
  });

  it('rejects unsupported locales and client-supplied actor context', async () => {
    for (const locale of ['en', 'ja']) {
      await assert.rejects(
        () => pipe.transform({ ...valid, locale }, { type: 'body', metatype: AcceptLegalDocumentsDto }),
        BadRequestException,
      );
    }
    await assert.rejects(
      () => pipe.transform({ ...valid, companyId: 'other-company' }, { type: 'body', metatype: AcceptLegalDocumentsDto }),
      BadRequestException,
    );
  });
});

// PDPA objection route (M-05 register §3.1): the toggle writes only the caller's own row
// and records the change; the controller passes the session user, never a body-supplied id.
describe('AI assistant preference (PDPA opt-out)', () => {
  function makePrefUseCase() {
    const updates: any[] = [];
    const audits: any[] = [];
    const prisma = { client: { user: { update: async (args: any) => { updates.push(args); return args; } } } } as any;
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    return { useCase: new SetAiAssistantPreferenceUseCase(prisma, audit), updates, audits };
  }

  it('opt-out sets the timestamp on the caller row and audits the change', async () => {
    const { useCase, updates, audits } = makePrefUseCase();
    await useCase.execute('user-1', false, 'req-1');

    assert.deepEqual(updates[0].where, { id: 'user-1' });
    assert.ok(updates[0].data.aiAssistantOptOutAt instanceof Date);
    assert.equal(audits[0].action, 'auth.ai_assistant.preference_update');
    assert.equal(audits[0].actorUserId, 'user-1');
    assert.deepEqual(audits[0].metadataJson, { enabled: false });
  });

  it('opt-in clears the timestamp', async () => {
    const { useCase, updates, audits } = makePrefUseCase();
    await useCase.execute('user-1', true, 'req-2');

    assert.equal(updates[0].data.aiAssistantOptOutAt, null);
    assert.deepEqual(audits[0].metadataJson, { enabled: true });
  });

  it('controller passes the session user id, not anything body-supplied', async () => {
    const calls: any[] = [];
    const stub = {} as any;
    const pref = { execute: async (...args: unknown[]) => { calls.push(args); } } as any;
    const controller = new AuthController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, pref, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub,
    );

    await controller.setAiAssistantPreference({ enabled: false } as any, {
      context: { userId: 'session-user', requestId: 'req-9' },
    } as any);

    assert.deepEqual(calls[0], ['session-user', false, 'req-9']);
  });
});

describe('AuthController password change session binding', () => {
  it('passes the authenticated session id so only other sessions are revoked', async () => {
    const calls: unknown[][] = [];
    const stub = {} as any;
    const changePassword = { execute: async (...args: unknown[]) => { calls.push(args); } } as any;
    const controller = new AuthController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      changePassword, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub,
    );
    const payload = Buffer.from(JSON.stringify({ sid: 'session-current' })).toString('base64url');

    await controller.changeCurrentPassword(
      { currentPassword: 'old-password', newPassword: 'new-password' } as any,
      {
        headers: { authorization: `Bearer x.${payload}.y` },
        context: { userId: 'user-1' },
      } as any,
    );

    assert.deepEqual(calls[0], ['user-1', 'old-password', 'new-password', 'session-current']);
  });
});

// AuthGuard exempts /v1/auth/* from the temporary-password block, so GET /auth/me answers a blocked
// session too — and is therefore the only place it can learn that every other route is closed to it.
describe('AuthController me()', () => {
  function makeMeController(mustChangePassword: boolean | null) {
    const stub = {} as any;
    const prisma = {
      client: {
        user: { findUnique: async () => ({ displayName: 'Somsak' }) },
        userCredential: { findUnique: async () => (mustChangePassword === null ? null : { mustChangePassword }) },
        companyMembership: { findFirst: async (query: any) => {
          assert.deepEqual(query.where, { id: 'm-1', companyId: 'company-1', userId: 'user-1', status: 'ACTIVE' });
          return { roles: query.select.roles.where.role.key.in.map((key: string) => ({ role: { key, name: key === 'CUSTOM_QA' ? 'QA named role' : 'Owner' } })) };
        } },
      },
    } as any;
    const legalAcceptance = {
      getStatus: async () => ({ required: true }),
    } as any;
    return new AuthController(
      stub, prisma, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, legalAcceptance, stub, stub,
      stub, stub, stub, stub, stub, stub, stub,
    );
  }

  const context = {
    context: {
      userId: 'user-1', companyId: 'company-1', membershipId: 'm-1',
      roles: ['OWNER'], permissions: [], scopes: {}, authProvider: 'watchdog',
    },
  } as any;

  it('reports a pending temporary password', async () => {
    assert.equal((await makeMeController(true).me(context)).mustChangePassword, true);
  });

  it('reports a normal session as free to navigate', async () => {
    const result = await makeMeController(false).me(context);
    assert.equal(result.mustChangePassword, false);
    assert.equal(result.legalAcceptanceRequired, true);
  });

  it('returns names only for roles held by the current user in the exact company membership', async () => {
    const result = await makeMeController(false).me({ context: { ...context.context, roles: ['OWNER', 'CUSTOM_QA'] } } as any);
    assert.deepEqual((result as any).roleNames, { OWNER: 'Owner', CUSTOM_QA: 'QA named role' });
    assert.deepEqual(result.roles, ['OWNER', 'CUSTOM_QA']);
  });

  // LINE-only users have no credential row; absent must never read as blocked.
  it('treats a missing credential as not blocked', async () => {
    assert.equal((await makeMeController(null).me(context)).mustChangePassword, false);
  });
});

describe('AuthController LIFF page security (H-08)', () => {
  it('does not reflect a closing-script employee token into executable HTML', async () => {
    const payload = '</script><script>globalThis.__h08_xss__=true</script>';
    const html = await makeController().employeeLineLinkPage(
      request(`/v1/auth/line/link-page/employee?token=${encodeURIComponent(payload)}`),
    );

    assert.equal(html.includes(payload), false);
    assert.equal(html.includes('__h08_xss__'), false);
    assertOnlyExternalScripts(html);
    assert.match(html, /data-liff-mode="employee"/);
    assert.match(html, /data-client-compatibility-notice="generic"/);
    assert.match(html, /id="liff-content"/);
  });

  it('serves static same-origin client code and a CSP without inline script permission', async () => {
    const controller = makeController();
    assertOnlyExternalScripts(await controller.lineLinkPage(request('/v1/auth/line/link-page')));
    assert.match(controller.lineLinkPageScript(), /url\.origin === location\.origin/);
    assert.match(controller.lineLinkPageScript(), /removeQueryParam\('token'\)/);

    for (const method of [AuthController.prototype.lineLinkPage, AuthController.prototype.employeeLineLinkPage]) {
      const headers = responseHeaders(method);
      const scriptSrc = headers['content-security-policy']!.split(';').find((directive) => directive.trim().startsWith('script-src'))!;
      assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
      assert.equal(headers['referrer-policy'], 'no-referrer');
    }
  });

  it('disables LIFF actions below the vendor floors and fails open for supported or unknown clients', () => {
    const cases: Array<[string, boolean]> = [
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) Mobile/15E148 Line/14.1.0', true],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) Mobile/15E148 Line/14.1.0', false],
      ['Mozilla/5.0 (Linux; Android 7.1) AppleWebKit/537.36 Line/14.1.0', true],
      ['Mozilla/5.0 (Linux; Android 8.0) AppleWebKit/537.36 Line/14.1.0', false],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148 Line/13.20.0', true],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148 Line/13.20.1', false],
      ['CustomClient/1.0', false],
    ];

    for (const [userAgent, unsupported] of cases) {
      const elements = runLiffClientGate(userAgent);
      assert.equal(elements['client-notice'].hidden, !unsupported, userAgent);
      assert.equal(elements['liff-content'].hidden, unsupported, userAgent);
      assert.equal(elements.register.disabled, unsupported, userAgent);
    }
  });

  it('rejects malformed or oversized LINE credentials at the global DTO boundary', async () => {
    const validIdToken = 'header.payload.signature';
    const cases: Array<[any, Record<string, unknown>]> = [
      [EmployeeLineLinkDto, { token: '</script>', idToken: validIdToken }],
      [EmployeeLineLinkDto, { token: 'a'.repeat(32), idToken: 'not-a-jwt' }],
      [LineExchangeDto, { idToken: validIdToken, channelId: 'line channel<script>' }],
      [LineLinkDto, { idToken: `${'a'.repeat(4093)}.b.c`, companyId: 'company-1' }],
      [PasswordResetRequestDto, { username: 'a'.repeat(65) }],
    ];
    for (const [metatype, body] of cases) {
      await assert.rejects(
        () => pipe.transform(body, { type: 'body', metatype }),
        BadRequestException,
      );
    }

    const valid = await pipe.transform(
      { token: 'a'.repeat(32), idToken: validIdToken },
      { type: 'body', metatype: EmployeeLineLinkDto },
    );
    assert.equal(valid.token.length, 32);
  });

  it('rejects malformed LINE ID tokens before calling the provider', async () => {
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (async () => { providerCalls += 1; throw new Error('must not call provider'); }) as typeof fetch;
    try {
      const verifier = new LineLoginVerifierAdapter({ lineLoginChannelId: '1234567890' } as any);
      await assert.rejects(() => verifier.verify('</script>'), UnauthorizedException);
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
