import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, HttpException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../common/pipes/validation-pipe.options';
import { AuthRateLimitService } from '../application/auth-rate-limit.service';
import { LineLoginVerifierAdapter } from '../infrastructure/line-login-verifier.adapter';
import { SetAiAssistantPreferenceUseCase } from '../application/use-cases/set-ai-assistant-preference.use-case';
import { CURRENT_LEGAL_DOCUMENTS, LEGAL_ACCEPTANCE_STATEMENT_VERSION } from '@watchdog-bms/contracts';
import { AcceptLegalDocumentsDto, AuthController, EmployeeLineLinkDto, LineExchangeDto, LineLinkDto, PasswordResetRequestDto } from './auth.controller';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

function makeController(config: Record<string, unknown> = {}): AuthController {
  const stub = {} as any;
  return new AuthController(
    { lineLiffId: '1234567890-test', isLocal: false, ...config } as any,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

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
      stub, stub, notifyPasswordResetRequest, stub, stub, stub, stub, stub, rateLimit, stub,
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
      stub, stub, notifyPasswordResetRequest, stub, stub, stub, stub, stub, rateLimit, stub,
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
      stub, stub, stub, stub, pref, stub, stub, stub, stub, stub,
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
      changePassword, stub, stub, stub, stub, stub, stub, stub, stub, stub,
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
      },
    } as any;
    const legalAcceptance = {
      getStatus: async () => ({ required: true }),
    } as any;
    return new AuthController(
      stub, prisma, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, legalAcceptance,
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
