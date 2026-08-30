'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import { isRenewalPath, planTermView, PLAN_TERM_RENEW_PHONE } from './plan-term.logic';

/**
 * The company-wide term notice (P29). Yellow strip for the owner while the term is running out;
 * an ended term routes to the renewal page, which is the only page an expired company can use.
 */
export function PlanTermBanner({ companyId }: { companyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<PlanTermNotice | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then((result) => {
      if (active) setNotice(result);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  const view = planTermView(notice, isRenewalPath(pathname ?? ''));

  useEffect(() => {
    if (view === 'renewal-page') router.replace(`/companies/${companyId}/renew`);
  }, [view, companyId, router]);

  if (view !== 'warning-banner' || !notice) return null;

  return (
    <div
      role="status"
      data-plan-term="warning"
      className="border-b border-warning-100 bg-warning-50 px-4 py-2.5 text-[14px] font-medium leading-6 text-warning-700"
    >
      <span className="mx-auto block max-w-5xl">
        ร้านจะครบกำหนดใช้งานวันที่ {formatThaiDate(notice.termEndsAt)} — ติดต่อต่ออายุ โทร{' '}
        <a href={`tel:${PLAN_TERM_RENEW_PHONE.replace(/-/g, '')}`} className="font-bold underline">
          {PLAN_TERM_RENEW_PHONE}
        </a>
      </span>
    </div>
  );
}
