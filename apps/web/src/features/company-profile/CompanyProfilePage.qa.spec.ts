/**
 * Rendered assertions for the profile page, in the repo's page-spec idiom: `renderToStaticMarkup`
 * for what the first paint reaches, anchored source slices for what only a mount effect reaches.
 *
 * The page loads its data in `useEffect`, and effects never run under `renderToStaticMarkup`, so
 * the loaded states below are produced by injecting them through `useState` — the same route
 * `InventoryPages.spec.ts` takes for a data-loading client page.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext } from '@/common/components/toast/use-toast';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Node cannot parse the `.svg` assets the shared component tree imports through @svgr/webpack.
const previousSvgLoader = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const { CompanyProfilePage } = require('./CompanyProfilePage') as typeof import('./CompanyProfilePage');
if (previousSvgLoader) require.extensions['.svg'] = previousSvgLoader;
else delete require.extensions['.svg'];

const reactRuntime = require('react') as typeof React;

const source = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');

const FULL_IDENTITY = {
  control: { legalIdentityVersion: 0, captureWindowOpen: true, authoritativeLatched: false, fieldLatched: { registeredName: false, addressJson: false } },
  identity: { masked: false, displayName: 'ร้านมั่งมี', registeredName: null, taxId: null, addressJson: null },
  vatRegistration: { status: 'UNKNOWN', version: 0, vatRegistered: false, vatEffectiveDate: null },
  readiness: { identity: { complete: false, reasons: ['tax_id_missing'] } },
};

const MASKED_IDENTITY = {
  ...FULL_IDENTITY,
  identity: { masked: true, displayName: 'ร้านมั่งมี', registeredName: 'บริษัท มั่งมี จำกัด', taxIdLast4: '3456', addressProvince: 'กรุงเทพมหานคร' },
};

const LINE_ONLY_ACCOUNT = {
  email: null, emailVerified: false, emailVerifiedAt: null, pendingEmail: null, pendingEmailExpiresAt: null,
  lineLinked: true, phoneNumber: null, hasPassword: false, username: null, emailDeliveryEnabled: true,
};

/**
 * Renders the page in its post-load state. `useState` is keyed on the initial value: `identity`
 * and `account` both start `null`, `loading` starts `true` — the three the effect would have set.
 */
function renderLoaded(options: { permissions: string[]; identity?: unknown; account?: unknown }): string {
  const identity = options.identity ?? FULL_IDENTITY;
  const account = options.account ?? LINE_ONLY_ACCOUNT;
  const realUseState = reactRuntime.useState;
  let nullsSeen = 0;
  Reflect.set(reactRuntime, 'useState', (initialState: unknown) => {
    const state = (realUseState as (init: unknown) => [unknown, (value: unknown) => void])(initialState);
    if (initialState === null) {
      nullsSeen += 1;
      if (nullsSeen === 1) return [identity, state[1]];
      if (nullsSeen === 2) return [account, state[1]];
    }
    if (initialState === true) return [false, state[1]];
    return state;
  });
  try {
    const noop = () => undefined;
    return renderToStaticMarkup(React.createElement(
      ToastContext.Provider,
      { value: { success: noop, warning: noop, error: noop } },
      React.createElement(CompanyProfilePage, { companyId: 'company-1', permissions: options.permissions }),
    ));
  } finally {
    Reflect.set(reactRuntime, 'useState', realUseState);
  }
}

/** Tailwind class strings contain the word "disabled" (`disabled:bg-gray-50`); drop them first. */
function controls(html: string): string {
  return html.replace(/class="[^"]*"/g, '');
}

const OWNER = ['company.setup.read', 'company.legal_identity.read', 'company.legal_identity.manage', 'company.vat_registration.read', 'company.vat_registration.manage'];
/** FINANCE: reads the VAT section, may not answer it, and never un-masks the identity. */
const FINANCE = ['company.setup.read', 'company.vat_registration.read'];
/** Can SEE the real values but may not change them — reading and writing are separate keys. */
const READ_ONLY_AUDITOR = ['company.setup.read', 'company.legal_identity.read'];

