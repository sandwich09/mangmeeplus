'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { PlanTermNotice } from './plan-term.api';
import { PLAN_LOCK_COPY, PLAN_LOCK_CTA, isLockedShellPath, planLockReason, planTermView } from './plan-term.logic';

export type BannerPlace = 'billing' | 'renewal' | 'elsewhere';

/**
 * Where the banner is drawn, as far as its button and its sentence go. Every page of the shop's billing area — the package page, the return page, the invoice pages — owns the next step: the package
 * page leads to the chooser or to a payment that is open (the first and biggest green control of the screen was "เลือกแพ็กเกจ", above "ชำระเงินต่อ"), the return page waits for the payment or offers
 * its own choices. None of them shows the button; every other page does. `usePathname` has no query, but a trailing slash or a query that slipped in must not bring the button back.
 * The renewal page is the third place: the card under the banner carries the one button and says who can act, so the banner there keeps only what is the matter (the same sentence and the same
 * green button stood twice on one phone screen).
 */
export function bannerPlace(pathname: string, companyId: string): BannerPlace {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/$/, ''), company = `/companies/${encodeURIComponent(companyId)}`, base = `${company}/billing`;
  if (path === `${company}/renew`) return 'renewal';
  return path === base || path.startsWith(`${base}/`) ? 'billing' : 'elsewhere';
}

/**
 * The banner's sentence is "<what is the matter> · <what to do>". On every billing page the page below says what to do — or is showing a payment that is open or awaited, where "choose a package"
 * would invite a second one — so there the banner keeps only what is the matter. The renewal page says what to do in its own card. Every other page keeps the whole sentence.
 */
export const bannerSentence = (banner: string, place: BannerPlace): string => place === 'elsewhere' ? banner : banner.split(' · ')[0]!;

/**
 * The company-wide term state (P29) at the top of the shell. An ended term routes to the renewal
 * page from anywhere the locked shop may not go; on the pages it may (spec §12) it states why the
 * shop is locked and offers the one move that fixes it. The WARNING copy lives in the sidebar
 * (`PlanTermSidebarCard`) per the Owner's 2026-08-31 decision, so nothing renders for it here.
 *
 * The notice is a prop: the shell reads it once for the whole layout, and this component and the
 * locked sidebar must never disagree about the same company.
 */
export function PlanTermBanner({ companyId, notice, freeExpenseDrafts = false }: { companyId: string; notice: PlanTermNotice | null; freeExpenseDrafts?: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  const freeDraftAccess = freeExpenseDrafts && notice?.freeExpenseDrafts === true;
  const view = planTermView(notice, isLockedShellPath(pathname, companyId), freeDraftAccess);

  useEffect(() => {
    if (view === 'renewal-page') router.replace(`/companies/${companyId}/renew`);
  }, [view, companyId, router]);

  if (notice?.derivedState !== 'EXPIRED' || freeDraftAccess) return null;

  const copy = PLAN_LOCK_COPY[planLockReason(notice)];
  const canManagePlan = notice.canManagePlan ?? notice.isOwner;
  // Back from Stripe the return page owns the next step — it waits for the payment, or offers its own choices — and the package page is where this button leads: a second "เลือกแพ็กเกจ" above
  // either would invite paying twice (see `bannerPlace`, which covers every page of the billing area).
  const place = bannerPlace(pathname, companyId);

  return (
    <div role="status" className="border-b border-warning-100 bg-warning-50 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Someone with no button under the hint is told who can act instead (review 2026-09-29); on the renewal page the card below tells them, once. */}
        <p className="text-[14px] font-bold leading-6 text-warning-700">{canManagePlan || place === 'renewal' ? bannerSentence(copy.banner, place) : copy.staff}</p>
        {canManagePlan && place === 'elsewhere' && (
          <Link className="mangmee-btn mangmee-btn-primary w-full sm:w-auto" href={`/companies/${companyId}/billing`}>
            {PLAN_LOCK_CTA}
          </Link>
        )}
      </div>
    </div>
  );
}
