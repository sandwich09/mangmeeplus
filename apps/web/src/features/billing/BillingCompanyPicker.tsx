'use client';
import { useEffect, useState } from 'react';
import { planTermStateLabel, type PlanTermState } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard } from '@/common/components/mangmee';
import BillingCustomerFrame from './BillingCustomerFrame';

type CompanyChoice = { companyId: string; companyName: string; canManagePlan: boolean; expired: boolean; planState?: PlanTermState };
export default function BillingCompanyPicker({ query, fromCompany }: { query: string; fromCompany?: string }) {
  const [companies, setCompanies] = useState<CompanyChoice[] | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void authedApiFetch<{ data: CompanyChoice[] }>('/auth/me/companies', { cache: 'no-store', suppressErrorToast: true })
      .then(result => { if (active) setCompanies(result.data.filter(company => company.canManagePlan)); })
      .catch(e => { if (active) { setCompanies(null); setError(apiErrorMessage(e)); } });
    return () => { active = false; };
  }, [reload]);
  const origin = companies?.find(company => company.companyId === fromCompany);
  return <BillingCustomerFrame title="เลือกบริษัทที่จะจัดการแพ็กเกจ" description="ดูแพ็กเกจและประวัติการชำระเงินของบริษัทที่คุณมีสิทธิ์บริหาร"
    backHref={origin ? `/companies/${encodeURIComponent(origin.companyId)}/billing` : '/'} backLabel={origin ? `กลับแพ็กเกจของ ${origin.companyName}` : 'กลับหน้าหลัก'}>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p>{error}</p><button className="mangmee-btn mangmee-btn-secondary mt-3" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></div>}
    {!companies && !error && <p role="status">กำลังตรวจสอบบริษัทที่คุณจัดการแพ็กเกจได้…</p>}
    {companies?.length === 0 && <p>ยังไม่มีบริษัทที่คุณมีสิทธิ์จัดการแพ็กเกจ กรุณาให้ผู้มีสิทธิ์จัดการแพ็กเกจของบริษัทดำเนินการ หรือติดต่อทีมมั่งมี</p>}
    {companies && companies.length > 0 && <MangmeeCard className="divide-y divide-gray-100">
      {companies.map(company => <div key={company.companyId} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0"><h2 className="break-words text-lg font-bold text-gray-900">{company.companyName}</h2><p className="mt-2 text-sm text-gray-500">{company.expired ? <MangmeeBadge tone="amber">{planTermStateLabel(company.planState === 'NO_PACKAGE' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge> : 'แพ็กเกจและเอกสารการชำระเงิน'}</p></div>
        <a className="mangmee-btn mangmee-btn-secondary" aria-label={`ดูแพ็กเกจของ ${company.companyName}`} href={`/companies/${encodeURIComponent(company.companyId)}/billing${query ? `?${query}` : ''}`}>ดูแพ็กเกจ<span aria-hidden="true">→</span></a>
      </div>)}
    </MangmeeCard>}
    <footer className="border-t border-gray-200 pt-5 text-sm text-gray-500"><a className="inline-flex min-h-11 items-center text-brand-700 underline" href="mailto:contact@mangmeeplus.com">ติดต่อทีมมั่งมี</a></footer>
  </BillingCustomerFrame>;
}
