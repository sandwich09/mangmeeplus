import { BILLING_PAID_TIERS, type BillingPurchaseMode } from '@watchdog-bms/contracts';

const purchaseModes: BillingPurchaseMode[] = ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'];

/** D-P3-8: a deal rides the same detour as the catalog, so the return lands back on its card. The
 *  id goes straight into the next quote body, so only an opaque token shape is carried back. */
const DEAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function billingProfileSelection(search: string) {
  const params = new URLSearchParams(search), offer = params.get('offer'), interval = params.get('interval');
  if (!BILLING_PAID_TIERS.some(value => value === offer) || !['month', 'year'].includes(interval ?? '')) return null;
  const purchaseMode = params.get('purchaseMode'), dealId = params.get('deal'), purchaseIntent = params.get('purchaseIntent');
  return { offer: offer!, interval: interval!, channel: params.get('channel') === 'line' ? 'line' : 'web',
    ...(purchaseModes.includes(purchaseMode as BillingPurchaseMode) ? { purchaseMode: purchaseMode as BillingPurchaseMode } : {}),
    ...(dealId && DEAL_ID.test(dealId) ? { dealId } : {}),
    ...(purchaseIntent === 'FULL_PACKAGE' ? { purchaseIntent: 'FULL_PACKAGE' as const } : {}) };
}

type BillingProfileSelection = { offer: string; interval: string; channel: string; purchaseMode?: BillingPurchaseMode; dealId?: string; purchaseIntent?: 'FULL_PACKAGE' };

/** `dealId` travels as `deal`, on both legs, or the return href would hand back a param
 *  `billingProfileSelection` does not read and the customer would land on the catalog. */
const selectionParams = ({ dealId, ...rest }: BillingProfileSelection) => ({ ...rest, ...(dealId ? { deal: dealId } : {}) });

export function billingProfileHref(companyId: string, selection: BillingProfileSelection) {
  return `/companies/${encodeURIComponent(companyId)}/settings/profile?${new URLSearchParams({ ...selectionParams(selection), returnTo: 'billing' })}#shop`;
}

export function billingProfileReturnHref(companyId: string, search: string): string | null {
  const selection = billingProfileSelection(search);
  return new URLSearchParams(search).get('returnTo') === 'billing' && selection
    ? `/companies/${encodeURIComponent(companyId)}/billing?${new URLSearchParams({ ...selectionParams(selection), profile: 'updated' })}` : null;
}
