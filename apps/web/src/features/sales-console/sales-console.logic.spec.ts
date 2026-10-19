import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parentFeatureKey, PLAN_TIER_PRESETS, planTermStateLabel, SALES_ERROR_CODES, salesDealFeatureKeys, type SalesDealStatus, type SalesDealView, type SalesMyWorkItem, type SalesMyWorkKind, type SalesDealCadence, type SalesDealSnapshot, type SalesReportDeduction, type SalesReportMonth, type SalesReportRow, type SalesReportWaiting } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  agentStatusMeta, baseTierDefaults, companyReferral, dealAutoRenew, dealBadges, dealFormFromView, dealInputFromForm,
  dealOverLimit, dealPaymentNote, dealPriceState, dealTermText,
  dealWarnings, dealCatalogPriceSatang, defaultSalesReportRange, emptyAgentForm, emptyDealForm, firstDealErrorField, formatBaht,
  isDealCancellable, isDealEditable, isMenuSelected, myWorkBadgeLabel, myWorkMeta,
  normalizeSalesCodeInput, parseBahtInput, referralLabel, referralWindowOpen, SALES_ACCESS_STATE_META, SALES_DEAL_MENU_BINDINGS,
  SALES_DEAL_STATUS_META, SALES_DEDUCTION_RULE, SALES_WAITING, SALES_WAITING_NOTE, salesAgentAddress, salesCodeError, salesDeductionLine,
  salesFlagConfirmEffect, salesFlagLabel, salesFlagReview, salesReportLeads, salesReportRangeError,
  salesReportRowsOf, salesReportTotals, salesWaitingLine, salesWaitingNotice, sortMyWork, sortSalesReportMonths,
  toggleMenuSelection, validateAgentForm, validateDealForm, type SalesDealFormValues,
} from './sales-console.logic';

function dealForm(overrides: Partial<SalesDealFormValues> = {}): SalesDealFormValues {
  return { ...emptyDealForm(), companyId: 'c1', priceBaht: '2490', internalReason: 'ลูกค้าเก่า ต่อสัญญา', ...overrides };
}

describe('deal price in baht', () => {
  it('converts without floating-point drift, which is the whole reason this is not Number(x) * 100', () => {
    assert.deepEqual(parseBahtInput('2000.50'), { ok: true, satang: 200050 });
    assert.deepEqual(parseBahtInput('249'), { ok: true, satang: 24900 });
    assert.deepEqual(parseBahtInput('1,299.99'), { ok: true, satang: 129999 });
  });

  it('refuses a third decimal rather than rounding money the เซลล์ did not type', () => {
    assert.equal(parseBahtInput('10.005').ok, false);
    assert.equal(parseBahtInput('-5').ok, false);
    assert.equal(parseBahtInput('abc').ok, false);
  });

  it('formats back to Thai baht with both decimals', () => {
    assert.equal(formatBaht(24900), '฿249.00');
  });

  it('puts the sign of a negative amount before the ฿', () => {
    assert.equal(formatBaht(-49900), '-฿499.00');
    assert.equal(formatBaht(-123456789), '-฿1,234,567.89');
    assert.equal(formatBaht(0), '฿0.00');
  });
});

describe('deal form validation', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateDealForm(dealForm(), { forSubmit: true }), {});
    assert.deepEqual(validateDealForm(dealForm({ featureKeys: ['wht_pnd53', 'wht_50bis'] })), {});
    assert.ok(validateDealForm(dealForm({ featureKeys: ['thai_tax'] })).featureKeys);
  });

  it('needs a shop, a price above zero and 1–36 months (D1/R3)', () => {
    assert.match(validateDealForm(dealForm({ companyId: '' })).companyId ?? '', /เลือกร้านค้า/);
    assert.match(validateDealForm(dealForm({ priceBaht: '0' })).priceBaht ?? '', /มากกว่า 0/);
    assert.match(validateDealForm(dealForm({ priceBaht: '' })).priceBaht ?? '', /กรอกราคา/);
    assert.ok(validateDealForm(dealForm({ months: '37' })).months);
    assert.ok(validateDealForm(dealForm({ months: '0' })).months);
    assert.ok(validateDealForm(dealForm({ months: '1.5' })).months);
    // D1 is explicit that there is no ceiling: a six-figure deal is a business decision, not an error.
    assert.deepEqual(validateDealForm(dealForm({ priceBaht: '250000' })), {});
  });

  it('allows a zero limit but never a fractional or negative one', () => {
    assert.deepEqual(validateDealForm(dealForm({ branchLimit: '0' })), {});
    assert.ok(validateDealForm(dealForm({ employeeLimit: '-1' })).employeeLimit);
    assert.ok(validateDealForm(dealForm({ monthlySlipLimit: '2.5' })).monthlySlipLimit);
  });

  it('keeps the customer note within 200 characters and free of "+" (S24)', () => {
    assert.ok(validateDealForm(dealForm({ description: 'x'.repeat(201) })).description);
    assert.match(validateDealForm(dealForm({ description: 'ครบวงจร + คลังสินค้า' })).description ?? '', /\+/);
    assert.deepEqual(validateDealForm(dealForm({ description: 'ส่วนลดพิเศษสำหรับร้านคุณ' })), {});
  });

  it('demands the internal reason only when the deal goes to a หัวหน้า', () => {
    assert.deepEqual(validateDealForm(dealForm({ internalReason: '' }), { forSubmit: false }), {});
    assert.ok(validateDealForm(dealForm({ internalReason: '' }), { forSubmit: true }).internalReason);
    assert.ok(validateDealForm(dealForm({ internalReason: 'x'.repeat(501) })).internalReason);
  });

  it('reports the first error in the order the form is read', () => {
    const errors = validateDealForm(dealForm({ companyId: '', months: '99' }));
    assert.equal(firstDealErrorField(errors), 'companyId');
    assert.equal(firstDealErrorField({}), null);
  });

  it('treats an empty AI credit box as the tier default and refuses 0 (D-P3-2)', () => {
    assert.equal(dealInputFromForm(dealForm({ aiBudgetBaht: '' })).aiMonthlyBudgetSatang, null);
    assert.equal(dealInputFromForm(dealForm({ aiBudgetBaht: '80' })).aiMonthlyBudgetSatang, 8000);
    assert.deepEqual(validateDealForm(dealForm({ aiBudgetBaht: '' })), {});
    assert.deepEqual(validateDealForm(dealForm({ aiBudgetBaht: '1' })), {});
    // Closing AI is removing its menu; a 0 budget would be refused at apply, so it is refused here.
    assert.ok(validateDealForm(dealForm({ aiBudgetBaht: '0' })).aiBudgetBaht);
    assert.ok(validateDealForm(dealForm({ aiBudgetBaht: '0.00' })).aiBudgetBaht);
  });

  it('builds a request body with trimmed text and satang money', () => {
    const input = dealInputFromForm(dealForm({ priceBaht: '2490', description: '  ส่วนลด  ', internalReason: '  เหตุผล  ' }));
    assert.equal(input.priceSatang, 249000);
    assert.equal(input.description, 'ส่วนลด');
    assert.equal(input.internalReason, 'เหตุผล');
  });
});

