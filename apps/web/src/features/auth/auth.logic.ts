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

// The LINE OAuth round trip, with the landing path carried across it. Three lanes use it: a plain
// LINE login, link-after-password (P12-2) — LINE has already consented this browser, so it
// redirects back immediately and the BFF callback, now seeing an active session, links the
// verified identity instead of issuing new tokens — and the scanned desktop-QR approve page, which
// sends the phone through the same round trip and back to the code it was asked to confirm.
export function lineStartUrl(returnTo: string): string {
  return `/api/auth/line-login/start?returnTo=${encodeURIComponent(returnTo)}`;
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

export function companyAccessDescription(
  locale: 'th' | 'en',
  displayName?: string | null,
  companyName?: string | null,
): string {
  if (!displayName) {
    return locale === 'th'
      ? 'บริษัทอาจถูกปิดใช้งาน หรือสิทธิ์ของคุณถูกยกเลิก กรุณาติดต่อผู้ดูแลบริษัท หากต้องการเปลี่ยนบัญชีให้ออกจากระบบแล้วเข้าสู่ระบบใหม่'
      : 'The company may be inactive or your access may have been removed. Contact your company administrator, or sign out to use another account.';
  }

  const name = companyName?.trim();
  if (locale === 'th') {
    const company = name ? (name.startsWith('บริษัท') ? name : `บริษัท ${name}`) : 'บริษัทนี้';
    return `คุณกำลังเข้าสู่ระบบเป็น "${displayName}" ซึ่งไม่มีสิทธิ์ใน${company} หากลิงก์นี้มาจากอีกบัญชีหนึ่ง ให้ออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วยบัญชีนั้น หรือติดต่อผู้ดูแลบริษัท`;
  }

  return `You are signed in as "${displayName}", which has no access to ${name ? `"${name}"` : 'this company'}. If this link belongs to another account, sign out and sign in with that account, or contact your company administrator.`;
}
