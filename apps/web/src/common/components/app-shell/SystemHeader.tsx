'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { EXECUTIVE_MENU, W, thaiLabel } from '@/features/executive-reports/executive-reports.words';
import { menuHref, EXECUTIVE_ACCESS_DENIED_EVENT } from '@/features/executive-reports/executive-reports.logic';
import { EXECUTIVE_USERS_TITLE } from '@/features/executive-users/executive-users.logic';
import { W as WHT_CATALOG_WORDS } from '@/features/system-wht-income-categories/wht-income-categories.words';
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
  { href: '/system/partners', label: 'บริษัทและผู้ใช้งาน', group: 'ลูกค้า' },
  { href: '/system/billing', label: 'การชำระเงิน', group: 'ลูกค้า' },
  { href: SUPPORT_REQUESTS_HREF, label: 'ขอความช่วยเหลือ', group: 'คำขอและการติดต่อ' },
  { href: '/system/signup-requests', label: 'คำขอสมัครใช้งาน', group: 'คำขอและการติดต่อ' },
  { href: '/system/data-rights', label: 'คำขอเกี่ยวกับข้อมูล', group: 'คำขอและการติดต่อ' },
  { href: '/system/email-delivery', label: 'สถานะอีเมล', group: 'คำขอและการติดต่อ' },
  { href: '/system/executive-users', label: EXECUTIVE_USERS_TITLE, group: 'ตั้งค่าระบบ' },
  { href: '/system/wht-income-categories', label: WHT_CATALOG_WORDS.title, group: 'ตั้งค่าระบบ' },
  { href: '/system/sales-team', label: 'ทีมขาย', group: 'ตั้งค่าระบบ' },
  { href: '/system/home-theme', label: 'ธีมหน้าแรก', group: 'ตั้งค่าระบบ' },
  { href: '/system/line-settings', label: 'ตั้งค่า LINE', group: 'ตั้งค่าระบบ' },
  { href: '/system/ai-budget', label: 'เพดานความปลอดภัยค่า AI', group: 'ตั้งค่าระบบ' },
  { href: '/system/platform-access', label: 'เปิด–ปิดบริการ', group: 'ตั้งค่าระบบ' },
];

const SystemHeader: React.FC<{ billingOnly?: boolean; billingAllowed?: boolean; emailAllowed?: boolean; executiveOnly?: boolean; executiveAllowed?: boolean; executiveUsersAllowed?: boolean; homeThemeAllowed?: boolean; whtCategoriesAllowed?: boolean; environment?: string }> = ({ billingOnly = false, billingAllowed = false, emailAllowed = false, executiveOnly = false, executiveAllowed = false, executiveUsersAllowed = false, whtCategoriesAllowed = false, homeThemeAllowed = false, environment }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [canReadReports, setCanReadReports] = useState(executiveAllowed);
  useEffect(() => setCanReadReports(executiveAllowed), [executiveAllowed]);
  useEffect(() => {
    const denied = () => setCanReadReports(false);
    window.addEventListener(EXECUTIVE_ACCESS_DENIED_EVENT, denied);
    return () => window.removeEventListener(EXECUTIVE_ACCESS_DENIED_EVENT, denied);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);
  // Report pages only (product words in Thai there); /system/executive-users is an admin page.
  const onReport = pathname === '/system/executive' || pathname.startsWith('/system/executive/');
  const openSupportCount = useOpenSupportCount(pathname, !billingOnly && !executiveOnly);
  const adminSections = executiveOnly ? [] : SECTIONS.filter(section => billingOnly ? section.href === '/system/billing' && billingAllowed :
    (section.href !== '/system/home-theme' || homeThemeAllowed) && (section.href !== '/system/billing' || billingAllowed) && (section.href !== '/system/email-delivery' || emailAllowed) && (section.href !== '/system/executive-users' || executiveUsersAllowed) && (section.href !== '/system/wht-income-categories' || whtCategoriesAllowed));
  const reportSections = canReadReports ? EXECUTIVE_MENU.map(section => ({ ...section, href: menuHref(section.key, new URLSearchParams(searchParams.toString())) })) : [];
  const sections = onReport ? [...reportSections, ...adminSections] : [...adminSections, ...reportSections];
  const groups = [...new Set(sections.map(section => section.group))];

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      setSignOutFailed(true);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls="system-navigation" onClick={() => setMenuOpen(value => !value)} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 lg:hidden">
            {menuOpen ? 'ปิดเมนู' : 'เมนู'}{openSupportCount ? ` (${openSupportCount})` : ''}
          </button>
          <Link href={executiveOnly ? '/system/executive' : billingOnly ? '/system/billing' : '/system/partners'} className="text-base font-semibold text-gray-900 lg:text-lg">มั่งมี <span className="font-normal text-gray-500">/ {executiveOnly ? W.executive : 'ผู้ดูแลระบบ'}</span></Link>
          {environment && <span className={`rounded-md border px-2 py-1 text-xs font-medium ${environment === 'ระบบจริง' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{onReport ? thaiLabel(environment) : environment}</span>}
        </div>
        <button type="button" onClick={handleSignOut} disabled={signingOut} aria-busy={signingOut} className="min-h-11 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {signingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
        </button>
      </header>
      <aside className={`${menuOpen ? 'block' : 'hidden'} mangmee-safe-bottom border-b border-gray-200 bg-white lg:fixed lg:bottom-0 lg:left-0 lg:top-20 lg:z-30 lg:block lg:w-64 lg:border-b-0 lg:border-r`} onKeyDown={event => {
        if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      }}>
        <nav id="system-navigation" aria-label={executiveOnly ? W.navigation : 'ส่วนงานผู้ดูแลระบบ'} className="max-h-[70dvh] space-y-6 overflow-y-auto px-3 py-5 lg:h-full lg:max-h-none lg:py-6">
          {groups.map(group => <div key={group}>
            <p className="mb-2 px-3 text-xs font-semibold text-gray-500">{group}</p>
            <ul className="space-y-1">
              {sections.filter(section => section.group === group).map(section => {
                const path = section.href.split('?')[0];
                const active = pathname === path || (path !== '/system/executive' && pathname.startsWith(`${path}/`)) || (path === '/system/partners' && pathname.startsWith('/system/company-onboardings/'));
                return <li key={section.href}><Link href={section.href} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border-l-4 px-3 py-2 text-base ${active ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-transparent text-gray-700 hover:bg-gray-50'}`}>
                  {section.label}
                  {section.href === SUPPORT_REQUESTS_HREF && openSupportCount !== null && openSupportCount > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">{openSupportCount > 99 ? '99+' : openSupportCount}</span>}
                </Link></li>;
              })}
            </ul>
          </div>)}
        </nav>
      </aside>
      <AlertModal open={signOutFailed} title="ออกจากระบบ" message="ออกจากระบบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง" onClose={() => setSignOutFailed(false)} />
    </>
  );
};

export default SystemHeader;
