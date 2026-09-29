import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../../modules/auth/presentation/auth.controller';
import { IS_PUBLIC_ROUTE_KEY } from './public.decorator';
import { LIFF_EVENT_DISCOUNT_PAGE, LIFF_PAGE_CSP, LIFF_PAGE_SCRIPT } from './liff-page.security';

// Sales-event discounts, SD-B (spec §3.3, §3.5, §8): the page a booth QR opens, driven through the
// real LIFF script with the LINE SDK and the network simulated.
const QR = 'Q'.repeat(43);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };

type Reply = { status: number; body: unknown };
function page(options: { claim?: Reply; session?: Reply; search?: string } = {}) {
  const elements: Record<string, any> = {};
  function element(id: string) {
    return { id, hidden: true, disabled: false, textContent: '', className: '', handlers: {} as any, children: [] as any[],
      addEventListener(name: string, fn: any) { this.handlers[name] = fn; },
      appendChild(child: any) { this.children.push(child); } };
  }
  for (const id of ['status', 'detail', 'link', 'ticket-title', 'ticket-view', 'ticket-event', 'ticket-rewards', 'ticket-expiry',
    'open-mangmee', 'companies', 'open-web', 'go-signup', 'signup-hint']) elements[id] = element(id);
  const posted: { url: string; body: any }[] = [];
  let claim = options.claim ?? { status: 200, body: { ticket: {
    serial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 10_000, chatCreditUnits: 5_000, receiptImageUnits: 20,
    expiresAt: '2026-10-31T10:00:00.000Z' }, replay: false, next: 'SIGN_UP' } };
  const session = options.session ?? { status: 200, body: { handoffUrl: 'https://app.example.test/l/one-time', packagePage: true } };
  const opened: any[] = [];
  const search = options.search ?? `?t=${QR}`;
  runInNewContext(LIFF_PAGE_SCRIPT, {
    document: { body: { dataset: { liffMode: 'event-discount', liffId: '123-test', apiBase: 'https://api.example.test/v1' } },
      getElementById: (id: string) => elements[id] ?? null, querySelectorAll: () => [], createElement: () => element('') },
    location: { href: `https://api.example.test/v1/auth/line/link-page/event-discount${search}`, origin: 'https://api.example.test', search, assign: () => {} },
    URL, URLSearchParams, Date, setTimeout, crypto: globalThis.crypto,
    navigator: { userAgent: 'LINE Android' },
    liff: { init: async () => {}, isLoggedIn: () => true, getDecodedIDToken: () => ({ exp: Date.now() / 1000 + 3600 }),
      getIDToken: () => 'test.id.token', isInClient: () => true, openWindow: (input: any) => opened.push(input) },
    fetch: async (url: string, init: any) => {
      posted.push({ url, body: JSON.parse(init.body) });
      const reply = url.endsWith('/public/event-discounts/claim') ? claim : session;
      return { ok: reply.status < 300, status: reply.status, text: async () => JSON.stringify(reply.body) };
    },
  });
  const visibleText = () => Object.values(elements).filter((el) => !el.hidden || el.id === 'status' || el.id.startsWith('ticket-'))
    .flatMap((el) => [el.textContent, ...el.children.map((child: any) => child.textContent)]).join('\n');
  return { elements, posted, opened, visibleText,
    rewards: () => elements['ticket-rewards'].children.map((child: any) => child.textContent),
    setClaim: (reply: Reply) => { claim = reply; },
    click: (id: string) => elements[id].handlers.click({ preventDefault() {} }) };
}

const ticket = (overrides: Record<string, unknown>) => ({ status: 200, body: { ticket: {
  serial: 'ABCD2345', eventName: 'งานแฟร์ SME', discountSatang: 0, chatCreditUnits: 0, receiptImageUnits: 0,
  expiresAt: '2026-10-31T10:00:00.000Z', ...overrides }, replay: false, next: 'SIGN_UP' } });

