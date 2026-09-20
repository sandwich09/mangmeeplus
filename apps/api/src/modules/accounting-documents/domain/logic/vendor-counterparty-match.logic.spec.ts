import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThaiAddress,
  normalizeBranchCode,
  vendorMatchKey,
  counterpartyAddressText,
  buildCounterpartyAddressV2,
  decideVendorAutoSave,
} from './vendor-counterparty-match.logic';

describe('normalizeThaiAddress', () => {
  it('folds abbreviations to the same form as their spelled-out equivalent', () => {
    assert.equal(
      normalizeThaiAddress('ถ.สุขุมวิท ต.บางนา อ.บางนา จ.กรุงเทพมหานคร'),
      normalizeThaiAddress('ถนน สุขุมวิท ตำบล บางนา อำเภอ บางนา จังหวัด กรุงเทพมหานคร'),
    );
  });

  it('folds ซ. and ม. the same way as their spelled-out equivalent', () => {
    assert.equal(normalizeThaiAddress('ซ.ลาดพร้าว 101'), normalizeThaiAddress('ซอย ลาดพร้าว 101'));
    assert.equal(normalizeThaiAddress('99 ม.4'), normalizeThaiAddress('99 หมู่ 4'));
  });

  it('treats แขวง/เขต (already canonical, no abbreviation) consistently regardless of spacing', () => {
    assert.equal(
      normalizeThaiAddress('แขวงลุมพินี เขตปทุมวัน กรุงเทพมหานคร 10330'),
      normalizeThaiAddress('แขวง ลุมพินี เขต ปทุมวัน กรุงเทพมหานคร 10330'),
    );
  });

  it('ignores case and punctuation-only formatting differences', () => {
    assert.equal(
      normalizeThaiAddress('99/1 Sukhumvit RD., Bangkok'),
      normalizeThaiAddress('99/1 sukhumvit rd bangkok'),
    );
  });

  it('does not equate two genuinely different addresses', () => {
    assert.notEqual(
      normalizeThaiAddress('ถ.สุขุมวิท ต.บางนา อ.บางนา จ.กรุงเทพมหานคร'),
      normalizeThaiAddress('ถ.สุขุมวิท ต.บางพลี อ.บางพลี จ.สมุทรปราการ'),
    );
    // Same street, different house number: must not collapse into the same key.
    assert.notEqual(
      normalizeThaiAddress('99/1 หมู่ 4 ต.บางนา'),
      normalizeThaiAddress('99/2 หมู่ 4 ต.บางนา'),
    );
  });

  it('treats null/undefined/blank as the empty string', () => {
    assert.equal(normalizeThaiAddress(null), '');
    assert.equal(normalizeThaiAddress(undefined), '');
    assert.equal(normalizeThaiAddress('   '), '');
  });
});

describe('normalizeBranchCode', () => {
  it('accepts exactly 5 digits', () => {
    assert.equal(normalizeBranchCode('01234'), '01234');
    assert.equal(normalizeBranchCode('00000'), '00000');
  });

  it('rejects 4-digit and 6-digit codes', () => {
    assert.equal(normalizeBranchCode('1234'), null);
    assert.equal(normalizeBranchCode('123456'), null);
  });

  it('returns null for blank input, never the string 00000 (CON-8)', () => {
    assert.equal(normalizeBranchCode(''), null);
    assert.equal(normalizeBranchCode('   '), null);
    assert.equal(normalizeBranchCode(null), null);
    assert.equal(normalizeBranchCode(undefined), null);
  });

  it('strips non-digit formatting and folds Thai numerals before counting', () => {
    assert.equal(normalizeBranchCode('01-234'), '01234');
    assert.equal(normalizeBranchCode('สาขา 01234'), '01234');
    assert.equal(normalizeBranchCode('๐๑๒๓๔'), '01234');
  });
});