describe('base tier presets fill the limits', () => {
  it('copies the catalog row rather than restating it', () => {
    assert.deepEqual(baseTierDefaults('PRO_999'), {
      branchLimit: String(PLAN_TIER_PRESETS.PRO_999.branchLimit),
      employeeLimit: String(PLAN_TIER_PRESETS.PRO_999.employeeLimit),
      monthlySlipLimit: String(PLAN_TIER_PRESETS.PRO_999.monthlySlipLimit),
    });
  });
});

describe('SALES_ACCESS_STATE_META', () => {
  // R-C7 (purchase-without-setup): one label source for the whole product — the sales console's
  // ACTIVE row must read the same as the picker/switcher/billing badge, not its own "ใช้งานอยู่".
  it('takes every label from the shared contracts helper', () => {
    assert.equal(SALES_ACCESS_STATE_META.ACTIVE.label, planTermStateLabel('ACTIVE'));
    assert.equal(SALES_ACCESS_STATE_META.NO_PACKAGE.label, 'ยังไม่มีแพ็กเกจ');
    assert.equal(SALES_ACCESS_STATE_META.TRIAL.label, planTermStateLabel('TRIAL'));
    assert.equal(SALES_ACCESS_STATE_META.EXPIRED.label, planTermStateLabel('EXPIRED'));
  });
});

describe('deal warnings never block, they only tell the เซลล์ what they are about to sell', () => {
  const base = { priceSatang: null, catalogPriceSatang: null, accessState: null, usage: null, branchLimit: null, employeeLimit: null } as const;

  it('warns when the price is above the catalog price of the same base tier and months', () => {
    assert.match(dealWarnings({ ...base, priceSatang: 300000, catalogPriceSatang: 249000 })[0] ?? '', /สูงกว่าราคาปกติ/);
    assert.deepEqual(dealWarnings({ ...base, priceSatang: 200000, catalogPriceSatang: 249000 }), []);
  });

  it('warns that a running package does not carry over (Q5)', () => {
    for (const state of ['TRIAL', 'ACTIVE'] as const) {
      assert.match(dealWarnings({ ...base, accessState: state })[0] ?? '', /ไม่ทบ/);
    }
    assert.deepEqual(dealWarnings({ ...base, accessState: 'NO_PACKAGE' }), []);
    assert.deepEqual(dealWarnings({ ...base, accessState: 'EXPIRED' }), []);
  });

  it('names how far over the new limits the shop already is (S31)', () => {
    const warning = dealWarnings({ ...base, usage: { branchCount: 3, employeeCount: 8 }, branchLimit: 2, employeeLimit: 5 })[0] ?? '';
    assert.match(warning, /1 สาขา/);
    assert.match(warning, /3 ผู้ใช้/);
    assert.match(warning, /ของเดิมคงอยู่/);
  });

  it('says nothing about limits before the counts are known', () => {
    assert.deepEqual(dealOverLimit(null, { branchLimit: 1, employeeLimit: 1 }), { branches: 0, employees: 0 });
    assert.deepEqual(dealOverLimit({ branchCount: 1, employeeCount: 2 }, { branchLimit: 2, employeeLimit: 5 }), { branches: 0, employees: 0 });
  });
});

describe('company referral (D6 admin repair)', () => {
  const REFERRAL = { userId: 'u1', displayName: 'QA เซลล์', salesCode: 'TON', referredAt: '2026-09-01T00:00:00.000Z', source: 'SIGNUP_CODE' as const };

  it('reads the referral off a partner detail that carries it, and shrugs at one that does not', () => {
    assert.deepEqual(companyReferral({ referralSales: REFERRAL }), REFERRAL);
    // The DTO has not declared the field yet, so every one of these has to be a quiet null rather
    // than a crash on the ข้อมูลบริษัท card.
    for (const detail of [undefined, null, {}, { referralSales: null }, { referralSales: 'TON' }, { referralSales: { salesCode: 'TON' } }]) {
      assert.equal(companyReferral(detail), null, JSON.stringify(detail));
    }
  });

  it('names the credited เซลล์, or says there is none', () => {
    assert.equal(referralLabel(REFERRAL), 'QA เซลล์ (TON)');
    assert.equal(referralLabel(null), 'ไม่มี');
  });

  it('closes the edit exactly when the API does — 30 days from the shop being created', () => {
    const created = '2026-09-01T00:00:00.000Z';
    assert.equal(referralWindowOpen(created, new Date('2026-09-01T00:00:01.000Z')), true);
    assert.equal(referralWindowOpen(created, new Date('2026-09-30T23:00:00.000Z')), true, 'day 30 is still inside');
    assert.equal(referralWindowOpen(created, new Date('2026-10-02T00:00:00.000Z')), false);
    // A missing or unparseable createdAt may never open an edit the server would refuse.
    for (const value of [null, undefined, '', 'not-a-date']) assert.equal(referralWindowOpen(value), false, String(value));
  });
});

