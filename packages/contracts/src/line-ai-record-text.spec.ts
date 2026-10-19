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
    // `in`, `us` and `it` are absent for the same reason as `id` — see the next test.
    const CC_TLDS = ['uk', 'jp', 'de', 'fr', 'ca', 'au', 'pl',
      'nl', 'es', 'br', 'kr', 'cn', 'sg', 'my', 'vn', 'ph', 'th'];
    for (const tld of CC_TLDS) {
      const scrubbed = scrubRecordText(`โอนที่ evil.${tld} ด่วน`);
      assert.ok(!scrubbed.includes(`evil.${tld}`), `evil.${tld} survived: ${scrubbed}`);
    }
  });

  // `id`, `in`, `us` and `it` are deliberately NOT in the list. Each is a real ccTLD, and each also
  // ends an ordinary uppercase receipt abbreviation with exactly the shape this rule fires on — one
  // dot, no path, nothing after the suffix. Losing a customer's tax id, or the words that say the
  // order was eaten in, is the worse of the two mistakes. Pinned so each omission reads as a
  // decision, not as a gap someone "fixes" by completing the ccTLD list.
  it('keeps the receipt abbreviations that `id`, `in`, `us` and `it` are out of the list for', () => {
    for (const kept of ['TAX.ID', 'REF.ID', 'DOC.ID', 'CUST.ID', 'DINE.IN', 'CHECK.IN', 'WALK.IN',
      'LOG.IN', 'CALL.US', 'CONTACT.US', 'ABOUT.US', 'DO.IT']) {
      assert.equal(scrubRecordText(kept), kept, `receipt token eaten: ${kept}`);
    }
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

  it('never cuts an emoji in half at the length bound — a lone surrogate is not a character LINE can send', () => {
    // A LIFF shop name may run to 120 UTF-16 units and the cards bound it at 60, so a `slice` that
    // lands between the two halves of an astral character left `\ud83d` alone at the end of a Flex
    // text (review of codex/line-pending-shop-hint, 2026-09-06).
    const cut = scrubRecordText('ก'.repeat(59) + '😀' + 'ข', 60);
    assert.equal(cut, 'ก'.repeat(59));
    // With the `u` flag this class matches only a lone surrogate, never a whole astral character.
    assert.ok(!/[\ud800-\udfff]/u.test(cut));
    // An emoji that fits whole is kept whole.
    assert.equal(scrubRecordText('ก'.repeat(58) + '😀' + 'ข', 60), 'ก'.repeat(58) + '😀');
  });
});

