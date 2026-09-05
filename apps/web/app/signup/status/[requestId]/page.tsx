import SignupStatusPage from '@/features/external-signup/SignupStatusPage';

// Same as every other public signup route (PR #385): a prerendered page loses the CSP nonce and
// arrives dead. This one is dynamic by virtue of its param today, which is not a guarantee.
export const dynamic = 'force-dynamic';

export default async function SignupStatusRoute({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <SignupStatusPage requestId={requestId} />;
}
