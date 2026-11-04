'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AccountantEvidenceBundlePlan } from '@watchdog-bms/contracts';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { downloadBlob, fetchAccountantEvidenceBundle, planAccountantEvidenceBundle } from './expenses.api';

export function EvidenceBundleActions({ plan, busy, allMonths, onDownload, showCounts, accountant = false }: {
  accountant?: boolean; plan: AccountantEvidenceBundlePlan; showCounts?: boolean; busy: boolean; allMonths: boolean; onDownload: (part: number) => void;
}) {
  const period = allMonths ? 'ช่วงนี้' : 'เดือนนี้';
  const split = plan.partCount > 1 ? `แบ่งเป็น ${plan.partCount} ชุด` : '';
  // The accountant bundle says it in one line: the file count, then only the kinds of paper it holds.
  const papers = showCounts && plan.counts ? ([['ใบเสร็จ', plan.counts.receipts], ['ใบรับรองแทนใบเสร็จ', plan.counts.substituteReceipts], ['สลิป', plan.counts.paymentSlips],
    ['ใบสำคัญจ่าย', plan.counts.vouchers], ['50 ทวิ', plan.counts.whtCertificates]] as const).filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`) : null;
  return <div className="space-y-2">
    <p className="text-sm text-gray-700" role="status">{plan.fileCount === 0
      ? `${period}ยังไม่มีไฟล์หลักฐาน`
      : papers ? [`${plan.fileCount} ไฟล์`, ...papers, split].filter(Boolean).join(' · ')
        : `${period}มี ${plan.fileCount} ไฟล์${split ? ` ${split}` : ''}`}</p>
    {showCounts && plan.missingReceiptCount > 0 && <p className="text-sm text-warning-700" role="status">ยังไม่มีใบเสร็จ {plan.missingReceiptCount} รายการ</p>}
    {plan.partCount > 0 && <ActionGroup align="start">
      {Array.from({ length: plan.partCount }, (_, index) => <button key={index} type="button" className={accountant ? primaryButtonClass : secondaryButtonClass}
        disabled={busy} aria-busy={busy} onClick={() => onDownload(index + 1)}>
        {accountant ? `ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี${plan.partCount > 1 ? ` ชุดที่ ${index + 1} จาก ${plan.partCount}` : ''}` : plan.partCount === 1 ? 'ดาวน์โหลดไฟล์ทั้งหมด' : `ไฟล์ชุดที่ ${index + 1} จาก ${plan.partCount}`}
      </button>)}
    </ActionGroup>}
  </div>;
}

/** Each plan/download belongs to one exact selection; a late response cannot download another filter's files. */
export function EvidenceBundleDownload({ companyId, request, enabled, showCounts, accountant = false, onReturnToExpenses }: {
  companyId: string; request: Record<string, unknown>; enabled: boolean; accountant?: boolean; showCounts?: boolean; onReturnToExpenses?: () => void;
}) {
  const [plan, setPlan] = useState<AccountantEvidenceBundlePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    const current = ++version.current;
    setPlan(null); setError(null); setBusy(false);
    if (enabled) void planAccountantEvidenceBundle(companyId, JSON.parse(requestKey))
      .then(result => { if (current === version.current) setPlan(result); })
      .catch(cause => { if (current === version.current) setError(apiErrorMessage(cause)); });
    return () => { version.current += 1; };
  }, [companyId, requestKey, enabled, retry]);

  const download = async (part: number) => {
    const current = version.current;
    setBusy(true); setError(null);
    try {
      const result = await fetchAccountantEvidenceBundle(companyId, JSON.parse(requestKey), part);
      if (current === version.current) downloadBlob(result.blob, result.fileName);
    } catch (cause) { if (current === version.current) setError(apiErrorMessage(cause)); }
    finally { if (current === version.current) setBusy(false); }
  };

  return <div className="min-w-0 flex-1 space-y-2">
    {enabled && plan ? <EvidenceBundleActions accountant={accountant} showCounts={showCounts} plan={plan} busy={busy} allMonths={!request.yearMonth} onDownload={part => void download(part)} />
      : !error && <p className="text-sm text-gray-500" role="status">กำลังนับไฟล์...</p>}
    {error && <div className="space-y-2">
      <p className="text-sm text-danger-700" role="alert">{error}</p>
      <ActionGroup align="start">
        {onReturnToExpenses
          ? <button type="button" className={secondaryButtonClass} onClick={onReturnToExpenses}>กลับไปรายการค่าใช้จ่าย</button>
          : <Link href={`/companies/${companyId}/expenses`} className={secondaryButtonClass}>กลับไปรายการค่าใช้จ่าย</Link>}
        <button type="button" className={secondaryButtonClass} disabled={busy} aria-busy={busy} onClick={() => setRetry(value => value + 1)}>ลองอีกครั้ง</button></ActionGroup>
    </div>}
  </div>;
}
