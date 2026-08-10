import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import {
  legalAcceptanceContextCompanyId,
  legalAcceptancePath,
  resolvePostLegalAcceptanceTarget,
} from '@/common/auth/session-gate.logic';
import { sanitizeNextPath } from '@/common/auth/middleware.logic';
import LegalAcceptancePage from '@/features/auth/LegalAcceptancePage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ยืนยันเอกสารการใช้บริการ | MangmeePlus',
  description: 'อ่านและยืนยันข้อกำหนดการใช้งาน ประกาศความเป็นส่วนตัว และอำนาจการใช้งาน MangmeePlus',
};

export default async function LegalAcceptanceRoute({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[]; next?: string | string[] }>;
}) {
  const { companyId, next } = await searchParams;
  const requestedNext = sanitizeNextPath(typeof next === 'string' ? next : null);
  const contextCompanyId = legalAcceptanceContextCompanyId(
    requestedNext,
    typeof companyId === 'string' ? companyId : null,
  );
  const result = await fetchServerSessionResult(contextCompanyId ?? undefined);

  if (result.status === 'signed_out') {
    const gate = legalAcceptancePath(requestedNext, contextCompanyId);
    redirect(`/login?next=${encodeURIComponent(gate)}`);
  }
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (result.status === 'forbidden') {
    throw new Error('This session cannot access the legal acceptance flow. Please sign in again.');
  }

  const returnTo = resolvePostLegalAcceptanceTarget(requestedNext, result.session);
  if (result.session.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent(legalAcceptancePath(returnTo, result.session.companyId))}`);
  }
  if (result.session.legalAcceptanceRequired === false) redirect(returnTo);

  return <LegalAcceptancePage companyId={result.session.companyId} returnTo={returnTo} />;
}
