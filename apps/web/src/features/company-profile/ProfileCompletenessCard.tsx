'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  checklistIsComplete,
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

  return (
    <section
      aria-labelledby="profile-completeness-title"
      className="mt-5 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <details>
        <summary id="profile-completeness-title" className="min-h-11 cursor-pointer py-2 text-base font-semibold text-gray-700">ข้อมูลร้านยังไม่ครบ · เพิ่มภายหลังได้</summary>
        <p className="mt-1 text-base text-gray-600">ใช้งานได้ตามปกติ เพิ่มข้อมูลเพื่อออกเอกสารและช่วยกู้บัญชี</p>
        <ul className="mt-2 grid gap-1">
          {incompleteItems.map((item) => (
            <li key={item.key}><Link href={companyProfileHref(companyId, item.hash)} className="inline-flex min-h-11 items-center text-base text-brand-700 underline underline-offset-4">{item.label}</Link></li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href={companyProfileHref(companyId, incompleteItems[0]!.hash)} className="mangmee-btn mangmee-btn-secondary !min-h-11 !text-base">กรอกข้อมูลให้ครบ</Link>
          <button type="button" onClick={dismiss} className="min-h-11 px-3 text-base text-gray-600 underline">ไว้ก่อน</button>
        </div>
      </details>
    </section>
  );
}
