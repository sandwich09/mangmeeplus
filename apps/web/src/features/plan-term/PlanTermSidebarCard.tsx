'use client';

import { useEffect, useState } from 'react';
import { billingApi } from '@/features/billing/billing.api';
import { fetchPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import { cardRenewalRunning, planTermReminderText, planTermView } from './plan-term.logic';

export function PlanTermSidebarCard({ companyId }: { companyId: string }) {
  const [loaded, setLoaded] = useState<{ companyId: string; notice: PlanTermNotice | null; invoice: boolean } | null>(null);
  const notice = loaded?.companyId === companyId ? loaded.notice : null;
  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then(async notice => {
      // Preserve the warning window and permission gate; a failed billing read keeps the reminder.
      const status = notice && planTermView(notice) === 'warning-banner'
        ? await billingApi(companyId).status().catch(() => null) : null;
      if (active) setLoaded({ companyId, notice: status && cardRenewalRunning(status) ? null : notice,
        invoice: status?.renewalMode === 'PROMPTPAY_RENEW' && !!status.renewalInvoiceUrl });
    });
    return () => { active = false; };
  }, [companyId]);
  if (!notice || planTermView(notice) !== 'warning-banner') return null;
  return <div data-plan-term="warning" className="mt-4 flex items-center justify-between gap-2 border-t border-warning-100 pt-3 text-sm text-warning-700">
    <span className="min-w-0 flex-1 whitespace-nowrap">{loaded?.invoice ? 'มีบิลรอจ่าย' : planTermReminderText(notice.daysLeft)}</span>
    <a className="mangmee-btn mangmee-btn-quiet shrink-0" href={`/companies/${encodeURIComponent(companyId)}/billing${loaded?.invoice ? '#billing-payment' : '?purchase=repeat'}`}>
      {loaded?.invoice ? 'ดูการจ่ายเงิน' : 'ต่ออายุ'}
    </a>
  </div>;
}
