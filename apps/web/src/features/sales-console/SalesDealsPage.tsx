'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SALES_DEAL_STATUSES, type SalesDealStatus, type SalesDealView } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { listSalesDeals } from './sales.api';
import { formatBaht, SALES_DEAL_STATUS_META } from './sales-console.logic';
import { SalesDealStatusBadge, SalesEmpty, SalesNotice } from './SalesConsoleParts';

/** "ทั้งหมด" first: a เซลล์ opens this to find one shop's deal, not to audit a status. */
const FILTERS: readonly { key: SalesDealStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  ...SALES_DEAL_STATUSES.map((status) => ({ key: status, label: SALES_DEAL_STATUS_META[status].label })),
];

function DealRow({ deal }: { deal: SalesDealView }) {
  return (
    <Link href={`/sales/deals/${encodeURIComponent(deal.id)}`} className="flex min-h-12 items-start justify-between gap-3 border-t border-gray-100 px-4 py-3 first:border-t-0 hover:bg-gray-50">
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold text-gray-900">{deal.company.name}</span>
        <span className="mt-0.5 block text-xs text-gray-500">
          {formatBaht(deal.snapshot.priceSatang)} · {deal.snapshot.months} เดือน · {deal.salesDisplayName}
        </span>
        <span className="mt-0.5 block text-xs text-gray-400">อัปเดต {formatThaiDate(deal.updatedAt)}</span>
      </span>
      <SalesDealStatusBadge status={deal.status} />
    </Link>
  );
}

export default function SalesDealsPage() {
  const [filter, setFilter] = useState<SalesDealStatus | 'ALL'>('ALL');
  const [deals, setDeals] = useState<SalesDealView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((status: SalesDealStatus | 'ALL', signal?: AbortSignal) => {
    setError(null);
    return listSalesDeals(status === 'ALL' ? {} : { status }, { signal })
      .then((result) => { if (!signal?.aborted) setDeals(result.items); })
      .catch((cause) => { if (!signal?.aborted) { setDeals([]); setError(apiErrorMessage(cause)); } });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(filter, controller.signal);
    return () => controller.abort();
  }, [filter, load]);

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title="ดีล"
      description="ข้อเสนอพิเศษที่คุณสร้างให้ร้านค้า ตั้งแต่ฉบับร่างจนลูกค้าเปิดใช้งาน"
      actions={<Link href="/sales/deals/new" className="mangmee-btn mangmee-btn-primary">สร้างดีลใหม่</Link>}
    >
      <div className="mangmee-segmented">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" onClick={() => setFilter(item.key)} aria-pressed={filter === item.key}
            className={`mangmee-tab ${filter === item.key ? 'mangmee-tab-active' : ''}`}>
            {item.label}
          </button>
        ))}
      </div>

      {error && <SalesNotice tone="error">{error}</SalesNotice>}

      {deals === null ? <LoadingState label="กำลังโหลดดีล…" />
        : deals.length === 0 ? <SalesEmpty>ยังไม่มีดีลในสถานะนี้</SalesEmpty>
          : <MangmeeCard>{deals.map((deal) => <DealRow key={deal.id} deal={deal} />)}</MangmeeCard>}
    </MangmeePage>
  );
}
