'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAccountProfile, getCompanyIdentity } from './company-profile.api';
import { checklistIsComplete, companyProfileHref, profileChecklist, type ChecklistItem } from './company-profile.logic';

/**
 * "What is still missing" for the owner of a shop opened from LINE (spec §15.4). Never blocks
 * anything and never nags: it renders nothing until both reads land, nothing when the list is
 * complete, and nothing when either read fails — a dashboard is not the place to learn that a
 * settings API is down.
 *
 * Derived from `GET …/identity` and `GET /auth/account/security`, which the profile page already
 * calls, so there is no third endpoint that could disagree with the page this links to.
 */
export function ProfileCompletenessCard({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getCompanyIdentity(companyId), getAccountProfile()])
      .then(([identity, account]) => {
        if (cancelled) return;
        setItems(profileChecklist({
          readiness: identity.readiness,
          emailVerified: account.emailVerified,
          hasPassword: account.hasPassword,
        }));
      })
      .catch(() => { if (!cancelled) setItems(null); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!items || checklistIsComplete(items)) return null;

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
    </section>
  );
}
