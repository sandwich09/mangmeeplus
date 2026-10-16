'use client';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ALL_BRANCH_ROLE_KEYS, type CapabilityPackView, type EmployeeCredentialHandoff, type EmployeeLineLinkPackage, type EmployeeSummary, type MenuDefinition, type PermissionMatrix as PermissionMatrixDto, type RoleSummary } from '@watchdog-bms/contracts';
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
import { FilterTabs } from '@/common/components/tabs';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { Notice } from '@/common/components/notice';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listBranches as listCompanyBranches, type Branch } from '../branch-settings/branches.api';
import {
  deleteEmployeeDraft,
  issueEmployeeLineLinkToken,
  employeeShortName,
  getAccessMatrix,
  listCapabilityPacks,
  listEmployees,
  listRoles,
  regenerateEmployeeCredential,
  setEmployeeStatus,
  updateEmployee,
} from './employee-access.api';
import { DisbursementVoucherAccessHint } from './DisbursementVoucherAccessHint';
import { RoleCanDoList } from './EmployeeAccessPages';
import { accountAccessNotice, MENU_GROUP_LABEL_TH, projectGrantedMenus } from './access-overview.model';
import { EMPLOYEE_BRANCH_SCOPE_HELP, assignableRoleOptions, isOperationalRoleTargetReadOnly, isRoleFieldReadOnly, isSelfEmployee, roleCanDoPacks, roleDisplayName } from './role-picker.logic';
import { localizedErrorMessage, statusOf } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { DisplayNameHistoryDisclosure } from '../company-profile/AccountDisplayName';
import { MemberPayoutAccountLine } from '../reimbursements/ReimbursementPayout';

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
    <span title={roleDisplayName(role)} className={cx('inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold', className)} style={{ color, backgroundColor: `${color}1F` }}>
      {roleDisplayName(role)}
      {withCaret && <ChevronDownIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

function DraftBadge() {
  return <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 text-xs font-extrabold text-gray-600">ร่าง</span>;
}

function MenuIconFrame({ menu, className }: { menu: MenuDefinition; className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 leading-none [&>svg]:m-auto [&>svg]:block [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', className)} aria-hidden="true">
      {MENU_ICON[menu.id]}
    </span>
  );
}

function ToggleSwitch({ checked, disabled = false, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: () => void; label: string }) {
  // The button is the 44 px target (thai-ux-standard 6.4); the track inside keeps its size.
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={cx('inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full sm:h-10', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
    >
      <span className={cx('relative inline-flex h-6 w-11 items-center rounded-full transition', checked ? 'bg-brand-500' : 'bg-gray-300')}>
        <span className={cx('absolute h-5 w-5 rounded-full bg-white shadow-sm transition', checked ? 'right-0.5' : 'left-0.5')} />
      </span>
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
        'grid min-h-[64px] w-full grid-cols-[38px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-[11px] border px-[11px] py-2.5 text-left transition',
        // The highlight says "shown at the right": true only where the two columns stand side by side.
        selected ? 'border-gray-200 bg-white lg:border-brand-300 lg:bg-brand-25 lg:shadow-[inset_3px_0_0_var(--color-brand-500)]' : 'border-gray-200 bg-white hover:border-brand-100 hover:bg-gray-50',
      )}
    >
      <EmployeeAvatar employee={employee} color={primaryRole ? colorForRole(primaryRole) : '#667085'} active={active} />
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-gray-900">{employeeShortName(employee)}</span>
          {/* A state is said in a word, never by a coloured dot alone (thai-ux-standard 6.3). */}
          {employee.status === 'DRAFT' ? <DraftBadge /> : !active && <MangmeeBadge tone="slate">ปิดใช้งาน</MangmeeBadge>}
        </span>
        {employee.accountDisplayName && employee.accountDisplayName !== employee.displayName && <span className="mt-0.5 block break-words text-sm text-gray-500">ชื่อที่แสดง: {employee.accountDisplayName}</span>}
        <span className="mt-0.5 block text-sm text-gray-500">{employee.lineLinked ? 'เชื่อม LINE แล้ว' : 'ยังไม่ได้เชื่อม LINE'}</span>
        <span className="mt-0.5 block break-words text-sm text-gray-600">{employee.jobTitle || 'ยังไม่ระบุตำแหน่งงาน'}</span>
        <span className="mt-0.5 block text-xs text-gray-500">
          {employee.branchScopeMode === 'ALL_BRANCHES' ? 'ทุกสาขา' : `${employee.branchScopeBranchIds.length} สาขา`}
        </span>
      </span>
      {roles.length > 0 && (
        <span className="col-start-2 flex min-w-0 flex-wrap gap-1">
          {roles.map((role) => <RoleBadge key={role.id} role={role} className="max-w-full whitespace-normal [overflow-wrap:anywhere] py-1" />)}
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
        'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 py-1.5 text-left text-sm font-semibold transition sm:min-h-10',
        selected ? 'border-brand-200 bg-brand-25 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-100 hover:bg-gray-50',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
      )}
    >
      {selected ? <CheckLineIcon className="h-4 w-4 shrink-0" /> : <PlusIcon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

// MVP 1 exposes only the CRM, bill-capture, and sales-document surfaces here.
const MVP1_INDIVIDUAL_PERMISSION_MENU_IDS = new Set<MenuDefinition['id']>([
  'dashboard', 'inbox', 'customers', 'booking', 'crmreport', 'expenses', 'salesdoc',
]);

type SaveKey = 'role' | 'branch' | 'status' | 'line';

export function IndividualPermissionsPrototypePage({ companyId, viewerPermissions = [], viewerUserId, viewerBranchIds, disbursementEntryOpen = false }: { disbursementEntryOpen?: boolean; companyId: string; viewerPermissions?: string[]; viewerUserId?: string; viewerBranchIds?: string[] }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const pathname = usePathname();
  // The opened person is in the address (`?person=`), so the phone's back gesture returns to the list.
  const personParam = useSearchParams().get('person');
  const toast = useToast();
  // Read-only viewers hold access.employee.read without the write keys; mutation controls stay hidden.
  const canEditEmployee = viewerPermissions.includes('access.employee.update');
  const canDisableEmployee = viewerPermissions.includes('access.employee.disable');
  const canManageRoles = viewerPermissions.includes('access.role.manage');
  const canIssueLineLink = viewerPermissions.includes('access.employee.line_link.issue');
  const canIssueCredential = viewerPermissions.includes('access.employee.credential.issue');
  // The choices catalogue has its own read right; a reader without it keeps the menu summary alone.
  const canReadPacks = canManageRoles || viewerPermissions.includes('access.capability_pack.read');
  const [packs, setPacks] = useState<CapabilityPackView[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrixDto | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'DRAFT' | 'INACTIVE'>('all');
  const [query, setQuery] = useState('');
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<SaveKey | null>(null);
  const [savedAt, setSavedAt] = useState<SaveKey | null>(null);
  // Password reset: confirm dialog target → handoff dialog with the one-time temporary password.
  const [resetTarget, setResetTarget] = useState<EmployeeSummary | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<(EmployeeCredentialHandoff & { displayName: string }) | null>(null);
  const [lineLink, setLineLink] = useState<{ employeeId: string; companyId: string; package: EmployeeLineLinkPackage } | null>(null);
  const [handoffCopied, setHandoffCopied] = useState(false);
  const rolePickerRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rolePickerRef, useCallback(() => setRolePickerOpen(false), []));
  const { confirm, confirmDialog } = useConfirm();

  const reload = useCallback(async () => {
    setError(null);
    setPermissionError(null);
    setBranchError(null);
    const [employeesR, rolesR, matrixR, branchesR, packsR] = await Promise.allSettled([
      listEmployees(companyId),
      listRoles(companyId),
      getAccessMatrix(companyId),
      listCompanyBranches(companyId),
      canReadPacks ? listCapabilityPacks(companyId) : Promise.resolve(null),
    ]);
    setPacks(packsR.status === 'fulfilled' && packsR.value ? packsR.value.modules.flatMap((module) => module.packs) : null);
    if (employeesR.status === 'fulfilled') {
      setEmployees(employeesR.value);
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
      setBranches(branchesR.value.filter((branch) => branch.status === 'ACTIVE'));
    } else {
      setBranches([]);
      setBranchError(localizedErrorMessage(branchesR.reason, locale, { fallback: 'error.load_failed' }));
    }
    setLoading(false);
  }, [canReadPacks, companyId, locale]);

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
        || (employee.accountDisplayName ?? '').toLowerCase().includes(normalizedQuery)
        || (employee.nickname ?? '').toLowerCase().includes(normalizedQuery)
        || (employee.jobTitle ?? '').toLowerCase().includes(normalizedQuery)
        || employee.phoneNumber.toLowerCase().includes(normalizedQuery);
      const statusMatches = statusFilter === 'all'
        || employee.status === statusFilter
        || (statusFilter === 'INACTIVE' && employee.status !== 'ACTIVE' && employee.status !== 'DRAFT');
      return roleMatches && queryMatches && statusMatches;
    });
  }, [employees, query, roleFilter, statusFilter]);

  // The person in the address stays on screen whatever the list's filter says; with nobody opened, a
  // wide screen shows the first of the list.
  const opened = employees.find((e) => e.id === personParam) ?? null;
  const activeUserId = opened?.id ?? filteredEmployees[0]?.id ?? null;
  useEffect(() => {
    setBranchPickerOpen(false);
    setRolePickerOpen(false);
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

  const selectedRoleNames = selectedEmployee?.roles.map((role) => roleDisplayName(roleById.get(role.id) ?? role)).join(', ') ?? '';
  const allBranchRoles = selectedRoles.filter((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key));
  const branchPickerLocked = allBranchRoles.length > 0;
  const scopeOutsideViewer = viewerBranchIds !== undefined && selectedEmployee && (
    selectedEmployee.branchScopeMode === 'ALL_BRANCHES'
    || [...selectedEmployee.branchScopeBranchIds, ...(selectedEmployee.defaultBranchId ? [selectedEmployee.defaultBranchId] : [])].some((id) => !viewerBranchIds.includes(id))
  );
  const canEditBranchScope = canEditEmployee && !selectedIsOwner && selectedActive && !branchPickerLocked && !scopeOutsideViewer;
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
    ? (selectedEmployee.branchScopeMode === 'ALL_BRANCHES' ? branches.map((b) => b.id) : selectedEmployee.branchScopeBranchIds.filter((id) => branches.some((branch) => branch.id === id)))
    : [];
  const branchCountLabel = selectedBranchIds.length === branches.length ? 'ทุกสาขา' : `${selectedBranchIds.length} สาขา`;

  function selectEmployee(userId: string) {
    setRolePickerOpen(false);
    const url = `${pathname}?person=${encodeURIComponent(userId)}`;
    // Below the two-column width the person is their own view: a new entry, so "back" returns to the list.
    if (window.innerWidth < 1024) { window.history.pushState(null, '', url); window.scrollTo({ top: 0 }); } else window.history.replaceState(null, '', url);
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
    const name = employeeShortName(selectedEmployee);
    if (selectedActive && !await confirm({ title: `ปิดใช้งาน ${name}`, message: 'เข้าสู่ระบบของร้านนี้ไม่ได้และคืนที่นั่งให้ร้าน', confirmLabel: 'ปิดใช้งาน', cancelLabel: 'ไม่ปิด', variant: 'danger' })) return;
    await withBusy('status', async () => {
      await setEmployeeStatus(companyId, selectedEmployee.id, selectedActive ? 'DISABLED' : 'ACTIVE');
      await reload();
    }, selectedActive ? `ปิดใช้งาน ${name} แล้ว` : `เปิดใช้งาน ${name} แล้ว`);
  }

  function editSelectedEmployee() {
    // The wizard always saves roleIds and the API rejects any role write on an OWNER target, so
    // an owner row has no non-403 edit path (spec R5) — same guard as deleteSelectedEmployee.
    if (!selectedEmployee || selectedIsOwner || !canEditEmployee) return;
    router.push(`/companies/${companyId}/settings/employees?edit=${encodeURIComponent(selectedEmployee.id)}`);
  }

  async function deleteSelectedEmployee() {
    if (!selectedEmployee || selectedIsOwner || !selectedIsDraft || !canDisableEmployee || busy) return;
    const name = employeeShortName(selectedEmployee);
    if (!await confirm({ title: `ลบร่างพนักงาน ${name}?`, message: 'ร่างนี้จะหายจากร้านนี้ บัญชีเข้าสู่ระบบเดิมของเขายังอยู่', confirmLabel: 'ลบร่างพนักงาน', cancelLabel: 'ไม่ลบ', variant: 'danger' })) return;
    await withBusy('status', async () => {
      try { await deleteEmployeeDraft(companyId, selectedEmployee.id); }
      catch (e) {
        if (statusOf(e) === 404 || statusOf(e) === 409) await reload();
        throw e;
      }
      await reload();
    }, `ลบร่างพนักงาน ${name} แล้ว`);
  }

  async function issueSelectedLineLink() {
    if (!selectedEmployee || !canIssueLineLink || busy) return;
    await withBusy('line', async () => {
      const result = await issueEmployeeLineLinkToken(companyId, selectedEmployee.id);
      setLineLink({ employeeId: selectedEmployee.id, companyId, package: result });
    }, 'ออกลิงก์เชื่อม LINE แล้ว');
  }

  async function copyLineLink() {
    if (!lineLink || !canIssueLineLink) return;
    try {
      await navigator.clipboard.writeText(lineLink.package.linkUrl);
      toast.success('คัดลอกลิงก์แล้ว');
    } catch {
      setError('คัดลอกลิงก์ไม่ได้ เลือกลิงก์แล้วคัดลอกอีกครั้ง');
    }
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

  async function changeSelectedRole(roleId: string) {
    if (!selectedEmployee || rolePickerReadOnly || busy) return;
    if (selectedRoleIds.length === 1 && selectedRoleIds[0] === roleId) {
      setRolePickerOpen(false);
      return;
    }
    const roleName = (id: string | undefined) => { const role = roles.find((item) => item.id === id); return role ? roleDisplayName(role) : 'ไม่มีบทบาท'; };
    const personName = employeeShortName(selectedEmployee);
    if (!await confirm({ title: `เปลี่ยนบทบาทของ ${personName}?`, message: `จาก ${roleName(selectedRoleIds[0])} เป็น ${roleName(roleId)} มีผลทันที`, confirmLabel: 'เปลี่ยนบทบาท', cancelLabel: 'ไม่เปลี่ยน', variant: 'primary' })) return;
    await withBusy('role', async () => {
      try {
        const updated = await updateEmployee(companyId, selectedEmployee.id, { roleIds: [roleId] });
        setEmployees((current) => current.map((employee) => employee.id === updated.id ? updated : employee));
        setRolePickerOpen(false);
        // Keep the edited employee visible even when their old role was the active filter.
        setRoleFilter('all');
      } catch (e) {
        // Permissions can be revoked mid-session: refetch so the picker stops offering what the
        // server now refuses (spec R10). withBusy still renders the generic forbidden message.
        if (statusOf(e) === 403) await reload();
        throw e;
      }
      await reload();
    }, `เปลี่ยนบทบาทของ ${personName} เป็น ${roleName(roleId)} แล้ว`);
  }

  async function toggleBranch(branchId: string) {
    if (!selectedEmployee || !canEditBranchScope || (viewerBranchIds !== undefined && !viewerBranchIds.includes(branchId))) return;
    const exists = selectedBranchIds.includes(branchId);
    if (exists && selectedBranchIds.length === 1) return;
    const next = exists ? selectedBranchIds.filter((id) => id !== branchId) : [...selectedBranchIds, branchId];
    const allSelected = viewerBranchIds === undefined && next.length === branches.length;
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
    if (!selectedEmployee || !canEditBranchScope || viewerBranchIds !== undefined) return;
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
      <MangmeePage title="รายชื่อพนักงาน">
        <LoadingState label="กำลังโหลด..." />
      </MangmeePage>
    );
  }

  return (
    <MangmeePage
      title="รายชื่อพนักงาน"
      back={opened ? <div className="lg:hidden"><BackLink href={pathname} label="กลับไปรายชื่อพนักงาน" /></div> : undefined}
      actions={viewerPermissions.includes('access.employee.create') && (
        <Link href={`/companies/${companyId}/settings/employees`} className={cx(primaryButtonClass, opened && 'hidden lg:inline-flex')}>
          <PlusIcon className="h-4 w-4" /> เพิ่มพนักงาน
        </Link>
      )}
    >
      {error && <Notice tone="error">{error}</Notice>}

      {/* The four counter cards were filters drawn as cards; the filter is said as a filter, and only when
          the shop has someone who is not active (most shops have none). */}
      {employees.some((employee) => employee.status !== 'ACTIVE') && (
        <div className={cx(opened && 'hidden lg:block')}>
          <FilterTabs aria-label="สถานะบัญชีพนักงาน" value={statusFilter} onChange={setStatusFilter} tabs={[
            { key: 'all', label: 'ทั้งหมด', count: employees.length },
            { key: 'ACTIVE', label: 'ใช้งาน', count: employees.filter((employee) => employee.status === 'ACTIVE').length },
            { key: 'DRAFT', label: 'ร่าง', count: employees.filter((employee) => employee.status === 'DRAFT').length },
            { key: 'INACTIVE', label: 'ปิดใช้งาน', count: employees.filter((employee) => employee.status !== 'ACTIVE' && employee.status !== 'DRAFT').length },
          ]} />
        </div>
      )}
      {/* Below 1024 px the list is the page and a person is their own view (list → person → back); from
          1024 px the two stand side by side. */}
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className={cx('min-w-0 xl:sticky xl:top-6', opened && 'hidden lg:block')}>
          <MangmeeCard className="p-4">
            <h2 className="px-2 text-sm font-semibold text-gray-700">พนักงาน {filteredEmployees.length} คน</h2>

            <label className="relative mt-3 block">
              <SearchIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                className="mangmee-input mangmee-input-icon-end"
                placeholder="ค้นหาชื่อ ตำแหน่งงาน หรือเบอร์โทร..."
                aria-label="ค้นหาพนักงาน"
              />
            </label>

            <div className="mt-3">
              <ThemedSelect
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                aria-label="เลือกบทบาท"
              >
                {filters.map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}
              </ThemedSelect>
            </div>

            <div className="mt-4 grid gap-2 lg:max-h-[min(60vh,640px)] lg:overflow-y-auto lg:pr-1 xl:max-h-[calc(100dvh-320px)]">
              {filteredEmployees.map((employee) => (
                <EmployeeRow
                  key={employee.id} employee={employee} roles={employee.roles.map((role) => roleById.get(role.id) ?? role)}
                  selected={employee.id === activeUserId} onSelect={() => selectEmployee(employee.id)}
                />
              ))}
              {filteredEmployees.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                  {employees.length === 0 ? 'ยังไม่มีพนักงานในร้านนี้' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง ลองเปลี่ยนตัวกรองหรือคำค้น'}
                </p>
              )}
            </div>
          </MangmeeCard>
        </div>

        {/* Nobody to show only when the list is empty, and the list says why. */}
        {selectedEmployee && (
          <div className={cx('min-w-0 gap-5', opened ? 'grid' : 'hidden lg:grid')}>
            <MangmeeCard className="relative p-4 sm:p-5">
              <div className="grid scroll-mt-24 gap-4" data-testid="employee-detail-card">
                <div className="flex min-w-0 items-start gap-4">
                  <EmployeeAvatar employee={selectedEmployee} color={selectedRole ? colorForRole(selectedRole) : '#667085'} active={Boolean(selectedActive)} className="h-[52px] w-[52px] rounded-xl text-lg" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="min-w-0 break-words text-xl font-bold text-gray-900">{employeeShortName(selectedEmployee)}</h2>
                      <span className="flex flex-wrap gap-1.5" aria-label="บทบาทปัจจุบัน" aria-live="polite">
                        {selectedEmployee.roles.map((role) => <RoleBadge key={role.id} role={roleById.get(role.id) ?? role} />)}
                      </span>
                      {selectedIsDraft && <DraftBadge />}
                    </div>
                    {selectedEmployee.accountDisplayName && selectedEmployee.accountDisplayName !== selectedEmployee.displayName && <p className="mt-1 break-words text-sm text-gray-500">ชื่อที่แสดง: {selectedEmployee.accountDisplayName}</p>}
                    <p className="mt-1 break-words text-sm text-gray-600">ตำแหน่งงาน: {selectedEmployee.jobTitle || 'ยังไม่ระบุ'}</p>
                    {selectedEmployee.phoneNumber && <p className="mangmee-unit mt-0.5 text-sm text-gray-600">{selectedEmployee.phoneNumber}</p>}
                    {viewerPermissions.includes('reimbursement.create') && <MemberPayoutAccountLine companyId={companyId} memberUserId={selectedEmployee.userId} />}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {selectedRoles.length > 0 && (
                    <div className="min-w-0">
                      <div className="flex min-h-5 items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">บทบาท</span>
                        <span
                          aria-live="polite"
                          className={cx('text-xs font-semibold', savedAt === 'role' ? 'text-brand-700' : 'text-gray-500')}
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
                            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1 hover:border-brand-200 hover:bg-brand-25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10"
                            aria-haspopup="listbox"
                            aria-label="เปลี่ยนบทบาทพนักงาน"
                            aria-expanded={rolePickerOpen}
                          >
                            <span className="max-w-52 text-left text-sm font-semibold text-gray-800 [overflow-wrap:anywhere]">{selectedRoleNames}</span>
                            <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-500" />
                          </button>
                        )}
                        {rolePickerOpen && !rolePickerReadOnly && (
                          <div role="listbox" className="absolute left-0 top-full z-20 mt-1 w-60 max-w-[min(15rem,80vw)] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {roleOptions.map((role) => (
                              <button
                                key={role.id} type="button" role="option" aria-selected={selectedRoleIds.length === 1 && selectedRoleIds[0] === role.id} disabled={busy} aria-busy={Boolean(busy)}
                                onClick={() => void changeSelectedRole(role.id)}
                                className={cx('flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold hover:bg-gray-50 disabled:opacity-60', selectedRoleIds.includes(role.id) ? 'text-brand-700' : 'text-gray-700')}
                              >
                                <span className="min-w-0 [overflow-wrap:anywhere]">{roleDisplayName(role)}</span>
                                {selectedRoleIds.includes(role.id) && <CheckLineIcon className="h-4 w-4 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {selectedIsOwner
                        ? <p className="mt-1 text-sm text-gray-500">{`บทบาท${THAI_SYSTEM_ROLE_NAMES.OWNER}เปลี่ยนไม่ได้`}</p>
                        : isSelfEmployee(selectedEmployee, viewerUserId)
                          ? <p className="mt-1 text-sm text-gray-500">บทบาทของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้</p>
                          : <p className="mt-1 text-sm text-gray-500">1 คนมี 1 บทบาท</p>}
                      {selectedEmployee.roles.length > 1 && (
                        <p role="status" className="mt-1 text-sm text-warning-700">ข้อมูลเดิมมีหลายบทบาท ให้ผู้มีสิทธิ์เลือก 1 บทบาทเพื่อแทนที่ทั้งหมด</p>
                      )}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex min-h-5 items-center gap-2">
                      <span className="text-sm font-semibold text-gray-700">สถานะบัญชี</span>
                      <span
                        aria-live="polite"
                        className={cx('text-xs font-semibold', savedAt === 'status' ? 'text-brand-700' : 'text-gray-500')}
                      >
                        {busy && pendingKey === 'status' ? 'กำลังบันทึก...' : savedAt === 'status' ? 'บันทึกแล้ว' : null}
                      </span>
                    </div>
                    <div className="mt-1 flex min-h-11 items-center gap-3 sm:min-h-10">
                      <MangmeeBadge tone={selectedIsDraft ? 'amber' : selectedActive ? 'brand' : 'danger'}>
                        {selectedIsDraft ? 'ร่าง' : selectedActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </MangmeeBadge>
                      {canDisableEmployee && <ToggleSwitch checked={Boolean(selectedActive)} disabled={selectedIsOwner || selectedIsDraft || busy} onChange={() => void toggleSelectedActive()} label="ใช้งาน / ปิดใช้งาน" />}
                    </div>
                  </div>
                </div>
                {canEditEmployee && <DisplayNameHistoryDisclosure key={`${companyId}:${selectedEmployee.userId}`} companyId={companyId} userId={selectedEmployee.userId} />}
                {(canIssueLineLink || !selectedIsOwner && (canEditEmployee || canDisableEmployee || canIssueCredential)) && (
                  <ActionGroup align="start">
                    {!selectedIsOwner && canDisableEmployee && selectedIsDraft && <button type="button" className={dangerButtonClass} disabled={busy} aria-busy={Boolean(busy && pendingKey === 'status')} onClick={() => void deleteSelectedEmployee()}>ลบร่างพนักงาน</button>}
                    {!selectedIsOwner && canIssueCredential && <button type="button" className={secondaryButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => { setResetError(null); setResetTarget(selectedEmployee); }}>รีเซ็ตรหัสผ่าน</button>}
                    {!selectedIsOwner && canEditEmployee && <button type="button" className={secondaryButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={editSelectedEmployee}>แก้ไขข้อมูล</button>}
                    {canIssueLineLink && <button type="button" className={secondaryButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void issueSelectedLineLink()}>ออกลิงก์เชื่อม LINE</button>}
                    {canIssueLineLink && lineLink?.employeeId === selectedEmployee.id && lineLink.companyId === companyId && <button type="button" className={secondaryButtonClass} onClick={() => void copyLineLink()}>คัดลอกลิงก์</button>}
                  </ActionGroup>
                )}
                {canIssueLineLink && (
                  <div className="space-y-3">
                    {lineLink?.employeeId === selectedEmployee.id && lineLink.companyId === companyId && (
                      <div>
                        <label className="block text-sm font-medium text-gray-900" htmlFor="employee-line-link">ลิงก์เชื่อม LINE</label>
                        <input id="employee-line-link" className="mangmee-input mt-1 w-full" readOnly value={lineLink.package.linkUrl} onFocus={(event) => event.target.select()} />
                        <p className="mt-1 text-sm text-gray-500">ใช้ได้ 15 นาที · หมดอายุ {formatThaiDateTime(lineLink.package.expiresAt)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </MangmeeCard>

            <MangmeeCard className="p-4 sm:p-6">
              <div data-testid="access-permission-summary">
                <h2 className="break-words text-lg font-bold text-gray-900">สิทธิ์ของ {employeeShortName(selectedEmployee)}</h2>
                {selectedEmployee.accountDisplayName && selectedEmployee.accountDisplayName !== selectedEmployee.displayName && <p className="mt-1 break-words text-sm text-gray-500">ชื่อที่แสดง: {selectedEmployee.accountDisplayName}</p>}
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <p className="min-w-0 text-sm text-gray-600">
                    {selectedIsOwner
                      ? `สิทธิ์มาจากบทบาท${THAI_SYSTEM_ROLE_NAMES.OWNER} ปรับไม่ได้`
                      : `สิทธิ์มาจากบทบาท ${selectedRoleNames || 'ที่ยังไม่ได้กำหนด'}${selectedEmployee.roles.length > 1 ? ' ระบบรวมสิทธิ์จากทุกบทบาท' : ''}`}
                  </p>
                  {!selectedIsOwner && canManageRoles && selectedRole && (
                    <Link href={`/companies/${companyId}/settings/permissions?role=${encodeURIComponent(selectedRole.id)}`} className={secondaryButtonClass}>แก้สิทธิ์ของบทบาท</Link>
                  )}
                </div>
                {selectedEmployee.status !== 'ACTIVE' && (
                  <p className="mt-2 text-sm text-warning-700">{accountAccessNotice(selectedEmployee.status)}</p>
                )}

                {/* What the person can do, in plain sentences, limited to what the shop's package has. Shown
                    to a reader who may open the choices; anyone else gets the menu summary alone, which
                    says it is not the whole. */}
                {packs && selectedRoles.length > 0 && (
                  <div className="mt-4" data-testid="person-can-do">
                    <h3 className="text-sm font-semibold text-gray-900">ทำอะไรได้</h3>
                    <RoleCanDoList packs={roleCanDoPacks(selectedRoles.flatMap((role) => role.permissionKeys), packs)} corePacks={packs.filter((pack) => pack.isCore && !pack.locked)} />
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">สิทธิ์เข้าถึงเมนู</h3>
                  {!permissionError && accessProjection.complete && (
                    <MangmeeBadge tone="brand" className="shrink-0 tabular-nums">
                      แสดงสิทธิ์ {accessProjection.grantedCount} เมนู
                    </MangmeeBadge>
                  )}
                </div>
                {!packs && !permissionError && (
                  <p className="mt-1 text-sm text-gray-500">
                    หน้านี้สรุปเฉพาะเมนูในตารางสิทธิ์ ไม่ใช่สิทธิ์ทั้งหมดของบทบาท
                  </p>
                )}

              <div className="mt-3 grid gap-4">
                {permissionError ? (
                  <div data-testid="access-permission-error">
                    <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void reload()}>ลองอีกครั้ง</button>}>
                      โหลดข้อมูลสิทธิ์ไม่สำเร็จ จึงยังสรุปสิทธิ์ไม่ได้
                    </Notice>
                  </div>
                ) : selectedEmployee.roles.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                    ยังไม่ได้กำหนดบทบาท จึงยังไม่มีข้อมูลสิทธิ์
                  </p>
                ) : !accessProjection.complete ? (
                  <div data-testid="access-permission-error">
                    <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void reload()}>ลองอีกครั้ง</button>}>
                      ข้อมูลบทบาทกับสิทธิ์ไม่ตรงกัน โหลดอีกครั้ง
                    </Notice>
                  </div>
                ) : accessProjection.groups.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                    ไม่มีสิทธิ์ในเมนูที่สรุปในตารางนี้
                  </p>
                ) : accessProjection.groups.map(({ group, menus: groupMenus }) => (
                  <div key={group} className="grid gap-1">
                    <h4 className="text-sm font-semibold text-gray-500">{MENU_GROUP_LABEL_TH[group]}</h4>
                    {group === 'fin' && <DisbursementVoucherAccessHint entryOpen={disbursementEntryOpen} />}
                    {groupMenus.map(({ menu, labels }) => (
                      <div
                        key={menu.id}
                        data-testid="access-permission-row"
                        data-menu-id={menu.id}
                        className="grid min-w-0 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] sm:items-center"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <MenuIconFrame menu={menu} className="h-8 w-8" />
                          <span data-testid="access-permission-menu-label" className="min-w-0 whitespace-normal break-words text-sm font-semibold leading-6 text-gray-900">
                            {menu.labelTh}
                          </span>
                        </div>
                        <div
                          data-testid="access-permission-actions"
                          aria-label={`สิทธิ์ที่มีสำหรับ ${menu.labelTh}`}
                          className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 pl-11 sm:justify-end sm:pl-0"
                        >
                          {labels.map((label) => (
                            <span key={label} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                              <CheckLineIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              </div>
            </MangmeeCard>

            {branchError ? (
              <MangmeeCard className="p-4 sm:p-6">
                <div data-testid="branch-access-error">
                  <h2 className="text-lg font-bold text-gray-900">สาขาที่เข้าถึงได้</h2>
                  <Notice tone="error" className="mt-3" action={<button type="button" className={secondaryButtonClass} onClick={() => void reload()}>ลองอีกครั้ง</button>}>
                    โหลดข้อมูลสาขาไม่สำเร็จ จึงยังบอกสาขาไม่ได้
                  </Notice>
                </div>
              </MangmeeCard>
            ) : branches.length > 0 && (
              <MangmeeCard className="p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <h2 className="text-lg font-bold text-gray-900">สาขาที่เข้าถึงได้</h2>
                  <div className="flex shrink-0 items-center gap-3">
                    {(busy && pendingKey === 'branch' || savedAt === 'branch') && <span
                      aria-live="polite"
                      className={cx('text-xs font-semibold', savedAt === 'branch' ? 'text-brand-700' : 'text-gray-500')}
                    >
                      {busy && pendingKey === 'branch' ? 'กำลังบันทึก...' : 'บันทึกแล้ว'}
                    </span>}
                  </div>
                </div>
                {canEditBranchScope && <p className="mt-1 text-sm text-gray-600">เขาเห็นข้อมูลเฉพาะสาขาที่เลือก ต้องมีอย่างน้อย 1 สาขา</p>}

                {canEditBranchScope && <div className="mangmee-segmented mt-4">
                  <button
                    type="button"
                    disabled={busy || viewerBranchIds !== undefined} aria-busy={Boolean(busy)}
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

                {/* "ทุกสาขา" is said as a word only here, where the branches themselves are folded away. */}
                {!canEditBranchScope && selectedEmployee.branchScopeMode === 'ALL_BRANCHES' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span data-testid="employee-branch-count" className="rounded-full bg-blue-light-50 px-3 py-1 text-sm font-semibold tabular-nums text-blue-light-500">{branchCountLabel}</span>
                    <button
                      type="button"
                      className="mangmee-btn mangmee-btn-secondary"
                      aria-expanded={branchPickerOpen}
                      aria-controls="employee-accessible-branches"
                      onClick={() => setBranchPickerOpen((open) => !open)}
                    >
                      {branchPickerOpen ? 'ซ่อนรายชื่อสาขา' : 'ดูสาขาที่เข้าถึง'}
                    </button>
                  </div>
                )}

                {(selectedEmployee.branchScopeMode === 'SELECTED_BRANCHES' || branchPickerOpen) && (
                  <div id="employee-accessible-branches" className="mt-4 flex min-w-0 flex-wrap gap-2">
                    {branches.filter((branch) => selectedBranchIds.includes(branch.id) || (canEditBranchScope && (viewerBranchIds === undefined || viewerBranchIds.includes(branch.id)))).map((branch) => {
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
                        <span key={branch.id} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-25 px-4 py-1.5 text-sm font-semibold text-brand-700">
                          <CheckLineIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 break-words">{branch.name}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {branchPickerLocked && (
                  <p className="mt-3 text-sm text-gray-600">
                    บทบาท {allBranchRoles.map((role) => roleDisplayName(role)).join(', ')} ต้องเห็นข้อมูลทุกสาขา จึงจำกัดสาขาไม่ได้
                  </p>
                )}
                {viewerBranchIds !== undefined && (
                  <p className="mt-3 text-sm text-gray-600">
                    {EMPLOYEE_BRANCH_SCOPE_HELP}
                  </p>
                )}
              </MangmeeCard>
            )}
          </div>
        )}
      </div>

      <Modal
        open={resetTarget !== null}
        title={`รีเซ็ตรหัสผ่านของ ${resetTarget ? employeeShortName(resetTarget) : ''}?`}
        size="sm"
        onClose={() => { if (!resetting) { setResetTarget(null); setResetError(null); } }}
        footer={(
          <>
            <button type="button" disabled={resetting} onClick={() => setResetTarget(null)} className={secondaryButtonClass}>ไม่รีเซ็ต</button>
            <button type="button" disabled={resetting} aria-busy={Boolean(resetting)} onClick={() => void confirmResetPassword()} className={primaryButtonClass}>รีเซ็ตรหัสผ่าน</button>
          </>
        )}
      >
        <div className="space-y-3">
          {resetError && <Notice tone="error">{resetError}</Notice>}
          <p className="text-sm text-gray-700">รหัสผ่านเดิมใช้ไม่ได้ทันที เขาต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งถัดไป</p>
        </div>
      </Modal>

      {/* Shown once and never again: a tap outside must not lose it, and it can be copied in one press. */}
      <Modal
        open={handoff !== null}
        title={`รหัสผ่านชั่วคราวของ ${handoff?.displayName ?? ''}`}
        size="sm"
        closeOnBackdrop={false}
        onClose={() => { setHandoff(null); setHandoffCopied(false); }}
        footer={(
          <>
            <button type="button" onClick={() => { setHandoff(null); setHandoffCopied(false); }} className={secondaryButtonClass}>ปิด</button>
            <button type="button" className={primaryButtonClass} onClick={() => {
              if (!handoff) return;
              void navigator.clipboard?.writeText(`ชื่อผู้ใช้: ${handoff.username}\nรหัสผ่าน: ${handoff.temporaryPassword}`).then(() => setHandoffCopied(true)).catch(() => setHandoffCopied(false));
            }}>{handoffCopied ? 'คัดลอกแล้ว' : 'คัดลอกชื่อผู้ใช้และรหัสผ่าน'}</button>
          </>
        )}
      >
        {handoff && (
          <div className="space-y-3">
            <dl className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ชื่อผู้ใช้</dt><dd className="font-mono font-bold text-gray-900 [overflow-wrap:anywhere]">{handoff.username}</dd></div>
              <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">รหัสผ่าน</dt><dd className="font-mono font-bold text-gray-900 [overflow-wrap:anywhere]">{handoff.temporaryPassword}</dd></div>
              {handoff.expiresAt && (
                <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ใช้ได้ถึง</dt><dd className="mangmee-unit font-bold text-gray-900">{formatThaiDateTime(handoff.expiresAt)}</dd></div>
              )}
            </dl>
            {/* `lineNotified` is absent on older API builds — treat that as "not delivered". */}
            <Notice tone={handoff.lineNotified ? 'success' : 'warning'}>
              {handoff.lineNotified
                ? 'ส่งรหัสผ่านนี้ไปที่ LINE ของเขาแล้ว'
                : 'คัดลอกแล้วส่งให้เขาเอง ปิดแล้วจะไม่แสดงอีก'}
            </Notice>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </MangmeePage>
  );
}