describe('vendorMatchKey', () => {
  it('keys on tax id + branch code when a 13-digit tax id is present, even with a name given', () => {
    assert.deepEqual(
      vendorMatchKey({ taxId: '0105536000000', branchCode: '00001', name: 'Some Shop' }),
      { kind: 'TAX_ID', taxId: '0105536000000', branchCode: '00001' },
    );
  });

  it('defaults a blank or invalid branch code to 00000 in the key (A2), without writing it to storage', () => {
    assert.deepEqual(
      vendorMatchKey({ taxId: '0105536000000', branchCode: null }),
      { kind: 'TAX_ID', taxId: '0105536000000', branchCode: '00000' },
    );
    assert.deepEqual(
      vendorMatchKey({ taxId: '0105536000000', branchCode: '12' }),
      { kind: 'TAX_ID', taxId: '0105536000000', branchCode: '00000' },
    );
  });

  it('falls back to the exact normalized name when there is no usable tax id', () => {
    const withoutTaxId = vendorMatchKey({ name: 'ร้านกาแฟ-ABC จำกัด' });
    const withInvalidTaxId = vendorMatchKey({ taxId: '123', name: 'ร้านกาแฟ ABC จำกัด' });
    assert.equal(withoutTaxId?.kind, 'NAME');
    // Same name modulo punctuation/spacing, and an unusable (too-short) tax id: same key either way.
    assert.deepEqual(withoutTaxId, withInvalidTaxId);
  });

  it('does not equate two different vendor names', () => {
    assert.notDeepEqual(vendorMatchKey({ name: 'ร้านกาแฟ ABC' }), vendorMatchKey({ name: 'ร้านกาแฟ XYZ' }));
  });

  it('returns null for a blank name and no usable tax id, meaning do not match at all (§7)', () => {
    assert.equal(vendorMatchKey({ name: '' }), null);
    assert.equal(vendorMatchKey({ name: '   ' }), null);
    assert.equal(vendorMatchKey({}), null);
  });
});

describe('counterpartyAddressText', () => {
  it('reads the v2 shape addressText first', () => {
    assert.equal(
      counterpartyAddressText({
        addressText: '99/1 ถ.สุขุมวิท',
        provenance: { source: 'MANUAL', userId: 'u1', at: '2026-09-20T00:00:00.000Z' },
      }),
      '99/1 ถ.สุขุมวิท',
    );
  });

  it('reads a legacy free-shape object with a plain address key (procurement, CON-9)', () => {
    assert.equal(counterpartyAddressText({ address: '99/1 ถ.สุขุมวิท' }), '99/1 ถ.สุขุมวิท');
  });

  it('composes a legacy structured free-shape object (AddressSnapshot-style keys)', () => {
    assert.equal(
      counterpartyAddressText({
        line1: '99/1 ถ.สุขุมวิท',
        subdistrict: 'บางนา',
        district: 'บางนา',
        province: 'กรุงเทพมหานคร',
        postalCode: '10260',
      }),
      '99/1 ถ.สุขุมวิท บางนา บางนา กรุงเทพมหานคร 10260',
    );
  });

  it('returns null for null/undefined/empty/unexpected shapes without throwing', () => {
    assert.equal(counterpartyAddressText(null), null);
    assert.equal(counterpartyAddressText(undefined), null);
    assert.equal(counterpartyAddressText({}), null);
    assert.equal(counterpartyAddressText([1, 2, 3]), null);
    assert.equal(counterpartyAddressText(42), null);
    assert.equal(counterpartyAddressText(true), null);
    assert.equal(counterpartyAddressText({ addressText: '   ' }), null);
  });
});

