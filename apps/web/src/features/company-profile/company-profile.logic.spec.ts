import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { todayCivilDate, COMPANY_PROFILE_ACCOUNT_HASH, COMPANY_PROFILE_SHOP_HASH } from '@watchdog-bms/contracts';
import {
  addressChanged,
  addressErrorMessages,
  buildIdentityPatch,
  buildShopSave,
  checkoutAddressDiffers,
  checkoutAddressText,
  checkoutAddressToForm,
  checklistIsComplete,
  companyProfileHref,
  clearChecklistCache,
  dismissChecklistFor,
  emailSectionMode,
  identityChangeKind,
  isThaiMobileInput,
  isThaiTaxIdInput,
  passwordFormError,
  profileChecklist,
  readChecklistCache,
  readChecklistDismissal,
  usernameFieldRequired,
  sectionIdFromHash,
  COMPANY_PROFILE_SECTION_IDS,
  INVALID_USERNAME_MESSAGE,
  NO_CHANGES_MESSAGE,
  PHONE_ERROR_MESSAGE,
  PHONE_HINT,
  USERNAME_PATTERN,
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
    assert.deepEqual(result, { error: 'เลขผู้เสียภาษีต้องมี 13 หลัก' });
  });

  it('refuses to send a no-op', () => {
    const current = { registeredName: 'ร้านมั่งมี', taxId: '0105558123456', addressJson: FULL_ADDRESS };
    const result = buildIdentityPatch(control, current, { registeredName: 'ร้านมั่งมี', taxId: '0105558123456', address: FULL_ADDRESS });
    assert.deepEqual(result, { error: 'ยังไม่ได้แก้อะไร' });
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

describe('the Stripe Checkout address offer (DQ5)', () => {
  // Stripe has no sub-district, so that box always arrives empty.
  const CHECKOUT = { line1: '99/1 ถนนสุขุมวิท', line2: null, subdistrict: '', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
  it('fills the boxes Checkout filled, clears the sub-district, and says nothing when the form already holds them', () => {
    assert.deepEqual(checkoutAddressToForm(CHECKOUT), { line1: '99/1 ถนนสุขุมวิท', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110', subdistrict: '' });
    assert.equal(checkoutAddressText(CHECKOUT), '99/1 ถนนสุขุมวิท คลองเตย กรุงเทพมหานคร 10110');
    assert.equal(checkoutAddressDiffers(CHECKOUT, BLANK_ADDRESS), true);
    assert.equal(checkoutAddressDiffers(CHECKOUT, FULL_ADDRESS), false);
    assert.equal(checkoutAddressDiffers(CHECKOUT, { ...FULL_ADDRESS, province: 'เชียงใหม่' }), true);
  });

  // Review 2026-09-29: keeping the old ตำบล under a new district from Checkout saved an address that
  // does not exist; the fill blanks it so the owner picks the one that belongs to the new district.
  it('never keeps a sub-district from another address under the district Checkout brings', () => {
    const chiangMai = { ...FULL_ADDRESS, subdistrict: 'ศรีภูมิ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postalCode: '50200' };
    const filled = { ...chiangMai, ...checkoutAddressToForm(CHECKOUT) };
    assert.equal(filled.subdistrict, '');
    assert.equal(filled.district, 'คลองเตย');
    assert.equal(addressChanged(filled, chiangMai), true);
  });

  it('is offered only while the saved address is incomplete, and asks for the sub-district again', () => {
    const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
    assert.match(page, /const checkoutFill = checkoutAddress && identity\?\.readiness\.identity\?\.reasons\.includes\('company_address_incomplete'\)/);
    assert.match(page, /checkoutFilled && !address\.subdistrict\?\.trim\(\) && \(/);
    assert.match(page, /เลือกตำบล\/แขวงอีกครั้งก่อนบันทึก/);
  });
});

describe('addressErrorMessages', () => {
  it('names the empty box in Thai instead of a generic reload', () => {
    assert.deepEqual(
      addressErrorMessages({ details: { details: ['addressJson.province is required', 'addressJson.postalCode must be 5 digits'] } }),
      ['กรอกจังหวัด', 'รหัสไปรษณีย์ ต้องเป็นตัวเลข 5 หลัก'],
    );
  });
  // N2: only `is required` means "you left it blank" — telling an owner to fill in a box they
  // already filled sends them to fix the wrong thing.
  it('does not call a shape error an empty box', () => {
    assert.deepEqual(
      addressErrorMessages({ details: { details: ['addressJson.province must be a string', 'addressJson.floor is not an allowed field'] } }),
      ['จังหวัด ค่าไม่ถูกต้อง'],
      'an unknown key has no box to name, and a wrong-typed one is not a blank one',
    );
    assert.deepEqual(addressErrorMessages({ details: { details: ['addressJson.district is required'] } }), ['กรอกอำเภอ / เขต']);
  });

  // The shape authedApiFetch really throws for this 422: `details` is the whole response body.
  it('reads the per-field array from the body authedApiFetch attaches as details', () => {
    const error = Object.assign(new Error('invalid addressJson'), {
      status: 422,
      details: { message: 'invalid addressJson', details: ['addressJson.line1 is required', 'addressJson.postalCode must be 5 digits'], requestId: 'req-1' },
    });
    assert.deepEqual(addressErrorMessages(error), ['กรอกที่อยู่ (บ้านเลขที่ ถนน)', 'รหัสไปรษณีย์ ต้องเป็นตัวเลข 5 หลัก']);
  });

  it('says nothing when the error is not about the address', () => {
    assert.deepEqual(addressErrorMessages({ message: 'stale' }), []);
    assert.deepEqual(addressErrorMessages({ details: { message: 'stale', requestId: 'req-2' } }), []);
    assert.deepEqual(addressErrorMessages(null), []);
  });
});

// F1: a password with no login identifier is a locked door.
describe('the first password needs something to log in with', () => {
  it('requires a username only when there is no stored account email', () => {
    assert.equal(usernameFieldRequired({ username: null, email: null, emailVerified: false }), true);
    assert.equal(usernameFieldRequired({ username: null, email: 'owner@example.com', emailVerified: false }), false);
    assert.equal(usernameFieldRequired({ username: null, email: 'owner@example.com', emailVerified: true }), false);
    assert.equal(usernameFieldRequired({ username: 'somchai', email: null, emailVerified: false }), false);
    assert.equal(usernameFieldRequired(null), false);
  });

  it('blocks the submit that would create an unusable credential', () => {
    const lineOnly = { username: null, email: null, emailVerified: false };
    assert.match(
      passwordFormError(lineOnly, { password: 'backup-password', confirmPassword: 'backup-password', username: '  ' })!,
      /ชื่อผู้ใช้/,
    );
    assert.equal(passwordFormError(lineOnly, { password: 'backup-password', confirmPassword: 'backup-password', username: 'mangmee.shop' }), null);
    assert.equal(passwordFormError(
      { username: null, email: 'owner@example.com', emailVerified: false },
      { password: 'backup-password', confirmPassword: 'backup-password', username: '' },
    ), null, 'the saved account email is the login identifier before mailbox verification');
  });

  it('still checks length and confirmation first', () => {
    const verified = { username: null, email: 'owner@example.com', emailVerified: true };
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

  // A completed list is served from the cache like any other, and every reader asks
  // `checklistIsComplete` for itself — the old `'hidden'` sentinel was a second way of saying the
  // same thing, and it could not carry the items the sidebar indicator needs.
  it('serves a completed list from the cache instead of refetching it', () => {
    const storage = fakeStorage();
    const done = profileChecklist({ readiness: { identity: { complete: true, reasons: [] } }, emailVerified: true, hasPassword: true });
    writeChecklistCache(storage, 'c-1', done, 1_000);
    const cached = readChecklistCache(storage, 'c-1', 1_000);
    assert.deepEqual(cached, done);
    assert.equal(checklistIsComplete(cached!), true);
  });

  // L2: a 7-day answer stored in sessionStorage dies with the tab.
  it('keeps "ไว้ก่อน" in a store that outlives the tab, for a week', () => {
    const session = fakeStorage();
    const local = fakeStorage();
    dismissChecklistFor(local, 'c-1', 1_000);

    assert.equal(session.store.size, 0, 'the dismissal must not be the tab-scoped store');
    assert.equal(readChecklistDismissal(local, 'c-1', 1_000 + CHECKLIST_CACHE_TTL_MS * 2), true);
    assert.equal(readChecklistDismissal(local, 'c-1', 1_000 + 6 * 24 * 60 * 60 * 1000), true);
    assert.equal(readChecklistDismissal(local, 'c-1', 1_000 + 8 * 24 * 60 * 60 * 1000), false, 'a week later it may ask again');
    assert.equal(readChecklistDismissal(local, 'c-2', 1_000), false, 'dismissing one shop is not dismissing them all');
    assert.equal(readChecklistDismissal(undefined, 'c-1', 1_000), false);
  });

  // L1: after a save the cached answer still lists the item the owner just completed.
  it('drops the cached answer so a save is visible on the next dashboard visit', () => {
    const storage = fakeStorage();
    writeChecklistCache(storage, 'c-1', incomplete, 1_000);
    assert.deepEqual(readChecklistCache(storage, 'c-1', 1_000), incomplete);

    clearChecklistCache(storage, 'c-1');
    assert.equal(readChecklistCache(storage, 'c-1', 1_000), null, 'a stale answer must not survive a save');
    assert.doesNotThrow(() => clearChecklistCache(undefined, 'c-1'));
  });

  it('is keyed per company, and survives junk or an unavailable store', () => {
    const storage = fakeStorage();
    writeChecklistCache(storage, 'c-1', incomplete, 1_000);
    assert.equal(readChecklistCache(storage, 'c-2', 1_000), null);
    assert.equal(readChecklistCache(fakeStorage({ 'watchdog.profileChecklist.c-1': 'not json' }), 'c-1', 1_000), null);
    assert.equal(readChecklistCache(undefined, 'c-1', 1_000), null);
    // Private mode throws on every access; the card must still render.
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    assert.equal(readChecklistCache(throwing, 'c-1', 1_000), null);
    assert.equal(readChecklistDismissal(throwing, 'c-1', 1_000), false);
    assert.doesNotThrow(() => writeChecklistCache(throwing, 'c-1', incomplete, 1_000));
    assert.doesNotThrow(() => dismissChecklistFor(throwing, 'c-1', 1_000));
    assert.doesNotThrow(() => clearChecklistCache(throwing, 'c-1'));
  });
});

// M2: the server validates effectiveFrom against the COMPANY's civil date, so a UTC date
// back-dates a CRITICAL-audited legal record by a day for the first seven hours of every ICT day.
describe('legal dates are Bangkok dates', () => {
  it('does not back-date a legal change made just after midnight in Bangkok', () => {
    const justAfterMidnightIct = new Date('2026-09-05T01:00:00+07:00');
    assert.equal(justAfterMidnightIct.toISOString().slice(0, 10), '2026-09-04', 'precondition: UTC is still yesterday');

    const closed = { ...CLOSED, legalIdentityVersion: 1 };
    const current = { registeredName: 'เดิม', taxId: '0105558123456', addressJson: FULL_ADDRESS };
    const result = buildIdentityPatch(
      closed, current,
      { registeredName: 'เดิม', taxId: '0105558999999', address: FULL_ADDRESS },
      todayCivilDate('Asia/Bangkok', justAfterMidnightIct),
    );
    assert.ok('body' in result);
    assert.equal(result.body['effectiveFrom'], '2026-09-05');
  });

  it('defaults to the Bangkok date, not the UTC one', () => {
    const source = readFileSync(new URL('./company-profile.logic.ts', import.meta.url), 'utf8');
    assert.match(source, /today: string = todayCivilDate\('Asia\/Bangkok'\)/);
    const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
    assert.match(page, /effectiveFrom: todayCivilDate\('Asia\/Bangkok'\)/, 'the VAT fact carries a legal date too');
    assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, 'no UTC date may reach a legal record');
  });
});

// M1: a Thai owner typing สมชาย was getting a generic English sentence.
describe('the username charset is explained before the server has to', () => {
  it('names the rule in Thai, client-side, with the same regex the API uses', () => {
    const account = { username: null, emailVerified: false };
    for (const bad of ['สมชาย', 'ab', 'somchai@gmail.com', 'som chai']) {
      assert.equal(
        passwordFormError(account, { password: 'backup-password', confirmPassword: 'backup-password', username: bad }),
        INVALID_USERNAME_MESSAGE,
        bad,
      );
    }
    assert.doesNotMatch(INVALID_USERNAME_MESSAGE, /[a-z]{3,}_[a-z]{3,}/, 'no snake_case code may leak into the copy');
    for (const good of ['somchai', 'mangmee.shop', 'som_hai', 'som-chai']) {
      assert.equal(passwordFormError(account, { password: 'backup-password', confirmPassword: 'backup-password', username: good }), null, good);
    }
  });

  it('uses the same pattern the API enforces', () => {
    assert.equal(USERNAME_PATTERN.source, /^[a-z0-9._-]{4,64}$/.source);
    const api = readFileSync(new URL('../../../../api/src/modules/auth/application/use-cases/account-profile.use-case.ts', import.meta.url), 'utf8');
    assert.ok(api.includes(`const USERNAME_PATTERN = ${USERNAME_PATTERN.toString()};`), 'the two copies must not drift');
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

// The sections mount after the reads land, so the browser's own fragment jump ran on an empty
// page — `#account` from the day-7 nudge left the owner at the top (rehearsal 26).
describe('sectionIdFromHash', () => {
  it('resolves every id the page renders, with or without the leading #', () => {
    for (const id of COMPANY_PROFILE_SECTION_IDS) {
      assert.equal(sectionIdFromHash(`#${id}`), id, id);
      assert.equal(sectionIdFromHash(id), id, id);
    }
    assert.equal(sectionIdFromHash(COMPANY_PROFILE_ACCOUNT_HASH), 'account', 'the nudge link must resolve');
    assert.equal(sectionIdFromHash(COMPANY_PROFILE_SHOP_HASH), 'shop');
  });

  it('resolves nothing else, so only our own ids ever reach the DOM', () => {
    for (const junk of [
      '', '#', '#javascript:alert(1)', 'javascript:alert(1)', '#Account', '#account?x=1',
      '#accounts', '#../shop', '#<script>', '# account', null, undefined,
    ]) {
      assert.equal(sectionIdFromHash(junk), null, JSON.stringify(junk));
    }
  });

  it('names ids the page actually renders', () => {
    const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
    for (const id of COMPANY_PROFILE_SECTION_IDS) {
      assert.ok(page.includes(`id="${id}"`), `the page must carry an element with id="${id}"`);
    }
  });
});

describe('the profile route is reachable and dynamic', () => {
  it('is on the settings menu behind a registered permission rule', () => {
    const item = SETTINGS_MENU_ITEMS.find((entry) => entry.href === '/settings/profile');
    assert.ok(item, 'the settings menu must carry the profile card');
    assert.equal(item.title, 'ข้อมูลร้าน');
    assert.deepEqual(findRoutePermissionRule('/settings/profile')?.anyOf, ['company.setup.read', 'company.setup.manage']);
    assert.equal(canSeeRoute('/settings/profile', ['company.setup.read']), true);
    assert.equal(canSeeRoute('/settings/profile', ['company.setup.manage']), true);
    assert.equal(canSeeRoute('/settings/profile', ['expense.read']), false);
  });

  // CSP nonce vs prerender: a prerendered workspace page ships without the nonce and renders dead.
  it('declares force-dynamic and passes the caller permissions to the client page', () => {
    const page = readFileSync(
      new URL('../../../app/(workspace)/companies/[companyId]/settings/profile/page.tsx', import.meta.url),
      'utf8',
    );
    assert.match(page, /export const dynamic = 'force-dynamic';/);
    assert.match(page, /requireRoutePermission\(session, COMPANY_PROFILE_SETTINGS_PATH\)/);
    assert.match(page, /permissions=\{session\?\.permissions \?\? \[\]\}/);
  });

  it('keeps the shop-details card off the home page', () => {
    // Owner 2026-10-15, second look at the home page: "no shop-details card". What is missing is said on ข้อมูลร้าน.
    const dashboard = readFileSync(new URL('../dashboard-notifications/DashboardPages.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(dashboard, /ProfileCompletenessCard/);
  });

  it('places personal signature management in the account area without changing its route', () => {
    const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
    assert.match(page, /canManageSignature/);
    assert.match(page, /href=\{`\/companies\/\$\{companyId\}\/expenses\/signatures`\}/);
    assert.match(page, />\s*จัดการลายเซ็น\s*</);
  });
});

// ─── UAT 2026-09-06 (spec §15.4.1) ───────────────────────────────────────────

/**
 * A. The VAT select used to write on change and then reload the page's data, so choosing
 * "จดทะเบียน VAT แล้ว" wiped the ชื่อจดทะเบียน / เลขภาษี / ที่อยู่ the owner had just typed. One
 * button now sends both halves, and this function is what it sends.
 */
describe('buildShopSave — one press, both halves, nothing lost', () => {
  const CURRENT = { registeredName: null, taxId: null, addressJson: null };
  const BLANK_FORM = { registeredName: '', taxId: '', address: BLANK_ADDRESS };

  it('saves TSIC alone without a legal-identity change and uses its own version', () => {
    const current = { ...CURRENT, businessType: { code: '01111', other: null, version: 4 } };
    assert.deepEqual(buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, current, { ...BLANK_FORM, businessTypeCode: '56101', businessTypeOther: 'old text' }, { current: 'UNKNOWN', chosen: 'UNKNOWN' }), {
      identityPatch: null, vatStatus: null, businessTypePatch: { code: '56101', other: null, expectedVersion: 4 },
    });
    assert.deepEqual(buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, current, { ...BLANK_FORM, businessTypeCode: '' }, { current: 'UNKNOWN', chosen: 'UNKNOWN' }), {
      identityPatch: null, vatStatus: null, businessTypePatch: { code: null, other: null, expectedVersion: 4 },
    });
  });

  it('requires OTHER text, trims it and treats unchanged saved text as no changes', () => {
    const otherForm = { ...BLANK_FORM, businessTypeCode: 'OTHER', businessTypeOther: ' ธุรกิจทดสอบ ' };
    const vat = { current: 'UNKNOWN', chosen: 'UNKNOWN' } as const;
    assert.deepEqual(buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, CURRENT, otherForm, vat), {
      identityPatch: null, vatStatus: null, businessTypePatch: { code: 'OTHER', other: 'ธุรกิจทดสอบ', expectedVersion: 0 },
    });
    assert.deepEqual(buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, { ...CURRENT, businessType: { code: 'OTHER', other: 'ธุรกิจทดสอบ', version: 1 } }, otherForm, vat), { error: NO_CHANGES_MESSAGE });
    const invalid = buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, CURRENT, { ...otherForm, businessTypeOther: ' ' }, { current: 'UNKNOWN', chosen: 'REGISTERED' });
    assert.deepEqual(invalid, { error: 'ระบุประเภทธุรกิจอื่น ๆ' });
  });

  it('sends only the identity when the VAT answer is unchanged', () => {
    const result = buildShopSave(
      { ...OPEN, legalIdentityVersion: 3 },
      CURRENT,
      { ...BLANK_FORM, registeredName: 'บริษัท มั่งมี จำกัด' },
      { current: 'REGISTERED', chosen: 'REGISTERED' },
    );
    assert.ok('identityPatch' in result);
    assert.equal(result.vatStatus, null);
    assert.equal((result.identityPatch as Record<string, unknown>)['registeredName'], 'บริษัท มั่งมี จำกัด');
  });

  it('sends only the VAT answer when nothing else was touched', () => {
    const result = buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, CURRENT, BLANK_FORM, { current: 'UNKNOWN', chosen: 'REGISTERED' });
    assert.ok('identityPatch' in result);
    assert.equal(result.identityPatch, null, 'an untouched identity must not travel');
    assert.equal(result.vatStatus, 'REGISTERED');
  });

  // The exact case the Owner hit: pick the VAT status, type the tax id, press save once.
  it('sends both when both changed', () => {
    const result = buildShopSave(
      { ...OPEN, legalIdentityVersion: 0 },
      CURRENT,
      { ...BLANK_FORM, taxId: '0105561000001' },
      { current: 'UNKNOWN', chosen: 'REGISTERED' },
    );
    assert.ok('identityPatch' in result);
    assert.equal((result.identityPatch as Record<string, unknown>)['taxId'], '0105561000001');
    assert.equal(result.vatStatus, 'REGISTERED');
  });

  it('refuses an empty press, counting the VAT answer as a change', () => {
    const nothing = buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, CURRENT, BLANK_FORM, { current: 'UNKNOWN', chosen: 'UNKNOWN' });
    assert.deepEqual(nothing, { error: NO_CHANGES_MESSAGE });
    // …and the same press with only the VAT changed is NOT empty.
    assert.ok('identityPatch' in buildShopSave({ ...OPEN, legalIdentityVersion: 0 }, CURRENT, BLANK_FORM, { current: 'UNKNOWN', chosen: 'NOT_REGISTERED' }));
  });

  it('reports a bad tax id instead of quietly saving half the form', () => {
    const result = buildShopSave(
      { ...OPEN, legalIdentityVersion: 0 },
      CURRENT,
      { ...BLANK_FORM, taxId: '123' },
      { current: 'UNKNOWN', chosen: 'REGISTERED' },
    );
    assert.deepEqual(result, { error: 'เลขผู้เสียภาษีต้องมี 13 หลัก' });
  });
});

/**
 * B. "email ถูก verify แล้วแต่เปิดให้แก้ไขได้" — a verified address sat in an open box under a
 * "ส่งลิงก์ยืนยันอีเมล" button whose only possible answer was the API's 409.
 */
describe('emailSectionMode', () => {
  const BASE = { email: null, emailDeliveryEnabled: true, pendingEmail: null, emailVerified: false, lineLinked: false };

  it('shows a verified address as a fact, not a form', () => {
    assert.equal(emailSectionMode({ ...BASE, emailVerified: true }, false), 'verified');
  });

  it('opens the form only when the owner asks to change it', () => {
    assert.equal(emailSectionMode({ ...BASE, emailVerified: true }, true), 'edit');
  });

  it('reports a request already in flight, whatever the stored address says', () => {
    assert.equal(emailSectionMode({ ...BASE, pendingEmail: 'new@example.com' }, false), 'pending');
    assert.equal(emailSectionMode({ ...BASE, emailVerified: true, pendingEmail: 'new@example.com' }, false), 'pending');
  });

  it('gives an account with no email the plain form', () => {
    assert.equal(emailSectionMode(BASE, false), 'none');
    assert.equal(emailSectionMode(null, false), 'none');
  });

  it('shows a LINE account email truthfully and lets an empty LINE account save one directly', () => {
    const line = { ...BASE, lineLinked: true };
    assert.equal(emailSectionMode({ ...line, email: 'owner@example.com' }, false), 'unverified');
    assert.equal(emailSectionMode({ ...line, email: 'owner@example.com', pendingEmail: 'owner@example.com' }, false), 'unverified');
    assert.equal(emailSectionMode({ ...line, email: 'owner@example.com' }, true), 'edit');
    assert.equal(emailSectionMode(line, false), 'edit');
  });

  // C: with no mailer there is no action to offer, in any of the states above.
  it('offers nothing at all when the environment cannot send mail', () => {
    for (const account of [BASE, { ...BASE, emailVerified: true }, { ...BASE, pendingEmail: 'a@b.co' }]) {
      assert.equal(emailSectionMode({ ...account, emailDeliveryEnabled: false }, true), 'unavailable');
    }
    // Only an explicit `false` counts: an older API that does not answer the field leaves the
    // page working, and the use-case gate is still the backstop.
    assert.equal(emailSectionMode({ ...BASE, emailDeliveryEnabled: undefined }, false), 'none');
  });

  it('keeps an unverified LINE account email visible and correctable without a mailer', () => {
    const line = { ...BASE, email: 'owner@example.com', lineLinked: true, emailDeliveryEnabled: false };
    assert.equal(emailSectionMode(line, false), 'unverified');
    assert.equal(emailSectionMode(line, true), 'edit');
  });
});

/** C. An item that cannot be completed is not a checklist item, it is noise. */
describe('profileChecklist and email delivery', () => {
  const readiness = { identity: { complete: true, reasons: [] as string[] } };

  it('drops the email item when the environment has no mailer', () => {
    const items = profileChecklist({ readiness, emailVerified: false, hasPassword: true, emailDeliveryEnabled: false });
    assert.deepEqual(items.map((item) => item.key), ['identity', 'address', 'password']);
    assert.equal(checklistIsComplete(items), true, 'the list must be able to finish');
  });

  it('keeps it wherever mail can actually be sent', () => {
    for (const emailDeliveryEnabled of [true, undefined]) {
      const items = profileChecklist({ readiness, emailVerified: false, hasPassword: true, emailDeliveryEnabled });
      assert.ok(items.some((item) => item.key === 'email'));
      assert.equal(checklistIsComplete(items), false);
    }
  });
});

/**
 * D. "ทำไมไม่ใส่บอกไปตรงๆเลยว่า ใส่เบอร์มือถือ 10 หลัก จะมาบอกว่าเว้น 0 ทำไม" — the old hint ended
 * "เว้นว่างไว้ก็ได้ถ้าไม่อยากให้เก็บ", which reads as an instruction to leave the 0 out.
 */
describe('phone copy says the rule and nothing else', () => {
  it('states the length and shows one', () => {
    assert.equal(PHONE_HINT, 'ใส่เบอร์มือถือ 10 หลัก เช่น 0812345678');
    assert.equal(PHONE_ERROR_MESSAGE, 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678');
  });

  it('never tells the owner to leave anything blank or to skip the leading zero', () => {
    for (const copy of [PHONE_HINT, PHONE_ERROR_MESSAGE]) {
      assert.doesNotMatch(copy, /เว้น/, copy);
      assert.doesNotMatch(copy, /ขึ้นต้นด้วย/, copy);
    }
  });

  // The rule itself is unchanged; only the sentence describing it is.
  it('still matches the validator it describes', () => {
    assert.equal(isThaiMobileInput('0812345678'), true);
    assert.equal(isThaiMobileInput('812345678'), false);
  });
});

/** E. One checklist, three places that read it, one permission that gates all three. */
describe('the attention indicator and the dashboard card share one read', () => {
  const feature = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

  it('gives the card, the sidebar and the settings hub the same hook', () => {
    for (const file of ['ProfileCompletenessCard.tsx', 'ProfileAttentionBadge.tsx']) {
      assert.match(feature(file), /useProfileChecklist\(/, file);
    }
    const layout = readFileSync(new URL('../web-core-workspace/WorkspaceLayout.tsx', import.meta.url), 'utf8');
    assert.match(layout, /useProfileChecklist\(/);
  });

  it('asks for nothing when the reader could not act on the answer', () => {
    const layout = readFileSync(new URL('../web-core-workspace/WorkspaceLayout.tsx', import.meta.url), 'utf8');
    assert.match(layout, /session\.permissions\.includes\('company\.legal_identity\.manage'\)/);
    const hub = readFileSync(
      new URL('../../../app/(workspace)/companies/[companyId]/settings/page.tsx', import.meta.url),
      'utf8',
    );
    assert.match(hub, /permissions\?\.includes\('company\.legal_identity\.manage'\)/);
    assert.match(hub, /<ProfileAttentionBadge companyId=\{companyId\} \/>/);
  });

  // "จนกว่าจะตั้งครบ": the 7-day snooze answers the dashboard card, not the indicators.
  it('keeps the "ไว้ก่อน" dismissal out of the shared hook', () => {
    const hook = feature('use-profile-checklist.ts');
    assert.doesNotMatch(hook, /readChecklistDismissal\(|dismissChecklistFor\(/, 'a dismissed card must still leave the sidebar dot on');
    assert.match(feature('ProfileCompletenessCard.tsx'), /readChecklistDismissal\(/);
  });

  it('marks the sidebar row and renders one dot for it', () => {
    const layout = readFileSync(new URL('../web-core-workspace/WorkspaceLayout.tsx', import.meta.url), 'utf8');
    assert.match(layout, /attention:/);
    const sidebar = readFileSync(new URL('../../common/components/app-shell/AppSidebar.tsx', import.meta.url), 'utf8');
    assert.match(sidebar, /nav\.attention/);
    assert.match(sidebar, /ตั้งค่ายังไม่ครบ/);
  });
});
it('certificate return paths stay inside the same shop and retain the card anchor', async () => {
  const { companyProfileReturnPath } = await import('./company-profile.logic');
  const valid = '/companies/co/expenses/expense-1#wht-certificate';
  const search = (value: string) => `?${new URLSearchParams({ returnTo: value })}`;
  assert.equal(companyProfileReturnPath('co', search(valid)), valid);
  for (const path of ['/companies/other/expenses/expense-1', '//example.test/companies/co/', 'https://example.test/companies/co/', '/companies/co/../../other', '/companies/co/%2e%2e/other', '/companies/co/..\\other', 'billing', '']) {
    assert.equal(companyProfileReturnPath('co', search(path)), null, path);
  }
  assert.equal(companyProfileReturnPath('co', ''), null);
});


it('saves only the trimmed shop name without legal-change fields even after legal identity is locked', () => {
  const result = buildIdentityPatch({ ...CLOSED, authoritativeLatched: true, legalIdentityVersion: 3 },
    { displayName: 'เดิม', registeredName: null, taxId: null, addressJson: null },
    { displayName: ' ร้านใหม่ ', registeredName: '', taxId: '', address: BLANK_ADDRESS });
  assert.deepEqual(result, { body: { expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', displayName: 'ร้านใหม่', correctionReason: 'TYPO', note: 'แก้ไขจากหน้าข้อมูลร้าน' } });
});
it('shop name validation rejects blank and overlong names before any profile writes', () => {
  for (const displayName of ['', ' ', 'ก'.repeat(201)]) {
    const result = buildIdentityPatch({ ...OPEN, legalIdentityVersion: 0 }, null, { displayName, registeredName: '', taxId: '', address: BLANK_ADDRESS });
    assert.deepEqual(result, { error: 'ชื่อร้านต้องมี 1 ถึง 200 ตัวอักษร แก้ชื่อร้านแล้วบันทึกอีกครั้ง' });
  }
});


it('withholding return origin is one fixed value and never a caller-supplied URL', async () => {
  const { withholdingProfileReturnPath } = await import('./company-profile.logic');
  assert.equal(withholdingProfileReturnPath('co', '?from=withholding'), '/companies/co/tax/withholding');
  for (const search of ['', '?from=https://evil.test', '?from=//evil.test', '?from=other', '?returnTo=/companies/co/tax/withholding']) assert.equal(withholdingProfileReturnPath('co', search), null);
});

it('UX8 shop settings keep the expense VAT anchor and name the return destination', async () => {
  const { companyProfileReturnPath, companyProfileReturnLabel } = await import('./company-profile.logic');
  const path = '/companies/co/expenses/e1#expense-input-vat-e1';
  assert.equal(companyProfileReturnPath('co', `?${new URLSearchParams({ returnTo: path })}`), path);
  assert.equal(companyProfileReturnLabel(path), 'กลับไปตรวจ VAT สำหรับยื่นภาษี');
  assert.equal(companyProfileReturnLabel('/companies/co/expenses/substitute-receipts/new'), 'กลับไปทำใบรับรอง');
  assert.equal(companyProfileReturnLabel('/companies/co/expenses/e1#wht-certificate'), 'กลับไปออกหนังสือรับรอง');
});
