'use client';

import type { PlanTermDerivedState } from '@watchdog-bms/contracts';

/** What `GET /v1/plan-term/notice` answers; `null` = this company has no term row (P29 §4). */
export type PlanTermNotice = {
  derivedState: PlanTermDerivedState;
  termEndsAt: string;
  daysLeft: number;
  /** Only the OWNER sees term detail; staff get the neutral line instead (P29 §5). */
  isOwner: boolean;
};

/**
 * Deliberately not `authedApiFetch`: a banner is decoration, and that helper bounces the browser to
 * /login on a hard 401. Every failure here simply means "no notice to show".
 */
export async function fetchPlanTermNotice(companyId?: string): Promise<PlanTermNotice | null> {
  try {
    const response = await fetch('/api/v1/plan-term/notice', {
      credentials: 'include',
      cache: 'no-store',
      headers: companyId ? { 'X-Company-Id': companyId } : undefined,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as PlanTermNotice | null;
    return body && typeof body.derivedState === 'string' ? body : null;
  } catch {
    return null;
  }
}
