import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExpenseBuyerAsPrinted, TaxClaimability } from '@watchdog-bms/contracts';
import { t } from '../../common/i18n/workspace-i18n.logic';
import { buyerMatchBannerState } from './expense-buyer-match.logic';

// Vendor-address §8 Slice 2 / AC13: the review-page banner for the buyer a full tax invoice printed.
const MISMATCH: ExpenseBuyerAsPrinted = {
  name: 'บริษัท ร้านอื่น จำกัด', taxId: '0105512345678', matchStatus: 'MISMATCH', reasons: ['TAX_ID'],
  differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: '0994000163011' }], checkedAt: '2026-09-21T00:00:00.000Z',
};
const REVIEWER = ['expense.review', 'expense.confirm', 'company.setup.read'];
const taxLine = (claimability: TaxClaimability, finalized = false) => ({
  taxSnapshot: { taxCodeDefinitionId: 'def-1', externalTaxCode: claimability === 'CLAIMABLE' ? 'V7' : 'ND', claimability },
  ...(finalized ? { taxComponents: [{ snapshot: { claimability } }] } : {}),
});

function state(overrides: {
  buyerAsPrinted?: ExpenseBuyerAsPrinted | null; sourceDocumentType?: string; status?: string; postingStatus?: string;
  inputVatClaimStatus?: string; permissions?: string[]; editable?: boolean; claimed?: boolean; lines?: unknown[];
} = {}) {
  return buyerMatchBannerState({
    companyId: 'co-1',
    detail: {
      sourceDocumentType: (overrides.sourceDocumentType ?? 'TAX_INVOICE') as never,
      buyerAsPrinted: overrides.buyerAsPrinted === undefined ? MISMATCH : overrides.buyerAsPrinted,
      status: (overrides.status ?? 'NEEDS_REVIEW') as never,
      postingStatus: (overrides.postingStatus ?? 'not_required') as never,
      inputVatClaimStatus: (overrides.inputVatClaimStatus ?? 'CLAIMABLE') as never,
      lines: (overrides.lines ?? []) as never,
    },
    permissions: overrides.permissions ?? REVIEWER,
    editable: overrides.editable ?? true,
    claimed: overrides.claimed ?? false,
  });
}

describe('buyerMatchBannerState — header path (no line carries a Tax Code)', () => {
  it('shows the warning card with each difference, printed against registered, and both ways forward', () => {
    const banner = state();
    assert.equal(banner.kind, 'mismatch');
    if (banner.kind !== 'mismatch') return;
    assert.deepEqual(banner.differences, [
      { reason: 'TAX_ID', labelKey: 'expenses.buyer_match_reason_tax_id', printed: '0-1055-12345-67-8', registered: '0-9940-00163-01-1' },
    ]);
    assert.equal(banner.canConfirm, true);
    assert.equal(banner.canMarkNonClaimable, true);
    assert.equal(banner.markHintKey, null);
    assert.equal(banner.openLines, false);
    assert.equal(banner.restoreClaimStatus, null);
    assert.equal(t('expenses.buyer_match_title', 'th'), 'ชื่อ/ที่อยู่ผู้ซื้อบนใบไม่ตรงทะเบียนบริษัท');
    assert.equal(t('expenses.buyer_match_confirm', 'th'), 'ยืนยันว่าใช้ได้ พร้อมเหตุผล');
    assert.equal(t('expenses.buyer_match_mark_non_claimable', 'th'), 'ไม่นำ VAT ของใบนี้ไปใช้ตอนยื่นภาษี');
  });

  it('offers the confirm only to expense.confirm holders', () => {
    const banner = state({ permissions: ['expense.review'] });
    assert.equal(banner.kind === 'mismatch' && banner.canConfirm, false);
  });

  it('never leaves a missing mark button unexplained', () => {
    const cases: Array<[Parameters<typeof state>[0], string]> = [
      [{ inputVatClaimStatus: 'NON_CLAIMABLE' }, 'expenses.buyer_match_already_not_claimed'],
      [{ editable: false, status: 'CONFIRMED' }, 'expenses.buyer_match_mark_locked'],
      [{ editable: false, claimed: true }, 'expenses.buyer_match_mark_via_claim'],
      [{ permissions: ['expense.confirm'] }, 'expenses.buyer_match_mark_needs_reviewer'],
    ];
    for (const [overrides, key] of cases) {
      const banner = state(overrides);
      assert.equal(banner.kind, 'mismatch', key);
      if (banner.kind !== 'mismatch') continue;
      assert.equal(banner.canMarkNonClaimable, false, key);
      assert.equal(banner.markHintKey, key);
      assert.notEqual(t(banner.markHintKey as never, 'th'), key, `${key} has Thai text`);
      assert.notEqual(t(banner.markHintKey as never, 'en'), key, `${key} has English text`);
    }
    // The confirm is an annotation, not an edit: a confirmed expense can still carry it.
    const confirmed = state({ editable: false, status: 'CONFIRMED' });
    assert.equal(confirmed.kind === 'mismatch' && confirmed.canConfirm, true);
  });

  it('no longer tells the user the mark cannot be undone', () => {
    assert.doesNotMatch(t('expenses.buyer_match_mark_message', 'th'), /ไม่มีปุ่มเปลี่ยนกลับ/);
    assert.match(t('expenses.buyer_match_mark_message', 'th'), /ยกเลิกเครื่องหมาย/);
    assert.doesNotMatch(t('expenses.buyer_match_mark_message', 'en'), /no way to switch it back/);
  });
});