describe('sales-event LIFF page', () => {
  it('is served public with the LIFF CSP and carries no inline script and no ticket wording', () => {
    const method = AuthController.prototype.lineEventDiscountPage;
    assert.equal(Reflect.getMetadata('path', method), 'line/link-page/event-discount');
    assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, method), true);
    const headers = Object.fromEntries(((Reflect.getMetadata(HEADERS_METADATA, method) ?? []) as { name: string; value: string }[])
      .map(({ name, value }) => [name.toLowerCase(), value]));
    assert.equal(headers['content-security-policy'], LIFF_PAGE_CSP);
    assert.equal(headers['cache-control'], 'no-store, max-age=0');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    const html = method.call({ config: { lineLiffId: '123-test' } }, { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any) as string;
    assert.match(html, /data-liff-mode="event-discount"/);
    assert.equal([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(([, body]) => body!.trim()).length, 0);
    assert.match(html, /ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน/);
    for (const text of [html, LIFF_EVENT_DISCOUNT_PAGE.content, LIFF_PAGE_SCRIPT]) assert.doesNotMatch(text, /ตั๋ว/);
  });

  it('claims with the QR from its own URL and shows both rewards, the expiry and the signup door', async () => {
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
    assert.deepEqual(h.rewards(), [
      'ร้านใหม่: ลด 100 บาทจากบิลแรกเมื่อซื้อแพ็กเกจ',
      'ร้านที่มีแพ็กเกจอยู่แล้ว: รับเครดิต AI 50 เครดิต และจำนวนอ่านรูปใบเสร็จ 20 รูป',
    ]);
    assert.match(h.elements['ticket-expiry'].textContent, /^ใช้ได้ถึง /);
    assert.equal(h.elements['go-signup'].hidden, false);
    assert.equal(h.elements['signup-hint'].hidden, false);
    assert.equal(h.elements['open-mangmee'].hidden, true);
    assert.equal(h.elements.link.hidden, true);
    assert.equal(h.elements.status.hidden, true);
    assert.doesNotMatch(h.visibleText(), /ABCD2345|ตั๋ว|SALES_EVENT|OPEN_PACKAGE/);
  });

  it('shows only what the batch gives', async () => {
    const discountOnly = page({ claim: ticket({ discountSatang: 50_000 }) });
    await settle();
    assert.deepEqual(discountOnly.rewards(), ['ร้านใหม่: ลด 500 บาทจากบิลแรกเมื่อซื้อแพ็กเกจ']);
    const creditOnly = page({ claim: ticket({ chatCreditUnits: 10_000 }) });
    await settle();
    assert.deepEqual(creditOnly.rewards(), ['ร้านที่มีแพ็กเกจอยู่แล้ว: รับเครดิต AI 100 เครดิต']);
    const imagesOnly = page({ claim: ticket({ receiptImageUnits: 30 }) });
    await settle();
    assert.deepEqual(imagesOnly.rewards(), ['ร้านที่มีแพ็กเกจอยู่แล้ว: รับจำนวนอ่านรูปใบเสร็จ 30 รูป']);
  });

  it('opens มั่งมี through the start-page handoff for a linked LINE account', async () => {
    const h = page({ claim: { ...ticket({ discountSatang: 10_000 }), body: { ...ticket({ discountSatang: 10_000 }).body, next: 'OPEN_PACKAGE' } } });
    await settle();
    assert.equal(h.elements['open-mangmee'].hidden, false);
    assert.equal(h.elements['go-signup'].hidden, true);
    h.click('open-mangmee');
    await settle();
    assert.equal(h.posted[1]!.url, 'https://api.example.test/v1/auth/line/liff/session');
    assert.deepEqual(h.posted[1]!.body, { idToken: 'test.id.token' });
    assert.equal(h.elements['open-web'].hidden, false);
    assert.equal(h.elements['open-web'].textContent, 'เลือกแพ็กเกจ');
    assert.equal(h.elements['open-mangmee'].hidden, true);
    h.click('open-web');
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened)), [{ url: 'https://app.example.test/l/one-time', external: true }]);
    assert.equal(h.elements['open-mangmee'].hidden, false, 'a spent link is replaced by tapping เปิดมั่งมี again');
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
