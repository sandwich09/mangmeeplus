'use client';

import { useEffect, useState } from 'react';
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
export default function CompanyTermExpiredPage({ companyId }: { companyId: string }) {
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

  if (error !== null) {
    const title = error === 401 ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : error === 403
      ? 'ไม่มีสิทธิ์ดูสถานะบริษัทนี้' : 'โหลดสถานะไม่สำเร็จ';
    return (
      <div role="alert" className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-3">ยังตรวจสอบสถานะไม่ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแล</p>
        {error === 401 ? <a className="mt-4 inline-block underline" href={`/login?next=${encodeURIComponent(`/companies/${companyId}/renew`)}`}>เข้าสู่ระบบ</a>
          : <button className="mt-4 rounded-lg border px-4 py-3" onClick={() => setRetry(value => value + 1)}>ลองใหม่</button>}
      </div>
    );
  }

  if (!notice || notice.derivedState !== 'EXPIRED') {
    return (
      <div role="status" className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">บริษัทนี้ยังใช้งานได้ตามสิทธิ์</h1>
        <a className="mt-4 inline-block underline" href={`/companies/${companyId}/dashboard`}>กลับไปใช้งาน</a>
      </div>
    );
  }

  const isOwner = notice?.isOwner === true;
  const reason = planLockReason(notice);
  const copy = PLAN_LOCK_COPY[reason];
  // A term that ran out keeps the red of P29; a shop that never had a package is not an error, it
  // is the first step, so its headline is the brand tone the rest of the app uses. Tone lives on
  // the heading, not the card: `.mangmee-card` is unlayered CSS and beats any bg-/border- utility
  // (see the note beside `.mangmee-input` in globals.css), so a tinted card would be silent.
  const titleTone = reason === 'no_package' ? 'text-brand-700' : 'text-error-700';

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:max-w-lg">
      {isOwner ? (
        <div role="alert" className="mangmee-card p-5 sm:p-7">
          <h1 className={`text-[22px] font-extrabold leading-9 ${titleTone}`}>{copy.title}</h1>
          <p className="mt-3 text-[15px] leading-7 text-gray-700">{copy.body}</p>
          {/* A shop that never had a package has an end date equal to its start: a date here would
              read as "your package ended today", which is the sentence this page exists to undo. */}
          {reason === 'trial_ended' && notice?.termEndsAt ? (
            <p className="mt-2 text-[14.5px] leading-7 text-gray-600">
              หมดอายุเมื่อวันที่ {formatThaiDate(notice.termEndsAt)}
            </p>
          ) : null}
          <a className="mangmee-btn mangmee-btn-primary mt-5 w-full" href={`/companies/${companyId}/billing`}>{PLAN_LOCK_CTA}</a>
          <a className="mangmee-btn mangmee-btn-secondary mt-2.5 w-full" href={`/companies/${companyId}/settings/profile`}>กรอกข้อมูลบริษัท</a>
          <a
            href={`tel:${PLAN_TERM_RENEW_PHONE.replace(/-/g, '')}`}
            className="mangmee-btn mangmee-btn-secondary mt-2.5 w-full"
          >
            ติดต่อ {PLAN_TERM_RENEW_PHONE}
          </a>
          <a
            href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}
            className="mangmee-btn mangmee-btn-secondary mt-2.5 w-full"
          >
            อีเมล {PLAN_TERM_CONTACT_EMAIL}
          </a>
        </div>
      ) : (
        <div role="status" className="mangmee-card p-5 sm:p-7">
          <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">บริษัทนี้พักการใช้งานชั่วคราว</h1>
          <p className="mt-3 text-[15px] leading-7 text-gray-600">
            ข้อมูลทั้งหมดยังอยู่ครบ กรุณาติดต่อเจ้าของร้านเพื่อเปิดใช้งานอีกครั้ง
          </p>
          <a className="mangmee-btn mangmee-btn-secondary mt-5 w-full" href={`/companies/${companyId}/settings`}>ตั้งค่า</a>
        </div>
      )}
    </div>
  );
}
