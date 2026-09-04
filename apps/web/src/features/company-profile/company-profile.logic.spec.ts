import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checklistIsComplete,
  companyProfileHref,
  identityChangeKind,
  isThaiMobileInput,
  isThaiTaxIdInput,
  profileChecklist,
} from './company-profile.logic';
import { SETTINGS_MENU_ITEMS } from '../web-core-workspace/settings-menu.logic';
import { canSeeRoute, findRoutePermissionRule } from '../web-core-workspace/route-permissions';

const OPEN = { captureWindowOpen: true, authoritativeLatched: false, fieldLatched: { registeredName: false, addressJson: false } };
const CLOSED = { ...OPEN, captureWindowOpen: false };

describe('identityChangeKind mirrors the server table', () => {
  it('treats every edit as capture while the window is open', () => {
    for (const fields of [['taxId'], ['registeredName'], ['addressJson'], ['taxId', 'addressJson']] as const) {
      assert.equal(identityChangeKind(OPEN, fields), 'INITIAL_CAPTURE', fields.join('+'));
    }
    // Even a latched field: the window, not the latch, decides while it is open.
    assert.equal(
      identityChangeKind({ ...OPEN, authoritativeLatched: true, fieldLatched: { registeredName: true, addressJson: true } }, ['registeredName']),
      'INITIAL_CAPTURE',
    );
  });

  it('makes a closed-window tax id change a legal change, never a correction', () => {
    assert.equal(identityChangeKind(CLOSED, ['taxId']), 'LEGAL_CHANGE');
    assert.equal(identityChangeKind(CLOSED, ['taxId', 'registeredName']), 'LEGAL_CHANGE');
  });

  it('escalates once the identity or the field itself is established', () => {
    assert.equal(identityChangeKind({ ...CLOSED, authoritativeLatched: true }, ['registeredName']), 'LEGAL_CHANGE');
    assert.equal(
      identityChangeKind({ ...CLOSED, fieldLatched: { registeredName: true, addressJson: false } }, ['registeredName']),
      'LEGAL_CHANGE',
    );
    // A latch on the *other* field does not escalate this one.
    assert.equal(
      identityChangeKind({ ...CLOSED, fieldLatched: { registeredName: true, addressJson: false } }, ['addressJson']),
      'CORRECTION',
    );
  });

  it('falls back to the lighter kind for an ordinary closed-window edit', () => {
    assert.equal(identityChangeKind(CLOSED, ['registeredName']), 'CORRECTION');
    assert.equal(identityChangeKind(CLOSED, ['addressJson']), 'CORRECTION');
  });
});

describe('profileChecklist', () => {
  const complete = { readiness: { identity: { complete: true, reasons: [] } }, emailVerified: true, hasPassword: true };

  it('hides itself only when all four are done', () => {
    assert.equal(checklistIsComplete(profileChecklist(complete)), true);
    for (const partial of [
      { ...complete, emailVerified: false },
      { ...complete, hasPassword: false },
      { ...complete, readiness: { identity: { complete: false, reasons: ['tax_id_missing'] } } },
      { ...complete, readiness: { identity: { complete: false, reasons: ['company_address_incomplete'] } } },
    ]) {
      assert.equal(checklistIsComplete(profileChecklist(partial)), false, JSON.stringify(partial));
    }
  });

  it('maps each server readiness reason to the item that fixes it', () => {
    for (const reason of ['tax_id_missing', 'tax_id_invalid', 'registered_name_missing']) {
      const items = profileChecklist({ ...complete, readiness: { identity: { complete: false, reasons: [reason] } } });
      assert.equal(items.find((item) => item.key === 'identity')!.done, false, reason);
      assert.equal(items.find((item) => item.key === 'address')!.done, true, reason);
    }
    const address = profileChecklist({ ...complete, readiness: { identity: { complete: false, reasons: ['company_address_incomplete'] } } });
    assert.equal(address.find((item) => item.key === 'address')!.done, false);
    assert.equal(address.find((item) => item.key === 'identity')!.done, true);
  });

  // The spec lists four items. VAT is asked on the page but is not one of them, so an unanswered
  // VAT question must never be what keeps the card on screen forever.
  it('ignores the unanswered VAT reason', () => {
    const items = profileChecklist({ ...complete, readiness: { identity: { complete: false, reasons: ['vat_status_unanswered'] } } });
    assert.equal(checklistIsComplete(items), true);
  });

  it('treats a readiness block the caller could not read as nothing missing', () => {
    assert.equal(checklistIsComplete(profileChecklist({ readiness: undefined, emailVerified: true, hasPassword: true })), true);
  });

  it('links every item at the page section that fixes it', () => {
    for (const item of profileChecklist(complete)) {
      assert.ok(['#shop', '#account'].includes(item.hash), item.key);
      assert.equal(companyProfileHref('c-1', item.hash), `/companies/c-1/settings/profile${item.hash}`);
    }
  });
});

