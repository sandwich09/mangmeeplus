import type { ReactNode } from 'react';
import { fetchServerSession } from '@/common/auth/server-session';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ForbiddenState } from '@/common/components/state';

// `/system` hands each page the bare column, so this subtree brings its own container (as /system/sales-team does).
export default async function ExecutiveUsersLayout({ children }: { children: ReactNode }) {
  const session = await fetchServerSession();
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
    {session?.permissions.includes('system.executive_user.manage') ? children : <ForbiddenState description={apiErrorMessage({ code: 'EXECUTIVE_ACCESS_DENIED' })} />}
  </main>;
}