describe('the shop section respects the permission that would refuse the save', () => {
  it('gives an owner writable boxes and a save button', () => {
    const html = renderLoaded({ permissions: OWNER });
    assert.match(html, /ข้อมูลร้าน/);
    assert.match(html, /บันทึกข้อมูลร้าน/);
    assert.doesNotMatch(controls(html), /<input[^>]*\bdisabled=""/, 'an owner must not meet a disabled box');
  });

  // F4: the promised masked block was never rendered — `load()` only copied unmasked values, so a
  // FINANCE member met an editable form full of blanks over values they were not allowed to see.
  it('gives a member who cannot un-mask the masked block, and no way to write', () => {
    const html = renderLoaded({ permissions: FINANCE, identity: MASKED_IDENTITY });
    assert.match(html, /data-testid="masked-identity"/, 'the masked read-only block must render');
    assert.match(html, /ลงท้าย 3456/, 'the masked tax id is what the API sent');
    assert.match(html, /กรุงเทพมหานคร/);
    assert.doesNotMatch(html, /บันทึกข้อมูลร้าน/, 'no save button without the manage key');
    assert.doesNotMatch(html, /id="เลขผู้เสียภาษี"/, 'no editable identity boxes');
  });

  it('shows a reader the real values but no way to save them', () => {
    const html = renderLoaded({ permissions: READ_ONLY_AUDITOR });
    assert.match(html, /id="เลขผู้เสียภาษี"/, 'they may read, so they get the real boxes');
    assert.doesNotMatch(html, /บันทึกข้อมูลร้าน/, 'reading is not writing: no save button without the manage key');
    assert.match(controls(html), /<input[^>]*\bdisabled=""/, 'and the boxes must not invite an edit that would 403');
  });

  // ThemedSelect is a custom combobox, so "disabled" reaches the DOM as aria-disabled.
  it('disables the VAT answer for a member who may read it but not manage it', () => {
    const financeHtml = renderLoaded({ permissions: FINANCE, identity: MASKED_IDENTITY });
    assert.match(financeHtml, /id="vat-status"[^>]*aria-disabled="true"/, 'every change would 403, so the control must not invite one');
    assert.match(financeHtml, /ดูได้อย่างเดียว/);

    const ownerHtml = renderLoaded({ permissions: OWNER });
    assert.match(ownerHtml, /id="vat-status"[^>]*aria-disabled="false"/);
  });
});

describe('the account section asks for what a login actually needs', () => {
  // F1: without a username and without a verified email the credential is unreachable.
  it('asks a LINE-only account for a username alongside the first password', () => {
    const html = renderLoaded({ permissions: OWNER });
    assert.match(html, /ตั้งรหัสผ่านสำรอง/);
    assert.match(html, /ชื่อผู้ใช้/, 'a password with no login identifier is a locked door');
    assert.doesNotMatch(html, /รหัสผ่านปัจจุบัน/, 'there is no current password to prove');
  });

  it('does not ask for a username once a verified email can carry the login', () => {
    const html = renderLoaded({
      permissions: OWNER,
      account: { ...LINE_ONLY_ACCOUNT, email: 'owner@example.com', emailVerified: true },
    });
    assert.doesNotMatch(html, /ชื่อผู้ใช้/);
  });

  it('sends an account that already has a password to change-password instead', () => {
    const html = renderLoaded({ permissions: OWNER, account: { ...LINE_ONLY_ACCOUNT, hasPassword: true } });
    assert.match(html, /href="\/change-password"/);
    assert.match(html, /รหัสผ่านปัจจุบัน/, 'changing the email now needs the password that exists');
    assert.doesNotMatch(html, /พิมพ์รหัสผ่านอีกครั้ง/, 'the first-password form is gone');
  });

  it('is honest that a mail may never arrive', () => {
    const html = renderLoaded({ permissions: OWNER, account: { ...LINE_ONLY_ACCOUNT, pendingEmail: 'new@example.com' } });
    assert.match(html, /ถ้าไม่ได้รับอีเมล ติดต่อทีมงาน/);
  });
});

