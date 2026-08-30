'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SignupClaimInfoDto, SignupClaimResultDto } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { TextField } from '@/common/components/field';
import { trimmed } from '@/common/forms/trim';
import { readTokenParam } from '@/features/auth/auth.logic';
import { attachSignupClaimToExistingUser, getSignupClaimInfo, setSignupClaimPassword } from './external-signup.api';
import { rememberClaimedCompany } from './welcome-handoff.logic';
import { SignupBrandHeader } from './SignupChrome';
import { signupSubmitErrorMessage, validateClaimPassword, type ClaimPasswordErrors } from './signup.logic';

/**
 * One view for every unusable token — invalid, expired, already spent. Telling them apart would
 * tell someone holding a guessed token which guess was closer (spec §4B: single-use, hash-only).
 */
function UnusableLinkView() {
  return (
    <div className="space-y-4" role="status">
      <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">ลิงก์ไม่พร้อมใช้งาน</h1>
      <p className="text-[15px] leading-7 text-gray-600">
        ลิงก์นี้อาจหมดอายุ หรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้จากหน้าตรวจสอบสถานะคำขอของคุณ
      </p>
      <Link
        href="/login"
        className="flex h-12 w-full items-center justify-center rounded-xl border-[1.5px] border-gray-200 bg-white text-[15.5px] font-semibold text-gray-900 hover:border-[#046B29]"
      >
        ไปหน้าเข้าสู่ระบบ
      </Link>
    </div>
  );
}

function ClaimCard({ token, info }: { token: string; info: SignupClaimInfoDto }) {
  const [mode, setMode] = useState<'set-password' | 'existing-account'>('set-password');
  const [username, setUsername] = useState(info.suggestedUsername ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [existingPassword, setExistingPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClaimPasswordErrors>({});
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
    setLoading(true);
    setError(null);
    try {
      finish(await attachSignupClaimToExistingUser({ token, identifier: trimmed(identifier), password: existingPassword }));
    } catch (cause) {
      setError(signupSubmitErrorMessage(cause));
      setLoading(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F4EC] px-3 py-1.5 text-[13px] font-bold text-[#046B29]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
        ยืนยันอีเมลเรียบร้อย
      </span>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] leading-7 text-red-700">
          {error}
        </div>
      ) : null}

      {mode === 'set-password' ? (
        <>
          <h1 className="mt-4 text-[22px] font-extrabold leading-9 text-gray-900">ตั้งรหัสผ่าน</h1>
          <p className="mt-1.5 text-[15px] leading-7 text-gray-600">สำหรับเข้าใช้งาน {companyName}</p>

          <form onSubmit={handleSetPassword} className="mt-6 space-y-4" noValidate>
            <TextField
              label="ชื่อผู้ใช้"
              name="username"
              autoComplete="username"
              hint={`ใช้เข้าสู่ระบบได้ทั้งชื่อผู้ใช้ และอีเมล${info.maskedEmail ? ` ${info.maskedEmail}` : ''}`}
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
              hint="อย่างน้อย 8 ตัว มีทั้งตัวอักษร และตัวเลข"
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
            <Button type="submit" size="lg" className="w-full !rounded-xl" loading={loading}>
              เริ่มใช้งาน
            </Button>
          </form>

          <p className="mt-3 text-[13px] leading-6 text-gray-500">
            รหัสนี้ใช้กับระบบมั่งมีพลัส ไม่เกี่ยวกับรหัสของ LINE
          </p>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[13px] text-gray-400">หรือ</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-[14.5px] font-semibold text-gray-800">เคยมีบัญชีมั่งมีพลัสอยู่แล้ว?</p>
            <p className="mt-1 text-[13.5px] leading-6 text-gray-500">เช่น เป็นพนักงานอยู่ในระบบ</p>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="mt-3 w-full !rounded-xl"
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
          <h1 className="mt-4 text-[22px] font-extrabold leading-9 text-gray-900">เข้าสู่ระบบด้วยบัญชีเดิม</h1>
          <p className="mt-1.5 text-[15px] leading-7 text-gray-600">
            ร้านใหม่จะรวมอยู่ในบัญชีเดิม สลับร้านได้ ไม่ต้องจำรหัสหลายชุด
          </p>

          <form onSubmit={handleAttach} className="mt-6 space-y-4" noValidate>
            <TextField
              label="ชื่อผู้ใช้ หรือ อีเมล"
              name="identifier"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              onBlur={(event) => setIdentifier(trimmed(event.target.value))}
              required
            />
            <TextField
              label="รหัสผ่าน"
              name="password"
              type="password"
              autoComplete="current-password"
              value={existingPassword}
              onChange={(event) => setExistingPassword(event.target.value)}
              required
            />
            <Button type="submit" size="lg" className="w-full !rounded-xl" loading={loading}>
              เข้าสู่ระบบ และเพิ่มร้านนี้
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode('set-password');
              setError(null);
            }}
            className="mt-4 w-full text-[14.5px] font-semibold text-gray-600 underline hover:text-gray-900"
          >
            ย้อนกลับไปตั้งรหัสผ่านใหม่
          </button>
        </>
      )}
    </>
  );
}

function ClaimAccount() {
  const searchParams = useSearchParams();
  const token = readTokenParam(searchParams.get('token'));
  const [info, setInfo] = useState<SignupClaimInfoDto | null>(null);
  const [unusable, setUnusable] = useState(!token);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void getSignupClaimInfo(token)
      .then((result) => {
        if (!active) return;
        if (result.valid) setInfo(result);
        else setUnusable(true);
      })
      .catch(() => {
        if (active) setUnusable(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:py-12">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          {unusable ? (
            <UnusableLinkView />
          ) : info && token ? (
            <ClaimCard token={token} info={info} />
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
