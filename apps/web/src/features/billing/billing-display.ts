import type {MouseEvent} from 'react';
import type {BillingReceiptUsage, BillingApprovalMode} from '@watchdog-bms/contracts';
export { billingLabel, billingPlanLabel, billingOfferLabel, billingPermissionLabel, billingEventLabel, billingDeliveryLabel, billingIssueLabel, billingTimelineLabel } from '@watchdog-bms/contracts';

export const billingControl = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export function billingMonthlyAllowanceText(usage:Pick<BillingReceiptUsage,'monthlyAllowance'>):string|null {
  const monthly=usage.monthlyAllowance;if(!monthly)return null;
  const end=monthly.additionalExpiresAt?new Date(monthly.additionalExpiresAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):null;
  return `โควตาปกติ ${monthly.limit===null?'ไม่จำกัด':`${monthly.limit} ใบต่อเดือน`} · ผู้ดูแลเพิ่มให้ เหลือ ${monthly.additionalRemaining} ใบ${end?` ใช้ได้ถึง ${end}`:''} ส่วนที่เพิ่มไม่เติมใหม่ทุกเดือน`;
}

/** Opening another tab or selecting the current link does not abandon this page's pending work. */
export function billingLeavesPage(event:MouseEvent<HTMLAnchorElement>){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||(event.currentTarget.target&&event.currentTarget.target!=='_self'))return false;
  const to=new URL(event.currentTarget.href),from=window.location;
  // These Admin routes bind work by pathname; filters and batch-return links are query parameters.
  return to.origin!==from.origin||to.pathname!==from.pathname;
}

export function billingApprovalLabel(mode: BillingApprovalMode): string {
  return mode === 'SINGLE_ADMIN' ? 'ยืนยันโดยผู้ดูแลระบบคนเดียว' : 'อนุมัติโดยผู้ตรวจอีกคน';
}
