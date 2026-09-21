// Vendor-address spec §5 row 2 / §8 Slice 2: golden cases for the printed-buyer comparison. The owner
// rejected a warning that fired on everything, so every MISMATCH below has hard evidence behind it
// and every formatting difference reads as MATCH.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerPrintedFields,
  compareBuyerAsPrinted,
  confirmBuyerMismatch,
  nextBuyerAsPrinted,
  readBuyerAsPrinted,
  recheckBuyerAsPrinted,
  stampClaimStatusBeforeMark,
  type BuyerRegistryIdentity,
} from './buyer-as-printed.logic';

const TAX_ID = '0994000163011';
const ADDRESS = { line1: '55/3 ซอยลาดพร้าว 15', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' };
const COMPANY: BuyerRegistryIdentity = {
  taxId: TAX_ID, registeredName: 'บริษัท มั่งมีพลัส จำกัด', displayName: 'มั่งมีพลัส', brandName: 'Mangmee Plus', addressJson: ADDRESS,
};
// U+0E4D U+0E32: how สระอำ arrives from TIS-620 conversions, some fonts and OCR.
const DECOMPOSED_AM = '\u0E4D\u0E32';

describe('compareBuyerAsPrinted', () => {
  it('is NOT_PRINTED when the page gives no name, tax id or address — a branch code alone is not a buyer', () => {
    assert.deepEqual(compareBuyerAsPrinted({}, COMPANY, null), { matchStatus: 'NOT_PRINTED', differences: [] });
    assert.equal(compareBuyerAsPrinted({ branchCode: '00001' }, COMPANY, null).matchStatus, 'NOT_PRINTED');
  });

  it('is UNCHECKED when the company has neither a tax id nor a usable legal address', () => {
    const bare = { ...COMPANY, taxId: null, addressJson: null };
    assert.deepEqual(compareBuyerAsPrinted({ taxId: '0105512345678', name: 'ร้านอื่น' }, bare, null), { matchStatus: 'UNCHECKED', differences: [] });
    // A legacy free-shape address is not a legal address either.
    assert.equal(compareBuyerAsPrinted({ name: 'ร้านอื่น' }, { ...bare, addressJson: { address: 'กรุงเทพ' } }, null).matchStatus, 'UNCHECKED');
    // Either half of the registry is enough to compare against.
    assert.notEqual(compareBuyerAsPrinted({ name: 'ร้านอื่น' }, { ...COMPANY, taxId: null }, null).matchStatus, 'UNCHECKED');
    assert.notEqual(compareBuyerAsPrinted({ name: 'ร้านอื่น' }, { ...COMPANY, addressJson: null }, null).matchStatus, 'UNCHECKED');
  });

  it('flags a different printed tax id, and names both values', () => {
    assert.deepEqual(compareBuyerAsPrinted({ taxId: '0105512345678', name: 'บริษัท มั่งมีพลัส จำกัด' }, COMPANY, null), {
      matchStatus: 'MISMATCH', differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: TAX_ID }],
    });
  });

  it('reads a matching tax id as MATCH even when the name and the address differ (formatting or OCR noise)', () => {
    const printed = { taxId: '0-9940-00163-01-1', name: 'MANGMEE PLUS CO LTD สำนักงานใหญ่', addressText: 'อาคารอื่น เขตบางรัก 10500' };
    assert.deepEqual(compareBuyerAsPrinted(printed, COMPANY, null), { matchStatus: 'MATCH', differences: [] });
  });

  it('under the right tax id, only a printed branch code that differs from the expense branch is a mismatch', () => {
    assert.deepEqual(compareBuyerAsPrinted({ taxId: TAX_ID, branchCode: '00001' }, COMPANY, null), {
      matchStatus: 'MISMATCH', differences: [{ reason: 'BRANCH', printed: '00001', registered: '00000' }],
    });
    assert.equal(compareBuyerAsPrinted({ taxId: TAX_ID, branchCode: '00001' }, COMPANY, '00001').matchStatus, 'MATCH');
    assert.equal(compareBuyerAsPrinted({ taxId: TAX_ID, branchCode: '00000' }, COMPANY, null).matchStatus, 'MATCH', 'blank is head office');
    assert.equal(compareBuyerAsPrinted({ taxId: TAX_ID }, COMPANY, '00002').matchStatus, 'MATCH', 'no printed branch is no evidence');
  });

  // Each registry below has ONE usable name ("MM" is too short to contain anything), so a form word
  // left behind on either side cannot be rescued by containment — only stripping makes them meet.
  it('strips Thai company-form words before comparing names', () => {
    const thai = { ...COMPANY, registeredName: 'บริษัท มั่งมีพลัส จำกัด', displayName: 'MM', brandName: null };
    for (const name of [
      'มั่งมีพลัส', 'บริษัท มั่งมีพลัส จำกัด (มหาชน)', 'บมจ. มั่งมีพลัส', 'บจก.มั่งมีพลัส', 'ห้างหุ้นส่วนจำกัด มั่งมีพลัส',
      'หจก. มั่งมีพลัส', 'ห้างหุ้นส่วนสามัญ มั่งมีพลัส', 'หสม.มั่งมีพลัส',
    ]) {
      assert.equal(compareBuyerAsPrinted({ name }, thai, null).matchStatus, 'MATCH', name);
    }
  });

  it('strips English company-form words', () => {
    const english = { ...COMPANY, registeredName: 'Mangmee Plus Company Limited', displayName: 'MM', brandName: null };
    for (const name of ['Mangmee Plus Co., Ltd.', 'MANGMEE PLUS CO.,LTD', 'Mangmee Plus Public Company Limited', 'Mangmee Plus PCL', 'Mangmee Plus Limited']) {
      assert.equal(compareBuyerAsPrinted({ name }, english, null).matchStatus, 'MATCH', name);
    }
  });

  it('meets both สระอำ spellings, including inside the form word it strips', () => {
    const company = { ...COMPANY, registeredName: `บริษัท น้${DECOMPOSED_AM}มันดี จำกัด`, displayName: 'MM', brandName: null };
    assert.equal(compareBuyerAsPrinted({ name: 'บริษัท น้ำมันดี จำกัด' }, company, null).matchStatus, 'MATCH');
    // NFKC decomposes even a precomposed "จำกัด", so the fold must run BEFORE the strip or no Thai form
    // word containing สระอำ is ever removed; a form-only name then leaves nothing to judge.
    for (const name of ['บริษัท จำกัด', `บริษัท จ${DECOMPOSED_AM}กัด`]) {
      assert.equal(compareBuyerAsPrinted({ name }, company, null).matchStatus, 'MATCH', name);
    }
  });

  it('accepts containment only when the shorter name has at least three characters', () => {
    assert.equal(compareBuyerAsPrinted({ name: 'มั่งมีพลัส สาขาลาดพร้าว' }, COMPANY, null).matchStatus, 'MATCH');
    const tiny = { ...COMPANY, registeredName: null, displayName: 'AB', brandName: null };
    assert.deepEqual(compareBuyerAsPrinted({ name: 'AB Trading' }, tiny, null).differences.map((d) => d.reason), ['NAME']);
    assert.equal(compareBuyerAsPrinted({ name: 'ABC Trading' }, { ...tiny, displayName: 'ABC' }, null).matchStatus, 'MATCH');
  });

  it('flags a name that matches none of the registered, display or brand names', () => {
    assert.deepEqual(compareBuyerAsPrinted({ name: 'บริษัท ร้านอื่น จำกัด' }, COMPANY, null), {
      matchStatus: 'MISMATCH',
      differences: [{ reason: 'NAME', printed: 'บริษัท ร้านอื่น จำกัด', registered: 'บริษัท มั่งมีพลัส จำกัด' }],
    });
    assert.equal(compareBuyerAsPrinted({ name: 'บริษัท ร้านอื่น จำกัด' }, { ...COMPANY, brandName: 'ร้านอื่น' }, null).matchStatus, 'MATCH');
  });

  it('judges an address only by two five-digit postcodes, never by its text', () => {
    assert.deepEqual(compareBuyerAsPrinted({ addressText: '99 ถนนสีลม แขวงสุริยวงศ์ เขตบางรัก กรุงเทพฯ 10500' }, COMPANY, null), {
      matchStatus: 'MISMATCH', differences: [{ reason: 'POSTAL_CODE', printed: '10500', registered: '10900' }],
    });
    assert.equal(compareBuyerAsPrinted({ addressText: 'เลขที่ 1 ถ.อะไรก็ได้ จ.กรุงเทพ ๑๐๙๐๐' }, COMPANY, null).matchStatus, 'MATCH', 'Thai digits');
    assert.equal(compareBuyerAsPrinted({ addressText: '55/3 ลาดพร้าว โทร 0812345678' }, COMPANY, null).matchStatus, 'MATCH', 'no postcode, no judgement');
    assert.equal(compareBuyerAsPrinted({ addressText: '1 ถนนสีลม 10500' }, { ...COMPANY, addressJson: null }, null).matchStatus, 'MATCH',
      'a registry without a postcode has nothing to compare');
  });

  it('accepts the expense branch\'s own postcode as the buyer\'s: a match with company OR branch is not a mismatch', () => {
    const atBranch = { ...COMPANY, branchAddressJson: { line1: '9 ถนนสุขุมวิท', postalCode: '10110', countryCode: 'TH' } };
    assert.equal(compareBuyerAsPrinted({ addressText: 'สาขาอโศก 9 ถนนสุขุมวิท กรุงเทพฯ 10110' }, atBranch, '00001').matchStatus, 'MATCH');
    assert.equal(compareBuyerAsPrinted({ addressText: '55/3 ลาดพร้าว 10900' }, atBranch, '00001').matchStatus, 'MATCH');
    assert.deepEqual(compareBuyerAsPrinted({ addressText: '99 ถนนสีลม 10500' }, atBranch, '00001').differences, [
      { reason: 'POSTAL_CODE', printed: '10500', registered: '10900 / 10110' },
    ]);
    // The branch alone is enough to compare against when the company has no postcode of its own.
    assert.equal(compareBuyerAsPrinted({ addressText: '99 ถนนสีลม 10500' }, { ...atBranch, addressJson: null }, '00001').matchStatus, 'MISMATCH');
  });

  it('lists every hard difference in a fixed order when no tax id was printed', () => {
    const printed = { name: 'ร้านอื่น', addressText: 'ถนนสีลม 10500' };
    assert.deepEqual(compareBuyerAsPrinted(printed, COMPANY, null).differences.map((d) => d.reason), ['NAME', 'POSTAL_CODE']);
    // A printed tax id the registry cannot compare (no company tax id) falls back to the same checks.
    assert.deepEqual(compareBuyerAsPrinted({ ...printed, taxId: TAX_ID }, { ...COMPANY, taxId: null }, null).differences.map((d) => d.reason),
      ['NAME', 'POSTAL_CODE']);
  });
});

