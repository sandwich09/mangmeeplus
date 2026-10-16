'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES, SIGNUP_DISCOVERY_OTHER_MAX, SIGNUP_DISCOVERY_SOURCE_OPTIONS, type PublicCompanySignupBody, type SignupDiscoverySource } from '@watchdog-bms/contracts';
import { Button, secondaryButtonClass } from '@/common/components/button';
import { ChoiceRow, SelectField, TextField } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { trimmed } from '@/common/forms/trim';
import { getSignupAvailability, submitCompanySignup } from './external-signup.api';
import { SignupBrandHeader, SignupClosedNotice, SignupUnavailableNotice } from './SignupChrome';
import {
  clampMobileInput,
  clampSalesCodeInput,
  firstSignupErrorField,
  MOBILE_DIGITS,
  rotateSignupKeyAfter,
  SELECTABLE_OFFER_KEY,
  SIGNUP_CONSENT_VERSION,
  SIGNUP_SUPPORT_PHONE,
  SIGNUP_TRIAL_AFTER,
  SIGNUP_TRIAL_HEADLINE,
  signupFieldRejection,
  signupSubmitErrorMessage,
  validateSignupForm,
  type SignupFieldErrors,
  type SignupFormValues,
} from './signup.logic';

const EMPTY_FORM: SignupFormValues = {
  companyName: '',
  ownerFirstName: '',
  ownerLastName: '',
  contactEmail: '',
  phoneNumber: '',
  vatRegistered: false,
  taxId: '',
  discoverySource: '',
  discoverySourceOther: '',
  referralSalesCode: '',
};

/**
 * Owner 2026-09-20 (spec R1): no trial, so this says what signing up actually gets you — an open
 * shop — and what starting it costs. The warm-up line went with the trial allowance it described.
 * (The retired PRO price is deliberately not repeated here: `signup-pages.qa.spec.ts` scans this
 * file's raw source, comments included, and it is right to.)
 */
export function TrialNotice() {
  return (
    <p className="text-sm leading-6 text-gray-600">
      <span className="font-semibold text-gray-800">{SIGNUP_TRIAL_HEADLINE}</span> {SIGNUP_TRIAL_AFTER}
    </p>
  );
}

