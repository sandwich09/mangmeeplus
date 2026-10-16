import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { errorText } from './billing-error-text';
import type {MouseEvent} from 'react';
import type {BillingReceiptUsage, BillingApprovalMode, BillingPurchaseMode, BillingStatus} from '@watchdog-bms/contracts';
export { billingLabel, billingPlanLabel, billingOfferLabel, billingPermissionLabel, billingEventLabel, billingDeliveryLabel, billingIssueLabel, billingTimelineLabel } from '@watchdog-bms/contracts';

export const billingControl = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-base font-semibold bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

export const billingField = 'mangmee-input mt-2 block min-h-11 w-full min-w-0 !text-base';
export const billingLink = 'inline-flex min-h-11 items-center rounded-lg px-2 text-base text-brand-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-700';
export const billingBackControl = 'inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-gray-600 no-underline transition hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

export const billingPrimaryControl = `${billingControl} !border-brand-700 !bg-brand-700 !text-white hover:!bg-brand-800`;

export function billingMonthlyAllowanceText(usage:Pick<BillingReceiptUsage,'monthlyAllowance'>):string|null {
  const monthly=usage.monthlyAllowance;if(!monthly)return null;
  const end=monthly.additionalExpiresAt?formatThaiDateTime(monthly.additionalExpiresAt):null;
  return `ใบเสร็จปกติ ${monthly.limit===null?'ไม่จำกัด':`${monthly.limit} ใบต่อเดือน`} · ผู้ดูแลเพิ่มให้ เหลือ ${monthly.additionalRemaining} ใบ${end?` ใช้ได้ถึง ${end}`:''} ส่วนที่เพิ่มไม่เติมใหม่ทุกเดือน`;
}

/** Opening another tab or selecting the current link does not abandon this page's pending work. */
export function billingLeavesPage(event:MouseEvent<HTMLAnchorElement>){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||(event.currentTarget.target&&event.currentTarget.target!=='_self'))return false;
  const to=new URL(event.currentTarget.href),from=window.location;
  // These Admin routes bind work by pathname; filters and batch-return links are query parameters.
  return to.origin!==from.origin||to.pathname!==from.pathname;
}

/**
 * The number a shop owner reads out to the team. `reference` is an internal row id (a UUID), which
 * is a machine token on a customer screen and unreadable over the phone — so only its last eight
 * characters are shown, grouped; support matches on that suffix. A reference that is already short
 * and human (an invoice number) is left exactly as it is.
 */
export function billingSupportReference(value: string | null | undefined): string | null {
  const clean = (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean) return null;
  if (clean.length <= 12) return (value ?? '').trim();
  const tail = clean.slice(-8);
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/**
 * F04/R-A8: the one gate for every "แก้อีเมลรับเอกสาร" on the package page — the return page's and the
 * recipient panel's — so one never opens while the other refuses. The status's own `canChange` (a
 * Customer exists, no purchase and no recipient change in flight); an API without it falls back to
 * "a purchase that has not applied yet".
 */
export function billingRecipientLocked(status: Pick<BillingStatus, 'recipient' | 'attemptId' | 'applyState' | 'paymentState'>): boolean {
  return status.recipient ? !status.recipient.canChange
    : Boolean(status.attemptId && status.applyState !== 'APPLIED' && status.paymentState !== 'FAILED');
}
export const BILLING_RECIPIENT_WAIT_TEXT = 'แก้อีเมลรับเอกสารได้เมื่อรายการจ่ายเงินปัจจุบันเปิดสิทธิ์เสร็จ';

/** One wording for both pickers on the package page: the catalog's and the deal card's (R10/S39). */
export function billingPurchaseModeLabel(mode: BillingPurchaseMode): string {
  return mode === 'CARD_AUTO' ? 'บัตร · ต่ออายุอัตโนมัติ' : mode === 'CARD_ONCE' ? 'บัตร · จ่ายครั้งเดียว'
    : mode === 'PROMPTPAY_ONCE' ? 'พร้อมเพย์ QR · จ่ายครั้งเดียว' : 'พร้อมเพย์ QR · สแกนบิลทุกงวด';
}

/**
 * The renewal panel's one line about the renewal itself (2026-10-10): said only of a renewal the shop has. The panel also opens for a one-time shop with a prepaid package waiting,
 * which has no automatic renewal, so it gets no line (the page already says "จ่ายครั้งเดียว … ไม่มีการตัดเงินงวดถัดไป").
 */
export function billingRenewalLine(status: Pick<BillingStatus, 'cancelAtPeriodEnd' | 'collectionPause' | 'renewalMode'>): string | null {
  const qr = status.renewalMode === 'PROMPTPAY_RENEW';
  if (!qr && status.renewalMode !== 'CARD_AUTO') return null;
  return status.cancelAtPeriodEnd ? (qr ? 'หยุดออกบิลแล้ว' : 'หยุดต่ออายุแล้ว')
    : status.collectionPause ? 'พักการเรียกเก็บเงินชั่วคราว' : qr ? 'ระบบออกบิล QR ทุกงวด ต้องสแกนจ่ายเอง' : 'ต่ออายุอัตโนมัติเปิดอยู่';
}

export function billingApprovalLabel(mode: BillingApprovalMode): string {
  return mode === 'SINGLE_ADMIN' ? 'ยืนยันโดยผู้ดูแลระบบคนเดียว' : 'อนุมัติโดยผู้ตรวจอีกคน';
}

/** D1: visibility is not permission to sell a mode. Keep every choice and explain the read's gate. */
export function billingPurchaseChoices(status: BillingStatus) {
  const modes: BillingPurchaseMode[] = ['PROMPTPAY_ONCE', 'CARD_ONCE', 'CARD_AUTO', 'PROMPTPAY_RENEW'];
  return modes.map(mode => {
    const enabled = (status.enabledPurchaseModes ?? status.availablePurchaseModes ?? []).includes(mode);
    const available = (status.availablePurchaseModes ?? []).includes(mode);
    const reason = status.purchaseBlockCode ? errorText({ code: status.purchaseBlockCode })
      : !enabled ? 'ยังไม่เปิดใช้วิธีนี้'
      : !available ? 'วิธีนี้ยังใช้กับแพ็กเกจปัจจุบันไม่ได้'
      : !status.allowedActions.includes('new_sales') ? 'ยังซื้อแพ็กเกจไม่ได้' : null;
    return { mode, disabled: !!reason, reason };
  });
}

export function billingOneTimePurchase(mode: BillingPurchaseMode | undefined): boolean {
  return mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE';
}
