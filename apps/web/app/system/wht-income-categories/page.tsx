import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import WhtIncomeCategoriesPage from '@/features/system-wht-income-categories/WhtIncomeCategoriesPage';
import { W } from '@/features/system-wht-income-categories/wht-income-categories.words';

export default async function SystemWhtIncomeCategoriesRoute() {
  const session = await fetchServerSession();
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
    {session?.permissions.includes('system.wht_income_category.manage') ? <WhtIncomeCategoriesPage /> : <ForbiddenState helpText={W.accessHelp} />}
  </main>;
}
