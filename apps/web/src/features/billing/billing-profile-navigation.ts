import { BILLING_PAID_TIERS } from '@watchdog-bms/contracts';

export function billingProfileSelection(search: string) {
  const params = new URLSearchParams(search), offer = params.get('offer'), interval = params.get('interval');
  if (!BILLING_PAID_TIERS.some(value => value === offer) || !['month', 'year'].includes(interval ?? '')) return null;
  return { offer: offer!, interval: interval!, channel: params.get('channel') === 'line' ? 'line' : 'web' };
}

export function billingProfileHref(companyId: string, selection: { offer: string; interval: string; channel: string }) {
  return `/companies/${encodeURIComponent(companyId)}/settings/profile?${new URLSearchParams({ ...selection, returnTo: 'billing' })}#shop`;
}

export function billingProfileReturnHref(companyId: string, search: string): string | null {
  const selection = billingProfileSelection(search);
  return new URLSearchParams(search).get('returnTo') === 'billing' && selection
    ? `/companies/${encodeURIComponent(companyId)}/billing?${new URLSearchParams({ ...selection, profile: 'updated' })}` : null;
}
