import type {MouseEvent} from 'react';
export { billingLabel, billingPlanLabel, billingOfferLabel, billingPermissionLabel, billingEventLabel, billingDeliveryLabel, billingIssueLabel, billingTimelineLabel } from '@watchdog-bms/contracts';

export const billingControl = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50';

/** Opening another tab or selecting the current link does not abandon this page's pending work. */
export function billingLeavesPage(event:MouseEvent<HTMLAnchorElement>){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||(event.currentTarget.target&&event.currentTarget.target!=='_self'))return false;
  const to=new URL(event.currentTarget.href),from=window.location;
  // These Admin routes bind work by pathname; filters and batch-return links are query parameters.
  return to.origin!==from.origin||to.pathname!==from.pathname;
}
