import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  counterpartyAddress,
  counterpartyAddressLine,
  counterpartyAddressMissing,
  counterpartyAddressText,
  counterpartyAutoSaveNotice,
  counterpartyBranchCodeDigits,
  counterpartyFormIssue,
  counterpartyFormValues,
  counterpartyHref,
  counterpartyPayload,
  counterpartyUsageBadges,
} from './counterparties.logic';
import type { CounterpartyDetail } from './counterparties.model';

const V2 = {
  addressText: '99/1 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ',
  postalCode: '10110',
  provenance: { source: 'EXPENSE_AUTO', expenseId: 'exp-1', userId: 'user-1', at: '2026-09-20T03:00:00.000Z' },
  seenOnDocuments: [
    { addressText: '12 ถ.เก่า', expenseId: 'exp-0', at: '2026-08-01T03:00:00.000Z' },
    { addressText: '', expenseId: 'exp-x', at: '2026-07-01T03:00:00.000Z' },
  ],
  locked: true,
};

describe('counterpartyAddressText', () => {
  it('prefers the v2 addressText', () => {
    assert.equal(counterpartyAddressText(V2), V2.addressText);
  });

  it('falls back to the legacy shapes a procurement or CRM row may hold', () => {
    assert.equal(counterpartyAddressText({ address: '  5 ซอยเล็ก  ' }), '5 ซอยเล็ก');
    assert.equal(
      counterpartyAddressText({ line1: '1 หมู่ 2', subdistrict: 'ท่าทราย', province: 'นนทบุรี', postalCode: '11000' }),
      '1 หมู่ 2 ท่าทราย นนทบุรี 11000',
    );
    assert.equal(counterpartyAddressText('  ข้อความล้วน '), 'ข้อความล้วน');
  });

  it('answers empty for nothing printable, which is what drives the ยังไม่มีที่อยู่ badge', () => {
    assert.equal(counterpartyAddressText(null), '');
    assert.equal(counterpartyAddressText({ addressText: '   ' }), '');
    assert.equal(counterpartyAddressMissing({ billingAddressJson: { addressText: '' } }), true);
    assert.equal(counterpartyAddressMissing({ billingAddressJson: V2 }), false);
  });

  it('flattens a multi-line address for a one-line list row', () => {
    assert.equal(counterpartyAddressLine({ addressText: '99/1\nถ.สุขุมวิท   กรุงเทพฯ' }), '99/1 ถ.สุขุมวิท กรุงเทพฯ');
  });
});

describe('counterpartyAddress', () => {
  it('reads the lock, the provenance and the history, dropping unusable history rows', () => {
    const address = counterpartyAddress(V2);
    assert.equal(address.locked, true);
    assert.equal(address.postalCode, '10110');
    assert.equal(address.provenance?.source, 'EXPENSE_AUTO');
    // The blank entry would render a row whose "ใช้อันนี้เป็นหลัก" could only 404 on promote.
    assert.deepEqual(address.seenOnDocuments.map((entry) => entry.addressText), ['12 ถ.เก่า']);
  });

  it('survives a legacy free-shape object with no v2 keys at all', () => {
    const address = counterpartyAddress({ address: '5 ซอยเล็ก' });
    assert.equal(address.addressText, '5 ซอยเล็ก');
    assert.equal(address.locked, false);
    assert.equal(address.provenance, null);
    assert.deepEqual(address.seenOnDocuments, []);
  });
});

describe('counterpartyFormValues', () => {
  it('treats 00000 as head office rather than a branch (CON-8)', () => {
    const base = { id: 'c1', companyId: 'co', type: 'VENDOR', displayName: 'ร้าน', status: 'ACTIVE', createdAt: '', updatedAt: '' };
    assert.equal(counterpartyFormValues({ ...base, branchCode: '00000' } as unknown as CounterpartyDetail).isBranch, false);
    assert.equal(counterpartyFormValues({ ...base, branchCode: '00001' } as unknown as CounterpartyDetail).isBranch, true);
    assert.equal(counterpartyFormValues(null).isBranch, false);
    assert.equal(counterpartyFormValues(null).entityKind, '');
  });
});

