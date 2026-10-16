'use client';

import { useEffect, useState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { PlanTermNoticeError, readPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import {
  PLAN_LOCK_COPY,
  PLAN_LOCK_CTA,
  PLAN_TERM_CONTACT_EMAIL,
  PLAN_TERM_RENEW_PHONE,
  planLockReason,
} from './plan-term.logic';

/**
 * Where a locked shop lands from anywhere it may not go (P29 §4B, spec §12). The owner is told
 * which of the two things happened — a term that ended, or a shop that never had a package at all
 * (Owner 2026-09-20 closed the free trial) — and the move is the same either way: choose one.
 * Staff get the neutral line; package prices and payment are not their business.
 */
export default function CompanyTermExpiredPage({ companyId, canOpenProfile = false }: {
  companyId: string;
  /** `/settings/profile` needs `company.setup.read` (route-permissions.ts); without it the link opens a refusal. */
  canOpenProfile?: boolean;
}) {
  const [notice, setNotice] = useState<PlanTermNotice | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setSettled(false);
    setNotice(null);
    setError(null);
    void readPlanTermNotice(companyId).then((result) => {
      if (!active) return;
      setNotice(result);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof PlanTermNoticeError ? cause.status : 0);
    }).finally(() => {
      if (!active) return;
      setSettled(true);
    });
    return () => {
      active = false;
    };
  }, [companyId, retry]);

  if (!settled) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center p-4">
        <p className="text-sm text-gray-500">กำลังโหลด…</p>
      </div>
    );
  }

  // One card at one width for every state of this page; the title is the size the locked states use.
  const frame = 'w-full px-4 py-8 sm:px-6';
  const heading = 'text-[22px] font-bold leading-9';
  const phone = <a href={`tel:${PLAN_TERM_RENEW_PHONE.replace(/-/g, '')}`} className="mangmee-unit font-semibold text-brand-700 underline">{PLAN_TERM_RENEW_PHONE}</a>;

  if (error !== null) {
    // Three different things, each with its own way out: signed out, not allowed, our own failure.
    const title = error === 401 ? 'ต้องเข้าสู่ระบบอีกครั้ง' : error === 403
      ? 'ไม่มีสิทธิ์ดูสถานะร้านนี้' : 'โหลดสถานะไม่สำเร็จ';
    return (
      <div role="alert" className={frame}>
        <div className="mangmee-card p-5 sm:p-7">
          <h1 className={`${heading} text-gray-900`}>{title}</h1>
          {error === 401 ? null : (
            <p className="mt-3 text-[15px] leading-7 text-gray-700">
              {error === 403 ? <>ให้ผู้ดูแลร้านตรวจสิทธิ์ของคุณ หรือติดต่อทีมงานมั่งมี {phone}</> : <>ระบบขัดข้องชั่วคราว ถ้าลองแล้วยังไม่ได้ ติดต่อทีมงานมั่งมี {phone}</>}
            </p>
          )}
          {error === 401 ? <a className={`${primaryButtonClass} mt-5 w-full`} href={`/login?next=${encodeURIComponent(`/companies/${companyId}/renew`)}`}>เข้าสู่ระบบ</a>
            : <button type="button" className={`${error === 403 ? secondaryButtonClass : primaryButtonClass} mt-5 w-full`} onClick={() => setRetry(value => value + 1)}>ลองอีกครั้ง</button>}
        </div>
      </div>
    );
  }

  if (!notice || notice.derivedState !== 'EXPIRED') {
    return (
      <div role="status" className={frame}>
        <div className="mangmee-card p-5 sm:p-7">
          <h1 className={`${heading} text-gray-900`}>ร้านนี้ใช้งานได้ตามปกติ</h1>
          <a className={`${primaryButtonClass} mt-5 w-full`} href={`/companies/${companyId}/dashboard`}>กลับไปหน้าแรก</a>
        </div>
      </div>
    );
  }

  const canManagePlan = notice?.canManagePlan ?? notice?.isOwner ?? false;
  const reason = planLockReason(notice);
  const copy = PLAN_LOCK_COPY[reason];
  // A term that ran out keeps the red of P29; a shop that never had a package is not an error, it
  // is the first step, so its headline is the brand tone the rest of the app uses. Tone lives on
  // the heading, not the card: `.mangmee-card` is unlayered CSS and beats any bg-/border- utility
  // (see the note beside `.mangmee-input` in globals.css), so a tinted card would be silent.
  const titleTone = reason === 'no_package' ? 'text-brand-700' : 'text-error-700';

  return (
    <div className={frame}>
      {canManagePlan ? (
        <div role="alert" className="mangmee-card p-5 sm:p-7">
          <h1 className={`${heading} ${titleTone}`}>{copy.title}</h1>
          <p className="mt-3 text-balance text-[15px] leading-7 text-gray-700">{copy.body}</p>
          {/* A shop that never had a package has an end date equal to its start: a date here would
              read as "your package ended today", which is the sentence this page exists to undo. */}
          {reason === 'trial_ended' && notice?.termEndsAt ? (
            <p className="mt-2 text-[14.5px] leading-7 text-gray-600">
              หมดอายุเมื่อวันที่ {formatThaiDate(notice.termEndsAt)}
            </p>
          ) : null}
          {/* One button: the one move that fixes it. Help is one quiet line, not two more full-width buttons. */}
          <a className={`${primaryButtonClass} mt-5 w-full`} href={`/companies/${companyId}/billing`}>{PLAN_LOCK_CTA}</a>
          <p className="mt-4 text-sm leading-6 text-gray-600">
            ติดปัญหา โทร {phone} หรืออีเมล{' '}
            <a href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`} className="whitespace-nowrap font-semibold text-brand-700 underline">{PLAN_TERM_CONTACT_EMAIL}</a>
          </p>
          {/* F28: Stripe Checkout collects the address, so the shop profile is optional, and last. */}
          {canOpenProfile && <a className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm text-brand-700 underline" href={`/companies/${companyId}/settings/profile#shop`}>เติมข้อมูลร้านไว้ล่วงหน้า (ไม่บังคับ)</a>}
        </div>
      ) : (
        <div role="status" className="mangmee-card p-5 sm:p-7">
          <h1 className={`${heading} text-gray-900`}>{copy.title}</h1>
          {/* The title has said what is the matter; this line says who can act (the banner above keeps to the matter on this page). */}
          <p className="mt-3 text-[15px] leading-7 text-gray-600">
            {copy.staffNext} ข้อมูลทั้งหมดยังอยู่ครบ
          </p>
          <a className={`${secondaryButtonClass} mt-5 w-full`} href={`/companies/${companyId}/settings`}>ไปหน้าตั้งค่า</a>
        </div>
      )}
    </div>
  );
}
