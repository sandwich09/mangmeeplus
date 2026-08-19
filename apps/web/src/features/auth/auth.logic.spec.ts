import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authErrorMessage,
  buildQrCells,
  isValidThaiMobile,
  readTokenParam,
  signInAgainPath,
  validatePasswordConfirmation,
  verifyOtpInput,
} from './auth.logic';

describe('auth.logic', () => {
  it('requires a password confirmation value', () => {
    assert.equal(validatePasswordConfirmation('password-123', ''), 'auth.reset.error.confirm_required');
  });

  it('rejects a mismatched password confirmation', () => {
    assert.equal(validatePasswordConfirmation('password-123', 'password-456'), 'auth.reset.error.mismatch');
  });

  it('accepts matching passwords', () => {
    assert.equal(validatePasswordConfirmation('password-123', 'password-123'), null);
  });

  it('returns null for empty token params', () => {
    assert.equal(readTokenParam('   '), null);
  });

  it('trims token params', () => {
    assert.equal(readTokenParam('  abc123  '), 'abc123');
  });

  it('prefers explicit error messages', () => {
    assert.equal(authErrorMessage(new Error('boom'), 'fallback'), 'boom');
  });

  it('validates Thai mobile numbers (10 digits, leading 0)', () => {
    assert.equal(isValidThaiMobile('0812345678'), true);
    assert.equal(isValidThaiMobile('081-234-5678'), true);
    assert.equal(isValidThaiMobile('812345678'), false);
    assert.equal(isValidThaiMobile('08123456789'), false);
  });

  it('verifies OTP input states', () => {
    assert.equal(verifyOtpInput('12345', '123456', 30), 'incomplete');
    assert.equal(verifyOtpInput('123456', '123456', 0), 'expired');
    assert.equal(verifyOtpInput('654321', '123456', 30), 'mismatch');
    assert.equal(verifyOtpInput('123456', '123456', 30), null);
  });

  it('builds a deterministic QR matrix with finder squares', () => {
    const a = buildQrCells(9);
    const b = buildQrCells(9);
    assert.equal(a.length, 25 * 25);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, buildQrCells(10));
    // top-left finder corner cell is always dark
    assert.equal(a[0], true);
  });

  it('keeps the blocked destination in the sign-in link', () => {
    assert.equal(
      signInAgainPath('/companies/c1/expenses/e1', '?tab=signatures'),
      '/login?next=%2Fcompanies%2Fc1%2Fexpenses%2Fe1%3Ftab%3Dsignatures',
    );
    assert.equal(signInAgainPath('/companies/c1/dashboard'), '/login?next=%2Fcompanies%2Fc1%2Fdashboard');
  });
});
