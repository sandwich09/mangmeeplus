import { CompanyDashboardPage } from '@/features/dashboard-notifications/DashboardPages';

type Props = {
  companyId: string;
  permissions: string[];
  displayName: string | null;
};

export function WorkspaceDashboardPage({ companyId, permissions, displayName }: Props) {
  return <CompanyDashboardPage companyId={companyId} permissions={permissions} displayName={displayName} />;
}