describe('counterpartyFormIssue', () => {
  const values = counterpartyFormValues(null);

  it('refuses a blank display name and an over-long address with the fix in the message', () => {
    assert.deepEqual(counterpartyFormIssue(values), { field: 'displayName', messageKey: 'counterparties.v_display_name_required' });
    assert.deepEqual(
      counterpartyFormIssue({ ...values, displayName: 'ร้าน', addressText: 'ก'.repeat(501) }),
      { field: 'addressText', messageKey: 'counterparties.v_address_too_long' },
    );
    assert.equal(counterpartyFormIssue({ ...values, displayName: 'ร้าน', addressText: 'ก'.repeat(500) }), null);
  });

  it('keeps the branch code optional but refuses a partial one', () => {
    const named = { ...values, displayName: 'ร้าน', isBranch: true };
    assert.equal(counterpartyFormIssue({ ...named, branchCode: '' }), null);
    assert.equal(counterpartyFormIssue({ ...named, branchCode: '00001' }), null);
    assert.deepEqual(
      counterpartyFormIssue({ ...named, branchCode: '0001' }),
      { field: 'branchCode', messageKey: 'counterparties.v_branch_code_invalid' },
    );
  });

  it('keeps only digits, capped at five', () => {
    assert.equal(counterpartyBranchCodeDigits('a1b2c3d4e5f6'), '12345');
  });
});

describe('counterpartyPayload', () => {
  it('never sends the server-owned type and clears the code when head office is picked (A5/CON-8)', () => {
    const payload = counterpartyPayload({ ...counterpartyFormValues(null), displayName: ' ร้าน ', branchCode: '00001', isBranch: false });
    assert.equal('type' in payload, false);
    assert.equal(payload.branchCode, '');
    assert.equal(payload.displayName, 'ร้าน');
    assert.equal(payload.email, null, 'a blank email clears the stored value');
    // CON-7: an unset taxpayer class stays unset rather than being decided by the screen.
    assert.equal('entityKind' in payload, false);
    assert.equal(counterpartyPayload({ ...counterpartyFormValues(null), displayName: 'ร้าน', entityKind: 'INDIVIDUAL' }).entityKind, 'INDIVIDUAL');
  });
});

