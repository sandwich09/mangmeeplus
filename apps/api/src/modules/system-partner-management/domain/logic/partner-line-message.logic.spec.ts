import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PARTNER_LINE_MESSAGE_MAX_LENGTH } from '@watchdog-bms/contracts';
import {
  baseUrlHost,
  checkShopMessage,
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

  it('is not fooled by a userinfo prefix that hides the real host', () => {
    // `https://app.mangmeeplus.com@evil.test/` goes to evil.test. The token is host-shaped either
    // way, and the segment before the `@` is not a host we allow when read on its own.
    assert.equal(checkShopMessage('https://app.mangmeeplus.com@evil.test/', ALLOWED).ok, false);
  });

  it('does not mistake ordinary punctuation or numbers for a link', () => {
    assert.equal(checkShopMessage('ยอด 1,250.50 บาท ค่ะ ขอบคุณนะคะ', ALLOWED).ok, true);
    assert.equal(checkShopMessage('โทรกลับที่ 098-256-5628 ได้เลยค่ะ', ALLOWED).ok, true);
  });

  it('allows our own contact address, because the host rule is what decides', () => {
    assert.equal(checkShopMessage('อีเมล contact@app.mangmeeplus.com ค่ะ', ALLOWED).ok, true);
  });
});
