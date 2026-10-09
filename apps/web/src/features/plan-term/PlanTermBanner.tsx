'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { PlanTermNotice } from './plan-term.api';
import { PLAN_LOCK_COPY, PLAN_LOCK_CTA, isLockedShellPath, planLockReason, planTermView } from './plan-term.logic';

export type BannerPlace = 'billing' | 'elsewhere';

/**
 * Where the banner is drawn, as far as its button and its sentence go. Every page of the shop's billing area — the package page, the return page, the invoice pages — owns the next step: the package
 * page leads to the chooser or to a payment that is open (the first and biggest green control of the screen was "เลือกแพ็กเกจ", above "ชำระเงินต่อ"), the return page waits for the payment or offers
 * its own choices. None of them shows the button; every other page does. `usePathname` has no query, but a trailing slash or a query that slipped in must not bring the button back.
 */
export function bannerPlace(pathname: string, companyId: string): BannerPlace {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/$/, ''), base = `/companies/${encodeURIComponent(companyId)}/billing`;
  return path === base || path.startsWith(`${base}/`) ? 'billing' : 'elsewhere';
}

/**
 * The banner's sentence is "<what is the matter> · <what to do>". On every billing page the page below says what to do — or is showing a payment that is open or awaited, where "choose a package"
 * would invite a second one — so there the banner keeps only what is the matter. Every other page keeps the whole sentence.
 */
export const bannerSentence = (banner: string, place: BannerPlace): string => place === 'billing' ? banner.split(' · ')[0]! : banner;

/**
 * The company-wide term state (P29) at the top of the shell. An ended term routes to the renewal
 * page from anywhere the locked shop may not go; on the pages it may (spec §12) it states why the
 * shop is locked and offers the one move that fixes it. The WARNING copy lives in the sidebar
 * (`PlanTermSidebarCard`) per the Owner's 2026-08-31 decision, so nothing renders for it here.
 *
 * The notice is a prop: the shell reads it once for the whole layout, and this component and the
 * locked sidebar must never disagree about the same company.
 */
export function PlanTermBanner({ companyId, notice }: { companyId: string; notice: PlanTermNotice | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  const view = planTermView(notice, isLockedShellPath(pathname, companyId));

  useEffect(() => {
    if (view === 'renewal-page') router.replace(`/companies/${companyId}/renew`);
  }, [view, companyId, router]);

  if (notice?.derivedState !== 'EXPIRED') return null;

  const copy = PLAN_LOCK_COPY[planLockReason(notice)];
  const canManagePlan = notice.canManagePlan ?? notice.isOwner;
  // Back from Stripe the return page owns the next step — it waits for the payment, or offers its own choices — and the package page is where this button leads: a second "เลือกแพ็กเกจ" above
  // either would invite paying twice (see `bannerPlace`, which covers every page of the billing area).
  const place = bannerPlace(pathname, companyId);

  return (
    <div role="status" className="border-b border-warning-100 bg-warning-50 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Someone with no button under the hint is told who can act instead (review 2026-09-29). */}
        <p className="text-[14px] font-bold leading-6 text-warning-700">{canManagePlan ? bannerSentence(copy.banner, place) : copy.staff}</p>
        {canManagePlan && place === 'elsewhere' && (
          <Link className="mangmee-btn mangmee-btn-primary w-full sm:w-auto" href={`/companies/${companyId}/billing`}>
            {PLAN_LOCK_CTA}
          </Link>
        )}
      </div>
    </div>
  );
}
