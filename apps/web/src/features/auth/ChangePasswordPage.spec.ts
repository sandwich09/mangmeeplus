import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function render(props: { homePath?: string | null } = {}): Promise<string> {
  const { default: ChangePasswordPage } = await import('./ChangePasswordPage');
  return renderToStaticMarkup(React.createElement(ChangePasswordPage, props));
}

describe('ChangePasswordPage exits', () => {
  // A temporary-password session is bounced back here from every business route, so this escape
  // hatch is the only way off the page for someone who changed their mind. Losing it re-creates
  // the UAT trap where neither the URL bar nor the back button could leave.
  it('always offers a way off the page', async () => {
    assert.match(await render(), /ยกเลิกและออกจากระบบ/);
  });

  it('offers the home link only when the session may navigate away', async () => {
    const free = await render({ homePath: '/companies/c1/dashboard' });
    assert.match(free, /กลับหน้าหลัก/);
    assert.match(free, /href="\/companies\/c1\/dashboard"/);

    // Blocked session: a home link would just bounce back here, so it is not offered.
    assert.doesNotMatch(await render({ homePath: null }), /กลับหน้าหลัก/);
  });
});

// A date-of-birth temporary password is DDMMYYYY — 8 characters — so the minimum-length rule
// accepted it as the "new" password too, and the account stayed on the employer-issued password.
describe('ChangePasswordPage new-password rules', () => {
  it('names the reuse rule in both locales', async () => {
    const { workspaceDictionary } = await import('@/common/i18n/workspace-dictionary');
    assert.equal(workspaceDictionary.th['auth.change.error.same'], 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    assert.match(workspaceDictionary.en['auth.change.error.same'], /different/);
  });
});
