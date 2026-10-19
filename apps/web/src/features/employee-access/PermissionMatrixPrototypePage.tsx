'use client';

import type React from 'react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { THAI_SYSTEM_ROLE_NAMES, isRoleEditableByCompany, type ActionId, type CapabilityPackView, type MenuId, type PermissionMatrix as PermissionMatrixDto, type RoleSummary, type RoleTemplate } from '@watchdog-bms/contracts';
import {
  BellIcon,
  CalendarIcon,
  ChatIcon,
  CheckCircleIcon,
  CheckLineIcon,
  DocsIcon,
  FileIcon,
  GridIcon,
  GroupIcon,
  LockIcon,
  PencilIcon,
  PieChartIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from '@/common/icons';
import {
  MangmeeCard,
  MangmeeIconFrame,
  MangmeePage,
  cx,
  type MangmeeTone,
} from '@/common/components/mangmee';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { Notice } from '@/common/components/notice';
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { ErrorState, LoadingState } from '@/common/components/state';
import {
  createRole,
  disableRole,
  getAccessMatrix,
  listCapabilityPacks,
  listEmployees,
  listRoleTemplates,
  listRoles,
  updateRole,
} from './employee-access.api';
import { MENU_GROUP_LABEL_TH, MENU_GROUP_ORDER } from './access-overview.model';
import { RoleBuilder, RoleCanDoList, roleDisplayName } from './EmployeeAccessPages';
import { roleCanDoPacks } from './role-picker.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';

type SvgProps = React.SVGProps<SVGSVGElement>;

function ShoppingCartIcon(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 5.25h2.1c.47 0 .88.32.98.78l.32 1.34h11.08c.64 0 1.11.6.97 1.22l-1.04 4.51c-.11.46-.51.78-.98.78H9.35c-.47 0-.87-.32-.98-.77L7.4 7.37" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.25 18.25a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5ZM16.75 18.25a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5Z" fill="currentColor" />
    </svg>
  );
}

function SwapIcon(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7 8h11m0 0-3-3m3 3-3 3M17 16H6m0 0 3 3m-3-3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StampIcon(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M9.5 10.5V6.75a2.5 2.5 0 015 0v3.75M7.25 10.5h9.5l.75 5.25h-11l.75-5.25ZM5.75 18.25h12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TagIcon(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m11.5 4.75 6.75 6.75-6.5 6.5a1.5 1.5 0 0 1-2.12 0l-4.63-4.63a1.5 1.5 0 0 1 0-2.12l6.5-6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.25 8.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
    </svg>
  );
}

const MENU_ICON: Record<MenuId, React.ReactNode> = {
  dashboard: <GridIcon />,
  inbox: <ChatIcon />,
  sales: <ShoppingCartIcon />,
  customers: <GroupIcon />,
  booking: <CalendarIcon />,
  crmreport: <PieChartIcon />,
  broadcast: <BellIcon />,
  expenses: <FileIcon />,
  journal: <SwapIcon />,
  salesdoc: <DocsIcon />,
  reports: <PieChartIcon />,
  closing: <LockIcon />,
  roles: <LockIcon />,
  poapproval: <StampIcon />,
  discount: <TagIcon />,
  notifications: <BellIcon />,
};

const MENU_TONE: Record<MenuId, MangmeeTone> = {
  dashboard: 'brand', inbox: 'line', sales: 'rose', customers: 'sky', booking: 'cyan',
  crmreport: 'purple', broadcast: 'danger', expenses: 'amber', journal: 'lime', salesdoc: 'line',
  reports: 'indigo', closing: 'slate', roles: 'slate', poapproval: 'purple', discount: 'amber', notifications: 'sky',
};

const ACTIONS: { key: ActionId; label: string }[] = [
  { key: 'view', label: 'ดู' },
  { key: 'create', label: 'สร้าง' },
  { key: 'edit', label: 'แก้ไข' },
  { key: 'del', label: 'ลบ' },
  { key: 'approve', label: 'อนุมัติ' },
];

function PositionGlyph({ isSystem, tone }: { isSystem: boolean; tone: MangmeeTone }) {
  return (
    <MangmeeIconFrame tone={tone} className="h-10 w-10 rounded-lg">
      {isSystem ? <LockIcon /> : <UserIcon />}
    </MangmeeIconFrame>
  );
}

function PermissionCell({ granted, supported }: { granted: boolean; supported: boolean }) {
  if (!supported) return <span className="text-gray-300">-</span>;
  if (granted) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <CheckLineIcon className="h-4 w-4" />
      </span>
    );
  }
  return <span className="inline-flex h-7 w-7 rounded-lg border border-gray-200 bg-white" aria-label="ไม่ได้เปิดสิทธิ์" />;
}

