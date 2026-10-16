'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { quietButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import {
  checklistIsComplete,
  COMPANY_PROFILE_ACCOUNT_HASH,
  companyProfileHref,
  dismissChecklistFor,
  readChecklistDismissal,
} from './company-profile.logic';
import { useProfileChecklist } from './use-profile-checklist';

/**
 * "What is still missing" for the owner of a shop opened from LINE (spec §15.4). Never blocks
 * anything and never nags: it renders nothing until it has an answer, nothing when the list is
 * complete, nothing when either read fails — a dashboard is not the place to learn that a
 * settings API is down — and nothing for a week after "ไว้ก่อน".
 *
 * The read and its 10-minute answer cache live in `useProfileChecklist`, shared with the sidebar
 * and settings-hub indicators. The 7-day "ไว้ก่อน" is this card's alone and lives in
 * `localStorage`, because an answer that dies with the tab is not an answer — and because
 * snoozing the card must not switch the indicators off (§15.4.1 E).
 */
export function ProfileCompletenessCard({ companyId }: { companyId: string }) {
  // In an effect, not a lazy initial state: this component is server-rendered, where there is no
  // localStorage, so seeding from it during render is a hydration mismatch.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(readChecklistDismissal(typeof window === 'undefined' ? undefined : window.localStorage, companyId));
  }, [companyId]);
  const items = useProfileChecklist(companyId);

  if (dismissed || !items || checklistIsComplete(items)) return null;
  const incompleteItems = items.filter((item) => !item.done);

  const dismiss = () => {
    dismissChecklistFor(typeof window === 'undefined' ? undefined : window.localStorage, companyId);
    setDismissed(true);
  };

  // One row: what is missing, said in words, and the one place that fixes it (thai-ux-standard §2.6, §3.6). It used to
  // be a closed arrow hiding three links and a button that all opened the same page.
  const first = incompleteItems[0]!;
  return (
    <section aria-label="ข้อมูลที่ยังไม่ครบ" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mangmee-card mangmee-card-shadow p-4">
      <p className="min-w-0 flex-1 basis-64 text-sm font-medium text-gray-700">ยังไม่ครบ: {incompleteItems.map((item) => item.label).join(' · ')}</p>
      <ActionGroup>
        <button type="button" onClick={dismiss} className={quietButtonClass}>ไว้ก่อน</button>
        <Link href={companyProfileHref(companyId, first.hash)} className={secondaryButtonClass}>{first.hash === COMPANY_PROFILE_ACCOUNT_HASH ? 'ไปที่บัญชีของฉัน' : 'กรอกข้อมูลร้าน'}</Link>
      </ActionGroup>
    </section>
  );
}
