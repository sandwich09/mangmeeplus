'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ALL_BRANCH_ROLE_KEYS, type EmployeeCredentialHandoff, type EmployeeSummary, type MenuDefinition, type PermissionMatrix as PermissionMatrixDto, type RoleSummary } from '@watchdog-bms/contracts';
import {
  BellIcon,
  CalendarIcon,
  ChatIcon,
  CheckLineIcon,
  ChevronDownIcon,
  DocsIcon,
  FileIcon,
  GridIcon,
  GroupIcon,
  HorizontalDotsIcon,
  LockIcon,
  PieChartIcon,
  PlusIcon,
  UserIcon,
} from '@/common/icons';
import { MangmeeBadge, MangmeeCard, MangmeeIconFrame, MangmeePage, cx, getInitials } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { Modal, useConfirm } from '@/common/components/modal';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listBranches as listCompanyBranches, type Branch } from '../branch-settings/branches.api';
import {
  deleteEmployeeDraft,
  employeeShortName,
  getAccessMatrix,
  listEmployees,
  listRoles,
  regenerateEmployeeCredential,
  setEmployeeStatus,
  updateEmployee,
} from './employee-access.api';
import { accountAccessNotice, MENU_GROUP_LABEL_TH, projectGrantedMenus } from './access-overview.model';
import { assignableRoleOptions, isOperationalRoleTargetReadOnly, isRoleFieldReadOnly, isSelfEmployee, roleDisplayName } from './role-picker.logic';
import { localizedErrorMessage, statusOf } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';

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
      <path d="M5.75 12.15V6.75h5.4l7.05 7.05a2 2 0 010 2.83l-2.57 2.57a2 2 0 01-2.83 0L5.75 12.15Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.25 9.25h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m20 20-4.25-4.25M18 10.75a7.25 7.25 0 1 1-14.5 0 7.25 7.25 0 0 1 14.5 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MENU_ICON: Record<string, React.ReactNode> = {
  dashboard: <GridIcon />, inbox: <ChatIcon />, sales: <ShoppingCartIcon />, customers: <GroupIcon />,
  booking: <CalendarIcon />, crmreport: <PieChartIcon />, broadcast: <BellIcon />, expenses: <FileIcon />,
  journal: <SwapIcon />, salesdoc: <DocsIcon />, reports: <PieChartIcon />, closing: <LockIcon />,
  roles: <LockIcon />, poapproval: <StampIcon />, discount: <TagIcon />, notifications: <BellIcon />,
};

const ROLE_COLOR_BY_KEY: Record<string, string> = {
  OWNER: '#16A34A', SYSTEM_ADMIN: '#475467', ADMIN: '#0BA5EC', MANAGER: '#2E90FA', HR: '#875BF7', SALES: '#F79009',
  INVENTORY: '#7A5AF8', FINANCE: '#DD2590', ACCOUNTANT: '#12B76A', MARKETING: '#F63D68', STAFF: '#667085',
  AUDITOR_READONLY: '#06AED4',
};
const FALLBACK_ROLE_COLORS = ['#7A5AF8', '#0BA5EC', '#F79009', '#12B76A', '#DD2590', '#667085'];
type DisplayRole = Pick<RoleSummary, 'id' | 'key' | 'name'>;

