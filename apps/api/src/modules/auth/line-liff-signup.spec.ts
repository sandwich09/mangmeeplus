import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { LIFF_PAGE_SCRIPT } from '../../common/security/liff-page.security';
import { IS_PUBLIC_ROUTE_KEY } from '../../common/security/public.decorator';
import { currentLegalRelease } from './application/legal-acceptance.service';
import { AuthController } from './presentation/auth.controller';
import { ExchangeLiffSessionUseCase } from './application/use-cases/exchange-liff-session.use-case';
// Runs the advisor's browser-client checks in the existing LIFF test entrypoint.
import '../../common/security/line-package-advisor.check';

const WEB_BASE = 'https://app.example.test';
const LINE_USER = 'Uabc123';
const CHANNEL = '2001';

function makeController(config: Record<string, unknown> = {}): AuthController {
  const stub = {} as any;
  return new AuthController(lineMessagingCredentialsFixture({ lineLiffId: '1234567890-test', isLocal: false, sesWebBaseUrl: WEB_BASE, ...config } as any),
    { lineLiffId: '1234567890-test', isLocal: false, sesWebBaseUrl: WEB_BASE, ...config } as any,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    stub, stub, stub, stub, stub, stub, stub,
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
    // The four values the submit is checked against, asserted as the ATTRIBUTES the script reads
    // rather than as text present somewhere on the page — a stale attribute would be evidence of
    // an agreement to text nobody was shown.
    assert.ok(html.includes(`data-legal-challenge="${release.displayChallenge}"`), 'challenge attribute');
    assert.ok(html.includes(`data-legal-version="${release.documentVersion}"`));
    assert.ok(html.includes(`data-legal-statement="${release.statementSha256}"`));
    assert.ok(html.includes(`data-legal-release="${release.releaseFingerprintSha256}"`));
    assert.ok(html.includes('ฉันยอมรับข้อกำหนดการใช้งาน MangmeePlus'), 'statement text is shown, not just hashed');
    assert.ok(html.includes(`${WEB_BASE}/terms`) && html.includes(`${WEB_BASE}/privacy`));
  });

  it('asks for a shop name and a REQUIRED phone, and promises the trial in the Owner wording', () => {
    const html = makeController().lineSignupPage(request());

    assert.ok(html.includes('id="company-name"'));
    assert.ok(html.includes('inputmode="tel"'), 'the phone field opens a phone keypad');
    assert.ok(/<input id="phone-number"[^>]*\brequired\b/.test(html), 'the phone field is required (Owner 2026-09-05)');
    assert.ok(html.includes('<label for="phone-number">เบอร์มือถือ</label>'), 'the bare label, no optional tag');
    assert.ok(html.includes('<label for="contact-email">อีเมลติดต่อร้าน (ไม่บังคับ)</label>'));
    assert.match(html, /<input id="contact-email"[^>]*type="email"[^>]*maxlength="254"/);
    assert.doesNotMatch(html, /<input id="contact-email"[^>]*\brequired\b/);
    // RV33 (D-PF-1): the email for documents is asked at checkout, not verified before paying.
    assert.ok(html.includes('อีเมลรับเอกสารกรอกได้ที่หน้าชำระเงิน'));
    // A new shop is locked until it buys, so the form must not promise LINE use "right away".
    assert.equal(html.includes('ใช้งานผ่าน LINE ได้ทันที'), false);
    assert.equal(html.includes('ก่อนชำระแพ็กเกจจะให้ยืนยันอีเมล'), false);
    assert.ok(!/<label for="phone-number">[^<]*ไม่บังคับ/.test(html), 'phone remains required');
    // R1 (Owner 2026-09-20): the page promises a shop, never free days.
    assert.ok(html.includes('ยอมรับและเปิดร้าน'));
    assert.ok(html.includes('เลือกแพ็กเกจเพื่อเริ่มใช้งานหลังเปิดร้าน (เริ่มต้น 249 บาทต่อเดือน)'));
    assert.equal(html.includes('ทดลอง'), false, 'no trial is offered to a new shop any more');
    assert.equal(html.includes('progress-reference'), false, 'public signup never renders an internal request reference');
    assert.equal(html.includes('ไม่ต้องใส่บัตร'), false, 'dropped from the trial line (Owner 2026-09-05)');
  });

  /**
   * Owner 2026-09-06: the 64-hex reference is evidence, not reading matter — under the privacy
   * links it was a wall of hex on the shop owner's phone. It stays in the attribute the script
   * posts back (LEGAL-LIFF-01) and is no longer rendered at all; this supersedes the 2026-09-05
   * decision to wrap it rather than truncate it.
   */
  it('carries the 64-hex challenge only in the data attribute, never on screen', () => {
    const html = makeController().lineSignupPage(request());
    const challenge = currentLegalRelease('th').displayChallenge;

    assert.ok(html.includes(`data-legal-challenge="${challenge}"`), 'the submit keeps its evidence');
    assert.equal(html.includes('รหัสอ้างอิงฉบับที่แสดง'), false, 'and the label goes with it');
    assert.equal(/\.challenge\{/.test(html), false, 'the rule that styled the block it no longer has');
    // Stronger than "no <p class=challenge>": strike the attribute and the hex must be gone from
    // the whole page, so there is nothing left anywhere for a phone to paint.
    assert.equal(html.replace(`data-legal-challenge="${challenge}"`, '').includes(challenge), false);
  });

  /**
   * `#detail` is the last element on the signup page, directly under the trial line, and it carries
   * a background, a border and padding. Rendered empty it was a grey rounded box with nothing in it
   * — which is what the Owner photographed on 2026-09-05. Both halves are asserted: the CSS rule
   * covers the first paint, before the script has run at all.
   */
  it('never paints an empty message container on any page it serves', async () => {
    const c = makeController();
    const pages = [c.lineSignupPage(request()), c.lineStartPage(request()), await c.lineLinkPage(request()), await c.employeeLineLinkPage(request())];

    for (const html of pages) {
      // The containers really are served empty — otherwise the rule below would be guarding nothing.
      assert.ok(html.includes('<pre id="detail"></pre>'), 'detail is rendered with no content');
      assert.ok(html.includes('#status:empty,#detail:empty{display:none}'), 'and an empty one is not painted');
    }
    // The box only exists because `pre` is a painted surface; if that ever stops being true the rule
    // above is dead weight rather than a fix, so the paint itself is pinned here.
    assert.match(pages[0]!, /pre\{[^}]*background:var\(--ground\)[^}]*border:1px solid var\(--line\)/);
  });

  /**
   * The tones live in the shared stylesheet, so every page `liffPageHtml` builds gets them — the
   * customer-register page in crm-inbox included, since the review moved it onto the same builder.
   */
  it('serves the four message tones, at reading size, on every page', async () => {
    const c = makeController();
    for (const html of [c.lineSignupPage(request()), c.lineStartPage(request()), await c.lineLinkPage(request()), await c.employeeLineLinkPage(request())]) {
      for (const tone of ['info', 'success', 'warning', 'error']) {
        assert.ok(html.includes('.notice-' + tone + '{background:'), tone);
        assert.ok(html.includes('.notice-' + tone + '::before{content:'), `${tone} carries an icon, so tone is not colour alone`);
      }
      // Reading size in the page's own face — the grey monospace box is for technical text only.
      assert.match(html, /\.notice\{[^}]*font-size:16px/);
      assert.match(html, /\.notice\{[^}]*white-space:pre-line/, 'advice renders as a second line');
      assert.ok(html.includes('.field-error{'), 'and a field can carry its own message');
      assert.ok(html.includes('input[aria-invalid="true"]{'));
    }
    // The signup page is the only one with fields, so it is the only one that needs the targets.
    const signup = c.lineSignupPage(request());
    assert.ok(signup.includes('<p id="phone-number-error" class="field-error" hidden></p>'));
    assert.ok(signup.includes('<p id="company-name-error" class="field-error" hidden></p>'));
    // LOW-5: no <p> around it — a hidden button in a visible paragraph still left that paragraph's
    // margins as a gap under the notice on first paint.
    assert.ok(signup.includes('<button id="notice-action" hidden></button>'), 'the reload affordance');
    assert.equal(signup.includes('<p><button id="notice-action"'), false, 'no wrapper to collapse');
    assert.ok(signup.includes('<p id="status" class="notice notice-info">'), 'the first paint is already a notice');
  });

  it('wears the มั่งมี header and palette on every page it serves', () => {
    for (const html of [
      makeController().lineSignupPage(request()),
      makeController().lineStartPage(request()),
    ]) {
      assert.ok(html.includes('<header class="brand">'), 'a slim brand bar above the card');
      assert.ok(html.includes('<span>มั่งมีพลัส</span>'));
      assert.ok(html.includes('<svg viewBox="0 0 48 48"'), 'the coin-with-sprout mark, inline — no image request');
      assert.ok(html.includes('--brand:#22C55E'), 'the same green the LINE flex cards use');
      assert.ok(html.includes('--ink:#101828') && html.includes('--line:#E3EBE5'));
      assert.ok(html.includes('"Noto Sans Thai"') && !html.includes('fonts.googleapis'), 'system Thai stack, no web font');
      assert.ok(html.includes('min-height:48px'), 'thumb-sized controls');
    }
  });

  it('keeps the LIFF CSP and writes no plus sign into customer copy', () => {
    const csp = responseHeaders(AuthController.prototype.lineSignupPage)['content-security-policy']!;
    const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src'))!;
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'script-src must never admit inline code');
    assert.equal(scriptSrc, "script-src 'self' https://static.line-scdn.net");
    // The theme brought no new origin with it: the logo is inline SVG, the type is the system stack.
    assert.equal(csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('img-src')), "img-src 'self' data:");
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

  // Review 2026-09-29 (e): the statuses a customer reads while the page works are Thai.
  it('writes no English status, title or button label into the page script', () => {
    for (const english of ['Initializing LIFF', 'Refreshing LINE session', 'Registering...', 'Registered.',
      "customer: 'Registration failed'", "'Link failed'", 'Consent is required']) {
      assert.equal(LIFF_PAGE_SCRIPT.includes(english), false, english);
    }
    assert.equal(LIFF_PAGE_SCRIPT.includes("'ต่ออายุ'"), false, '"ต่ออายุ" is never a customer button');
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
    const controller = new AuthController(lineMessagingCredentialsFixture({ lineLiffId: '1234567890-test', sesWebBaseUrl: WEB_BASE } as any),
      { lineLiffId: '1234567890-test', sesWebBaseUrl: WEB_BASE } as any,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub, stub,
      // Position 28: `exchangeLiffSession`. `accountProfile` (L-E) follows it, then the optional
      // audit — see the arity guard in auth.controller.spec.ts before touching this row.
      { execute: async (cmd: any) => { calls.push(cmd); return { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` }; } } as any,
      stub,
    );

    const first = await controller.lineLiffSession({ idToken: 'a.b.c' } as any);
    assert.deepEqual(first, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
    assert.deepEqual(calls[0], { idToken: 'a.b.c' }, 'no companyId key at all on the first call');

    await controller.lineLiffSession({ idToken: 'a.b.c', companyId: 'co-2' } as any);
    assert.deepEqual(calls[1], { idToken: 'a.b.c', companyId: 'co-2' });

    // Sales-event page (spec §3.3): a landing NAME passes through; the use case builds the path.
    await controller.lineLiffSession({ idToken: 'a.b.c', landing: 'package' } as any);
    assert.deepEqual(calls[2], { idToken: 'a.b.c', landing: 'package' });
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

  function runSignupScript(
    statusBody: string,
    responses: Array<{ status: number; body: string }> = [],
    options: {
      initFails?: Error;
      phone?: string;
      contactEmail?: string;
      companyName?: string;
      discoverySource?: string;
      discoverySourceOther?: string;
      referralSalesCode?: string;
      fetchThrows?: Error;
      sendMessagesFails?: Error;
      stored?: Record<string, string>;
    } = {},
  ) {
    const handlers: Record<string, Array<() => unknown>> = {};
    const listen = (key: string) => (_event: string, handler: () => unknown) => {
      (handlers[key] ??= []).push(handler);
    };
    /** Enough of an input to answer the three questions a field error has to be judged on. */
    const focused: string[] = [];
    const input = (id: string, value: string) => {
      const attributes: Record<string, string> = {};
      return {
        value,
        attributes,
        focus: () => { focused.push(id); },
        setAttribute: (name: string, attributeValue: string) => { attributes[name] = attributeValue; },
        removeAttribute: (name: string) => { delete attributes[name]; },
      };
    };
    const element = (key: string, values: Record<string, any> = {}) => ({
      hidden: false,
      textContent: '',
      disabled: false,
      addEventListener: listen(key),
      ...values,
    });
    const elements: Record<string, Record<string, any>> = {
      status: { textContent: '', className: '' },
      detail: { textContent: '' },
      greeting: { textContent: '' },
      'form-title': { textContent: '' },
      link: { disabled: true, textContent: 'ยอมรับและเปิดร้าน', addEventListener: listen('link') },
      retry: { addEventListener: listen('retry') },
      'notice-action': { hidden: true, textContent: '', addEventListener: listen('notice-action') },
      'client-notice': { hidden: true },
      'liff-content': { hidden: false },
      'progress-title': { textContent: '' },
      'progress-text': { textContent: '' },
      'existing-companies': { textContent: '', children: [], appendChild(child: unknown) { this.children.push(child); } },
      'retry-intake': element('retry-intake', { hidden: true }),
      'retry-status': element('retry-status', { hidden: true }),
      // R-C2: the COMPLETED+locked branch prepares this handoff itself (§3.12 ค) — the signup page
      // carries the same #open-web fallback button the start page does (auth.controller.ts:564/663).
      'open-web': element('open-web', { hidden: true }),
      'edit-email': element('edit-email', { hidden: true }),
      'add-shop': element('add-shop', { hidden: true }),
      support: element('support', { hidden: true }),
      'form-support': element('form-support'),
      'start-existing': element('start-existing'),
      'email-update': { hidden: true },
      'save-email': element('save-email'),
      'updated-contact-email': input('updated-contact-email', ''),
      'updated-contact-email-error': { textContent: '', hidden: true },
      'company-name': input('company-name', options.companyName ?? 'ร้านนิด'),
      'company-name-error': { textContent: '', hidden: true },
      'phone-number': input('phone-number', options.phone ?? '081-234-5678'),
      'phone-number-error': { textContent: '', hidden: true },
      'contact-email': input('contact-email', options.contactEmail ?? ' Shop@Example.COM '),
      'contact-email-error': { textContent: '', hidden: true },
      'discovery-source': element('discovery-source', input('discovery-source', '')),
      'discovery-source-error': { textContent: '', hidden: true },
      'discovery-other-fields': { hidden: true },
      'discovery-source-other': { ...input('discovery-source-other', options.discoverySourceOther ?? ''), disabled: true },
      'discovery-source-other-error': { textContent: '', hidden: true },
      // D6: the "รหัสเซลล์" field, revealed by the SALES choice.
      'discovery-sales-fields': { hidden: true },
      'referral-sales-code': { ...input('referral-sales-code', options.referralSalesCode ?? ''), disabled: true },
      'referral-sales-code-error': { textContent: '', hidden: true },
    };
    const choices = ['WEBSITE', 'IG', 'TIKTOK', 'FACEBOOK', 'SALES', 'OTHER'].map((value) => ({
      value, checked: value === options.discoverySource,
    }));
    const closeButtons = [{ addEventListener: listen('close') }];
    const views = [
      { id: 'retry-view', hidden: true },
      { id: 'form-view', hidden: true },
      { id: 'progress-view', hidden: true },
    ];
    const calls: Array<{ url: string; init: any }> = [];
    const sentMessages: unknown[] = [];
    const opened: unknown[] = [];
    let closed = 0;
    const storage = new Map(Object.entries(options.stored ?? {}));
    runInNewContext(LIFF_PAGE_SCRIPT, {
      document: {
        body: {
          dataset: {
            liffMode: 'signup', liffId: '1234567890-test', apiBase: 'https://api.example.test/v1',
            legalVersion: 'v3', legalStatement: 'a', legalRelease: 'b', legalChallenge: CHALLENGE, legalLocale: 'th',
          },
        },
        getElementById: (id: string) => elements[id] ?? views.find((view) => view.id === id) ?? null,
        querySelectorAll: (selector: string) => selector === 'input[name="discovery-source"]' ? choices : (selector === '[data-close]' ? closeButtons : views),
        querySelector: () => choices.find((choice) => choice.checked) ?? null,
        // `key` is the handler bucket, so a test can tap a button the script created itself.
        createElement: () => { const key = 'created-' + Math.random(); return element(key, { key }); },
      },
      liff: {
        init: async () => { if (options.initFails) throw options.initFails; },
        isLoggedIn: () => true,
        getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600, name: 'นิด', sub: 'Uabc123' }),
        getIDToken: () => 'aaa.bbb.ccc',
        closeWindow: () => { closed += 1; },
        isInClient: () => true,
        openWindow: (input: unknown) => { opened.push(input); },
        sendMessages: async (messages: unknown) => {
          if (options.sendMessagesFails) throw options.sendMessagesFails;
          sentMessages.push(messages);
        },
      },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/14.0.0' },
      location: { href: 'https://api.example.test/v1/auth/line/link-page/signup', origin: 'https://api.example.test', search: '' },
      history: { replaceState() {} },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => { storage.delete(key); },
        setItem: (key: string, value: string) => { storage.set(key, value); },
      },
      crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
      URL,
      URLSearchParams,
      setTimeout,
      fetch: async (url: string, init: any) => {
        calls.push({ url, init });
        const scripted = responses[calls.length - 1];
        if (scripted) return { ok: scripted.status < 400, status: scripted.status, text: async () => scripted.body };
        if (options.fetchThrows && calls.length > 1) throw options.fetchThrows;
        return { ok: true, status: 200, text: async () => statusBody };
      },
    });
    return {
      elements, views, calls, handlers, storage, sentMessages, opened,
      closed: () => closed,
      focused,
      chooseDiscovery: async (value: string) => {
        choices.forEach((choice) => { choice.checked = choice.value === value; });
        for (const handler of handlers['discovery-source'] ?? []) await handler();
      },
      tone: () => String(elements['status']!.className).replace('notice notice-', ''),
      click: async (key: string) => {
        for (const handler of handlers[key] ?? []) await handler();
      },
    };
  }

  const settle = () => new Promise((resolve) => { setImmediate(resolve); });
  const signupStatus = (
    overrides: Record<string, unknown> = {},
    eligibleCompanies: Array<{
      companyId: string; companyName: string; status: 'ACTIVE' | 'EXPIRED'; canEnter: boolean;
      lockReason?: 'no_package' | 'trial_ended'; canManagePlan?: boolean;
    }> = [],
  ) => JSON.stringify({
    progress: {
      requestId: 'r1',
      submissionId: '123e4567-e89b-42d3-a456-426614174000',
      version: 1,
      state: 'PENDING_REVIEW',
      companyName: 'ร้านนิด',
      phoneNumber: '0812345678',
      contactEmail: 'shop@example.com',
      intent: 'FIRST_SHOP',
      existingAccount: false,
      businessHours: true,
      canRetryIntake: false,
      canUpdateContactEmail: false,
      companyCreated: false,
      ...overrides,
    },
    eligibleCompanies,
  });

  /** The runtime half of the same rule: `:empty` cannot see a message that is present but blank. */
  describe('an empty message container is hidden, a real message is not', () => {
    it('hides both containers once the form is up and there is nothing to say', async () => {
      const { elements } = runSignupScript('null');
      await settle();
      await settle();

      assert.equal(elements['status']!.textContent, '');
      assert.equal(elements['status']!.hidden, true, 'no status text, no status box');
      assert.equal(elements['detail']!.hidden, true, 'this is the grey box the Owner photographed');
    });

    it('shows the natural error and keeps technical detail hidden', async () => {
      const h = runSignupScript('null', [], { initFails: new Error('LIFF init failed') });
      await settle();
      await settle();

      assert.equal(h.elements.status!.hidden, false);
      assert.match(h.elements.status!.textContent, /เปิดหน้าสมัครไม่สำเร็จ/);
      assert.equal(h.elements.detail!.hidden, true);
      assert.equal(h.elements.detail!.textContent, '');
    });

    // An `Error` carrying only whitespace is exactly the case the CSS rule cannot catch: the node
    // is not `:empty`, so without the script half the box comes back with nothing readable in it.
    it('hides a message that is present but blank', async () => {
      const h = runSignupScript('null', [], { initFails: new Error('   ') });
      await settle();
      await settle();

      assert.equal(h.elements.status!.hidden, false, 'the title still says what failed');
      assert.equal(h.elements.detail!.hidden, true, 'but a blank reason paints no box');
    });
  });

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

  describe('one truthful renderer for open, submit and conflict recovery', () => {
    const completed = () => signupStatus(
      { state: 'COMPLETED', entryCompanyId: 'co-1', resolution: 'NEW_SHOP' },
      [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'ACTIVE', canEnter: true }],
    );

    it('renders POST COMPLETED as ready, with entry and a separate add-shop choice', async () => {
      const h = runSignupScript(JSON.stringify({ progress: null, eligibleCompanies: [] }), [
        { status: 200, body: JSON.stringify({ progress: null, eligibleCompanies: [] }) },
        { status: 202, body: completed() },
      ]);
      await settle(); await settle(); await h.click('link'); await settle();

      assert.equal(h.views.find((view) => view.id === 'progress-view')!.hidden, false);
      assert.equal(h.views.find((view) => view.id === 'form-view')!.hidden, true);
      assert.equal(h.elements['progress-title']!.textContent, 'พร้อมเริ่มใช้งาน');
      assert.doesNotMatch(h.elements['progress-text']!.textContent, /กำลังตรวจสอบ/);
      assert.equal(h.elements['add-shop']!.hidden, false);
      assert.equal(h.elements['existing-companies']!.children[0]!.textContent, 'เริ่มใช้งาน');
    });

    it('never reopens a completed request as a form until เปิดร้านเพิ่ม is chosen', async () => {
      const h = runSignupScript(completed());
      await settle(); await settle();

      assert.equal(h.views.find((view) => view.id === 'form-view')!.hidden, true);
      assert.equal(h.elements['add-shop']!.hidden, false);
      await h.click('add-shop');
      assert.equal(h.views.find((view) => view.id === 'form-view')!.hidden, false);
      assert.equal(h.elements.link!.textContent, 'ยืนยันเปิดร้านเพิ่ม');
    });

    // R-C2 (§18.2 purchase-without-setup): a locked shop is "opened, waiting for its package", not
    // "cannot enter" — and for whoever may buy, the handoff is prepared the moment this renders.
    describe('COMPLETED for a locked shop (R-C2)', () => {
      const lockedCompleted = (canManagePlan: boolean) => signupStatus(
        { state: 'COMPLETED', resolution: 'NEW_SHOP', lockedEntryCompanyId: 'co-1' },
        [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'EXPIRED', canEnter: false, lockReason: 'no_package', canManagePlan }],
      );

      it('names the next step and has the handoff ready for a plan manager', async () => {
        const statusBody = lockedCompleted(true);
        const h = runSignupScript(statusBody, [
          { status: 200, body: statusBody },
          { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) },
        ]);
        await settle(); await settle(); await settle(); await settle();

        assert.equal(h.elements['progress-title']!.textContent, 'เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ');
        assert.equal(h.calls[1]?.url, 'https://api.example.test/v1/auth/line/liff/session');
        assert.deepEqual(JSON.parse(h.calls[1]!.init.body), { idToken: 'aaa.bbb.ccc', companyId: 'co-1' });
        assert.equal(h.elements['open-web']!.hidden, false);
        assert.equal(h.elements['open-web']!.textContent, 'เลือกแพ็กเกจ');
        // (ฉ) busy-label fix: the secondary button gets its tap back, not stuck on "กำลังเตรียมลิงก์…".
        assert.equal(h.elements['retry-status']!.hidden, false);
        assert.equal(h.elements['retry-status']!.disabled, false);
        assert.notEqual(h.elements['retry-status']!.textContent, 'กำลังเตรียมลิงก์…');
      });

      it('points staff at support instead of preparing a handoff they cannot use', async () => {
        const h = runSignupScript(lockedCompleted(false));
        await settle(); await settle();

        assert.equal(h.elements['progress-title']!.textContent, 'เปิดร้านแล้ว รอเลือกแพ็กเกจ');
        assert.match(h.elements['progress-text']!.textContent, /ร้านนิด ยังไม่มีแพ็กเกจ ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจ/);
        assert.equal(h.calls.length, 1, 'no handoff is prepared for someone who cannot buy');
        assert.equal(h.elements.support!.hidden, false);
      });

      // Review 2026-09-29 (g): a shop that came BACK (RETURN_EXISTING) was not "เปิดให้แล้ว", and an
      // expired one says so as a sentence — the chip "หมดอายุ" never sits inside one.
      const returnedExpired = (canManagePlan: boolean) => signupStatus(
        { state: 'COMPLETED', resolution: 'RETURN_EXISTING', lockedEntryCompanyId: 'co-1' },
        [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'EXPIRED', canEnter: false, lockReason: 'trial_ended', canManagePlan }],
      );

      it('tells a returning plan manager their package ran out, not that the shop was opened', async () => {
        const statusBody = returnedExpired(true);
        const h = runSignupScript(statusBody, [
          { status: 200, body: statusBody },
          { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) },
        ]);
        await settle(); await settle(); await settle(); await settle();

        assert.equal(h.elements['progress-title']!.textContent, 'แพ็กเกจหมดอายุแล้ว');
        assert.equal(h.elements['progress-text']!.textContent,
          'ร้านนิด แพ็กเกจหมดอายุแล้ว เลือกแพ็กเกจเพื่อใช้งานต่อ ระบบจะพาไปหน้าแพ็กเกจในเบราว์เซอร์ให้ค่ะ');
        assert.equal(h.elements['open-web']!.textContent, 'เลือกแพ็กเกจ');
      });

      it('never puts the chip word inside the staff sentence either', async () => {
        const h = runSignupScript(returnedExpired(false));
        await settle(); await settle();

        assert.equal(h.elements['progress-title']!.textContent, 'แพ็กเกจหมดอายุแล้ว');
        assert.match(h.elements['progress-text']!.textContent, /^ร้านนิด แพ็กเกจหมดอายุแล้ว ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจ/);
        assert.doesNotMatch(h.elements['progress-text']!.textContent, /ร้านนิด หมดอายุ|เปิดให้แล้ว/);
      });

      // (a): preparing the link is not a submit, so its failure never says "ยังยืนยันผลการส่งไม่ได้",
      // and the retry it names is on screen.
      it('names a failed link as a link, and points at the retry that is on screen', async () => {
        const statusBody = lockedCompleted(true);
        const h = runSignupScript(statusBody, [
          { status: 200, body: statusBody },
          { status: 500, body: JSON.stringify({ message: 'line_liff_session_failed' }) },
        ]);
        await settle(); await settle(); await settle(); await settle();

        assert.match(h.elements.status!.textContent, /^ยังเตรียมลิงก์หน้าแพ็กเกจไม่สำเร็จ\nแตะ ตรวจสอบสถานะอีกครั้ง เพื่อลองใหม่ค่ะ$/);
        assert.doesNotMatch(h.elements.status!.textContent, /ยังยืนยันผลการส่งไม่ได้|line_liff/);
        assert.equal(h.elements['retry-status']!.hidden, false);
        assert.equal(h.elements['open-web']!.hidden, true);
      });

      // (d): the auto-prepare used to borrow #retry-status as its busy button. Tapping that button
      // re-rendered this view, the inner run captured "กำลังตรวจสอบ…" as the label to restore, and
      // the button stayed on it for good.
      it('gives #retry-status its own label back after a tap that re-prepares the link', async () => {
        const statusBody = lockedCompleted(true);
        const handoff = { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) };
        const h = runSignupScript(statusBody, [{ status: 200, body: statusBody }, handoff, { status: 200, body: statusBody }, handoff]);
        await settle(); await settle(); await settle(); await settle();
        h.elements['retry-status']!.textContent = 'ตรวจสอบสถานะอีกครั้ง';

        await h.click('retry-status');
        await settle(); await settle(); await settle(); await settle();

        assert.equal(h.calls.length, 4, 'one status read and one new link');
        assert.equal(h.elements['retry-status']!.textContent, 'ตรวจสอบสถานะอีกครั้ง');
        assert.equal(h.elements['retry-status']!.disabled, false);
        assert.equal(h.elements['open-web']!.textContent, 'เลือกแพ็กเกจ');
      });

      // (b): signup mode has no "ลองอีกครั้ง" button, so the sentence names the one it has.
      it('after opening the link, names the retry this page actually shows', async () => {
        const statusBody = lockedCompleted(true);
        const h = runSignupScript(statusBody, [
          { status: 200, body: statusBody },
          { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) },
        ]);
        await settle(); await settle(); await settle(); await settle();

        for (const handler of h.handlers['open-web'] ?? []) await (handler as (event: unknown) => unknown)({ preventDefault() {} });

        assert.equal(h.opened.length, 1);
        assert.match(h.elements.status!.textContent, /แตะ ตรวจสอบสถานะอีกครั้ง เพื่อรับลิงก์ใหม่ค่ะ$/);
        assert.doesNotMatch(h.elements.status!.textContent, /กดลองอีกครั้ง/);
        assert.equal(h.elements['retry-status']!.hidden, false);
      });
    });

    // (c): the one read on open failed, and the page used to show no view and so no button at all.
    it('offers the retry view when the status cannot be read on open', async () => {
      const h = runSignupScript('null', [{ status: 500, body: JSON.stringify({ message: 'internal_error' }) }]);
      await settle(); await settle(); await settle();

      assert.equal(h.views.find((view) => view.id === 'retry-view')!.hidden, false);
      assert.match(h.elements.status!.textContent, /^ยังโหลดสถานะคำขอไม่สำเร็จ\n/);
      assert.doesNotMatch(h.elements.status!.textContent, /ยังยืนยันผลการส่งไม่ได้|internal_error/);
      // The retry view's button runs the read again.
      await h.click('retry');
      await settle(); await settle(); await settle();
      assert.equal(h.calls.length, 2);
      assert.equal(h.views.find((view) => view.id === 'form-view')!.hidden, false, 'a good second read shows the form');
    });

    // Review 2026-09-29 (h): the row button only PREPARES the link, so it no longer wears the label
    // of #open-web — two "เลือกแพ็กเกจ" buttons, one of which opened nothing, read as a dead tap.
    it('lists a locked shop as a note with its own "prepare the link" button when there is no progress yet', async () => {
      const statusBody = JSON.stringify({
        progress: null,
        eligibleCompanies: [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'EXPIRED', canEnter: false, lockReason: 'trial_ended', canManagePlan: true }],
      });
      const h = runSignupScript(statusBody, [
        { status: 200, body: statusBody },
        { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) },
      ]);
      await settle(); await settle();

      assert.equal(h.elements['existing-companies']!.children[0]!.textContent, 'ร้านนิด · หมดอายุ');
      const prepare = h.elements['existing-companies']!.children[1]!;
      assert.equal(prepare.textContent, 'เตรียมลิงก์หน้าแพ็กเกจ', '"ต่ออายุ" is never a customer button either');
      await h.click(prepare.key);
      await settle(); await settle();
      assert.deepEqual(JSON.parse(h.calls[1]!.init.body), { idToken: 'aaa.bbb.ccc', companyId: 'co-1' });
      assert.equal(h.elements['open-web']!.hidden, false);
      assert.equal(h.elements['open-web']!.textContent, 'เลือกแพ็กเกจ', 'the one button that opens the package page');
      assert.equal(prepare.textContent, 'เตรียมลิงก์หน้าแพ็กเกจ', 'and the row button gets its words back');
    });

    it('shows a provisioning failure as saved work needing recovery', async () => {
      const h = runSignupScript(signupStatus({ state: 'PROVISIONING_FAILED' }));
      await settle(); await settle();

      assert.match(h.elements['progress-title']!.textContent, /ยังไม่สำเร็จ/);
      assert.match(h.elements['progress-text']!.textContent, /บันทึกไว้แล้ว/);
      assert.doesNotMatch(h.elements['progress-text']!.textContent, /r1|อ้างอิง/);
      assert.doesNotMatch(h.elements['progress-text']!.textContent, /กำลังตรวจสอบ/);
      assert.equal(h.elements.support!.hidden, false);
    });

    it('renders 409 then GET COMPLETED as ready instead of pending', async () => {
      const h = runSignupScript(JSON.stringify({ progress: null, eligibleCompanies: [] }), [
        { status: 200, body: JSON.stringify({ progress: null, eligibleCompanies: [] }) },
        { status: 409, body: JSON.stringify({ message: 'line_signup_already_pending' }) },
        { status: 200, body: completed() },
      ]);
      await settle(); await settle(); await h.click('link'); await settle(); await settle();

      assert.equal(h.elements['progress-title']!.textContent, 'พร้อมเริ่มใช้งาน');
      assert.doesNotMatch(h.elements['progress-text']!.textContent, /กำลังตรวจสอบ/);
    });

    it('does not claim a completed shop is usable after current access was removed', async () => {
      const h = runSignupScript(signupStatus({ state: 'COMPLETED', companyCreated: true, resolution: 'NEW_SHOP' }));
      await settle(); await settle();

      assert.match(h.elements['progress-title']!.textContent, /ยังเข้าใช้ไม่ได้/);
      assert.doesNotMatch(h.elements['progress-title']!.textContent, /พร้อมแล้ว/);
      assert.match(h.elements['progress-text']!.textContent, /สิทธิ์หรือแพ็กเกจ/);
      assert.equal(h.elements.support!.hidden, false);
    });

    it('uses the persisted company-created fact in terminal-state guidance', async () => {
      const built = runSignupScript(signupStatus({ state: 'SUSPENDED', companyCreated: true }));
      await settle(); await settle();
      assert.match(built.elements['progress-text']!.textContent, /ร้านเคยเปิดสำเร็จ/);

      const unbuilt = runSignupScript(signupStatus({ state: 'REJECTED', companyCreated: false }));
      await settle(); await settle();
      assert.match(unbuilt.elements['progress-text']!.textContent, /สมัครใหม่ได้/);
      assert.equal(unbuilt.elements['add-shop']!.hidden, false);
      await unbuilt.click('add-shop');
      assert.equal(unbuilt.views.find((view) => view.id === 'form-view')!.hidden, false);
      assert.match(unbuilt.elements.link!.textContent, /ส่งคำขอให้ทีมงานตรวจสอบ/);
    });

    it('shows requested information together and exposes email correction from server capability', async () => {
      const h = runSignupScript(signupStatus({
        resolution: 'REQUEST_INFO',
        requestedInformation: '1. ชื่อร้านตามทะเบียน\n2. อีเมลที่ใช้ติดต่อ',
        canUpdateContactEmail: true,
      }));
      await settle(); await settle();

      assert.match(h.elements['progress-text']!.textContent, /1\. ชื่อร้านตามทะเบียน/);
      assert.match(h.elements['progress-text']!.textContent, /2\. อีเมลที่ใช้ติดต่อ/);
      assert.equal(h.elements['edit-email']!.hidden, false);
    });
  });

  it('marks every missing field together instead of asking one question per submit', async () => {
    const h = runSignupScript('null', [{ status: 200, body: 'null' }], {
      companyName: ' ', phone: '', contactEmail: '',
    });
    await settle(); await settle(); await h.click('link'); await settle();

    assert.match(h.elements.status!.textContent, /2 จุด/);
    for (const id of ['company-name', 'phone-number']) {
      assert.equal(h.elements[id]!.attributes['aria-invalid'], 'true', id);
      assert.equal(h.elements[id + '-error']!.hidden, false, id);
    }
    assert.deepEqual(h.focused, ['company-name']);
    assert.equal(h.calls.length, 1, 'invalid local fields never reach POST');
  });

  it('toggles OTHER and omits its stale text after choosing a named channel', async () => {
    const h = runSignupScript('null');
    await settle(); await settle();
    await h.chooseDiscovery('OTHER');
    assert.equal(h.elements['discovery-other-fields']!.hidden, false);
    assert.equal(h.elements['discovery-source-other']!.disabled, false);
    h.elements['discovery-source-other']!.value = 'เพื่อนแนะนำ';
    await h.chooseDiscovery('FACEBOOK');
    assert.equal(h.elements['discovery-other-fields']!.hidden, true);
    assert.equal(h.elements['discovery-source-other']!.disabled, true);
    await h.click('link'); await settle();
    const body = JSON.parse(h.calls[1]!.init.body);
    assert.equal(body.discoverySource, 'FACEBOOK');
    assert.equal(body.discoverySourceOther, undefined);
  });

  it('persists the exact submission before POST and reuses it after a lost response', async () => {
    const first = runSignupScript('null', [{ status: 200, body: 'null' }], { fetchThrows: new Error('lost response'), discoverySource: 'OTHER', discoverySourceOther: ' เพื่อนแนะนำ ' });
    await settle(); await settle(); await first.click('link'); await settle();
    const stored = Object.fromEntries(first.storage.entries());
    const firstBody = JSON.parse(first.calls[1]!.init.body);

    const second = runSignupScript('null', [
      { status: 200, body: JSON.stringify({ progress: null, eligibleCompanies: [] }) },
      { status: 202, body: signupStatus({ state: 'PENDING_REVIEW' }) },
    ], { stored });
    await settle(); await settle();
    assert.equal(second.elements['retry-intake']!.hidden, false);
    await second.click('retry-intake'); await settle();
    const retriedBody = JSON.parse(second.calls[1]!.init.body);

    assert.equal(retriedBody.submissionId, firstBody.submissionId);
    assert.equal(retriedBody.intent, firstBody.intent);
    assert.equal(retriedBody.companyName, firstBody.companyName);
    assert.equal(firstBody.discoverySource, 'OTHER');
    assert.equal(retriedBody.discoverySourceOther, 'เพื่อนแนะนำ');
    assert.deepEqual(retriedBody, firstBody);
    assert.equal(retriedBody.idToken, 'aaa.bbb.ccc', 'the fresh token is never stored');
    assert.equal(JSON.stringify(stored).includes('aaa.bbb.ccc'), false);
  });

  it('resumes persisted intake from another device without needing the original form body', async () => {
    const initial = signupStatus({ state: 'RECEIVED', version: 7, canRetryIntake: true });
    const resumed = signupStatus({ state: 'PENDING_REVIEW', version: 8, canRetryIntake: false });
    const h = runSignupScript(initial, [
      { status: 200, body: initial },
      { status: 200, body: resumed },
    ]);
    await settle(); await settle();

    assert.equal(h.storage.size, 0, 'this simulates a cleared browser or a different device');
    assert.equal(h.elements['retry-intake']!.hidden, false);
    await h.click('retry-intake'); await settle();

    assert.equal(h.calls[1]!.url, 'https://api.example.test/v1/public/line-signups/r1/retry');
    assert.equal(h.calls[1]!.init.method, 'POST');
    assert.deepEqual(JSON.parse(h.calls[1]!.init.body), { idToken: 'aaa.bbb.ccc', version: 7 });
    assert.match(h.elements['progress-title']!.textContent, /รับคำขอแล้ว/);
  });

  it('re-reads status when a proof-bound retry races a newer terminal result', async () => {
    const initial = signupStatus({ state: 'VALIDATED', version: 4, canRetryIntake: true });
    const completed = signupStatus(
      { state: 'COMPLETED', version: 5, companyCreated: true, entryCompanyId: 'co-1' },
      [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'ACTIVE', canEnter: true }],
    );
    const h = runSignupScript(initial, [
      { status: 200, body: initial },
      { status: 409, body: JSON.stringify({ message: 'line_signup_version_conflict' }) },
      { status: 200, body: completed },
    ]);
    await settle(); await settle(); await h.click('retry-intake'); await settle(); await settle();

    assert.equal(h.calls[2]!.url, 'https://api.example.test/v1/public/line-signups/me');
    assert.equal(h.elements['progress-title']!.textContent, 'พร้อมเริ่มใช้งาน');
  });

  it('patches the same request and version when the applicant corrects contact email', async () => {
    const initial = signupStatus({ resolution: 'REQUEST_INFO', canUpdateContactEmail: true, version: 3 });
    const corrected = signupStatus({ resolution: undefined, canUpdateContactEmail: false, version: 4 });
    const h = runSignupScript(initial, [
      { status: 200, body: initial },
      { status: 200, body: corrected },
    ]);
    await settle(); await settle(); await h.click('edit-email');
    h.elements['updated-contact-email']!.value = ' New@Example.com ';
    await h.click('save-email'); await settle();

    assert.equal(h.calls[1]!.url, 'https://api.example.test/v1/public/line-signups/r1/contact-email');
    assert.equal(h.calls[1]!.init.method, 'PATCH');
    assert.deepEqual(JSON.parse(h.calls[1]!.init.body), {
      idToken: 'aaa.bbb.ccc', version: 3, contactEmail: 'new@example.com',
    });
    assert.match(h.elements['progress-title']!.textContent, /รับคำขอแล้ว/);
  });

  it('creates a fresh ADD_SHOP submission only after the explicit add-shop choice', async () => {
    const previous = signupStatus(
      { state: 'COMPLETED', submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', entryCompanyId: 'co-1' },
      [{ companyId: 'co-1', companyName: 'ร้านนิด', status: 'ACTIVE', canEnter: true }],
    );
    const h = runSignupScript(previous, [
      { status: 200, body: previous },
      { status: 202, body: signupStatus({ intent: 'ADD_SHOP' }) },
    ]);
    await settle(); await settle(); await h.click('add-shop');
    h.elements['company-name']!.value = 'ร้านสอง';
    await h.click('link'); await settle();

    const body = JSON.parse(h.calls[1]!.init.body);
    assert.equal(body.intent, 'ADD_SHOP');
    assert.equal(body.companyName, 'ร้านสอง');
    assert.notEqual(body.submissionId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('ติดต่อเจ้าหน้าที่ opens the Official OA chat (owner 2026-10-20) and files nothing from the page', () => {
    const html = makeController().lineSignupPage(request());
    for (const id of ['form-support', 'support']) {
      assert.match(html, new RegExp(`<a id="${id}" class="btn quiet" href="https://line\\.me/R/ti/p/@695ultfm"[^>]*>ติดต่อเจ้าหน้าที่ · LINE @mangmeeplus</a>`), id);
    }
    assert.equal(html.includes('/line-signups/support'), false, 'the page no longer posts a support request');
  });

  it('posts the challenge ATTRIBUTE the page was rendered with, not a value from anywhere else', async () => {
    const h = runSignupScript('null', [
      { status: 200, body: 'null' },
      { status: 202, body: signupStatus() },
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
    assert.equal(body.phoneNumber, '0812345678', 'sent as digits, however the owner spaced it');
    assert.equal(body.contactEmail, 'shop@example.com');
    assert.equal(body.intent, 'FIRST_SHOP');
    assert.match(body.submissionId, /^[0-9a-f-]{36}$/);
    assert.equal(h.views.find((view) => view.id === 'progress-view')!.hidden, false);
    assert.match(h.elements['progress-title']!.textContent, /รับคำขอแล้ว/);
    assert.match(h.elements['progress-text']!.textContent, /ทีมงานกำลังตรวจสอบ/);
    assert.doesNotMatch(h.elements['progress-text']!.textContent, /r1|อ้างอิง/);
  });

  /**
   * UAT 2026-09-06 "สมัครแล้วแต่บริษัทหาย". A second shop for an existing owner always queues for
   * review (§3.3), and the done card said only that it had been added — so the owner went to
   * บริษัทของฉัน, did not find it, and concluded it was gone. The card names where it will appear.
   */
  it('tells a second-shop applicant where the new shop will show up once it is approved', async () => {
    const h = runSignupScript('null', [
      { status: 200, body: 'null' },
      { status: 202, body: signupStatus({ intent: 'ADD_SHOP', existingAccount: true }) },
    ]);
    await settle();
    await settle();
    await h.click('link');
    await settle();

    const done = h.elements['progress-text']!.textContent;
    assert.equal(h.views.find((view) => view.id === 'progress-view')!.hidden, false);
    assert.match(done, /อยู่ระหว่างตรวจสอบ/);
    // Still one card, still no "+" anywhere in customer-facing copy (spec §3).
    assert.equal(done.includes('+'), false);
  });

  /**
   * Review BLOCKER 1. The phone error used to be thrown as a bare Error, so it landed in the summary
   * ("ส่งคำขอไม่สำเร็จ", scrolled off the top at tap time) and in #detail (below the fold) — the one
   * moment the customer needed it, it was off-screen in both directions. These assertions are all
   * geometry-independent: WHICH element holds the text, what the input is marked with, where focus
   * went. Any of them would have caught the original defect.
   */
  describe('owner email is optional, syntax-only and retained on refusal', () => {
    it('submits a blank email while keeping required phone and legal evidence', async () => {
      const h = runSignupScript('null', [{ status: 200, body: 'null' }, { status: 202, body: signupStatus({ state: 'PENDING_REVIEW' }) }], { contactEmail: ' ' });
      await settle(); await settle(); await h.click('link'); await settle();
      assert.equal(h.calls.length, 2);
      const body = JSON.parse(h.calls[1]!.init.body);
      assert.equal(body.contactEmail, '');
      assert.ok(body.phoneNumber);
      assert.equal(body.legal.displayChallenge, CHALLENGE);
    });
    it('does not submit malformed or overlong email and keeps all typed fields', async () => {
      for (const contactEmail of ['shop', 'a@@example.com', 'a b@example.com', 'a@b', `${'a'.repeat(245)}@example.com`]) {
        const h = runSignupScript('null', [{ status: 200, body: 'null' }], { contactEmail });
        await settle(); await settle(); await h.click('link'); await settle();
        assert.equal(h.calls.length, 1, contactEmail);
        assert.equal(h.elements['contact-email']!.value, contactEmail);
        assert.equal(h.elements['company-name']!.value, 'ร้านนิด');
        assert.equal(h.elements['phone-number']!.value, '081-234-5678');
        assert.equal(h.elements['contact-email']!.attributes['aria-invalid'], 'true');
        assert.match(h.elements['contact-email-error']!.textContent, /shop@example.com/);
        assert.match(h.elements['contact-email-error']!.textContent, /อีเมลเจ้าของกิจการ/);
        assert.deepEqual(h.focused, ['contact-email']);
        assert.equal(h.elements.link!.disabled, false);
      }
    });

    it('maps domain and DTO refusals to the same field without clearing the address', async () => {
      for (const message of ['line_signup_email_required', 'line_signup_email_invalid', ['contactEmail must be an email']]) {
        const h = runSignupScript('null', [{ status: 200, body: 'null' }, { status: 400, body: JSON.stringify({ message }) }]);
        await settle(); await settle(); await h.click('link'); await settle();
        assert.equal(h.elements['contact-email']!.value, ' Shop@Example.COM ');
        assert.deepEqual(h.focused, ['contact-email']);
        assert.equal(h.tone(), 'warning');
        assert.equal(h.elements['contact-email-error']!.hidden, false);
        assert.equal(h.elements.link!.disabled, false);
      }
    });
  });

  describe('the phone is required, and says so next to the field (Owner 2026-09-05)', () => {
    const PHONE_RULE_TH = 'ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0 เช่น 0812345678';

    it('refuses to send, marks the input, moves focus and warns — never "failed to submit"', async () => {
      for (const phone of ['', '   ', '812345678', '08123456789', '021234567']) {
        const h = runSignupScript('null', [{ status: 200, body: 'null' }], { phone });
        await settle();
        await settle();
        await h.click('link');
        await settle();

        const label = phone.trim() || '(blank)';
        assert.equal(h.calls.length, 1, `${label} must cost no submit`);
        // The message is beside the field, not in the technical box at the bottom of the page.
        assert.equal(h.elements['phone-number-error']!.textContent, PHONE_RULE_TH, label);
        assert.equal(h.elements['phone-number-error']!.hidden, false, label);
        assert.equal(h.elements.detail!.textContent, '', `${label}: never the monospace box`);
        assert.equal(h.elements['phone-number']!.attributes['aria-invalid'], 'true', label);
        assert.deepEqual(h.focused, ['phone-number'], `${label}: the caret goes to the field`);
        // Nothing was sent, so the summary must not claim a submit failed.
        assert.equal(h.tone(), 'warning', label);
        assert.equal(h.elements.status!.textContent.includes('ส่งคำขอไม่สำเร็จ'), false, label);
        assert.match(h.elements.status!.textContent, /^กรอกข้อมูลให้ครบ 1 จุด/, label);
        // The button invites the retry it just asked for.
        assert.equal(h.elements.link!.disabled, false, label);
        assert.equal(h.elements.link!.textContent, 'ยอมรับและเปิดร้าน', label);
      }
    });

    it('does the same for the server codes, and never shows the raw code', async () => {
      for (const code of ['line_signup_phone_required', 'line_signup_phone_invalid']) {
        const h = runSignupScript('null', [
          { status: 200, body: 'null' },
          { status: 400, body: JSON.stringify({ message: code }) },
        ]);
        await settle();
        await settle();
        await h.click('link');
        await settle();

        assert.equal(h.tone(), 'warning', code);
        assert.equal(h.elements['phone-number-error']!.textContent, PHONE_RULE_TH, code);
        assert.equal(h.elements['phone-number']!.attributes['aria-invalid'], 'true', code);
        assert.deepEqual(h.focused, ['phone-number'], code);
        assert.equal(JSON.stringify(h.elements.status!.textContent).includes(code), false, code);
        assert.equal(h.elements.link!.disabled, false, code);
      }
    });

    it('marks the shop name instead when that is the empty one', async () => {
      const h = runSignupScript('null', [{ status: 200, body: 'null' }], { companyName: '  ' });
      await settle();
      await settle();
      await h.click('link');
      await settle();

      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.focused, ['company-name']);
      assert.equal(h.elements['company-name']!.attributes['aria-invalid'], 'true');
      // Only the offending field is marked — the phone is fine and must not be reddened with it.
      assert.equal(h.elements['phone-number']!.attributes['aria-invalid'], undefined);
      assert.equal(h.elements['phone-number-error']!.hidden, true);
    });
  });

  /** Owner 2026-09-05: "warning สีเหลือง / ส่งไม่สำเร็จสีแดง พร้อมคำแนะนำว่าอะไรผิดด้วย". */
  describe('every refusal says what went wrong and what to do next, in the right tone', () => {
    const submitWith = async (status: number, body: string, options = {}) => {
      const h = runSignupScript('null', [{ status: 200, body: 'null' }, { status, body }], options);
      await settle();
      await settle();
      await h.click('link');
      await settle();
      return h;
    };

    it('turns a known code into error tone plus guidance, and re-enables the button', async () => {
      const h = await submitWith(403, JSON.stringify({ message: 'line_signup_disabled' }));

      assert.equal(h.tone(), 'error');
      assert.match(h.elements.status!.textContent, /ตอนนี้ยังเปิดให้สมัครทางนี้ไม่ได้/, 'what went wrong');
      assert.match(h.elements.status!.textContent, /ลองใหม่อีกครั้งภายหลัง/, 'what to do next');
      assert.match(h.elements.status!.textContent, /098-256-5628/, 'the support line the LINE copy already gives');
      assert.match(h.elements.status!.textContent, /\n/, 'advice sits on its own line');
      assert.equal(h.elements.link!.disabled, false);
      assert.equal(h.elements.link!.textContent, 'ยอมรับและเปิดร้าน', 'the original label is back');
    });

    it('treats a rate limit as a warning and repeats the wait the server named', async () => {
      const h = await submitWith(429, JSON.stringify({ message: 'Too many requests.', retryAfterSeconds: 42 }));

      assert.equal(h.tone(), 'warning');
      assert.match(h.elements.status!.textContent, /ส่งบ่อยเกินไป/);
      assert.match(h.elements.status!.textContent, /42 วินาที/, 'retryAfterSeconds is worth repeating');
      assert.equal(h.elements.link!.disabled, false);
    });

    it('offers a reload — not a blind resubmit — when the release moved under the page', async () => {
      const h = await submitWith(409, JSON.stringify({ message: 'legal_release_changed' }));

      assert.equal(h.tone(), 'warning');
      assert.match(h.elements.status!.textContent, /ข้อกำหนดมีฉบับใหม่แล้ว/);
      assert.equal(h.elements['notice-action']!.hidden, false, 'the fix needs a fresh render from the server');
      assert.equal(h.elements['notice-action']!.textContent, 'โหลดหน้าใหม่');
    });

    // AUTO_FREE provisions inside the submit, so provision-signup's 409 reaches this page (LOW-2).
    it('tells the customer not to re-send when the application row is corrupt', async () => {
      const h = await submitWith(409, JSON.stringify({ message: 'line_signup_evidence_missing' }));

      assert.equal(h.tone(), 'error');
      assert.match(h.elements.status!.textContent, /ระบบเปิดร้านให้ไม่สำเร็จ/);
      assert.match(h.elements.status!.textContent, /ไม่ต้องส่งใหม่/, 'nothing on this page can fix it');
      assert.match(h.elements.status!.textContent, /098-256-5628/);
    });

    // Nest's ValidationPipe answers `message` as an ARRAY of English constraint strings (LOW-3).
    it('reads a ValidationPipe 400 as a stale page, not a system fault', async () => {
      const h = await submitWith(400, JSON.stringify({
        message: ['phoneNumber should not be empty', 'phoneNumber must match /^[0-9 -]*$/ regular expression'],
        error: 'Bad Request',
        statusCode: 400,
      }));

      assert.equal(h.tone(), 'warning', 'a reloadable page, not a red failure');
      assert.match(h.elements.status!.textContent, /ข้อมูลในหน้านี้ไม่ครบ/);
      assert.equal(h.elements['notice-action']!.hidden, false, 'and a way to reload it');
      // The English constraint strings must never reach a shop owner.
      assert.equal(h.elements.status!.textContent.includes('should not be empty'), false);
      assert.equal(h.elements.status!.textContent.includes('regular expression'), false);
    });

    it('falls back to the generic error for a code it has never heard of', async () => {
      const h = await submitWith(500, JSON.stringify({ message: 'line_signup_something_new' }));

      assert.equal(h.tone(), 'error');
      assert.match(h.elements.status!.textContent, /ระบบขัดข้อง ส่งคำขอไม่สำเร็จ/);
      assert.match(h.elements.status!.textContent, /098-256-5628/);
      // The invented code never reaches the customer, and no field is blamed for a server fault.
      assert.equal(h.elements.status!.textContent.includes('line_signup_something_new'), false);
      assert.equal(h.elements['phone-number']!.attributes['aria-invalid'], undefined);
      assert.deepEqual(h.focused, []);
    });

    it('reads a dropped connection as a warning worth retrying, not a refusal', async () => {
      const h = runSignupScript('null', [{ status: 200, body: 'null' }], { fetchThrows: new Error('Failed to fetch') });
      await settle();
      await settle();
      await h.click('link');
      await settle();

      assert.equal(h.tone(), 'warning');
      assert.match(h.elements.status!.textContent, /ยังยืนยันผลการส่งไม่ได้/);
      assert.match(h.elements.status!.textContent, /ลองอีกครั้ง/);
      assert.equal(h.elements.link!.disabled, false);
      assert.equal(h.elements.detail!.textContent, '', 'no browser or backend diagnostic is customer-facing');
      assert.equal(h.elements.detail!.hidden, true);
    });

    it('keeps the reason when a 202 body will not parse', async () => {
      const h = await submitWith(202, 'not json at all');

      assert.equal(h.tone(), 'warning');
      assert.match(h.elements.status!.textContent, /ยังยืนยันผลการส่งไม่ได้/, 'the customer gets a sentence');
      assert.equal(h.elements.detail!.textContent, '', 'the parse error is not shown to the customer');
      assert.equal(h.elements.detail!.hidden, true);
    });

    it('shows success in the success tone', async () => {
      const h = runSignupScript('null', [
        { status: 200, body: 'null' },
        { status: 202, body: signupStatus() },
      ]);
      await settle();
      await settle();
      await h.click('link');
      await settle();

      // The done CARD carries the words; the notice itself is cleared, so it paints nothing.
      assert.equal(h.elements.status!.textContent, '');
      assert.equal(h.elements.status!.hidden, true);
      assert.equal(h.views.find((view) => view.id === 'progress-view')!.hidden, false);
    });
  });

  it('reads status once more on a 409, so the waiting card names the shop (L-10)', async () => {
    const h = runSignupScript('null', [
      { status: 200, body: 'null' },
      { status: 409, body: JSON.stringify({ message: 'line_signup_already_pending' }) },
      { status: 200, body: signupStatus({ companyName: 'ร้านเดิม', businessHours: false }) },
    ]);
    await settle();
    await settle();
    await h.click('link');
    await settle();
    await settle();

    assert.equal(h.calls.length, 3, 'open read, submit, one re-read — still no timer');
    assert.equal(h.calls[2]!.url, 'https://api.example.test/v1/public/line-signups/me');
    assert.match(h.elements['progress-text']!.textContent, /ร้านเดิม อยู่ระหว่างตรวจสอบ/);
    assert.match(h.elements['progress-text']!.textContent, /นอกเวลาทำการ/);
    assert.match(h.elements['progress-text']!.textContent, /จันทร์–เสาร์ 9:00–18:00/, 'the §7 wording, once');
  });

  /**
   * The two refusals a shop owner cannot fix from this page (from codex/line-signup-stale-identity).
   * Before the code map they arrived as the bare string `line_signup_account_blocked` under
   * "ส่งคำขอไม่สำเร็จ" — a machine word and no way forward for someone whose account is suspended.
   *
   * That branch threw a bare Error, which put the support phone and email in #detail: the grey
   * MONOSPACE box, which this batch reserved for technical text. The copy is unchanged and the
   * intent is unchanged; it now lands in the red notice where a customer will actually read it, so
   * these assertions moved from #detail to #status.
   */
  for (const code of ['line_signup_account_blocked', 'line_signup_identity_disabled']) {
    it(`answers ${code} with the support phone and email`, async () => {
      const h = runSignupScript('null', [
        { status: 200, body: 'null' },
        { status: 409, body: JSON.stringify({ message: code }) },
      ]);
      await settle();
      await settle();
      await h.click('link');
      await settle();

      assert.equal(h.calls.length, 2, 'a refusal is final: no re-read, no retry loop');
      assert.equal(h.tone(), 'error', 'nothing here is retryable');
      assert.match(h.elements.status!.textContent, /098-256-5628/);
      assert.match(h.elements.status!.textContent, /contact@mangmeeplus\.com/);
      assert.doesNotMatch(h.elements.status!.textContent, /line_signup_/, 'never the raw code');
      // The support contact alone does not prove the mapping fired: GENERIC_ERROR's advice also
      // carries the phone and the email, so dropping either entry would still satisfy the two
      // assertions above. These two pin THIS refusal's own sentence instead.
      assert.match(h.elements.status!.textContent, /^บัญชี LINE นี้เปิดร้านใหม่ไม่ได้ค่ะ/);
      assert.doesNotMatch(h.elements.status!.textContent, /ระบบขัดข้อง/, 'not the generic fallback');
      // The support sentence is for the customer, so it must NOT be hidden away in the grey box.
      assert.equal(h.elements.detail!.textContent, '', 'not the technical box');
      assert.equal(h.elements.detail!.hidden, true);
      assert.equal(h.views.find((view) => view.id === 'progress-view')!.hidden, true);
      // A blocked account is not a field the customer can correct.
      assert.equal(h.elements['phone-number']!.attributes['aria-invalid'], undefined);
      assert.deepEqual(h.focused, []);
    });
  }

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
    assert.equal(views.find((view) => view.id === 'progress-view')!.hidden, false);
    assert.equal(views.find((view) => view.id === 'form-view')!.hidden, true);
    assert.match(elements['progress-text']!.textContent, /นอกเวลาทำการ/);
  });

  /**
   * The rich-menu link opened in a plain browser is exactly `liff.init` failing, and the page used to
   * answer it with the title and "ส่งคำขอไม่สำเร็จ" — a submit that never happened, no form, no retry
   * and no reason. The start page has always shown a retry; this is the same pattern.
   */
  describe('the page never opened at all', () => {
    const settleTwice = async () => {
      await new Promise((resolve) => { setImmediate(resolve); });
      await new Promise((resolve) => { setImmediate(resolve); });
    };

    it('offers a retry and names the likely cause instead of reporting a failed submit', async () => {
      const h = runSignupScript('null', [], { initFails: new Error('LIFF init failed') });
      await settleTwice();

      assert.match(h.elements.status!.textContent, /^เปิดหน้าสมัครไม่สำเร็จ/);
      assert.match(h.elements.status!.textContent, /แตะเมนูใน LINE อีกครั้ง/, 'and what to do about it');
      assert.equal(h.tone(), 'error');
      assert.equal(h.elements.status!.textContent.includes('ส่งคำขอไม่สำเร็จ'), false, 'nothing was submitted');
      assert.equal(h.views.find((view) => view.id === 'retry-view')!.hidden, false);
      assert.equal(h.views.find((view) => view.id === 'form-view')!.hidden, true);
      assert.equal(h.elements.detail!.textContent, '', 'raw SDK details stay off the customer page');
      assert.equal(h.elements.detail!.hidden, true);
    });

    it('keeps the submit-failure wording for a submit that really did fail', async () => {
      const h = runSignupScript('null', [
        { status: 200, body: 'null' },
        { status: 500, body: '{"message":"boom"}' },
      ]);
      await settleTwice();
      await h.click('link');
      await settleTwice();

      // A submit that reached the server and was refused: the error tone, the generic guidance, and
      // no retry-view — that view is only for a page that never opened.
      assert.equal(h.tone(), 'error');
      assert.match(h.elements.status!.textContent, /ส่งคำขอไม่สำเร็จ/);
      assert.equal(h.elements.status!.textContent.includes('เปิดหน้าสมัครไม่สำเร็จ'), false);
      assert.equal(h.views.find((view) => view.id === 'retry-view')!.hidden, true);
    });
  });
});

// ── ExchangeLiffSessionUseCase ──

type Membership = {
  companyId: string;
  company: {
    name: string;
    status?: string;
    // R-C3: termStartAt/renewCount are only read (planTermLockReason) when a needsSelection row is
    // built for a locked company — every pre-existing fixture below stays valid without them.
    planTerm?: { termDisabledAt: Date | null; termEndsAt?: Date; termStartAt?: Date; renewCount?: number } | null;
  };
  /** R-C11: only read when the shop is locked (canManagePlan gates `wanted` behind `isLocked && …`). */
  roles?: Array<{ role: { permissions: Array<{ permission: { key: string } }> } }>;
};

function makeUseCase(input: {
  identity?: { userId: string; status?: string; user: { status: string } } | null;
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
      externalIdentity: { findFirst: async () => input.identity ? { status: 'ACTIVE', ...input.identity } : null },
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
const membership = (companyId: string, name = 'ร้านทดสอบ'): Membership => ({ companyId, company: { name, status: 'ACTIVE' } });

describe('ExchangeLiffSessionUseCase', () => {
  // Owner 2026-10-06: a LINE message's link opens ITS page signed in — as the person who tapped.
  it('mints into the page a message link named, inside a company the tapper belongs to', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1'), membership('co-2')],
      context: { companyId: 'co-1' },
    });

    const result = await useCase.execute({ idToken: 'a.b.c', to: '/companies/co-2/expenses/e1?branchId=b1' });

    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
    assert.equal(minted[0].companyId, 'co-2', 'the link names the company, not the chat context');
    assert.equal(minted[0].targetPath, '/companies/co-2/expenses/e1?branchId=b1');
    assert.equal(minted[0].surface, 'liff_open');
  });

  it('never mints for a message link into a company the tapper is not in; the page stays reachable by login', async () => {
    const { useCase, minted } = makeUseCase({ identity: activeIdentity, memberships: [membership('co-1')] });

    const result = await useCase.execute({ idToken: 'a.b.c', to: '/companies/co-9/expenses/e1' });

    assert.deepEqual(result, { reason: 'no_membership', fallbackUrl: `${WEB_BASE}/companies/co-9/expenses/e1` });
    assert.equal(minted.length, 0);
    assert.deepEqual(
      await makeUseCase({ identity: null }).useCase.execute({ idToken: 'a.b.c', to: '/companies/co-1/billing' }),
      { needsSignup: true, fallbackUrl: `${WEB_BASE}/companies/co-1/billing` },
    );
  });

  it('treats a link that is not a company page as an ordinary start', async () => {
    for (const to of ['//evil.example/companies/co-1', '/companies/co-1/../co-2/expenses', '/login', 'https://evil.example/companies/co-1/x', '/companies/co-1/a\\b']) {
      const { useCase, minted } = makeUseCase({ identity: activeIdentity, memberships: [membership('co-1')] });
      const result = await useCase.execute({ idToken: 'a.b.c', to });
      assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` }, to);
      assert.equal(minted[0].targetPath, '/companies/co-1/dashboard', to);
      assert.equal(minted[0].surface, 'liff_start', to);
    }
  });

  it('mints a handoff into the single active company, under that company root', async () => {
    const { useCase, buckets, minted, audited } = makeUseCase({
      identity: activeIdentity,
      memberships: [membership('co-1')],
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
    assert.equal(minted[0].targetPath, '/companies/co-1/dashboard');
    assert.ok(minted[0].targetPath.startsWith('/companies/co-1/'), 'target stays inside the tenant root');
    assert.deepEqual(buckets, [LINE_USER], 'the per-account bucket is spent after verification');
    assert.equal(audited[0].action, 'auth.line.liff_session');
  });

  it('answers needsSignup when this LINE account has no active user', async () => {
    const noIdentity = await makeUseCase({ identity: null }).useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(noIdentity, { needsSignup: true });

    const disabledUser = await makeUseCase({ identity: { userId: 'user-1', user: { status: 'DISABLED' } } })
      .useCase.execute({ idToken: 'a.b.c' });
    assert.deepEqual(disabledUser, { reason: 'suspended' }, 'an inactive existing account must not be invited to create a new trial');
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

  // R-C3 (§18.2 purchase-without-setup): a locked shop lands its plan manager on the package page
  // directly, not the locked shell's /renew (Q5) — the same predicate assertOwner uses (R-C11).
  const lockedNoPackage = { termStartAt: new Date(0), termEndsAt: new Date(0), renewCount: 0, termDisabledAt: new Date() };
  const planManageRole = { role: { permissions: [{ permission: { key: 'company.plan.manage' } }] } };

  it('lands a locked shop\'s plan manager on the package page, not renew', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{ companyId: 'co-1', company: { name: 'ร้านหนึ่ง', status: 'DISABLED', planTerm: lockedNoPackage }, roles: [planManageRole] }],
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.equal(minted[0].targetPath, '/companies/co-1/billing?channel=line');
    // Review 2026-09-29 (i): the LIFF start page labels its button from this, not from a guess.
    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN`, packagePage: true });
  });

  it('keeps a locked shop\'s non-manager member on /renew, same as before', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{
        companyId: 'co-1', company: { name: 'ร้านหนึ่ง', status: 'DISABLED', planTerm: lockedNoPackage },
        roles: [{ role: { permissions: [{ permission: { key: 'company.expenses.manage' } }] } }],
      }],
    });

    await useCase.execute({ idToken: 'a.b.c' });

    assert.equal(minted[0].targetPath, '/companies/co-1/renew');
  });

  it('sends a plan manager to billing for an ACTIVE row whose term simply ran out, same lock boundary as renew', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{
        companyId: 'co-1',
        company: { name: 'ร้านหนึ่ง', status: 'ACTIVE', planTerm: { termStartAt: new Date(0), termEndsAt: new Date(Date.now() - 1000), renewCount: 1, termDisabledAt: null } },
        roles: [planManageRole],
      }],
    });

    await useCase.execute({ idToken: 'a.b.c' });

    assert.equal(minted[0].targetPath, '/companies/co-1/billing?channel=line');
  });

  // Sales-event page (spec §3.3, Owner 2026-09-29): the discount is used on the package page, so the
  // page asks to land there — honoured for a plan manager of any shop, never for anyone else.
  it('lands an ACTIVE shop\'s plan manager on the package page when the event page asks', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{ ...membership('co-1'), roles: [planManageRole] }],
    });

    const result = await useCase.execute({ idToken: 'a.b.c', landing: 'package' });

    assert.equal(minted[0].targetPath, '/companies/co-1/billing?channel=line');
    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN`, packagePage: true });
  });

  it('keeps a non-manager on the shop overview even when the event page asks for the package page', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{ ...membership('co-1'), roles: [{ role: { permissions: [{ permission: { key: 'company.expenses.manage' } }] } }] }],
    });

    const result = await useCase.execute({ idToken: 'a.b.c', landing: 'package' });

    assert.equal(minted[0].targetPath, '/companies/co-1/dashboard');
    assert.deepEqual(result, { handoffUrl: `${WEB_BASE}/l/RAWTOKEN` });
  });

  it('applies the package landing to the shop picked from the list, inside that shop only', async () => {
    const { useCase, minted } = makeUseCase({
      identity: activeIdentity,
      memberships: [{ ...membership('co-1'), roles: [planManageRole] }, { ...membership('co-2'), roles: [planManageRole] }],
      context: null,
    });

    await useCase.execute({ idToken: 'a.b.c', companyId: 'co-2', landing: 'package' });

    assert.equal(minted[0].companyId, 'co-2');
    assert.equal(minted[0].targetPath, '/companies/co-2/billing?channel=line');
  });

  it('needsSelection names lockReason/canManagePlan only for the locked row, leaving an ACTIVE row byte-identical', async () => {
    const { useCase } = makeUseCase({
      identity: activeIdentity,
      memberships: [
        membership('co-active', 'ร้านหนึ่ง'),
        { companyId: 'co-locked', company: { name: 'ร้านสอง', status: 'DISABLED', planTerm: lockedNoPackage }, roles: [planManageRole] },
      ],
      context: null,
    });

    const result = await useCase.execute({ idToken: 'a.b.c' });

    assert.deepEqual(result, {
      needsSelection: true,
      companies: [
        { id: 'co-active', name: 'ร้านหนึ่ง' },
        { id: 'co-locked', name: 'ร้านสอง', lockReason: 'no_package', canManagePlan: true },
      ],
    });
  });
});


