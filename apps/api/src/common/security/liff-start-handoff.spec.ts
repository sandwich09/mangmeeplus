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
});
