import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../../modules/auth/presentation/auth.controller';
import { IS_PUBLIC_ROUTE_KEY } from './public.decorator';
import { LIFF_EVENT_DISCOUNT_PAGE, LIFF_PAGE_CSP, LIFF_PAGE_SCRIPT, LIFF_PAGE_SCRIPT_VERSION } from './liff-page.security';

// Sales-event discounts, SD-B (spec §3.3, §3.5, §8): the page a booth QR opens, driven through the
// real LIFF script with the LINE SDK and the network simulated.
const QR = 'Q'.repeat(43);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
const headersOf = (method: object) => Object.fromEntries(((Reflect.getMetadata(HEADERS_METADATA, method) ?? []) as { name: string; value: string }[])
  .map(({ name, value }) => [name.toLowerCase(), value]));

/** The elements the real page carries, with their static text: the harness cannot grow one it lacks. */
const PAGE_ELEMENTS = [...LIFF_EVENT_DISCOUNT_PAGE.content.matchAll(/\bid="([^"]+)"[^>]*>([^<]*)/g)].map((match) => [match[1]!, match[2]!.trim()] as const);
const PAGE_IDS = PAGE_ELEMENTS.map(([id]) => id);

type Reply = { status: number; body: unknown } | 'offline';
function page(options: { claim?: Reply; sessions?: Reply[]; search?: string } = {}) {
  const elements: Record<string, any> = {};
  function element(id: string, textContent = '') {
    return { id, hidden: true, disabled: false, textContent, className: '', handlers: {} as any, children: [] as any[],
      addEventListener(name: string, fn: any) { this.handlers[name] = fn; },
      appendChild(child: any) { this.children.push(child); } };
  }
  for (const [id, text] of PAGE_ELEMENTS) elements[id] = element(id, text);
  const posted: { url: string; body: any }[] = [];
  let claim = options.claim ?? { status: 200, body: { ticket: {
    serial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 10_000, chatCreditUnits: 5_000, receiptImageUnits: 20,
    expiresAt: '2026-10-31T10:00:00.000Z' }, replay: false, next: 'SIGN_UP' } };
  const sessions = [...(options.sessions ?? [{ status: 200, body: { handoffUrl: 'https://app.example.test/l/one-time', packagePage: true } }])];
  const opened: any[] = [];
  const search = options.search ?? `?t=${QR}`;
  // The page's clock, so a test can let a prepared link go stale.
  const clock = { now: Date.now() };
  class PageDate extends Date { static override now() { return clock.now; } }
  runInNewContext(LIFF_PAGE_SCRIPT, {
    document: { body: { dataset: { liffMode: 'event-discount', liffId: '123-test', apiBase: 'https://api.example.test/v1' } },
      getElementById: (id: string) => elements[id] ?? null, querySelectorAll: () => [], createElement: () => element('') },
    location: { href: `https://api.example.test/v1/auth/line/link-page/event-discount${search}`, origin: 'https://api.example.test', search, assign: () => {} },
    URL, URLSearchParams, Date: PageDate, setTimeout, crypto: globalThis.crypto,
    navigator: { userAgent: 'LINE Android' },
    liff: { init: async () => {}, isLoggedIn: () => true, getDecodedIDToken: () => ({ exp: Date.now() / 1000 + 3600 }),
      getIDToken: () => 'test.id.token', isInClient: () => true, openWindow: (input: any) => opened.push(input) },
    fetch: async (url: string, init: any) => {
      posted.push({ url, body: JSON.parse(init.body) });
      const reply = url.endsWith('/public/event-discounts/claim') ? claim : (sessions.length > 1 ? sessions.shift()! : sessions[0]!);
      if (reply === 'offline') throw new Error('offline');
      return { ok: reply.status < 300, status: reply.status, text: async () => JSON.stringify(reply.body) };
    },
  });
  const visibleText = () => Object.values(elements).filter((el) => !el.hidden || el.id.startsWith('ticket-'))
    .flatMap((el) => [el.textContent, ...el.children.map((child: any) => child.textContent)]).join('\n');
  return { elements, posted, opened, visibleText, clock,
    rewards: () => elements['ticket-rewards'].children.map((child: any) => child.textContent),
    sessionCalls: () => posted.filter((call) => call.url.endsWith('/auth/line/liff/session')),
    setClaim: (reply: Reply) => { claim = reply; },
    click: (id: string) => elements[id].handlers.click({ preventDefault() {} }) };
}

const ticket = (overrides: Record<string, unknown>, next: 'SIGN_UP' | 'OPEN_PACKAGE' = 'SIGN_UP') => ({ status: 200, body: { ticket: {
  serial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 0, chatCreditUnits: 0, receiptImageUnits: 0,
  expiresAt: '2026-10-31T10:00:00.000Z', ...overrides }, replay: false, next } });