describe('nextBuyerAsPrinted and the confirmed override', () => {
  const printed = { name: 'ร้านอื่น', taxId: '0105512345678' };
  const mismatch = compareBuyerAsPrinted(printed, COMPANY, null);
  const confirmed = confirmBuyerMismatch(nextBuyerAsPrinted(printed, mismatch, null, '2026-09-21T01:00:00.000Z'),
    { reason: 'ใบนี้ออกในชื่อเดิมก่อนเปลี่ยนชื่อ', userId: 'user-1', at: '2026-09-21T02:00:00.000Z' });

  it('stores the printed values, status, reasons, differences and checkedAt', () => {
    assert.deepEqual(nextBuyerAsPrinted(printed, mismatch, null, '2026-09-21T01:00:00.000Z'), {
      name: 'ร้านอื่น', taxId: '0105512345678', matchStatus: 'MISMATCH', reasons: ['TAX_ID'],
      differences: [{ reason: 'TAX_ID', printed: '0105512345678', registered: TAX_ID }], checkedAt: '2026-09-21T01:00:00.000Z',
    });
  });

  it('keeps the override while the same mismatch of the same printed values stands', () => {
    const next = nextBuyerAsPrinted(printed, mismatch, confirmed, '2026-09-22T00:00:00.000Z');
    assert.equal(next.overrideReason, 'ใบนี้ออกในชื่อเดิมก่อนเปลี่ยนชื่อ');
    assert.equal(next.overriddenByUserId, 'user-1');
    assert.equal(next.overriddenAt, '2026-09-21T02:00:00.000Z');
    assert.equal(next.checkedAt, '2026-09-22T00:00:00.000Z');
  });

  it('drops it when the check now matches, the reasons change, or the printed values change', () => {
    assert.equal(nextBuyerAsPrinted(printed, { matchStatus: 'MATCH', differences: [] }, confirmed, 'now').overrideReason, undefined);
    const otherReason = { matchStatus: 'MISMATCH' as const, differences: [{ reason: 'NAME' as const, printed: 'x', registered: 'y' }] };
    assert.equal(nextBuyerAsPrinted(printed, otherReason, confirmed, 'now').overrideReason, undefined);
    assert.equal(nextBuyerAsPrinted({ ...printed, addressText: 'ใหม่' }, mismatch, confirmed, 'now').overrideReason, undefined);
  });

  it('confirms only a live MISMATCH', () => {
    assert.equal(confirmed?.matchStatus, 'MISMATCH');
    for (const stored of [
      nextBuyerAsPrinted(printed, { matchStatus: 'MATCH', differences: [] }, null, 'now'),
      nextBuyerAsPrinted(printed, { matchStatus: 'UNCHECKED', differences: [] }, null, 'now'),
      nextBuyerAsPrinted({}, { matchStatus: 'NOT_PRINTED', differences: [] }, null, 'now'),
      null, 'garbage', { matchStatus: 'MISMATCH' },
    ]) {
      assert.equal(confirmBuyerMismatch(stored, { reason: 'r', userId: 'u', at: 'now' }), null, JSON.stringify(stored));
    }
    assert.equal(readBuyerAsPrinted({ matchStatus: 'SOMETHING', checkedAt: 'now' }), null);
  });
});

