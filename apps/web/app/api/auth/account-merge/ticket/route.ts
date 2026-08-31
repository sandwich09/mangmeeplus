import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCOUNT_MERGE_COOKIE, decodeAccountMergeCookie } from '@/features/auth/account-merge-bff.logic';

// Spec §4F: tells the merge dialog whether a live offer exists and, if so, which account it would
// merge into. The ticket itself is never in the answer — it stays in the HttpOnly cookie and is
// only ever presented to the API by POST /api/auth/account-merge on this server.
export async function GET(request: NextRequest) {
  const merge = decodeAccountMergeCookie(request.cookies.get(ACCOUNT_MERGE_COOKIE)?.value);
  // 200 either way: "no offer right now" is an answer, not an error, and the dialog renders a
  // different helper line for it rather than a failure state.
  return NextResponse.json(
    merge ? { ready: true, existingAccount: merge.existingAccount } : { ready: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