const member = ticket({ discountSatang: 10_000, chatCreditUnits: 5_000 }, 'OPEN_PACKAGE');
const NOTE = 'เลือกใช้หรือไม่ใช้ได้ตอนจ่าย · งานเดียวกันใช้ได้ร้านละครั้ง';

describe('sales-event LIFF page', () => {
  it('is served public with the LIFF CSP and carries no inline script and no ticket wording', () => {
    const method = AuthController.prototype.lineEventDiscountPage;
    assert.equal(Reflect.getMetadata('path', method), 'line/link-page/event-discount');
    assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, method), true);
    const headers = headersOf(method);
    assert.equal(headers['content-security-policy'], LIFF_PAGE_CSP);
    assert.equal(headers['cache-control'], 'no-store, max-age=0');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    const html = method.call({ config: { lineLiffId: '123-test' } }, { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any) as string;
    assert.match(html, /data-liff-mode="event-discount"/);
    assert.equal([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(([, body]) => body!.trim()).length, 0);
    assert.match(html, /ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน/);
    for (const text of [html, LIFF_EVENT_DISCOUNT_PAGE.content, LIFF_PAGE_SCRIPT]) assert.doesNotMatch(text, /ตั๋ว/);
    assert.ok(!PAGE_IDS.includes('open-web'), 'one button: "เปิดมั่งมี" both prepares and opens');
  });

  // UAT 2026-09-29: LINE's browser ran the morning's script for hours after a deploy, because the bare
  // URL's `no-cache` reached the phone as Cloudflare's own `max-age=14400`.
  it('names its script by a content version, so a deploy that changes the script changes the URL', () => {
    const html = AuthController.prototype.lineEventDiscountPage.call({ config: { lineLiffId: '123-test' } },
      { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any) as string;
    const version = createHash('sha256').update(LIFF_PAGE_SCRIPT).digest('hex').slice(0, 12);
    assert.equal(LIFF_PAGE_SCRIPT_VERSION, version);
    const sources = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);
    assert.deepEqual(sources, ['https://static.line-scdn.net/liff/edge/2/sdk.js', `/v1/auth/line/link-page.js?v=${version}`]);
    // Same origin with a query is still 'self': the CSP needs no change and gains no 'unsafe-inline'.
    assert.match(LIFF_PAGE_CSP, /script-src 'self' https:\/\/static\.line-scdn\.net;/);
  });

  it('caches the script for a year only at the URL that pins its bytes, and nowhere at any other', () => {
    const method = AuthController.prototype.lineLinkPageScript;
    assert.equal(Reflect.getMetadata('path', method), 'line/link-page.js');
    assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, method), true);
    const headers = headersOf(method);
    assert.equal(headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['cache-control'], undefined, 'the handler decides it, per request');
    const serve = (version: unknown) => {
      const set: Record<string, string> = {};
      const body = method.call({}, version, { setHeader: (name: string, value: string) => { set[name.toLowerCase()] = value; } } as any);
      assert.equal(body, LIFF_PAGE_SCRIPT);
      return set['cache-control'];
    };
    assert.equal(serve(LIFF_PAGE_SCRIPT_VERSION), 'public, max-age=31536000, immutable');
    for (const other of [undefined, '', 'abcdef123456', [LIFF_PAGE_SCRIPT_VERSION, 'x']]) {
      assert.equal(serve(other), 'private, no-store, max-age=0', `v=${JSON.stringify(other)} is not stored anywhere`);
    }
  });

  it('claims with the QR from its own URL and shows the discount in event words, the expiry and the signup door', async () => {
    const h = page();
    await settle();
    const [claim] = h.posted;
    assert.equal(claim!.url, 'https://api.example.test/v1/public/event-discounts/claim');
    assert.equal(claim!.body.qrToken, QR);
    assert.equal(claim!.body.idToken, 'test.id.token');
    assert.match(claim!.body.requestKey, /^[0-9a-f-]{36}$/);
    assert.equal(h.elements['ticket-view'].hidden, false);
    assert.equal(h.elements['ticket-title'].textContent, 'รับส่วนลดแล้ว');
    assert.equal(h.elements['ticket-event'].textContent, 'งาน งานแฟร์ SME');
    // Owner 2026-09-29: the credit this ticket also carries is withdrawn for now — never promised.
    assert.deepEqual(h.rewards(), ['ส่วนลด 100 บาท ใช้ตอนจ่ายค่าแพ็กเกจ']);
    assert.equal(h.elements['ticket-note'].hidden, false);
    assert.equal(h.elements['ticket-note'].textContent, NOTE);
    assert.match(h.elements['ticket-expiry'].textContent, /^ใช้ได้ถึง /);
    assert.equal(h.elements['go-signup'].hidden, false);
    assert.equal(h.elements['signup-hint'].hidden, false);
    assert.equal(h.elements['open-mangmee'].hidden, true);
    assert.equal(h.sessionCalls().length, 0, 'no account, nothing to prepare');
    assert.equal(h.elements.link.hidden, true);
    assert.equal(h.elements.status.hidden, true);
    assert.doesNotMatch(h.visibleText(), /ABCD2345|ตั๋ว|SALES_EVENT|OPEN_PACKAGE|เครดิต|ร้านใหม่:|ร้านที่มีแพ็กเกจอยู่แล้ว/);
  });

  it('never words a reward for new shops only, and never promises credit', () => {
    for (const text of [LIFF_PAGE_SCRIPT, LIFF_EVENT_DISCOUNT_PAGE.content]) {
      assert.doesNotMatch(text, /ร้านใหม่:|ร้านที่มีแพ็กเกจอยู่แล้ว|รับเครดิต|บิลแรก/);
    }
  });

  it('shows only the discount, and nothing at all for a ticket that carries only credit', async () => {
    const discountOnly = page({ claim: ticket({ discountSatang: 50_000 }) });
    await settle();
    assert.deepEqual(discountOnly.rewards(), ['ส่วนลด 500 บาท ใช้ตอนจ่ายค่าแพ็กเกจ']);
    const creditOnly = page({ claim: ticket({ chatCreditUnits: 10_000, receiptImageUnits: 30 }) });
    await settle();
    assert.deepEqual(creditOnly.rewards(), []);
    assert.equal(creditOnly.elements['ticket-note'].hidden, true);
    assert.doesNotMatch(creditOnly.visibleText(), /เครดิต|อ่านรูปใบเสร็จ/);
  });

  // Owner 2026-09-29: "พอกดรับแล้วยังต้องมีกดเปิดร้านอีก ต้องมี 2 act". Preparing needs no gesture;
  // only opening does (GW02) — so the link is ready before the first tap, and that tap opens it.
  it('prepares the handoff right after the claim, so one tap on เปิดมั่งมี opens the shop', async () => {
    const h = page({ claim: member });
    await settle();
    assert.deepEqual(h.sessionCalls().map((call) => call.body), [{ idToken: 'test.id.token', landing: 'package' }],
      'prepared with no tap, asking to land a plan manager on the package page');
    assert.equal(h.elements['open-mangmee'].hidden, false);
    assert.equal(h.elements['open-mangmee'].disabled, false);
    assert.equal(h.elements['open-mangmee'].textContent, 'เปิดมั่งมี');
    assert.equal(h.elements.status.hidden, true, 'nothing to read above the ticket: the button is the next step');
    assert.equal(h.opened.length, 0, 'never opened without a tap');

    h.click('open-mangmee');
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened)), [{ url: 'https://app.example.test/l/one-time', external: true }],
      'opened synchronously, inside the tap');
    assert.equal(h.sessionCalls().length, 1, 'the tap itself made no network call');
    assert.match(h.elements.status.textContent, /แตะ เปิดมั่งมี อีกครั้งเพื่อรับลิงก์ใหม่ค่ะ/);

    // The link is single-use: the next tap prepares a new one and the one after opens it.
    h.click('open-mangmee');
    assert.equal(h.opened.length, 1);
    await settle();
    assert.equal(h.sessionCalls().length, 2);
    assert.equal(h.elements.status.textContent, 'พร้อมแล้วค่ะ แตะ เปิดมั่งมี เพื่อเข้าร้าน');
    h.click('open-mangmee');
    assert.equal(h.opened.length, 2);
  });

  for (const failure of ['offline', { status: 503, body: { message: 'line_web_handoff_disabled' } }] as const) {
    it(`falls back to prepare-on-tap when the automatic prepare fails (${typeof failure === 'string' ? failure : failure.status})`, async () => {
      const h = page({ claim: member, sessions: [failure, { status: 200, body: { handoffUrl: 'https://app.example.test/l/second' } }] });
      await settle();
      assert.match(h.elements.status.textContent, /^เปิดมั่งมีไม่สำเร็จ\nแตะ เปิดมั่งมี อีกครั้ง/);
      assert.doesNotMatch(h.elements.status.textContent, /line_web_handoff_disabled|offline/);
      assert.equal(h.elements['open-mangmee'].hidden, false);
      assert.equal(h.elements['open-mangmee'].disabled, false);
      h.click('open-mangmee');
      assert.equal(h.opened.length, 0, 'nothing prepared yet, so this tap prepares');
      await settle();
      assert.equal(h.elements.status.textContent, 'พร้อมแล้วค่ะ แตะ เปิดมั่งมี เพื่อเข้าร้าน');
      h.click('open-mangmee');
      assert.deepEqual(h.opened.map((entry) => entry.url), ['https://app.example.test/l/second']);
    });
  }

  it('never opens a link that sat past its life: the tap prepares a fresh one instead', async () => {
    const h = page({ claim: member, sessions: [
      { status: 200, body: { handoffUrl: 'https://app.example.test/l/old' } },
      { status: 200, body: { handoffUrl: 'https://app.example.test/l/fresh' } },
    ] });
    await settle();
    h.clock.now += 11 * 60 * 1000;
    h.click('open-mangmee');
    assert.equal(h.opened.length, 0);
    await settle();
    assert.equal(h.sessionCalls().length, 2);
    h.click('open-mangmee');
    assert.deepEqual(h.opened.map((entry) => entry.url), ['https://app.example.test/l/fresh']);
  });

  it('with several shops, shows the list at once; a shop tap then one more tap opens it', async () => {
    const h = page({ claim: member, sessions: [
      { status: 200, body: { needsSelection: true, companies: [{ id: 'co-1', name: 'ร้านหนึ่ง' }, { id: 'co-2', name: 'ร้านสอง', lockReason: 'trial_ended' }] } },
      { status: 200, body: { handoffUrl: 'https://app.example.test/l/co-2', packagePage: true } },
    ] });
    await settle();
    const list = h.elements.companies;
    assert.equal(list.hidden, false);
    assert.deepEqual(list.children.map((child: any) => child.textContent), ['ร้านหนึ่ง', 'ร้านสอง · หมดอายุ']);
    assert.equal(h.elements['open-mangmee'].hidden, true, 'the list is the next tap, not the button');
    assert.equal(h.elements.status.textContent, 'เลือกร้านที่จะเปิดค่ะ');

    list.children[1].handlers.click();
    await settle();
    assert.deepEqual(h.sessionCalls()[1]!.body, { idToken: 'test.id.token', companyId: 'co-2', landing: 'package' });
    assert.equal(list.hidden, true);
    assert.equal(h.elements['open-mangmee'].hidden, false);
    h.click('open-mangmee');
    assert.deepEqual(h.opened.map((entry) => entry.url), ['https://app.example.test/l/co-2']);
  });

  for (const [code, expected] of [
    // SD-O11: a QR has no clock of its own, so an unknown one is "ใช้ไม่ได้", never "หมดอายุ".
    ['SALES_EVENT_QR_INVALID', /QR นี้ใช้ไม่ได้\nขอ QR ของงานนี้จากทีมขายอีกครั้ง/],
    ['SALES_EVENT_AGENT_INACTIVE', /QR นี้ใช้ไม่ได้แล้ว/],
    ['SALES_EVENT_CLAIM_CLOSED', /งานนี้ปิดรับส่วนลดแล้ว/],
    ['SALES_EVENT_ISSUE_FULL', /ส่วนลดของงานนี้ถูกแจกครบแล้ว/],
    ['SALES_EVENT_SELF_CLAIM', /บัญชีทีมขายรับส่วนลดนี้ไม่ได้/],
  ] as const) {
    it(`explains ${code} in Thai and offers a retry`, async () => {
      const h = page({ claim: { status: code === 'SALES_EVENT_SELF_CLAIM' ? 403 : 409, body: { code, message: 'x' } } });
      await settle();
      assert.match(h.elements.status.textContent, expected);
      assert.doesNotMatch(h.elements.status.textContent, /SALES_EVENT/);
      assert.equal(h.elements['ticket-view'].hidden, true);
      assert.equal(h.elements.link.hidden, false);
      assert.equal(h.elements.link.disabled, false);
      assert.equal(h.sessionCalls().length, 0);
    });
  }

  it('retries the same claim with the same request key after a failure', async () => {
    const h = page({ claim: { status: 500, body: { message: 'Internal server error' } } });
    await settle();
    assert.match(h.elements.status.textContent, /^รับส่วนลดไม่สำเร็จ/);
    assert.doesNotMatch(h.elements.status.textContent, /Internal/);
    h.setClaim(ticket({ discountSatang: 10_000 }));
    h.click('link');
    await settle();
    assert.equal(h.elements['ticket-view'].hidden, false);
    assert.equal(h.elements.link.hidden, true);
    assert.equal(h.posted[0]!.body.requestKey, h.posted[1]!.body.requestKey);
  });

  it('refuses a missing or malformed QR without calling the API', async () => {
    const h = page({ search: '?t=short' });
    await settle();
    assert.equal(h.posted.length, 0);
    assert.match(h.elements.status.textContent, /^QR นี้ใช้ไม่ได้/);
  });
});
