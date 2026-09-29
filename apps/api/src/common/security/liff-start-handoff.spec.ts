import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { LIFF_PAGE_SCRIPT } from './liff-page.security';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function start(inClient = true, openFails = false) {
  const elements: Record<string, any> = {};
  function element(id: string) {
    return { id, hidden: true, disabled: false, textContent: '', className: '', handlers: {} as any,
      addEventListener(name: string, fn: any) { this.handlers[name] = fn; },
      appendChild(child: any) { (this.children ??= []).push(child); }, children: [] as any[],
    };
  }
  for (const id of ['status', 'detail', 'link', 'open-web', 'companies', 'go-signup']) elements[id] = element(id);
  let reply: any = { handoffUrl: 'https://app.example.test/l/test-token' };
  let fails = false;
  const opened: any[] = [], navigated: string[] = [];
  const location = { href: 'https://api.example.test/v1/auth/line/start-page', origin: 'https://api.example.test', search: '', assign: (url: string) => navigated.push(url) };
  runInNewContext(LIFF_PAGE_SCRIPT, {
    document: { body: { dataset: { liffMode: 'start', liffId: '123-test', apiBase: 'https://api.example.test/v1' } },
      getElementById: (id: string) => elements[id] ?? null, querySelectorAll: () => [], createElement: () => element('') },
    location, URL, URLSearchParams, Date, setTimeout,
    navigator: { userAgent: 'LINE Android' },
    liff: { init: async () => {}, isLoggedIn: () => true, getDecodedIDToken: () => ({ exp: Date.now() / 1000 + 3600 }),
      getIDToken: () => 'test.id.token', isInClient: () => inClient,
      openWindow: (input: any) => { if (openFails) throw new Error('blocked'); opened.push(input); } },
    fetch: async () => { if (fails) throw new Error('offline'); return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; },
  });
  return { elements, opened, navigated, setReply: (value: any) => { reply = value; }, fail: () => { fails = true; },
    click: (id: string) => elements[id].handlers.click({ preventDefault() {} }) };
}

describe('GW02 actual LIFF script, provider boundary simulated', () => {
  for (const inClient of [true, false]) it(`waits for a gesture and opens once, LINE=${inClient}`, async () => {
    const h = start(inClient); await settle();
    assert.equal(h.elements['open-web'].hidden, false);
    assert.equal(h.elements.link.disabled, false);
    assert.equal(h.opened.length + h.navigated.length, 0);
    h.click('open-web'); h.click('open-web');
    assert.equal(h.opened.length + h.navigated.length, 1);
    if (inClient) assert.equal(h.opened[0].external, true);
    else assert.equal(h.navigated[0], 'https://app.example.test/l/test-token');
    assert.equal(h.elements['open-web'].hidden, true);
  });
  for (const response of [{ needsSignup: true }, { reason: 'suspended' }, { needsSelection: true, companies: [{ id: 'b', name: '<script>test</script>' }] }]) {
    it(`clears the previous token before ${JSON.stringify(response)}`, async () => {
      const h = start(); await settle(); h.setReply(response); h.click('link'); await settle();
      assert.equal(h.elements['open-web'].hidden, true); h.click('open-web'); assert.equal(h.opened.length, 0);
      assert.equal(h.elements.link.disabled, false);
    });
  }
  it('clears the old token on offline retry', async () => {
    const h = start(); await settle(); h.fail(); h.click('link'); await settle(); h.click('open-web');
    assert.equal(h.elements['open-web'].hidden, true); assert.equal(h.opened.length, 0);
    assert.equal(h.elements.link.disabled, false);
  });
  it('keeps retry available when the client refuses the window', async () => {
    const h = start(true, true); await settle(); h.click('open-web');
    assert.match(h.elements.status.textContent, /ยังเปิดหน้าเว็บไม่ได้/);
    assert.equal(h.elements.link.disabled, false);
  });

  // Review 2026-09-29 (i): the post-signup push opens this page. When the server lands the session on
  // the package page, the button says "เลือกแพ็กเกจ" instead of a bare "เปิดหน้าเว็บ".
  it('labels the button for the package page when the session lands there', async () => {
    const h = start();
    h.setReply({ handoffUrl: 'https://app.example.test/l/test-token', packagePage: true });
    await settle();
    assert.equal(h.elements['open-web'].hidden, false);
    assert.equal(h.elements['open-web'].textContent, 'เลือกแพ็กเกจ');
    assert.match(h.elements.status.textContent, /เลือกแพ็กเกจ/);

    const plain = start(); await settle();
    assert.equal(plain.elements['open-web'].textContent, 'เปิดหน้าเว็บ', 'any other landing keeps its own label');
  });

  // (e): #detail is read by the customer too — a raw English error becomes the one plain sentence.
  it('never shows a raw English error in #detail', async () => {
    const h = start(); await settle(); h.fail(); h.click('link'); await settle();
    assert.equal(h.elements.status.textContent, 'เปิดหน้าเว็บไม่สำเร็จ');
    assert.match(h.elements.detail.textContent, /^ตอนนี้ระบบยังเปิดให้สมัครทางนี้ไม่ได้ค่ะ/);
    assert.doesNotMatch(h.elements.detail.textContent, /offline/);
  });

  // R-C2/R-C3 (§18.2 purchase-without-setup): the picker names a locked shop's state; the server
  // (not this label) decides whether tapping it lands on billing or renew.
  it('labels a locked shop in the picker, leaves an unlocked one plain', async () => {
    const h = start();
    await settle();
    h.setReply({ needsSelection: true, companies: [
      { id: 'co-1', name: 'ร้านหนึ่ง', lockReason: 'no_package', canManagePlan: true },
      { id: 'co-2', name: 'ร้านสอง' },
    ] });
    h.click('link');
    await settle();

    assert.deepEqual(h.elements.companies.children.map((child: any) => child.textContent), [
      'ร้านหนึ่ง · ยังไม่มีแพ็กเกจ', 'ร้านสอง',
    ]);
  });
});
