import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAccountMergeCookie, encodeAccountMergeCookie } from './account-merge-bff.logic';

describe('account-merge-bff.logic', () => {
  it('round-trips the ticket and the account summary', () => {
    const encoded = encodeAccountMergeCookie({
      ticket: 'ticket-value',
      existingAccount: { displayName: 'สมชาย', companyNames: ['ร้านเดิม', 'ร้านที่สอง'] },
    });

    assert.deepEqual(decodeAccountMergeCookie(encoded), {
      ticket: 'ticket-value',
      existingAccount: { displayName: 'สมชาย', companyNames: ['ร้านเดิม', 'ร้านที่สอง'] },
    });
  });

  it('bounds the summary so a long shop list cannot push the cookie past the browser limit', () => {
    const decoded = decodeAccountMergeCookie(encodeAccountMergeCookie({
      ticket: 't',
      existingAccount: {
        displayName: 'ก'.repeat(500),
        companyNames: Array.from({ length: 12 }, (_, i) => `${'ร'.repeat(200)}${i}`),
      },
    }));

    assert.equal(decoded!.existingAccount.displayName.length, 80);
    assert.equal(decoded!.existingAccount.companyNames.length, 5);
    assert.ok(decoded!.existingAccount.companyNames.every((name) => name.length <= 80));
  });

  it('drops anything that is not a usable offer', () => {
    assert.equal(decodeAccountMergeCookie(undefined), null);
    assert.equal(decodeAccountMergeCookie('not-base64url-json'), null);
    // A cookie without a ticket cannot merge anything, so it must not read as a live offer.
    assert.equal(decodeAccountMergeCookie(Buffer.from('{"ticket":""}', 'utf8').toString('base64url')), null);
    assert.equal(decodeAccountMergeCookie(Buffer.from('{"ticket":123}', 'utf8').toString('base64url')), null);
  });

  it('survives an API body that carried no account summary at all', () => {
    const decoded = decodeAccountMergeCookie(encodeAccountMergeCookie({ ticket: 't' }));

    assert.deepEqual(decoded, { ticket: 't', existingAccount: { displayName: '', companyNames: [] } });
  });
});
