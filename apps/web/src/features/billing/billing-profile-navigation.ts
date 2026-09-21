import { BILLING_PAID_TIERS, type BillingPurchaseMode } from '@watchdog-bms/contracts';

const purchaseModes: BillingPurchaseMode[] = ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'];

export function billingProfileSelection(search: string) {
  const params = new URLSearchParams(search), offer = params.get('offer'), interval = params.get('interval');
  if (!BILLING_PAID_TIERS.some(value => value === offer) || !['month', 'year'].includes(interval ?? '')) return null;
  const purchaseMode = params.get('purchaseMode');
  return { offer: offer!, interval: interval!, channel: params.get('channel') === 'line' ? 'line' : 'web',
    ...(purchaseModes.includes(purchaseMode as BillingPurchaseMode) ? { purchaseMode: purchaseMode as BillingPurchaseMode } : {}) };
}

export function billingProfileHref(companyId: string, selection: { offer: string; interval: string; channel: string; purchaseMode?: BillingPurchaseMode }) {
  return `/companies/${encodeURIComponent(companyId)}/settings/profile?${new URLSearchParams({ ...selection, returnTo: 'billing' })}#shop`;
}

export function billingProfileReturnHref(companyId: string, search: string): string | null {
  const selection = billingProfileSelection(search);
  return new URLSearchParams(search).get('returnTo') === 'billing' && selection
    ? `/companies/${encodeURIComponent(companyId)}/billing?${new URLSearchParams({ ...selection, profile: 'updated' })}` : null;
}
