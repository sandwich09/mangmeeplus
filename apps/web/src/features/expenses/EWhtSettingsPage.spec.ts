import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.svg'] = module => { module.exports = () => null; };
(globalThis as any).self = globalThis;
const api = mutable('./expenses.api');
const toast = mutable('@/common/components/toast');
const { EWhtSettingsPage } = require('./EWhtSettingsPage');

test('setting read failure shows retry, then choices save a boolean and the specified toast', async () => {
  let failRead = true, failSave = true;
  const read = mock.method(api, 'getExpenseEWhtSetting', async () => { if (failRead) throw new Error('โหลดไม่สำเร็จ ลองอีกครั้ง'); return { used: false }; });
  const write = mock.method(api, 'updateExpenseEWhtSetting', async (_company: string, input: any) => { if (failSave) throw new Error('บันทึกไม่สำเร็จ ลองอีกครั้ง'); return input; });
  const success = mock.fn();
  const notify = mock.method(toast, 'useToast', () => ({ success }));
  const view = certificateHarness(() => h(EWhtSettingsPage, { companyId: 'co' }));
  try {
    view.render(true); await view.settle();
    assert.match(view.render(), /ลองอีกครั้ง/); assert.doesNotMatch(view.render(), /type="radio"/);
    failRead = false; view.find('button', p => p.children.includes('ลองอีกครั้ง')).onClick(); await view.settle(); view.render();
    view.nodes.find(n => n.props.label === E_WHT_WORDS['S-4'].yes)!.props.onChange(); view.render();
    view.find('form').onSubmit({ preventDefault() {} }); view.render();
    assert.equal(view.find('button', p => p.children.includes('บันทึก'))['aria-busy'], true);
    await view.settle(); assert.match(view.render(), /บันทึกไม่สำเร็จ/);
    assert.equal(view.nodes.find(n => n.props.label === E_WHT_WORDS['S-4'].yes)!.props.checked, true);
    failSave = false; view.find('form').onSubmit({ preventDefault() {} }); await view.settle(); view.render();
    assert.deepEqual(write.mock.calls[1].arguments, ['co', { used: true }]);
    assert.deepEqual(success.mock.calls.at(-1)?.arguments, [E_WHT_WORDS['S-6']]);
    view.nodes.find(n => n.props.label === E_WHT_WORDS['S-4'].no)!.props.onChange(); view.render();
    view.find('form').onSubmit({ preventDefault() {} }); await view.settle(); view.render();
    assert.deepEqual(success.mock.calls.at(-1)?.arguments, [E_WHT_WORDS['S-7']]);
    const source = readFileSync(new URL('./EWhtSettingsPage.tsx', import.meta.url), 'utf8');
    assert.match(source, /FormActionBar/); assert.doesNotMatch(source, /max-w-/);
  } finally { view.cleanup(); read.mock.restore(); write.mock.restore(); notify.mock.restore(); }
});

test('free settings route exits before rendering the request-making page', () => {
  const route = readFileSync(new URL('../../../app/(workspace)/companies/[companyId]/settings/e-wht/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /session\?\.freeExpenseDrafts\) redirect/);
  assert.ok(route.indexOf('session?.freeExpenseDrafts') < route.indexOf('return <EWhtSettingsPage'));
  assert.match(route, /requireRoutePermission\(session, '\/settings\/e-wht'\)/);
});
