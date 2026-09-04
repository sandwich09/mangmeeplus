import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { LIFF_PAGE_SCRIPT } from '../../common/security/liff-page.security';
import { IS_PUBLIC_ROUTE_KEY } from '../../common/security/public.decorator';
import { currentLegalRelease } from './application/legal-acceptance.service';
import { AuthController } from './presentation/auth.controller';
import { ExchangeLiffSessionUseCase } from './application/use-cases/exchange-liff-session.use-case';

const WEB_BASE = 'https://app.example.test';
const LINE_USER = 'Uabc123';
const CHANNEL = '2001';

function makeController(config: Record<string, unknown> = {}): AuthController {
  const stub = {} as any;
  return new AuthController(
    { lineLiffId: '1234567890-test', isLocal: false, sesWebBaseUrl: WEB_BASE, ...config } as any,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub,
  );
}

const request = () => ({ url: '/v1/auth/line/link-page/signup', headers: {}, protocol: 'https', get: () => 'api.example.test' }) as any;

function responseHeaders(method: (...args: any[]) => unknown): Record<string, string> {
  return Object.fromEntries(
    ((Reflect.getMetadata(HEADERS_METADATA, method) ?? []) as Array<{ name: string; value: string }>)
      .map(({ name, value }) => [name.toLowerCase(), value]),
  );
}

/** H-08: the page's whole script budget is the two external tags; nothing may execute inline. */
function assertOnlyExternalScripts(html: string): void {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  for (const [, attributes, body] of scripts) {
    assert.match(attributes!, /\bsrc="[^"]+"/);
    assert.equal(body!.trim(), '');
  }
}

describe('P10-L LIFF signup page', () => {
  it('serves the legal release it is currently serving, and nothing executable inline', () => {
    const html = makeController().lineSignupPage(request());
    const release = currentLegalRelease('th');

    assertOnlyExternalScripts(html);
    // The four values the submit is checked against. Asserted as the ATTRIBUTES the script reads,
    // not merely as text present somewhere on the page: the challenge is also printed in the legal
    // block, so a plain `includes` would still pass while the attribute the form posts was stale —
    // and a stale challenge is evidence of an agreement to text nobody was shown.
    assert.ok(html.includes(`data-legal-challenge="${release.displayChallenge}"`), 'challenge attribute');
    assert.ok(html.includes(`data-legal-version="${release.documentVersion}"`));
    assert.ok(html.includes(`data-legal-statement="${release.statementSha256}"`));
    assert.ok(html.includes(`data-legal-release="${release.releaseFingerprintSha256}"`));
    assert.ok(html.includes('ฉันยอมรับข้อกำหนดการใช้งาน MangmeePlus'), 'statement text is shown, not just hashed');
    assert.ok(html.includes(`${WEB_BASE}/terms`) && html.includes(`${WEB_BASE}/privacy`));
  });

  it('asks for a shop name and an optional phone, and promises the trial in the Owner wording', () => {
    const html = makeController().lineSignupPage(request());

    assert.ok(html.includes('id="company-name"'));
    assert.ok(html.includes('inputmode="numeric"'), 'the phone field opens a number keypad');
    assert.ok(html.includes('เบอร์มือถือ (ไม่บังคับ)'), 'optional label, not a required asterisk');
    assert.ok(html.includes('ยอมรับและเริ่มทดลองใช้ฟรี'));
    assert.ok(html.includes('ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง ไม่ต้องใส่บัตร'));
  });

  it('keeps the LIFF CSP and writes no plus sign into customer copy', () => {
    const csp = responseHeaders(AuthController.prototype.lineSignupPage)['content-security-policy']!;
    const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src'))!;
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'script-src must never admit inline code');
    assert.equal(scriptSrc, "script-src 'self' https://static.line-scdn.net");
    assert.equal(responseHeaders(AuthController.prototype.lineSignupPage)['referrer-policy'], 'no-referrer');

    // Owner copy rule: write "และ". Checked on the rendered body, where the customer reads it.
    const body = makeController().lineSignupPage(request()).split('<body')[1]!;
    assert.ok(!body.includes('+'), 'no plus sign anywhere a customer can see');
  });

  // L-12. The two legal links are what makes the acceptance binding, and the API origin does not
  // serve /terms or /privacy — a page rendered against it would collect agreement to two 404s.
  // Refusing is the same rule the session exchange follows for a URL it cannot point anywhere.
  it('refuses to render rather than pointing the legal links at the API origin', () => {
    assert.throws(
      () => makeController({ sesWebBaseUrl: undefined }).lineSignupPage(request()),
      ServiceUnavailableException,
    );

    const html = makeController().lineSignupPage(request());
    assert.ok(html.includes(`href="${WEB_BASE}/terms"`), 'the WEB origin, spelled out');
    assert.ok(html.includes(`href="${WEB_BASE}/privacy"`));
    assert.equal(html.includes('href="https://api.example.test'), false);
    assert.equal(html.includes('href="/terms"'), false, 'never a bare path against the API host');
  });

  it('renders the start page with an external-browser fallback link', () => {
    const html = makeController().lineStartPage(request());
    assertOnlyExternalScripts(html);
    assert.ok(html.includes('data-liff-mode="start"'));
    assert.ok(html.includes('id="open-web"'), 'a tappable fallback when openWindow is refused');
    assert.ok(html.includes('/v1/auth/line/link-page/signup'), 'needsSignup has somewhere to go');
  });
});

