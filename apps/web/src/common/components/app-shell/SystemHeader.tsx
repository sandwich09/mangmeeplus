'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutCurrentSession } from '@/common/auth/session';
import { AlertModal } from '@/common/components/modal';

const SECTIONS = [
  { href: '/system/platform-access', label: 'เปิด–ปิดระบบ' },
  { href: '/system/partners', label: 'พาร์ทเนอร์' },
  { href: '/system/company-onboardings/new', label: 'เปิดบริษัทใหม่' },
  { href: '/system/data-rights', label: 'สิทธิข้อมูล' },
  // Audit H-14: the shared LINE credential screen is hidden until it can actually rotate a
  // credential. Saving there writes the database, but the webhook verifies signatures with the
  // channel secret from AWS/env, so a successful save changed nothing — a screen that reports
  // success without doing the work is worse than one that is absent. Rotation stays where it
  // already works: update the secret and redeploy. See SharedLineSettingsPage for the two changes
  // that have to land before this comes back.
  // { href: '/system/line-settings', label: 'LINE' },
  { href: '/system/ai-budget', label: 'AI Budget' },
];

const SystemHeader: React.FC = () => {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const pathname = usePathname();

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      // Themed dialog instead of window.alert(): the browser alert ignored the app theme.
      setSignOutFailed(true);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex w-full flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Link href="/system/partners" className="mr-1 text-sm font-semibold text-gray-900">
          WatchDog System Admin
        </Link>
        <nav aria-label="ส่วนงานผู้ดูแลระบบ" className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap md:max-w-none md:overflow-x-visible md:whitespace-normal">
          {SECTIONS.map((section) => {
            const active = pathname.startsWith(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {signingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
      </button>
      <AlertModal
        open={signOutFailed}
        title="ออกจากระบบ"
        message="ออกจากระบบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง"
        onClose={() => setSignOutFailed(false)}
      />
    </header>
  );
};

export default SystemHeader;
