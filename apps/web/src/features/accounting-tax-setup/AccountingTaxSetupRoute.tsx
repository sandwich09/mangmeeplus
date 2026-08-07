import { fetchServerSession } from '@/common/auth/server-session';
import { AccountingTaxSetupPage } from './AccountingTaxSetupPage';
import type { AccountingTaxSetupStep } from './accounting-tax-setup.logic';

type RouteProps = {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export async function AccountingTaxSetupRoute({
  params,
  searchParams,
  step,
}: RouteProps & { step: AccountingTaxSetupStep }) {
  const { companyId } = await params;
  const query: Record<string, string | string[] | undefined> = searchParams ? await searchParams : {};
  const session = await fetchServerSession(companyId);
  return (
    <AccountingTaxSetupPage
      companyId={companyId}
      permissions={session?.permissions ?? []}
      step={step}
      initialProfileId={first(query.profileId)}
      returnTo={first(query.returnTo)}
    />
  );
}