describe('buyerMatchBannerState — review fix 2: the mark can be taken back', () => {
  const marked = { ...MISMATCH, claimStatusBeforeMark: 'CLAIMABLE' as const };

  it('offers the undo, with the status the mark replaced, instead of the mark', () => {
    const banner = state({ buyerAsPrinted: marked, inputVatClaimStatus: 'NON_CLAIMABLE' });
    assert.equal(banner.kind, 'mismatch');
    if (banner.kind !== 'mismatch') return;
    assert.equal(banner.restoreClaimStatus, 'CLAIMABLE');
    assert.equal(banner.canMarkNonClaimable, false);
    assert.equal(banner.markHintKey, 'expenses.buyer_match_marked_non_claimable');
    assert.equal(t('expenses.buyer_match_undo', 'th'), 'ยกเลิกเครื่องหมาย');
    const needsReview = state({ buyerAsPrinted: { ...marked, claimStatusBeforeMark: 'NEEDS_REVIEW' }, inputVatClaimStatus: 'NON_CLAIMABLE' });
    assert.equal(needsReview.kind !== 'none' && needsReview.restoreClaimStatus, 'NEEDS_REVIEW');
  });

  it('keeps the undo reachable after a re-check stopped warning, and after a confirm with reason', () => {
    assert.deepEqual(state({ buyerAsPrinted: { ...marked, matchStatus: 'MATCH', reasons: undefined, differences: undefined }, inputVatClaimStatus: 'NON_CLAIMABLE' }),
      { kind: 'marked', restoreClaimStatus: 'CLAIMABLE' });
    const confirmed = state({ buyerAsPrinted: { ...marked, overrideReason: 'ออกในชื่อเดิม' }, inputVatClaimStatus: 'NON_CLAIMABLE' });
    assert.deepEqual(confirmed, { kind: 'confirmed', reason: 'ออกในชื่อเดิม', restoreClaimStatus: 'CLAIMABLE' });
  });

  it('offers no undo once claimable again, without a stamp, outside the editable statuses, or without expense.review', () => {
    for (const overrides of [
      { buyerAsPrinted: marked, inputVatClaimStatus: 'CLAIMABLE' },
      { buyerAsPrinted: MISMATCH, inputVatClaimStatus: 'NON_CLAIMABLE' },
      { buyerAsPrinted: marked, inputVatClaimStatus: 'NON_CLAIMABLE', editable: false, status: 'CONFIRMED' },
      { buyerAsPrinted: marked, inputVatClaimStatus: 'NON_CLAIMABLE', permissions: ['expense.confirm'] },
    ]) {
      const banner = state(overrides);
      assert.equal(banner.kind !== 'none' && banner.restoreClaimStatus, null, JSON.stringify(overrides));
    }
    assert.deepEqual(state({ buyerAsPrinted: { ...marked, matchStatus: 'MATCH' }, inputVatClaimStatus: 'CLAIMABLE' }), { kind: 'none' });
  });
});

