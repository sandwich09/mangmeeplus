import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { certificateHarness, h, mutable } from '@/features/expenses/expense-certificate-test-harness';

require.extensions['.svg'] = module => { module.exports = () => null; };
const modal = mutable('@/common/components/modal');
const sales = mutable('@/features/sales-console/sales.api');
const { SalesDemoLinkDialog } = require('./SalesDemoLinkDialog');
const SalesDealsPage = require('./SalesDealsPage').default;
const link = { url: 'https://mangmeeplus.com/d/demo-token', expiresAt: '2026-11-09T05:30:00.000Z', aiCredit: 50 };
afterEach(() => mock.restoreAll());

function inlineModal() {
  mock.method(modal, 'Modal', (props: any) => h('section', { role: 'dialog' }, h('h2', null, props.title), props.children, props.footer));
}

test('sales action opens credit field at 80 before creating, then shows returned credit and expiry', async () => {
  inlineModal();
  let resolve!: (value: typeof link) => void;
  const create = mock.method(sales, 'createSalesDemoLink', () => new Promise<typeof link>(done => { resolve = done; }));
  const view = certificateHarness(() => h(SalesDealsPage));
  view.render();
  const button = view.find('button', props => props.children.includes('สร้างลิงก์เดโม่'));
  assert.match(button.className, /mangmee-btn-secondary/);
  button.onClick();
  assert.match(view.render(), /เครดิต AI ของลิงก์นี้/);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(view.find('input', props => props.type === 'number').value, '50');
  const submit = view.find('button', props => props.className.includes('mangmee-btn-primary') && props.children.includes('สร้างลิงก์เดโม่'));
  submit.onClick(); submit.onClick();
  view.render();
  assert.equal(view.find('button', props => props['aria-busy'] === true).disabled, true);
  resolve(link);
  await view.settle();
  const html = view.render();
  assert.equal(create.mock.callCount(), 1);
  assert.equal(create.mock.calls[0].arguments[0], 50);
  assert.match(html, /https:\/\/mangmeeplus.com\/d\/demo-token/);
  assert.match(html, /9 พ.ย. 2569 12:30 น. \(3 วัน\) · เครดิต 50/);
  assert.equal(view.find('input', props => props.value === link.url).readOnly, true);
});

for (const value of ['', '0', '301', '2.5', '-1', '1e2', 'abc']) test(`credit rejects ${JSON.stringify(value)} with one field message and no API call`, () => {
  inlineModal();
  const create = mock.method(sales, 'createSalesDemoLink', async () => link);
  const view = certificateHarness(() => h(SalesDemoLinkDialog, { onClose() {} }));
  view.render();
  view.find('input', props => props.type === 'number').onChange({ target: { value } });
  view.render();
  view.find('button', props => props.children.includes('สร้างลิงก์เดโม่')).onClick();
  assert.match(view.render(), /กรอกเครดิต AI ของลิงก์นี้เป็นจำนวนเต็มตั้งแต่ 1 ถึง 300/);
  assert.equal(view.find('input', props => props.type === 'number')['aria-invalid'], true);
  assert.equal(create.mock.callCount(), 0);
});

for (const aiCredit of [1, 300]) test(`credit accepts boundary ${aiCredit} and displays server value`, async () => {
  inlineModal();
  const create = mock.method(sales, 'createSalesDemoLink', async () => ({ ...link, aiCredit }));
  const view = certificateHarness(() => h(SalesDemoLinkDialog, { onClose() {} }));
  view.render();
  view.find('input', props => props.type === 'number').onChange({ target: { value: String(aiCredit) } });
  view.render();
  view.find('button', props => props.children.includes('สร้างลิงก์เดโม่')).onClick();
  await view.settle();
  assert.equal(create.mock.calls[0].arguments[0], aiCredit);
  assert.match(view.render(), new RegExp(`เครดิต ${aiCredit}`));
});

test('copy uses returned URL and shows copied wording while keeping the dialog', async () => {
  inlineModal();
  const writeText = mock.fn(async (_value: string) => undefined);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
  try {
    const view = certificateHarness(() => h(SalesDemoLinkDialog, { link, onClose() {} }));
    view.render();
    view.find('button', props => props.children.includes('คัดลอกลิงก์')).onClick();
    await view.settle();
    assert.equal(writeText.mock.calls[0].arguments[0], link.url);
    assert.match(view.render(), /คัดลอกแล้ว/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('creation failure retains the entered credit for retry', async () => {
  inlineModal();
  mock.method(sales, 'createSalesDemoLink', async () => { throw new Error('offline'); });
  const view = certificateHarness(() => h(SalesDemoLinkDialog, { onClose() {} }));
  view.render();
  view.find('input', props => props.type === 'number').onChange({ target: { value: '120' } });
  view.render();
  view.find('button', props => props.children.includes('สร้างลิงก์เดโม่')).onClick();
  await view.settle();
  assert.match(view.render(), /role="alert"/);
  assert.equal(view.find('input', props => props.type === 'number').value, '120');
});

test('creation API posts default or configured integer credit through the sales BFF', async () => {
  const calls: any[] = [];
  mock.method(globalThis, 'fetch', async (input: any, init: any) => { calls.push({ input, init }); return Response.json(link, { status: 201 }); });
  assert.deepEqual(await sales.createSalesDemoLink(), link);
  await sales.createSalesDemoLink(125);
  assert.equal(calls[0].input, '/api/v1/sales/demo-links');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"aiCredit":50}');
  assert.equal(calls[1].init.body, '{"aiCredit":125}');
});
