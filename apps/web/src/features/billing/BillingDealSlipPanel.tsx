'use client';
import { useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { PLAN_TERM_RENEW_PHONE } from '@/features/plan-term/plan-term.logic';
import { billingControl, billingPrimaryControl } from './billing-display';
import { dealSlip, slipBankAccount, type BillingDealOffer } from './billing-deal';
import { DEAL_SLIP_ACCEPT, uploadDealSlipFile } from './billing.api';

/**
 * Q9 (spec §19.5): the way a shop pays a deal when it cannot pay online — the card/PromptPay gates
 * are closed, or the amount is over what its banking app allows. It transfers the money itself and
 * attaches the slip; a person at มั่งมี checks it and opens the package by hand. Nothing here reads
 * the slip, and none of this exists in LINE.
 *
 * Always offered under the deal card — as the only way to pay when the offer carries no online
 * mode, and as the second way when it does.
 */
const SLIP_SENT = 'ส่งสลิปแล้ว รอทีมงานตรวจภายใน 1 วันทำการ';

export default function BillingDealSlipPanel({
  companyId, deal, amountLabel, submitted, onSubmitted,
}: { companyId: string; deal: BillingDealOffer; amountLabel: string; submitted: boolean; onSubmitted: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const slip = dealSlip(deal);
  const bank = slipBankAccount();
  const onlyWay = deal.purchaseModes.length === 0;

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await uploadDealSlipFile(companyId, deal.dealId, file);
      onSubmitted();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // A slip already under review is the whole story: no form, no second payment. `submitted` is the
  // same answer for the slip THIS visit just sent: `BillingStatus.deal` does not carry `slipState`
  // yet (it lives on `PackageChangeDealOffer`), and a shop whose upload changed nothing on screen
  // sends it again. Drop the prop once the status carries the field — `slip.state` then covers it.
  if (submitted || (slip.state && !slip.canUpload)) {
    return <p role="status" className="rounded-xl bg-brand-50 p-4 text-brand-800">{slip.message ?? SLIP_SENT}</p>;
  }

  return (
    <div className="space-y-3">
      {slip.state === 'REJECTED' && (
        <p role="status" className="rounded-xl bg-amber-50 p-4">
          {slip.message}{slip.reason ? ` · เหตุผล: ${slip.reason}` : ''}
        </p>
      )}
      {/* No published account means there is nowhere to transfer to, so the route is not offered at
          all. When it was also the only way to pay, the card keeps the phone number it showed
          before the fallback existed (S37) rather than a button that leads to a dead end. */}
      {!bank
        ? onlyWay && <p role="status" className="rounded-xl bg-amber-50 p-4">ติดต่อทีมงานเพื่อชำระข้อเสนอนี้ โทร {PLAN_TERM_RENEW_PHONE}</p>
        : !open
          ? <button className={`${onlyWay ? billingPrimaryControl : billingControl} w-full`}
            onClick={() => setOpen(true)}>โอนเงินเข้าบัญชีแล้วแนบสลิป</button>
          : <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <p className="font-semibold">โอนเงิน {amountLabel} เข้าบัญชีนี้</p>
            <dl className="grid gap-1 text-sm">
              <div><dt className="inline font-semibold text-gray-500">ธนาคาร: </dt><dd className="inline">{bank.bankName}</dd></div>
              <div><dt className="inline font-semibold text-gray-500">เลขที่บัญชี: </dt><dd className="inline font-bold">{bank.accountNumber}</dd></div>
              <div><dt className="inline font-semibold text-gray-500">ชื่อบัญชี: </dt><dd className="inline">{bank.accountName}</dd></div>
              {bank.note && <p className="mt-1 text-gray-600">{bank.note}</p>}
            </dl>
            <p className="text-sm text-gray-600">โอนยอดให้ตรงกับที่แสดงไว้ แล้วแนบสลิปเป็นไฟล์ PDF, PNG หรือ JPG ขนาดไม่เกิน 10 MB</p>
            <input ref={fileInput} type="file" accept={DEAL_SLIP_ACCEPT} disabled={busy} aria-label="แนบสลิปการโอนเงิน"
              className="block w-full text-sm" onChange={event => {
                const file = event.target.files?.[0];
                if (file) void send(file);
              }} />
            {busy && <p role="status">กำลังส่งสลิป…</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-4">{error}</p>}
            <p className="text-sm text-gray-600">ทีมงานจะตรวจสลิปภายใน 1 วันทำการ แล้วเปิดแพ็กเกจให้ร้านคุณ</p>
            <button className={`${billingControl} w-full`} disabled={busy} onClick={() => { setOpen(false); setError(null); }}>ปิด</button>
          </div>}
    </div>
  );
}