describe('GW04 LINE renewal round-trip regression', () => {
  it('targets renewal for an explicitly selected expired company, retaining that company', async () => {
    const h = makeUseCase({ identity: activeIdentity, memberships: [
      membership('co-active'),
      { companyId: 'co-expired', company: { name: 'Expired shop', status: 'DISABLED', planTerm: { termDisabledAt: new Date(), termEndsAt: new Date(Date.now() - 1000) } } },
    ], context: { companyId: 'co-active' } });
    await h.useCase.execute({ idToken: 'a.b.c', companyId: 'co-expired' });
    assert.equal(h.minted[0].targetPath, '/companies/co-expired/renew');
    assert.equal(h.minted[0].companyId, 'co-expired');
  });

  it('uses renewal before the sweep disables an ACTIVE company past its deadline', async () => {
    const h = makeUseCase({ identity: activeIdentity, memberships: [
      { companyId: 'co-expired', company: { name: 'Expired shop', status: 'ACTIVE', planTerm: { termDisabledAt: null, termEndsAt: new Date(Date.now() - 1000) } } },
    ] });
    await h.useCase.execute({ idToken: 'a.b.c' });
    assert.equal(h.minted[0].targetPath, '/companies/co-expired/renew');
  });
});

it('GW03 revoked LINE identity does not invite a replacement trial', async () => {
  const h = makeUseCase({ identity: { ...activeIdentity, status: 'DISABLED' }, memberships: [membership('co-1')] });
  assert.deepEqual(await h.useCase.execute({ idToken: 'test.id.token' }), { reason: 'suspended' });
  assert.equal(h.minted.length, 0);
});

