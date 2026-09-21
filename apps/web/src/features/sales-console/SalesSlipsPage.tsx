'use client';
import { useCallback, useEffect, useState } from 'react';
import { SALES_DEAL_REASON_MAX, type SalesDealSlipRow } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { TextField, TextareaField } from '@/common/components/field';
import { LoadingState } from '@/common/components/state';
import { Modal } from '@/common/components/modal';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { decideSalesDealSlip, getSalesDealSlipUrl, listSalesDealSlips, reauthenticateBillingAdmin } from './sales.api';
import { formatBaht } from './sales-console.logic';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

/**
 * Q9 fallback: the shop transferred the money and attached the slip, so a person has to look at it
 * and say yes. Confirming opens a paid term, which makes it a reviewed operation — the same
 * password proof the billing admin already uses (`/system/billing/reauthenticate`) is taken in the
 * confirm box itself, so the window can never be open from an earlier, unrelated screen.
 *
 * The slip itself is fetched on an explicit tap, never pre-loaded: the URL is short-lived and a
 * queue that renders twenty bank slips at once is twenty documents nobody asked to see.
 */

type Decision = { row: SalesDealSlipRow; action: 'verify' | 'reject' };

const DECISION_COPY = {
  verify: {
    title: 'ยืนยันว่าได้รับเงินโอนแล้ว',
    hint: 'ตรวจยอดและวันที่บนสลิปกับบัญชีธนาคารก่อน เมื่อยืนยันแล้วระบบจะเปิดแพ็กเกจให้ร้านทันที',
    confirm: 'ยืนยันการโอน',
  },
  reject: {
    title: 'ปฏิเสธสลิปนี้',
    hint: 'ลูกค้าจะเห็นเหตุผลนี้ในหน้าแพ็กเกจ และแนบสลิปใหม่ได้',
    confirm: 'ปฏิเสธสลิป',
  },
} as const;

function SlipPreview({ dealId }: { dealId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      setImageFailed(false);
      setUrl((await getSalesDealSlipUrl(dealId)).downloadUrl);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!url) {
    return (
      <>
        <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy} onClick={() => void open()}>ดูสลิป</button>
        {error && <SalesNotice tone="error">{error}</SalesNotice>}
      </>
    );
  }
  // A PDF cannot render in <img>, so the failed load becomes the link instead of a broken frame.
  return imageFailed
    ? <a href={url} target="_blank" rel="noreferrer" className="mangmee-btn mangmee-btn-secondary">เปิดสลิปในแท็บใหม่</a>
    : <img src={url} alt="สลิปโอนเงินของลูกค้า" onError={() => setImageFailed(true)}
      className="max-h-96 w-full rounded-xl border border-gray-200 bg-white object-contain" />;
}

export default function SalesSlipsPage() {
  const [rows, setRows] = useState<SalesDealSlipRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback((signal?: AbortSignal) => {
    setError(null);
    return listSalesDealSlips({ signal })
      .then((result) => { if (!signal?.aborted) setRows(result.items); })
      .catch((cause) => { if (!signal?.aborted) { setRows([]); setError(apiErrorMessage(cause)); } });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const closeDecision = () => { setDecision(null); setPassword(''); setReason(''); };

  const runDecision = async () => {
    if (!decision) return;
    const trimmed = reason.trim();
    if (!trimmed || (decision.action === 'verify' && !password)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Prove first, act second: `verify` applies a paid term inside a transaction that demands a
      // proof no older than five minutes, and a refused password must not leave a half-done review.
      if (decision.action === 'verify') await reauthenticateBillingAdmin(password);
      // Both decisions answer with the refreshed queue, so the row leaves without a second read.
      const remaining = await decideSalesDealSlip(decision.row.dealId, decision.action, { reason: trimmed });
      closeDecision();
      setRows(remaining.items);
      setNotice(decision.action === 'verify'
        ? `ยืนยันการโอนของ ${decision.row.companyName} แล้ว ระบบกำลังเปิดแพ็กเกจให้ร้าน`
        : `ปฏิเสธสลิปของ ${decision.row.companyName} แล้ว ลูกค้าแนบสลิปใหม่ได้`);
    } catch (cause) {
      setPassword('');
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = decision ? DECISION_COPY[decision.action] : null;

  return (
    <MangmeePage
      eyebrow="ผู้ดูแลระบบ"
      title="สลิปดีลพิเศษ"
      description="ลูกค้าที่โอนเงินเข้าบัญชีและแนบสลิปไว้ รอตรวจก่อนเปิดแพ็กเกจ"
    >
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {notice && <SalesNotice tone="info">{notice}</SalesNotice>}

      {rows === null ? <LoadingState label="กำลังโหลดสลิปที่รอตรวจ…" />
        : rows.length === 0 ? <SalesEmpty>ตอนนี้ไม่มีสลิปรอตรวจ</SalesEmpty>
          : rows.map((row) => (
            <MangmeeCard key={row.dealId} className="grid gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold text-gray-900">{row.companyName}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatBaht(row.amountSatang)} · {row.baseLabel} · {row.months} เดือน · เซลล์ {row.salesDisplayName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">แนบสลิปเมื่อ {formatThaiDateTime(row.submittedAt)}</p>
                </div>
              </div>
              <SlipPreview dealId={row.dealId} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy}
                  onClick={() => { setPassword(''); setReason(''); setDecision({ row, action: 'verify' }); }}>ยืนยันการโอน</button>
                <button type="button" className="mangmee-btn mangmee-btn-danger" disabled={busy}
                  onClick={() => { setPassword(''); setReason(''); setDecision({ row, action: 'reject' }); }}>ปฏิเสธ</button>
              </div>
            </MangmeeCard>
          ))}

      <Modal open={decision !== null} onClose={closeDecision} title={copy?.title ?? ''}>
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">{copy?.hint}</p>
          <p className="text-sm font-semibold text-gray-800">
            {decision?.row.companyName} · {decision ? formatBaht(decision.row.amountSatang) : ''} · {decision?.row.months} เดือน
          </p>
          <TextareaField label="เหตุผล (จำเป็น)" name="slipReason" maxLength={SALES_DEAL_REASON_MAX}
            value={reason} onChange={(event) => setReason(event.target.value)} />
          {decision?.action === 'verify' && (
            <TextField label="รหัสผ่านปัจจุบันของคุณ" name="slipPassword" type="password" autoComplete="current-password"
              maxLength={1024} hint="ยืนยันตัวตนก่อนเปิดแพ็กเกจให้ร้าน" value={password}
              onChange={(event) => setPassword(event.target.value)} />
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={closeDecision}>ปิด</button>
            <button type="button" className={`mangmee-btn ${decision?.action === 'reject' ? 'mangmee-btn-danger' : 'mangmee-btn-primary'}`}
              disabled={busy || !reason.trim() || (decision?.action === 'verify' && !password)} aria-busy={busy}
              onClick={() => void runDecision()}>{copy?.confirm}</button>
          </div>
        </div>
      </Modal>
    </MangmeePage>
  );
}
