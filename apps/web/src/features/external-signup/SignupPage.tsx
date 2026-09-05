'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicCompanySignupBody } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { SwitchField, TextField } from '@/common/components/field';
import { trimmed } from '@/common/forms/trim';
import { getSignupAvailability, submitCompanySignup } from './external-signup.api';
import { SignupBrandHeader, SignupClosedNotice, SignupUnavailableNotice } from './SignupChrome';
import {
  clampMobileInput,
  firstSignupErrorField,
  MOBILE_DIGITS,
  offerLimitsLabel,
  offerWarmupNote,
  rotateSignupKeyAfter,
  SELECTABLE_OFFER_KEY,
  SIGNUP_CONSENT_VERSION,
  SIGNUP_OFFERS,
  SIGNUP_SUPPORT_PHONE,
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
  businessType: '',
  vatRegistered: false,
  taxId: '',
};

function OfferCards() {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2 text-[15px] font-semibold text-gray-800">แพ็กเกจ</legend>
      {SIGNUP_OFFERS.map((offer) => {
        const selected = offer.selectable;
        const reasonId = `offer-${offer.tierKey}-reason`;
        return (
          <label
            key={offer.tierKey}
            data-offer={offer.tierKey}
            className={`flex items-start gap-3 rounded-xl border p-3.5 ${
              selected ? 'cursor-default border-[#046B29] bg-[#F2F9F4]' : 'border-gray-200 bg-gray-50 opacity-70'
            }`}
          >
            {/* A real radio group, so the one choice and the three refusals are in the accessible
                tree — the greyed-out styling alone says nothing to a screen reader. */}
            <input
              type="radio"
              name="requestedOffer"
              value={offer.offerKey}
              checked={selected}
              disabled={!selected}
              readOnly
              aria-describedby={offer.unavailableReason ? reasonId : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#046B29]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15.5px] font-bold text-gray-900">{offer.nameTh}</span>
                <span className="text-[15px] font-semibold text-gray-700">{offer.priceLabel}</span>
                {offer.badge ? (
                  <span className="rounded-md bg-[#046B29] px-2 py-0.5 text-[12px] font-bold text-white">{offer.badge}</span>
                ) : null}
                {/* The "coming soon" chip belongs to the cards you cannot pick. Keyed on
                    `selectable`, not on the absence of a badge: the trial card carries neither. */}
                {offer.selectable ? null : (
                  <span className="rounded-md bg-gray-200 px-2 py-0.5 text-[12px] font-semibold text-gray-600">เร็ว ๆ นี้</span>
                )}
              </span>
              <span className="mt-1 block text-[13px] leading-6 text-gray-500">{offerLimitsLabel(offer)}</span>
              {/* F17: the first-week ceiling, said before signing up rather than discovered on day one. */}
              {offerWarmupNote(offer) ? (
                <span className="mt-0.5 block text-[13px] leading-6 text-gray-500">{offerWarmupNote(offer)}</span>
              ) : null}
              {offer.unavailableReason ? <span id={reasonId} className="sr-only">{offer.unavailableReason}</span> : null}
            </span>
          </label>
        );
      })}
      <p className="pt-1 text-[13px] leading-6 text-gray-500">
        {/* F1: this named a paid package for a shop that opens on the free trial. */}
        ตอนนี้เปิดให้ทดลองใช้ฟรีก่อน แพ็กเกจแบบเสียค่าบริการจะเปิดเร็ว ๆ นี้
      </p>
    </fieldset>
  );
}

