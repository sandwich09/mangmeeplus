import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { AccountMergePreviewDto } from '@watchdog-bms/contracts';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
import { ACCOUNT_MERGE_COOKIE, decodeAccountMergeCookie } from '@/features/auth/account-merge-bff.logic';

// Spec §4F: tells the merge dialog whether a live offer exists and, if so, which account it would
// merge into. The ticket itself is never in the answer — it stays in the HttpOnly cookie and is
// only ever presented to the API by this server.
//
// Review R05: it also carries the PLAN — which shops move, which block the merge, and which way of
// signing in survives — because a person cannot consent to a merge whose effect they cannot see.
export async function GET(request: NextRequest) {
  const merge = decodeAccountMergeCookie(request.cookies.get(ACCOUNT_MERGE_COOKIE)?.value);
  // 200 either way: "no offer right now" is an answer, not an error, and the dialog renders a
  // different helper line for it rather than a failure state.
  if (!merge) return NextResponse.json({ ready: false }, { headers: { 'Cache-Control': 'no-store' } });

  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  let preview: AccountMergePreviewDto | undefined;
  if (accessToken) {
    try {
      const res = await fetch(`${internalApiV1Base()}/auth/account-merge/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...forwardedClientHeaders(request.headers),
        },
        body: JSON.stringify({ ticket: merge.ticket }),
        cache: 'no-store',
      });
      if (res.ok) preview = (await res.json()) as AccountMergePreviewDto;
    } catch {
      // The offer itself is still real; the dialog falls back to its generic sentence rather than
      // refusing to open because a preview could not be fetched.
      preview = undefined;
    }
  }

  return NextResponse.json(
    { ready: true, existingAccount: merge.existingAccount, ...(preview ? { preview } : {}) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
