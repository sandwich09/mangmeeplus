import { redirect } from 'next/navigation';
import LineQrApprovePage from '@/features/auth/LineQrApprovePage';
import { fetchServerSessionResult } from '@/common/auth/server-session';

export const dynamic = 'force-dynamic';

// P12-3a: the page a scanned desktop QR opens on the phone. Approving is an authenticated act, so
// an anonymous scan is sent through the ordinary login page first — `next` brings it straight back
// here afterwards, whether the user signed in with a password or with LINE.
export default async function LineQrApproveRoute({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await fetchServerSessionResult();
  if (result.status !== 'signed_in') {
    redirect(`/login?line=qr-approve&next=${encodeURIComponent(`/line-qr/${code}`)}`);
  }
  return <LineQrApprovePage code={code} />;
}
