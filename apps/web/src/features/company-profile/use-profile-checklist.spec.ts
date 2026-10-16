import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
import { checklistCacheKey, profileChecklist, writeChecklistCache } from './company-profile.logic';
import { COMPANY_PROFILE_CHANGED_EVENT } from '../web-core-workspace/workspace-scope.api';
const api = mutable('@/features/company-profile/company-profile.api');
const { useProfileChecklist } = require('./use-profile-checklist');

test('a mounted cached checklist refreshes immediately after a shop save and stops listening on unmount', async () => {
  const oldWindow = globalThis.window;
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const target = Object.assign(new EventTarget(), { sessionStorage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  writeChecklistCache(sessionStorage, 'co', profileChecklist({ readiness: { identity: { complete: false, reasons: ['tax_id_missing'] } }, emailVerified: true, hasPassword: true }));
  const identity = mock.method(api, 'getCompanyIdentity', async () => ({ readiness: { identity: { complete: true, reasons: [] } } }));
  const account = mock.method(api, 'getAccountProfile', async () => ({ emailVerified: true, hasPassword: true }));
  function Checklist() { const items = useProfileChecklist('co'); return h('p', null, JSON.stringify(items)); }
  const view = certificateHarness(() => h(Checklist));
  try {
    view.render(true); await view.settle();
    assert.equal(identity.mock.callCount(), 0);
    target.dispatchEvent(new Event(COMPANY_PROFILE_CHANGED_EVENT)); await view.settle();
    assert.equal(identity.mock.callCount(), 1);
    assert.ok((view.state[0] as any[]).every(item => item.done));
    assert.ok(JSON.parse(storage.get(checklistCacheKey('co'))!).items.every((item: any) => item.done));
    view.cleanup(); target.dispatchEvent(new Event(COMPANY_PROFILE_CHANGED_EVENT)); await view.settle();
    assert.equal(identity.mock.callCount(), 1);
  } finally { view.cleanup(); identity.mock.restore(); account.mock.restore(); Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow }); }
});