function SubmittedView({ requestId }: { requestId: string }) {
  return (
    <div className="space-y-5" role="status">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E7F4EC] text-[#046B29]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" /></svg>
      </span>
      <div className="space-y-2">
        <h1 className="text-[22px] font-extrabold text-gray-900">ได้รับคำขอแล้ว กำลังตรวจสอบ</h1>
        <p className="text-[15px] leading-7 text-gray-600">
          เราจะส่งอีเมลให้คุณเมื่ออนุมัติ ในอีเมลจะมีลิงก์สำหรับตั้งรหัสผ่าน แล้วจึงเริ่มใช้งานได้
        </p>
      </div>
      <Link
        href={`/signup/status/${encodeURIComponent(requestId)}`}
        className="flex h-12 w-full items-center justify-center rounded-xl border-[1.5px] border-gray-200 bg-white text-[15.5px] font-semibold text-gray-900 hover:border-[#046B29]"
      >
        ตรวจสอบสถานะคำขอ
      </Link>
      {/* R12: resend does not exist before an approval — `canResendClaim` is false in
          PENDING_REVIEW and the button is not rendered — so the old "ask for a new email in 2 days"
          line sent the applicant looking for a control that is not there. No approval time is
          promised either; the honest fallback is the phone number. */}
      <p className="text-[13px] leading-6 text-gray-500">
        เก็บลิงก์หน้าตรวจสอบสถานะไว้ กลับมาดูได้ตลอด เมื่ออนุมัติแล้วจึงขอส่งลิงก์ใหม่ได้ หากรอนาน โทร {SIGNUP_SUPPORT_PHONE}
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
      ...(trimmed(values.businessType) ? { businessType: trimmed(values.businessType) } : {}),
      vatRegistered: values.vatRegistered,
      ...(values.vatRegistered && values.taxId.replace(/[^0-9]/g, '')
        ? { taxId: values.taxId.replace(/[^0-9]/g, '') }
        : {}),
      consentVersion: SIGNUP_CONSENT_VERSION,
      requestedOfferKey: SELECTABLE_OFFER_KEY,
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
              <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">สมัครใช้งานมั่งมีพลัส</h1>
              <p className="mt-1.5 text-[15px] leading-7 text-gray-600">
                กรอกข้อมูลร้านของคุณ ทีมงานจะตรวจสอบ แล้วส่งอีเมลให้ตั้งรหัสผ่าน
              </p>

              {error ? (
                <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] leading-7 text-red-700">
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                <TextField
                  label="ชื่อร้าน หรือบริษัท"
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
                <p className="-mt-3 text-[13px] leading-6 text-gray-500">ชื่อนี้จะแสดงเป็นชื่อผู้ใช้งานหลักของร้านหลังเข้าสู่ระบบ</p>
                <TextField
                  label="อีเมล"
                  name="contactEmail"
                  type="email"
                  inputMode="email"
                  hint="ใช้รับลิงก์ตั้งรหัสผ่าน กรุณาตรวจตัวสะกดให้ถูกต้อง"
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
                  hint="ใช้ติดต่อกลับกรณีอีเมลส่งไม่ถึง"
                  maxLength={MOBILE_DIGITS}
                  value={values.phoneNumber}
                  onChange={(event) => set('phoneNumber', clampMobileInput(event.target.value))}
                  error={fieldErrors.phoneNumber}
                  autoComplete="tel"
                />
                <TextField
                  label="ประเภทธุรกิจ"
                  name="businessType"
                  hint="เช่น ร้านขายของชำ ร้านอาหาร ร้านวัสดุก่อสร้าง"
                  value={values.businessType}
                  onChange={(event) => set('businessType', event.target.value)}
                />

                <div className="space-y-3 rounded-xl border border-gray-200 p-3.5">
                  <fieldset>
                    <legend className="text-sm font-semibold text-gray-800">การจดทะเบียน VAT</legend>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6">
                      {([
                        { value: false, label: 'ยังไม่จดทะเบียน VAT' },
                        { value: true, label: 'จดทะเบียน VAT แล้ว' },
                      ] as const).map((choice) => (
                        <label key={String(choice.value)} className="flex items-center gap-2 text-[15px] text-gray-800">
                          <input
                            type="radio"
                            name="vatRegistered"
                            className="h-4 w-4 accent-brand-600"
                            checked={values.vatRegistered === choice.value}
                            onChange={() => set('vatRegistered', choice.value)}
                          />
                          {choice.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {values.vatRegistered ? (
                    <TextField
                      label="เลขประจำตัวผู้เสียภาษี"
                      name="taxId"
                      inputMode="numeric"
                      hint="13 หลัก ไม่ต้องกรอกก็ได้ กรอกภายหลังได้"
                      value={values.taxId}
                      onChange={(event) => set('taxId', event.target.value)}
                      error={fieldErrors.taxId}
                    />
                  ) : null}
                </div>

                <OfferCards />

                {/* Owner 2026-08-31: the binding acceptance (with display-challenge evidence) happens
                    in-app on first login, so this form only SHOWS the documents — no checkbox to tick.
                    consentVersion still rides the submit as the record of what was displayed here. */}
                <p className="pt-1 text-[13.5px] leading-6 text-gray-600">
                  เมื่อกดส่งคำขอ ถือว่าท่านได้อ่านและรับทราบ{' '}
                  <Link href="/terms" target="_blank" className="font-semibold text-[#046B29] underline">ข้อกำหนดการใช้งาน</Link>
                  {' '}และ{' '}
                  <Link href="/privacy" target="_blank" className="font-semibold text-[#046B29] underline">ประกาศความเป็นส่วนตัว</Link>
                  {' '}แล้ว โดยจะมีขั้นตอนยืนยันการยอมรับอีกครั้งเมื่อเข้าสู่ระบบครั้งแรก
                </p>

                <Button type="submit" size="lg" className="w-full !rounded-xl" loading={loading}>
                  ส่งคำขอสมัคร
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[13.5px] text-gray-500">
          มีบัญชีอยู่แล้ว?{' '}
          <Link href="/login" className="font-semibold text-[#046B29] underline">เข้าสู่ระบบ</Link>
        </p>
      </main>
    </div>
  );
}