describe('deal status vocabulary', () => {
  it('has Thai for every status the API can answer with', () => {
    for (const status of Object.keys(SALES_DEAL_STATUS_META) as SalesDealStatus[]) {
      assert.ok(SALES_DEAL_STATUS_META[status].label.trim(), status);
      assert.doesNotMatch(SALES_DEAL_STATUS_META[status].label, /[A-Z_]{4,}/, `${status} leaks its enum name`);
    }
  });

  it('tells the เซลล์ what happened after the customer paid, with dates, never timestamps', () => {
    const row = (status: SalesDealStatus, paidAt: string | null = null, appliedAt: string | null = null) => ({ status, paidAt, appliedAt });
    assert.equal(dealPaymentNote(row('APPROVED')), null);
    assert.equal(dealPaymentNote(row('DRAFT')), null);
    assert.match(dealPaymentNote(row('PAID')) ?? '', /^ลูกค้าชำระแล้ว · กำลังเปิดสิทธิ์/);
    assert.equal(dealPaymentNote(row('APPLIED')), 'ลูกค้าชำระแล้ว · เปิดใช้งานให้ร้านแล้ว');
    const applied = dealPaymentNote(row('APPLIED', null, '2026-09-21T03:00:00.000Z')) ?? '';
    assert.match(applied, /^ลูกค้าชำระแล้ว · เริ่มใช้งาน .+/);
    assert.doesNotMatch(applied, /\d{4}-\d{2}-\d{2}|T\d{2}:/);
    // APPLIED before its own timestamp is observed still reads off the payment date.
    assert.match(dealPaymentNote(row('APPLIED', '2026-09-21T03:00:00.000Z')) ?? '', /^ลูกค้าชำระแล้ว · เริ่มใช้งาน .+/);
    assert.match(dealPaymentNote(row('PAID', '2026-09-21T03:00:00.000Z')) ?? '', /กำลังเปิดสิทธิ์ให้ร้าน$/);
  });

  it('opens editing only on DRAFT and REJECTED, and cancel only before money moves', () => {
    assert.deepEqual(
      (Object.keys(SALES_DEAL_STATUS_META) as SalesDealStatus[]).filter(isDealEditable),
      ['DRAFT', 'REJECTED'],
    );
    assert.deepEqual(
      (Object.keys(SALES_DEAL_STATUS_META) as SalesDealStatus[]).filter(isDealCancellable),
      ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'],
    );
  });
});

describe('menus a deal may grant', () => {
  /**
   * A parent feature with two menus behind it and NO menu that is the parent itself — the only
   * shape in which "does the parent survive?" has an unambiguous answer, because a binding whose
   * own entitlement key IS the parent (ลูกค้า (CRM), แดชบอร์ด …) holds the parent up on its own.
   * Derived rather than hardcoded so a catalogue reshuffle moves the test instead of breaking it.
   */
  const sharedParent = [...new Set(SALES_DEAL_MENU_BINDINGS.map((binding) => binding.parentFeatureKey!))]
    .map((parent) => SALES_DEAL_MENU_BINDINGS.filter((binding) => binding.parentFeatureKey === parent))
    .find((group) => group.length >= 2 && !group.some((binding) => binding.entitlementKeys.includes(binding.parentFeatureKey!)));

  it('only offers menus that are actually built', () => {
    assert.ok(SALES_DEAL_MENU_BINDINGS.length > 5);
    assert.ok(SALES_DEAL_MENU_BINDINGS.every((binding) => binding.status === 'ready' && binding.navigation !== 'contextual'));
  });

  it('turns a menu on together with the feature that carries it', () => {
    const binding = SALES_DEAL_MENU_BINDINGS[0]!;
    const keys = toggleMenuSelection([], binding, true);
    assert.ok(isMenuSelected(keys, binding));
    assert.ok(keys.includes(binding.parentFeatureKey!));
  });

  it('keeps a shared parent alive while a sibling menu is still sold', () => {
    assert.ok(sharedParent, 'no parent feature with two independent menus — check the catalogue');
    const [first, second] = sharedParent as [typeof SALES_DEAL_MENU_BINDINGS[number], typeof SALES_DEAL_MENU_BINDINGS[number]];
    const parent = first.parentFeatureKey!;
    const both = toggleMenuSelection(toggleMenuSelection([], first, true), second, true);
    const afterOff = toggleMenuSelection(both, first, false);
    assert.equal(isMenuSelected(afterOff, first), false);
    assert.ok(isMenuSelected(afterOff, second), 'sibling menu lost its own entitlement');
    assert.ok(afterOff.includes(parent), 'sibling menu lost the parent feature that carries it');
    // ...and the parent does go when the last menu behind it does.
    assert.equal(toggleMenuSelection(afterOff, second, false).includes(parent), false);
  });

  it('picks a menu together with its submenus after "ล้างทั้งหมด", and clears them with it (B3)', () => {
    // Paying a deal writes every key that is not in the list as OFF. The parent key alone used to
    // be all a tap added, so the shop paid and found every expense submenu switched off.
    const expenses = SALES_DEAL_MENU_BINDINGS.find((binding) => binding.navKey === 'expenses')!;
    assert.deepEqual(toggleMenuSelection([], expenses, true), ['expenses', 'expenses.list', 'expenses.upload',
      'expenses.manual', 'expenses.categories', 'expenses.evidence', 'expenses.signatures']);

    for (const binding of SALES_DEAL_MENU_BINDINGS) {
      const picked = toggleMenuSelection([], binding, true);
      // The same rule the server saves by: nothing it would add is missing from what the form sends.
      assert.deepEqual(picked, salesDealFeatureKeys(picked), `${binding.navKey}: a parent was sent without its submenus`);
      // A menu that IS its parent feature brought the submenus, so switching it off takes them back.
      if (binding.entitlementKeys.includes(binding.parentFeatureKey!)) {
        assert.deepEqual(toggleMenuSelection(picked, binding, false), [], `${binding.navKey}: part of the menu stayed behind`);
      }
    }
    // Switching the menu off in a deal that started from the full preset leaves no orphan submenu.
    assert.deepEqual(toggleMenuSelection(emptyDealForm().featureKeys, expenses, false).filter((key) => parentFeatureKey(key) === 'expenses'), []);
  });
});

