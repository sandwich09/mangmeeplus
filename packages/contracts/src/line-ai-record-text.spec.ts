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
    // `th` is in the tiebreaker list because this is a Thai product and `shop.th` is a plausible
    // thing for a receipt to carry; `dev` and `ai` are common enough to be worth naming too.
    // `.zip` and `.mov` are in the list because a browser RESOLVES them — a bare "invoice.zip" in a
    // bubble is a tappable link on a phone, which is a different risk from an unresolvable word.
    for (const text of ['evil.xyz', 'evil.app', 'evil.ru', 'pay-now.click/abc', 'shop.co.uk',
      'shop.th', 'evil.dev', 'evil.ai', 'invoice.zip', 'evil.mov']) {
      const scrubbed = scrubRecordText(`โอนที่ ${text} ด่วน`);
      assert.ok(!/evil|pay-now|shop\./.test(scrubbed), `link survived: ${scrubbed}`);
    }
  });

  // A ccTLD linkifies exactly like `.com` on a phone, so the tiebreaker has to carry the common
  // ones. This walks the list rather than sampling it: the failure mode is one missing entry, and
  // a spot check is how a missing entry survives.
  it('strips a bare host on any of the common country TLDs', () => {
    const CC_TLDS = ['uk', 'jp', 'de', 'fr', 'in', 'us', 'ca', 'au', 'it', 'pl',
      'nl', 'es', 'br', 'kr', 'cn', 'sg', 'my', 'vn', 'ph', 'th'];
    for (const tld of CC_TLDS) {
      const scrubbed = scrubRecordText(`โอนที่ evil.${tld} ด่วน`);
      assert.ok(!scrubbed.includes(`evil.${tld}`), `evil.${tld} survived: ${scrubbed}`);
    }
  });

  // `id` is deliberately NOT in the list: `TAX.ID` and `REF.ID` are ordinary receipt tokens with
  // exactly the shape this rule fires on, and losing a customer's tax id off the card is the worse
  // of the two mistakes. Pinned so the omission is a decision, not a gap someone "fixes".
  it('keeps TAX.ID and REF.ID, which is why `id` is out of the list', () => {
    assert.match(scrubRecordText('TAX.ID 0105558123456'), /TAX\.ID/);
    assert.match(scrubRecordText('REF.ID A0042'), /REF\.ID/);
  });

  // M5: the same rule must not eat ordinary text a Thai receipt really prints. A bare host needs a
  // corroborating signal - a path, a second dot, or a TLD that does not run straight into more word.
  it('keeps real text that merely contains a dot', () => {
    assert.match(scrubRecordText('ABC Co.Ltd'), /ABC Co\.Ltd/);
    assert.match(scrubRecordText('St.Louis Hospital'), /St\.Louis Hospital/);
    assert.match(scrubRecordText('TAX.INV'), /TAX\.INV/);
    assert.match(scrubRecordText('ร้านอาหาร S.P.C. จำกัด'), /S\.P\.C/);
    assert.match(scrubRecordText('S.Pak Food'), /S\.Pak Food/);
    assert.match(scrubRecordText('บริษัท A.B.C. จำกัด'), /A\.B\.C/);
    // A branch number is a name, not a total: the digit floor is three.
    assert.match(scrubRecordText('ร้าน 7-11 สาขา 12'), /7-11 สาขา 12/);
  });

  // Finding 3: NFC earns its place on LATIN, not on Thai — Thai vowel signs and tone marks have no
  // canonical composition, so NFC leaves them alone and `\p{M}` is what carries them.
  it('normalises a decomposed Latin host so it cannot dodge the link rule', () => {
    const composed = 'จ่ายที่ caf\u00e9.com';
    const decomposed = 'จ่ายที่ cafe\u0301.com';
    assert.notEqual(composed, decomposed, 'the fixture must actually differ before normalisation');
    assert.equal(scrubRecordText(composed), scrubRecordText(decomposed));
    assert.ok(!scrubRecordText(decomposed).includes('.com'), 'and the host is gone from both');
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

// F13: a document number is the one field whose DIGITS are the value. It is matched by SHAPE - one
// token, no dots - because admitting `.` admits `1789.04` and `192.168.1.1/pay`, the exact money and
// host shapes the label scrubber exists to remove.
describe('scrubRecordIdentifier', () => {
  it('keeps a real document number whole, Thai combining marks and digits included', () => {
    assert.equal(scrubRecordIdentifier('ใบกำกับ-12'), 'ใบกำกับ-12');
    assert.equal(scrubRecordIdentifier('ใบเสร็จ-001'), 'ใบเสร็จ-001');
    assert.equal(scrubRecordIdentifier('INV/2026/0912'), 'INV/2026/0912');
    assert.equal(scrubRecordIdentifier('TAX#001'), 'TAX#001');
    assert.equal(scrubRecordIdentifier('  INV-1  '), 'INV-1', 'surrounding space is trimmed, not a reason to refuse');
  });

  it('folds Thai and fullwidth digits so one identifier cannot arrive in two alphabets', () => {
    assert.equal(scrubRecordIdentifier('ใบกำกับ-๑๒'), 'ใบกำกับ-12');
    assert.equal(scrubRecordIdentifier('INV-１２'), 'INV-12');
  });

  it('refuses anything that could read as a printed total or a host', () => {
    for (const attack of ['ยอดใหม่ 1789.04 บาท', '๙๙,๙๙๙.๐๐', '192.168.1.1/pay', '1789.04', '9,999.00', 'evil.xyz']) {
      assert.equal(scrubRecordIdentifier(attack), null, `admitted: ${attack}`);
    }
  });

  it('refuses multi-token text, over-long values and absent values', () => {
    assert.equal(scrubRecordIdentifier('INV 1'), null, 'an identifier is ONE token');
    assert.equal(scrubRecordIdentifier('A'.repeat(33), 32), null);
    assert.equal(scrubRecordIdentifier('A'.repeat(32), 32), 'A'.repeat(32));
    assert.equal(scrubRecordIdentifier(null), null);
    assert.equal(scrubRecordIdentifier(undefined), null);
    assert.equal(scrubRecordIdentifier('<b>x</b>'), null);
  });
});