describe('counterpartyAutoSaveNotice', () => {
  const allowed = { canReadCounterparty: true };

  it('says nothing for silence cases (§7 case d)', () => {
    assert.equal(counterpartyAutoSaveNotice(null, allowed), null);
    assert.equal(counterpartyAutoSaveNotice({ case: 'NOOP' }, allowed), null);
    assert.equal(counterpartyAutoSaveNotice({ case: 'SKIPPED' }, allowed), null);
  });

  it('toasts a create and a fill with the shop name (§7 cases a and b)', () => {
    assert.deepEqual(counterpartyAutoSaveNotice({ case: 'CREATE', counterpartyId: 'c1', displayName: 'ร้านก' }, allowed), {
      kind: 'toast', messageKey: 'counterparties.auto_save_created', params: { name: 'ร้านก' }, counterpartyId: 'c1',
    });
    assert.equal(counterpartyAutoSaveNotice({ case: 'FILL', counterpartyId: 'c1', displayName: 'ร้านก' }, allowed)?.messageKey,
      'counterparties.auto_save_filled');
  });

  it('answers case c with a hint, never a toast and never a choice (A4)', () => {
    const open = counterpartyAutoSaveNotice({ case: 'HISTORY', counterpartyId: 'c1' }, allowed);
    assert.equal(open?.kind, 'hint');
    assert.equal(open?.messageKey, 'counterparties.auto_save_history');
    assert.equal(counterpartyAutoSaveNotice({ case: 'HISTORY', counterpartyId: 'c1', locked: true }, allowed)?.messageKey,
      'counterparties.auto_save_history_locked');
  });

  it('shows the bar when the registry write failed, whatever case it was attempting (§8)', () => {
    assert.equal(counterpartyAutoSaveNotice({ case: 'FAILED' }, allowed)?.kind, 'bar');
    const attempted = counterpartyAutoSaveNotice({ case: 'CREATE', failed: true, counterpartyId: 'c1' }, allowed);
    assert.equal(attempted?.kind, 'bar');
    assert.equal(attempted?.messageKey, 'counterparties.auto_save_failed');
  });

  it('states that the registry saved when only the expense link CAS failed', () => {
    const notice = counterpartyAutoSaveNotice({ case: 'CREATE', failed: true, linkFailed: true, counterpartyId: 'c1' }, allowed);
    assert.equal(notice?.kind, 'bar');
    assert.equal(notice?.messageKey, 'counterparties.auto_save_link_failed');
  });

  // The API proves row-scoped access for the creator or original receipt uploader.
  const nonReader = { canReadCounterparty: false };

  it('keeps a link only when the API grants row-scoped access', () => {
    const notice = counterpartyAutoSaveNotice({ case: 'CREATE', counterpartyId: 'c1', displayName: 'ร้านก', canOpenCounterparty: true }, nonReader);
    assert.equal(notice?.counterpartyId, 'c1');
    assert.equal(notice?.messageKey, 'counterparties.auto_save_created');
    assert.equal(counterpartyAutoSaveNotice({ case: 'CREATE', counterpartyId: 'c1' }, nonReader)?.counterpartyId, null);
    assert.equal(counterpartyAutoSaveNotice({ case: 'FILL', counterpartyId: 'c1', canOpenCounterparty: true }, nonReader)?.counterpartyId, 'c1');
  });

  it('drops the link on a fill or a history hint for a non-reader instead of linking to a refusal', () => {
    const filled = counterpartyAutoSaveNotice({ case: 'FILL', counterpartyId: 'c1', displayName: 'ร้านก' }, nonReader);
    assert.equal(filled?.counterpartyId, null);
    assert.equal(filled?.messageKey, 'counterparties.auto_save_filled');
    assert.equal(counterpartyAutoSaveNotice({ case: 'HISTORY', counterpartyId: 'c1' }, nonReader)?.counterpartyId, null);
  });

  it('drops the link on a failed create for a non-reader, which may have added nothing', () => {
    const failed = counterpartyAutoSaveNotice({ case: 'CREATE', failed: true, counterpartyId: 'c1', canOpenCounterparty: true }, nonReader);
    assert.equal(failed?.kind, 'bar');
    assert.equal(failed?.counterpartyId, null);
    assert.equal(counterpartyAutoSaveNotice({ case: 'CREATE', failed: true, counterpartyId: 'c1' }, { canReadCounterparty: true })?.counterpartyId, null);
  });
});

describe('counterpartyHref', () => {
  it('encodes both ids', () => {
    assert.equal(counterpartyHref('co 1', 'c/1'), '/companies/co%201/counterparties/c%2F1');
  });
});

describe('counterpartyUsageBadges', () => {
  it('hides a badge at 0 and shows the count once it is not (§11.1)', () => {
    assert.deepEqual(counterpartyUsageBadges({ usageCounts: { bought: 0, sold: 0 } }), []);
    assert.deepEqual(counterpartyUsageBadges({ usageCounts: undefined }), [], 'a list row with no usage data yet is not an error');
    assert.deepEqual(counterpartyUsageBadges({ usageCounts: { bought: 3, sold: 0 } }), [
      { tone: 'sky', messageKey: 'counterparties.badge_bought', params: { count: '3' } },
    ]);
  });

  it('shows both badges in bought-then-sold order, same shape the list row and the detail page both render', () => {
    assert.deepEqual(counterpartyUsageBadges({ usageCounts: { bought: 2, sold: 5 } }), [
      { tone: 'sky', messageKey: 'counterparties.badge_bought', params: { count: '2' } },
      { tone: 'brand', messageKey: 'counterparties.badge_sold', params: { count: '5' } },
    ]);
  });
});
