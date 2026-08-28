import assert from 'node:assert/strict';
import test from 'node:test';
import { loginChannelAvailability } from './login-channel.logic';

test('OTP and incomplete LINE configuration fail closed', () => {
  assert.deepEqual(loginChannelAvailability({ lineLoginChannelId: 'channel' }), {
    password: { available: true }, phoneOtp: { available: false, reason: 'deferred_to_future_release' },
    line: { available: false, reason: 'deferred_to_future_release' },
  });
});

test('credentials without the web-login flag keep LINE hidden', () => {
  const result = loginChannelAvailability({ lineLoginChannelId: 'channel', lineLoginChannelSecret: 'secret', lineLiffId: 'liff' });
  assert.equal(result.password.available, true);
  assert.equal(result.phoneOtp.available, false);
  assert.deepEqual(result.line, { available: false, reason: 'deferred_to_future_release' });
});

test('the flag alone is not enough: the channel secret is what the server exchanges the code with', () => {
  assert.deepEqual(loginChannelAvailability({ lineWebLoginEnabled: true, lineLoginChannelId: 'ch' }).line, {
    available: false, reason: 'deferred_to_future_release',
  });
  assert.deepEqual(loginChannelAvailability({ lineWebLoginEnabled: true, lineLoginChannelSecret: 's' }).line, {
    available: false, reason: 'deferred_to_future_release',
  });
});

test('flag plus complete channel credentials publishes the channel id the browser needs', () => {
  const result = loginChannelAvailability({ lineWebLoginEnabled: true, lineLoginChannelId: 'ch', lineLoginChannelSecret: 'channel-secret' });
  assert.deepEqual(result.line, { available: true, channelId: 'ch' });
  // The secret itself must never leave the server.
  assert.equal(JSON.stringify(result).includes('channel-secret'), false);
});