// Behind the effect / inside a handler: read off the source, anchored to the block that owns it.
describe('handlers that no static render reaches', () => {
  function block(startAnchor: string, endAnchor: string): string {
    const start = source.indexOf(startAnchor);
    assert.notEqual(start, -1, `anchor gone: ${startAnchor} — rewrite this guard, do not delete it`);
    const end = source.indexOf(endAnchor, start);
    assert.notEqual(end, -1, `end anchor gone: ${endAnchor}`);
    return source.slice(start, end);
  }

  it('builds the identity PATCH through the pinned pure builder, not inline in the handler', () => {
    const saveShop = block('const saveShop = async () => {', 'const saveEmail = async');
    assert.match(saveShop, /buildShopSave\(/, 'the request shape is tested in company-profile.logic.spec.ts');
    assert.match(saveShop, /addressErrorMessages\(error\)/, 'the per-field 422 must not collapse to a generic reload');
    assert.doesNotMatch(saveShop, /addressJson:\s*\{\s*\.\.\.address/, 'the handler must not assemble an address of its own');
  });

  it('sends the username with the first password and reports the stored form back', () => {
    const savePassword = block('const savePassword = async () => {', 'if (loading) {');
    assert.match(savePassword, /passwordFormError\(account, \{ password, confirmPassword, username: newUsername \}\)/);
    assert.match(savePassword, /setMyFirstPassword\(password, newUsername\.trim\(\) \|\| undefined\)/);
    assert.match(savePassword, /saved\.username/, 'the login name is lower-cased server-side; the user has to be told');
  });

  // The native fragment jump already ran against an empty page, so the page has to redo it once
  // the sections exist — otherwise "ใส่เลย" lands the owner at the top (rehearsal 26).
  it('jumps to the hashed section once the sections are in the DOM', () => {
    const effect = block('const jumpedToHash = useRef(false);', 'if (loading) {');
    assert.match(effect, /if \(loading \|\| loadError\) return undefined;/, 'the sections do not exist yet while loading');
    assert.match(effect, /sectionIdFromHash\(window\.location\.hash\)/, 'only the page\u2019s own ids may reach the DOM');
    assert.match(effect, /document\.getElementById\(id\)\?\.scrollIntoView\(\{ block: 'start' \}\)/);
    assert.doesNotMatch(effect, /smooth/, 'an unrequested animation is what prefers-reduced-motion asks us not to do');
    assert.match(effect, /if \(!jumpedToHash\.current\) \{/, 'the first jump must not repeat on every re-render');
    assert.match(effect, /addEventListener\('hashchange', jump\)/, 'a same-page hash change re-renders nothing');
    assert.match(effect, /removeEventListener\('hashchange', jump\)/);
  });

  it('omits the current password for an account that has none', () => {
    const saveEmail = block('const saveEmail = async () => {', 'const savePhoneValue = async');
    assert.match(saveEmail, /account\?\.hasPassword \? emailPassword : undefined/);
  });

  /**
   * UAT 2026-09-06 §15.4.1 A: "เลือก dropdown จดทะเบียนแล้ว ดันบันทึกทันทีและรีเฟรชจอ ทำให้ข้อมูล
   * ที่กรอกไว้หาย". The select wrote on change and the reload that followed re-seeded the identity
   * boxes from the server, so the ชื่อจดทะเบียน / เลขภาษี / ที่อยู่ typed but not yet saved were gone.
   */
  it('never saves the VAT answer on change', () => {
    const select = block('id="vat-status"', '</ThemedSelect>');
    assert.match(select, /onChange=\{\(event\) => setVatChoice\(event\.target\.value as VatRegistrationStatus\)\}/);
    assert.doesNotMatch(select, /putVatRegistration|saveVat/, 'the answer travels with the save button, not the select');
    assert.match(select, /<option value="UNKNOWN" disabled>/, 'a shop cannot un-answer the question');
  });

  it('seeds the form once, so a re-read after a save cannot wipe what is being typed', () => {
    const load = block('const load = useCallback(async () => {', 'useEffect(() => { void load(); }', );
    assert.match(load, /if \(seeded\.current\) return;/, 'the second read must not touch the boxes');
    assert.match(load, /seeded\.current = true;/);
    // Everything the owner types lives behind that guard.
    for (const setter of ['setRegisteredName', 'setTaxId', 'setAddress', 'setVatChoice', 'setPhone', 'setEmail']) {
      assert.ok(load.indexOf(setter) > load.indexOf('seeded.current = true;'), setter);
    }
  });

  it('saves both halves under one press and keeps each failure to its own banner', () => {
    const saveShop = block('const saveShop = async () => {', 'const saveEmail = async');
    assert.match(saveShop, /if \('error' in plan\)/, 'a client-side problem must stop the press');
    assert.match(saveShop, /patchCompanyIdentity\(/);
    assert.match(saveShop, /putVatRegistration\(/);
    assert.match(saveShop, /setVatError\(/, 'the VAT failure must not be reported in the identity banner');
    assert.ok(saveShop.indexOf('patchCompanyIdentity(') < saveShop.indexOf('putVatRegistration('), 'sequential, identity first');
  });
});

/**
 * §15.4.1 B. "ตรวจดูโฟลว์การกรอก ดูไม่ make sense เช่น email ถูก verify แล้วแต่เปิดให้แก้ไขได้" — a
 * verified address in an open box under a send button whose only possible answer was the API's 409.
 */
describe('the email block matches the state the account is actually in', () => {
  const VERIFIED = { ...LINE_ONLY_ACCOUNT, email: 'owner@example.com', emailVerified: true };

  it('shows a verified address as a fact with one way to change it', () => {
    const html = renderLoaded({ permissions: OWNER, account: VERIFIED });
    assert.match(html, /owner@example\.com/);
    assert.match(html, /ยืนยันแล้ว/);
    assert.match(html, /เปลี่ยนอีเมล/);
    assert.doesNotMatch(html, /ส่งลิงก์ยืนยันอีเมล/, 'the only answer to that button is a 409');
    assert.doesNotMatch(html, /id="account-email"/, 'no open box over a verified address');
  });

  it('reports a request already in flight, and offers a resend', () => {
    const html = renderLoaded({ permissions: OWNER, account: { ...LINE_ONLY_ACCOUNT, pendingEmail: 'new@example.com' } });
    assert.match(html, /new@example\.com/);
    assert.match(html, /รอการยืนยัน/);
    assert.match(html, /ลิงก์มีอายุ 15 นาที/);
    assert.match(html, /ส่งลิงก์อีกครั้ง/);
    assert.doesNotMatch(html, /id="account-email"/);
  });

  it('gives an account with no email the plain form, labelled once', () => {
    const html = renderLoaded({ permissions: OWNER });
    assert.match(html, /id="account-email"/);
    assert.match(html, /ส่งลิงก์ยืนยันอีเมล/);
    // The read-only blocks carry their own caption; with the box on screen that caption is the
    // box's own label, and rendering both put "อีเมล" on two consecutive lines.
    assert.equal(html.match(/>อีเมล</g)?.length, 1, 'one label for one field');
  });

  // §15.4.1 C: production runs EMAIL_PROVIDER=disabled, where the mailer is a silent no-op.
  it('promises nothing on an environment that cannot send mail', () => {
    for (const account of [LINE_ONLY_ACCOUNT, VERIFIED]) {
      const html = renderLoaded({ permissions: OWNER, account: { ...account, emailDeliveryEnabled: false } });
      assert.doesNotMatch(html, /ส่งลิงก์ยืนยันอีเมล/, 'no button that cannot work');
      assert.doesNotMatch(html, /id="account-email"/);
      assert.match(html, /ยังเปิดส่งอีเมลยืนยันไม่ได้/);
      assert.match(html, /098-256-5628/);
    }
  });
});

/** §15.4.1 D. "จะมาบอกว่าเว้น 0 ทำไม" — the hint read as "leave the leading zero out". */
describe('the phone block says the rule plainly', () => {
  it('uses the shared copy and never mentions leaving the field blank', () => {
    const html = renderLoaded({ permissions: OWNER });
    assert.match(html, /ใส่เบอร์มือถือ 10 หลัก เช่น 0812345678/);
    assert.doesNotMatch(html, /เว้นว่างไว้ก็ได้/);
  });

  it('offers "ลบเบอร์ออก" only when there is a number to remove', () => {
    assert.doesNotMatch(renderLoaded({ permissions: OWNER }), /ลบเบอร์ออก/);
    assert.match(
      renderLoaded({ permissions: OWNER, account: { ...LINE_ONLY_ACCOUNT, phoneNumber: '0812345678' } }),
      /ลบเบอร์ออก/,
    );
  });
});

/** F: the "optional username" branch promised a login by verified email that did not exist. */
describe('the backup-password block tells the truth about the login name', () => {
  it('states an existing username instead of offering to silently rename it', () => {
    const html = renderLoaded({
      permissions: OWNER,
      account: { ...LINE_ONLY_ACCOUNT, username: 'mangmee.shop' },
    });
    assert.match(html, /mangmee\.shop/);
    assert.doesNotMatch(html, /ถ้าไม่ตั้ง จะเข้าด้วยอีเมลที่ยืนยันแล้ว/, 'there is no verified email in this state');
    assert.doesNotMatch(html, /id="ชื่อผู้ใช้ \(ถ้าต้องการ\)"/);
  });
});

describe('the completeness card stays out of the way', () => {
  const card = readFileSync(new URL('./ProfileCompletenessCard.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('./use-profile-checklist.ts', import.meta.url), 'utf8');

  it('renders nothing while loading, when complete, when dismissed, or when a read fails', () => {
    assert.match(card, /if \(dismissed \|\| !items \|\| checklistIsComplete\(items\)\) return null;/);
    assert.match(hook, /\.catch\(\(\) => \{ if \(!cancelled\) setItems\(null\); \}\)/);
  });

  // L2: the dismissal must outlive the tab; the 10-minute answer cache need not. Since §15.4.1 E
  // the two live apart — the cache in the shared hook, the dismissal on the card alone.
  it('keeps the dismissal in localStorage and the answer cache in sessionStorage', () => {
    assert.match(card, /readChecklistDismissal\(typeof window === 'undefined' \? undefined : window\.localStorage, companyId\)/);
    assert.match(card, /dismissChecklistFor\(typeof window === 'undefined' \? undefined : window\.localStorage, companyId\)/);
    assert.match(hook, /const storage = typeof window === 'undefined' \? undefined : window\.sessionStorage;/);
  });

  // L1: a save makes the cached answer wrong. `saveShop` now carries the VAT answer too.
  it('is invalidated by every save on the profile page', () => {
    const page = readFileSync(new URL('./CompanyProfilePage.tsx', import.meta.url), 'utf8');
    for (const handler of ['const saveShop', 'const saveEmail', 'const savePassword']) {
      const start = page.indexOf(handler);
      assert.notEqual(start, -1, handler);
      const body = page.slice(start, page.indexOf('\n  };', start));
      assert.match(body, /invalidateChecklist\(\)/, `${handler}: the dashboard would keep showing the completed item as missing`);
    }
    assert.match(page, /clearChecklistCache\(typeof window === 'undefined' \? undefined : window\.sessionStorage, companyId\)/);
  });

  it('reads the cache before it reaches for the network', () => {
    const effect = hook.slice(hook.indexOf('useEffect(() => {'));
    const cacheAt = effect.indexOf('readChecklistCache(');
    const fetchAt = effect.indexOf('loadChecklist(');
    assert.notEqual(cacheAt, -1, 'the cache read is what stops two GETs on every dashboard mount');
    assert.ok(cacheAt < fetchAt, 'the cache must be consulted first, or it saves nothing');
    assert.match(effect, /if \(cached\) \{ setItems\(cached\); return undefined; \}/);
    assert.match(hook, /writeChecklistCache\(storage, companyId, items\)/);
    // Two consumers mount together on the settings page; without this they fire the same pair.
    assert.match(hook, /inFlight\.set\(companyId, request\)/);
  });

  it('offers "ไว้ก่อน" and actually records it', () => {
    assert.match(card, /ไว้ก่อน/);
    const handler = card.slice(card.indexOf('const dismiss = () => {'), card.indexOf('return (', card.indexOf('const dismiss')));
    assert.match(handler, /^\s*dismissChecklistFor\(/m, 'the button must record the dismissal, not merely mention it');
    assert.match(handler, /setDismissed\(true\)/);
  });
});