describe('buyerMatchBannerState — review fix 1: a line Tax Code decides the claim, not the header', () => {
  it('never offers the header mark on the tax-code path and points at the line Tax Code instead', () => {
    for (const lines of [[taxLine('CLAIMABLE')], [{}, taxLine('CLAIMABLE', true)]]) {
      const banner = state({ lines });
      assert.equal(banner.kind, 'mismatch');
      if (banner.kind !== 'mismatch') continue;
      assert.equal(banner.canMarkNonClaimable, false);
      assert.equal(banner.markHintKey, 'expenses.buyer_match_change_line_tax_code');
      assert.equal(banner.openLines, true);
      assert.equal(banner.canConfirm, true, 'the confirm-with-reason stays available');
    }
    assert.match(t('expenses.buyer_match_change_line_tax_code', 'th'), /รูปแบบ VAT ของแต่ละรายการ/);
    assert.match(t('expenses.buyer_match_change_line_tax_code', 'th'), /แก้รูปแบบ VAT ของแต่ละรายการให้ใช้ตอนยื่นภาษีไม่ได้ แล้วบันทึก/);
  });

  it('says so, and stops asking, once no line claims input VAT', () => {
    const banner = state({ lines: [taxLine('NONDEDUCTIBLE_EXPENSE', true)] });
    assert.equal(banner.kind === 'mismatch' && banner.markHintKey, 'expenses.buyer_match_line_tax_not_claimed');
    assert.equal(banner.kind === 'mismatch' && banner.openLines, false);
  });

  it('gives the locked or reviewer way forward when the lines cannot be changed here', () => {
    const cases: Array<[Parameters<typeof state>[0], string]> = [
      [{ editable: false, status: 'CONFIRMED' }, 'expenses.buyer_match_mark_locked'],
      [{ editable: false, claimed: true }, 'expenses.buyer_match_mark_via_claim'],
      [{ permissions: ['expense.confirm'] }, 'expenses.buyer_match_mark_needs_reviewer'],
    ];
    for (const [overrides, key] of cases) {
      const banner = state({ ...overrides, lines: [taxLine('CLAIMABLE')] });
      assert.equal(banner.kind === 'mismatch' && banner.markHintKey, key, key);
      assert.equal(banner.kind === 'mismatch' && banner.openLines, false, key);
    }
  });
});

describe('buyerMatchBannerState — other states', () => {
  it('turns a confirmed override into one muted line', () => {
    assert.deepEqual(state({ buyerAsPrinted: { ...MISMATCH, overrideReason: ' ออกในชื่อเดิม ' } }),
      { kind: 'confirmed', reason: 'ออกในชื่อเดิม', restoreClaimStatus: null });
    assert.equal(t('expenses.buyer_match_confirmed', 'th').replace('{reason}', 'ออกในชื่อเดิม'), 'ยืนยันแล้วว่าใช้ได้: ออกในชื่อเดิม');
  });

  it('links an UNCHECKED comparison to the shop details settings, or says who can when the viewer cannot', () => {
    const unchecked = { ...MISMATCH, matchStatus: 'UNCHECKED' as const, reasons: undefined, differences: undefined };
    assert.deepEqual(state({ buyerAsPrinted: unchecked }), { kind: 'unchecked', settingsHref: '/companies/co-1/settings/profile#shop', restoreClaimStatus: null });
    assert.deepEqual(state({ buyerAsPrinted: unchecked, permissions: ['expense.review'] }), { kind: 'unchecked', settingsHref: null, restoreClaimStatus: null });
    assert.equal(t('expenses.buyer_match_unchecked', 'th'), 'ยังเทียบผู้ซื้อบนใบไม่ได้ เพราะยังไม่ตั้งค่าที่อยู่บริษัท');
  });

  it('renders nothing for MATCH, NOT_PRINTED, no comparison, another document type, or a closed record', () => {
    for (const overrides of [
      { buyerAsPrinted: { ...MISMATCH, matchStatus: 'MATCH' as const } },
      { buyerAsPrinted: { matchStatus: 'NOT_PRINTED' as const, checkedAt: 'now' } },
      { buyerAsPrinted: null },
      { sourceDocumentType: 'ABBREVIATED_TAX_INVOICE' },
      { status: 'VOIDED' },
      { postingStatus: 'reversed' },
    ]) {
      assert.deepEqual(state(overrides), { kind: 'none' }, JSON.stringify(overrides));
    }
  });
});