describe('งานของฉัน (Q6)', () => {
  const item = (kind: SalesMyWorkItem['kind'], at: string): SalesMyWorkItem =>
    ({ kind, at, deal: { id: kind } as unknown as SalesMyWorkItem['deal'] });

  it('puts what needs doing above what is only informational', () => {
    const sorted = sortMyWork([
      item('DEAL_APPROVED_WAITING', '2026-09-20T00:00:00.000Z'),
      item('DEAL_REJECTED', '2026-09-19T00:00:00.000Z'),
    ]);
    assert.deepEqual(sorted.map((row) => row.kind), ['DEAL_REJECTED', 'DEAL_APPROVED_WAITING']);
  });

  it('renders no badge for zero and caps the loud ones', () => {
    assert.equal(myWorkBadgeLabel(0), null);
    assert.equal(myWorkBadgeLabel(-1), null);
    assert.equal(myWorkBadgeLabel(7), '7');
    assert.equal(myWorkBadgeLabel(120), '99+');
  });
});

describe('sales code (D6)', () => {
  it('lifts to uppercase, drops the rest and stops at six', () => {
    assert.equal(normalizeSalesCodeInput('ab-12'), 'AB12');
    assert.equal(normalizeSalesCodeInput('abcdefgh'), 'ABCDEF');
    assert.equal(normalizeSalesCodeInput('น้องมั่งมี'), '');
  });

  it('accepts 3–6 uppercase alphanumerics and nothing else', () => {
    assert.equal(salesCodeError('AB12'), null);
    assert.ok(salesCodeError('AB'));
    assert.ok(salesCodeError('ABCDEFG'));
  });
});

describe('sales agent form', () => {
  const filled = () => ({
    ...emptyAgentForm(), username: 'somchai.s', displayName: 'สมชาย',
    legalName: 'สมชาย ใจดี', nationalId: '1234567890123', address: 'กรุงเทพ', bankName: 'กสิกรไทย', bankAccount: '1234567890',
  });

  it('requires payroll details when creating a เซลล์, including from a หัวหน้า', () => {
    const errors = validateAgentForm({ ...emptyAgentForm(), username: 'a.b', displayName: 'ก' });
    assert.equal(errors.username, undefined);
    assert.ok(errors.legalName);
    assert.ok(errors.address);
    assert.ok(errors.bankName);
    assert.ok(validateAgentForm(emptyAgentForm()).username);
    assert.ok(validateAgentForm({ ...emptyAgentForm(), username: 'สมชาย', displayName: 'ก' }).username);
  });

  it('validates tax and bank details before creating an account', () => {
    assert.deepEqual(validateAgentForm(filled()), {});
    assert.ok(validateAgentForm({ ...filled(), nationalId: '123' }).nationalId);
    assert.ok(validateAgentForm({ ...filled(), bankAccount: '12' }).bankAccount);
    assert.ok(validateAgentForm({ ...filled(), whtRatePercent: '101' }).whtRatePercent);
  });

  it('keeps an incomplete address out of the payroll profile and formats a complete one', () => {
    const address = { line1: '99 ถนนสีลม', line2: '', postalCode: '10500', province: 'กรุงเทพมหานคร', district: 'บางรัก', subdistrict: 'สีลม' };
    assert.equal(salesAgentAddress({ ...address, subdistrict: '' }), '');
    assert.equal(salesAgentAddress(address), '99 ถนนสีลม สีลม บางรัก กรุงเทพมหานคร 10500');
    assert.ok(validateAgentForm({ ...filled(), address: 'ก'.repeat(501) }).address);
  });

  it('rejects a hand-typed sales code that could never resolve', () => {
    assert.ok(validateAgentForm({ ...filled(), salesCode: 'AB' }).salesCode);
  });

  it('says why a suspended agent is inert rather than showing a bare status key', () => {
    assert.match(agentStatusMeta({ status: 'SUSPENDED' }).label, /ระงับ/);
    assert.equal(agentStatusMeta({ status: 'ACTIVE' }).tone, 'brand');
  });
});

describe('Thai copy for every sales error code', () => {
  // The console is a phone screen in front of a customer: a raw SALES_* identifier there is the
  // failure this map exists to prevent, and the list is the contract's own, not a restatement.
  it('translates every code in SALES_ERROR_CODES, with no enum name left in the sentence', () => {
    const missing = SALES_ERROR_CODES.filter((code) => !translateApiError(code));
    assert.deepEqual(missing, [], `these would reach a เซลล์ as a raw code: ${missing.join(', ')}`);
    for (const code of SALES_ERROR_CODES) {
      assert.doesNotMatch(translateApiError(code)!, /SALES_[A-Z_]+/, code);
    }
  });

  it('answers with the next move on the codes that end a journey', () => {
    for (const [code, expected] of [
      ['SALES_DEAL_SELF_APPROVAL', /หัวหน้าทีม/],
      ['SALES_DEAL_ALREADY_OPEN', /ดีลเดิม|ยกเลิก/],
      ['SALES_CODE_UNKNOWN', /ตรวจสอบกับเซลล์ของคุณ/],
      ['SALES_DEAL_STATE_CONFLICT', /โหลดข้อมูลล่าสุด/],
    ] as const) {
      assert.match(translateApiError(code)!, expected, code);
    }
  });
});

