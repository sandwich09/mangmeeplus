'use client';
import { useEffect, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES, planTermStateLabel, type PlanTermState } from '@watchdog-bms/contracts';
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
  // The rows say what each button opens; a description above them said it a second time.
  return <BillingCustomerFrame title="เลือกร้าน" description=""
    backHref={origin ? `/companies/${encodeURIComponent(origin.companyId)}/billing` : '/'} backLabel={origin ? `กลับไปแพ็กเกจของ ${origin.companyName}` : 'กลับไปหน้าแรก'}>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p>{error}</p><button className="mangmee-btn mangmee-btn-secondary mt-3" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button></div>}
    {!companies && !error && <p role="status">กำลังโหลดรายชื่อร้าน…</p>}
    {companies?.length === 0 && <p>คุณยังจัดการแพ็กเกจของร้านไหนไม่ได้ ให้{THAI_SYSTEM_ROLE_NAMES.OWNER}เป็นผู้ซื้อ หรือติดต่อทีมงานมั่งมี <span className="mangmee-unit">098-256-5628</span></p>}
    {companies && companies.length > 0 && <MangmeeCard className="divide-y divide-gray-100">
      {companies.map(company => <div key={company.companyId} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0"><h2 className="break-words text-lg font-bold text-gray-900">{company.companyName}</h2>{/* A state is shown only when it is not the normal one; the same sub line on every row said nothing. */}{company.expired && <p className="mt-2 text-sm text-gray-500"><MangmeeBadge tone="amber">{planTermStateLabel(company.planState === 'NO_PACKAGE' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge></p>}</div>
        <a className="mangmee-btn mangmee-btn-secondary" aria-label={`ดูแพ็กเกจของ ${company.companyName}`} href={`/companies/${encodeURIComponent(company.companyId)}/billing${query ? `?${query}` : ''}`}>ดูแพ็กเกจ</a>
      </div>)}
    </MangmeeCard>}
    <footer className="border-t border-gray-200 pt-5 text-sm text-gray-500"><a className="inline-flex min-h-11 items-center text-brand-700 underline" href="mailto:contact@mangmeeplus.com">ติดต่อทีมงานมั่งมี</a></footer>
  </BillingCustomerFrame>;
}
