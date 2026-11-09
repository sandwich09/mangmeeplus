'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiErrorCode } from '@/common/api/api-error-message';
import { logoutCurrentSession } from '@/common/auth/session';
import { AlertModal } from '@/common/components/modal';
import { getSalesMyWork } from '@/features/sales-console/sales.api';
import { myWorkBadgeLabel } from '@/features/sales-console/sales-console.logic';

const MY_WORK_HREF = '/sales/my-work';

/**
 * Q6/S30: เซลล์ are not LINE-linked to the platform tenant, so this badge — not a push — is how
 * anyone learns a deal was rejected, expired, or is waiting for their approval. Same shape as the
 * system header's support badge: refetched on every navigation over the console's own read, and
 * quiet about its own failures (a 403 or an outage leaves `null`, which renders nothing at all
 * rather than a confident zero).
 *
 * RB-36: the one failure it is not quiet about is a suspended account. Every sales route refuses
 * with that code, and this read runs on every screen, so the shell learns it here and says so once
 * instead of leaving each page to show its own empty list.
 */
function useMyWorkBadge(pathname: string): { badge: number | null; suspended: boolean } {
  const [badge, setBadge] = useState<number | null>(null);
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getSalesMyWork({ signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setBadge(result.badge); setSuspended(false); } })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setBadge(null);
        setSuspended(apiErrorCode(cause) === 'SALES_AGENT_SUSPENDED');
      });
    return () => controller.abort();
  }, [pathname]);
  return { badge, suspended };
}

const REPORTS_HREF = '/sales/reports';

const SECTIONS = [
  { href: '/sales/deals', label: 'ดีล', group: 'งานขาย' },
  { href: '/sales/demo-links', label: 'ลิงก์เดโม่', group: 'งานขาย' },
  { href: '/sales/companies', label: 'ร้านค้า', group: 'งานขาย' },
  // Every sales role: a เซลล์ shows the QR here, a หัวหน้าทีม sets the batches up.
  { href: '/sales/events', label: 'ส่วนลดจากงาน', group: 'งานขาย' },
  { href: MY_WORK_HREF, label: 'งานของฉัน', group: 'งานขาย' },
  { href: REPORTS_HREF, label: 'รายงาน', group: 'งานขาย' },
  { href: '/sales/team', label: 'ทีม', group: 'จัดการทีม' },
  { href: '/sales/profile', label: 'ข้อมูลของฉัน', group: 'บัญชี' },
];

const SalesHeader: React.FC<{ canManageTeam?: boolean; canReadReports?: boolean; environment?: string }> = ({ canManageTeam = false, canReadReports = false, environment }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);
  const { badge, suspended } = useMyWorkBadge(pathname);
  const badgeLabel = badge === null ? null : myWorkBadgeLabel(badge);
  const sections = SECTIONS.filter((section) => (section.href !== '/sales/team' || canManageTeam)
    && (section.href !== REPORTS_HREF || canReadReports));
  const groups = [...new Set(sections.map((section) => section.group))];

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
          <button ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls="sales-navigation" onClick={() => setMenuOpen((value) => !value)} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 lg:hidden">
            {menuOpen ? 'ปิดเมนู' : 'เมนู'}{badgeLabel ? ` (${badgeLabel})` : ''}
          </button>
          <Link href="/sales/deals" className="text-base font-semibold text-gray-900 lg:text-lg">มั่งมี <span className="hidden font-normal text-gray-500 sm:inline">/ ทีมขายมั่งมี</span></Link>
          {environment && <span className={`mangmee-badge ${environment === 'ระบบจริง' ? 'mangmee-badge-brand' : 'mangmee-badge-amber'}`}>{environment}</span>}
        </div>
        <button type="button" onClick={handleSignOut} disabled={signingOut} aria-busy={signingOut} className="min-h-11 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {signingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
        </button>
      </header>
      <aside className={`${menuOpen ? 'block' : 'hidden'} mangmee-safe-bottom border-b border-gray-200 bg-white lg:fixed lg:bottom-0 lg:left-0 lg:top-20 lg:z-30 lg:block lg:w-64 lg:border-b-0 lg:border-r`} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      }}>
        <nav id="sales-navigation" aria-label="ส่วนงานทีมขายมั่งมี" className="max-h-[70dvh] space-y-6 overflow-y-auto px-3 py-5 lg:h-full lg:max-h-none lg:py-6">
          {groups.map((group) => <div key={group}>
            <p className="mb-2 px-3 text-xs font-semibold text-gray-500">{group}</p>
            <ul className="space-y-1">
              {sections.filter((section) => section.group === group).map((section) => {
                const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
                return <li key={section.href}><Link href={section.href} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border-l-4 px-3 py-2 text-base ${active ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-transparent text-gray-700 hover:bg-gray-50'}`}>
                  {section.label}
                  {section.href === MY_WORK_HREF && badgeLabel && <span className="mangmee-badge mangmee-badge-danger">{badgeLabel}</span>}
                </Link></li>;
              })}
            </ul>
          </div>)}
        </nav>
      </aside>
      {/* Signing out is the only thing left to do here, so it is the only way this closes. */}
      <AlertModal open={suspended && !signOutFailed} title="บัญชีทีมขายถูกระงับ" message="บัญชีนี้ใช้หน้าทีมขายไม่ได้ในขณะนี้ กรุณาติดต่อหัวหน้าทีมหรือผู้ดูแลระบบ เมื่อเปิดใช้งานบัญชีอีกครั้งจะกลับมาใช้ได้ทันที" closeLabel={signingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'} onClose={() => void handleSignOut()} />
      <AlertModal open={signOutFailed} title="ออกจากระบบ" message="ออกจากระบบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง" onClose={() => setSignOutFailed(false)} />
    </>
  );
};

export default SalesHeader;
