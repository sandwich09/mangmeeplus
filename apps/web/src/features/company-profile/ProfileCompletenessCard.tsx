'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAccountProfile, getCompanyIdentity } from './company-profile.api';
import {
  checklistIsComplete,
  companyProfileHref,
  dismissChecklistFor,
  profileChecklist,
  readChecklistCache,
  readChecklistDismissal,
  writeChecklistCache,
  type ChecklistItem,
} from './company-profile.logic';

/**
 * "What is still missing" for the owner of a shop opened from LINE (spec §15.4). Never blocks
 * anything and never nags: it renders nothing until it has an answer, nothing when the list is
 * complete, nothing when either read fails — a dashboard is not the place to learn that a
 * settings API is down — and nothing for a week after "ไว้ก่อน".
 *
 * The 10-minute answer cache lives in `sessionStorage` (a per-tab convenience — the email item
 * cannot complete while SES is sandboxed, so without it the card fires two GETs on every dashboard
 * mount forever). The 7-day "ไว้ก่อน" lives in `localStorage`, because an answer that dies with the
 * tab is not an answer.
 */
export function ProfileCompletenessCard({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const storage = typeof window === 'undefined' ? undefined : window.sessionStorage;
    if (readChecklistDismissal(typeof window === 'undefined' ? undefined : window.localStorage, companyId)) {
      setHidden(true);
      return;
    }

    const cached = readChecklistCache(storage, companyId);
    if (cached === 'hidden') { setHidden(true); return; }
    if (cached) { setItems(cached); return; }

    void Promise.all([getCompanyIdentity(companyId), getAccountProfile()])
      .then(([identity, account]) => {
        if (cancelled) return;
        const next = profileChecklist({
          readiness: identity.readiness,
          emailVerified: account.emailVerified,
          hasPassword: account.hasPassword,
        });
        writeChecklistCache(storage, companyId, next);
        setItems(next);
      })
      .catch(() => { if (!cancelled) setItems(null); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (hidden || !items || checklistIsComplete(items)) return null;

  const dismiss = () => {
    dismissChecklistFor(typeof window === 'undefined' ? undefined : window.localStorage, companyId);
    setHidden(true);
  };

  return (
    <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-[var(--shadow-theme-sm)]">
      <h2 className="text-[15px] font-bold text-amber-900">ยังกรอกไม่ครบอีกนิดเดียวค่ะ</h2>
      <p className="mt-1 text-sm text-amber-800">
        ใช้งานได้ตามปกติอยู่แล้วนะคะ กรอกเพิ่มไว้เผื่อต้องออกเอกสารภาษี และเผื่อ LINE หลุด
      </p>
      <ul className="mt-3 grid gap-2">
        {items.filter((item) => !item.done).map((item) => (
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
      <button
        type="button"
        onClick={dismiss}
        className="mt-4 text-sm font-medium text-amber-800 underline underline-offset-4 hover:text-amber-900"
      >
        ไว้ก่อน
      </button>
    </section>
  );
}
