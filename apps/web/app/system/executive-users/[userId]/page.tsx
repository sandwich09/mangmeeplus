import ExecutiveUserPage from '@/features/executive-users/ExecutiveUserPage';
export default async function ExecutiveUserRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <ExecutiveUserPage key={userId} userId={userId} />;
}
