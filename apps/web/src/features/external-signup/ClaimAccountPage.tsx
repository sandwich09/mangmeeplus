'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SignupClaimInfoDto, SignupClaimResultDto } from '@watchdog-bms/contracts';
import { Button, primaryButtonClass, quietButtonClass, secondaryButtonClass } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { trimmed } from '@/common/forms/trim';
import { readEmailLinkToken } from '@/features/auth/auth.logic';
import { attachSignupClaimToExistingUser, getSignupClaimInfo, setSignupClaimPassword } from './external-signup.api';
import { rememberClaimedCompany } from './welcome-handoff.logic';
import { SignupBrandHeader } from './SignupChrome';
import {
  CLAIM_USERNAME_HINT,
  CLAIM_USERNAME_MAX,
  isTransientLoadFailure,
  SIGNUP_SUPPORT_PHONE,
  signupSubmitErrorMessage,
  validateClaimPassword,
  type ClaimPasswordErrors,
} from './signup.logic';

/**
 * One view for every unusable token — invalid, expired, already spent. Telling them apart would
 * tell someone holding a guessed token which guess was closer (spec §4B: single-use, hash-only).
 *
 * R12: "ขอลิงก์ใหม่ได้จากหน้าตรวจสอบสถานะ" used to be advice with no way to follow it — the only
 * button went to a login the applicant has no password for. The claim mail carries the request id
 * beside the token, so when it is there this offers the page it is telling them to open.
 */
function UnusableLinkView({ statusRequestId }: { statusRequestId?: string }) {
  // A refusal with its way out on the same screen (thai-ux-standard §1.6). With the request id the
  // status page is one press away. Without it the page cannot name that page, so it says who can
  // send a new link, and still offers the sign-in for someone whose link was simply used already.
  return (
    <div className="space-y-4" role="status">
      <h1 className="text-[22px] font-bold leading-9 text-gray-900">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
      <p className="text-[15px] leading-7 text-gray-600">
        {statusRequestId
          ? 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้ที่หน้าสถานะคำขอ'
          : `ลิงก์หมดอายุหรือถูกใช้ไปแล้ว ถ้าตั้งรหัสผ่านแล้วให้เข้าสู่ระบบ ถ้ายังไม่ได้ตั้ง ติดต่อทีมงานมั่งมี ${SIGNUP_SUPPORT_PHONE} เพื่อขอลิงก์ใหม่`}
      </p>
      <div className="grid gap-3">
        {statusRequestId ? (
          <Link href={`/signup/status/${encodeURIComponent(statusRequestId)}`} className={`${primaryButtonClass} w-full`}>
            ดูสถานะคำขอ
          </Link>
        ) : null}
        <Link href="/login" className={`${statusRequestId ? secondaryButtonClass : primaryButtonClass} w-full`}>
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}

/**
 * R11: an API restart, a rate limit or a lost connection while the applicant opened their email
 * used to retire a link that was perfectly good — every failure landed on the view above. This one
 * says the truth (we could not check) and offers the only action that helps.
 */
function ClaimCheckFailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-4" role="alert">
      <h1 className="text-[22px] font-bold leading-9 text-gray-900">ตรวจสอบลิงก์ไม่ได้ตอนนี้</h1>
      <p className="text-[15px] leading-7 text-gray-600">
        ระบบขัดข้องชั่วคราว ยังตรวจลิงก์นี้ไม่ได้
      </p>
      <Button type="button" className="w-full" onClick={onRetry}>
        ลองอีกครั้ง
      </Button>
    </div>
  );
}

