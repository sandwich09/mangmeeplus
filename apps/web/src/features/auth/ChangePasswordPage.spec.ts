import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function render(props: { homePath?: string | null; isForcedPasswordChange?: boolean; canSkipCurrentPassword?: boolean } = {}): Promise<string> {
  const { default: ChangePasswordPage } = await import('./ChangePasswordPage');
  return renderToStaticMarkup(React.createElement(ChangePasswordPage, props));
}

describe('ChangePasswordPage exits', () => {
  // A temporary-password session is bounced back here from every business route, so this escape
  // hatch is the only way off the page for someone who changed their mind. Losing it re-creates
  // the UAT trap where neither the URL bar nor the back button could leave.
  it('always offers a way off the page', async () => {
    // One way out per variant (thai-ux-standard §2.6): a blocked session signs out, a free one cancels.
    assert.match(await render(), />ออกจากระบบ</);
    assert.match(await render({ homePath: '/companies/c1/dashboard' }), />ยกเลิก</);
  });

  it('offers the home link only when the session may navigate away', async () => {
    const free = await render({ homePath: '/companies/c1/dashboard' });
    assert.match(free, /<a[^>]*href="\/companies\/c1\/dashboard"[^>]*>ยกเลิก<\/a>/);
    // A session that may leave is not offered sign-out in place of cancelling.
    assert.doesNotMatch(free, />ออกจากระบบ</);

    // Blocked session: a home link would just bounce back here, so it is not offered.
    assert.doesNotMatch(await render({ homePath: null }), />ยกเลิก</);
  });

  it('distinguishes a voluntary change from the forced temporary-password journey', async () => {
    assert.match(await render({ homePath: '/companies/c1/dashboard' }), /เปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่/);
    assert.doesNotMatch(await render({ homePath: '/companies/c1/dashboard' }), /ต้องเปลี่ยนรหัสผ่านชั่วคราว/);
    assert.match(await render({ homePath: null, isForcedPasswordChange: true }), /ต้องเปลี่ยนรหัสผ่านชั่วคราว/);
  });

  it('shows new and confirm fields for a password-verified forced change', async () => {
    const forced = await render({ isForcedPasswordChange: true, canSkipCurrentPassword: true });
    assert.doesNotMatch(forced, /name="current-password"/);
    assert.match(forced, /name="new-password"/);
    assert.match(forced, /name="confirm-password"/);
  });

  it('keeps current-password reauthentication for an ordinary change', async () => {
    const ordinary = await render({ homePath: '/companies/c1/dashboard' });
    assert.match(ordinary, /name="current-password"/);
    assert.match(ordinary, /name="confirm-password"/);
  });
});

// A date-of-birth temporary password is DDMMYYYY — 8 characters — so the minimum-length rule
// accepted it as the "new" password too, and the account stayed on the employer-issued password.
describe('ChangePasswordPage new-password rules', () => {
  it('localizes the specific wrong-current-password code without relabeling a genuine 401', async () => {
    const { localizedErrorMessage } = await import('@/common/i18n/error-message.logic');
    const overrides = {
      fallback: 'auth.change.error.failed',
      conflictCodes: {
        current_password_incorrect: 'auth.change.error.current',
        password_reuse: 'auth.change.error.same',
      },
    } as const;
    const wrongPassword = { statusCode: 400, code: 'current_password_incorrect' };
    assert.equal(localizedErrorMessage(wrongPassword, 'th', overrides), 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    assert.equal(localizedErrorMessage(wrongPassword, 'en', overrides), 'Current password is incorrect.');
    assert.equal(localizedErrorMessage({ statusCode: 401 }, 'th', overrides), 'การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่');
  });

  it('names the reuse rule in both locales', async () => {
    const { workspaceDictionary } = await import('@/common/i18n/workspace-dictionary');
    assert.equal(workspaceDictionary.th['auth.change.error.same'], 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    assert.match(workspaceDictionary.en['auth.change.error.same'], /different/);
  });
});
