'use client';

import { useEffect, useState } from 'react';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { PlanTermNoticeError, readPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import { PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE } from './plan-term.logic';

/**
 * The one page an expired company can open (P29 §4B). The owner is told exactly what happened and
 * how to fix it; staff get the neutral line — package dates and renewal are not their business.
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

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:max-w-lg">
      {isOwner ? (
        <div role="alert" className="rounded-2xl border border-[#FECDCA] bg-error-50 p-5 sm:p-7">
          <h1 className="text-[22px] font-extrabold leading-9 text-error-700">ครบกำหนดใช้งานแล้ว</h1>
          <p className="mt-3 text-[15px] leading-7 text-gray-700">
            ข้อมูลทั้งหมดยังอยู่ครบ ไม่มีอะไรหาย เมื่อต่ออายุแล้วใช้งานต่อได้ทันที
          </p>
          {notice?.termEndsAt ? (
            <p className="mt-2 text-[14.5px] leading-7 text-gray-600">
              ครบกำหนดเมื่อวันที่ {formatThaiDate(notice.termEndsAt)}
            </p>
          ) : null}
          <a
            href={`tel:${PLAN_TERM_RENEW_PHONE.replace(/-/g, '')}`}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#046B29] text-[16px] font-bold text-white"
          >
            ติดต่อ {PLAN_TERM_RENEW_PHONE}
          </a>
          <a
            href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}
            className="mt-2.5 flex h-12 w-full items-center justify-center rounded-xl border-[1.5px] border-gray-300 text-[14.5px] font-bold text-gray-700"
          >
            อีเมล {PLAN_TERM_CONTACT_EMAIL}
          </a>
        </div>
      ) : (
        <div role="status" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-7">
          <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">บริษัทนี้พักการใช้งานชั่วคราว</h1>
          <p className="mt-3 text-[15px] leading-7 text-gray-600">
            ข้อมูลทั้งหมดยังอยู่ครบ กรุณาติดต่อเจ้าของร้านเพื่อเปิดใช้งานอีกครั้ง
          </p>
        </div>
      )}
    </div>
  );
}
