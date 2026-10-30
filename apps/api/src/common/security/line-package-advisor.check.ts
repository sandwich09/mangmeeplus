import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import type { BillingCatalog, BillingOffer } from '@watchdog-bms/contracts';
import { PACKAGE_ADVISOR_CONTENT, PACKAGE_ADVISOR_SCRIPT, PACKAGE_ADVISOR_STYLE } from './line-package-advisor.page';

const advisorOffer = (input: Partial<BillingOffer> & Pick<BillingOffer, 'offerKey' | 'interval'>): BillingOffer => {
  const { offerKey, interval, ...overrides } = input;
  return {
    offerKey, interval, intervalCount: 1, label: offerKey, priceSatang: 24900, currency: 'THB',
    branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30, receiptAllowance: interval === 'year' ? 360 : 30,
    receiptAllowanceCadence: 'PAID_PERIOD', featureKeys: ['expenses', 'dashboard_notifications', 'employee_access'],
    availability: 'AVAILABLE', reason: null, ...overrides,
  };
};

function advisorCatalog(revision = 'catalog-1', basicPrice = 49900): BillingCatalog {
  return {
    schemaVersion: 1, mode: 'TEST', policyRevision: 'policy-1', catalogRevision: revision,
    generatedAt: '2026-10-30T00:00:00.000Z', validUntil: new Date(Date.now() + 60_000).toISOString(), taxTreatment: 'NOT_VAT_REGISTERED',
    aiMonthlyBudgetSatang: 0,
    offers: [
      advisorOffer({ offerKey: 'STARTER_249', interval: 'month', label: 'เริ่มต้น', priceSatang: 24900, employeeLimit: 2, monthlySlipLimit: 30 }),
      advisorOffer({ offerKey: 'BASIC_499', interval: 'month', label: 'เติบโต', priceSatang: basicPrice, employeeLimit: 5, monthlySlipLimit: 50 }),
      // The advisor's first version is monthly-only even when the catalog also includes annual rows.
      advisorOffer({ offerKey: 'BASIC_499', interval: 'year', label: 'เติบโต', priceSatang: 100, employeeLimit: 5, monthlySlipLimit: 50, receiptAllowance: 600 }),
      advisorOffer({ offerKey: 'PRO_999', interval: 'month', label: 'มืออาชีพ', priceSatang: 99900, employeeLimit: 10, monthlySlipLimit: 100 }),
      advisorOffer({ offerKey: 'ENTERPRISE_1999', interval: 'month', label: 'ธุรกิจ', priceSatang: 199900, employeeLimit: 30, monthlySlipLimit: 500, availability: 'COMING_SOON' }),
    ],
  };
}

