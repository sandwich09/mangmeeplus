'use client';

import { apiErrorMessage } from '@/common/api/api-error-message';
import type { ApiError } from '@/common/models/api-error.model';
import type { LoginSessionResponse } from './auth.api';

/** Returns a DictionaryKey for the caller to localize via t(), or null when the confirmation is valid. */
export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string,
): 'auth.reset.error.confirm_required' | 'auth.reset.error.mismatch' | null {
  if (confirmPassword.length === 0) return 'auth.reset.error.confirm_required';
  return password === confirmPassword ? null : 'auth.reset.error.mismatch';
}

export function readTokenParam(token: string | null): string | null {
  const value = token?.trim() ?? '';
  return value.length > 0 ? value : null;
}

// Tokens live in httpOnly cookies (set by the BFF); only the post-change redirect path
// is remembered client-side for the forced password-change flow.
export function rememberPendingRedirect(
  result: Pick<LoginSessionResponse, 'companyId' | 'redirectPath'>,
  storage = window.localStorage,
): void {
  storage.setItem(
    'watchdog.pendingRedirectPath',
    result.redirectPath ?? (result.companyId ? `/companies/${result.companyId}/dashboard` : '/'),
  );
}

// ---- Phone-OTP + LINE-QR login channels (prototype parity; no backend contract yet) ----

/** Thai mobile number: exactly 10 digits starting with 0. */
export function isValidThaiMobile(phone: string): boolean {
  return /^0[0-9]{9}$/.test(phone.replace(/[^0-9]/g, ''));
}

export type OtpVerifyError = 'incomplete' | 'expired' | 'mismatch' | null;

export function verifyOtpInput(code: string, ref: string, secondsLeft: number): OtpVerifyError {
  const digits = code.replace(/[^0-9]/g, '');
  if (digits.length !== 6) return 'incomplete';
  if (secondsLeft <= 0) return 'expired';
  return digits === ref ? null : 'mismatch';
}

/**
 * Deterministic QR-look matrix (size×size booleans) with the three finder squares,
 * same xorshift generator as the design prototype. Purely decorative.
 */
export function buildQrCells(seed: number, size = 25): boolean[] {
  const cells: boolean[] = [];
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const inFinder = (r: number, c: number) => {
    const inBox = (br: number, bc: number) => r >= br && r < br + 7 && c >= bc && c < bc + 7;
    return inBox(0, 0) || inBox(0, size - 7) || inBox(size - 7, 0);
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (inFinder(r, c)) {
        const lr = r < 7 ? r : r - (size - 7);
        const lc = c < 7 ? c : c - (size - 7);
        cells.push(lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4));
      } else {
        cells.push(rnd() > 0.5);
      }
    }
  }
  return cells;
}

export function authErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return apiErrorMessage(error);
  const apiError = error as ApiError | null | undefined;
  if (typeof apiError?.message === 'string' && apiError.message.length > 0) {
    return apiErrorMessage(Object.assign(new Error(apiError.message), {
      status: apiError.statusCode,
      code: apiError.code,
    }));
  }
  return fallback;
}

/**
 * Sign-in URL that keeps the page the user was trying to open. The company-access screen is
 * usually reached from a LINE deep link opened in a browser still signed in as another account,
 * so the sign-in after it must land on that link, not on the remembered home.
 */
export function signInAgainPath(pathname: string, search = ''): string {
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