describe('recheckBuyerAsPrinted', () => {
  it('does not read the registry for a page without a buyer block', async () => {
    let reads = 0;
    const result = await recheckBuyerAsPrinted({
      printed: { branchCode: '00000' }, previous: null, checkedAt: 'now',
      readRegistry: async () => { reads += 1; return { ...COMPANY, branchTaxCode: null }; },
    });
    assert.equal(reads, 0);
    assert.deepEqual(result, { branchCode: '00000', matchStatus: 'NOT_PRINTED', checkedAt: 'now' });
  });

  it('compares the printed branch with the expense branch tax code the registry read returns', async () => {
    const result = await recheckBuyerAsPrinted({
      printed: { taxId: TAX_ID, branchCode: '00002', stray: 'ignored' }, previous: null, checkedAt: 'now',
      readRegistry: async () => ({ ...COMPANY, branchTaxCode: '00002' }),
    });
    assert.equal(result.matchStatus, 'MATCH');
    assert.equal('stray' in result, false);
    assert.deepEqual(buyerPrintedFields({ name: '  ร้าน  ', taxId: 13, addressText: '' }), { name: 'ร้าน' });
  });
});

describe('stampClaimStatusBeforeMark (review fix 2: the mark can be taken back)', () => {
  const mismatch = nextBuyerAsPrinted({ taxId: '0105512345678' }, compareBuyerAsPrinted({ taxId: '0105512345678' }, COMPANY, null), null, 'now');

  it('stamps the replaced status when the mark turns a MISMATCH invoice NON_CLAIMABLE', () => {
    for (const previousClaimStatus of ['CLAIMABLE', 'NEEDS_REVIEW'] as const) {
      const stamped = stampClaimStatusBeforeMark(mismatch, { previous: mismatch, previousClaimStatus, nextClaimStatus: 'NON_CLAIMABLE', marked: true });
      assert.equal(stamped.claimStatusBeforeMark, previousClaimStatus);
    }
  });

  it('carries the stamp through a re-check while the invoice stays NON_CLAIMABLE, and drops it once it is claimable again', () => {
    const stamped = { ...mismatch, claimStatusBeforeMark: 'CLAIMABLE' as const };
    const rechecked = nextBuyerAsPrinted({ taxId: '0105512345678' }, { matchStatus: 'MATCH', differences: [] }, stamped, 'later');
    assert.equal(rechecked.claimStatusBeforeMark, 'CLAIMABLE', 'a registry fix must not strand the mark');
    assert.equal(stampClaimStatusBeforeMark(rechecked, { previous: stamped, previousClaimStatus: 'NON_CLAIMABLE', nextClaimStatus: 'NON_CLAIMABLE', marked: false })
      .claimStatusBeforeMark, 'CLAIMABLE');
    assert.equal(stampClaimStatusBeforeMark(rechecked, { previous: stamped, previousClaimStatus: 'NON_CLAIMABLE', nextClaimStatus: 'CLAIMABLE', marked: false })
      .claimStatusBeforeMark, undefined);
  });

  it('never stamps a NON_CLAIMABLE that was not the buyer mark', () => {
    const cases = [
      { previous: mismatch, previousClaimStatus: 'CLAIMABLE', nextClaimStatus: 'NON_CLAIMABLE', marked: false }, // forced by document type
      { previous: { ...mismatch, matchStatus: 'MATCH' }, previousClaimStatus: 'CLAIMABLE', nextClaimStatus: 'NON_CLAIMABLE', marked: true },
      { previous: mismatch, previousClaimStatus: 'NON_CLAIMABLE', nextClaimStatus: 'NON_CLAIMABLE', marked: true }, // nothing replaced
    ] as const;
    for (const input of cases) {
      assert.equal(stampClaimStatusBeforeMark(mismatch, input as never).claimStatusBeforeMark, undefined, JSON.stringify(input));
    }
  });
});
