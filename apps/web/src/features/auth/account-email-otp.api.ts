'use client';
import { authedApiFetch } from '@/common/api/authed-fetch';
export type AccountEmailOtpState = {
  email: string | null; emailVerified: boolean; emailRevision: number;
  emailRequirement: 'READY' | 'MISSING' | 'UNVERIFIED' | 'CHANGE_PENDING';
  hasPassword: boolean; emailLoginEnabled?: boolean; lineLinked: boolean; serverNow: string;
  challenge: null | { id: string; email: string; status: string; expiresAt: string; retryAt: string;
    attemptsRemaining: number; deliveryStatus: string; delivered: boolean };
};
const base = '/auth/account/email/otp';
export const getAccountEmailOtp = () => authedApiFetch<AccountEmailOtpState>(base, { cache: 'no-store', suppressErrorToast: true });
export const accountEmailOtpCommand = (path: string, body: unknown) => authedApiFetch<AccountEmailOtpState>(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), suppressErrorToast: true,
});
