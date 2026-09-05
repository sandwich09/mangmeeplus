'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicSignupStatusDto } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { getSignupStatus, resendSignupClaimEmail } from './external-signup.api';
import { SignupBrandHeader } from './SignupChrome';
import {
  isTransientLoadFailure,
  SIGNUP_SUPPORT_EMAIL,
  SIGNUP_SUPPORT_PHONE,
  signupStatusCopy,
  signupSubmitErrorMessage,
} from './signup.logic';

const TONE_CLASS = {
  info: 'border-gray-200 bg-gray-50 text-gray-700',
  success: 'border-[#B6E0C4] bg-[#F2F9F4] text-[#046B29]',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-700',
} as const;

export default function SignupStatusPage({ requestId }: { requestId: string }) {
  const [status, setStatus] = useState<PublicSignupStatusDto | null>(null);
  // R11: an outage is not a verdict on the link. `transient` decides which of the two very
  // different sentences the page is allowed to say, and whether a retry is offered at all.
  const [loadError, setLoadError] = useState<{ message: string; transient: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    void getSignupStatus(requestId)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((cause) => {
        if (active) {
          setLoadError({ message: signupSubmitErrorMessage(cause), transient: isTransientLoadFailure(cause) });
        }
      });
    return () => {
      active = false;
    };
  }, [requestId, attempt]);

  // R12: the id lives in the URL and nowhere else. Handing that URL over is the whole recovery,
  // so the page has to be able to do it without asking anyone to read a cuid out loud.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      // A browser that refuses clipboard access still shows the URL in its own address bar.
      setLinkCopied(false);
    }
  };

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
                {loadError.transient
                  ? 'ตอนนี้ตรวจสถานะไม่ได้ชั่วคราว คำขอของคุณยังอยู่ กดลองใหม่อีกครั้งได้เลย'
                  : 'ไม่พบคำขอนี้ หรือลิงก์ไม่ถูกต้อง กรุณาตรวจลิงก์ที่บันทึกไว้อีกครั้ง'}
              </p>
              <p className="text-[13.5px] text-gray-500">{loadError.message}</p>
              {loadError.transient ? (
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  className="w-full !rounded-xl"
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  ลองใหม่อีกครั้ง
                </Button>
              ) : null}
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

              {/* R12: this URL is the applicant's only way back. Copy, then paste it into their
                  own chat — a bookmark on a phone browser is the thing they lose first. */}
              <div className="space-y-1.5">
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  className="w-full !rounded-xl"
                  onClick={() => void copyLink()}
                >
                  {linkCopied ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์หน้านี้'}
                </Button>
                <p className="text-[13px] leading-6 text-gray-500">
                  เก็บลิงก์นี้ไว้ กลับมาดูสถานะได้ตลอด แนะนำให้ส่งเข้าแชตของตัวเอง
                </p>
              </div>

              {status?.canResendClaim ? (
                <div className="space-y-2.5 border-t border-gray-100 pt-5">
                  <p className="text-[14.5px] leading-7 text-gray-600">
                    ไม่ได้รับอีเมล หรือลิงก์หมดอายุ? กดขอลิงก์ใหม่ได้ ระบบจะส่งอีเมลฉบับใหม่ให้
                  </p>
                  {resendState === 'sent' ? (
                    // R11: the API answers once the outbox row exists. A worker, SES and the
                    // applicant's own provider all stand between that and a mailbox, so this says
                    // what actually happened — the delivered claim belongs to whoever can see it.
                    <p role="status" className="rounded-xl border border-[#B6E0C4] bg-[#F2F9F4] px-4 py-3 text-[14.5px] leading-7 text-[#046B29]">
                      รับคำขอส่งอีเมลใหม่แล้ว อีเมลจะถึงภายในไม่กี่นาที กรุณาตรวจกล่องจดหมาย และเมลขยะ
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

          {/* Owner UAT 2026-08-31: a phone number alone strands anyone who cannot call — the same
              mailbox the expired-request copy already points at is offered here too. */}
          <p className="border-t border-gray-100 pt-4 text-[13.5px] leading-6 text-gray-500">
            ต้องการความช่วยเหลือ โทร{' '}
            <a href={`tel:${SIGNUP_SUPPORT_PHONE.replace(/-/g, '')}`} className="font-semibold text-[#046B29] underline">
              {SIGNUP_SUPPORT_PHONE}
            </a>
            {' '}หรืออีเมล{' '}
            <a href={`mailto:${SIGNUP_SUPPORT_EMAIL}`} className="font-semibold text-[#046B29] underline">
              {SIGNUP_SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
