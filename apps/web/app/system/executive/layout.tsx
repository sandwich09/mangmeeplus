import type { ReactNode } from 'react';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import { isSystemAdmin } from '@/common/auth/session-gate.logic';
import { ExecutiveReportProvider } from '@/features/executive-reports/ExecutiveReportPage';
import { apiErrorMessage } from '@/common/api/api-error-message';

export default async function ExecutiveReportLayout({ children }: { children: ReactNode }) {
  const session = await fetchServerSession();
  if (!session?.permissions.includes('system.executive.read')) return <ForbiddenState title={apiErrorMessage({ code: 'EXECUTIVE_ACCESS_DENIED' })} description="" helpText="" />;
  return <ExecutiveReportProvider admin={isSystemAdmin(session)}>{children}</ExecutiveReportProvider>;
}