class AdvisorElementStub {
  id = '';
  dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  value: number | string = '';
  href = '';
  className = '';
  children: AdvisorElementStub[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, Array<(event: any) => unknown>>();
  classList = { toggle: (_name: string, _value: boolean) => undefined };
  private content = '';
  get textContent() { return this.content; }
  set textContent(value: string) { this.content = value; this.children = []; }
  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  appendChild(child: AdvisorElementStub) { this.children.push(child); return child; }
  replaceChildren(...children: AdvisorElementStub[]) { this.children = children; }
  focus() {}
  click() { for (const listener of this.listeners.get('click') ?? []) listener({ preventDefault() {} }); }
}

function makeAdvisorClient(options: {
  catalogs: unknown[];
  sessions?: unknown[];
  liff?: boolean;
  oaAddUrl?: string;
  apiBase?: string;
}) {
  const ids = ['advisor-status', 'advisor-intro', 'advisor-step', 'advisor-result', 'advisor-empty', 'advisor-progress', 'advisor-progress-label',
    'advisor-question', 'advisor-hint', 'advisor-options', 'advisor-next', 'advisor-back', 'advisor-result-title',
    'advisor-result-reason', 'advisor-offer', 'advisor-billing', 'advisor-edit', 'advisor-support', 'advisor-receipt'];
  const nodes = new Map(ids.map((id) => [id, Object.assign(new AdvisorElementStub(), { id })]));
  const body = Object.assign(new AdvisorElementStub(), { dataset: {
    apiBase: options.apiBase ?? 'https://api.example.test/v1', liffId: '123-test', supportUrl: 'https://lin.ee/6Sc38L6',
    oaAddUrl: options.oaAddUrl ?? 'https://line.me/R/ti/p/%40Uexample', webBase: 'https://app.example.test',
  } });
  const catalogQueue = [...options.catalogs];
  const sessionQueue = [...(options.sessions ?? [])];
  const requests: Array<{ url: string; options?: { body?: string } }> = [];
  const opened: Array<{ url: string; external: boolean }> = [];
  const assigned: string[] = [];
  const line = {
    init: async () => undefined,
    isLoggedIn: () => true,
    isInClient: () => true,
    getIDToken: () => 'header.payload.signature',
    openWindow: (input: { url: string; external: boolean }) => opened.push(input),
    closeWindow: () => undefined,
    login: () => undefined,
  };
  const context = {
    document: {
      body,
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: (_tag: string) => new AdvisorElementStub(),
    },
    fetch: async (url: string, fetchOptions?: { body?: string }) => {
      requests.push({ url, options: fetchOptions });
      if (url.endsWith('/billing/catalog')) {
        const result = catalogQueue.shift();
        if (result === undefined) throw new Error('unexpected catalog request');
        if (result instanceof Error) throw result;
        if ((result as { httpStatus?: number }).httpStatus) return { ok: false, status: 503, json: async () => result };
        return { ok: true, json: async () => result };
      }
      if (url.endsWith('/auth/line/liff/session')) {
        const result = sessionQueue.shift();
        if (result === undefined) throw new Error('unexpected session request');
        return { ok: true, json: async () => result };
      }
      throw new Error('unexpected URL: ' + url);
    },
    window: options.liff ? { liff: line } : {},
    liff: line,
    location: { origin: 'https://api.example.test', href: 'https://api.example.test/v1/auth/line/package-advisor-page', assign: (url: string) => assigned.push(url) },
    URL, URLSearchParams, Intl, Date, Number, Array, String, JSON, Math,
  };
  runInNewContext(PACKAGE_ADVISOR_SCRIPT, context);
  return { nodes, requests, opened, assigned };
}

async function settleAdvisorClient() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function answerQuiz(client: ReturnType<typeof makeAdvisorClient>, values: [number, number, number, number]) {
  for (const choice of values) {
    client.nodes.get('advisor-options')?.children[choice]?.click();
    client.nodes.get('advisor-next')?.click();
  }
}

describe('LINE package advisor client', () => {
  it('keeps radio focus in place and supports arrow-key selection', async () => {
    const client = makeAdvisorClient({ catalogs: [advisorCatalog()] });
    await settleAdvisorClient();
    const first = client.nodes.get('advisor-options')?.children[0];
    first?.click();
    assert.equal(client.nodes.get('advisor-options')?.children[0], first);
    assert.equal(first?.attributes['aria-checked'], 'true');
    const options = client.nodes.get('advisor-options');
    // DOM children is an HTMLCollection, not an Array with indexOf().
    Object.defineProperty(options!.children, 'indexOf', { value: undefined });
    const second = options?.children[1];
    options?.listeners.get('keydown')?.[0]?.({ key: 'ArrowDown', target: first, preventDefault() {} });
    assert.equal(second?.attributes['aria-checked'], 'true');
    assert.equal(client.nodes.get('advisor-next')?.disabled, false);
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-back')?.click();
    assert.equal(client.nodes.get('advisor-options')?.children[1]?.attributes['aria-checked'], 'true');
  });

  it('walks four questions, handles unknown volume, and uses only live monthly prices and limits', async () => {
    const client = makeAdvisorClient({ catalogs: [advisorCatalog(), advisorCatalog()] });
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-step')?.hidden, false);
    assert.match(client.nodes.get('advisor-options')?.children[0]?.textContent ?? '', /1–2 คน/);
    client.nodes.get('advisor-options')?.children[0]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[5]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[0]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[0]?.click();
    client.nodes.get('advisor-next')?.click();
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-result')?.hidden, false);
    assert.equal(client.nodes.get('advisor-result-title')?.textContent, 'เริ่มต้น');
    assert.match(client.nodes.get('advisor-result-reason')?.textContent ?? '', /ยังไม่ระบุจำนวนใบเสร็จ/);
    assert.match(client.nodes.get('advisor-result-reason')?.textContent ?? '', /อยู่ในช่วง 1–2 คน/);
    assert.match(client.nodes.get('advisor-offer')?.textContent ?? '', /249 บาทต่อเดือน/);
    assert.match(client.nodes.get('advisor-offer')?.textContent ?? '', /ประมาณ 30 ใบต่อเดือน/);
  });

  it('shows no recommendation for an over-capacity answer', async () => {
    const client = makeAdvisorClient({ catalogs: [advisorCatalog(), advisorCatalog()] });
    await settleAdvisorClient();
    client.nodes.get('advisor-options')?.children[4]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[4]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[3]?.click();
    client.nodes.get('advisor-next')?.click();
    client.nodes.get('advisor-options')?.children[1]?.click();
    client.nodes.get('advisor-next')?.click();
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-result')?.hidden, true);
    assert.equal(client.nodes.get('advisor-empty')?.hidden, false);
    assert.match(client.nodes.get('advisor-empty')?.textContent ?? '', /ยังไม่พบแพ็กเกจ/);
  });

  it('does not recommend offers that are unavailable in the current catalog', async () => {
    const unavailable = advisorCatalog();
    unavailable.offers = unavailable.offers.map((offer) => ({ ...offer, availability: 'UNAVAILABLE' }));
    const client = makeAdvisorClient({ catalogs: [unavailable, unavailable] });
    await settleAdvisorClient();
    answerQuiz(client, [0, 0, 0, 0]);
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-result')?.hidden, true);
    assert.match(client.nodes.get('advisor-empty')?.textContent ?? '', /ยังไม่พบแพ็กเกจ/);
  });

  it('retries a failed catalog read without inventing a package', async () => {
    const client = makeAdvisorClient({ catalogs: [{ httpStatus: 503 }, advisorCatalog()] });
    await settleAdvisorClient();
    assert.match(client.nodes.get('advisor-empty')?.textContent ?? '', /ยังอ่านข้อมูลแพ็กเกจ/);
    client.nodes.get('advisor-empty')?.children[0]?.click();
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-step')?.hidden, false);
    assert.equal(client.requests.filter((request) => request.url.endsWith('/billing/catalog')).length, 2);
  });

  it('requires a second review if the offer changes before the billing handoff', async () => {
    const client = makeAdvisorClient({ catalogs: [advisorCatalog(), advisorCatalog(), advisorCatalog('catalog-2', 52900), advisorCatalog('catalog-2', 52900)] });
    await settleAdvisorClient();
    answerQuiz(client, [1, 1, 3, 0]);
    await settleAdvisorClient();
    assert.match(client.nodes.get('advisor-offer')?.textContent ?? '', /499 บาทต่อเดือน/);
    assert.match(client.nodes.get('advisor-result-reason')?.textContent ?? '', /อยู่ในช่วง 3–5 คน/);

    client.nodes.get('advisor-billing')?.click();
    await settleAdvisorClient();
    assert.match(client.nodes.get('advisor-offer')?.textContent ?? '', /529 บาทต่อเดือน/);
    assert.match(client.nodes.get('advisor-result-reason')?.textContent ?? '', /อัปเดตข้อมูลแพ็กเกจ/);
    assert.equal(client.requests.some((request) => request.url.endsWith('/auth/line/liff/session')), false);
  });

  it('sends the selected monthly offer through the company picker and rejects a foreign or unexpected handoff path', async () => {
    const token = 'abcdefghijklmnopABCDEFGH12345678';
    const handoff = `https://app.example.test/l/${token}`;
    const client = makeAdvisorClient({ liff: true, catalogs: [advisorCatalog(), advisorCatalog(), advisorCatalog(), advisorCatalog()], sessions: [
      { needsSelection: true, companies: [{ id: 'co-1', name: 'ร้านหนึ่ง' }, { id: 'co-2', name: 'ร้านสอง' }] },
      { handoffUrl: 'https://attacker.example.test/l/' + token },
    ] });
    await settleAdvisorClient();
    answerQuiz(client, [1, 1, 3, 0]);
    await settleAdvisorClient();
    client.nodes.get('advisor-billing')?.click();
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-question')?.textContent, 'เลือกหาร้านที่ต้องการดูแพ็กเกจ');
    assert.deepEqual(client.nodes.get('advisor-options')?.children.map((item) => item.textContent), ['ร้านหนึ่ง', 'ร้านสอง']);
    client.nodes.get('advisor-options')?.children[1]?.click();
    await settleAdvisorClient();
    const posted = client.requests.filter((request) => request.url.endsWith('/auth/line/liff/session')).map((request) => JSON.parse(request.options?.body ?? '{}'));
    assert.deepEqual(posted.map((body) => [body.companyId, body.billingOffer, body.billingInterval]), [
      [undefined, 'BASIC_499', 'month'], ['co-2', 'BASIC_499', 'month'],
    ]);
    assert.equal(client.opened.length, 0);
    assert.match(client.nodes.get('advisor-status')?.textContent ?? '', /ยังเปิดหน้าแพ็กเกจไม่ได้/);
    assert.equal(client.assigned.includes(handoff), false);
  });

  it('opens a valid handoff after selecting a company and keeps the monthly offer', async () => {
    const token = 'abcdefghijklmnopABCDEFGH12345678';
    const handoff = `https://app.example.test/l/${token}`;
    const client = makeAdvisorClient({ liff: true, catalogs: [advisorCatalog(), advisorCatalog(), advisorCatalog(), advisorCatalog()], sessions: [
      { needsSelection: true, companies: [{ id: 'co-1', name: 'ร้านหนึ่ง' }] }, { handoffUrl: handoff },
    ] });
    await settleAdvisorClient();
    answerQuiz(client, [1, 1, 3, 0]);
    await settleAdvisorClient();
    client.nodes.get('advisor-billing')?.click();
    await settleAdvisorClient();
    client.nodes.get('advisor-options')?.children[0]?.click();
    await settleAdvisorClient();
    assert.deepEqual(client.opened.map(({ url, external }) => [url, external]), [[handoff, true]]);
    const posted = client.requests.filter((request) => request.url.endsWith('/auth/line/liff/session')).map((request) => JSON.parse(request.options?.body ?? '{}'));
    assert.deepEqual(posted.map((body) => [body.billingOffer, body.billingInterval]), [
      ['BASIC_499', 'month'], ['BASIC_499', 'month'],
    ]);
  });

  it('rechecks the offer after the company picker and requires another review when it changed', async () => {
    const client = makeAdvisorClient({ liff: true, catalogs: [advisorCatalog(), advisorCatalog(), advisorCatalog(), advisorCatalog('catalog-2', 52900)], sessions: [
      { needsSelection: true, companies: [{ id: 'co-1', name: 'ร้านหนึ่ง' }] },
    ] });
    await settleAdvisorClient();
    answerQuiz(client, [1, 1, 3, 0]);
    await settleAdvisorClient();
    client.nodes.get('advisor-billing')?.click();
    await settleAdvisorClient();
    client.nodes.get('advisor-options')?.children[0]?.click();
    await settleAdvisorClient();
    assert.equal(client.requests.filter((request) => request.url.endsWith('/auth/line/liff/session')).length, 1);
    assert.match(client.nodes.get('advisor-offer')?.textContent ?? '', /529 บาทต่อเดือน/);
    assert.match(client.nodes.get('advisor-result-reason')?.textContent ?? '', /อัปเดตข้อมูลแพ็กเกจ/);
    assert.equal(client.nodes.get('advisor-result')?.hidden, false);
  });

  it('opens only the configured support and receipt channels from the public form', async () => {
    const client = makeAdvisorClient({ catalogs: [advisorCatalog()], oaAddUrl: 'https://line.me/R/ti/p/%40Uexample' });
    await settleAdvisorClient();
    assert.equal(client.nodes.get('advisor-support')?.href, 'https://lin.ee/6Sc38L6');
    client.nodes.get('advisor-receipt')?.click();
    assert.deepEqual(client.assigned, ['https://line.me/R/ti/p/%40Uexample']);
  });

  it('keeps the assessment self-contained, monthly-only, and without executable inline markup', () => {
    assert.ok(PACKAGE_ADVISOR_CONTENT.includes('<img class="advisor-mascot"'));
    assert.ok(PACKAGE_ADVISOR_CONTENT.includes('advisor-options'));
    assert.ok(!PACKAGE_ADVISOR_CONTENT.includes('advisor-interval'));
    assert.ok(PACKAGE_ADVISOR_STYLE.includes('@media(max-width:380px)'));
    assert.ok(!PACKAGE_ADVISOR_SCRIPT.includes('<script'));
    assert.ok(!PACKAGE_ADVISOR_CONTENT.includes('➡') && !PACKAGE_ADVISOR_CONTENT.includes('👉'));
  });
});