describe('Phase 4: renewal and conversion on a deal row', () => {
  const deal = (over: Partial<Pick<SalesDealView, 'renewalOfRequestId' | 'conversionOf'>> = {}) =>
    ({ renewalOfRequestId: null, conversionOf: null, ...over });

  it('names the two things a status badge cannot say, and says nothing when neither is true', () => {
    assert.deepEqual(dealBadges(deal()), []);
    assert.deepEqual(
      dealBadges(deal({ renewalOfRequestId: 'deal-0', conversionOf: 'CARD_AUTO' })).map((badge) => badge.label),
      ['ต่ออายุจากดีลเดิม', 'แทนที่สมาชิกเดิม'],
    );
  });

  it('gives the new งานของฉัน kind its own Thai line, and never crashes on an unknown one', () => {
    assert.equal(myWorkMeta('DEAL_RENEWAL_PENDING').label, 'ข้อเสนอต่ออายุรออนุมัติ');
    // A kind from a newer API must read as work, not take the whole queue down on a phone.
    const unknown = myWorkMeta('SOMETHING_NEW' as unknown as SalesMyWorkKind);
    assert.equal(unknown.needsAction, false);
    assert.doesNotMatch(unknown.label, /[A-Z_]{4,}/);
  });

  it('sorts the new action kinds above the informational ones', () => {
    const item = (kind: string, at: string) => ({ kind, at, deal: {} } as unknown as SalesMyWorkItem);
    const sorted = sortMyWork([
      item('DEAL_APPLIED', '2026-09-20T00:00:00.000Z'),
      item('DEAL_RENEWAL_PENDING', '2026-09-01T00:00:00.000Z'),
    ]);
    assert.equal(sorted[0]!.kind, 'DEAL_RENEWAL_PENDING');
  });
});

describe('anti-gaming flags (§17.1 / D6)', () => {
  it('says why a row was held back, and never leaks a flag key to the Owner', () => {
    assert.equal(salesFlagLabel('self_referral'), 'ผู้แนะนำและเจ้าของร้านเป็นคนเดียวกัน');
    assert.equal(salesFlagLabel('repeat_owner'), 'เจ้าของเดิมเปิดร้านเพิ่ม');
    assert.equal(salesFlagLabel('referral_anomaly'), 'รูปแบบผิดปกติ (จำนวน/ข้อมูลซ้ำ)');
    // The fallback is the point: a flag added later on the API side must not reach a person raw.
    assert.doesNotMatch(salesFlagLabel('referral_anomaly_v2'), /referral|anomaly|_/);
  });
});

describe('the Owner\'s flag queue (§17.1 — where each flagged row stands)', () => {
  const flagged = (over: { flags?: ('self_referral' | 'repeat_owner' | 'referral_anomaly')[]; reviewedAt?: string | null; reviewNote?: string | null } = {}) =>
    ({ flags: ['self_referral' as const], reviewedAt: null, reviewNote: null, ...over });

  it('offers both decisions while a row waits for review', () => {
    assert.deepEqual(salesFlagReview(flagged()),
      { label: 'รอตรวจ · ยังไม่นับในยอด', tone: 'amber', detail: null, canConfirm: true, canExclude: true });
  });

  it('shows a row the Owner cut out as cut out, with the date and the reason, and still lets it be confirmed', () => {
    assert.deepEqual(salesFlagReview(flagged({ reviewedAt: '2026-10-02T03:00:00.000Z', reviewNote: 'เจ้าของร้านเป็นเซลล์เอง' })), {
      label: 'ตัดออกจากยอดแล้ว · ไม่นับให้เซลล์', tone: 'danger',
      detail: 'ตรวจเมื่อ 2 ต.ค. 2569 · เหตุผล: เจ้าของร้านเป็นเซลล์เอง', canConfirm: true, canExclude: false,
    });
  });

  it('shows a confirmed row as counted and offers no decision that would change nothing', () => {
    // "ยืนยันว่าไม่ผิดปกติ" cleared the flags, so there is no flag left to keep.
    assert.deepEqual(salesFlagReview(flagged({ flags: [], reviewedAt: '2026-10-02T03:00:00.000Z' })), {
      label: 'ยืนยันแล้วว่าไม่ผิดปกติ · นับในยอด', tone: 'brand', detail: 'ตรวจเมื่อ 2 ต.ค. 2569', canConfirm: false, canExclude: false,
    });
  });

  it('says where a row stands in plain Thai only', () => {
    for (const row of [flagged(), flagged({ reviewedAt: '2026-10-02T03:00:00.000Z' }), flagged({ flags: [], reviewedAt: '2026-10-02T03:00:00.000Z' })]) {
      const review = salesFlagReview(row);
      assert.doesNotMatch(`${review.label} ${review.detail ?? ''}`, /[A-Za-z_]/);
    }
  });
});

