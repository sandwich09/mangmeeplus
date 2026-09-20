'use client';

import type React from 'react';
import Link from 'next/link';
import { GroupIcon, LockIcon, BellIcon, BoxIcon, DollarLineIcon } from '@/common/icons';
import { MangmeeCard, MangmeeIconFrame } from '@/common/components/mangmee';
import { useLockedShell } from '@/features/plan-term/LockedShellScope';
import { LOCKED_ACCOUNT_CARD, filterSettingsMenuItems, showsLockedAccountCard } from './settings-menu.logic';

const SETTINGS_MENU_ICONS = { BellIcon, BoxIcon, LockIcon, GroupIcon, DollarLineIcon };

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
  const PrimaryIcon = primary ? SETTINGS_MENU_ICONS[primary.iconKey] : null;

  return (
    <>
      {primary && PrimaryIcon && (
        <Link href={`/companies/${companyId}${primary.href}`} className="group mb-6 block">
          <MangmeeCard className="border-brand-200 bg-brand-25 p-6 transition-colors group-hover:bg-brand-50">
            <div className="flex items-start gap-4">
              <MangmeeIconFrame tone={primary.tone}><PrimaryIcon /></MangmeeIconFrame>
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
        <MangmeeCard className="p-4">
          <div className="flex items-start gap-3">
            <MangmeeIconFrame tone="brand"><LockIcon /></MangmeeIconFrame>
            <div className="min-w-0">
              <div className="font-bold text-gray-900">{LOCKED_ACCOUNT_CARD.title}</div>
              <div className="mt-1 text-sm leading-6 text-gray-500">{LOCKED_ACCOUNT_CARD.desc}</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {LOCKED_ACCOUNT_CARD.links.map((link) => (
                  <Link key={link.key} href={link.href} className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </MangmeeCard>
      )}

      {general.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {general.map((item) => {
            const Icon = SETTINGS_MENU_ICONS[item.iconKey];
            return (
              <Link key={item.key} href={`/companies/${companyId}${item.href}`} className="group block">
                <MangmeeCard className="h-full p-4 transition-colors group-hover:border-brand-200 group-hover:bg-brand-25">
                  <div className="flex items-start gap-3">
                    <MangmeeIconFrame tone={item.tone}><Icon /></MangmeeIconFrame>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-gray-900">{item.title}</span>
                        {item.key === 'company-profile' && profileBadge}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-gray-500">{item.desc}</div>
                    </div>
                  </div>
                </MangmeeCard>
              </Link>
            );
          })}
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
