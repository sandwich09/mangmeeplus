'use client';

import { useCallback, useEffect, useState } from 'react';
import { CLAIM_PAYOUT_WORKLIST_LIMIT } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { generateSourceJournal, listUnpostedClaimPayments, type UnpostedClaimPayment } from '../ledger/ledger.api';
import { CLAIM_PAYOUT_POSTING_WORDS } from '../ledger/ledger.logic';
import { ErrorBanner, baht, dateShort, err, ghostClass } from './ExpensesUi';

/** A currency by its Thai name. A code nobody can name is not printed as it is. */
function currencyName(code: string): string {
  try { return new Intl.DisplayNames('th-TH', { type: 'currency', fallback: 'none' }).of(code) ?? 'สกุลเงินอื่น'; }
  catch { return 'สกุลเงินอื่น'; }
}

const amountText = (row: Pick<UnpostedClaimPayment, 'paidAmount' | 'currency'>) => (row.currency === 'THB'
  ? baht(row.paidAmount)
  : `${Number(row.paidAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyName(row.currency)}`);

/** Rows drawn at first, and added by each "แสดงเพิ่ม". */
export const CLAIM_PAYOUT_PAGE_SIZE = 10;

/**
 * The rows and their actions, apart from the loader so every state can be rendered directly.
 * One stacked card per payout at every width: a phone (390px) reads it top to bottom and the
 * action is a full-width button; from `sm` up the same card puts the amount and action on the right.
 *
 * Only the first `visible` rows are drawn. Where nothing can post yet the list only grows, so the
 * server sends at most CLAIM_PAYOUT_WORKLIST_LIMIT (oldest first) and the page draws ten at a time.
 *
 * `rows` is null until the first load answers. The card is on the page in every state, and loading
 * and "nothing waiting" are both one line, so the page below does not jump when the answer arrives.
 */
export function ClaimPaymentPostingList({ companyId, rows, visible, postingId, error, onPost, onShowMore, onRetry }: {
  companyId: string;
  rows: UnpostedClaimPayment[] | null;
  visible: number;
  postingId: string | null;
  error: string | null;
  onPost: (paymentId: string) => void;
  onShowMore: () => void;
  onRetry: () => void;
}) {
  // The server stopped at its limit, so the true total is not known: say "first", not a total.
  const capped = rows !== null && rows.length >= CLAIM_PAYOUT_WORKLIST_LIMIT;
  const hidden = rows ? Math.max(0, rows.length - visible) : 0;
  return (
    <MangmeeCard className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold text-gray-900">
          การจ่ายเงินคืนใบเบิกที่{CLAIM_PAYOUT_POSTING_WORDS.pending}
          {/* A count only for a list that was read and has rows: an unread list is not "0 รายการ". */}
          {rows?.length ? <span className="font-semibold text-gray-500"> ({rows.length} รายการ{capped ? 'แรก' : ''})</span> : null}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">เงินที่จ่ายคืนพนักงานแล้ว แต่ยังไม่ได้ลงสมุดรายวัน ต้องลงให้ครบก่อนจึงจะปิดงวดได้</p>
        {capped && <p className="mt-1 text-xs leading-relaxed text-gray-500">แสดงเฉพาะ {rows.length} รายการที่จ่ายก่อน เมื่อลงบัญชีรายการด้านบนแล้ว รายการถัดไปจะแสดงให้เอง</p>}
      </div>
      {error && <ErrorBanner message={error} />}
      {rows === null && !error && <p role="status" aria-busy="true" className="text-sm text-gray-500">กำลังโหลด...</p>}
      {rows === null && error && <button type="button" className={cx(ghostClass, 'w-full sm:w-auto')} onClick={onRetry}>โหลดอีกครั้ง</button>}
      {rows?.length === 0 && <p className="text-sm text-gray-500">ไม่มีรายการค้าง ลงบัญชีครบแล้ว</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2" data-testid="claim-payment-posting-list">
          {rows.slice(0, visible).map((row) => {
            const failed = row.postingStatus === 'posting_error';
            const busy = postingId === row.paymentId;
            return (
              <li key={row.paymentId} className="rounded-xl border border-gray-100 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    {/* 44px tall for a thumb; the number itself is what gets cut when it is too long. */}
                    <a className="flex min-h-11 min-w-0 items-center text-sm font-bold text-brand-700 hover:underline"
                      href={`/companies/${companyId}/reimbursements/${encodeURIComponent(row.reimbursementRequestId)}`}>
                      <span className="truncate">{row.requestNo ?? 'ใบเบิก'}</span>
                    </a>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 sm:hidden">{amountText(row)}</span>
                  </div>
                  <p className="break-words text-sm text-gray-700">
                    จ่ายคืน {row.requesterDisplayNameSnapshot?.trim() || 'พนักงาน'}{row.paymentNo ? ` · เลขที่จ่าย ${row.paymentNo}` : ''}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span>จ่ายเมื่อ {dateShort(row.paidAt)}</span>
                    <MangmeeBadge tone={failed ? 'danger' : 'amber'}>{CLAIM_PAYOUT_POSTING_WORDS[failed ? 'posting_error' : 'pending']}</MangmeeBadge>
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
      )}
      {hidden > 0 && (
        <button type="button" className={cx(ghostClass, 'w-full')} onClick={onShowMore}>
          แสดงเพิ่ม (อีก {hidden} รายการ)
        </button>
      )}
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
  // null until the first load answers: before that the list is unknown, not empty.
  const [rows, setRows] = useState<UnpostedClaimPayment[] | null>(null);
  const [visible, setVisible] = useState(CLAIM_PAYOUT_PAGE_SIZE);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listUnpostedClaimPayments(companyId)); }
    catch (e) { setError(err(e)); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
  const retry = () => { setError(null); void load(); };

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

  return (
    <ClaimPaymentPostingList companyId={companyId} rows={rows} visible={visible} postingId={postingId} error={error}
      onPost={(paymentId) => void post(paymentId)} onShowMore={() => setVisible((count) => count + CLAIM_PAYOUT_PAGE_SIZE)} onRetry={retry} />
  );
}