describe('shops waiting for review (§17.1, owner 2026-10-02 — no opened shop and no amount until reviewed)', () => {
  const waiting = (over: Partial<SalesReportWaiting> = {}): SalesReportWaiting =>
    ({ salesUserId: 'u1', source: 'REFERRAL', companyName: 'ร้านกาแฟดี', flags: ['repeat_owner'], ...over });

  it('names the waiting shop, how it came in and why it waits, in the words of the Owner\'s queue', () => {
    assert.deepEqual(salesWaitingLine(waiting()), { title: 'ร้านกาแฟดี', detail: 'แนะนำร้าน · เจ้าของเดิมเปิดร้านเพิ่ม' });
    // A lead reading several เซลล์ is told whose shop it is; every reason is listed.
    assert.deepEqual(salesWaitingLine(waiting({ source: 'DEAL', flags: ['self_referral', 'referral_anomaly'] }), 'สมหญิง'), {
      title: 'ร้านกาแฟดี',
      detail: `สมหญิง · ดีลพิเศษ · ${salesFlagLabel('self_referral')} · ${salesFlagLabel('referral_anomaly')}`,
    });
  });

  it('calls a waiting shop the same thing in the report and in the queue', () => {
    assert.equal(SALES_WAITING, 'รอตรวจ');
    assert.equal(salesFlagReview({ flags: ['self_referral'], reviewedAt: null, reviewNote: null }).label, `${SALES_WAITING} · ${SALES_WAITING_NOTE}`);
    assert.equal(salesWaitingNotice(1234),
      'มี 1,234 ร้านรอตรวจ ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอด เมื่อผู้ดูแลระบบยืนยันว่าไม่ผิดปกติ จะนับในเดือนที่ร้านชำระเงิน');
  });

  it('tells the Owner which month gains the shop before it is confirmed, in Bangkok time', () => {
    assert.equal(salesFlagConfirmEffect('2026-09-20T03:00:00.000Z'),
      'ร้านนี้จะนับเป็นร้านที่เปิด และยอดจะนับให้เซลล์ในเดือนที่ร้านชำระเงิน คือ ก.ย. 2569 ระบบบันทึกเหตุผลของคุณไว้');
    // Paid at 00:30 on 1 October in Bangkok: the report counts it in October, and so does this sentence.
    assert.match(salesFlagConfirmEffect('2026-09-30T17:30:00.000Z'), /คือ ต\.ค\. 2569 /);
  });

  it('never shows an id, a key or an English word — not even for a reason or a source it does not know', () => {
    const line = salesWaitingLine({ ...waiting({ companyName: '' }), source: 'PARTNER_V2', flags: ['referral_anomaly_v2'] } as unknown as SalesReportWaiting, 'สมหญิง');
    assert.equal(line.title, 'ไม่พบชื่อร้าน');
    for (const text of [line.title, line.detail, SALES_WAITING, SALES_WAITING_NOTE, salesWaitingNotice(2), salesFlagConfirmEffect('2026-09-20T03:00:00.000Z')]) {
      assert.doesNotMatch(text, /[A-Za-z_]/, text);
    }
  });

  it('keeps each month\'s waiting shops with it, and an answer without the list still renders', () => {
    const row = { salesUserId: 'u1', displayName: 'สมชาย', teamLeadUserId: null, teamLeadDisplayName: null,
      dealActivations: 0, referralActivations: 0, amountSatang: 0, flaggedCount: 1 };
    const [october, september] = sortSalesReportMonths([
      { monthKey: '2026-09', rows: [row] },
      { monthKey: '2026-10', rows: [row], waiting: [waiting()] },
    ]);
    assert.deepEqual(october!.waiting, [waiting()]);
    assert.deepEqual(september!.waiting, []);
  });
});

describe('sales report (§17.2 — one row per shop, so the report is a plain sum)', () => {
  const row = (over: Partial<SalesReportMonth['rows'][number]> = {}) => ({
    salesUserId: 'u1', displayName: 'สมชาย', teamLeadUserId: 'l1', teamLeadDisplayName: null,
    dealActivations: 2, referralActivations: 1, amountSatang: 300_000, flaggedCount: 0, ...over,
  });

  it('totals net amounts and counts, flagged rows carried as a count only', () => {
    const totals = salesReportTotals([row(), row({ salesUserId: 'u2', flaggedCount: 3 })]);
    assert.equal(totals.amountSatang, 600_000);
    assert.equal(totals.dealActivations, 4);
    assert.equal(totals.referralActivations, 2);
    assert.equal(totals.flaggedCount, 3);
    assert.deepEqual(salesReportTotals([]), { dealActivations: 0, referralActivations: 0, amountSatang: 0, flaggedCount: 0 });
  });

  it('groups newest month first, biggest seller first inside it', () => {
    const sorted = sortSalesReportMonths([
      { monthKey: '2026-08', rows: [row()] },
      { monthKey: '2026-09', rows: [row(), row({ salesUserId: 'u2', displayName: 'สมหญิง', amountSatang: 900_000 })] },
    ]);
    assert.deepEqual(sorted.map((month) => month.monthKey), ['2026-09', '2026-08']);
    assert.equal(sorted[0]!.rows[0]!.displayName, 'สมหญิง');
    assert.equal(sorted[0]!.totals.amountSatang, 1_200_000);
    assert.equal(salesReportRowsOf([{ monthKey: '2026-09', rows: [row(), row()] }]).length, 2);
  });

  it('offers only the teams it can put a name to — an internal id is not something a person reads', () => {
    const months: SalesReportMonth[] = [{
      monthKey: '2026-09',
      rows: [
        row({ salesUserId: 'l1', displayName: 'หัวหน้าเอ' }),
        row({ salesUserId: 'u2' }),
        // A lead with no row of their own cannot be named, so their team is not offered.
        row({ salesUserId: 'u3', teamLeadUserId: 'l9' }),
      ],
    }];
    assert.deepEqual(salesReportLeads(months), [{ userId: 'l1', displayName: 'หัวหน้าเอ' }]);
    assert.deepEqual(salesReportLeads([]), []);
  });
});

