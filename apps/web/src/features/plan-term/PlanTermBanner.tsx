'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import { isRenewalPath, planTermView } from './plan-term.logic';

/**
 * Invisible guard for the company-wide term state (P29). An ended term routes to the renewal page
 * — the only page an expired company can use. The visible warning moved into the sidebar
 * (`PlanTermSidebarCard`) per the Owner's 2026-08-31 decision, so this renders nothing.
 */
export function PlanTermBanner({ companyId }: { companyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loaded, setLoaded] = useState<{ companyId: string; notice: PlanTermNotice | null } | null>(null);
  const notice = loaded?.companyId === companyId ? loaded.notice : null;

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then((result) => {
      if (active) setLoaded({ companyId, notice: result });
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  const view = planTermView(notice, isRenewalPath(pathname ?? ''));

  useEffect(() => {
    if (view === 'renewal-page') router.replace(`/companies/${companyId}/renew`);
  }, [view, companyId, router]);

  return null;
}
