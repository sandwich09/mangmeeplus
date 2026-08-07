import { AccountingTaxSetupRoute } from '@/features/accounting-tax-setup/AccountingTaxSetupRoute';

export default function Page(props: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AccountingTaxSetupRoute {...props} step="chart" />;
}
