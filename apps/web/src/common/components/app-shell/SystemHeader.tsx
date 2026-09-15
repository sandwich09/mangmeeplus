'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutCurrentSession } from '@/common/auth/session';
import { AlertModal } from '@/common/components/modal';
import {
  getSupportOpenCount, subscribeSupportOpenCount,
} from '@/features/system-support-requests/support-requests.api';

/** The one section that has to shout. See `useOpenSupportCount` below. */
const SUPPORT_REQUESTS_HREF = '/system/support-requests';

/**
 * line-support-request-spec-th §2.2 delta (Owner 2026-09-05): operators are not LINE-linked, so
 * this badge — not a push — is how anyone learns a customer is waiting.
 *
 * Two sources, deliberately, because navigation is not the only thing that changes the number:
 *  - a fetch on mount and on every navigation, over the cheap `/count` endpoint (the header asks on
 *    every page, and answering that with the 200-row queue read was a page nobody renders);
 *  - a subscription to the inbox page, which publishes every count IT reads — including the one
 *    after "ตอบแล้ว" or "ให้ AI ทำงานต่อ". Without it, answering a request left the badge in the
 *    header directly above still claiming somebody was waiting, because the path had not changed.
 *
 * Quiet about its own failures throughout: a 403 (not every system admin holds
 * `system.partner_company.update`) or an outage leaves `null`, which renders no badge at all
 * rather than a confident zero.
 */
function useOpenSupportCount(pathname: string, enabled: boolean): number | null {
  const [openCount, setOpenCount] = useState<number | null>(null);
  useEffect(() => enabled ? subscribeSupportOpenCount(setOpenCount) : undefined, [enabled]);
  useEffect(() => {
    if (!enabled) { setOpenCount(null); return; }
    const controller = new AbortController();
    getSupportOpenCount({ signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setOpenCount(result.open); })
      .catch(() => { if (!controller.signal.aborted) setOpenCount(null); });
    return () => controller.abort();
  }, [pathname, enabled]);
  return openCount;
}

const SECTIONS = [
  { href: '/system/platform-access', label: 'เปิด–ปิดระบบ' },
  { href: '/system/partners', label: 'พาร์ทเนอร์' },
  { href: '/system/signup-requests', label: 'คำขอสมัครใช้งาน' },
  { href: '/system/email-delivery', label: 'สถานะอีเมล' },
  { href: SUPPORT_REQUESTS_HREF, label: 'คำขอคุยกับเจ้าหน้าที่' },
  // ค้นหาผู้ใช้ is a section on the partners page, not a tab — /system/users redirects there.
  { href: '/system/company-onboardings/new', label: 'เปิดบริษัทใหม่' },
  { href: '/system/data-rights', label: 'สิทธิข้อมูล' },
  { href: '/system/line-settings', label: 'LINE' },
  { href: '/system/ai-budget', label: 'AI Budget' },
  { href: '/system/billing', label: 'การชำระเงิน' },
];

const SystemHeader: React.FC<{ billingOnly?: boolean; billingAllowed?: boolean; emailAllowed?: boolean }> = ({ billingOnly = false, billingAllowed = false, emailAllowed = false }) => {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const pathname = usePathname();
  const openSupportCount = useOpenSupportCount(pathname, !billingOnly);

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
        <Link href={billingOnly ? "/system/billing" : "/system/partners"} className="mr-1 text-sm font-semibold text-gray-900">
          {billingOnly ? 'มั่งมี · ดูแลการชำระเงิน' : 'มั่งมี · ผู้ดูแลระบบ'}
        </Link>
        <nav aria-label="ส่วนงานผู้ดูแลระบบ" className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap md:max-w-none md:overflow-x-visible md:whitespace-normal">
          {SECTIONS.filter(section => billingOnly ? section.href === '/system/billing' :
            (section.href !== '/system/billing' || billingAllowed) && (section.href !== '/system/email-delivery' || emailAllowed)).map((section) => {
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
                {section.href === SUPPORT_REQUESTS_HREF && openSupportCount !== null && openSupportCount > 0 && (
                  <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                    {openSupportCount > 99 ? '99+' : openSupportCount}
                  </span>
                )}
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
