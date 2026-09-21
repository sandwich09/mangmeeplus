import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExpenseBuyerAsPrinted } from '@watchdog-bms/contracts';
import { t } from '../../common/i18n/workspace-i18n.logic';
import { buyerMatchBannerState } from './expense-buyer-match.logic';

// Vendor-address §8 Slice 2 / AC13: the review-page banner for the buyer a full tax invoice printed.
const MISMATCH: ExpenseBuyerAsPrinted = {
  name: 'บริษัท ร้านอื่น จำกัด', taxId: '0105512345678', matchStatus: 'MISMATCH', reasons: ['TAX_ID'],
  differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: '0994000163011' }], checkedAt: '2026-09-21T00:00:00.000Z',
};
const REVIEWER = ['expense.review', 'expense.confirm', 'company.setup.read'];

function state(overrides: {
  buyerAsPrinted?: ExpenseBuyerAsPrinted | null; sourceDocumentType?: string; status?: string; postingStatus?: string;
  inputVatClaimStatus?: string; permissions?: string[]; editable?: boolean; claimed?: boolean;
} = {}) {
  return buyerMatchBannerState({
    companyId: 'co-1',
    detail: {
      sourceDocumentType: (overrides.sourceDocumentType ?? 'TAX_INVOICE') as never,
      buyerAsPrinted: overrides.buyerAsPrinted === undefined ? MISMATCH : overrides.buyerAsPrinted,
      status: (overrides.status ?? 'NEEDS_REVIEW') as never,
      postingStatus: (overrides.postingStatus ?? 'not_required') as never,
      inputVatClaimStatus: (overrides.inputVatClaimStatus ?? 'NEEDS_REVIEW') as never,
    },
    permissions: overrides.permissions ?? REVIEWER,
    editable: overrides.editable ?? true,
    claimed: overrides.claimed ?? false,
  });
}

describe('buyerMatchBannerState', () => {
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
    assert.equal(t('expenses.buyer_match_title', 'th'), 'ชื่อ/ที่อยู่ผู้ซื้อบนใบไม่ตรงทะเบียนบริษัท');
    assert.equal(t('expenses.buyer_match_confirm', 'th'), 'ยืนยันว่าใช้ได้ พร้อมเหตุผล');
    assert.equal(t('expenses.buyer_match_mark_non_claimable', 'th'), 'ทำเครื่องหมายใบนี้ใช้ภาษีซื้อไม่ได้');
  });

  it('offers the confirm only to expense.confirm holders', () => {
    const banner = state({ permissions: ['expense.review'] });
    assert.equal(banner.kind === 'mismatch' && banner.canConfirm, false);
  });

  it('never leaves a missing mark button unexplained', () => {
    const cases: Array<[Parameters<typeof state>[0], string]> = [
      [{ inputVatClaimStatus: 'NON_CLAIMABLE' }, 'expenses.buyer_match_marked_non_claimable'],
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

  it('turns a confirmed override into one muted line', () => {
    assert.deepEqual(state({ buyerAsPrinted: { ...MISMATCH, overrideReason: ' ออกในชื่อเดิม ' } }), { kind: 'confirmed', reason: 'ออกในชื่อเดิม' });
    assert.equal(t('expenses.buyer_match_confirmed', 'th').replace('{reason}', 'ออกในชื่อเดิม'), 'ยืนยันแล้วว่าใช้ได้: ออกในชื่อเดิม');
  });

  it('links an UNCHECKED comparison to the shop details settings, or says who can when the viewer cannot', () => {
    const unchecked = { ...MISMATCH, matchStatus: 'UNCHECKED' as const, reasons: undefined, differences: undefined };
    assert.deepEqual(state({ buyerAsPrinted: unchecked }), { kind: 'unchecked', settingsHref: '/companies/co-1/settings/profile#shop' });
    assert.deepEqual(state({ buyerAsPrinted: unchecked, permissions: ['expense.review'] }), { kind: 'unchecked', settingsHref: null });
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
