import assert from 'node:assert/strict';
import test from 'node:test';
import { loginChannelAvailability } from './login-channel.logic';

test('OTP and incomplete LINE configuration fail closed', () => {
  assert.deepEqual(loginChannelAvailability({ lineLoginChannelId: 'channel' }), {
    password: { available: true }, phoneOtp: { available: false, reason: 'deferred_to_future_release' },
    line: { available: false, reason: 'deferred_to_future_release' },
  });
});

test('deferred login channels remain hidden even when provider credentials exist', () => {
  const result = loginChannelAvailability({ lineLoginChannelId: 'channel', lineLiffId: 'liff' });
  assert.equal(result.password.available, true);
  assert.equal(result.phoneOtp.available, false);
  assert.equal(result.line.available, false);
});
