/**
 * The shared record-text scrubber (draft-control spec §5.4; slice C review round 2).
 *
 * Everything here is an attack that PASSED an ASCII-only guard. The alphabet a Thai receipt can
 * print a total in is wider than `\d`, and `\b` does not fire between a Thai letter and a Latin
 * one — so both of those, on their own, let a bill print "ยอดรวมใหม่ ๙๙,๙๙๙.๐๐" into a bubble the
 * user reads as the system's own answer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScrubDigits, scrubRecordIdentifier, scrubRecordText } from './line-ai.js';

const noDigits = (text: string) => assert.ok(!/[0-9๐-๙０-９]/u.test(text), `digits survived: ${text}`);

describe('scrubRecordText', () => {
  it('removes a money-shaped run in every digit alphabet', () => {
    for (const total of ['9,999.00', '๙๙,๙๙๙.๐๐', '９９，９９９．００', '99999']) {
      noDigits(scrubRecordText(`ยอดรวมใหม่ ${total} บาท`));
    }
  });

  it('removes an integer-only fake total, which has no decimal point to match on', () => {
    noDigits(scrubRecordText('โอน 99,999 ให้ด่วน'));
    // A single digit is not a total and stays: "ห้อง 5" must remain readable.
    assert.equal(scrubRecordText('ห้อง 5'), 'ห้อง 5');
  });

  it('removes a percent in either script', () => {
    noDigits(scrubRecordText('ค่าบริการ 90%'));
    noDigits(scrubRecordText('ค่าบริการ ๙๐ เปอร์เซ็นต์'));
  });

  it('removes a bare domain, including one glued to Thai letters where \\b never fires', () => {
    for (const text of ['evil.example.com', 'bit.ly/x9', 'ร้านabcwww.evil.com', 'go to my-shop.top now']) {
      const scrubbed = scrubRecordText(text);
      assert.ok(!/evil|bit\.ly|my-shop/.test(scrubbed), `link survived: ${scrubbed}`);
    }
  });

  // F11: the registry grows faster than any list in this file ever will, so the rule is a SHAPE.
  it('removes a host on a TLD no allowlist would have contained', () => {
    for (const text of ['evil.xyz', 'evil.app', 'evil.ru', 'pay-now.click/abc', 'shop.co.uk']) {
      const scrubbed = scrubRecordText(`โอนที่ ${text} ด่วน`);
      assert.ok(!/evil|pay-now|shop\./.test(scrubbed), `link survived: ${scrubbed}`);
    }
  });

  // F12: masking, not deleting. A label is mostly a name, and removing the number must not take
  // the name with it.
  it('keeps a shop name while masking the number beside it', () => {
    const scrubbed = scrubRecordText('ร้าน 7-Eleven สาขา 123');
    assert.match(scrubbed, /7-Eleven/, 'the name is what the reader needs');
    assert.ok(!scrubbed.includes('123'), 'the number is still gone');
    assert.match(scrubbed, /…/, 'and a mask says something was removed');
  });

  it('drops the whole value only when the caller asks, for a sentence a hole would misread', () => {
    assert.equal(scrubRecordText('ยอดรวมใหม่ 9,999.00 บาท', 60, { onMoney: 'drop' }), '');
    assert.equal(scrubRecordText('ค่าอาหารกลางวัน', 60, { onMoney: 'drop' }), 'ค่าอาหารกลางวัน');
    // The drop test must not depend on what was tested before it (no shared regex lastIndex).
    assert.equal(scrubRecordText('ค่าบริการ 90%', 60, { onMoney: 'drop' }), '');
    assert.equal(scrubRecordText('ค่าบริการ 90%', 60, { onMoney: 'drop' }), '');
  });

  it('removes bidi overrides that can make a number read backwards', () => {
    assert.ok(!/[‪-‮⁦-⁩]/u.test(scrubRecordText('ค่าอาหาร‮abc')));
  });

  it('keeps ordinary Thai text readable and bounded', () => {
    assert.equal(scrubRecordText('  ค่าอาหาร   กลางวัน  '), 'ค่าอาหาร กลางวัน');
    assert.equal(scrubRecordText('ก'.repeat(200), 40).length, 40);
    assert.equal(scrubRecordText(null), '');
    assert.equal(scrubRecordText(undefined), '');
    assert.equal(scrubRecordText(42 as never), '');
  });
});

describe('normalizeScrubDigits', () => {
  it('folds Thai and fullwidth digits and separators onto ASCII, so a comparison cannot be fooled', () => {
    assert.equal(normalizeScrubDigits('๙๙,๙๙๙.๐๐'), '99,999.00');
    assert.equal(normalizeScrubDigits('９９，９９９．００'), '99,999.00');
    assert.equal(normalizeScrubDigits('1,789.04'), '1,789.04');
  });
});

// F13: a document number is the one field whose DIGITS are the value. Thai tone marks and vowel
// signs are separate combining code points, so a class of \p{L}\p{N} alone hands back mangled Thai.
describe('scrubRecordIdentifier', () => {
  it('keeps a Thai document number whole, marks and digits included', () => {
    assert.equal(scrubRecordIdentifier('ใบกำกับ-12'), 'ใบกำกับ-12');
    assert.equal(scrubRecordIdentifier('ใบเสร็จ-001'), 'ใบเสร็จ-001');
    assert.equal(scrubRecordIdentifier('INV/2026/0912'), 'INV/2026/0912');
  });

  it('still removes links, control characters and anything outside an identifier', () => {
    assert.ok(!scrubRecordIdentifier('INV-1 evil.xyz').includes('evil'));
    assert.equal(scrubRecordIdentifier('INV\u202e-1'), 'INV -1');
    assert.ok(!scrubRecordIdentifier('INV-1 <b>x</b>').includes('<'));
  });

  it('drops the thousands separator, so an identifier can never take a total\'s shape', () => {
    assert.equal(scrubRecordIdentifier('9,999.00'), '9999.00');
  });

  it('bounds length and handles absent values', () => {
    assert.equal(scrubRecordIdentifier('A'.repeat(80), 32).length, 32);
    assert.equal(scrubRecordIdentifier(null), '');
    assert.equal(scrubRecordIdentifier(undefined), '');
  });
});
