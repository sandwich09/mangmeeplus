import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PARTNER_LINE_MESSAGE_MAX_LENGTH } from '@watchdog-bms/contracts';
import {
  LIFF_HOST,
  baseUrlHost,
  checkShopMessage,
  countJudgedSchemeTokens,
  shopMessageAllowedHosts,
} from './partner-line-message.logic';

const ALLOWED = shopMessageAllowedHosts('https://app.mangmeeplus.com');

describe('shopMessageAllowedHosts', () => {
  it('is our web app and our LIFF, and nothing else', () => {
    assert.deepEqual(ALLOWED, ['app.mangmeeplus.com', 'liff.line.me']);
  });

  it('still allows the LIFF when no web origin is configured', () => {
    assert.deepEqual(shopMessageAllowedHosts(undefined), ['liff.line.me']);
    assert.deepEqual(shopMessageAllowedHosts('not a url'), ['liff.line.me']);
  });

  it('reads the host without its port or path', () => {
    assert.equal(baseUrlHost('https://app.mangmeeplus.com:8443/x'), 'app.mangmeeplus.com');
    assert.equal(baseUrlHost(undefined), null);
  });
});

describe('checkShopMessage — SEC-05', () => {
  it('accepts plain Thai with no link at all', () => {
    const result = checkShopMessage('  สวัสดีค่ะ ทีมงานได้รับเรื่องแล้วนะคะ  ', ALLOWED);
    assert.deepEqual(result, { ok: true, text: 'สวัสดีค่ะ ทีมงานได้รับเรื่องแล้วนะคะ' });
  });

  it('refuses an empty or whitespace-only message', () => {
    assert.equal(checkShopMessage('   ', ALLOWED).ok, false);
    assert.equal((checkShopMessage('', ALLOWED) as any).reason, 'empty');
  });

  it(`refuses anything past ${PARTNER_LINE_MESSAGE_MAX_LENGTH} characters`, () => {
    assert.equal(checkShopMessage('ก'.repeat(PARTNER_LINE_MESSAGE_MAX_LENGTH), ALLOWED).ok, true);
    const tooLong = checkShopMessage('ก'.repeat(PARTNER_LINE_MESSAGE_MAX_LENGTH + 1), ALLOWED);
    assert.equal((tooLong as any).reason, 'too_long');
  });

  it('allows a link into our own web app and our own LIFF', () => {
    assert.equal(checkShopMessage('เปิดที่ https://app.mangmeeplus.com/expenses ได้เลยค่ะ', ALLOWED).ok, true);
    assert.equal(checkShopMessage('กดที่ https://liff.line.me/123-abc/start นะคะ', ALLOWED).ok, true);
  });

  // The OA is a Verified Account, so a link we push inherits that trust. This is the whole rule.
  it('refuses a link to anywhere else, naming the host', () => {
    const result = checkShopMessage('ดูที่ https://evil.example.com/pay ค่ะ', ALLOWED);
    assert.deepEqual(result, { ok: false, reason: 'external_link', host: 'evil.example.com' });
  });

  it('refuses a bare domain too, because LINE auto-links it', () => {
    assert.equal((checkShopMessage('โอนที่ scam-bank.co.th ค่ะ', ALLOWED) as any).reason, 'external_link');
    assert.equal((checkShopMessage('www.evil.example.com', ALLOWED) as any).reason, 'external_link');
  });

  it('is not fooled by a look-alike host that merely ends with ours', () => {
    const result = checkShopMessage('https://app.mangmeeplus.com.evil.test/pay', ALLOWED);
    assert.equal((result as any).reason, 'external_link');
    assert.equal((result as any).host, 'app.mangmeeplus.com.evil.test');
  });

  // HIGH-1. Every one of these reads as OUR host to anything that splits on the first `:` and as
  // `evil.test` to LINE, to a browser, and to the person who taps it.
  it('is not fooled by userinfo that hides the real host', () => {
    for (const bypass of [
      'https://app.mangmeeplus.com@evil.test/',
      'https://app.mangmeeplus.com:x@evil.test/pay',
      'https://app.mangmeeplus.com:443@evil.test/pay',
      // Same trick without a scheme, which LINE auto-links just the same.
      'app.mangmeeplus.com:443@evil.test/pay',
      // Two `@`: the LAST one decides the host.
      'https://a@app.mangmeeplus.com@evil.test/pay',
    ]) {
      const result = checkShopMessage(`ดูที่ ${bypass} ค่ะ`, ALLOWED);
      assert.equal(result.ok, false, `${bypass} must be refused`);
      assert.equal((result as any).host, 'evil.test', `${bypass} resolves to evil.test`);
    }
  });

  it('still allows userinfo and a port on a host that IS ours', () => {
    assert.equal(checkShopMessage('https://user:pw@app.mangmeeplus.com/expenses', ALLOWED).ok, true);
    assert.equal(checkShopMessage('https://app.mangmeeplus.com:443/expenses', ALLOWED).ok, true);
    // A root-dotted name is the same host to a resolver, so it must be to us.
    assert.equal(checkShopMessage('https://app.mangmeeplus.com./expenses', ALLOWED).ok, true);
  });

  // MEDIUM-5: the old rule required an ASCII-letter TLD, so neither of these was even LOOKED at.
  it('refuses an IP literal, whatever the allow-list contains', () => {
    const v4 = checkShopMessage('โอนที่ http://203.0.113.9/pay ค่ะ', ALLOWED);
    assert.equal((v4 as any).reason, 'external_link');
    assert.equal((v4 as any).host, '203.0.113.9');
    assert.equal(checkShopMessage('http://[2001:db8::1]/pay', ALLOWED).ok, false);
    // Even when someone configures WEB_BASE_URL as an address, a bare IP stays refused: "our host"
    // is a name, and an address in a customer message is never one.
    assert.equal(checkShopMessage('http://203.0.113.9/pay', ['203.0.113.9', LIFF_HOST]).ok, false);
  });

  /**
   * B-1. "Whole token to the next whitespace" is a rule the OPERATOR controls: gluing a second URL
   * on with a quote, an angle bracket, a backtick or an invisible zero-width space made the pair
   * one token, judged once as our host — while every linkifier renders the second one live.
   */
  it('judges a second URL glued on with punctuation or an invisible character', () => {
    const glue = ['"', '<', '`', '\u200b', '\u2060', '\ufeff', '\u202e'];
    for (const character of glue) {
      const text = `ดูที่ https://app.mangmeeplus.com/x${character}https://evil.test/pay ค่ะ`;
      const result = checkShopMessage(text, ALLOWED);
      assert.equal(result.ok, false, `glue ${JSON.stringify(character)} must not hide the second URL`);
      assert.equal((result as any).host, 'evil.test');
    }
  });

  // The invariant that keeps the rule from being re-broken by a future tweak: a token regex that
  // skips even one `https://` occurrence is a fence with a hole, whatever else it gets right.
  it('produces exactly one judged token per https:// occurrence in the text', () => {
    const samples = [
      'https://app.mangmeeplus.com/a"https://evil.test/b',
      'a https://one.test b https://two.test c',
      'https://"https://evil.test/pay',
      'ไม่มีลิงก์เลยค่ะ',
      'https://app.mangmeeplus.com/x\u200bhttps://evil.test/y',
    ];
    for (const sample of samples) {
      const occurrences = sample.match(/https?:\/\//gi)?.length ?? 0;
      assert.equal(
        countJudgedSchemeTokens(sample), occurrences,
        `every scheme occurrence must be judged in ${JSON.stringify(sample)}`,
      );
    }
  });

  it('refuses an internationalised domain by its punycode host', () => {
    const cyrillic = checkShopMessage('https://мангми.рф/pay', ALLOWED);
    assert.equal((cyrillic as any).reason, 'external_link');
    assert.equal((cyrillic as any).host, 'xn--80agpnce.xn--p1ai');
    const thai = checkShopMessage('https://ตัวอย่าง.ไทย/pay', ALLOWED);
    assert.equal((thai as any).reason, 'external_link');
    assert.match((thai as any).host, /^xn--/);
  });

  it('does not mistake ordinary punctuation or numbers for a link', () => {
    assert.equal(checkShopMessage('ยอด 1,250.50 บาท ค่ะ ขอบคุณนะคะ', ALLOWED).ok, true);
    assert.equal(checkShopMessage('โทรกลับที่ 098-256-5628 ได้เลยค่ะ', ALLOWED).ok, true);
  });

  it('allows our own contact address, because the host rule is what decides', () => {
    assert.equal(checkShopMessage('อีเมล contact@app.mangmeeplus.com ค่ะ', ALLOWED).ok, true);
  });
});
