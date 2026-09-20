'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { PlanTermNotice } from './plan-term.api';
import { PLAN_LOCK_COPY, PLAN_LOCK_CTA, isLockedShellPath, planLockReason, planTermView } from './plan-term.logic';

/**
 * The company-wide term state (P29) at the top of the shell. An ended term routes to the renewal
 * page from anywhere the locked shop may not go; on the pages it may (spec §12) it states why the
 * shop is locked and offers the one move that fixes it. The WARNING copy lives in the sidebar
 * (`PlanTermSidebarCard`) per the Owner's 2026-08-31 decision, so nothing renders for it here.
 *
 * The notice is a prop: the shell reads it once for the whole layout, and this component and the
 * locked sidebar must never disagree about the same company.
 */
export function PlanTermBanner({ companyId, notice }: { companyId: string; notice: PlanTermNotice | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  const view = planTermView(notice, isLockedShellPath(pathname, companyId));

  useEffect(() => {
    if (view === 'renewal-page') router.replace(`/companies/${companyId}/renew`);
  }, [view, companyId, router]);

  if (notice?.derivedState !== 'EXPIRED') return null;

  const copy = PLAN_LOCK_COPY[planLockReason(notice)];

  return (
    <div role="status" className="border-b border-warning-100 bg-warning-50 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] font-bold leading-6 text-warning-700">{copy.banner}</p>
        {notice.isOwner && (
          <Link className="mangmee-btn mangmee-btn-primary w-full sm:w-auto" href={`/companies/${companyId}/billing`}>
            {PLAN_LOCK_CTA}
          </Link>
        )}
      </div>
    </div>
  );
}
