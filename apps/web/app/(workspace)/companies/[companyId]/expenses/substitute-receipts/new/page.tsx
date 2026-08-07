import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptWizardPage } from '@/features/expenses/SubstituteReceiptWizardPage';

export default async function NewSubstituteReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ expenseId?: string }>;
}) {
  const { companyId } = await params;
  const { expenseId } = await searchParams;
  const session = await fetchServerSession(companyId);
  return (
    <SubstituteReceiptWizardPage
      companyId={companyId}
      initialExpenseId={expenseId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      isOwner={session?.roles.includes('OWNER') ?? false}
    />
  );
}
