'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/common/components/button';
import { sanitizeNextPath } from '@/common/auth/middleware.logic';
import {
  legalAcceptancePath,
  RECOVERY_PARAM,
  recoveryReturnUrl,
  shouldAttemptSessionRecovery,
} from '@/common/auth/session-gate.logic';
import { trimmed } from '@/common/forms/trim';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { formatMessage, localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { GenericClientNotice } from '@/common/client-support/GenericClientNotice';
import { loginAsDevOwner, loginWithPassword, refreshSessionWithOutcome } from './auth.api';
import { lineStartUrl, rememberPendingRedirect } from './auth.logic';

const SHOW_DEV_LOGIN = process.env.NODE_ENV !== 'production';

// Outcome of a LINE web-login round trip, handed back by the BFF as /login?line=<reason>.
// Thai-only like the other login-page notices that have no dictionary entry yet.
const LINE_NOTICE_TEXT: Record<string, string> = {
  'link-required': 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้ในระบบ — เข้าสู่ระบบด้วยรหัสผ่านหนึ่งครั้ง แล้วระบบจะเชื่อมบัญชี LINE ให้อัตโนมัติ',
  'link-failed': 'เชื่อมบัญชี LINE ไม่สำเร็จ (บัญชี LINE นี้อาจถูกเชื่อมกับผู้ใช้อื่นอยู่แล้ว) กรุณาลองใหม่อีกครั้งหรือติดต่อผู้ดูแลระบบ',
  // The link lane normally sends this back to the page that started it; a request with no usable
  // returnTo lands here instead, so the certain version of the message has to exist on this page.
  'link-conflict': 'บัญชี LINE นี้เชื่อมกับผู้ใช้อื่นในระบบอยู่แล้ว จึงเชื่อมกับบัญชีนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ',
  canceled: 'ยกเลิกการเข้าสู่ระบบด้วย LINE แล้ว',
  failed: 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้งหรือเข้าสู่ระบบด้วยรหัสผ่าน',
  unavailable: 'การเข้าสู่ระบบด้วย LINE ยังไม่เปิดใช้งาน',
  // P12-3a: a scanned desktop QR landed on the approve page without a session.
  'qr-approve': 'เข้าสู่ระบบก่อน แล้วระบบจะพากลับไปหน้ายืนยันการเข้าสู่ระบบบนคอมพิวเตอร์',
  // P12-3b: a LINE deep-link handoff token was expired, already used, or no longer authorised.
  // Not an error — `next` still carries the record, so signing in finishes the journey.
  'handoff-expired': 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบเพื่อเปิดรายการนี้',
};

// P12-3a desktop QR login. The poll is deliberately slower than the API's per-IP poll bucket
// allows for one QR lifetime, and a stale QR is refreshed a bounded number of times before the
// user is asked to act — an unattended tab must not mint transactions forever.
const QR_POLL_INTERVAL_MS = 2500;
const MAX_QR_AUTO_RENEWALS = 3;

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      มั่ง<span className="text-gold-300">มี</span>
    </span>
  );
}