function ClaimCard({ token, info }: { token: string; info: SignupClaimInfoDto }) {
  // `setPassword` refuses a duplicate email before it even consumes the token
  // (signup-claim.use-case.ts: `email_already_registered_use_existing_account`), so for this
  // applicant the password form has no legal outcome. The page leads with the one lane that works
  // instead of letting them fill a form that can only fail (Owner UAT 2026-08-31).
  const emailHasAccount = info.emailMatchesExistingUser === true;
  const [mode, setMode] = useState<'set-password' | 'existing-account'>(
    emailHasAccount ? 'existing-account' : 'set-password',
  );
  const [username, setUsername] = useState(info.suggestedUsername ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [existingPassword, setExistingPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClaimPasswordErrors>({});
  const [attachErrors, setAttachErrors] = useState<{ identifier?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const companyName = info.companyName ?? 'ร้านของคุณ';

  const finish = (result: SignupClaimResultDto & { sessionEstablished?: boolean }) => {
    rememberClaimedCompany(result);
    // Company exists either way; without a session the welcome page's LINE step needs a login first.
    window.location.assign(result.sessionEstablished === false ? '/login?next=%2Fsignup%2Fwelcome' : '/signup/welcome');
  };

  const handleSetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateClaimPassword(username, password, confirmPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    setError(null);
    try {
      finish(await setSignupClaimPassword({ token, username: trimmed(username), password }));
    } catch (cause) {
      setError(signupSubmitErrorMessage(cause));
      setLoading(false);
    }
  };

  const handleAttach = async (event: React.FormEvent) => {
    event.preventDefault();
    // Nothing is sent while a field is empty: an empty form used to go to the server and come back
    // as "wrong user name or password" for someone who had typed neither.
    const missing = {
      ...(trimmed(identifier) ? {} : { identifier: 'กรอกชื่อผู้ใช้หรืออีเมล' }),
      ...(existingPassword ? {} : { password: 'กรอกรหัสผ่าน' }),
    };
    setAttachErrors(missing);
    if (missing.identifier || missing.password) {
      setError(null);
      document.getElementById(missing.identifier ? 'identifier' : 'password')?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      finish(await attachSignupClaimToExistingUser({ token, identifier: trimmed(identifier), password: existingPassword }));
    } catch (cause) {
      // Owner UAT 2026-09-01: an attach 401 is a wrong username/password — there is no ambient
      // session on this lane, so the shared 401 fallback ("เซสชันหมดอายุ") told the wrong story.
      // Same wording the login page uses for its own 401.
      setError((cause as { status?: number })?.status === 401
        ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
        : signupSubmitErrorMessage(cause));
      setLoading(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F4EC] px-3 py-1.5 text-[13px] font-bold text-[#046B29]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
        ยืนยันอีเมลแล้ว
      </span>

      {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}

      {mode === 'set-password' ? (
        <>
          <h1 className="mt-4 text-[22px] font-bold leading-9 text-gray-900">ตั้งรหัสผ่าน</h1>
          <p className="mt-1.5 text-[15px] leading-7 text-gray-600">สำหรับเข้าใช้งาน {companyName}</p>

          <form onSubmit={handleSetPassword} className="mt-6 space-y-4" noValidate>
            {/* The hint, the cap and the check now all say the same thing the API enforces. The
                field used to accept anything non-empty, so a Thai username came back as a 400 the
                applicant could not read — after they had typed a password twice. */}
            <TextField
              label="ชื่อผู้ใช้"
              name="username"
              autoComplete="username"
              maxLength={CLAIM_USERNAME_MAX}
              hint={fieldErrors.username ? undefined : `${CLAIM_USERNAME_HINT} ใช้เข้าสู่ระบบได้ทั้งชื่อผู้ใช้ และอีเมล${info.maskedEmail ? ` ${info.maskedEmail}` : ''}`}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onBlur={(event) => setUsername(trimmed(event.target.value))}
              error={fieldErrors.username}
            />
            {/* TextField renders the accessible show/hide eye for every password field. */}
            <TextField
              label="รหัสผ่าน"
              name="new-password"
              type="password"
              autoComplete="new-password"
              hint={fieldErrors.password ? undefined : 'อย่างน้อย 8 ตัว มีทั้งตัวอักษร และตัวเลข'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
            />
            <TextField
              label="ยืนยันรหัสผ่าน"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={fieldErrors.confirmPassword}
            />
            <Button type="submit" className="w-full" loading={loading}>
              ตั้งรหัสผ่านและเริ่มใช้งาน
            </Button>
          </form>

          <p className="mt-3 text-[13px] leading-6 text-gray-500">
            รหัสผ่านนี้ใช้กับมั่งมีพลัส ไม่ใช่รหัสผ่านของ LINE
          </p>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[13px] text-gray-500">หรือ</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* No box of its own: it is one sentence and its button, already set apart by the "หรือ" line. */}
          <div className="mt-4">
            <p className="text-sm leading-6 text-gray-700">เคยมีบัญชีมั่งมีพลัสอยู่แล้ว เช่น เป็นพนักงานอยู่ในระบบ</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => {
                setMode('existing-account');
                setError(null);
              }}
            >
              เข้าสู่ระบบด้วยบัญชีเดิม
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-4 text-[22px] font-bold leading-9 text-gray-900">เข้าสู่ระบบด้วยบัญชีเดิม</h1>
          <p className="mt-1.5 text-[15px] leading-7 text-gray-600">
            {emailHasAccount
              ? `อีเมลนี้มีบัญชีมั่งมีพลัสอยู่แล้ว ให้เข้าสู่ระบบด้วยบัญชีเดิม เพื่อผูก ${companyName} เข้ากับบัญชีเดิม`
              : 'ร้านใหม่จะรวมอยู่ในบัญชีเดิม สลับร้านได้ ไม่ต้องจำรหัสหลายชุด'}
          </p>

          <form onSubmit={handleAttach} className="mt-6 space-y-4" noValidate>
            <TextField
              label="ชื่อผู้ใช้ หรือ อีเมล"
              name="identifier"
              autoComplete="username"
              value={identifier}
              onChange={(event) => { setIdentifier(event.target.value); if (attachErrors.identifier) setAttachErrors((prev) => ({ ...prev, identifier: undefined })); }}
              onBlur={(event) => setIdentifier(trimmed(event.target.value))}
              required
              error={attachErrors.identifier}
            />
            <TextField
              label="รหัสผ่าน"
              name="password"
              type="password"
              autoComplete="current-password"
              value={existingPassword}
              onChange={(event) => { setExistingPassword(event.target.value); if (attachErrors.password) setAttachErrors((prev) => ({ ...prev, password: undefined })); }}
              required
              error={attachErrors.password}
            />
            <Button type="submit" className="w-full" loading={loading}>
              เข้าสู่ระบบ และเพิ่มร้านนี้
            </Button>
          </form>

          {/* Anyone on this lane can be locked out of the account they are trying to attach to, so
              the recovery is offered to both — it used to appear only for a duplicate email, which
              stranded exactly the people who came here BECAUSE they have an old account. An
              account that only ever signed in with LINE has no password to reset, so that case is
              named rather than left to a reset mail that never arrives. */}
          <p className="mt-4 text-[13px] leading-6 text-gray-500">
            จำรหัสผ่านบัญชีเดิมไม่ได้?{' '}
            <Link href="/forgot-password" target="_blank" className="font-semibold text-[#046B29] underline">
              ตั้งรหัสผ่านใหม่
            </Link>
            {' '}แล้วกลับมาที่หน้านี้อีกครั้ง ถ้าเคยเข้าด้วย LINE อย่างเดียวและยังไม่เคยตั้งรหัสผ่าน ติดต่อทีมงานมั่งมี {SIGNUP_SUPPORT_PHONE}
          </p>

          {/* Going back is only offered when a new account is actually reachable: for a duplicate
              email the server refuses that branch, so the link would lead to a form that can only
              fail — and the line above says what choosing it would mean. */}
          {emailHasAccount ? null : (
            <button
              type="button"
              onClick={() => {
                setMode('set-password');
                setError(null);
              }}
              className={`${quietButtonClass} mt-3 w-full`}
            >
              กลับไปสร้างบัญชีใหม่สำหรับร้านนี้ (ร้านจะไม่รวมกับบัญชีเดิม)
            </button>
          )}
        </>
      )}
    </>
  );
}

function ClaimAccount() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>();
  useEffect(() => {
    const read = () => {
      const url = new URL(window.location.href);
      const value = readEmailLinkToken(url.search, url.hash);
      if (value && url.searchParams.has('token')) {
        url.searchParams.delete('token');
        url.hash = new URLSearchParams({ token: value }).toString();
        window.history.replaceState(window.history.state, '', url);
      }
      setToken(value);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [searchParams]);
  // R12: the claim mail carries the request id beside the token, so a link that turns out to be
  // spent still knows which status page to send its holder to. Never PII, and the status endpoint
  // answers with a coarse state only.
  const statusRequestId = searchParams.get('r')?.trim() || undefined;
  const [info, setInfo] = useState<{ token: string; data: SignupClaimInfoDto } | null>(null);
  const [unusable, setUnusable] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setUnusable(false);
    setInfo(null);
    setCheckFailed(false);
    void getSignupClaimInfo(token)
      .then((result) => {
        if (!active) return;
        if (result.valid) setInfo({ token, data: result });
        else setUnusable(true);
      })
      .catch((cause) => {
        if (!active) return;
        // Only a definite answer from the server may retire the link. Everything else is an outage.
        if (isTransientLoadFailure(cause)) setCheckFailed(true);
        else setUnusable(true);
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:py-12">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          {token === null || (token !== undefined && unusable) ? (
            <UnusableLinkView {...(statusRequestId ? { statusRequestId } : {})} />
          ) : checkFailed ? (
            <ClaimCheckFailedView onRetry={() => setAttempt((count) => count + 1)} />
          ) : info && token && info.token === token ? (
            <ClaimCard key={token} token={token} info={info.data} />
          ) : (
            <p className="text-[15px] text-gray-500">กำลังตรวจสอบลิงก์…</p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ClaimAccountPage() {
  return (
    <Suspense fallback={null}>
      <ClaimAccount />
    </Suspense>
  );
}