function colorForRole(role: DisplayRole): string {
  if (ROLE_COLOR_BY_KEY[role.key]) return ROLE_COLOR_BY_KEY[role.key]!;
  let hash = 0;
  for (const ch of role.key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_ROLE_COLORS[hash % FALLBACK_ROLE_COLORS.length]!;
}

function RoleBadge({ role, withCaret = false, className }: { role: DisplayRole; withCaret?: boolean; className?: string }) {
  const color = colorForRole(role);
  return (
    <span title={roleDisplayName(role)} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold', className)} style={{ color, backgroundColor: `${color}1F` }}>
      {roleDisplayName(role)}
      {withCaret && <ChevronDownIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

function DraftBadge() {
  return <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 text-xs font-extrabold text-gray-600">Draft</span>;
}

function MenuIconFrame({ menu, className }: { menu: MenuDefinition; className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 leading-none [&>svg]:m-auto [&>svg]:block [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', className)} aria-hidden="true">
      {MENU_ICON[menu.id]}
    </span>
  );
}

function ToggleSwitch({ checked, disabled = false, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: () => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
        checked ? 'bg-brand-500' : 'bg-gray-300',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <span className={cx('absolute h-5 w-5 rounded-full bg-white shadow-sm transition', checked ? 'right-0.5' : 'left-0.5')} />
    </button>
  );
}

function EmployeeAvatar({ employee, color, active, className }: { employee: EmployeeSummary; color: string; active: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] text-sm font-extrabold text-white', active ? '' : 'opacity-50', className)} style={{ backgroundColor: color }}>
      {getInitials(employeeShortName(employee))}
    </span>
  );
}

function EmployeeRow({ employee, roles, selected, onSelect }: { employee: EmployeeSummary; roles: DisplayRole[]; selected: boolean; onSelect: () => void }) {
  const active = employee.status === 'ACTIVE';
  const primaryRole = roles[0];
  return (
    <button
      type="button" onClick={onSelect}
      className={cx(
        'flex min-h-[64px] w-full items-center gap-3 rounded-[11px] border px-[11px] py-2.5 text-left transition',
        selected ? 'border-brand-300 bg-brand-25 shadow-[inset_3px_0_0_var(--color-brand-500)]' : 'border-gray-200 bg-white hover:border-brand-100 hover:bg-gray-50',
      )}
    >
      <EmployeeAvatar employee={employee} color={primaryRole ? colorForRole(primaryRole) : '#667085'} active={active} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-extrabold text-gray-900">{employeeShortName(employee)}</span>
          {employee.status === 'DRAFT' ? <DraftBadge /> : <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-brand-500' : 'bg-gray-300')} />}
        </span>
        <span className="mt-1 block truncate text-[12px] font-semibold text-gray-500">{employee.jobTitle || 'ยังไม่ระบุตำแหน่งงาน'}</span>
        <span className="mt-1 block truncate text-[11px] font-semibold text-gray-400">
          {employee.branchScopeMode === 'ALL_BRANCHES' ? 'ทุกสาขา' : `${employee.branchScopeBranchIds.length} สาขา`}
        </span>
      </span>
      {roles.length > 0 && (
        <span className="flex max-w-32 shrink-0 flex-col items-end gap-1">
          {roles.map((role) => <RoleBadge key={role.id} role={role} className="max-w-full truncate" />)}
        </span>
      )}
    </button>
  );
}

function BranchAccessChip({ label, selected, disabled, title, onToggle }: { label: string; selected: boolean; disabled: boolean; title?: string; onToggle: () => void }) {
  return (
    <button
      type="button" disabled={disabled} title={title} onClick={onToggle}
      className={cx(
        'inline-flex h-10 max-w-full items-center gap-2 rounded-full border px-4 text-sm font-extrabold transition',
        selected ? 'border-brand-200 bg-brand-25 text-brand-700' : 'border-gray-200 bg-white text-gray-500 hover:border-brand-100 hover:bg-gray-50',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
      )}
    >
      {selected ? <CheckLineIcon className="h-4 w-4 shrink-0" /> : <PlusIcon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

// MVP 1 exposes only the CRM, bill-capture, and sales-document surfaces here.
const MVP1_INDIVIDUAL_PERMISSION_MENU_IDS = new Set<MenuDefinition['id']>([
  'dashboard', 'inbox', 'customers', 'booking', 'crmreport', 'expenses', 'salesdoc',
]);

type SaveKey = 'role' | 'branch' | 'status';

export function IndividualPermissionsPrototypePage({ companyId, viewerPermissions = [], viewerUserId }: { companyId: string; viewerPermissions?: string[]; viewerUserId?: string }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const toast = useToast();
  // Read-only viewers hold access.employee.read without the write keys; mutation controls stay hidden.
  const canEditEmployee = viewerPermissions.includes('access.employee.update');
  const canDisableEmployee = viewerPermissions.includes('access.employee.disable');
  const canManageRoles = viewerPermissions.includes('access.role.manage');
  const canIssueCredential = viewerPermissions.includes('access.employee.credential.issue');
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrixDto | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'DRAFT' | 'INACTIVE'>('all');
  const [query, setQuery] = useState('');
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [employeeMenuOpen, setEmployeeMenuOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<SaveKey | null>(null);
  const [savedAt, setSavedAt] = useState<SaveKey | null>(null);
  // Password reset: confirm dialog target → handoff dialog with the one-time temporary password.
  const [resetTarget, setResetTarget] = useState<EmployeeSummary | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<(EmployeeCredentialHandoff & { displayName: string }) | null>(null);
  const rolePickerRef = useRef<HTMLDivElement>(null);
  const employeeMenuRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rolePickerRef, useCallback(() => setRolePickerOpen(false), []));
  useCloseOnOutsideClick(employeeMenuRef, useCallback(() => setEmployeeMenuOpen(false), []));
  const { confirm, confirmDialog } = useConfirm();

  const reload = useCallback(async () => {
    setError(null);
    setPermissionError(null);
    setBranchError(null);
    const [employeesR, rolesR, matrixR, branchesR] = await Promise.allSettled([
      listEmployees(companyId),
      listRoles(companyId),
      getAccessMatrix(companyId),
      listCompanyBranches(companyId),
    ]);
    if (employeesR.status === 'fulfilled') {
      setEmployees(employeesR.value);
      setSelectedUserId((prev) => prev ?? employeesR.value[0]?.id ?? null);
    } else {
      setError(localizedErrorMessage(employeesR.reason, locale, { fallback: 'error.load_failed' }));
    }
    if (rolesR.status === 'fulfilled') {
      setRoles(rolesR.value.map((role) => ({ ...role, name: roleDisplayName(role) })));
    } else {
      setRoles([]);
      setPermissionError(localizedErrorMessage(rolesR.reason, locale, { fallback: 'error.load_failed' }));
    }
    if (matrixR.status === 'fulfilled') {
      setMatrix(matrixR.value);
    } else {
      setMatrix(null);
      setPermissionError(localizedErrorMessage(matrixR.reason, locale, { fallback: 'error.load_failed' }));
    }
    if (branchesR.status === 'fulfilled') {
      setBranches(branchesR.value);
    } else {
      setBranches([]);
      setBranchError(localizedErrorMessage(branchesR.reason, locale, { fallback: 'error.load_failed' }));
    }
    setLoading(false);
  }, [companyId, locale]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const filters = useMemo(() => [{ id: 'all', name: 'ทุกบทบาท' } as const, ...roles], [roles]);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return employees.filter((employee) => {
      const roleMatches = roleFilter === 'all' || employee.roles.some((r) => r.id === roleFilter);
      const queryMatches = !normalizedQuery
        || employee.displayName.toLowerCase().includes(normalizedQuery)
        || (employee.nickname ?? '').toLowerCase().includes(normalizedQuery)
        || (employee.jobTitle ?? '').toLowerCase().includes(normalizedQuery)
        || employee.phoneNumber.toLowerCase().includes(normalizedQuery);
      const statusMatches = statusFilter === 'all'
        || employee.status === statusFilter
        || (statusFilter === 'INACTIVE' && employee.status !== 'ACTIVE' && employee.status !== 'DRAFT');
      return roleMatches && queryMatches && statusMatches;
    });
  }, [employees, query, roleFilter, statusFilter]);

  const activeUserId = filteredEmployees.some((e) => e.id === selectedUserId) ? selectedUserId : filteredEmployees[0]?.id ?? null;
  useEffect(() => {
    setBranchPickerOpen(false);
    setRolePickerOpen(false);
    setEmployeeMenuOpen(false);
  }, [activeUserId]);
  const selectedEmployee = employees.find((e) => e.id === activeUserId) ?? null;
  const selectedRoles = selectedEmployee
    ? selectedEmployee.roles.map((role) => roleById.get(role.id)).filter((role): role is RoleSummary => Boolean(role))
    : [];
  const selectedRole = selectedRoles[0];
  const selectedIsOwner = selectedEmployee?.roles.some((role) => role.key === 'OWNER') ?? false;
  const selectedIsDraft = selectedEmployee?.status === 'DRAFT';
  const selectedActive = selectedEmployee?.status === 'ACTIVE';
  // Options come from the server's own grant decision; the current role stays pinned (spec R1/R3).
  const selectedRoleIds = selectedEmployee?.roles.map((role) => role.id) ?? [];
  const roleOptions = useMemo(() => assignableRoleOptions(roles, selectedRoleIds), [roles, selectedRoleIds]);
  const rolePickerReadOnly = isRoleFieldReadOnly({
    canEditEmployee,
    isOwnerTarget: selectedIsOwner,
    isSelfTarget: isSelfEmployee(selectedEmployee, viewerUserId),
    optionCount: roleOptions.length,
  }) || isOperationalRoleTargetReadOnly(viewerPermissions, selectedRoles);

  const selectedRoleNames = selectedEmployee?.roles.map(roleDisplayName).join(', ') ?? '';
  const allBranchRoles = selectedRoles.filter((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key));
  const branchPickerLocked = allBranchRoles.length > 0;
  const canEditBranchScope = canEditEmployee && !selectedIsOwner && selectedActive && !branchPickerLocked;
  const accessProjection = useMemo(
    () => projectGrantedMenus(
      selectedEmployee?.roles.map((role) => role.id) ?? [],
      matrix?.rows ?? [],
      matrix?.menus ?? [],
      MVP1_INDIVIDUAL_PERMISSION_MENU_IDS,
    ),
    [matrix, selectedEmployee],
  );

  const selectedBranchIds = selectedEmployee
    ? (selectedEmployee.branchScopeMode === 'ALL_BRANCHES' ? branches.map((b) => b.id) : selectedEmployee.branchScopeBranchIds)
    : [];
  const branchCountLabel = selectedBranchIds.length === branches.length ? 'ทุกสาขา' : `${selectedBranchIds.length} สาขา`;

  function selectEmployee(userId: string) {
    setSelectedUserId(userId);
    setRolePickerOpen(false);
    setEmployeeMenuOpen(false);
  }

  const withBusy = async (key: SaveKey, fn: () => Promise<void>, done?: string) => {
    setBusy(true); setPendingKey(key); setSavedAt(null);
    try { await fn(); setSavedAt(key); if (done) toast.success(done); } catch (e) {
      setError(localizedErrorMessage(e, locale, {
        fallback: 'error.save_failed',
        conflictCodes: {
          employee_draft_not_found: 'employee.error.draft_not_found',
          employee_draft_not_deletable: 'employee.error.draft_not_deletable',
        },
      }));
    }
    finally { setBusy(false); setPendingKey(null); }
  };

  async function toggleSelectedActive() {
    if (!selectedEmployee || selectedIsOwner || selectedIsDraft || !canDisableEmployee) return;
    await withBusy('status', async () => {
      await setEmployeeStatus(companyId, selectedEmployee.id, selectedActive ? 'SUSPENDED' : 'ACTIVE');
      await reload();
    }, selectedActive ? 'ระงับการใช้งานพนักงานแล้ว' : 'เปิดใช้งานพนักงานแล้ว');
  }

  function editSelectedEmployee() {
    // The wizard always saves roleIds and the API rejects any role write on an OWNER target, so
    // an owner row has no non-403 edit path (spec R5) — same guard as deleteSelectedEmployee.
    if (!selectedEmployee || selectedIsOwner || !canEditEmployee) return;
    setEmployeeMenuOpen(false);
    router.push(`/companies/${companyId}/settings/employees?edit=${encodeURIComponent(selectedEmployee.id)}`);
  }

  async function deleteSelectedEmployee() {
    if (!selectedEmployee || selectedIsOwner || !canDisableEmployee || busy) return;
    const isDraft = selectedEmployee.status === 'DRAFT';
    const confirmation = isDraft
      ? `ลบร่างพนักงาน ${employeeShortName(selectedEmployee)} ออกจากบริษัทนี้ใช่หรือไม่? บัญชีเข้าสู่ระบบเดิมและข้อมูลบริษัทอื่นจะไม่ถูกลบ`
      : `ปิดการใช้งานบัญชีของ ${employeeShortName(selectedEmployee)} ใช่หรือไม่?`;
    if (!(await confirm(confirmation))) return;
    await withBusy('status', async () => {
      try {
        if (isDraft) await deleteEmployeeDraft(companyId, selectedEmployee.id);
        else await setEmployeeStatus(companyId, selectedEmployee.id, 'DISABLED');
      } catch (e) {
        if (isDraft && (statusOf(e) === 404 || statusOf(e) === 409)) {
          setEmployeeMenuOpen(false);
          await reload();
        }
        throw e;
      }
      setEmployeeMenuOpen(false);
      await reload();
    }, isDraft ? 'ลบร่างพนักงานเรียบร้อยแล้ว' : 'ปิดการใช้งานพนักงานเรียบร้อยแล้ว');
  }

  async function confirmResetPassword() {
    if (!resetTarget || resetting) return;
    setResetting(true); setResetError(null);
    try {
      const result = await regenerateEmployeeCredential(companyId, resetTarget.id);
      setHandoff({ ...result, displayName: employeeShortName(resetTarget) });
      setResetTarget(null);
      await reload();
    } catch (e) {
      setResetError(localizedErrorMessage(e, locale, { 403: 'error.forbidden', fallback: 'error.save_failed' }));
    } finally { setResetting(false); }
  }

  async function toggleSelectedRole(roleId: string) {
    if (!selectedEmployee || rolePickerReadOnly) return;
    const nextRoleIds = selectedRoleIds.includes(roleId)
      ? (selectedRoleIds.length === 1 ? selectedRoleIds : selectedRoleIds.filter((id) => id !== roleId))
      : [...selectedRoleIds, roleId];
    if (nextRoleIds === selectedRoleIds) return;
    await withBusy('role', async () => {
      try {
        await updateEmployee(companyId, selectedEmployee.id, { roleIds: nextRoleIds });
      } catch (e) {
        // Permissions can be revoked mid-session: refetch so the picker stops offering what the
        // server now refuses (spec R10). withBusy still renders the generic forbidden message.
        if (statusOf(e) === 403) await reload();
        throw e;
      }
      await reload();
    }, 'บันทึกบทบาทพนักงานแล้ว');
  }

  async function toggleBranch(branchId: string) {
    if (!selectedEmployee || selectedIsOwner || !selectedActive || !canEditEmployee || branchPickerLocked) return;
    const exists = selectedBranchIds.includes(branchId);
    if (exists && selectedBranchIds.length === 1) return;
    const next = exists ? selectedBranchIds.filter((id) => id !== branchId) : [...selectedBranchIds, branchId];
    const allSelected = next.length === branches.length;
    await withBusy('branch', async () => {
      await updateEmployee(companyId, selectedEmployee.id, {
        branchScopeMode: allSelected ? 'ALL_BRANCHES' : 'SELECTED_BRANCHES',
        branchIds: allSelected ? [] : next,
        defaultBranchId: next.includes(selectedEmployee.defaultBranchId ?? '') ? selectedEmployee.defaultBranchId : (next[0] ?? null),
      });
      await reload();
    }, 'บันทึกขอบเขตสาขาแล้ว');
  }

  async function selectAllBranches() {
    if (!selectedEmployee || selectedIsOwner || !selectedActive || !canEditEmployee || branchPickerLocked) return;
    await withBusy('branch', async () => {
      await updateEmployee(companyId, selectedEmployee.id, {
        branchScopeMode: 'ALL_BRANCHES',
        branchIds: [],
        defaultBranchId: selectedEmployee.defaultBranchId ?? null,
      });
      setBranchPickerOpen(false);
      await reload();
    }, 'ให้สิทธิ์ทุกสาขาแล้ว');
  }

  if (loading) {
    return (
      <div className="mangmee-page">
        <LoadingState label="กำลังโหลด..." />
      </div>
    );
  }

  return (
    <MangmeePage
      title="รายชื่อพนักงาน"
      description="ดูตำแหน่งงาน และจัดการบทบาท สิทธิ์ สาขา และสถานะบัญชีของพนักงานเป็นรายคน"
      actions={viewerPermissions.includes('access.employee.create') && (
        <Link href={`/companies/${companyId}/settings/employees`} className="mangmee-btn mangmee-btn-primary">
          <PlusIcon className="h-4 w-4" /> เพิ่มพนักงาน
        </Link>
      )}
    >
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { value: 'all', label: 'พนักงานทั้งหมด', count: employees.length, tone: 'slate', icon: <UserIcon className="h-5 w-5" /> },
          { value: 'ACTIVE', label: 'ใช้งาน', count: employees.filter((employee) => employee.status === 'ACTIVE').length, tone: 'brand', icon: <CheckLineIcon className="h-5 w-5" /> },
          { value: 'DRAFT', label: 'แบบร่าง', count: employees.filter((employee) => employee.status === 'DRAFT').length, tone: 'amber', icon: <FileIcon className="h-5 w-5" /> },
          { value: 'INACTIVE', label: 'ปิดใช้งาน', count: employees.filter((employee) => employee.status !== 'ACTIVE' && employee.status !== 'DRAFT').length, tone: 'danger', icon: <LockIcon className="h-5 w-5" /> },
        ] as const).map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={statusFilter === item.value}
            onClick={() => setStatusFilter((current) => current === item.value ? 'all' : item.value)}
            className={cx(
              'mangmee-card flex h-full min-w-0 items-center gap-3 p-4 text-left transition hover:!border-brand-200',
              statusFilter === item.value && '!border-brand-300 !bg-brand-25',
            )}
          >
            <MangmeeIconFrame tone={item.tone} className="h-10 w-10 rounded-lg">
              {item.icon}
            </MangmeeIconFrame>
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-gray-500">{item.label}</span>
              <span className="mt-1 block text-2xl font-extrabold tabular-nums text-gray-900">{item.count}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="min-w-0 xl:sticky xl:top-6">
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 px-2">
              <h2 className="text-sm font-extrabold text-gray-400">พนักงานทั้งหมด</h2>
              <span className="text-sm font-extrabold text-gray-400">{filteredEmployees.length} คน</span>
            </div>

            <label className="relative mt-4 block">
              <SearchIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                className="mangmee-input h-10 rounded-lg pr-10 text-sm" style={{ paddingRight: '2.5rem' }}
                placeholder="ค้นหาชื่อ ตำแหน่งงาน หรือเบอร์โทร..."
                aria-label="ค้นหาพนักงาน"
              />
            </label>

            <div className="mt-4">
              <ThemedSelect
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                aria-label="เลือกบทบาท"
                className="h-10 rounded-lg text-sm font-extrabold"
              >
                {filters.map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}
              </ThemedSelect>
            </div>

            <div className="mt-5 grid max-h-[min(60vh,640px)] gap-2 overflow-y-auto pr-1 xl:max-h-[calc(100dvh-320px)]">
              {filteredEmployees.map((employee) => (
                <EmployeeRow
                  key={employee.id} employee={employee} roles={employee.roles}
                  selected={employee.id === activeUserId} onSelect={() => selectEmployee(employee.id)}
                />
              ))}
              {filteredEmployees.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-semibold text-gray-400">
                  ไม่พบพนักงานที่ตรงกับตัวกรอง
                </div>
              )}
            </div>
          </MangmeeCard>
        </div>

        {!selectedEmployee ? (
          <MangmeeCard className="p-6 text-sm text-gray-400">{employees.length === 0 ? 'ยังไม่มีพนักงานในบริษัทนี้' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง กรุณาปรับตัวกรองหรือคำค้นหา'}</MangmeeCard>
        ) : (
          <div className="grid min-w-0 gap-5">
            <MangmeeCard className="relative p-5">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <EmployeeAvatar employee={selectedEmployee} color={selectedRole ? colorForRole(selectedRole) : '#667085'} active={Boolean(selectedActive)} className="h-[52px] w-[52px] rounded-xl text-lg" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <h2 className="truncate text-xl font-extrabold text-gray-900">{employeeShortName(selectedEmployee)}</h2>
                      {selectedIsDraft && <DraftBadge />}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-gray-600">ตำแหน่งงาน: {selectedEmployee.jobTitle || 'ยังไม่ระบุ'}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-gray-400">{selectedEmployee.phoneNumber}</p>
                  </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-end gap-5">
                  {selectedRoles.length > 0 && (
                    <div className="min-w-0">
                      <div className="flex min-h-5 items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">บทบาทและสิทธิ์ระบบ</span>
                        <span
                          aria-live="polite"
                          className={cx('text-xs font-bold', savedAt === 'role' ? 'text-brand-600' : 'text-gray-400')}
                        >
                          {busy && pendingKey === 'role' ? 'กำลังบันทึก...' : savedAt === 'role' ? 'บันทึกแล้ว' : null}
                        </span>
                      </div>
                      <div className="relative mt-1" ref={rolePickerRef}>
                        {rolePickerReadOnly ? (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedRoles.map((role) => <RoleBadge key={role.id} role={role} />)}
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRolePickerOpen((open) => !open)}
                            className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 hover:border-brand-200 hover:bg-brand-25 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-haspopup="listbox"
                            aria-expanded={rolePickerOpen}
                          >
                            <span className="max-w-52 truncate text-sm font-extrabold text-gray-700">{selectedRoleNames}</span>
                            <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
                          </button>
                        )}
                        {rolePickerOpen && !rolePickerReadOnly && (
                          <div role="listbox" className="absolute left-0 top-10 z-20 w-60 max-w-[min(15rem,80vw)] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {roleOptions.map((role) => (
                              <button
                                key={role.id} type="button" role="option" aria-selected={selectedRoleIds.includes(role.id)} disabled={busy}
                                onClick={() => void toggleSelectedRole(role.id)}
                                className={cx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-extrabold hover:bg-gray-50 disabled:opacity-60', selectedRoleIds.includes(role.id) ? 'text-brand-700' : 'text-gray-700')}
                              >
                                <span className="min-w-0 truncate">{roleDisplayName(role)}</span>
                                {selectedRoleIds.includes(role.id) && <CheckLineIcon className="h-4 w-4 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {selectedIsOwner
                        ? <p className="mt-1 text-xs font-semibold text-gray-400">บทบาทเจ้าของกิจการเปลี่ยนไม่ได้</p>
                        : isSelfEmployee(selectedEmployee, viewerUserId)
                          ? <p className="mt-1 text-xs font-semibold text-gray-400">บทบาทของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้</p>
                          : <p className="mt-1 text-xs font-semibold text-gray-400">เลือกได้หลายบทบาท ระบบจะรวมสิทธิ์จากทุกบทบาท</p>}
                    </div>
                  )}

                  <div className="flex items-end gap-3">
                    <span className="text-sm font-semibold text-gray-500">
                      <span className="flex min-h-5 items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">สถานะบัญชี</span>
                        <span
                          aria-live="polite"
                          className={cx('text-xs font-bold', savedAt === 'status' ? 'text-brand-600' : 'text-gray-400')}
                        >
                          {busy && pendingKey === 'status' ? 'กำลังบันทึก...' : savedAt === 'status' ? 'บันทึกแล้ว' : null}
                        </span>
                      </span>
                      <MangmeeBadge tone={selectedIsDraft ? 'amber' : selectedActive ? 'brand' : 'danger'} className="mt-1">
                        {selectedIsDraft ? 'Draft' : selectedActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </MangmeeBadge>
                    </span>
                    {canDisableEmployee && <ToggleSwitch checked={Boolean(selectedActive)} disabled={selectedIsOwner || selectedIsDraft || busy} onChange={() => void toggleSelectedActive()} label="เปิดปิดสถานะบัญชี" />}
                    {!selectedIsOwner && (canEditEmployee || canDisableEmployee || canIssueCredential) && (
                      <div className="relative" ref={employeeMenuRef}>
                        <button
                          type="button" onClick={() => setEmployeeMenuOpen((open) => !open)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                          aria-label="เมนูพนักงาน"
                          aria-haspopup="menu"
                          aria-expanded={employeeMenuOpen}
                        >
                          <HorizontalDotsIcon className="h-5 w-5" />
                        </button>
                        {employeeMenuOpen && (
                          <div role="menu" className="fixed inset-x-4 bottom-4 z-20 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm font-extrabold shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-10 sm:w-52">
                            {canEditEmployee && <button type="button" role="menuitem" disabled={busy} onClick={editSelectedEmployee} className="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50">แก้ไขข้อมูลพนักงาน</button>}
                            {canIssueCredential && <button type="button" role="menuitem" disabled={busy} onClick={() => { setEmployeeMenuOpen(false); setResetError(null); setResetTarget(selectedEmployee); }} className="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50">รีเซ็ตรหัสผ่าน</button>}
                            {canDisableEmployee && <button type="button" role="menuitem" disabled={busy} onClick={() => void deleteSelectedEmployee()} className="w-full px-3 py-2 text-left text-error-700 hover:bg-error-50 disabled:opacity-50">{selectedIsDraft ? 'ลบร่างพนักงาน' : 'ลบพนักงาน'}</button>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </MangmeeCard>

            <MangmeeCard className="p-5 sm:p-6">
              <div data-testid="access-permission-summary">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-extrabold text-gray-900">สิทธิ์การใช้งานของ {employeeShortName(selectedEmployee)}</h2>
                  {selectedIsOwner ? (
                    <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-gray-500">
                      สิทธิ์มาจากบทบาทเจ้าของกิจการ — ปรับสิทธิ์ไม่ได้
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="max-w-4xl text-sm font-semibold leading-6 text-gray-500">
                        สิทธิ์มาจากบทบาท {selectedRoleNames || '—'}
                        {selectedEmployee.roles.length > 1
                          ? ' — ระบบรวมสิทธิ์จากทุกบทบาท'
                          : ' — พนักงานทุกคนที่ใช้บทบาทนี้ได้สิทธิ์ชุดเดียวกัน'}
                      </p>
                      {canManageRoles && (
                        <Link href={`/companies/${companyId}/settings/permissions`} className="text-sm font-extrabold text-brand-700 hover:underline">
                          แก้สิทธิ์ของบทบาท →
                        </Link>
                      )}
                    </div>
                  )}
                  <p className="mt-2 max-w-4xl text-xs font-semibold leading-5 text-gray-400">
                    {accountAccessNotice(selectedEmployee.status)}
                  </p>
                </div>
                {!permissionError && accessProjection.complete && (
                  <MangmeeBadge tone="brand" className="shrink-0 tabular-nums">
                    ใช้งานได้ {accessProjection.grantedCount} เมนู
                  </MangmeeBadge>
                )}
              </div>

              <div className="mt-5 grid gap-4">
                {permissionError ? (
                  <div role="alert" data-testid="access-permission-error" className="rounded-xl border border-error-200 bg-error-50 p-4">
                    <p className="text-sm font-extrabold text-error-700">โหลดข้อมูลสิทธิ์ไม่สำเร็จ จึงยังสรุปสิทธิ์ไม่ได้</p>
                    <p className="mt-1 text-xs font-semibold text-error-600">{permissionError}</p>
                    <button type="button" onClick={() => void reload()} className="mt-3 text-sm font-extrabold text-error-700 hover:underline">
                      ลองโหลดใหม่
                    </button>
                  </div>
                ) : selectedEmployee.roles.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm font-semibold text-gray-500">
                    ยังไม่ได้กำหนดบทบาท จึงยังไม่มีข้อมูลสิทธิ์
                  </p>
                ) : !accessProjection.complete ? (
                  <div role="alert" data-testid="access-permission-error" className="rounded-xl border border-error-200 bg-error-50 p-4">
                    <p className="text-sm font-extrabold text-error-700">ข้อมูลบทบาทกับสิทธิ์ไม่ตรงกัน กรุณาลองโหลดใหม่</p>
                    <button type="button" onClick={() => void reload()} className="mt-3 text-sm font-extrabold text-error-700 hover:underline">
                      ลองโหลดใหม่
                    </button>
                  </div>
                ) : accessProjection.groups.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm font-semibold text-gray-500">
                    ยังไม่มีเมนูที่ใช้งานได้จากบทบาทที่กำหนด
                  </p>
                ) : accessProjection.groups.map(({ group, menus: groupMenus }) => (
                  <div key={group} className="grid gap-1">
                    <h3 className="px-3 text-xs font-extrabold uppercase tracking-wide text-gray-400">{MENU_GROUP_LABEL_TH[group]}</h3>
                    {groupMenus.map(({ menu, labels }) => (
                      <div
                        key={menu.id}
                        data-testid="access-permission-row"
                        data-menu-id={menu.id}
                        className="grid min-w-0 gap-3 rounded-xl bg-white px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] sm:items-center"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <MenuIconFrame menu={menu} className="h-8 w-8" />
                          <span data-testid="access-permission-menu-label" className="min-w-0 whitespace-normal break-words text-sm font-extrabold leading-6 text-gray-900">
                            {menu.labelTh}
                          </span>
                        </div>
                        <div className="min-w-0 sm:text-right">
                          <span className="block text-[11px] font-bold text-gray-400">สิทธิ์ที่มี</span>
                          <div
                            data-testid="access-permission-actions"
                            aria-label={`สิทธิ์ที่มีสำหรับ ${menu.labelTh}`}
                            className="mt-1 flex flex-wrap gap-x-3 gap-y-1 sm:justify-end"
                          >
                            {labels.map((label) => (
                              <span key={label} className="inline-flex items-center gap-1 text-sm font-extrabold text-brand-700">
                                <CheckLineIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              </div>
            </MangmeeCard>

            {branchError ? (
              <MangmeeCard className="p-5 sm:p-6">
                <div role="alert" data-testid="branch-access-error" className="rounded-xl border border-error-200 bg-error-50 p-4">
                  <h2 className="text-xl font-extrabold text-gray-900">สาขาที่เข้าถึงได้</h2>
                  <p className="mt-2 text-sm font-extrabold text-error-700">โหลดข้อมูลสาขาไม่สำเร็จ จึงยังสรุปขอบเขตสาขาไม่ได้</p>
                  <p className="mt-1 text-xs font-semibold text-error-600">{branchError}</p>
                  <button type="button" onClick={() => void reload()} className="mt-3 text-sm font-extrabold text-error-700 hover:underline">
                    ลองโหลดใหม่
                  </button>
                </div>
              </MangmeeCard>
            ) : branches.length > 0 && (
              <MangmeeCard className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-extrabold text-gray-900">สาขาที่เข้าถึงได้</h2>
                    <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-500">
                      เจ้าของร้านกำหนดสาขาที่พนักงานคนนี้เข้าถึง · เวลาเขาล็อกอินจะเห็นเฉพาะสาขาที่ได้รับมอบหมาย (อย่างน้อย 1 สาขา)
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {(busy && pendingKey === 'branch' || savedAt === 'branch') && <span
                      aria-live="polite"
                      className={cx('text-xs font-bold', savedAt === 'branch' ? 'text-brand-600' : 'text-gray-400')}
                    >
                      {busy && pendingKey === 'branch' ? 'กำลังบันทึก...' : 'บันทึกแล้ว'}
                    </span>}
                    <span data-testid="employee-branch-count" className="rounded-full bg-blue-light-50 px-4 py-2 text-sm font-extrabold tabular-nums text-blue-light-500">{branchCountLabel}</span>
                  </div>
                </div>

                {canEditBranchScope && <div className="mangmee-segmented mt-5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void selectAllBranches()}
                    aria-pressed={selectedEmployee.branchScopeMode === 'ALL_BRANCHES' && !branchPickerOpen}
                    className={cx(
                      'mangmee-tab disabled:cursor-not-allowed disabled:opacity-50',
                      selectedEmployee.branchScopeMode === 'ALL_BRANCHES' && !branchPickerOpen && 'mangmee-tab-active',
                    )}
                  >
                    ทุกสาขา
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBranchPickerOpen(true)}
                    aria-pressed={selectedEmployee.branchScopeMode === 'SELECTED_BRANCHES' || branchPickerOpen}
                    className={cx(
                      'mangmee-tab disabled:cursor-not-allowed disabled:opacity-50',
                      (selectedEmployee.branchScopeMode === 'SELECTED_BRANCHES' || branchPickerOpen) && 'mangmee-tab-active',
                    )}
                  >
                    เลือกสาขา
                  </button>
                </div>}

                {!canEditBranchScope && selectedEmployee.branchScopeMode === 'ALL_BRANCHES' && (
                  <button
                    type="button"
                    className="mangmee-btn mangmee-btn-secondary mt-5"
                    aria-expanded={branchPickerOpen}
                    aria-controls="employee-accessible-branches"
                    onClick={() => setBranchPickerOpen((open) => !open)}
                  >
                    {branchPickerOpen ? 'ซ่อนรายชื่อสาขา' : 'ดูสาขาที่เข้าถึง'}
                  </button>
                )}

                {(selectedEmployee.branchScopeMode === 'SELECTED_BRANCHES' || branchPickerOpen) && (
                  <div id="employee-accessible-branches" className="mt-5 flex min-w-0 flex-wrap gap-2">
                    {branches.filter((branch) => canEditBranchScope || selectedBranchIds.includes(branch.id)).map((branch) => {
                      const selected = selectedBranchIds.includes(branch.id);
                      const lastBranchLocked = selected && selectedBranchIds.length === 1;
                      const otherwiseDisabled = selectedIsOwner || !selectedActive || busy || branchPickerLocked;
                      return canEditBranchScope ? (
                        <BranchAccessChip
                          key={branch.id} label={branch.name} selected={selected}
                          disabled={otherwiseDisabled || lastBranchLocked}
                          title={lastBranchLocked && !otherwiseDisabled ? 'ต้องมีอย่างน้อย 1 สาขา' : undefined}
                          onToggle={() => void toggleBranch(branch.id)}
                        />
                      ) : (
                        <span key={branch.id} className="inline-flex h-10 max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-25 px-4 text-sm font-extrabold text-brand-700">
                          <CheckLineIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">{branch.name}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {branchPickerLocked && (
                  <p className="mt-3 text-sm font-semibold text-gray-400">
                    บทบาท {allBranchRoles.map(roleDisplayName).join(', ')} ต้องเห็นข้อมูลทุกสาขา จึงจำกัดสาขาไม่ได้
                  </p>
                )}
              </MangmeeCard>
            )}
          </div>
        )}
      </div>

      <Modal
        open={resetTarget !== null}
        title="รีเซ็ตรหัสผ่านพนักงาน"
        size="sm"
        onClose={() => { if (!resetting) { setResetTarget(null); setResetError(null); } }}
        footer={(
          <>
            <button
              type="button" disabled={resetting} onClick={() => setResetTarget(null)}
              className="inline-flex h-10 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="button" disabled={resetting} onClick={() => void confirmResetPassword()}
              className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-extrabold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {resetting ? 'กำลังรีเซ็ต...' : 'ยืนยันรีเซ็ตรหัสผ่าน'}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          {resetError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{resetError}</div>}
          <p className="text-sm font-semibold text-gray-700">
            ยืนยันรีเซ็ตรหัสผ่านของ <span className="font-extrabold text-gray-900">{resetTarget ? employeeShortName(resetTarget) : ''}</span> ใช่หรือไม่
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            รหัสผ่านเดิมจะใช้งานไม่ได้ทันที และพนักงานต้องตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบครั้งถัดไป
          </p>
        </div>
      </Modal>

      <Modal
        open={handoff !== null}
        title="รีเซ็ตรหัสผ่านสำเร็จ"
        size="sm"
        onClose={() => setHandoff(null)}
        footer={(
          <button
            type="button" onClick={() => setHandoff(null)}
            className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-extrabold text-white hover:bg-brand-700"
          >
            ปิด
          </button>
        )}
      >
        {handoff && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">รหัสผ่านชั่วคราวของ {handoff.displayName} — แสดงครั้งเดียวเท่านั้น</p>
            <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <p className="font-semibold text-gray-500">ชื่อผู้ใช้: <span className="font-mono font-extrabold text-gray-900">{handoff.username}</span></p>
              <p className="font-semibold text-gray-500">รหัสผ่าน: <span className="font-mono font-extrabold text-gray-900">{handoff.temporaryPassword}</span></p>
              {handoff.expiresAt && (
                <p className="font-semibold text-gray-500">ใช้ได้ถึง: <span className="font-extrabold text-gray-900">{formatThaiDateTime(handoff.expiresAt)}</span></p>
              )}
            </div>
            {/* `lineNotified` is absent on older API builds — treat that as "not delivered". */}
            <p className={cx('rounded-lg border px-3 py-2 text-sm font-semibold', handoff.lineNotified ? 'border-brand-200 bg-brand-25 text-brand-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
              {handoff.lineNotified
                ? 'ส่งรหัสผ่านชั่วคราวไปที่ LINE ของพนักงานแล้ว'
                : 'พนักงานยังไม่ได้ผูก LINE กรุณาส่งรหัสผ่านให้พนักงานโดยตรง'}
            </p>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </MangmeePage>
  );
}
