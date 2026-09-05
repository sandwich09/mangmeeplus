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

  it('asks for a shop name and a REQUIRED phone, and promises the trial in the Owner wording', () => {
    const html = makeController().lineSignupPage(request());

    assert.ok(html.includes('id="company-name"'));
    assert.ok(html.includes('inputmode="tel"'), 'the phone field opens a phone keypad');
    assert.ok(/<input id="phone-number"[^>]*\brequired\b/.test(html), 'the phone field is required (Owner 2026-09-05)');
    assert.ok(html.includes('<label for="phone-number">เบอร์มือถือ</label>'), 'the bare label, no optional tag');
    assert.equal(html.includes('ไม่บังคับ'), false, 'the phone is no longer optional');
    assert.ok(html.includes('ยอมรับและเริ่มทดลองใช้ฟรี'));
    assert.ok(html.includes('ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง'));
    assert.equal(html.includes('ไม่ต้องใส่บัตร'), false, 'dropped from the trial line (Owner 2026-09-05)');
  });

  /**
   * The challenge is 64 hex characters and the Owner's phone rendered it off the right edge. It is
   * legal evidence, so it may not be shortened — it wraps instead, in a block of its own.
   */
  it('lets the 64-hex reference wrap instead of running off a 390px screen', () => {
    const html = makeController().lineSignupPage(request());
    const challenge = currentLegalRelease('th').displayChallenge;

    assert.ok(html.includes(`<p class="challenge">${challenge}</p>`), 'its own block, whole');
    const rule = /\.challenge\{([^}]*)\}/.exec(html);
    assert.ok(rule, 'the .challenge rule must be served with the page');
    for (const declaration of ['overflow-wrap:anywhere', 'word-break:break-all', 'font-size:12px', 'monospace']) {
      assert.ok(rule![1]!.includes(declaration), declaration);
    }
    // 64 hex at 12px monospace is ~7.2px/char ≈ 461px — wider than a 390px phone minus padding, so
    // the wrap is what keeps it on screen rather than a lucky font size.
    assert.ok(challenge.length * 7.2 > 390, 'the string really is wider than the screen');
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
    options: { initFails?: Error; phone?: string; companyName?: string; fetchThrows?: Error } = {},
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
    const elements: Record<string, Record<string, any>> = {
      status: { textContent: '', className: '' },
      detail: { textContent: '' },
      greeting: { textContent: '' },
      link: { disabled: true, textContent: 'ยอมรับและเริ่มทดลองใช้ฟรี', addEventListener: listen('link') },
      retry: { addEventListener: listen('retry') },
      'notice-action': { hidden: true, textContent: '', addEventListener: listen('notice-action') },
      'client-notice': { hidden: true },
      'liff-content': { hidden: false },
      'pending-text': { textContent: '' },
      'done-text': { textContent: '' },
      'company-name': input('company-name', options.companyName ?? 'ร้านนิด'),
      'company-name-error': { textContent: '', hidden: true },
      'phone-number': input('phone-number', options.phone ?? '081-234-5678'),
      'phone-number-error': { textContent: '', hidden: true },
    };
    const closeButtons = [{ addEventListener: listen('close') }];
    const views = [
      { id: 'retry-view', hidden: true },
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
        init: async () => { if (options.initFails) throw options.initFails; },
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
        if (options.fetchThrows && calls.length > 1) throw options.fetchThrows;
        return { ok: true, status: 200, text: async () => statusBody };
      },
    });
    return {
      elements, views, calls, handlers,
      closed: () => closed,
      focused,
      tone: () => String(elements['status']!.className).replace('notice notice-', ''),
      click: async (key: string) => {
        for (const handler of handlers[key] ?? []) await handler();
      },
    };
  }

  const settle = () => new Promise((resolve) => { setImmediate(resolve); });

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

    it('shows both again for a real failure, with no styling of its own', async () => {
      const h = runSignupScript('null', [], { initFails: new Error('LIFF init failed') });
      await settle();
      await settle();

      assert.equal(h.elements.status!.hidden, false);
      assert.equal(h.elements.detail!.hidden, false, 'an error still has to be readable');
      assert.match(h.elements.detail!.textContent, /LIFF init failed/);
      // Hidden is the only thing that changed: nothing swaps a class, so the shown box keeps the
      // one `pre` rule the page was served with.
      assert.equal(h.elements.detail!.className, undefined);
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
    assert.equal(body.phoneNumber, '0812345678', 'sent as digits, however the owner spaced it');
    assert.equal(h.views.find((view) => view.id === 'done-view')!.hidden, false);
    // The card's heading already reads "ได้รับแล้ว"; the body must not say it a second time.
    assert.equal(h.elements['done-text']!.textContent.startsWith('ได้รับแล้วค่ะ'), false);
    assert.match(h.elements['done-text']!.textContent, /^ทีมงานกำลังตรวจสอบ/);
  });

  /**
   * Review BLOCKER 1. The phone error used to be thrown as a bare Error, so it landed in the summary
   * ("ส่งคำขอไม่สำเร็จ", scrolled off the top at tap time) and in #detail (below the fold) — the one
   * moment the customer needed it, it was off-screen in both directions. These assertions are all
   * geometry-independent: WHICH element holds the text, what the input is marked with, where focus
   * went. Any of them would have caught the original defect.
   */
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
        assert.match(h.elements.status!.textContent, /^กรอกเบอร์มือถือให้ครบก่อนนะคะ/, label);
        // The button invites the retry it just asked for.
        assert.equal(h.elements.link!.disabled, false, label);
        assert.equal(h.elements.link!.textContent, 'ยอมรับและเริ่มทดลองใช้ฟรี', label);
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
      assert.equal(h.elements.link!.textContent, 'ยอมรับและเริ่มทดลองใช้ฟรี', 'the original label is back');
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
      assert.match(h.elements.status!.textContent, /เชื่อมต่อไม่สำเร็จ/);
      assert.match(h.elements.status!.textContent, /ลองใหม่/);
      assert.equal(h.elements.link!.disabled, false);
      // LOW-4: this branch also catches a 202 that will not parse and a failed status re-read, and
      // the raw message is then the only diagnostic there is — support must still be able to see it.
      assert.match(h.elements.detail!.textContent, /Failed to fetch/, 'the technical reason survives');
      assert.equal(h.elements.detail!.hidden, false);
    });

    it('keeps the reason when a 202 body will not parse', async () => {
      const h = await submitWith(202, 'not json at all');

      assert.equal(h.tone(), 'warning');
      assert.match(h.elements.status!.textContent, /เชื่อมต่อไม่สำเร็จ/, 'the customer gets a sentence');
      assert.notEqual(h.elements.detail!.textContent, '', 'and support gets the parse error');
    });

    it('shows success in the success tone', async () => {
      const h = runSignupScript('null', [
        { status: 200, body: 'null' },
        { status: 202, body: JSON.stringify({ requestId: 'r1', state: 'PENDING_REVIEW', existingAccount: false, businessHours: true }) },
      ]);
      await settle();
      await settle();
      await h.click('link');
      await settle();

      // The done CARD carries the words; the notice itself is cleared, so it paints nothing.
      assert.equal(h.elements.status!.textContent, '');
      assert.equal(h.elements.status!.hidden, true);
      assert.equal(h.views.find((view) => view.id === 'done-view')!.hidden, false);
    });
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
    // Same rule as the done card: the waiting card's heading is "ได้รับแล้ว" too.
    assert.equal(h.elements['pending-text']!.textContent.startsWith('ได้รับ'), false);
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
      assert.equal(h.views.find((view) => view.id === 'done-view')!.hidden, true);
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
    assert.equal(views.find((view) => view.id === 'pending-view')!.hidden, false);
    assert.equal(views.find((view) => view.id === 'form-view')!.hidden, true);
    assert.match(elements['pending-text']!.textContent, /นอกเวลาทำการ/);
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
      // This one really is technical — a raw SDK message — so #detail is exactly where it belongs.
      assert.match(h.elements.detail!.textContent, /LIFF init failed/, 'the reason stays readable');
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
