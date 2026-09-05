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
import { normalizeScrubDigits, scrubRecordText } from './line-ai.js';

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
