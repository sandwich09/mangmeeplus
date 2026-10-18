'use client';

import type React from 'react';
import Link from 'next/link';
import { DollarLineIcon } from '@/common/icons';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { secondaryButtonClass } from '@/common/components/button/button-classes';
import { MangmeeCard, MangmeeIconFrame } from '@/common/components/mangmee';
import { useLockedShell } from '@/features/plan-term/LockedShellScope';
import { LOCKED_ACCOUNT_CARD, filterSettingsMenuItems, showsLockedAccountCard } from './settings-menu.logic';

/**
 * One card of the hub: the name of the place, one plain line, and an arrow that says it opens. No picture: a padlock
 * on the shop's details and a "$" on a receipt setting named nothing.
 */
function SettingsCard({ href, title, desc, badge }: { href: string; title: string; desc: string; badge?: React.ReactNode }) {
  return (
    <Link href={href} className="group block">
      <MangmeeCard className="flex h-full items-center justify-between gap-3 p-4 transition-colors group-hover:border-brand-200 group-hover:bg-brand-25">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-gray-900">{title}</span>
            {/* Its own wrapper: the badge is made by the server page, and React asks for a key when such an element
                sits directly in a list of siblings ("unique key" warning seen on this page). */}
            {badge && <span className="inline-flex">{badge}</span>}
          </span>
          <span className="mt-1 block text-sm leading-6 text-gray-600">{desc}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-xl text-gray-400">›</span>
      </MangmeeCard>
    </Link>
  );
}

/**
 * The settings hub cards. A client island only so the one thing the server page cannot know —
 * whether this shop is inside the locked shell (spec §12) — reaches the same filter the sidebar
 * uses, without a second plan-term read. `profileBadge` stays the caller's, so the permission that
 * decides who pays for the checklist read is still declared on the page itself.
 */
export function SettingsMenu({ companyId, permissions, profileBadge }: {
  companyId: string;
  permissions: readonly string[];
  profileBadge?: React.ReactNode;
}) {
  const locked = useLockedShell();
  const items = filterSettingsMenuItems(permissions, locked);
  const primary = items.find((item) => item.section === 'primary');
  const advanced = items.filter((item) => item.section === 'advanced');
  const general = items.filter((item) => !item.section);

  return (
    <>
      {primary && (
        <Link href={`/companies/${companyId}${primary.href}`} className="group mb-6 block">
          <MangmeeCard className="border-brand-200 bg-brand-25 p-6 transition-colors group-hover:bg-brand-50">
            <div className="flex items-start gap-4">
              <MangmeeIconFrame tone={primary.tone}><DollarLineIcon /></MangmeeIconFrame>
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-gray-900">{primary.title}</div>
                <div className="mt-1 text-sm leading-6 text-gray-600">{primary.desc}</div>
                <div className="mt-3 text-sm font-bold text-brand-700">เริ่มตั้งค่าหรือทำต่อ →</div>
              </div>
            </div>
          </MangmeeCard>
        </Link>
      )}

      {/* Staff in the locked shell: no company card is theirs to open, so ตั้งค่า would be an empty
          page. These two account pages live outside the company and keep working while it is locked. */}
      {showsLockedAccountCard(permissions, locked) && (
        <MangmeeCard className="mb-4 p-4">
          <div className="text-base font-bold text-gray-900">{LOCKED_ACCOUNT_CARD.title}</div>
          <div className="mt-1 text-sm leading-6 text-gray-600">{LOCKED_ACCOUNT_CARD.desc}</div>
          <ActionGroup align="start" className="mt-3">
            {/* The account-email page sends its back link to this shop's settings only when it knows the shop. */}
            {LOCKED_ACCOUNT_CARD.links.map((link) => (
              <Link key={link.key} href={link.key === 'email' ? `${link.href}?company=${encodeURIComponent(companyId)}` : link.href}
                className={secondaryButtonClass}>
                {link.label}
              </Link>
            ))}
          </ActionGroup>
        </MangmeeCard>
      )}

      {general.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {general.map((item) => (
            <SettingsCard key={item.key} href={`/companies/${companyId}${item.href}${item.hash ?? ''}`} title={item.title} desc={item.desc}
              badge={item.key === 'company-profile' ? profileBadge : undefined} />
          ))}
        </div>
      )}

      {advanced.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-extrabold text-gray-700">การตั้งค่าขั้นสูง</h2>
          <MangmeeCard className="divide-y divide-gray-100 overflow-hidden">
            {advanced.map((item) => (
              <Link key={item.key} href={`/companies/${companyId}${item.href}`} className="flex items-center justify-between gap-4 p-4 text-sm hover:bg-gray-50">
                <span>
                  <strong className="text-gray-900">{item.title}</strong>
                  <span className="mt-1 block text-xs text-gray-500">{item.desc}</span>
                </span>
                <span aria-hidden="true" className="text-gray-400">→</span>
              </Link>
            ))}
          </MangmeeCard>
        </section>
      )}
    </>
  );
}
