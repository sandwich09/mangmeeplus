'use client';
import { useEffect, useState } from 'react';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';

type CompanyChoice = { companyId: string; companyName: string; roles: string[]; expired: boolean };
export default function BillingCompanyPicker({ query }: { query: string }) {
  const [companies, setCompanies] = useState<CompanyChoice[] | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void authedApiFetch<{ data: CompanyChoice[] }>('/auth/me/companies', { cache: 'no-store', suppressErrorToast: true })
      .then(result => { if (active) setCompanies(result.data.filter(company => company.roles.includes('OWNER'))); })
      .catch(e => { if (active) { setCompanies(null); setError(apiErrorMessage(e)); } });
    return () => { active = false; };
  }, [reload]);
  return <main className="mx-auto max-w-2xl space-y-5 p-6 sm:p-10">
    <h1 className="text-2xl font-bold">เลือกบริษัทที่จะจัดการแพ็กเกจ</h1><p>ตรวจสอบชื่อบริษัทก่อนดูราคาและชำระเงิน</p>
    {error && <div role="alert"><p>{error}</p><button className="mt-3 rounded-xl border px-4 py-3" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></div>}
    {!companies && !error && <p role="status">กำลังตรวจสอบบริษัทที่คุณเป็นเจ้าของ…</p>}
    {companies?.length === 0 && <p>ยังไม่มีบริษัทที่คุณเป็นเจ้าของ กรุณาให้เจ้าของบริษัทดำเนินการ หรือติดต่อทีมมั่งมี</p>}
    {companies?.map(company => <a key={company.companyId} className="block rounded-xl border bg-white p-5" href={`/companies/${encodeURIComponent(company.companyId)}/billing${query ? `?${query}` : ''}`}>
      <span className="font-semibold">{company.companyName}</span><span className="mt-1 block text-sm text-gray-600">{company.expired ? 'ครบกำหนดใช้งาน · เข้าดูสถานะและชำระเงิน' : 'ดูแพ็กเกจและประวัติการชำระเงิน'}</span>
    </a>)}
    <footer className="border-t pt-5"><a className="underline" href="mailto:contact@mangmeeplus.com">ติดต่อทีมมั่งมี</a></footer>
  </main>;
}
