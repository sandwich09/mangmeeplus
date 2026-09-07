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
      className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-[var(--shadow-theme-sm)]"
    >
      <h2 id="profile-completeness-title" className="text-[15px] font-bold text-amber-900">ยังกรอกไม่ครบอีกนิดเดียวค่ะ</h2>
      <p className="mt-1 text-sm text-amber-800">
        ใช้งานได้ตามปกติอยู่แล้วนะคะ กรอกเพิ่มไว้เผื่อต้องออกเอกสารภาษี และเผื่อ LINE หลุด
      </p>
      <ul className="mt-3 grid gap-2">
        {incompleteItems.map((item) => (
          <li key={item.key}>
            <Link
              href={companyProfileHref(companyId, item.hash)}
              className="inline-flex items-center gap-2 text-sm font-medium text-amber-900 underline decoration-amber-300 underline-offset-4 hover:decoration-amber-600"
            >
              <span aria-hidden="true">•</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <button
          type="button"
          onClick={dismiss}
          className="mangmee-btn mangmee-btn-secondary !min-h-12 w-full !text-base !font-bold"
        >
          ไว้ก่อน
        </button>
        <Link
          href={companyProfileHref(companyId, incompleteItems[0]!.hash)}
          className="mangmee-btn mangmee-btn-primary !min-h-12 w-full !text-base !font-bold"
        >
          กรอกข้อมูลให้ครบ
        </Link>
      </div>
    </section>
  );
}
