'use client';

import { useEffect, useState } from 'react';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import { PLAN_TERM_RENEW_PHONE } from './plan-term.logic';

/**
 * The one page an expired company can open (P29 §4B). The owner is told exactly what happened and
 * how to fix it; staff get the neutral line — package dates and renewal are not their business.
 */
export default function CompanyTermExpiredPage() {
  const [notice, setNotice] = useState<PlanTermNotice | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice().then((result) => {
      if (!active) return;
      setNotice(result);
      setSettled(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!settled) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center p-4">
        <p className="text-sm text-gray-500">กำลังโหลด…</p>
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
            ติดต่อต่ออายุ โทร {PLAN_TERM_RENEW_PHONE}
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