describe('new-shop package advisor integration', () => {
  it('serves a public, no-store page with its dedicated external client and the existing CSP', async () => {
    const controller = makeController();
    (controller as any).oaAddFriendUrl = 'https://line.me/R/ti/p/%40system-oa';
    const html = await controller.linePackageAdvisorPage(request());
    assertOnlyExternalScripts(html);
    assert.match(html, /src="\/v1\/auth\/line\/package-advisor\.js"/);
    assert.doesNotMatch(html, /src="\/v1\/auth\/line\/link-page\.js"/);
    assert.ok(html.includes('data-api-base="https://api.example.test/v1"'));
    assert.ok(html.includes(`data-web-base="${WEB_BASE}"`));
    assert.ok(html.includes('data-oa-add-url="https://line.me/R/ti/p/%40system-oa"'));
    assert.ok(html.includes('data-support-url="https://lin.ee/6Sc38L6"'));
    assert.match(html, /data:image\/png;base64,/);
    assert.deepEqual(Reflect.getMetadata('path', AuthController.prototype.linePackageAdvisorPage),
      ['line/link-page/package-advisor', 'line/package-advisor-page']);
    for (const method of [controller.linePackageAdvisorPage, controller.linePackageAdvisorScript]) {
      assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, method), true);
    }
    const headers = responseHeaders(controller.linePackageAdvisorPage);
    assert.equal(headers['cache-control'], 'no-store, max-age=0');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.match(headers['content-security-policy']!, /script-src 'self' https:\/\/static.line-scdn.net;/);
    assert.equal(responseHeaders(controller.linePackageAdvisorScript)['x-content-type-options'], 'nosniff');
    assert.match(controller.linePackageAdvisorScript(), /\/billing\/catalog/);
  });

  it('forwards only the reviewed billing selection and known identity fields', async () => {
    const controller = makeController();
    const calls: unknown[] = [];
    (controller as any).exchangeLiffSession = { execute: async (cmd: unknown) => { calls.push(cmd); return { needsSignup: true }; } };
    await controller.lineLiffSession({ idToken: 'a.b.c', companyId: 'co-2', billingOffer: 'BASIC_499', billingInterval: 'month',
      targetPath: 'https://evil.test' } as any);
    assert.deepEqual(calls, [{ idToken: 'a.b.c', companyId: 'co-2', billingOffer: 'BASIC_499', billingInterval: 'month' }]);
  });

  it('keeps the selected package through current company selection without accepting another tenant', async () => {
    const h = makeUseCase({ identity: activeIdentity, memberships: [membership('co-1'), membership('co-2')] });
    const selection = { idToken: 'a.b.c', billingOffer: 'BASIC_499' as const, billingInterval: 'month' as const };
    assert.ok('needsSelection' in await h.useCase.execute(selection));
    assert.equal(h.minted.length, 0);
    assert.deepEqual(await h.useCase.execute({ ...selection, companyId: 'foreign' }), { reason: 'no_membership' });
    assert.equal(h.minted.length, 0);
    await h.useCase.execute({ ...selection, companyId: 'co-2' });
    assert.equal(h.minted[0].targetPath, '/companies/co-2/billing?offer=BASIC_499&interval=month&channel=line');
    assert.equal(h.minted[0].companyId, 'co-2');
  });

  it('refuses malformed billing selections before verification or minting', async () => {
    for (const input of [{ billingOffer: 'https://evil.test' }, { billingOffer: 'FREE_TRIAL_15' },
      { billingOffer: 'PRO_999', billingInterval: 'week' }, { billingInterval: 'month' }]) {
      const h = makeUseCase({ identity: activeIdentity, memberships: [membership('co-1')] });
      await assert.rejects(h.useCase.execute({ idToken: 'a.b.c', ...input } as any), BadRequestException);
      assert.equal(h.minted.length, 0); assert.equal(h.buckets.length, 0);
    }
  });

  it('retains suspended-identity and company-hold refusal for billing recommendations', async () => {
    const selection = { idToken: 'a.b.c', billingOffer: 'STARTER_249' as const };
    for (const h of [
      makeUseCase({ identity: { ...activeIdentity, status: 'DISABLED' }, memberships: [membership('co-1')] }),
      makeUseCase({ identity: activeIdentity, memberships: [{ companyId: 'co-1', company: { name: 'held', status: 'SUSPENDED' } }] }),
    ]) {
      assert.deepEqual(await h.useCase.execute(selection), { reason: 'suspended' });
      assert.equal(h.minted.length, 0);
    }
  });
});

