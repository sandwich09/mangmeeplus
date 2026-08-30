import SignupStatusPage from '@/features/external-signup/SignupStatusPage';

export default async function SignupStatusRoute({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <SignupStatusPage requestId={requestId} />;
}