describe('buildCounterpartyAddressV2', () => {
  it('sets provenance and omits expenseId when not given', () => {
    const result = buildCounterpartyAddressV2({
      addressText: '99/1 ถ.สุขุมวิท',
      source: 'EXPENSE_AUTO',
      userId: 'user-1',
      at: '2026-09-20T10:00:00.000Z',
    });
    assert.equal(result.addressText, '99/1 ถ.สุขุมวิท');
    assert.equal(result.postalCode, null);
    assert.deepEqual(result.provenance, { source: 'EXPENSE_AUTO', userId: 'user-1', at: '2026-09-20T10:00:00.000Z' });
    assert.equal('expenseId' in result.provenance, false);
    assert.equal(result.seenOnDocuments, undefined);
  });

  it('includes expenseId in provenance when given', () => {
    const result = buildCounterpartyAddressV2({
      addressText: 'X',
      source: 'EXPENSE_AUTO',
      expenseId: 'exp-1',
      userId: 'user-1',
      at: '2026-09-20T10:00:00.000Z',
    });
    assert.equal(result.provenance.expenseId, 'exp-1');
  });

  it('carries structured data forward from a v2 previous value untouched', () => {
    const previous = {
      addressText: 'old',
      provenance: { source: 'RD_LOOKUP', userId: 'u', at: '2026-01-01T00:00:00.000Z' },
      structured: { line1: '1 Rd', line2: null, subdistrict: 'A', district: 'B', province: 'C', postalCode: '10000', countryCode: 'TH' },
    };
    const result = buildCounterpartyAddressV2({
      addressText: 'new', source: 'EXPENSE_AUTO', userId: 'u2', at: '2026-09-20T00:00:00.000Z', previous,
    });
    assert.deepEqual(result.structured, previous.structured);
  });

  it('caps carried-forward history at the 5 newest entries and drops malformed ones', () => {
    const seenOnDocuments = [
      { addressText: 'a1', expenseId: 'e1', at: '2026-09-01T00:00:00.000Z' },
      { addressText: 'a2', expenseId: 'e2', at: '2026-08-01T00:00:00.000Z' },
      { addressText: 'a3', expenseId: 'e3', at: '2026-07-01T00:00:00.000Z' },
      { addressText: 'a4', expenseId: 'e4', at: '2026-06-01T00:00:00.000Z' },
      { addressText: 'a5', expenseId: 'e5', at: '2026-05-01T00:00:00.000Z' },
      { addressText: 'a6-should-drop', expenseId: 'e6', at: '2026-04-01T00:00:00.000Z' },
      { addressText: 'malformed, missing expenseId' },
    ];
    const previous = {
      addressText: 'old', provenance: { source: 'MANUAL', userId: 'u', at: '2026-01-01T00:00:00.000Z' }, seenOnDocuments,
    };
    const result = buildCounterpartyAddressV2({
      addressText: 'new', source: 'EXPENSE_AUTO', userId: 'u2', at: '2026-09-20T00:00:00.000Z', previous,
    });
    assert.equal(result.seenOnDocuments?.length, 5);
    assert.deepEqual(result.seenOnDocuments?.map((entry) => entry.expenseId), ['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('never throws on a malformed or legacy previous value', () => {
    assert.doesNotThrow(() =>
      buildCounterpartyAddressV2({ addressText: 'x', source: 'MANUAL', userId: 'u', at: '2026-09-20T00:00:00.000Z', previous: 'not-an-object' }),
    );
    assert.doesNotThrow(() =>
      buildCounterpartyAddressV2({
        addressText: 'x', source: 'MANUAL', userId: 'u', at: '2026-09-20T00:00:00.000Z',
        previous: { address: 'legacy free-shape, no seenOnDocuments' },
      }),
    );
  });
});

describe('decideVendorAutoSave', () => {
  it('case a: no match -> CREATE, always promotes, never appends to history', () => {
    assert.deepEqual(
      decideVendorAutoSave({ matched: false, registryAddressText: null, documentAddressText: 'X', locked: false }),
      { case: 'CREATE', promoteToPrimary: true, appendToHistory: false },
    );
    // Even with no document address at all, a new counterparty row is still created (a).
    assert.equal(
      decideVendorAutoSave({ matched: false, registryAddressText: null, documentAddressText: null, locked: false }).case,
      'CREATE',
    );
  });

  it('case b: matched but registry has no address yet -> FILL, promotes the document address', () => {
    assert.deepEqual(
      decideVendorAutoSave({ matched: true, registryAddressText: null, documentAddressText: 'X', locked: false }),
      { case: 'FILL', promoteToPrimary: true, appendToHistory: false },
    );
  });

  it('case d: matched and addresses are equal after normalize -> NOOP', () => {
    assert.deepEqual(
      decideVendorAutoSave({
        matched: true,
        registryAddressText: 'ถ.สุขุมวิท ต.บางนา',
        documentAddressText: 'ถนน สุขุมวิท ตำบล บางนา',
        locked: false,
      }),
      { case: 'NOOP', promoteToPrimary: false, appendToHistory: false },
    );
  });

  it('NOOP when there is nothing new to compare against (document carries no address)', () => {
    assert.deepEqual(
      decideVendorAutoSave({ matched: true, registryAddressText: 'X', documentAddressText: null, locked: false }),
      { case: 'NOOP', promoteToPrimary: false, appendToHistory: false },
    );
  });

  it('case c unlocked: a different address -> HISTORY, the newer document address wins (A4)', () => {
    assert.deepEqual(
      decideVendorAutoSave({ matched: true, registryAddressText: 'Old Address', documentAddressText: 'New Address', locked: false }),
      { case: 'HISTORY', promoteToPrimary: true, appendToHistory: true },
    );
  });

  it('case c locked: a different address -> HISTORY, but the registry primary does not move', () => {
    assert.deepEqual(
      decideVendorAutoSave({ matched: true, registryAddressText: 'Old Address', documentAddressText: 'New Address', locked: true }),
      { case: 'HISTORY', promoteToPrimary: false, appendToHistory: true },
    );
  });
});

// ── controller review fixes (2026-09-20) ────────────────────────────────────
describe('review fixes', () => {
  it('keeps different house numbers apart instead of collapsing every separator', () => {
    assert.notEqual(normalizeThaiAddress('99/9 ถนนสุขุมวิท'), normalizeThaiAddress('9/99 ถนนสุขุมวิท'));
    assert.equal(normalizeThaiAddress('99/9 ถ.สุขุมวิท'), normalizeThaiAddress('99/9 ถนน สุขุมวิท'));
    assert.equal(normalizeThaiAddress('99 9 ถนนสุขุมวิท'), normalizeThaiAddress('99/9 ถนนสุขุมวิท'));
  });

  it('prepends the displaced address to history and caps it at five', () => {
    const previous = {
      addressText: 'เดิม',
      seenOnDocuments: [1, 2, 3, 4, 5].map((n) => ({ addressText: `เก่า ${n}`, expenseId: `e${n}`, at: '2026-09-01T00:00:00Z' })),
    };
    const built = buildCounterpartyAddressV2({
      addressText: 'ใหม่', source: 'EXPENSE_AUTO', userId: 'u1', at: '2026-09-20T00:00:00Z', previous,
      appendToHistory: { addressText: 'เดิม', expenseId: 'e9', at: '2026-09-20T00:00:00Z' },
    });
    assert.equal(built.seenOnDocuments?.length, 5);
    assert.equal(built.seenOnDocuments?.[0]?.addressText, 'เดิม');
    assert.equal(built.seenOnDocuments?.[4]?.addressText, 'เก่า 4');
  });

  it('moves a repeat of an already-remembered address to the front rather than stacking it', () => {
    const previous = { seenOnDocuments: [{ addressText: 'ก. ทดสอบ', expenseId: 'e1', at: '2026-09-01T00:00:00Z' }] };
    const built = buildCounterpartyAddressV2({
      addressText: 'ใหม่', source: 'EXPENSE_AUTO', userId: 'u1', at: '2026-09-20T00:00:00Z', previous,
      appendToHistory: { addressText: 'ก.ทดสอบ', expenseId: 'e2', at: '2026-09-20T00:00:00Z' },
    });
    assert.equal(built.seenOnDocuments?.length, 1);
    assert.equal(built.seenOnDocuments?.[0]?.expenseId, 'e2');
  });
});
