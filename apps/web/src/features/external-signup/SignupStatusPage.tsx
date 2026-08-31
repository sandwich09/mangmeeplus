'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicSignupStatusDto } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { getSignupStatus, resendSignupClaimEmail } from './external-signup.api';
import { SignupBrandHeader } from './SignupChrome';
import { SIGNUP_SUPPORT_PHONE, signupStatusCopy, signupSubmitErrorMessage } from './signup.logic';

const TONE_CLASS = {
  info: 'border-gray-200 bg-gray-50 text-gray-700',
  success: 'border-[#B6E0C4] bg-[#F2F9F4] text-[#046B29]',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-700',
} as const;

export default function SignupStatusPage({ requestId }: { requestId: string }) {
  const [status, setStatus] = useState<PublicSignupStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSignupStatus(requestId)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((cause) => {
        if (active) setLoadError(signupSubmitErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  const handleResend = async () => {
    setResendState('sending');
    setResendError(null);
    try {
      await resendSignupClaimEmail(requestId);
      setResendState('sent');
    } catch (cause) {
      // Rate limiting is the expected answer to an impatient second tap, so it reads as a wait,
      // not as a failure the user has to solve.
      setResendError(signupSubmitErrorMessage(cause));
      setResendState('idle');
    }
  };

  const copy = status ? signupStatusCopy(status.status, status.canResendClaim) : null;

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:max-w-lg sm:py-10">
        <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">สถานะคำขอสมัคร</h1>

          {loadError ? (
            <div role="alert" className="space-y-3">
              <p className="text-[15px] leading-7 text-gray-600">
                ไม่พบคำขอนี้ หรือลิงก์ไม่ถูกต้อง กรุณาตรวจลิงก์ที่บันทึกไว้อีกครั้ง
              </p>
              <p className="text-[13.5px] text-gray-500">{loadError}</p>
            </div>
          ) : !copy ? (
            <p className="text-[15px] text-gray-500">กำลังโหลด…</p>
          ) : (
            <>
              <div role="status" className={`rounded-xl border px-4 py-3.5 ${TONE_CLASS[copy.tone]}`}>
                <p className="text-[16px] font-bold">{copy.title}</p>
                <p className="mt-1 text-[14.5px] leading-7">{copy.body}</p>
              </div>

              {status?.status === 'READY' ? (
                <Link
                  href="/login"
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-[#046B29] text-[15.5px] font-semibold text-white"
                >
                  เข้าสู่ระบบ
                </Link>
              ) : null}

              {status?.canResendClaim ? (
                <div className="space-y-2.5 border-t border-gray-100 pt-5">
                  <p className="text-[14.5px] leading-7 text-gray-600">
                    ไม่ได้รับอีเมล หรือลิงก์หมดอายุ? กดขอลิงก์ใหม่ได้ ระบบจะส่งอีเมลฉบับใหม่ให้
                  </p>
                  {resendState === 'sent' ? (
                    <p role="status" className="rounded-xl border border-[#B6E0C4] bg-[#F2F9F4] px-4 py-3 text-[14.5px] leading-7 text-[#046B29]">
                      ส่งอีเมลใหม่ให้แล้ว กรุณาตรวจกล่องจดหมาย และเมลขยะ
                    </p>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      variant="secondary"
                      className="w-full !rounded-xl"
                      loading={resendState === 'sending'}
                      onClick={handleResend}
                    >
                      ขอลิงก์ตั้งรหัสผ่านใหม่
                    </Button>
                  )}
                  {resendError ? (
                    <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14.5px] leading-7 text-amber-900">
                      {resendError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          <p className="border-t border-gray-100 pt-4 text-[13.5px] leading-6 text-gray-500">
            ต้องการความช่วยเหลือ โทร{' '}
            <a href={`tel:${SIGNUP_SUPPORT_PHONE.replace(/-/g, '')}`} className="font-semibold text-[#046B29] underline">
              {SIGNUP_SUPPORT_PHONE}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
