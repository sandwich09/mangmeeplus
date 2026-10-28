'use client';

import type { PlanTermDerivedState } from '@watchdog-bms/contracts';

/**
 * Sales/locked-signup spec R2: WHY the shop is locked. A shop that never had a package must never
 * read "ครบกำหนด" — it had nothing to run out. Declared here rather than imported so the web keeps
 * compiling before and after the API ships the field; absent means `trial_ended` (P29 behaviour).
 */
export type PlanLockReason = 'trial_ended' | 'no_package';

/** What `GET /v1/plan-term/notice` answers; `null` = this company has no term row (P29 §4). */
export type PlanTermNotice = {
  derivedState: PlanTermDerivedState;
  termEndsAt: string;
  daysLeft: number;
  /** Only the actual OWNER is the legal/account owner. */
  isOwner: boolean;
  /** This membership may manage package renewal through company.plan.manage. */
  canManagePlan?: boolean;
  /** Server-verified source-only expense draft access; absent is false. */
  freeExpenseDrafts?: boolean;
  /** Present only while EXPIRED. */
  lockReason?: PlanLockReason;
};

export class PlanTermNoticeError extends Error {
  constructor(public readonly status: number) { super(`Plan term notice unavailable (${status})`); }
}

/** Recovery pages must distinguish no term from auth/server/network failures. */
export async function readPlanTermNotice(companyId?: string): Promise<PlanTermNotice | null> {
  const response = await fetch('/api/v1/plan-term/notice', {
    credentials: 'include', cache: 'no-store',
    headers: companyId ? { 'X-Company-Id': companyId } : undefined,
  });
  if (!response.ok) throw new PlanTermNoticeError(response.status);
  const body = await response.json();
  if (body === null) return null;
  if (!['ACTIVE', 'WARNING', 'EXPIRED'].includes(body?.derivedState) ||
      typeof body.isOwner !== 'boolean' || typeof body.termEndsAt !== 'string' ||
      (body.canManagePlan !== undefined && typeof body.canManagePlan !== 'boolean') ||
      (body.freeExpenseDrafts !== undefined && typeof body.freeExpenseDrafts !== 'boolean')) {
    throw new PlanTermNoticeError(502);
  }
  return body as PlanTermNotice;
}

/**
 * Deliberately not `authedApiFetch`: a banner is decoration, and that helper bounces the browser to
 * /login on a hard 401. Every failure here simply means "no notice to show".
 */
export async function fetchPlanTermNotice(companyId?: string): Promise<PlanTermNotice | null> {
  try {
    return await readPlanTermNotice(companyId);
  } catch {
    return null;
  }
}

export const PLAN_TERM_CHANGED_EVENT = 'watchdog:plan-term-changed';

/** RV30: BillingPage fires this the moment a purchase is confirmed inside the locked shell. */
export function notifyPlanTermChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_TERM_CHANGED_EVENT));
}