export function PermissionMatrixPrototypePage({ companyId, viewerPermissions, disbursementEntryOpen = false }: { companyId: string; viewerPermissions: readonly string[]; disbursementEntryOpen?: boolean }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  // Owner report 2026-08-28: on the phone this is one column, so pressing "เพิ่ม" swapped in the
  // builder BELOW the fold and the screen did not move — the button read as broken. Bring the panel
  // that just replaced the right-hand column into view.
  const builderRef = useRef<HTMLDivElement | null>(null);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rolesLoadFailed, setRolesLoadFailed] = useState(false);
  const [roleQuery, setRoleQuery] = useState('');
  const [matrix, setMatrix] = useState<PermissionMatrixDto | null>(null);
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({});
  const [staffCountsAvailable, setStaffCountsAvailable] = useState(false);
  const [packModules, setPackModules] = useState<Array<{ module: string; packs: CapabilityPackView[] }>>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [roleOptionsAvailable, setRoleOptionsAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The chosen role is in the address (`?role=`). Below the two-column width (1024 px) the list is the
  // page and a role is its own view, so the phone's back gesture returns to the list (thai-ux-standard 3.1).
  const pathname = usePathname();
  const roleParam = useSearchParams().get('role');
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const showRole = (roleId: string, step: 'push' | 'replace' = 'replace') => {
    setMode('view');
    const url = `${pathname}?role=${encodeURIComponent(roleId)}`;
    if (step === 'push') { window.history.pushState(null, '', url); window.scrollTo({ top: 0 }); } else window.history.replaceState(null, '', url);
  };
  // Leaving a role by the back gesture also leaves its editor.
  useEffect(() => { if (!roleParam) setMode((current) => (current === 'edit' ? 'view' : current)); }, [roleParam]);
  useEffect(() => {
    if (mode !== 'create') return;
    const id = requestAnimationFrame(() => builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [mode]);
  const [disabling, setDisabling] = useState(false);
  const canManageRoles = viewerPermissions.includes('access.role.manage');
  const canReadEmployees = viewerPermissions.includes('access.employee.read');

  const generation = useRef(0);
  const reload = useCallback(async (showLoading = false) => {
    const current = ++generation.current;
    if (showLoading) setLoading(true);
    setRolesLoadFailed(false);
    setError(null);
    const [rolesR, matrixR, employeesR, packsR, templatesR] = await Promise.allSettled([
      listRoles(companyId),
      getAccessMatrix(companyId),
      canReadEmployees ? listEmployees(companyId) : Promise.resolve([]),
      listCapabilityPacks(companyId),
      listRoleTemplates(companyId),
    ]);
    if (current !== generation.current) return;

    if (rolesR.status === 'fulfilled') {
      setRoles(rolesR.value);
    } else {
      setRolesLoadFailed(true);
    }
    setMatrix(matrixR.status === 'fulfilled' ? matrixR.value : null);
    if (canReadEmployees && employeesR.status === 'fulfilled') {
      const counts: Record<string, number> = {};
      for (const emp of employeesR.value as Array<{ roles: { id: string }[] }>) {
        for (const r of emp.roles) counts[r.id] = (counts[r.id] ?? 0) + 1;
      }
      setStaffCounts(counts);
      setStaffCountsAvailable(true);
    } else setStaffCountsAvailable(false);
    if (packsR.status === 'fulfilled') {
      setPackModules(packsR.value.modules);
      setRoleOptionsAvailable(true);
    } else {
      setPackModules([]);
      setRoleOptionsAvailable(false);
    }
    if (templatesR.status === 'fulfilled') setTemplates(templatesR.value);
    else setTemplates([]);
    setLoading(false);
  }, [canReadEmployees, companyId, locale, viewerPermissions]);

  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);

  const allPacks = useMemo(() => packModules.flatMap((m) => m.packs), [packModules]);
  const selectedRole = useMemo(
    () => roles.find((r) => r.id === roleParam) ?? roles[0] ?? null,
    [roles, roleParam],
  );
  const roleEditable = Boolean(canManageRoles && selectedRole && isRoleEditableByCompany(selectedRole));
  const selectedRow = useMemo(
    () => matrix?.rows.find((r) => r.roleId === selectedRole?.id) ?? null,
    [matrix, selectedRole],
  );
  const menus = matrix?.menus ?? [];
  const { confirm, confirmDialog } = useConfirm();

  const handleDisable = async (roleId: string) => {
    if (!canManageRoles || disabling) return;
    const role = roles.find((item) => item.id === roleId);
    if (!role || role.isSystem || role.status !== 'ACTIVE' || role.activeEmployeeCount !== 0) return;
    const name = role ? roleDisplayName(role, locale) : '';
    // Four parts (thai-ux-standard 4.2). The sentence says only what this screen can show to be true.
    const accepted = await confirm({ title: `ปิดใช้งานบทบาท ${name}?`, message: 'บทบาทนี้จะขึ้นว่าปิดใช้งาน และแก้ไขไม่ได้อีก', confirmLabel: 'ปิดใช้งานบทบาท', cancelLabel: 'ไม่ปิด', variant: 'danger' });
    if (!accepted) return;
    setDisabling(true);
    try {
      await disableRole(companyId, roleId);
      toast.success(`ปิดใช้งานบทบาท ${name} แล้ว`);
      await reload();
    } catch (e) {
      await reload();
      setError(apiErrorMessage(e, locale));
    } finally {
      setDisabling(false);
    }
  };

  if (loading) {
    return (
      <MangmeePage title="บทบาทและสิทธิ์">
        <LoadingState label="กำลังโหลด..." />
      </MangmeePage>
    );
  }

  if (rolesLoadFailed) return <MangmeePage title="บทบาทและสิทธิ์"><ErrorState title="โหลดบทบาทไม่สำเร็จ" onRetry={() => void reload(true)} /></MangmeePage>;

  // What the chosen role can do, in the builder's own plain sentences (the menu grid below cannot tell
  // two roles apart: receipts, claims and tax papers are not menus of their own).
  // Only what this shop's package has: a standard role also carries rights of features the shop does not hold.
  const selectedPacks = selectedRole ? roleCanDoPacks(selectedRole.permissionKeys, allPacks) : [];
  const corePacks = allPacks.filter((pack) => pack.isCore && !pack.locked);
  // On a narrow screen: the list, or one role (or the form for a new one).
  const narrowDetail = mode === 'create' || Boolean(roleParam);
  const filteredRoles = roles.filter(role => roleDisplayName(role, locale).toLowerCase().includes(roleQuery.trim().toLowerCase()));

  return (
    <MangmeePage
      title="บทบาทและสิทธิ์"
      back={roleParam && mode === 'view' ? <div className="lg:hidden"><BackLink href={pathname} label="กลับไปบทบาททั้งหมด" /></div> : undefined}
      actions={canManageRoles && mode !== 'create' ? (
        <button type="button" className={cx(primaryButtonClass, narrowDetail && 'hidden lg:inline-flex')} disabled={!roleOptionsAvailable} onClick={() => setMode('create')}>เพิ่มบทบาท</button>
      ) : undefined}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {canManageRoles && !roleOptionsAvailable && (
        <Notice tone="warning" action={<button type="button" className={secondaryButtonClass} onClick={() => void reload()}>ลองอีกครั้ง</button>}>
          ยังโหลดตัวเลือกสำหรับกำหนดบทบาทไม่ได้
        </Notice>
      )}

      {/* `grid-cols-[minmax(0,1fr)]` is load-bearing on the phone: a bare `grid` sizes its single
          implicit column to the WIDEST child, so the builder grew to 494px inside a 375px screen and
          the overflow was clipped rather than scrollable — the right third of the form could not be
          reached at all. Letting the column shrink to zero puts it back inside the viewport. */}
      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <MangmeeCard className={cx('min-w-0 p-4', narrowDetail && 'hidden lg:block')}>
          <h2 className="px-2 text-sm font-semibold text-gray-700">บทบาททั้งหมด</h2>
          <input type="search" className="mangmee-input mt-3" aria-label="ค้นหาบทบาท" placeholder="ค้นหาบทบาท" value={roleQuery} onChange={event => setRoleQuery(event.target.value)} />
          <div className="mt-4 grid max-h-[60vh] min-w-0 grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto">
            {filteredRoles.map((role) => {
              const active = role.id === selectedRole?.id && mode !== 'create';
              const isOpen = active && Boolean(roleParam);
              const disabled = role.status !== 'ACTIVE';
              return (
                <button
                  key={role.id}
                  type="button"
                  aria-current={isOpen ? 'true' : undefined}
                  onClick={() => showRole(role.id, window.innerWidth < 1024 ? 'push' : 'replace')}
                  className={cx(
                    'flex min-h-14 min-w-0 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition',
                    // The highlight says "shown at the right", which is true only where there are two columns.
                    active
                      ? 'border-gray-200 bg-white lg:border-brand-200 lg:bg-brand-25 lg:shadow-[inset_3px_0_0_var(--color-brand-500)]'
                      : 'border-gray-200 bg-white hover:border-brand-100 hover:bg-gray-50',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base font-semibold text-gray-900">{roleDisplayName(role, locale)}</span>
                    <span className="mt-0.5 block text-sm text-gray-500">
                      {disabled ? 'ปิดใช้งาน' : `${staffCountsAvailable ? `${staffCounts[role.id] ?? 0} คน · ` : ''}${role.isSystem ? 'บทบาทมาตรฐาน' : 'บทบาทของร้าน'}`}
                    </span>
                  </span>
                </button>
              );
            })}
            {roles.length === 0 ? <p className="px-2 py-4 text-sm text-gray-500">ยังไม่มีบทบาทในร้านนี้</p>
              : filteredRoles.length === 0 && <p className="px-2 py-4 text-sm text-gray-500">ไม่พบบทบาทที่ตรงกับคำค้น</p>}
          </div>
        </MangmeeCard>

        <div className={cx('min-w-0', !narrowDetail && 'hidden lg:block')}>
        {mode === 'create' ? (
          <div ref={builderRef} className="min-w-0 scroll-mt-24">
          <RoleBuilder
            companyId={companyId} disbursementEntryOpen={disbursementEntryOpen} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable}
            onCancel={() => setMode('view')}
            onSubmit={async (body) => {
              const created = await createRole(companyId, body);
              toast.success(`สร้างบทบาท ${roleDisplayName(created, locale)} แล้ว`);
              showRole(created.id);
              await reload();
            }}
          />
          </div>
        ) : mode === 'edit' && selectedRole && roleEditable ? (
          <div className="min-w-0 space-y-3">
            {selectedRole.isSystem && roleEditable && (
              <Notice tone="warning">
                บทบาทมาตรฐาน: บันทึกแล้วร้านจะได้สำเนาของตัวเอง {staffCountsAvailable ? `พนักงาน ${staffCounts[selectedRole.id] ?? 0} คน` : 'พนักงานที่ใช้บทบาทนี้'}ย้ายมาใช้สำเนานี้
              </Notice>
            )}
            <RoleBuilder
              companyId={companyId} disbursementEntryOpen={disbursementEntryOpen} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable}
              initial={selectedRole}
              onCancel={() => setMode('view')}
              onSubmit={async (body) => {
                const updated = await updateRole(companyId, selectedRole.id, body);
                toast.success(`บันทึกบทบาท ${roleDisplayName(updated, locale)} แล้ว`);
                showRole(updated.id);
                await reload();
              }}
            />
          </div>
        ) : selectedRole ? (
          <MangmeeCard className="min-w-0 overflow-hidden p-0">
            <div className="space-y-4 border-b border-gray-100 p-4 sm:p-6">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-bold text-gray-900">{roleDisplayName(selectedRole, locale)}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedRole.isSystem && staffCountsAvailable ? `${staffCounts[selectedRole.id] ?? 0} คน · ` : ''}{selectedRole.isSystem ? 'บทบาทมาตรฐาน' : 'บทบาทของร้าน'}
                </p>
                {/* A standard role's description is the server's list of its menus, which the table below already says. */}
                {!selectedRole.isSystem && selectedRole.description && <p className="mt-1 break-words text-sm text-gray-600">{selectedRole.description}</p>}
              </div>
              {roleEditable && selectedRole.status === 'ACTIVE' ? (
                <ActionGroup align="start">
                  <button type="button" className={secondaryButtonClass} onClick={() => setMode('edit')}>แก้ไขบทบาท</button>
                  {!selectedRole.isSystem && selectedRole.activeEmployeeCount === 0 && (
                    <button type="button" className={dangerButtonClass} disabled={disabling} aria-busy={Boolean(disabling)} onClick={() => void handleDisable(selectedRole.id)}>ปิดใช้งานบทบาท</button>
                  )}
                </ActionGroup>
              ) : selectedRole.status !== 'ACTIVE' ? (
                <p className="text-sm font-semibold text-gray-600">ปิดใช้งาน</p>
              ) : (
                <p className="text-sm text-gray-500">
                  {isRoleEditableByCompany(selectedRole) ? 'คุณดูได้ แต่ไม่มีสิทธิ์แก้บทบาท' : 'บทบาทนี้แก้ไขไม่ได้'}
                </p>
              )}
              {roleEditable && !selectedRole.isSystem && selectedRole.status === 'ACTIVE' && selectedRole.activeEmployeeCount !== 0 && (
                <Notice tone="warning" action={canReadEmployees
                  ? <Link href={`/companies/${companyId}/settings/access-overview?role=${encodeURIComponent(selectedRole.id)}`} className={secondaryButtonClass}>ย้ายพนักงานไปบทบาทอื่น</Link>
                  : undefined}>
                  {selectedRole.activeEmployeeCount === undefined
                    ? 'ยังตรวจจำนวนพนักงานที่ใช้บทบาทนี้ไม่ได้ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'
                    : `ยังมีพนักงานใช้บทบาทนี้ ${selectedRole.activeEmployeeCount} คน ${canReadEmployees ? 'ย้ายไปบทบาทอื่นก่อนปิดใช้งาน' : `ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ย้ายไปบทบาทอื่นก่อนปิดใช้งาน`}`}
                </Notice>
              )}

              {/* The role said as the things it lets a person do. */}
              {allPacks.length > 0 && (
                <div data-testid="role-can-do">
                  <h3 className="text-sm font-semibold text-gray-900">บทบาทนี้ทำอะไรได้</h3>
                  <RoleCanDoList packs={selectedPacks} corePacks={corePacks} />
                </div>
              )}
              <h3 className="text-sm font-semibold text-gray-900">สิทธิ์เข้าถึงเมนู</h3>
            </div>

            {/* The rights never scroll sideways. A phone has no room for five tick columns beside a menu
                name, so it gets one stacked row per menu with the rights written out (the shape the
                per-employee summary uses); from `sm` up the table fits its card. */}
            {!selectedRow ? <ErrorState title="โหลดตารางสิทธิ์ไม่สำเร็จ" onRetry={() => void reload(true)} /> : <div data-testid="role-permission-matrix">
            <div className="grid gap-4 px-3 pb-5 pt-4 sm:hidden">
              {MENU_GROUP_ORDER.map((group) => {
                const groupMenus = menus.filter((menu) => menu.group === group);
                if (groupMenus.length === 0) return null;
                return (
                  <div key={group} className="grid gap-1">
                    <h3 className="px-3 text-sm font-semibold text-gray-500">{MENU_GROUP_LABEL_TH[group]}</h3>
                    {groupMenus.map((menu) => {
                      const granted = ACTIONS.filter((action) => selectedRow?.menus[menu.id]?.[action.key]);
                      return (
                        <div key={menu.id} data-testid="role-permission-row" className="grid min-w-0 gap-1 px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <MangmeeIconFrame tone={MENU_TONE[menu.id]} className="h-8 w-8 shrink-0 rounded-lg">
                              {MENU_ICON[menu.id]}
                            </MangmeeIconFrame>
                            <span className="min-w-0 break-words text-sm font-extrabold text-gray-800">{menu.labelTh}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 pl-11">
                            {granted.length === 0 ? <span className="text-sm font-medium text-gray-500">ไม่ได้เปิดสิทธิ์</span> : granted.map((action) => (
                              <span key={action.key} className="inline-flex items-center gap-1 text-sm font-extrabold text-brand-700">
                                <CheckLineIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {action.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="hidden px-6 pb-6 sm:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-xs font-bold text-gray-500">
                    <th className="py-3 text-left">เมนู</th>
                    {ACTIONS.map((action) => (
                      <th key={action.key} className="w-[58px] py-3 text-center">{action.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {menus.map((menu) => (
                    <tr key={menu.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <MangmeeIconFrame tone={MENU_TONE[menu.id]} className="h-8 w-8 rounded-lg">
                            {MENU_ICON[menu.id]}
                          </MangmeeIconFrame>
                          <span className="text-sm font-extrabold text-gray-800">{menu.labelTh}</span>
                        </div>
                      </td>
                      {ACTIONS.map((action) => (
                        <td key={action.key} className="py-3 text-center align-middle">
                          <PermissionCell
                            supported={Boolean(menu.actions[action.key]?.length)}
                            granted={Boolean(selectedRow?.menus[menu.id]?.[action.key])}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>}
          </MangmeeCard>
        ) : (
          <MangmeeCard className="p-6 text-sm text-gray-500 lg:hidden">ยังไม่มีบทบาทในร้านนี้</MangmeeCard>
        )}
        </div>
      </div>
      {confirmDialog}
    </MangmeePage>
  );
}
