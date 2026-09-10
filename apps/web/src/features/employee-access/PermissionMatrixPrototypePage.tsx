'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isRoleEditableByCompany, type ActionId, type CapabilityPackView, type MenuId, type PermissionMatrix as PermissionMatrixDto, type RoleSummary, type RoleTemplate } from '@watchdog-bms/contracts';
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
  MangmeeBranchChip,
  MangmeeCard,
  MangmeeIconFrame,
  cx,
  type MangmeeTone,
} from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
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
import { RoleBuilder, coveredPacks, ghostClass, dangerClass, roleDisplayName } from './EmployeeAccessPages';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';

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

export function PermissionMatrixPrototypePage({ companyId, viewerPermissions }: { companyId: string; viewerPermissions: readonly string[] }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  // Owner report 2026-08-28: on the phone this is one column, so pressing "เพิ่ม" swapped in the
  // builder BELOW the fold and the screen did not move — the button read as broken. Bring the panel
  // that just replaced the right-hand column into view.
  const builderRef = useRef<HTMLDivElement | null>(null);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrixDto | null>(null);
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({});
  const [staffCountsAvailable, setStaffCountsAvailable] = useState(false);
  const [packModules, setPackModules] = useState<Array<{ module: string; packs: CapabilityPackView[] }>>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [roleOptionsAvailable, setRoleOptionsAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  useEffect(() => {
    if (mode !== 'create') return;
    const id = requestAnimationFrame(() => builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [mode]);
  const [disabling, setDisabling] = useState(false);
  const canManageRoles = viewerPermissions.includes('access.role.manage');
  const canReadEmployees = viewerPermissions.includes('access.employee.read');

  const reload = useCallback(async () => {
    setError(null);
    const [rolesR, matrixR, employeesR, packsR, templatesR] = await Promise.allSettled([
      listRoles(companyId),
      getAccessMatrix(companyId),
      canReadEmployees ? listEmployees(companyId) : Promise.resolve([]),
      listCapabilityPacks(companyId),
      listRoleTemplates(companyId),
    ]);

    if (rolesR.status === 'fulfilled') {
      setRoles(rolesR.value);
      setSelectedRoleId((prev) => rolesR.value.some((role) => role.id === prev) ? prev : rolesR.value[0]?.id ?? null);
    } else {
      setError(localizedErrorMessage(rolesR.reason, locale, { fallback: 'error.load_failed' }));
    }
    if (matrixR.status === 'fulfilled') setMatrix(matrixR.value);
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

  useEffect(() => { void reload(); }, [reload]);

  const allPacks = useMemo(() => packModules.flatMap((m) => m.packs), [packModules]);
  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId],
  );
  const roleEditable = Boolean(canManageRoles && selectedRole && isRoleEditableByCompany(selectedRole));
  const selectedRow = useMemo(
    () => matrix?.rows.find((r) => r.roleId === selectedRole?.id) ?? null,
    [matrix, selectedRole],
  );
  const menus = matrix?.menus ?? [];
  const openMenuCount = selectedRow
    ? menus.filter((m) => selectedRow.menus[m.id]?.view).length
    : 0;
  const { confirm, confirmDialog } = useConfirm();

  const handleDisable = async (roleId: string) => {
    if (!canManageRoles || disabling || !(await confirm('ปิดใช้งานบทบาทนี้ใช่หรือไม่?'))) return;
    setDisabling(true);
    try {
      await disableRole(companyId, roleId);
      toast.success('ปิดใช้งานบทบาทเรียบร้อยแล้ว');
      await reload();
    } catch (e) {
      setError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setDisabling(false);
    }
  };

  if (loading) {
    return (
      <div className="mangmee-page">
        <LoadingState label="กำลังโหลด..." />
      </div>
    );
  }

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-500">
            <span>มั่งมี</span>
            <span className="mx-2 text-gray-300">/</span>
            <span className="text-gray-700">สิทธิ์การใช้งาน</span>
          </div>
          <h1 className="mt-7 text-3xl font-extrabold leading-tight text-gray-900">สิทธิ์การใช้งาน</h1>
          <p className="mt-3 text-base font-medium text-gray-500">
            เลือกบทบาท แล้วกำหนดเมนูและงานที่คนในบทบาทนี้ทำได้
          </p>
        </div>
        <MangmeeBranchChip label={t('branch.scope.company_wide', locale)} />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {canManageRoles && !roleOptionsAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ยังโหลดตัวเลือกสำหรับกำหนดบทบาทไม่ได้ กรุณาลองใหม่อีกครั้ง
        </div>
      )}

      {/* `grid-cols-[minmax(0,1fr)]` is load-bearing on the phone: a bare `grid` sizes its single
          implicit column to the WIDEST child, so the builder grew to 494px inside a 375px screen and
          the overflow was clipped rather than scrollable — the right third of the form could not be
          reached at all. Letting the column shrink to zero puts it back inside the viewport. */}
      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
        <MangmeeCard className="min-w-0 p-4">
          <div className="flex flex-wrap items-center justify-between px-2">
            <h2 className="text-sm font-bold text-gray-500">บทบาททั้งหมด</h2>
            {canManageRoles && <button
              type="button"
              className="inline-flex h-11 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs sm:h-8 font-bold text-gray-600 hover:border-brand-200 hover:bg-brand-25 disabled:opacity-50"
              disabled={!roleOptionsAvailable}
              onClick={() => setMode(mode === 'create' ? 'view' : 'create')}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              เพิ่ม
            </button>}
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {roles.map((role) => {
              const active = role.id === selectedRole?.id && mode !== 'create';
              const disabled = role.status !== 'ACTIVE';
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => { setSelectedRoleId(role.id); setMode('view'); }}
                  className={cx(
                    'flex min-h-[74px] min-w-0 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition',
                    active
                      ? 'border-brand-200 bg-brand-25 shadow-[inset_3px_0_0_var(--color-brand-500)]'
                      : 'border-gray-200 bg-white hover:border-brand-100 hover:bg-gray-50',
                  )}
                >
                  <PositionGlyph isSystem={role.isSystem} tone={role.isSystem ? 'brand' : 'slate'} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base font-extrabold text-gray-900">{roleDisplayName(role, locale)}</span>
                    <span className="mt-1 block text-sm font-medium text-gray-500">
                      {disabled ? 'ปิดใช้งาน' : staffCountsAvailable ? `${staffCounts[role.id] ?? 0} คน` : role.isSystem ? 'บทบาทมาตรฐาน' : 'บทบาทที่กำหนดเอง'}
                    </span>
                  </span>
                  {role.isSystem && <LockIcon className="h-4 w-4 shrink-0 text-amber-500" />}
                </button>
              );
            })}
          </div>
        </MangmeeCard>

        {mode === 'create' ? (
          <div ref={builderRef} className="min-w-0 scroll-mt-24">
          <RoleBuilder
            companyId={companyId} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable}
            onCancel={() => setMode('view')}
            onSubmit={async (body) => {
              const created = await createRole(companyId, body);
              setSelectedRoleId(created.id);
              toast.success('สร้างบทบาทเรียบร้อยแล้ว');
              setMode('view');
              await reload();
            }}
          />
          </div>
        ) : mode === 'edit' && selectedRole && roleEditable ? (
          <div className="min-w-0 space-y-3">
            {selectedRole.isSystem && roleEditable && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                บทบาทมาตรฐาน — เมื่อบันทึก ระบบจะสร้างสำเนาสำหรับบริษัทของคุณ {staffCountsAvailable ? `พนักงาน ${staffCounts[selectedRole.id] ?? 0} คน` : 'พนักงานที่ใช้บทบาทนี้'}จะย้ายมาอัตโนมัติ · บริษัทอื่นไม่ได้รับผลกระทบ
              </div>
            )}
            <RoleBuilder
              companyId={companyId} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable}
              initial={selectedRole}
              onCancel={() => setMode('view')}
              onSubmit={async (body) => {
                const updated = await updateRole(companyId, selectedRole.id, body);
                setSelectedRoleId(updated.id);
                toast.success('บันทึกบทบาทเรียบร้อยแล้ว');
                setMode('view');
                await reload();
              }}
            />
          </div>
        ) : selectedRole ? (
          <MangmeeCard className="min-w-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-6">
              <div className="min-w-0 lg:max-w-[620px]">
                <h2 className="break-words text-xl font-extrabold text-gray-900">สิทธิ์เข้าถึงเมนู — {roleDisplayName(selectedRole, locale)}</h2>
                <p className="mt-2 break-words text-sm font-medium text-gray-500">
                  {selectedRole.description || 'ดู / สร้าง / แก้ไข / ลบ / อนุมัติ ในแต่ละเมนู — ปิด “ดู” = ซ่อนเมนูทั้งหมด'}
                </p>
              </div>
              {roleEditable && selectedRole.status === 'ACTIVE' ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button type="button" className={`${ghostClass} h-9 px-3`} onClick={() => setMode('edit')}>
                    <PencilIcon className="h-4 w-4" />
                    แก้ไข
                  </button>
                  {!selectedRole.isSystem && (
                    <button type="button" className={`${dangerClass} h-9 px-3`} disabled={disabling} onClick={() => void handleDisable(selectedRole.id)}>
                      <TrashIcon className="h-4 w-4" />
                      {disabling ? 'กำลังปิดใช้งาน...' : 'ปิดใช้งาน'}
                    </button>
                  )}
                  <span className="inline-flex h-9 items-center rounded-full bg-brand-50 px-4 text-sm font-extrabold text-brand-700">
                    {openMenuCount} เมนูที่เปิด
                  </span>
                </div>
              ) : selectedRole.status !== 'ACTIVE' ? (
                <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-gray-100 px-4 text-sm font-extrabold text-gray-600">ปิดใช้งาน</span>
              ) : (
                <div className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-gray-400">
                  <LockIcon className="h-4 w-4 shrink-0" />
                  {isRoleEditableByCompany(selectedRole) ? 'คุณมีสิทธิ์ดู แต่ยังไม่มีสิทธิ์จัดการบทบาท' : 'บทบาทนี้ระบบดูแลให้ แก้ไขไม่ได้'}
                </div>
              )}
            </div>

            <div className="overflow-x-auto px-6 pb-6">
              <table className="w-full min-w-[820px] border-collapse">
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
          </MangmeeCard>
        ) : (
          <MangmeeCard className="p-6 text-sm text-gray-400">ยังไม่มีบทบาทในบริษัทนี้</MangmeeCard>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