describe('POST /v1/auth/line/liff/session (the surface)', () => {
  it('passes the token through and omits companyId until the picker answers', async () => {
    const calls: any[] = [];
    const stub = {} as any;
    const controller = new AuthController(
      { lineLiffId: '1234567890-test', sesWebBaseUrl: WEB_BASE } as any,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub,
      // The LIFF session exchange is the last constructor parameter before the optional audit.
      { execute: async (cmd: any) => { calls.push(cmd); return { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` }; } } as any,
    );

    const first = await controller.lineLiffSession({ idToken: 'a.b.c' } as any);
    assert.deepEqual(first, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
    assert.deepEqual(calls[0], { idToken: 'a.b.c' }, 'no companyId key at all on the first call');

    await controller.lineLiffSession({ idToken: 'a.b.c', companyId: 'co-2' } as any);
    assert.deepEqual(calls[1], { idToken: 'a.b.c', companyId: 'co-2' });
  });

  it('is reachable with no session, at the path spec §4 names', () => {
    // The ID token IS the credential here: a page with no cookie has to be able to call this.
    assert.equal(Reflect.getMetadata('path', AuthController.prototype.lineLiffSession), 'line/liff/session');
    assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, AuthController.prototype.lineLiffSession), true);
  });
});

describe('P10-L LIFF client script', () => {
  /** Runs the shared script in a sandbox with the DOM the signup page provides. */
  const CHALLENGE = 'c'.repeat(64);

  function runSignupScript(statusBody: string, responses: Array<{ status: number; body: string }> = []) {
    const handlers: Record<string, Array<() => unknown>> = {};
    const listen = (key: string) => (_event: string, handler: () => unknown) => {
      (handlers[key] ??= []).push(handler);
    };
    const elements: Record<string, Record<string, any>> = {
      status: { textContent: '' },
      detail: { textContent: '' },
      greeting: { textContent: '' },
      link: { disabled: true, addEventListener: listen('link') },
      'client-notice': { hidden: true },
      'liff-content': { hidden: false },
      'pending-text': { textContent: '' },
      'done-text': { textContent: '' },
      'company-name': { value: 'ร้านนิด' },
      'phone-number': { value: '' },
    };
    const closeButtons = [{ addEventListener: listen('close') }];
    const views = [
      { id: 'form-view', hidden: true },
      { id: 'done-view', hidden: true },
      { id: 'pending-view', hidden: true },
    ];
    const calls: Array<{ url: string; init: any }> = [];
    let closed = 0;
    runInNewContext(LIFF_PAGE_SCRIPT, {
      document: {
        body: {
          dataset: {
            liffMode: 'signup', liffId: '1234567890-test', apiBase: 'https://api.example.test/v1',
            legalVersion: 'v3', legalStatement: 'a', legalRelease: 'b', legalChallenge: CHALLENGE, legalLocale: 'th',
          },
        },
        getElementById: (id: string) => elements[id] ?? views.find((view) => view.id === id) ?? null,
        querySelectorAll: (selector: string) => (selector === '[data-close]' ? closeButtons : views),
      },
      liff: {
        init: async () => {},
        isLoggedIn: () => true,
        getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600, name: 'นิด' }),
        getIDToken: () => 'aaa.bbb.ccc',
        closeWindow: () => { closed += 1; },
        openWindow: () => {},
      },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/14.0.0' },
      location: { href: 'https://api.example.test/v1/auth/line/link-page/signup', origin: 'https://api.example.test', search: '' },
      history: { replaceState() {} },
      localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
      URL,
      URLSearchParams,
      setTimeout,
      fetch: async (url: string, init: any) => {
        calls.push({ url, init });
        const scripted = responses[calls.length - 1];
        if (scripted) return { ok: scripted.status < 400, status: scripted.status, text: async () => scripted.body };
        return { ok: true, status: 200, text: async () => statusBody };
      },
    });
    return {
      elements, views, calls, handlers,
      closed: () => closed,
      click: async (key: string) => {
        for (const handler of handlers[key] ?? []) await handler();
      },
    };
  }

  const settle = () => new Promise((resolve) => { setImmediate(resolve); });

  it('reads status exactly once on open and then shows the form', async () => {
    const { elements, views, calls } = runSignupScript('null');
    await settle();
    await settle();

    assert.equal(calls.length, 1, 'one read on open — this page must never poll on a timer');
    assert.equal(calls[0]!.url, 'https://api.example.test/v1/public/line-signups/me');
    // A credential belongs in a header, never in a URL that lands in an access log (spec §9).
    assert.equal(calls[0]!.init.headers['x-line-id-token'], 'aaa.bbb.ccc');
    assert.equal(views.find((view) => view.id === 'form-view')!.hidden, false);
    assert.equal(elements['link']!.disabled, false, 'the button only unlocks once the form is up');
    assert.equal(elements['greeting']!.textContent, 'สวัสดีคุณ นิด');
  });

  it('posts the challenge ATTRIBUTE the page was rendered with, not a value from anywhere else', async () => {
    const h = runSignupScript('null', [
      { status: 200, body: 'null' },
      { status: 202, body: JSON.stringify({ requestId: 'r1', state: 'PENDING_REVIEW', existingAccount: false, businessHours: true }) },
    ]);
    await settle();
    await settle();
    await h.click('link');
    await settle();

    const submit = h.calls[1]!;
    assert.equal(submit.url, 'https://api.example.test/v1/public/line-signups');
    const body = JSON.parse(submit.init.body);
    // LEGAL-LIFF-01: the four values are the evidence, and the server refuses anything that is not
    // the release it is serving. A page that posted a different challenge than it rendered would be
    // recording agreement to text nobody saw.
    assert.equal(body.legal.displayChallenge, CHALLENGE);
    assert.deepEqual(body.legal, {
      documentVersion: 'v3', statementSha256: 'a', releaseFingerprintSha256: 'b',
      displayChallenge: CHALLENGE, locale: 'th',
    });
    assert.equal(body.companyName, 'ร้านนิด');
    assert.equal(h.views.find((view) => view.id === 'done-view')!.hidden, false);
  });

  it('reads status once more on a 409, so the waiting card names the shop (L-10)', async () => {
    const h = runSignupScript('null', [
      { status: 200, body: 'null' },
      { status: 409, body: JSON.stringify({ message: 'line_signup_already_pending' }) },
      { status: 200, body: JSON.stringify({ requestId: 'r1', state: 'PENDING_REVIEW', companyName: 'ร้านเดิม', businessHours: false }) },
    ]);
    await settle();
    await settle();
    await h.click('link');
    await settle();
    await settle();

    assert.equal(h.calls.length, 3, 'open read, submit, one re-read — still no timer');
    assert.equal(h.calls[2]!.url, 'https://api.example.test/v1/public/line-signups/me');
    assert.match(h.elements['pending-text']!.textContent, /ร้าน ร้านเดิม/);
    assert.match(h.elements['pending-text']!.textContent, /นอกเวลาทำการ/);
    assert.match(h.elements['pending-text']!.textContent, /จันทร์–เสาร์ 9:00–18:00/, 'the §7 wording, once');
  });

  it('closes the LIFF window from the ปิด button (L-9)', async () => {
    const h = runSignupScript('null');
    await settle();
    await settle();
    await h.click('close');

    assert.equal(h.closed(), 1, 'a LIFF page has no chrome to close itself with');
  });

  it('shows the waiting card instead of the form when an application is already open', async () => {
    const { elements, views, calls } = runSignupScript(
      JSON.stringify({ requestId: 'r1', state: 'PENDING_REVIEW', companyName: 'ร้านนิด', businessHours: false }),
    );
    await settle();
    await settle();

    assert.equal(calls.length, 1);
    assert.equal(views.find((view) => view.id === 'pending-view')!.hidden, false);
    assert.equal(views.find((view) => view.id === 'form-view')!.hidden, true);
    assert.match(elements['pending-text']!.textContent, /นอกเวลาทำการ/);
  });
});

// ── ExchangeLiffSessionUseCase ──

type Membership = { companyId: string; company: { name: string; status?: string; planTerm?: { termDisabledAt: Date | null } | null } };

function makeUseCase(input: {
  identity?: { userId: string; user: { status: string } } | null;
  memberships?: Membership[];
  inactive?: Membership | null;
  context?: { companyId: string } | null;
  handoffEnabled?: boolean;
  webBaseUrl?: string | undefined;
}) {
  const buckets: string[] = [];
  const minted: any[] = [];
  const audited: any[] = [];
  const prisma = {
    client: {
      externalIdentity: { findFirst: async () => input.identity ?? null },
      companyMembership: {
        findMany: async () => input.memberships ?? [],
        // The blocked-reason probe is the only findFirst on this model in the use case.
        findFirst: async () => input.inactive ?? null,
      },
      lineCompanyContext: { findUnique: async () => input.context ?? null },
    },
  } as any;
  const useCase = new ExchangeLiffSessionUseCase(
    prisma,
    {
      lineWebHandoffEnabled: input.handoffEnabled ?? true,
      sesWebBaseUrl: 'webBaseUrl' in input ? input.webBaseUrl : WEB_BASE,
    } as any,
    { verify: async () => ({ providerUserId: LINE_USER, channelId: CHANNEL }) } as any,
    { assertLineLiffSessionAllowed: async (key: string) => { buckets.push(key); } } as any,
    { execute: async (args: any) => { minted.push(args); return { rawToken: 'RAWTOKEN', expiresAt: new Date() }; } } as any,
    { log: async (entry: any) => { audited.push(entry); } } as any,
  );
  return { useCase, buckets, minted, audited };
}

const activeIdentity = { userId: 'user-1', user: { status: 'ACTIVE' } };
const membership = (companyId: string, name = 'ร้านทดสอบ'): Membership => ({ companyId, company: { name } });

describe('ExchangeLiffSessionUseCase', () => {
  it('mints a handoff into the single active company, under that company root', async () => {
    const { useCase, buckets, minted, audited } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1')],
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
    assert.equal(minted[0].targetPath, '/companies/co-1/expenses/upload');
    assert.ok(minted[0].targetPath.startsWith('/companies/co-1/'), 'target stays inside the tenant root');
    assert.deepEqual(buckets, [LINE_USER], 'the per-account bucket is spent after verification');
    assert.equal(audited[0].action, 'auth.line.liff_session');
  });

  it('answers needsSignup when this LINE account has no active user', async () => {
    const noIdentity = await makeUseCase({ identity: null }).useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(noIdentity, { needsSignup: true });

    const disabledUser = await makeUseCase({ identity: { userId: 'user-1', user: { status: 'DISABLED' } } })
      .useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(disabledUser, { needsSignup: true });
  });

  it('asks which shop when there are several and no usable context', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1', 'ร้านหนึ่ง'), membership('co-2', 'ร้านสอง')],
      context: null,
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.deepEqual(result, {
      needsSelection: true,
      companies: [{ id: 'co-1', name: 'ร้านหนึ่ง' }, { id: 'co-2', name: 'ร้านสอง' }],
    });
    assert.equal(minted.length, 0, 'nothing is minted until the shop is known');
  });

  it('follows a LineCompanyContext that still matches a live membership', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1'), membership('co-2')],
      context: { companyId: 'co-2' },
    });

    await useCase.execute({ idToken: 'a.b.c' });

    assert.equal(minted[0].companyId, 'co-2');
  });

  it('ignores a context pointing at a company the user no longer belongs to', async () => {
    const { useCase } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1'), membership('co-2')],
      context: { companyId: 'co-gone' },
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.ok('needsSelection' in result, 'a stale context must not silently pick a shop');
  });

  it('refuses a companyId that is not on this token owner\'s membership list', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1')],
    });

    const result = await useCase.execute({ idToken: 'a.b.c', companyId: 'co-someone-else' });

    assert.deepEqual(result, { reason: 'no_membership' });
    assert.equal(minted.length, 0);
  });

  it('separates an expired trial from an admin suspension', async () => {
    const expired = await makeUseCase({
      identity: activeIdentity,
      memberships: [],
      inactive: { companyId: 'co-1', company: { name: 'x', status: 'DISABLED', planTerm: { termDisabledAt: new Date() } } },
    }).useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(expired, { reason: 'expired' });

    const suspended = await makeUseCase({
      identity: activeIdentity,
      memberships: [],
      inactive: { companyId: 'co-1', company: { name: 'x', status: 'SUSPENDED', planTerm: null } },
    }).useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(suspended, { reason: 'suspended' });

    // DISABLED without a term stamp is an admin decision, not an expiry — the copy differs.
    const disabledByHand = await makeUseCase({
      identity: activeIdentity,
      memberships: [],
      inactive: { companyId: 'co-1', company: { name: 'x', status: 'DISABLED', planTerm: { termDisabledAt: null } } },
    }).useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(disabledByHand, { reason: 'suspended' });

    const none = await makeUseCase({ identity: activeIdentity, memberships: [], inactive: null })
      .useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(none, { reason: 'no_membership' });
  });

  it('refuses before verifying anything when the handoff route is off', async () => {
    const { useCase, buckets } = makeUseCase({ identity: activeIdentity, handoffEnabled: false });

    await assert.rejects(() => useCase.execute({ idToken: 'a.b.c' }), ForbiddenException);
    assert.deepEqual(buckets, [], 'a disabled route costs no quota');
  });

  it('refuses rather than building a URL against an unconfigured web origin', async () => {
    const { useCase } = makeUseCase({ identity: activeIdentity, memberships: [membership('co-1')], webBaseUrl: undefined });

    await assert.rejects(() => useCase.execute({ idToken: 'a.b.c' }), ServiceUnavailableException);
  });
});