describe('sales report deductions (§17.1, owner 2026-10-02 — its own line, in the month it happened)', () => {
  const row = (over: Partial<SalesReportRow> = {}): SalesReportRow => ({
    salesUserId: 'u1', displayName: 'สมชาย', teamLeadUserId: 'l1', teamLeadDisplayName: null,
    dealActivations: 0, referralActivations: 0, amountSatang: -49_900, flaggedCount: 0, ...over,
  });
  const deduction = (over: Partial<SalesReportDeduction> = {}): SalesReportDeduction => ({
    salesUserId: 'u1', kind: 'REFUND', companyName: 'ร้านกาแฟดี', paidMonthKey: '2026-09',
    amountSatang: 49_900, occurredAt: '2026-10-05T02:00:00.000Z', ...over,
  });

  it('words a refund and a lost dispute in plain Thai, with the shop and the month of the original payment', () => {
    assert.deepEqual(salesDeductionLine(deduction()), {
      title: 'หักจากการคืนเงิน · ร้านกาแฟดี',
      detail: 'ยอดของเดือน ก.ย. 2569 · คืนเงินเมื่อ 5 ต.ค. 2569',
      amount: '-฿499.00',
    });
    assert.deepEqual(salesDeductionLine(deduction({ kind: 'DISPUTE', amountSatang: 129_000 }), 'สมหญิง'), {
      title: 'หักจากข้อโต้แย้งการชำระ · ร้านกาแฟดี',
      detail: 'สมหญิง · ยอดของเดือน ก.ย. 2569 · เปิดข้อโต้แย้งเมื่อ 5 ต.ค. 2569',
      amount: '-฿1,290.00',
    });
  });

  it('never shows an id, a key, an English word or THB — not even for a kind it does not know', () => {
    for (const kind of ['REFUND', 'DISPUTE', 'CHARGEBACK_V2'] as SalesReportDeduction['kind'][]) {
      const line = salesDeductionLine(deduction({ kind, companyName: '' }), 'สมหญิง');
      assert.doesNotMatch(`${line.title} ${line.detail} ${line.amount}`, /[A-Za-z_]/, kind);
    }
    assert.equal(salesDeductionLine(deduction({ companyName: '' })).title, 'หักจากการคืนเงิน · ไม่พบชื่อร้าน');
    assert.doesNotMatch(SALES_DEDUCTION_RULE, /[A-Za-z_]/);
  });

  it('dates the line in Bangkok time, so a refund at 00:30 on the 1st is not shown as the day before', () => {
    assert.match(salesDeductionLine(deduction({ occurredAt: '2026-09-30T17:30:00.000Z' })).detail, /คืนเงินเมื่อ 1 ต\.ค\. 2569$/);
  });

  it('keeps each month\'s deductions with it and totals a month that went below zero', () => {
    const [october, september] = sortSalesReportMonths([
      { monthKey: '2026-09', rows: [row({ amountSatang: 49_900, referralActivations: 1 })] },
      { monthKey: '2026-10', rows: [row()], deductions: [deduction()] },
    ]);
    assert.equal(october!.totals.amountSatang, -49_900);
    assert.deepEqual(october!.deductions, [deduction()]);
    // An answer that predates the field still renders: no deductions, never undefined.
    assert.deepEqual(september!.deductions, []);
    assert.equal(september!.totals.amountSatang, 49_900);
    assert.equal(salesReportTotals([...october!.rows, ...september!.rows]).amountSatang, 0);
  });
});

describe('report month range', () => {
  it('defaults to last month and this one, in Bangkok', () => {
    assert.deepEqual(defaultSalesReportRange(new Date('2026-09-21T00:00:00.000Z')), { from: '2026-08', to: '2026-09' });
    // Across a year boundary the previous month is December of the year before, not month 0.
    assert.deepEqual(defaultSalesReportRange(new Date('2026-01-05T00:00:00.000Z')), { from: '2025-12', to: '2026-01' });
    // 01:00 Bangkok on the 1st is still the previous month in UTC — the report buckets Bangkok.
    assert.deepEqual(defaultSalesReportRange(new Date('2026-09-30T18:00:00.000Z')), { from: '2026-09', to: '2026-10' });
  });

  it('refuses in Thai exactly what the endpoint refuses as SALES_REPORT_RANGE_INVALID', () => {
    assert.equal(salesReportRangeError({ from: '2026-08', to: '2026-09' }), null);
    assert.equal(salesReportRangeError({ from: '2026-09', to: '2026-09' }), null);
    assert.ok(salesReportRangeError({ from: '2026-10', to: '2026-09' }));
    assert.ok(salesReportRangeError({ from: '', to: '2026-09' }));
    assert.ok(salesReportRangeError({ from: '2026-13', to: '2026-09' }));
    // 24 months is the server's cap, so 25 is refused here rather than at the round trip.
    assert.equal(salesReportRangeError({ from: '2025-01', to: '2026-12' }), null);
    assert.ok(salesReportRangeError({ from: '2024-12', to: '2026-12' }));
  });
});

