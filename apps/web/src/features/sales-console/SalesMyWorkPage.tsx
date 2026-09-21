'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SalesMyWorkItem } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getSalesMyWork } from './sales.api';
import { formatBaht, myWorkBadgeLabel, myWorkMeta, sortMyWork } from './sales-console.logic';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

function WorkRow({ item }: { item: SalesMyWorkItem }) {
  const meta = myWorkMeta(item.kind);
  return (
    <Link href={`/sales/deals/${encodeURIComponent(item.deal.id)}`} className="block border-t border-gray-100 px-4 py-3 first:border-t-0 hover:bg-gray-50">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[15px] font-bold text-gray-900">{item.deal.company.name}</span>
        <MangmeeBadge tone={meta.tone}>{meta.label}</MangmeeBadge>
      </span>
      <span className="mt-0.5 block text-xs text-gray-500">
        {formatBaht(item.deal.snapshot.priceSatang)} · {item.deal.snapshot.months} เดือน · {item.deal.salesDisplayName}
      </span>
      <span className="mt-1 block text-sm leading-6 text-gray-600">
        {item.kind === 'DEAL_REJECTED' && item.deal.rejectedReason ? item.deal.rejectedReason : meta.note}
      </span>
      <span className="mt-0.5 block text-xs text-gray-400">{formatThaiDateTime(item.at)}</span>
    </Link>
  );
}

export default function SalesMyWorkPage() {
  const [items, setItems] = useState<SalesMyWorkItem[] | null>(null);
  const [badge, setBadge] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSalesMyWork({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(sortMyWork(result.items));
        setBadge(result.badge);
      })
      .catch((cause) => { if (!controller.signal.aborted) { setItems([]); setError(apiErrorMessage(cause)); } });
    return () => controller.abort();
  }, []);

  const badgeLabel = myWorkBadgeLabel(badge);

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title="งานของฉัน"
      description="ดีลที่รอให้คุณทำอะไรสักอย่าง และดีลที่รอลูกค้าอยู่"
      meta={badgeLabel ? <MangmeeBadge tone="danger">{badgeLabel} รายการรอดำเนินการ</MangmeeBadge> : undefined}
    >
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {items === null ? <LoadingState label="กำลังโหลดงานของคุณ…" />
        : items.length === 0 ? <SalesEmpty>ตอนนี้ไม่มีงานค้าง</SalesEmpty>
          : <MangmeeCard>{items.map((item) => <WorkRow key={`${item.kind}-${item.deal.id}`} item={item} />)}</MangmeeCard>}
    </MangmeePage>
  );
}
