import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemporaryPasswordFlexMessage } from './system-line-push';

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
