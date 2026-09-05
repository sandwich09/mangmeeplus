import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addressChanged,
  addressErrorMessages,
  buildIdentityPatch,
  checklistIsComplete,
  companyProfileHref,
  dismissChecklist,
  identityChangeKind,
  isThaiMobileInput,
  isThaiTaxIdInput,
  passwordFormError,
  profileChecklist,
  readChecklistCache,
  usernameFieldRequired,
  writeChecklistCache,
  CHECKLIST_CACHE_TTL_MS,
} from './company-profile.logic';
import { SETTINGS_MENU_ITEMS } from '../web-core-workspace/settings-menu.logic';
import { canSeeRoute, findRoutePermissionRule } from '../web-core-workspace/route-permissions';

const OPEN = { captureWindowOpen: true, authoritativeLatched: false, fieldLatched: { registeredName: false, addressJson: false } };
const CLOSED = { ...OPEN, captureWindowOpen: false };
const BLANK_ADDRESS = { line1: '', line2: '', subdistrict: '', district: '', province: '', postalCode: '' };
const FULL_ADDRESS = {
  line1: '99/1 ถนนสุขุมวิท', line2: '', subdistrict: 'คลองเตย',
  district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
};

describe('identityChangeKind mirrors the server table', () => {
  it('treats every edit as capture while the window is open', () => {
    for (const fields of [['taxId'], ['registeredName'], ['addressJson'], ['taxId', 'addressJson']] as const) {
      assert.equal(identityChangeKind(OPEN, fields), 'INITIAL_CAPTURE', fields.join('+'));
    }
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

// F2: the exact request body, because the fields it OMITS are what the bug was made of.
describe('buildIdentityPatch', () => {
  const control = { ...OPEN, legalIdentityVersion: 3 };

  it('saves a tax id alone on a fresh shop, without dragging a blank address into it', () => {
    const result = buildIdentityPatch(control, null, { registeredName: '', taxId: '0105558123456', address: BLANK_ADDRESS });
    assert.ok('body' in result, 'a fresh shop entering only its tax id must be savable');
    assert.deepEqual(result.body, {
      expectedLegalIdentityVersion: 3,
      changeKind: 'INITIAL_CAPTURE',
      taxId: '0105558123456',
    });
    assert.equal('addressJson' in result.body, false, 'an all-blank address is not an edit');
    assert.equal('registeredName' in result.body, false, 'an untouched field must not travel');
  });

  it('sends the address once any box is filled, trimmed, with line2 nulled when empty', () => {
    const result = buildIdentityPatch(control, null, { registeredName: '', taxId: '', address: { ...FULL_ADDRESS, line1: '  99/1 ถนนสุขุมวิท  ' } });
    assert.ok('body' in result);
    assert.deepEqual(result.body['addressJson'], {
      line1: '99/1 ถนนสุขุมวิท', line2: null, subdistrict: 'คลองเตย',
      district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
    });
    assert.deepEqual(Object.keys(result.body).sort(), ['addressJson', 'changeKind', 'expectedLegalIdentityVersion'],
      'an untouched taxId or registeredName must not ride along');
  });

  it('refuses a half-typed tax id before the server has to', () => {
    const result = buildIdentityPatch(control, null, { registeredName: '', taxId: '12345', address: BLANK_ADDRESS });
    assert.deepEqual(result, { error: 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลักค่ะ' });
  });

  it('refuses to send a no-op', () => {
    const current = { registeredName: 'ร้านมั่งมี', taxId: '0105558123456', addressJson: FULL_ADDRESS };
    const result = buildIdentityPatch(control, current, { registeredName: 'ร้านมั่งมี', taxId: '0105558123456', address: FULL_ADDRESS });
    assert.deepEqual(result, { error: 'ยังไม่มีอะไรเปลี่ยนค่ะ' });
  });

  it('carries the reason a closed-window correction needs, and the date a legal change needs', () => {
    const closed = { ...CLOSED, legalIdentityVersion: 7 };
    const current = { registeredName: 'เดิม', taxId: '0105558123456', addressJson: FULL_ADDRESS };

    const correction = buildIdentityPatch(closed, current, { registeredName: 'ใหม่', taxId: '0105558123456', address: FULL_ADDRESS });
    assert.ok('body' in correction);
    assert.equal(correction.body['changeKind'], 'CORRECTION');
    assert.equal(correction.body['correctionReason'], 'TYPO');
    assert.ok(correction.body['note'], 'the server rejects a correction without a note');

    const legal = buildIdentityPatch(closed, current, { registeredName: 'เดิม', taxId: '0105558999999', address: FULL_ADDRESS }, '2026-09-05');
    assert.ok('body' in legal);
    assert.equal(legal.body['changeKind'], 'LEGAL_CHANGE');
    assert.equal(legal.body['effectiveFrom'], '2026-09-05');
  });
});

describe('addressChanged', () => {
  it('does not count an untouched blank address as an edit', () => {
    assert.equal(addressChanged(BLANK_ADDRESS, null), false);
  });
  it('counts the first address a shop enters', () => {
    assert.equal(addressChanged(FULL_ADDRESS, null), true);
  });
  it('counts a real edit and ignores a no-op', () => {
    assert.equal(addressChanged({ ...FULL_ADDRESS, province: 'เชียงใหม่' }, FULL_ADDRESS), true);
    assert.equal(addressChanged(FULL_ADDRESS, FULL_ADDRESS), false);
  });
});

describe('addressErrorMessages', () => {
  it('names the empty box in Thai instead of a generic reload', () => {
    assert.deepEqual(
      addressErrorMessages({ details: ['addressJson.province is required', 'addressJson.postalCode must be 5 digits'] }),
      ['กรุณากรอก จังหวัด', 'รหัสไปรษณีย์ ต้องเป็นตัวเลข 5 หลัก'],
    );
  });
  it('says nothing when the error is not about the address', () => {
    assert.deepEqual(addressErrorMessages({ message: 'stale' }), []);
    assert.deepEqual(addressErrorMessages(null), []);
  });
});

// F1: a password with no login identifier is a locked door.
describe('the first password needs something to log in with', () => {
  it('requires a username when there is no verified email', () => {
    assert.equal(usernameFieldRequired({ username: null, emailVerified: false }), true);
    assert.equal(usernameFieldRequired({ username: null, emailVerified: true }), false);
    assert.equal(usernameFieldRequired({ username: 'somchai', emailVerified: false }), false);
    assert.equal(usernameFieldRequired(null), false);
  });

  it('blocks the submit that would create an unusable credential', () => {
    const lineOnly = { username: null, emailVerified: false };
    assert.match(
      passwordFormError(lineOnly, { password: 'backup-password', confirmPassword: 'backup-password', username: '  ' })!,
      /ชื่อผู้ใช้/,
    );
    assert.equal(passwordFormError(lineOnly, { password: 'backup-password', confirmPassword: 'backup-password', username: 'mangmee.shop' }), null);
  });

  it('still checks length and confirmation first', () => {
    const verified = { username: null, emailVerified: true };
    assert.match(passwordFormError(verified, { password: 'short', confirmPassword: 'short', username: '' })!, /8 ตัว/);
    assert.match(passwordFormError(verified, { password: 'backup-password', confirmPassword: 'other-password', username: '' })!, /ไม่ตรงกัน/);
    assert.equal(passwordFormError(verified, { password: 'backup-password', confirmPassword: 'backup-password', username: '' }), null);
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

  it('ignores the unanswered VAT reason', () => {
    assert.equal(checklistIsComplete(profileChecklist({ ...complete, readiness: { identity: { complete: false, reasons: ['vat_status_unanswered'] } } })), true);
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

// F7: the email item cannot complete while SES is sandboxed, so without a cache this card
// would fire two GETs on every dashboard mount for the life of the account.
describe('checklist cache', () => {
  function fakeStorage(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    return {
      store,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
  }
  const incomplete = profileChecklist({ readiness: { identity: { complete: true, reasons: [] } }, emailVerified: false, hasPassword: true });

  it('serves a fresh entry without a fetch, and expires it', () => {
    const storage = fakeStorage();
    writeChecklistCache(storage, 'c-1', incomplete, 1_000);
    assert.deepEqual(readChecklistCache(storage, 'c-1', 1_000 + CHECKLIST_CACHE_TTL_MS - 1), incomplete);
    assert.equal(readChecklistCache(storage, 'c-1', 1_000 + CHECKLIST_CACHE_TTL_MS + 1), null, 'a stale entry must send the card back to the API');
  });

  it('keeps a completed list hidden without refetching', () => {
    const storage = fakeStorage();
    const done = profileChecklist({ readiness: { identity: { complete: true, reasons: [] } }, emailVerified: true, hasPassword: true });
    writeChecklistCache(storage, 'c-1', done, 1_000);
    assert.equal(readChecklistCache(storage, 'c-1', 1_000), 'hidden');
  });

  it('honours "ไว้ก่อน" for a week, past the ordinary TTL', () => {
    const storage = fakeStorage();
    dismissChecklist(storage, 'c-1', 1_000);
    assert.equal(readChecklistCache(storage, 'c-1', 1_000 + CHECKLIST_CACHE_TTL_MS * 2), 'hidden');
    assert.equal(readChecklistCache(storage, 'c-1', 1_000 + 8 * 24 * 60 * 60 * 1000), null, 'a week later it may ask again');
  });

  it('is keyed per company, and survives junk or an unavailable store', () => {
    const storage = fakeStorage();
    writeChecklistCache(storage, 'c-1', incomplete, 1_000);
    assert.equal(readChecklistCache(storage, 'c-2', 1_000), null);
    assert.equal(readChecklistCache(fakeStorage({ 'watchdog.profileChecklist.c-1': 'not json' }), 'c-1', 1_000), null);
    assert.equal(readChecklistCache(undefined, 'c-1', 1_000), null);
    // Private mode throws on write; the card must still render.
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    assert.equal(readChecklistCache(throwing, 'c-1', 1_000), null);
    assert.doesNotThrow(() => writeChecklistCache(throwing, 'c-1', incomplete, 1_000));
    assert.doesNotThrow(() => dismissChecklist(throwing, 'c-1', 1_000));
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
  it('declares force-dynamic and passes the caller permissions to the client page', () => {
    const page = readFileSync(
      new URL('../../../app/(workspace)/companies/[companyId]/settings/profile/page.tsx', import.meta.url),
      'utf8',
    );
    assert.match(page, /export const dynamic = 'force-dynamic';/);
    assert.match(page, /requireRoutePermission\(session, '\/settings\/profile'\)/);
    assert.match(page, /permissions=\{session\?\.permissions \?\? \[\]\}/);
  });

  it('shows the dashboard card only to a holder of the identity authority', () => {
    const dashboard = readFileSync(new URL('../dashboard-notifications/DashboardPages.tsx', import.meta.url), 'utf8');
    assert.match(
      dashboard,
      /\{permissions\.includes\('company\.legal_identity\.manage'\) && <ProfileCompletenessCard companyId=\{companyId\} \/>\}/,
    );
  });
});
