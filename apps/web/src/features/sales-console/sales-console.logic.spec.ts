import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_TIER_PRESETS, SALES_ERROR_CODES, type SalesDealStatus, type SalesMyWorkItem } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  agentStatusMeta, baseTierDefaults, companyReferral, dealInputFromForm, dealOverLimit, dealPaymentNote, dealWarnings,
  emptyAgentForm, emptyDealForm, firstDealErrorField, formatBaht, isDealCancellable, isDealEditable,
  isMenuSelected, myWorkBadgeLabel, normalizeSalesCodeInput, parseBahtInput, referralLabel,
  referralWindowOpen, SALES_DEAL_MENU_BINDINGS, SALES_DEAL_STATUS_META, salesCodeError, sortMyWork,
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
});

describe('deal form validation', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateDealForm(dealForm(), { forSubmit: true }), {});
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

  it('validates the login fields for a หัวหน้า without ever asking for tax or bank data (S10)', () => {
    assert.deepEqual(validateAgentForm({ ...emptyAgentForm(), username: 'a.b', displayName: 'ก' }, { withProfile: false }), {});
    assert.ok(validateAgentForm(emptyAgentForm(), { withProfile: false }).username);
    assert.ok(validateAgentForm({ ...emptyAgentForm(), username: 'สมชาย', displayName: 'ก' }, { withProfile: false }).username);
  });

  it('requires the tax/bank block only on the admin console', () => {
    assert.deepEqual(validateAgentForm(filled(), { withProfile: true }), {});
    assert.ok(validateAgentForm({ ...filled(), nationalId: '123' }, { withProfile: true }).nationalId);
    assert.ok(validateAgentForm({ ...filled(), bankAccount: '12' }, { withProfile: true }).bankAccount);
    assert.ok(validateAgentForm({ ...filled(), whtRatePercent: '101' }, { withProfile: true }).whtRatePercent);
  });

  it('rejects a hand-typed sales code that could never resolve', () => {
    assert.ok(validateAgentForm({ ...filled(), salesCode: 'AB' }, { withProfile: true }).salesCode);
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
