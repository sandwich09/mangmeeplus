import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_RETRY_AFTER_MAX_SECONDS,
  buildTemporaryPasswordFlexMessage,
  parseLineRetryAfterSeconds,
} from './system-line-push';

describe('temporary password flex card', () => {
  const card = buildTemporaryPasswordFlexMessage('Tmp_9xYz', ['ใช้ได้ถึง 27 ส.ค. 2569 21:55']) as any;

  it('puts the password in the one-tap copy button and shows it in the body as the retype fallback', () => {
    assert.deepEqual(card.contents.footer.contents[0].action, {
      type: 'clipboard', label: 'คัดลอกรหัส', clipboardText: 'Tmp_9xYz',
    });
    assert.ok(JSON.stringify(card.contents.body).includes('Tmp_9xYz'));
    assert.ok(JSON.stringify(card.contents.body).includes('ใช้ได้ถึง'));
  });

  it('NEVER leaks the password into the altText notification preview', () => {
    assert.equal(card.altText.includes('Tmp_9xYz'), false);
    assert.ok(card.altText.length > 0);
  });
});


describe('parseLineRetryAfterSeconds', () => {
  it('takes LINE own schedule when it is a schedule anyone would choose', () => {
    assert.equal(parseLineRetryAfterSeconds('17'), 17);
    assert.equal(parseLineRetryAfterSeconds(String(LINE_RETRY_AFTER_MAX_SECONDS)), LINE_RETRY_AFTER_MAX_SECONDS);
  });

  it('ignores a header it does not understand', () => {
    for (const value of [null, '', 'soon', '0', '-5']) {
      assert.equal(parseLineRetryAfterSeconds(value), undefined, JSON.stringify(value));
    }
  });

  // The monthly-quota 429 can name weeks. Obeying it literally parks "ร้านของคุณพร้อมใช้แล้ว"
  // until the quota resets — a deferral nobody chose, on the one message this flow exists to send.
  it('clamps a quota-length deferral to six hours', () => {
    assert.equal(parseLineRetryAfterSeconds('2592000'), LINE_RETRY_AFTER_MAX_SECONDS);
    assert.equal(parseLineRetryAfterSeconds(String(LINE_RETRY_AFTER_MAX_SECONDS + 1)), LINE_RETRY_AFTER_MAX_SECONDS);
  });
});
