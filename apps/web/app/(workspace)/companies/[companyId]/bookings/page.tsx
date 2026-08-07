import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';
import { BookingsPrototypePage } from '@/features/crm/BookingsPrototypePage';

export default async function BookingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/bookings`)}`);
  return <BookingsPrototypePage companyId={companyId} permissions={session.permissions} />;
}