// Left panel: brand + floating dashboard mock, exactly per มั่งมี Login.dc.html.
// Decorative content is Thai-only by design and hidden from assistive tech.
function HeroPanel({ locale }: { locale: 'th' | 'en' }) {
  const year = locale === 'th' ? new Date().getFullYear() + 543 : new Date().getFullYear();
  return (
    <div className="login-hero relative hidden flex-col justify-between overflow-hidden p-10 xl:p-14 lg:flex lg:flex-[1.15]">
      <div className="login-grain" />
      <div
        className="absolute -right-20 -top-28 h-[360px] w-[360px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(252,211,77,.35), transparent 70%)' }}
      />
      <div
        className="absolute -bottom-32 -left-24 h-[400px] w-[400px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(134,239,172,.3), transparent 70%)' }}
      />

      <div className="relative flex items-center gap-3.5">
        <div className="flex h-[54px] w-[54px] items-center justify-center rounded-2xl border border-white/20 bg-white/15 backdrop-blur">
          <MangmeeLogo size={32} />
        </div>
        <Wordmark className="text-2xl font-extrabold tracking-tight text-white" />
      </div>

      <div className="relative">
        <h2 className="max-w-[440px] text-3xl font-extrabold leading-snug text-white xl:text-4xl">
          {t('auth.hero.headline1', locale)}
          <br />
          {t('auth.hero.headline2', locale)}
        </h2>
        <p className="mt-3.5 max-w-[420px] text-[15px] leading-7 text-white/80">{t('auth.hero.sub', locale)}</p>

        <div aria-hidden className="login-float-1 relative mt-9 max-w-[400px] rounded-[20px] bg-white p-5 shadow-[0_30px_60px_rgba(0,0,0,.22)]">
          <div className="flex flex-wrap items-center justify-between">
            <span className="text-[13px] font-semibold text-gray-500">ภาพรวมวันนี้ · สาขาสยาม</span>
            <span className="rounded-lg bg-brand-100 px-2.5 py-1 text-[11px] font-bold text-brand-700">LIVE</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900">฿24,150</span>
            <span className="text-[13px] font-bold text-brand-600">▲ 12%</span>
          </div>
          <div className="mt-4 flex h-14 items-end gap-1.5">
            {[42, 60, 48, 78, 64, 100, 72].map((height, index) => (
              <div
                key={index}
                className={`flex-1 rounded-t-[5px] ${['bg-brand-200', 'bg-brand-300', 'bg-brand-400', 'bg-brand-500', 'bg-brand-600', 'bg-linear-to-b from-brand-500 to-brand-700', 'bg-brand-300'][index]}`}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div aria-hidden className="login-float-2 absolute right-2 top-3 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,.18)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">บิลรอตรวจ</div>
            <div className="text-base font-extrabold text-gray-900">18</div>
          </div>
        </div>
        <div aria-hidden className="login-float-3 absolute -bottom-7 right-11 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,.18)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">กำไรสุทธิ</div>
            <div className="text-base font-extrabold text-gray-900">฿15,730</div>
          </div>
        </div>
      </div>

      <p className="relative text-[12.5px] text-white/60">{formatMessage(t('auth.hero.footer', locale), { year })}</p>
    </div>
  );
}

const heroInputClass =
  'h-12 w-full rounded-xl border-[1.5px] border-gray-200 bg-white pl-10 pr-4 text-[15px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-700 focus:ring-2 focus:ring-brand-100';

function LoginForm({ accessState }: { accessState: 'OPEN' | 'CLOSED' }) {
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get('next'));
  // The server route already rejected the access session before rendering this form, and nothing on
  // a page request can see the refresh cookie (path-scoped to /api/auth) — so recovery is attempted
  // here, exactly once. `?recovered=1` marks that attempt as spent: if the browser refused to store
  // the rotated cookies, the second pass shows the form instead of reloading forever.
  const [checkingSession, setCheckingSession] = useState(
    shouldAttemptSessionRecovery(searchParams.get(RECOVERY_PARAM)),
  );
  const [sessionRecoveryUnavailable, setSessionRecoveryUnavailable] = useState(false);
  const [locale, setLocale] = useLocale();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // WEB-03: which field is wrong, said next to that field. `noValidate` stays — the browser's own
  // bubble is English-only and unstyled — so the form owns the check instead.
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  // Keep the option visible; only the server can enable the OAuth/QR actions.
  const [lineLoginState, setLineLoginState] = useState<'loading' | 'available' | 'unavailable' | 'error'>('loading');
  const [lineCheck, setLineCheck] = useState(0);
  const lineLoginAvailable = lineLoginState === 'available';
  // P12-3a desktop QR login. The desktop secret lives in an HttpOnly cookie the BFF sets, so
  // nothing here holds a credential — only the picture, the countdown and the poll.
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [qrSeconds, setQrSeconds] = useState(0);
  // The TTL the API issued this QR with; kept so the progress bar has a denominator.
  const [qrTtlSeconds, setQrTtlSeconds] = useState(0);
  const [qrError, setQrError] = useState<'load' | 'expired' | null>(null);
  const qrRenewalsRef = useRef(0);
  const lineNotice = searchParams.get('line');
  const lineNoticeText = lineNotice ? LINE_NOTICE_TEXT[lineNotice] : undefined;
  const lineNoticeIsAlert = lineNotice === 'failed' || lineNotice === 'link-failed' || lineNotice === 'link-conflict';
  // Link mode: a verified LINE account with no linked user. One password sign-in, then the
  // page hands the browser straight back to LINE so the callback can link it.
  const linkMode = lineNotice === 'link-required';

  useEffect(() => {
    let active = true;
    setLineLoginState('loading');
    void fetch('/api/auth/line-login/availability', { signal: AbortSignal.timeout(10_000) })
      .then((response) => {
        if (!response.ok) throw new Error('line_availability_failed');
        return response.json();
      })
      .then((data: { available?: boolean }) => {
        if (typeof data?.available !== 'boolean') throw new Error('line_availability_invalid');
        if (active) setLineLoginState(data.available ? 'available' : 'unavailable');
      })
      .catch(() => { if (active) setLineLoginState('error'); });
    return () => {
      active = false;
    };
  }, [lineCheck]);

  // Restore the session from the refresh cookie, then bounce back through /login so the server
  // route re-validates it and picks the landing path. Only a real 401 is signed-out; a timeout or
  // unavailable BFF gets the generic recovery state instead of a misleading login form.
  useEffect(() => {
    if (!checkingSession) return;
    let active = true;
    void refreshSessionWithOutcome().then((outcome) => {
      if (!active) return;
      if (outcome === 'restored') {
        const landing = recoveryReturnUrl(nextPath);
        window.location.assign(linkMode ? lineStartUrl(landing) : landing);
        return;
      }
      if (outcome !== 'signed_out') setSessionRecoveryUnavailable(true);
      setCheckingSession(false);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestQr = useCallback(async () => {
    setQrImageUrl(null);
    setQrError(null);
    try {
      const response = await fetch('/api/auth/line-qr/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: nextPath ?? null }),
      });
      const data = (await response.json()) as { qrImageUrl?: string; expiresInSeconds?: number };
      if (!response.ok || !data.qrImageUrl) throw new Error('qr_unavailable');
      const ttl = data.expiresInSeconds ?? 180;
      setQrTtlSeconds(ttl);
      setQrSeconds(ttl);
      setQrImageUrl(data.qrImageUrl);
    } catch {
      setQrError('load');
    }
  }, [nextPath]);

  // A dead QR is replaced automatically a few times, then the user is asked — so a tab left open
  // overnight stops asking the API for transactions nobody is going to scan.
  const handleQrExpired = useCallback(() => {
    setQrImageUrl(null);
    setQrSeconds(0);
    if (qrRenewalsRef.current >= MAX_QR_AUTO_RENEWALS) {
      setQrError('expired');
      return;
    }
    qrRenewalsRef.current += 1;
    void requestQr();
  }, [requestQr]);

  // Countdown; reaching zero retires the QR through the same path a server-side expiry takes.
  useEffect(() => {
    if (!qrOpen || !qrImageUrl) return;
    if (qrSeconds <= 0) {
      handleQrExpired();
      return;
    }
    const timer = setTimeout(() => setQrSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [qrOpen, qrImageUrl, qrSeconds, handleQrExpired]);

  // Polling runs only while the modal is open with a live QR: closing it stops the interval, and
  // the password form underneath is never touched (rule 6 — the page never acts for the user).
  useEffect(() => {
    if (!qrOpen || !qrImageUrl) return;
    let active = true;
    const timer = setInterval(() => {
      void fetch('/api/auth/line-qr/status', { method: 'POST' })
        .then((response) => response.json() as Promise<{ status?: string; redirectPath?: string }>)
        .then((data) => {
          if (!active) return;
          if (data.status === 'approved') {
            window.location.assign(data.redirectPath || '/');
            return;
          }
          if (data.status === 'expired') handleQrExpired();
        })
        // A transient poll failure is not an expiry: the countdown still owns the QR's lifetime.
        .catch(() => {});
    }, QR_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [qrOpen, qrImageUrl, handleQrExpired]);

  const openQrModal = () => {
    qrRenewalsRef.current = 0;
    setQrOpen(true);
    void requestQr();
  };

  const closeQrModal = () => {
    setQrOpen(false);
    setQrImageUrl(null);
    setQrSeconds(0);
    setQrTtlSeconds(0);
    setQrError(null);
  };

  if (sessionRecoveryUnavailable) {
    const retryParams = new URLSearchParams();
    if (nextPath) retryParams.set('next', nextPath);
    const retryQuery = retryParams.toString();
    return <GenericClientNotice alert retryHref={retryQuery ? `/login?${retryQuery}` : '/login'} />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Nothing is sent while a required field is empty: a 401 "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
    // for a blank box tells the user their credentials are wrong when they simply missed a field.
    const nextFieldErrors = {
      ...(trimmed(identifier) ? {} : { identifier: t('auth.login.error.identifier_required', locale) }),
      ...(trimmed(password) ? {} : { password: t('auth.login.error.password_required', locale) }),
    };
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.identifier || nextFieldErrors.password) {
      setError(null);
      document.getElementById(nextFieldErrors.identifier ? 'login-identifier' : 'login-password')?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await loginWithPassword(trimmed(identifier), trimmed(password), remember);

      if (result.passwordChangeRequired) {
        rememberPendingRedirect({
          ...result,
          redirectPath: result.legalAcceptanceRequired !== false
            ? legalAcceptancePath(nextPath ?? result.redirectPath, result.companyId)
            : (nextPath ?? result.redirectPath),
        });
        window.location.assign('/change-password');
        return;
      }

      const target = nextPath ?? result.redirectPath ?? '/';
      // Only an unblocked session may detour through LINE; a pending legal acceptance keeps its
      // gate, and the user can simply tap LINE login again afterwards to link.
      if (linkMode && result.legalAcceptanceRequired === false) {
        window.location.assign(lineStartUrl(target));
        return;
      }
      window.location.assign(result.legalAcceptanceRequired !== false ? legalAcceptancePath(target, result.companyId) : target);
    } catch (nextError) {
      if ((nextError as { code?: unknown }).code === 'platform_access_closed') {
        window.location.assign('/maintenance');
        return;
      }
      setError(
        localizedErrorMessage(nextError, locale, {
          401: 'auth.login.error.invalid',
          403: 'auth.login.error.temp_expired',
          429: 'auth.login.error.rate_limited',
          fallback: 'auth.login.error.failed',
          conflictCodes: { company_access_unavailable: 'auth.login.error.company_access_unavailable' },
        }),
      );
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loginAsDevOwner();
      const target = nextPath ?? result.redirectPath ?? '/';
      window.location.assign(result.legalAcceptanceRequired !== false ? legalAcceptancePath(target, result.companyId) : target);
    } catch (nextError) {
      setError(localizedErrorMessage(nextError, locale, { fallback: 'auth.login.error.failed' }));
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">{t('auth.login.checking_session', locale)}</p>
        </div>
      </div>
    );
  }

  // P12-3a: the qr-approve lane arrives from a phone that just scanned a LINE QR, so LINE is the
  // shortest way back — it leads and the password form drops below the divider. Every other lane
  // keeps the password form first. Both positions use the same button, so `next` still rides the
  // LINE round trip and still escapes the LINE in-app browser.
  const qrApproveLead = lineNotice === 'qr-approve' && lineLoginAvailable;

  const orDivider = (
    <div className="mt-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[13px] text-gray-400">หรือ</span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );

  const lineLoginButton = (
    <button
      type="button"
      disabled={!lineLoginAvailable}
      aria-describedby={!lineLoginAvailable ? 'line-login-status' : undefined}
      onClick={() => window.location.assign(withLineExternalBrowser(nextPath ? lineStartUrl(nextPath) : '/api/auth/line-login/start', navigator.userAgent))}
      className="mt-4 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[15.5px] font-semibold text-gray-900 transition enabled:hover:border-[#06C755] disabled:cursor-not-allowed disabled:text-gray-400"
    >
      <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-md bg-[#06C755] text-sm font-extrabold text-white">L</span>
      {locale === 'th' ? 'เข้าสู่ระบบด้วย LINE' : 'Sign in with LINE'}
    </button>
  );

  return (
    <div className="flex min-h-dvh">
      <HeroPanel locale={locale} />

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex flex-wrap items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-500 to-brand-900">
                <MangmeeLogo size={24} />
              </span>
              <Wordmark className="text-xl font-extrabold text-gray-900 [&>span]:text-gold-500" />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">{t('auth.login.title', locale)}</h1>
              <p className="mt-1.5 text-sm text-gray-500">{t('auth.login.subtitle', locale)}</p>
            </div>
            <button
              type="button"
              onClick={() => setLocale(locale === 'th' ? 'en' : 'th')}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
              aria-label={t('shell.language', locale)}
            >
              {locale === 'th' ? 'EN' : 'ไทย'}
            </button>
          </div>

          {accessState === 'CLOSED' ? (
            <div
              role="status"
              data-platform-access="closed"
              className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
            >
              <strong className="block">ระบบกำลังปรับปรุง</strong>
              ขณะนี้ระบบงานยังไม่เปิดให้ใช้งาน ระบบลูกค้า, LINE, เอกสาร และการประมวลผลงานยังปิดอยู่
              หากมีคำถามติดต่อ{' '}
              <a className="font-semibold underline" href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a>
            </div>
          ) : null}

          {lineNoticeText ? (
            <div
              role={lineNoticeIsAlert ? 'alert' : 'status'}
              data-line-notice={lineNotice}
              className={`mt-5 rounded-xl border px-4 py-3 text-sm leading-6 ${
                lineNoticeIsAlert
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {lineNoticeText}
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {qrApproveLead ? (
            <>
              {lineLoginButton}
              {orDivider}
            </>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="login-identifier" className="mb-2 block text-[13.5px] font-semibold text-gray-700">
                {t('auth.login.identifier', locale)}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C8C82" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </span>
                <input
                  id="login-identifier"
                  name="username"
                  autoComplete="username"
                  required
                  aria-invalid={fieldErrors.identifier ? true : undefined}
                  aria-describedby={fieldErrors.identifier ? 'login-identifier-error' : undefined}
                  value={identifier}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    if (fieldErrors.identifier) setFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                  }}
                  onBlur={(event) => setIdentifier(trimmed(event.target.value))}
                  className={`${heroInputClass} ${fieldErrors.identifier ? '!border-red-400' : ''}`}
                />
              </div>
              {fieldErrors.identifier ? (
                <p id="login-identifier-error" className="mt-1.5 text-sm font-medium text-red-700">{fieldErrors.identifier}</p>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <label htmlFor="login-password" className="text-[13.5px] font-semibold text-gray-700">
                  {t('auth.login.password', locale)}
                </label>
                <Link href="/forgot-password" className="text-[13px] font-semibold text-brand-700 hover:text-brand-800">
                  {t('auth.login.forgot', locale)}
                </Link>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C8C82" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </span>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={`${heroInputClass} pr-11 ${fieldErrors.password ? '!border-red-400' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={t(showPassword ? 'auth.login.hide_password' : 'auth.login.show_password', locale)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.61 6.61A18 18 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.39-1.61" /><path d="M1 1l22 22" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
              {fieldErrors.password ? (
                <p id="login-password-error" className="mt-1.5 text-sm font-medium text-red-700">{fieldErrors.password}</p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-[13.5px] text-gray-700">
              <input
                type="checkbox"
                name="remember"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-5 w-5 rounded-md border-gray-300 accent-brand-700"
              />
              {t('auth.login.remember', locale)}
            </label>

            <Button type="submit" size="lg" className="w-full !rounded-xl shadow-[0_12px_24px_rgba(21,128,61,.3)]" loading={loading}>
              {linkMode ? 'เข้าสู่ระบบและเชื่อม LINE' : t('auth.login.submit', locale)}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Button>
          </form>

          {!linkMode && <><Link href={nextPath ? `/email-access?next=${encodeURIComponent(nextPath)}` : "/email-access"} className="mt-3 block rounded-xl border px-4 py-3 text-center text-base font-semibold text-brand-700">{locale === 'th' ? 'เข้าสู่ระบบด้วยรหัส OTP' : 'Sign in with an email code'}</Link><p className="mt-2 text-center text-sm text-gray-500">{locale === 'th' ? 'รับรหัส 6 หลักทางอีเมล เพื่อใช้แทนรหัสผ่าน' : 'Get a 6-digit code by email instead of using a password.'}</p></>}

          {qrApproveLead ? null : (
            <>
              {orDivider}
              {lineLoginButton}
            </>
          )}
          {!lineLoginAvailable && (
            <div id="line-login-status" role="status" className="mt-2 text-center text-sm leading-6 text-gray-500">
              {lineLoginState === 'loading'
                ? (locale === 'th' ? 'กำลังตรวจสอบการเข้าสู่ระบบด้วย LINE…' : 'Checking LINE sign-in…')
                : lineLoginState === 'unavailable'
                  ? (locale === 'th' ? 'ยังไม่เปิดให้เข้าสู่ระบบด้วย LINE ในขณะนี้ ใช้รหัสผ่านหรือเข้าสู่ระบบด้วยรหัส OTP ทางอีเมลได้' : 'LINE sign-in is not enabled right now. Use your password or an email code.')
                  : (locale === 'th' ? 'ตรวจสอบสถานะ LINE ไม่สำเร็จ' : 'Could not check LINE sign-in availability.')}
              {lineLoginState === 'error' && <button type="button" onClick={() => setLineCheck(value => value + 1)} className="mx-auto block min-h-11 px-3 font-semibold text-brand-700 underline">{locale === 'th' ? 'ลองตรวจสอบอีกครั้ง' : 'Try again'}</button>}
            </div>
          )}
          {lineLoginAvailable ? (
            <>
              {/* Scanning is only useful where the phone is a second device, so the entry point is
                  desktop-only; on a phone the LINE button above already is the shortest path. */}
              <div className="mt-3 hidden md:flex">
                <button
                  type="button"
                  onClick={openQrModal}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14.5px] font-semibold text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" /></svg>
                  สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์
                </button>
              </div>
            </>
          ) : null}

          {SHOW_DEV_LOGIN ? (
            <button
              type="button"
              onClick={handleDevLogin}
              disabled={loading} aria-busy={Boolean(loading)}
              className="mt-6 w-full rounded-lg border border-dashed border-gray-300 px-4 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              Dev sign-in (local seed OWNER)
            </button>
          ) : null}

          {/* Public legal notices must remain reachable before authentication. */}
          <nav aria-label="เอกสารทางกฎหมาย" className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-gray-400">
            <Link href="/privacy" className="underline hover:text-gray-600">ประกาศความเป็นส่วนตัว</Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="underline hover:text-gray-600">ข้อกำหนดการใช้งาน</Link>
            <span aria-hidden>·</span>
            <Link href="/data-deletion" className="underline hover:text-gray-600">การลบข้อมูล</Link>
          </nav>
        </div>
      </div>

      {qrOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/55 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์"
          onClick={closeQrModal}
        >
          <div
            className="w-[400px] max-w-full overflow-hidden rounded-[20px] bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 bg-[#06C755] px-[22px] py-[18px] text-white">
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white text-lg font-extrabold text-[#06C755]">L</span>
              <div className="flex-1">
                <div className="text-lg font-bold">เข้าสู่ระบบด้วย LINE</div>
                <div className="text-[13.5px] opacity-90">สแกน QR ด้วยแอป LINE บนมือถือ</div>
              </div>
              <button type="button" onClick={closeQrModal} aria-label="ปิด" className="text-[22px] opacity-90">
                ✕
              </button>
            </div>
            <div className="px-[22px] py-[26px] text-center">
              {qrError ? (
                <div role="alert" className="space-y-4">
                  <p className="text-[15px] leading-7 text-gray-600">
                    {qrError === 'expired'
                      ? 'หมดเวลา กดสร้าง QR ใหม่'
                      : 'สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'}
                  </p>
                  <Button
                    type="button"
                    size="lg"
                    className="w-full !rounded-xl"
                    onClick={() => {
                      qrRenewalsRef.current = 0;
                      void requestQr();
                    }}
                  >
                    สร้าง QR ใหม่
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative mx-auto flex h-[236px] w-[236px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    {qrImageUrl ? (
                      // Rendered by the API as an inline SVG data URI (H-09): the one-time code
                      // never travels to an external image service.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrImageUrl} alt="QR สำหรับเข้าสู่ระบบ" className="h-full w-full" />
                    ) : (
                      <span className="text-sm text-gray-400">กำลังสร้าง QR…</span>
                    )}
                  </div>

                  <div className="mt-[18px] h-1.5 overflow-hidden rounded-md bg-gray-100">
                    <div
                      className="h-full rounded-md transition-[width] duration-1000 ease-linear"
                      style={{
                        width: `${qrTtlSeconds > 0 ? (qrSeconds / qrTtlSeconds) * 100 : 0}%`,
                        background: qrSeconds <= 10 ? '#F04438' : '#06C755',
                      }}
                    />
                  </div>
                  <div className="mt-2.5 text-[15px] text-gray-500">
                    QR หมดอายุใน{' '}
                    <span className={`font-bold tabular-nums ${qrSeconds <= 10 ? 'text-red-500' : 'text-gray-700'}`}>
                      {Math.floor(qrSeconds / 60)}:{String(qrSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="mt-[18px] border-t border-gray-100 pt-4 text-[13.5px] leading-relaxed text-gray-400">
                    เปิดแอป LINE → ปุ่มสแกน → สแกน QR นี้ · ยืนยันบนมือถือแล้วหน้านี้จะเข้าสู่ระบบให้เอง
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LoginPage({ accessState = 'OPEN' }: { accessState?: 'OPEN' | 'CLOSED' }) {
  return (
    <Suspense fallback={null}>
      <LoginForm accessState={accessState} />
    </Suspense>
  );
}
