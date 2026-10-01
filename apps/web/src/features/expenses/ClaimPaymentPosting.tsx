'use client';

import { useCallback, useEffect, useState } from 'react';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { generateSourceJournal, listUnpostedClaimPayments, type UnpostedClaimPayment } from '../ledger/ledger.api';
import { POSTING_STATUS_LABELS } from './expenses.model';
import { ErrorBanner, baht, dateShort, err, ghostClass } from './ExpensesUi';

const amountText = (row: Pick<UnpostedClaimPayment, 'paidAmount' | 'currency'>) => (row.currency === 'THB'
  ? baht(row.paidAmount)
  : `${Number(row.paidAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency}`);

/**
 * The rows and their actions, apart from the loader so every state can be rendered directly.
 * One stacked card per payout at every width: a phone (390px) reads it top to bottom and the
 * action is a full-width button; from `sm` up the same card puts the amount and action on the right.
 */
export function ClaimPaymentPostingList({ companyId, rows, postingId, error, onPost }: {
  companyId: string;
  rows: UnpostedClaimPayment[];
  postingId: string | null;
  error: string | null;
  onPost: (paymentId: string) => void;
}) {
  // Nothing waiting and nothing to report: the worklist takes no room on the screen.
  if (rows.length === 0 && !error) return null;
  return (
    <MangmeeCard className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold text-gray-900">การจ่ายเงินคืนใบเบิกที่ยังไม่ลงบัญชี <span className="font-semibold text-gray-500">({rows.length} รายการ)</span></h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">เงินที่จ่ายคืนพนักงานแล้ว แต่ยังไม่ได้ลงสมุดรายวัน ต้องลงให้ครบก่อนจึงจะปิดงวดได้</p>
      </div>
      {error && <ErrorBanner message={error} />}
      <ul className="space-y-2" data-testid="claim-payment-posting-list">
        {rows.map((row) => {
          const failed = row.postingStatus === 'posting_error';
          const busy = postingId === row.paymentId;
          return (
            <li key={row.paymentId} className="rounded-xl border border-gray-100 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <a className="truncate text-sm font-bold text-brand-700 hover:underline"
                    href={`/companies/${companyId}/reimbursements/${encodeURIComponent(row.reimbursementRequestId)}`}>
                    {row.requestNo ?? 'ใบเบิก'}
                  </a>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 sm:hidden">{amountText(row)}</span>
                </div>
                <p className="mt-0.5 break-words text-sm text-gray-700">
                  จ่ายคืน {row.requesterDisplayNameSnapshot?.trim() || 'พนักงาน'}{row.paymentNo ? ` · เลขที่จ่าย ${row.paymentNo}` : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span>จ่ายเมื่อ {dateShort(row.paidAt)}</span>
                  <MangmeeBadge tone={failed ? 'danger' : 'amber'}>{failed ? POSTING_STATUS_LABELS.posting_error : POSTING_STATUS_LABELS.pending}</MangmeeBadge>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 sm:mt-0 sm:shrink-0">
                <span className="hidden text-sm font-bold tabular-nums text-gray-900 sm:inline">{amountText(row)}</span>
                <button type="button" className={cx(ghostClass, 'w-full sm:w-auto')} disabled={postingId !== null} aria-busy={busy}
                  onClick={() => onPost(row.paymentId)}>
                  {busy ? 'กำลังลง...' : failed ? 'ลองอีกครั้ง' : 'ลงบัญชี'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </MangmeeCard>
  );
}

/**
 * Claim payouts the ledger has not recorded yet — the reimbursement half of the posting worklist.
 * Posts through the same canonical generator as the expense rows beside it, so every ledger rule
 * (accrual first, account mapping, open period) still decides; a refusal stays on screen in Thai
 * and the row stays here for a retry.
 */
export function ClaimPaymentPosting({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<UnpostedClaimPayment[]>([]);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listUnpostedClaimPayments(companyId)); }
    catch (e) { setError(err(e)); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  const post = async (paymentId: string) => {
    setPostingId(paymentId); setError(null);
    try {
      await generateSourceJournal(companyId, 'reimbursement.payment', paymentId);
      toast.success('สร้างสมุดรายวันเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); }
    // Reload either way: a posted row leaves the list, a refused one changes its status.
    await load();
    setPostingId(null);
  };

  return <ClaimPaymentPostingList companyId={companyId} rows={rows} postingId={postingId} error={error} onPost={(paymentId) => void post(paymentId)} />;
}
