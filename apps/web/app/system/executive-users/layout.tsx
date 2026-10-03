import type { ReactNode } from 'react';
import { fetchServerSession } from '@/common/auth/server-session';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ForbiddenState } from '@/common/components/state';

export default async function ExecutiveUsersLayout({ children }: { children: ReactNode }) {
  const session = await fetchServerSession();
  if (!session?.permissions.includes('system.executive_user.manage')) {
    return <ForbiddenState description={apiErrorMessage({ code: 'EXECUTIVE_ACCESS_DENIED' })} />;
  }
  return children;
}
