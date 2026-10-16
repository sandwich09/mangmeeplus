import { redirect } from 'next/navigation';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';
import { AccountEmailOtpPanel } from '@/features/auth/AccountEmailOtpPanel';
import BillingCustomerFrame from '@/features/billing/BillingCustomerFrame';

export const dynamic = 'force-dynamic';

// Personal-account recovery must remain reachable when a company's term has expired.
export default async function AccountEmailPage({ searchParams }: { searchParams: Promise<{ company?: string | string[]; interval?: string | string[]; channel?: string | string[] }> }) {
  const input = await searchParams, query = new URLSearchParams();
  const company = typeof input.company === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.company) ? input.company : null;
  if (company) query.set('company', company);
  if (input.interval === 'month' || input.interval === 'year') query.set('interval', input.interval);
  // R-B4 (purchase-without-setup §18.2): reopening this page outside the LINE in-app browser keeps
  // `channel=line`, so a session-less landing at /login?next=<this> auto-starts LINE login (R-B5).
  if (input.channel === 'line') query.set('channel', 'line');
  const next = `/account/email${query.size ? `?${query}` : ''}`;
  const result = await fetchServerSessionResult(company ?? undefined);
  if (result.status === 'signed_out') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') throw new Error('Cannot reach the authentication service. Please try again.');
  if (result.status === 'forbidden') redirect('/billing/companies');
  if (result.session.mustChangePassword) redirect(`/change-password?next=${encodeURIComponent(next)}`);
  if (result.session.legalAcceptanceRequired !== false) redirect(legalAcceptancePath(next, result.session.companyId));
  const billingReturn = company && result.session.permissions.includes('company.plan.manage');
  // Someone who cannot manage the package came from that shop's settings (the locked hub's account
  // card): the package picker would only tell them they have no shop to manage.
  const backHref = billingReturn ? `/companies/${encodeURIComponent(company)}/billing${query.has('interval') ? `?interval=${query.get('interval')}` : ''}`
    : company ? `/companies/${encodeURIComponent(company)}/settings` : '/billing/companies';
  return <BillingCustomerFrame eyebrow="บัญชีของฉัน" title="จัดการอีเมลบัญชี" description="ใช้เข้าสู่ระบบสำรองและรับแจ้งเตือน ไม่ต้องยืนยันก่อนซื้อแพ็กเกจ"
    backHref={backHref} backLabel={billingReturn ? 'กลับไปหน้าแพ็กเกจ' : company ? 'กลับไปหน้าตั้งค่า' : 'กลับไปเลือกร้าน'}>
    <AccountEmailOtpPanel reauthReturnTo={next} />
  </BillingCustomerFrame>;
}