describe('field validation matches the API', () => {
  it('accepts a Thai mobile however it is spaced, and nothing else', () => {
    for (const good of ['0812345678', '081-234-5678', '081 234 5678']) assert.equal(isThaiMobileInput(good), true, good);
    for (const bad of ['12345', '0812345', '66812345678', '081234567890', '']) assert.equal(isThaiMobileInput(bad), false, bad);
  });

  it('accepts a 13-digit tax id and nothing else', () => {
    assert.equal(isThaiTaxIdInput('0105558123456'), true);
    assert.equal(isThaiTaxIdInput('0-1055-58123-45-6'), true);
    for (const bad of ['12345', '01055581234567', '']) assert.equal(isThaiTaxIdInput(bad), false, bad);
  });
});

describe('the profile route is reachable and dynamic', () => {
  it('is on the settings menu behind a registered permission rule', () => {
    const item = SETTINGS_MENU_ITEMS.find((entry) => entry.href === '/settings/profile');
    assert.ok(item, 'the settings menu must carry the profile card');
    assert.equal(item.title, 'ข้อมูลร้านและบัญชีของฉัน');
    assert.deepEqual(findRoutePermissionRule('/settings/profile')?.anyOf, ['company.setup.read']);
    assert.equal(canSeeRoute('/settings/profile', ['company.setup.read']), true);
    assert.equal(canSeeRoute('/settings/profile', ['expense.read']), false);
  });

  // CSP nonce vs prerender: a prerendered workspace page ships without the nonce and renders dead.
  it('declares force-dynamic on the route file', () => {
    const page = readFileSync(
      new URL('../../../app/(workspace)/companies/[companyId]/settings/profile/page.tsx', import.meta.url),
      'utf8',
    );
    assert.match(page, /export const dynamic = 'force-dynamic';/);
    assert.match(page, /requireRoutePermission\(session, '\/settings\/profile'\)/);
  });
});

describe('the page and card render what the slice promises', () => {
  const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('./ProfileCompletenessCard.tsx', import.meta.url), 'utf8');

  it('has both sections, anchored so the checklist can link into them', () => {
    assert.match(page, /id="shop"[\s\S]*?title="ข้อมูลร้าน"/);
    assert.match(page, /id="account"[\s\S]*?title="บัญชีของฉัน"/);
    for (const label of ['ชื่อจดทะเบียน', 'เลขผู้เสียภาษี', 'เบอร์มือถือ', 'ตั้งรหัสผ่านสำรอง']) {
      assert.ok(page.includes(label), label);
    }
  });

  it('handles loading, load failure and a caller who may not un-mask the shop block', () => {
    assert.match(page, /if \(loading\) \{[\s\S]*?LoadingState/);
    assert.match(page, /if \(loadError\) \{/);
    assert.match(page, /const canEditShop = full !== null;/);
    assert.match(page, /\{canEditShop && \(\s*<button/);
  });

  it('sends the current password only when the account actually has one', () => {
    assert.match(page, /account\?\.hasPassword \? emailPassword : undefined/);
    assert.match(page, /account\?\.hasPassword \? \([\s\S]*?change-password/);
  });

  it('is honest about a mailer that may not deliver, and offers merge on a taken mailbox', () => {
    assert.match(page, /ถ้าไม่ได้รับอีเมล ติดต่อทีมงาน/);
    assert.match(page, /emailErrorCode === 'email_belongs_to_other_account'/);
  });

  it('keeps the card non-blocking: nothing while loading, nothing when done, nothing on failure', () => {
    assert.match(card, /if \(!items \|\| checklistIsComplete\(items\)\) return null;/);
    assert.match(card, /\.catch\(\(\) => \{ if \(!cancelled\) setItems\(null\); \}\)/);
    assert.match(card, /items\.filter\(\(item\) => !item\.done\)/);
  });

  // OWNER-only per spec §15.4, expressed as the permission only OWNER holds today.
  it('shows the card on the dashboard only to a holder of the identity authority', () => {
    const dashboard = readFileSync(new URL('../dashboard-notifications/DashboardPages.tsx', import.meta.url), 'utf8');
    assert.match(
      dashboard,
      /\{permissions\.includes\('company\.legal_identity\.manage'\) && <ProfileCompletenessCard companyId=\{companyId\} \/>\}/,
    );
  });
});
