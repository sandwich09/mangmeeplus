'use client';

import { useEffect, useState } from 'react';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { fetchPlanTermNotice, type PlanTermNotice } from './plan-term.api';
import {
  PLAN_TERM_CONTACT_EMAIL,
  PLAN_TERM_RENEW_PHONE,
  cardCollapsed,
  planTermView,
  warningBucket,
  warningProgressPercent,
} from './plan-term.logic';

const storageKey = (companyId: string) => `watchdog.planTermCard.${companyId}`;

/**
 * P29 warning as a collapsible card at the bottom of the sidebar (Owner 2026-08-31 — replaces the
 * full-width banner so pages stay clean). Package managers see the warning; the expired state is handled by
 * the renewal-page redirect, not here. Collapse is remembered per ladder step: the card re-opens on
 * its own when the 3-day and 1-day windows begin.
 */
export function PlanTermSidebarCard({ companyId }: { companyId: string }) {
  const [loaded, setLoaded] = useState<{ companyId: string; notice: PlanTermNotice | null } | null>(null);
  const notice = loaded?.companyId === companyId ? loaded.notice : null;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then((result) => {
      if (!active) return;
      setLoaded({ companyId, notice: result });
      if (result && planTermView(result) === 'warning-banner') {
        try {
          setCollapsed(cardCollapsed(window.localStorage.getItem(storageKey(companyId)), warningBucket(result.daysLeft)));
        } catch {
          setCollapsed(false);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  if (!notice || planTermView(notice) !== 'warning-banner') return null;

  const bucket = warningBucket(notice.daysLeft);
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) window.localStorage.setItem(storageKey(companyId), bucket);
        else window.localStorage.removeItem(storageKey(companyId));
      } catch {
        // Storage can be unavailable (private mode); the card still toggles for this visit.
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        data-plan-term="warning-collapsed"
        className="mt-4 flex w-full items-center gap-2 rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-left text-[13px] font-bold text-warning-700"
        aria-expanded={false}
      >
        <span aria-hidden>⏳</span>
        <span>เหลืออีก {notice.daysLeft} วัน</span>
        <span className="ml-auto text-warning-500" aria-hidden>⌄</span>
      </button>
    );
  }

  return (
    <div data-plan-term="warning" className="mt-4 rounded-2xl border border-warning-100 bg-warning-50 p-3.5">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 text-left" aria-expanded>
        <span aria-hidden>⏳</span>
        <span className="text-[13.5px] font-extrabold text-warning-700">แพ็กเกจใกล้หมดอายุ</span>
        <span className="ml-auto text-warning-500" aria-hidden>⌃</span>
      </button>
      <p className="mt-2 text-[12.5px] leading-6 text-warning-600">
        หมดอายุ {formatThaiDate(notice.termEndsAt)}
        <br />
        <span className="font-bold">เหลืออีก {notice.daysLeft} วัน</span>
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-warning-100">
        <div className="h-1.5 rounded-full bg-warning-400" style={{ width: `${warningProgressPercent(notice.daysLeft)}%` }} />
      </div>
      <a
        href={`tel:${PLAN_TERM_RENEW_PHONE.replace(/-/g, '')}`}
        className="mt-2.5 block rounded-lg bg-brand-700 px-2 py-2 text-center text-[12.5px] font-bold text-white"
      >
        ติดต่อ {PLAN_TERM_RENEW_PHONE}
      </a>
      <a
        href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}
        className="mt-1.5 block text-center text-[12px] text-warning-700 underline"
      >
        อีเมล {PLAN_TERM_CONTACT_EMAIL}
      </a>
    </div>
  );
}