function SubmittedView({ requestId }: { requestId: string }) {
  return (
    <div className="space-y-5" role="status">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E7F4EC] text-[#046B29]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" /></svg>
      </span>
      <div className="space-y-2">
        <h1 className="text-[22px] font-bold leading-9 text-gray-900">ได้รับคำขอแล้ว กำลังตรวจสอบ</h1>
        {/* Someone who already has a มั่งมีพลัส account does NOT set a new password — the claim page
            offers both lanes — so promising "set a password" told half of them the wrong story. */}
        <p className="text-[15px] leading-7 text-gray-600">
          เมื่ออนุมัติ เราจะส่งลิงก์เปิดใช้งานทางอีเมล ตั้งรหัสใหม่หรือใช้บัญชีเดิมได้
        </p>
      </div>
      <TrialNotice />
      <Link
        href={`/signup/status/${encodeURIComponent(requestId)}`}
        className={`${secondaryButtonClass} w-full`}
      >
        ตรวจสอบสถานะคำขอ
      </Link>
      {/* R12: resend does not exist before an approval — `canResendClaim` is false in
          PENDING_REVIEW and the button is not rendered — so the old "ask for a new email in 2 days"
          line sent the applicant looking for a control that is not there. No approval time is
          promised either; the honest fallback is the phone number. */}
      <p className="text-[13px] leading-6 text-gray-500">
        เก็บลิงก์หน้าตรวจสอบสถานะไว้ กลับมาดูได้ตลอด เมื่ออนุมัติแล้วจึงขอส่งลิงก์ใหม่ได้ ถ้ารอนาน โทร {SIGNUP_SUPPORT_PHONE}
      </p>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  // Reused verbatim on every retry — the server treats it as the idempotency key, so a second tap
  // after a timeout must not create a second request. It is REPLACED only after a definite
  // validation rejection (R07): that answer proves nothing was queued, and the row the rejection
  // left behind holds the old payload's hash, so a corrected form under the same key is a 409.
  const [externalSignupId, setExternalSignupId] = useState(() => crypto.randomUUID());
  const [availability, setAvailability] = useState<'loading' | 'open' | 'closed' | 'unavailable'>('loading');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [values, setValues] = useState<SignupFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAvailability('loading');
    void getSignupAvailability()
      .then((result) => {
        if (active) setAvailability(result.enabled ? 'open' : 'closed');
      })
      // An availability call that cannot answer must not present a form whose submit will fail —
      // but it may not claim we stopped taking applications either (R11). Its own state, its own
      // sentence, and a retry.
      .catch(() => {
        if (active) setAvailability('unavailable');
      });
    return () => {
      active = false;
    };
  }, [availabilityAttempt]);

  const set = <K extends keyof SignupFormValues>(key: K, value: SignupFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  // `Field` derives the input id from `name`, which is exactly the form key. The submit button sits
  // below a long mobile form, so colouring a field the applicant has already scrolled past is the
  // same as saying nothing.
  const focusField = (field: keyof SignupFormValues) => {
    const input = document.getElementById(field);
    input?.scrollIntoView({ block: 'center' });
    if (input instanceof HTMLElement) input.focus();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateSignupForm(values);
    setFieldErrors(errors);
    const firstLocalError = firstSignupErrorField(errors);
    if (firstLocalError) {
      setError(null);
      focusField(firstLocalError);
      return;
    }

    setLoading(true);
    setError(null);
    const body: PublicCompanySignupBody = {
      externalSignupId,
      companyName: trimmed(values.companyName),
      ownerFirstName: trimmed(values.ownerFirstName),
      ownerLastName: trimmed(values.ownerLastName),
      contactEmail: trimmed(values.contactEmail),
      phoneNumber: values.phoneNumber.replace(/[^0-9]/g, ''),
      vatRegistered: values.vatRegistered,
      ...(values.vatRegistered && values.taxId.replace(/[^0-9]/g, '')
        ? { taxId: values.taxId.replace(/[^0-9]/g, '') }
        : {}),
      consentVersion: SIGNUP_CONSENT_VERSION,
      requestedOfferKey: SELECTABLE_OFFER_KEY,
      // D6: attribution is optional, so nothing is sent when the applicant skipped the question.
      ...(values.discoverySource ? { discoverySource: values.discoverySource } : {}),
      ...(values.discoverySource === 'OTHER' && trimmed(values.discoverySourceOther)
        ? { discoverySourceOther: trimmed(values.discoverySourceOther) }
        : {}),
      ...(values.discoverySource === 'SALES' && clampSalesCodeInput(values.referralSalesCode)
        ? { referralSalesCode: clampSalesCodeInput(values.referralSalesCode) }
        : {}),
    };
    try {
      const result = await submitCompanySignup(body);
      setRequestId(result.requestId);
      // R12: the id must reach the URL, or the page telling the applicant to keep this link is a
      // form — a reload, a share or a bookmark all came back to an empty one. `replace`, not
      // `push`: the filled-in form is not somewhere Back should return to.
      router.replace(`/signup/status/${encodeURIComponent(result.requestId)}`);
    } catch (cause) {
      // A rejection that names ONE field belongs under that field — the MX check names the mistyped
      // address, and a banner at the top of a long form does not point at what to correct.
      const rejection = signupFieldRejection(cause);
      if (rejection) {
        setFieldErrors({ [rejection.field]: rejection.message });
        setError(null);
        focusField(rejection.field);
      } else {
        setError(signupSubmitErrorMessage(cause));
      }
      // The correction is a NEW submission: the rejected payload already owns the old key.
      if (rotateSignupKeyAfter(cause)) setExternalSignupId(crypto.randomUUID());
    } finally {
      setLoading(false);
    }
  };

  if (availability === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
        <p className="text-sm text-gray-500">กำลังโหลด…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:max-w-lg sm:py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          {availability === 'closed' ? (
            <SignupClosedNotice />
          ) : availability === 'unavailable' ? (
            <SignupUnavailableNotice onRetry={() => setAvailabilityAttempt((count) => count + 1)} />
          ) : requestId ? (
            <SubmittedView requestId={requestId} />
          ) : (
            <>
              <h1 className="text-[22px] font-bold leading-9 text-gray-900">สมัครใช้งานมั่งมีพลัส</h1>
              {/* Two ways to apply stay, in the order they had (which one should lead is the owner's
                  to decide). The view has one main button, the form's own: the first way is a plain
                  button, so two green buttons no longer compete. */}
              <Link href="/email-access" className={`${secondaryButtonClass} mt-4 w-full`}>สมัครด้วยรหัสยืนยันทางอีเมล</Link>
              <p className="mt-2 text-sm leading-6 text-gray-600">ไม่ต้องตั้งรหัสผ่าน · ใช้ LINE อยู่แล้ว สมัครจากเมนูใน LINE มั่งมีได้</p>
              <div className="mt-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[13px] text-gray-500">หรือ</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <h2 className="mt-5 text-base font-semibold text-gray-900">กรอกข้อมูลร้านเพื่อสมัคร</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">ทีมงานตรวจแล้วส่งอีเมลให้ตั้งรหัสผ่าน</p>

              {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}

              <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
                <TextField
                  label="ชื่อร้าน"
                  name="companyName"
                  value={values.companyName}
                  onChange={(event) => set('companyName', event.target.value)}
                  error={fieldErrors.companyName}
                  autoComplete="organization"
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
                  <TextField
                    label="ชื่อ"
                    name="ownerFirstName"
                    value={values.ownerFirstName}
                    onChange={(event) => set('ownerFirstName', event.target.value)}
                    error={fieldErrors.ownerFirstName}
                    autoComplete="given-name"
                  />
                  <TextField
                    label="นามสกุล"
                    name="ownerLastName"
                    value={values.ownerLastName}
                    onChange={(event) => set('ownerLastName', event.target.value)}
                    error={fieldErrors.ownerLastName}
                    autoComplete="family-name"
                  />
                </div>
                {/* It is the DISPLAY name, not the login name — the login name is chosen on the
                    claim page, and reading this as "your username" made people type one here. */}
                <p className="-mt-3 text-xs leading-6 text-gray-500">
                  ชื่อจริงของ{THAI_SYSTEM_ROLE_NAMES.OWNER} ไม่ใช่ชื่อสำหรับเข้าสู่ระบบ
                </p>
                <TextField
                  label="อีเมล"
                  name="contactEmail"
                  type="email"
                  inputMode="email"
                  hint={fieldErrors.contactEmail ? undefined : 'ใช้รับลิงก์ตั้งรหัสผ่าน'}
                  value={values.contactEmail}
                  onChange={(event) => set('contactEmail', event.target.value)}
                  error={fieldErrors.contactEmail}
                  autoComplete="email"
                />
                <TextField
                  label="เบอร์มือถือ"
                  name="phoneNumber"
                  type="tel"
                  inputMode="numeric"
                  hint={fieldErrors.phoneNumber ? undefined : 'ใช้โทรกลับถ้าอีเมลส่งไม่ถึง'}
                  maxLength={MOBILE_DIGITS}
                  value={values.phoneNumber}
                  onChange={(event) => set('phoneNumber', clampMobileInput(event.target.value))}
                  error={fieldErrors.phoneNumber}
                  autoComplete="tel"
                />
                <div className="space-y-3">
                  <fieldset>
                    <legend className="text-sm font-medium text-gray-700">การจดทะเบียน VAT</legend>
                    <div className="mt-1 sm:flex sm:gap-6">
                      {([
                        { value: false, label: 'ยังไม่จดทะเบียน VAT' },
                        { value: true, label: 'จดทะเบียน VAT แล้ว' },
                      ] as const).map((choice) => (
                        <ChoiceRow
                          key={String(choice.value)}
                          name="vatRegistered"
                          label={choice.label}
                          checked={values.vatRegistered === choice.value}
                          onChange={() => set('vatRegistered', choice.value)}
                        />
                      ))}
                    </div>
                  </fieldset>
                  {values.vatRegistered ? (
                    <TextField
                      label="เลขประจำตัวผู้เสียภาษี"
                      name="taxId"
                      inputMode="numeric"
                      hint={fieldErrors.taxId ? undefined : '13 หลัก กรอกภายหลังได้'}
                      value={values.taxId}
                      onChange={(event) => set('taxId', event.target.value)}
                      error={fieldErrors.taxId}
                    />
                  ) : null}
                </div>

                {/* D6: the attribution question the LIFF form and the API's HTML form already ask.
                    Optional — nobody is stopped at it — but choosing "เซลล์ของมั่งมี" reveals the
                    one field that has to be right, because the code is what credits a real person. */}
                <SelectField
                  label="รู้จักเราทางไหน (ไม่บังคับ)"
                  name="discoverySource"
                  value={values.discoverySource}
                  onChange={(event) => set('discoverySource', event.target.value as SignupDiscoverySource | '')}
                >
                  <option value="">ไม่ระบุ</option>
                  {SIGNUP_DISCOVERY_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </SelectField>
                {values.discoverySource === 'OTHER' ? (
                  <TextField
                    label="ระบุช่องทาง"
                    name="discoverySourceOther"
                    maxLength={SIGNUP_DISCOVERY_OTHER_MAX}
                    value={values.discoverySourceOther}
                    onChange={(event) => set('discoverySourceOther', event.target.value)}
                    error={fieldErrors.discoverySourceOther}
                  />
                ) : null}
                {values.discoverySource === 'SALES' ? (
                  <TextField
                    label="รหัสเซลล์"
                    name="referralSalesCode"
                    hint={fieldErrors.referralSalesCode ? undefined : 'ตัวอักษรอังกฤษตัวใหญ่หรือตัวเลข 3–6 ตัว ตามที่เซลล์แจ้งไว้'}
                    value={values.referralSalesCode}
                    onChange={(event) => set('referralSalesCode', clampSalesCodeInput(event.target.value))}
                    error={fieldErrors.referralSalesCode}
                    autoComplete="off"
                  />
                ) : null}

                <TrialNotice />

                {/* Owner 2026-08-31: the binding acceptance (with display-challenge evidence) happens
                    in-app on first login, so this form only SHOWS the documents — no checkbox to tick.
                    consentVersion still rides the submit as the record of what was displayed here. */}
                <p className="pt-1 text-[13.5px] leading-6 text-gray-600">
                  เมื่อกดส่งคำขอ ถือว่าคุณได้อ่านและรับทราบ{' '}
                  <Link href="/terms" target="_blank" className="font-semibold text-[#046B29] underline">ข้อกำหนดการใช้งาน</Link>
                  {' '}และ{' '}
                  <Link href="/privacy" target="_blank" className="font-semibold text-[#046B29] underline">ประกาศความเป็นส่วนตัว</Link>
                  {' '}แล้ว โดยจะมีขั้นตอนยืนยันการยอมรับอีกครั้งเมื่อเข้าสู่ระบบครั้งแรก
                </p>

                <Button type="submit" className="w-full" loading={loading}>
                  ส่งคำขอสมัคร
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[13.5px] text-gray-500">
          มีบัญชีอยู่แล้ว?{' '}
          <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-[#046B29] underline">เข้าสู่ระบบ</Link>
        </p>
      </main>
    </div>
  );
}