describe('Phase 5: auto-renewing deals (§17.3 / D-P5-1…6)', () => {
  const autoForm = (over: Partial<SalesDealFormValues> = {}) =>
    dealForm({ autoRenew: true, cadence: 'month', cycles: '', ...over });
  const snapshot = (over: Partial<SalesDealSnapshot> = {}): SalesDealSnapshot => ({
    version: 3, base: 'PRO_999', priceSatang: 79_900, months: 1, branchLimit: 3, employeeLimit: 10,
    monthlySlipLimit: 500, featureKeys: [], aiMonthlyBudgetSatang: null, description: '',
    autoRenew: false, cadence: null, cycles: null, ...over,
  });

  it('reads the v3 snapshot, and reads a v2 one as the one-time deal it is', () => {
    assert.equal(dealAutoRenew({ months: 12 }), null);
    assert.equal(dealAutoRenew({ autoRenew: false, cadence: 'year' }), null);
    assert.deepEqual(dealAutoRenew({ autoRenew: true, cadence: 'year', cycles: 3 }), { cadence: 'year', cycles: 3 });
    // null / 0 / absent all mean "จนกว่าจะเพิกถอน" — there is no zero-cycle deal.
    assert.deepEqual(dealAutoRenew({ autoRenew: true, cadence: 'month', cycles: null }), { cadence: 'month', cycles: null });
    assert.equal(dealAutoRenew({ autoRenew: true, cycles: 0 })!.cycles, null);
    // D-P5-2 allows no other interval, so an unknown one from a newer API reads monthly rather
    // than reaching a เซลล์'s phone as a machine token inside "ต่ออายุทุก…".
    assert.equal(dealAutoRenew({ autoRenew: true, cadence: 'week' as SalesDealCadence })!.cadence, 'month');
    assert.equal(dealAutoRenew(null), null);
  });

  it('says the term in the words the row, the summary and งานของฉัน all share', () => {
    assert.equal(dealTermText({ months: 12 }), '12 เดือน');
    assert.equal(dealTermText(snapshot({ autoRenew: true, cadence: 'month' })), 'ต่ออายุทุกเดือน · จนกว่าจะเพิกถอน');
    assert.equal(dealTermText(snapshot({ autoRenew: true, cadence: 'year', cycles: 3 })), 'ต่ออายุทุกปี · 3 รอบ');
  });

  it('never validates the months box an auto-renewing form does not show, and bounds the cycles', () => {
    // A hidden field cannot be fixed, so validating it would be a submit nobody can unblock.
    assert.equal(validateDealForm(autoForm({ months: '' }), { forSubmit: true }).months, undefined);
    assert.ok(validateDealForm(dealForm({ months: '' }), { forSubmit: true }).months);
    // '' is จนกว่าจะเพิกถอน, not a missing value.
    assert.equal(validateDealForm(autoForm(), { forSubmit: true }).cycles, undefined);
    assert.equal(validateDealForm(autoForm({ cycles: '36' }), { forSubmit: true }).cycles, undefined);
    assert.ok(validateDealForm(autoForm({ cycles: '0' }), { forSubmit: true }).cycles);
    assert.ok(validateDealForm(autoForm({ cycles: '37' }), { forSubmit: true }).cycles);
    assert.ok(validateDealForm(autoForm({ cycles: '1.5' }), { forSubmit: true }).cycles);
  });

  it('sends the three v3 fields, and sends none of them on a one-time deal', () => {
    const once = dealInputFromForm(dealForm({ months: '6' }));
    assert.deepEqual([once.autoRenew, once.cadence, once.cycles, once.months], [false, null, null, 6]);
    const forever = dealInputFromForm(autoForm({ cadence: 'year' }));
    assert.deepEqual([forever.autoRenew, forever.cadence, forever.cycles], [true, 'year', null]);
    assert.equal(dealInputFromForm(autoForm({ cycles: '12' })).cycles, 12);
  });

  it('round-trips a saved auto-renewing deal back into the form it was typed in', () => {
    const view = { company: { companyId: 'c1' }, internalReason: 'ต่อสัญญา',
      snapshot: snapshot({ autoRenew: true, cadence: 'year', cycles: 3 }) } as SalesDealView;
    const form = dealFormFromView(view);
    assert.deepEqual([form.autoRenew, form.cadence, form.cycles], [true, 'year', '3']);
    assert.equal(dealFormFromView({ ...view, snapshot: { ...view.snapshot, autoRenew: false } } as SalesDealView).cycles, '');
  });

  it('badges what the status cannot say: the cycle, the readiness of the price, and the end date', () => {
    const base = { renewalOfRequestId: null, conversionOf: null };
    assert.deepEqual(dealBadges(base), []);
    const labels = dealBadges({ ...base, snapshot: snapshot({ autoRenew: true, cadence: 'year' }),
      priceState: 'PENDING', returnAt: '2027-03-01T00:00:00.000Z' }).map((badge) => badge.label);
    assert.equal(labels[0], 'ต่ออายุอัตโนมัติ · รายปี');
    assert.equal(labels[1], 'กำลังเตรียมราคา');
    assert.match(labels[2]!, /^จบดีล /);
    // D-P5-3: a failed price is a wait too — the sweep retries it — so it never offers a button.
    const failed = dealPriceState({ priceState: 'FAILED' })!;
    assert.equal(failed.tone, 'danger');
    assert.match(failed.note, /ลองใหม่ให้เอง/);
    assert.equal(dealPriceState({ priceState: 'READY' }), null);
    assert.equal(dealPriceState({}), null);
  });

  it('gives the 14-day ending notice its own Thai line, with no enum name in it', () => {
    const meta = myWorkMeta('DEAL_ENDING' as unknown as SalesMyWorkKind);
    assert.equal(meta.needsAction, true);
    assert.match(meta.note, /14 วัน/);
    assert.doesNotMatch(meta.label, /[A-Z_]{4,}/);
  });

  it('names a team lead from the row that carries their name, not only from a row they sold', () => {
    const months: SalesReportMonth[] = [{ monthKey: '2026-09', rows: [
      { salesUserId: 'u1', displayName: 'สมชาย', teamLeadUserId: 'l9', teamLeadDisplayName: 'หัวหน้าเก้า',
        dealActivations: 1, referralActivations: 0, amountSatang: 1000, flaggedCount: 0 } as SalesReportRow,
    ] }];
    assert.deepEqual(salesReportLeads(months), [{ userId: 'l9', displayName: 'หัวหน้าเก้า' }]);
  });
});


it('MONEY-Q1 3000 seeded deal-warning thresholds match catalog monthly/yearly purchase costs', async () => {
  const { billingOffer, SALES_DEAL_BASE_TIERS } = await import('@watchdog-bms/contracts');
  let seed = 5678;
  const pick = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * limit); };
  for (let i = 0; i < 3000; i++) {
    const base = SALES_DEAL_BASE_TIERS[pick(SALES_DEAL_BASE_TIERS.length)]!, months = 1 + pick(36);
    const monthly = billingOffer(base, 'month').priceSatang, yearly = billingOffer(base, 'year').priceSatang, costs = [0];
    for (let n = 1; n <= months; n++) costs[n] = Math.min(costs[n - 1]! + monthly, n >= 12 ? costs[n - 12]! + yearly : Infinity);
    const catalogPriceSatang = dealCatalogPriceSatang(base, months), priceSatang = costs[months]! + pick(20001) - 10000;
    assert.equal(catalogPriceSatang, costs[months]);
    const warnings = dealWarnings({ priceSatang, catalogPriceSatang, accessState: null, usage: null, branchLimit: null, employeeLimit: null });
    assert.equal(warnings.length > 0, priceSatang > costs[months]!);
  }
});
