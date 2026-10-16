import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
require.extensions['.svg'] = module => { module.exports = () => null; };
const api = mutable('../tax/tax.api');
const { WhtPayerModeSettings, withholdingReturn, offeredPayerMonth } = require('./WhtPayerModeSettings');
const fact = { periodKey: '2026-10', mode: 'HEAD_OFFICE_PAYS_ALL', asked: true, firstAllowedPeriodKey: '2026-10' };
function view(canAnswer = true) {
  return certificateHarness(() => h(WhtPayerModeSettings, { companyId: 'co', canAnswer, returnHref: '/companies/co/tax/withholding?periodKey=2026-10', onMode: () => {} }),
    [fact, 'HEAD_OFFICE_PAYS_ALL', '2026-10', false, '', '', false, '']);
}
test('only fixed withholding origin and valid month produce a return link', () => {
  assert.equal(withholdingReturn('?from=https://evil.test&periodKey=2026-10', 'co'), null);
  assert.equal(withholdingReturn('?from=withholding&periodKey=2026-13', 'co'), null);
  assert.equal(withholdingReturn('?from=withholding&periodKey=2026-10', 'co'), '/companies/co/tax/withholding?periodKey=2026-10');
  assert.equal(offeredPayerMonth({ details: { firstAllowedPeriodKey: '2026-11' } }), '2026-11');
  assert.equal(offeredPayerMonth({ details: { firstAllowedPeriodKey: 'bad' } }), null);
});
test('reader sees the current answer as a fact, no answer controls', () => {
  const v = view(false);
  try { const html = v.render(); assert.match(html, /สำนักงานใหญ่จ่ายทั้งหมด/); assert.doesNotMatch(html, /บันทึกวิธีจ่าย|ใช้ตั้งแต่เดือน/);
    v.state[0] = { ...fact, mode: null }; assert.match(v.render(), /ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก/);
  } finally { v.cleanup(); }
});
test('answer saves the selected month and gives the same-month return after success', async () => {
  const call = mock.method(api, 'answerWhtPayerMode', async (_company: string, answer: any) => ({ ...fact, mode: answer.mode, periodKey: answer.effectiveFromPeriodKey }));
  const v = view();
  try {
    v.render(); v.find('SelectField').onChange({ target: { value: 'EACH_BRANCH_PAYS' } });
    v.render(); v.find('form').onSubmit({ preventDefault() {} }); await v.settle();
    assert.deepEqual(call.mock.calls[0].arguments, ['co', { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-10' }]);
    v.state.length = 8; // Reset child hook slots after the success link appears.
    assert.match(v.render(), /บันทึกวิธีจ่ายแล้ว ใช้ตั้งแต่เดือน ต.ค. 2569/); assert.match(v.render(), /กลับไปภาษีหัก ณ ที่จ่าย/);
  } finally { call.mock.restore(); v.cleanup(); }
});
test('filed-month refusal puts the offered month in the field, keeps the answer and shows the reason', async () => {
  const call = mock.method(api, 'answerWhtPayerMode', async () => { throw { code: 'WHT_PAYER_MODE_FILED', details: { firstAllowedPeriodKey: '2026-11' } }; });
  const v = view();
  try {
    v.render(); v.find('form').onSubmit({ preventDefault() {} }); v.render(); assert.equal(v.find('button', p => p.type === 'submit')['aria-busy'], true);
    await v.settle(); const html = v.render(); assert.equal(v.find('ThemedDate').value, '2026-11');
    assert.equal(v.find('SelectField').value, 'HEAD_OFFICE_PAYS_ALL'); assert.match(html, /มีแบบที่ยื่นแล้วในช่วงที่เลือก/);
  } finally { call.mock.restore(); v.cleanup(); }
});

test('payer month uses the shared Thai Buddhist month chooser', () => {
  const v = view();
  try { const html = v.render(); assert.equal(v.find('ThemedDate').mode, 'month'); assert.match(html, /ต.ค. 2569/); assert.doesNotMatch(html, /type="month"/); }
  finally { v.cleanup(); }
});

test('save waits for the initial read and cannot submit while it is loading', async () => {
  let finish!: (value: any) => void;
  const read = mock.method(api, 'getWhtPayerMode', () => new Promise(resolve => { finish = resolve; }));
  const answer = mock.method(api, 'answerWhtPayerMode', async () => fact);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  const v = certificateHarness(() => h(WhtPayerModeSettings, { companyId: 'co', canAnswer: true, returnHref: null, onMode() {} }));
  try {
    v.render(true);
    assert.equal(v.find('button', p => p.type === 'submit').disabled, true);
    assert.equal(v.find('button', p => p.type === 'submit')['aria-busy'], true);
    v.find('form').onSubmit({ preventDefault() {} });
    assert.doesNotMatch(v.render(), /เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก/);
    assert.equal(answer.mock.callCount(), 0);
    finish(fact); await v.settle(); v.render();
    assert.equal(v.find('button', p => p.type === 'submit').disabled, false);
    assert.equal(v.find('button', p => p.type === 'submit')['aria-busy'], false);
  } finally {
    v.cleanup(); read.mock.restore(); answer.mock.restore();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('read retry owns its error and never clears press feedback; editing clears it', async () => {
  let finish!: (value: any) => void;
  let count = 0;
  const read = mock.method(api, 'getWhtPayerMode', () => ++count === 1 ? Promise.reject({ kind: 'network_error' }) : new Promise(resolve => { finish = resolve; }));
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  const v = certificateHarness(() => h(WhtPayerModeSettings, { companyId: 'co', canAnswer: true, returnHref: null, onMode() {} }));
  const validation = 'เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก';
  try {
    v.render(true); await v.settle(); v.render();
    v.find('form').onSubmit({ preventDefault() {} });
    let html = v.render();
    assert.equal((html.match(/role="alert"/g) ?? []).length, 2);
    assert.match(html, new RegExp(`>⚠ ${validation}</div>`));
    v.find('button', p => p.children.includes('ลองอีกครั้ง')).onClick(); html = v.render();
    assert.match(html, new RegExp(validation));
    assert.equal(v.find('button', p => p.type === 'submit').disabled, true);
    assert.equal(v.find('button', p => p.type === 'submit')['aria-busy'], true);
    finish({ ...fact, mode: null }); await v.settle(); html = v.render();
    assert.match(html, new RegExp(validation)); assert.doesNotMatch(html, />ลองอีกครั้ง<\/button>/);
    assert.equal(read.mock.callCount(), 2);
    v.find('ThemedDate').onChange({ target: { value: '2026-11' } }); assert.doesNotMatch(v.render(), new RegExp(validation));
    v.find('form').onSubmit({ preventDefault() {} }); assert.match(v.render(), new RegExp(validation));
    v.find('SelectField').onChange({ target: { value: 'EACH_BRANCH_PAYS' } }); assert.doesNotMatch(v.render(), new RegExp(validation));
  } finally {
    v.cleanup(); read.mock.restore();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});