it('PWS-ADVISOR-WORDS pins the current advisor introduction and result reason with the existing secure entry', async () => {
  const controller = makeController();
  const html = await controller.linePackageAdvisorPage(request());
  assert.match(html, /มั่งมีขอรู้จักร้านอีกนิดนะคะ มีคำถามสั้น ๆ 4 ข้อ จะได้ช่วยดูว่าแพ็กเกจไหนเหมาะกับงานที่ร้านใช้จริง/);
  assert.match(html, /กลับไปส่งใบเสร็จ/);
  assert.equal(responseHeaders(controller.linePackageAdvisorPage)['cache-control'], 'no-store, max-age=0');
  assert.ok(responseHeaders(controller.linePackageAdvisorPage)['content-security-policy']);
  const script = controller.linePackageAdvisorScript();
  assert.ok(script.includes("resultReason.textContent = 'จากที่คุณเล่า มั่งมีแนะนำแพ็กเกจนี้ค่ะ ' + reasonText(result.input)\n      + (note ? ' ' + note : '');"));
  assert.ok(script.includes("return 'เพราะร้านอยาก' + goalName + ' และมีผู้ดูแลอยู่ในช่วง '"));
  assert.match(script, /ยังไม่ระบุจำนวนใบเสร็จ/);
  assert.match(script, /เริ่มจากถ่ายใบเสร็จและเก็บรายการไว้ดูในที่เดียว/);
});
