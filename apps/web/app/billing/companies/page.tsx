import { redirect } from 'next/navigation';
import { THAI_SYSTEM_ROLE_NAMES, BILLING_PAID_TIERS } from '@watchdog-bms/contracts';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';
import BillingCompanyPicker from '@/features/billing/BillingCompanyPicker';

export const dynamic = 'force-dynamic';
export default async function BillingCompaniesPage({ searchParams }: { searchParams: Promise<{ offer?: string; interval?: string; channel?: string; fromCompany?: string | string[] }> }) {
  const input = await searchParams, query = new URLSearchParams();
  if (BILLING_PAID_TIERS.includes(input.offer as typeof BILLING_PAID_TIERS[number])) query.set('offer', input.offer!);
  if (input.interval === 'month' || input.interval === 'year') query.set('interval', input.interval);
  if (input.channel === 'line') query.set('channel', 'line');
  const fromCompany = typeof input.fromCompany === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.fromCompany) ? input.fromCompany : undefined;
  const returnQuery = new URLSearchParams(query);
  if (fromCompany) returnQuery.set('fromCompany', fromCompany);
  const next = `/billing/companies${returnQuery.size ? `?${returnQuery}` : ''}`;
  const result = await fetchServerSessionResult();
  if (result.status === 'signed_out') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') throw new Error('Cannot reach the authentication service. Please try again.');
  if (result.status === 'forbidden') return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังเข้าร้านไม่ได้</h1><p>ให้{THAI_SYSTEM_ROLE_NAMES.OWNER}ตรวจสิทธิ์ของคุณ หรือติดต่อทีมงานมั่งมี <span className="mangmee-unit">098-256-5628</span></p><a className="inline-flex min-h-11 items-center underline" href="mailto:contact@mangmeeplus.com">ติดต่อทีมงานมั่งมี</a></main>;
  if (result.session.mustChangePassword) redirect(`/change-password?next=${encodeURIComponent(next)}`);
  if (result.session.legalAcceptanceRequired !== false) redirect(legalAcceptancePath(next, result.session.companyId));
  return <BillingCompanyPicker query={query.toString()} fromCompany={fromCompany} />;
}