// B1 corpus. The host rules are two passes and their ORDER is the fix, so both ends are pinned in
// one place: every hostile string must lose its link AND keep the words around it, and every benign
// string a Thai receipt really prints must come through untouched.
//
// The regression this replaces: widening the label charset to `\p{L}` to catch `café.com` made the
// Latin run in `ร้านabcbit.ly` start after the Thai combining mark, so the scrubber returned `ร้`
// and ate the shop's name. Adding `\p{M}` swallowed the word entirely. Neither shows up unless the
// benign half of the corpus is asserted too.
describe('scrubRecordText — host corpus, both ends', () => {
  it('strips the host and keeps the words around it', () => {
    const HOSTILE: Array<[input: string, expected: string]> = [
      // Slice C's F10 expectation, exactly.
      ['ร้านabcbit.ly/x9 สาขาสอง', 'ร้าน สาขาสอง'],
      ['ร้าน ร้านค้า.com', 'ร้าน'],
      ['ร้าน ร้านค้า.example.com', 'ร้าน'],
      ['จ่ายที่ café.com', 'จ่ายที่'],
      ['ร้าน münchen.de', 'ร้าน'],
      ['ร้าน 東京.jp', 'ร้าน'],
      ['ร้านabcwww.evil.com', 'ร้าน'],
      ['go to my-shop.top now', 'go to now'],
      ['โอนที่ bit.ly/x9 ด่วน', 'โอนที่ ด่วน'],
      ['โอนที่ evil.example.com ด่วน', 'โอนที่ ด่วน'],
      // The single-dot ambiguous pass is load-bearing on its own here, and only here. The bare-host
      // pass cannot reach `abc.com` (one dot, no path), and the IDN pass would start its label at
      // `ร้านabc` and take the shop's name with the host — so with the ambiguous pass off this
      // returns '' rather than 'ร้าน', which is why the case is asserted by value, not by absence.
      ['ร้านabc.com', 'ร้าน'],
    ];
    for (const [input, expected] of HOSTILE) {
      assert.equal(scrubRecordText(input), expected, `hostile: ${input}`);
    }
  });

  // ACCEPTED RESIDUAL (§D.15), pinned rather than fixed. A Thai word ENDING in a combining mark,
  // glued straight to a host, loses the whole field: the script boundary refuses to open a Latin
  // label directly after a mark, so the ambiguous pass declines and the IDN pass — which may start
  // on a mark — matches from the head of the token and takes the word along with the host.
  //
  // It errs toward over-stripping and can never leave a live host standing, which is the direction
  // that matters on a card the user reads as the system's own answer. A separator restores the name,
  // which is both what the residual costs and what bounds it. Do not "fix" this by relaxing the
  // boundary: that is the B1 regression, and it hands back half a host glued to the shop's name.
  it('over-strips a mark-final Thai word glued to a host (accepted residual)', () => {
    assert.equal(scrubRecordText('ร้านคาเฟ่abc.com'), '');
    assert.equal(scrubRecordText('ร้านคาเฟ่café.com'), '');
    assert.equal(scrubRecordText('ร้านคาเฟ่ café.com'), 'ร้านคาเฟ่');
  });

  it('strips a bare host on every tiebreaker TLD, with the surrounding words intact', () => {
    const TLDS = ['com', 'net', 'org', 'io', 'co', 'ru', 'cn', 'th', 'dev', 'ai', 'zip', 'mov',
      'xyz', 'app', 'link', 'click', 'top', 'shop', 'site', 'live', 'info', 'biz', 'online',
      'store', 'icu', 'vip', 'ly', 'me', 'tv', 'cc', 'gg', 'to', 'sh', 'st',
      'uk', 'jp', 'de', 'fr', 'ca', 'au', 'pl', 'nl', 'es', 'br', 'kr',
      'sg', 'my', 'vn', 'ph'];
    for (const tld of TLDS) {
      assert.equal(scrubRecordText(`ร้าน evil.${tld} สาขา`), 'ร้าน สาขา', `TLD ${tld}`);
    }
    // And the IDN pass reaches the same list.
    for (const tld of ['com', 'de', 'jp', 'th']) {
      assert.equal(scrubRecordText(`ร้าน ร้านค้า.${tld} สาขา`), 'ร้าน สาขา', `IDN TLD ${tld}`);
    }
  });

  it('leaves a real Thai receipt alone', () => {
    // Byte-identical: nothing in these strings is a host or a figure.
    const UNCHANGED = [
      'ร้าน กก.ขข.คค บางนา',
      'บริษัท เอ.บี.ซี. จำกัด',
      'บจก. ครัวคุณแม่',
      'ห้างหุ้นส่วน ส.สมชาย จำกัด',
      'โรงพยาบาล เซนต์หลุยส์ ตึก ก.',
      'สาขา ลาดพร้าว.วังหิน.โชคชัย',
      'ABC Co.Ltd',
      'St.Louis Hospital',
      'TAX.INV',
      'S.P.C.',
      'A.B.C.',
      'ร้าน 7-11 สาขา 12',
      'ร้านสะดวกซื้อ สาขา 12',
    ];
    for (const input of UNCHANGED) {
      assert.equal(scrubRecordText(input), input, `benign: ${input}`);
    }
  });

  it('keeps the NAME on a benign string whose number the money rule masks', () => {
    // These carry a run of three or more digits, which is masked by design (§F12) — the assertion
    // is that the link rules took nothing, not that the string is byte-identical.
    assert.match(scrubRecordText('ปตท. สาขา 088'), /^ปตท\. สาขา …$/u);
    assert.match(scrubRecordText('TAX.ID 0105558123456'), /^TAX\.ID …$/u);
    assert.match(scrubRecordText('REF.ID A0042'), /^REF\.ID A…$/u);
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

it('selects current LINE language independently of account locale or style', async () => {
  const { lineReplyLanguage } = await import('./line-ai.js');
  for (const [text, fallback, expected] of [
    ['Can you explain this charge?', 'th', 'en'], ['What’s the next step?', 'th', 'en'],
    ['ช่วยตรวจให้ค่ะ', 'en', 'th'], ['ช่วย check ให้หน่อย', 'en', 'th'],
    ['123.45', 'en', 'en'], ['', 'th', 'th'], ['EXP-2026-000123', 'th', 'th'],
  ] as const) assert.equal(lineReplyLanguage(text, fallback), expected, text);
});


describe('U5 customer package names', () => {
  it('uses the web Thai names, English names and the supplied selling price for every tier', async () => {
    const { BILLING_PAID_TIERS, billingOffer, customerPackageName, lineCustomerWording } = await import('./billing.js');
    for (const tier of BILLING_PAID_TIERS) for (const language of ['th', 'en'] as const) {
      const name = customerPackageName({ ...billingOffer(tier, 'month'), priceSatang: 234567 }, language);
      assert.match(name, /2,345.67/); assert.doesNotMatch(name, /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
      assert.equal(lineCustomerWording(`${name} — (${tier.split('_')[0]})`), name);
    }
  });
});


it('U5 a vendor name that contains PRO is source evidence, not a package enum', async () => {
  const { lineCustomerWording } = await import('./billing.js');
  const evidence = 'ผู้ขาย PRO SERVICE ยอด 1,388.00 บาท';
  assert.equal(lineCustomerWording(evidence), evidence);
});
