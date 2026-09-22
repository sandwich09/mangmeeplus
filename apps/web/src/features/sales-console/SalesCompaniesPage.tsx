'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SALES_COMPANY_SEARCH_MIN_CHARS, SALES_COMPANY_SEARCH_LIMIT, type SalesCompanySearchItem } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { TextField } from '@/common/components/field';
import { LoadingState } from '@/common/components/state';
import { searchSalesCompanies } from './sales.api';
import { SALES_DEAL_STATUS_META } from './sales-console.logic';
import { SalesCompanyLine, SalesEmpty, SalesNotice } from './SalesConsoleParts';

export default function SalesCompaniesPage() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SalesCompanySearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < SALES_COMPANY_SEARCH_MIN_CHARS) { setItems(null); setError(null); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    // Every call is audited LOW with the query text (S33), so keystrokes are debounced into one row.
    const timer = setTimeout(() => {
      setError(null);
      searchSalesCompanies(term, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) { setItems(result.items); setSearching(false); } })
        .catch((cause) => { if (!controller.signal.aborted) { setItems([]); setSearching(false); setError(apiErrorMessage(cause)); } });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title="ร้านค้า"
      description={`ค้นหาร้านในระบบเพื่อตั้งข้อเสนอ แสดงสูงสุด ${SALES_COMPANY_SEARCH_LIMIT} รายการ · ระบบบันทึกทุกการค้นหา`}
    >
      <TextField
        label="ชื่อร้าน"
        name="companyQuery"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        hint={`พิมพ์อย่างน้อย ${SALES_COMPANY_SEARCH_MIN_CHARS} ตัวอักษร`}
        autoComplete="off"
      />

      {error && <SalesNotice tone="error">{error}</SalesNotice>}

      {searching && items === null ? <LoadingState label="กำลังค้นหา…" />
        : items === null ? <SalesEmpty>พิมพ์ชื่อร้านเพื่อเริ่มค้นหา</SalesEmpty>
          : items.length === 0 && !error ? <SalesEmpty>ไม่พบร้านที่ตรงกับคำค้นนี้</SalesEmpty>
            : (
              <MangmeeCard>
                {items.map((company) => (
                  <div key={company.companyId} className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 first:border-t-0">
                    <SalesCompanyLine company={company} />
                    {company.openDealId
                      ? <Link href={`/sales/deals/${encodeURIComponent(company.openDealId)}`} className="mangmee-btn mangmee-btn-secondary">
                        ดีลที่ค้างอยู่{company.openDealStatus ? ` · ${SALES_DEAL_STATUS_META[company.openDealStatus].label}` : ''}
                      </Link>
                      : <Link href={`/sales/deals/new?companyId=${encodeURIComponent(company.companyId)}`} className="mangmee-btn mangmee-btn-primary">สร้างดีล</Link>}
                  </div>
                ))}
              </MangmeeCard>
            )}
    </MangmeePage>
  );
}
