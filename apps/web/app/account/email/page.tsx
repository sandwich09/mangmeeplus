import { redirect } from 'next/navigation';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';
import { AccountEmailOtpPanel } from '@/features/auth/AccountEmailOtpPanel';
import BillingCustomerFrame from '@/features/billing/BillingCustomerFrame';

export const dynamic = 'force-dynamic';

// Personal-account recovery must remain reachable when a company's term has expired.
export default async function AccountEmailPage({ searchParams }: { searchParams: Promise<{ company?: string | string[]; interval?: string | string[] }> }) {
  const input = await searchParams, query = new URLSearchParams();
  const company = typeof input.company === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.company) ? input.company : null;
  if (company) query.set('company', company);
  if (input.interval === 'month' || input.interval === 'year') query.set('interval', input.interval);
  const next = `/account/email${query.size ? `?${query}` : ''}`;
  const result = await fetchServerSessionResult(company ?? undefined);
  if (result.status === 'signed_out') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') throw new Error('Cannot reach the authentication service. Please try again.');
  if (result.status === 'forbidden') redirect('/billing/companies');
  if (result.session.mustChangePassword) redirect(`/change-password?next=${encodeURIComponent(next)}`);
  if (result.session.legalAcceptanceRequired !== false) redirect(legalAcceptancePath(next, result.session.companyId));
  const billingReturn = company && result.session.roles.includes('OWNER');
  const backHref = billingReturn ? `/companies/${encodeURIComponent(company)}/billing${query.has('interval') ? `?interval=${query.get('interval')}` : ''}` : '/billing/companies';
  return <BillingCustomerFrame eyebrow="บัญชีของฉัน" title="จัดการอีเมลบัญชี" description="ยืนยันอีเมลแล้วกลับไปเลือกแพ็กเกจได้ การยืนยันอีเมลยังไม่ใช่การชำระเงิน"
    backHref={backHref} backLabel={billingReturn ? 'กลับไปเลือกแพ็กเกจ' : 'กลับหน้าเลือกบริษัท'}>
    <AccountEmailOtpPanel reauthReturnTo={next} />
  </BillingCustomerFrame>;
}
