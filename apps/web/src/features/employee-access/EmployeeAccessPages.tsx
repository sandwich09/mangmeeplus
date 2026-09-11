'use client';

import Link from 'next/link';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { formatThaiTime } from '@/common/i18n/thai-date';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { employeeFullName } from '@watchdog-bms/contracts';
import type {
  CapabilityPackView, RiskLevel, RolePreviewResult, RoleTemplate, PermissionCatalogItem,
  CompanyAccessMatrixRow, EffectiveAccessView,
} from '@watchdog-bms/contracts';
import {
  listEmployees, createEmployee, updateEmployee, setEmployeeStatus,
  regenerateEmployeeCredential, issueEmployeeLineLinkToken, revokeEmployeeLineLinkToken,
  listRoles, createRole, updateRole, disableRole, listPermissionCatalog,
  listCapabilityPacks, listRoleTemplates, previewRole,
  getEffectiveAccessMatrix, getMembershipEffectiveAccess,
} from './employee-access.api';
import { useToast } from '@/common/components/toast';
import { LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { trimmed } from '@/common/forms/trim';
import { listBranches as listCompanyBranches } from '../branch-settings/branches.api';
import {
  BoltIcon,
  CheckCircleIcon,
  CopyIcon,
  GridIcon,
  GroupIcon,
  LockIcon,
  PlusIcon,
  TableIcon,
  TrashIcon,
  UserIcon,
} from '@/common/icons';

// ── Smart Roles: display maps ────────────────────────────────────────────────
const MODULE_LABEL: Record<string, string> = {
  foundation: 'พื้นฐาน', company: 'บริษัทและระบบ', people: 'พนักงานและสิทธิ์',
  inventory: 'สินค้าและสต๊อก', sales: 'ลูกค้าและการขาย', billing: 'บิลและเอกสาร',
  expense: 'ค่าใช้จ่าย', reimbursement: 'การเบิกจ่าย', procurement: 'จัดซื้อและเจ้าหนี้',
  banking: 'ธนาคารและกระทบยอด', accounting: 'บัญชีแยกประเภท', tax: 'ภาษี',
};
const INDUSTRY_LABEL: Record<string, string> = {
  crosscutting: 'ทั่วไป', retail: 'ค้าปลีก', trading: 'ค้าส่ง/เทรดดิ้ง', service: 'บริการ', ecommerce: 'อีคอมเมิร์ซ',
};
const RISK_LABEL: Record<RiskLevel, string> = { LOW: 'ต่ำ', MEDIUM: 'ปานกลาง', HIGH: 'สูง', CRITICAL: 'วิกฤติ' };
const RISK_STYLE: Record<RiskLevel, string> = {
  LOW: 'bg-gray-100 text-gray-500 border-gray-200',
  MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
  HIGH: 'bg-amber-50 text-amber-700 border-amber-200',
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
};
const DROP_REASON_LABEL: Record<string, string> = {
  not_entitled: 'บริษัทนี้ยังใช้งานรายการนี้ไม่ได้',
  above_granter_scope: 'คุณยังไม่มีสิทธิ์เพิ่มรายการนี้',
  unknown: 'รายการนี้ไม่พร้อมใช้งาน',
};
/**
 * Owner report 2026-08-28: on the phone, "เพิ่มบทบาท" looked like a dead button. It was not — the
 * builder opens directly below, past the fold, with nothing moving on screen to say so. Bring what
 * just appeared into view so the press has a visible result.
 */
function useRevealedPanel(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // After paint, so the panel has a height to scroll to.
    const id = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [open]);
  return ref;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === 'LOW' || risk === 'MEDIUM') return null; // only flag HIGH/CRITICAL to keep the UI calm
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLE[risk]}`}>{RISK_LABEL[risk]}</span>;
}

// Packs (excluding core) whose every permission key is present in `keys` — the client-side twin of
// the backend's summarizeCapabilities, so role chips/toggles reflect exactly what the API compiles.
export function coveredPacks(keys: string[], packs: CapabilityPackView[]): CapabilityPackView[] {
  const set = new Set(keys);
  return packs.filter((p) => !p.isCore && p.permissionKeys.length > 0 && p.permissionKeys.every((k) => set.has(k)));
}

// Protected owner/platform roles are never assignable to company staff.
const NON_ASSIGNABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW'];
function assignableRoles(roles: any[]) {
  return roles.filter((r) => r.status === 'ACTIVE' && !NON_ASSIGNABLE_ROLE_KEYS.includes(r.key));
}

const ROLE_LABEL_KEYS: Record<string, DictionaryKey> = {
  OWNER: 'role.OWNER',
  SYSTEM_ADMIN: 'role.SYSTEM_ADMIN',
  ADMIN: 'role.ADMIN',
  MANAGER: 'role.MANAGER',
  HR: 'role.HR',
  SALES: 'role.SALES',
  INVENTORY: 'role.INVENTORY',
  FINANCE: 'role.FINANCE',
  ACCOUNTANT: 'role.ACCOUNTANT',
  MARKETING: 'role.MARKETING',
  STAFF: 'role.STAFF',
  AUDITOR_READONLY: 'role.AUDITOR_READONLY',
};

const ROLE_NAME_TO_KEY: Record<string, string> = {
  owner: 'OWNER',
  'system admin': 'SYSTEM_ADMIN',
  sysadmin: 'SYSTEM_ADMIN',
  admin: 'ADMIN',
  manager: 'MANAGER',
  hr: 'HR',
  sales: 'SALES',
  inventory: 'INVENTORY',
  finance: 'FINANCE',
  accountant: 'ACCOUNTANT',
  marketing: 'MARKETING',
  staff: 'STAFF',
  auditor: 'AUDITOR_READONLY',
  'auditor (read-only)': 'AUDITOR_READONLY',
  'auditor (readonly)': 'AUDITOR_READONLY',
};

export function roleDisplayName(roleOrKey: any, locale: SupportedLocale) {
  const rawKey = typeof roleOrKey === 'string' ? roleOrKey : roleOrKey?.key;
  const rawName = typeof roleOrKey === 'string' ? roleOrKey : roleOrKey?.name;
  const normalizedName = String(rawName ?? '').trim().toLowerCase();
  const key = String(rawKey ?? ROLE_NAME_TO_KEY[normalizedName] ?? '').trim().toUpperCase();
  const dictKey = ROLE_LABEL_KEYS[key];
  return dictKey ? t(dictKey, locale) : (rawName || 'บทบาทที่กำหนดเอง');
}

export const panelClass = 'rounded-lg border border-gray-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,.06)]';
export const mutedPanelClass = 'rounded-lg border border-gray-200 bg-gray-50/70';
// The three button classes below already carry their disabled state; this one did not, and it
// states its own background and colour, so a disabled field here would look exactly like an
// editable one. Same treatment the shared Field.tsx inputs use.
export const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';
export const btnClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';
export const ghostClass = 'inline-flex h-11 sm:h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-200 hover:bg-brand-25 disabled:cursor-not-allowed disabled:opacity-50';
export const dangerClass = 'inline-flex h-11 sm:h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';
const chipClass = 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600';
const brandChipClass = 'inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-400">{text}</div>;
}
function StatusBadge({ status }: { status: string }) {
  const style: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-300',
    ACTIVE: 'bg-brand-50 text-brand-700 border-brand-200',
    INVITED: 'bg-blue-50 text-blue-700 border-blue-200',
    SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-200',
    DISABLED: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${style[status] ?? style['DISABLED']}`}>{status === 'DRAFT' ? 'Draft' : status}</span>;
}
export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold text-gray-600">{children}</label>;
}
export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div>
      {eyebrow && <div className="text-xs font-bold uppercase tracking-[.08em] text-brand-600">{eyebrow}</div>}
      <div className="text-base font-bold text-gray-900">{title}</div>
      {children && <div className="mt-1 text-sm leading-6 text-gray-500">{children}</div>}
    </div>
  );
}
function StatTile({ icon, label, value, tone = 'brand' }: { icon: ReactNode; label: string; value: string; tone?: 'brand' | 'gold' | 'blue' | 'gray' }) {
  const toneClass = {
    brand: 'bg-brand-50 text-brand-700 border-brand-100',
    gold: 'bg-gold-100 text-amber-800 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  }[tone];
  return (
    <div className={`${panelClass} flex items-center gap-3 p-4`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className="mt-0.5 text-xl font-extrabold text-gray-900">{value}</div>
      </div>
    </div>
  );
}
function InitialAvatar({ label, muted = false }: { label: string; muted?: boolean }) {
  const initials = (label || '?').trim().slice(0, 2);
  return (
    <div className={cx(
      'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white',
      muted ? 'bg-gray-300' : 'bg-linear-to-br from-brand-500 to-brand-800',
    )}>
      {initials}
    </div>
  );
}
export function QrLinkCard({ linkUrl, qrImageUrl, expiresAt }: { linkUrl: string; qrImageUrl: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`${mutedPanelClass} p-4`}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <img src={qrImageUrl} alt="LINE link QR" className="h-36 w-36 flex-shrink-0 rounded-lg border border-gray-200 bg-white p-1.5" />
        <div className="min-w-0 flex-1 space-y-2 self-stretch">
          <p className="text-xs font-semibold text-gray-600">ลิงก์เชื่อม LINE (หมดอายุ {formatThaiTime(expiresAt)})</p>
          <a href={linkUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-medium text-brand-700 underline">{linkUrl}</a>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(linkUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); }} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold leading-none text-gray-700 hover:bg-gray-50">
            <CopyIcon aria-hidden="true" className="block h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap leading-none">{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = 'employees' | 'roles' | 'matrix';

export function EmployeeAccessWorkspacePage({ companyId, initialTab = 'employees' }: { companyId: string; initialTab?: Tab }) {
  const tabs: { key: Tab; label: string; href: string; icon: ReactNode; desc: string }[] = [
    { key: 'employees', label: 'พนักงาน', href: `/companies/${companyId}/settings/employees`, icon: <UserIcon className="h-4 w-4" />, desc: 'สร้างบัญชีและจัดการสถานะพนักงาน' },
    { key: 'roles', label: 'บทบาทและสิทธิ์', href: `/companies/${companyId}/settings/roles`, icon: <LockIcon className="h-4 w-4" />, desc: 'กำหนดความสามารถตามบทบาท' },
    { key: 'matrix', label: 'ภาพรวมสิทธิ์', href: `/companies/${companyId}/settings/access-overview`, icon: <TableIcon className="h-4 w-4" />, desc: 'ดูว่าแต่ละคนทำอะไรได้บ้าง' },
  ];
  return (
    <div className="min-h-[calc(100dvh-var(--app-header-h))] bg-[#f7faf8]">
      <div className="mx-auto w-full max-w-[1480px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-25 px-3 py-1 text-xs font-semibold text-brand-700">
              <LockIcon className="h-3.5 w-3.5" />
              ตั้งค่าระบบ
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">สิทธิ์การใช้งาน</h1>
            <p className="mt-1 text-sm text-gray-500">จัดการพนักงาน บทบาท และภาพรวมสิทธิ์ในที่เดียว</p>
          </div>
          <div className="hidden rounded-lg border border-gray-200 bg-white px-4 py-3 text-right shadow-sm sm:block">
            <div className="text-xs font-medium text-gray-400">ขอบเขตการใช้งาน</div>
            <div className="mt-0.5 text-sm font-semibold text-gray-800">ทั้งบริษัท</div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {tabs.map((t) => {
            const active = initialTab === t.key;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  panelClass,
                  'group flex items-center gap-3 p-3 transition-colors',
                  active ? 'border-brand-200 bg-brand-25 shadow-[inset_3px_0_0_var(--color-brand-500)]' : 'hover:border-brand-200 hover:bg-white',
                )}
              >
                <span className={cx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                  active ? 'border-brand-100 bg-brand-100 text-brand-700' : 'border-gray-200 bg-gray-50 text-gray-500 group-hover:text-brand-700',
                )}>
                  {t.icon}
                </span>
                <span className="min-w-0">
                  <span className={cx('block text-sm font-bold', active ? 'text-brand-800' : 'text-gray-800')}>{t.label}</span>
                  <span className="block truncate text-xs text-gray-500">{t.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>

        <div>
          {initialTab === 'employees' && <EmployeesView companyId={companyId} />}
          {initialTab === 'roles' && <RolesView companyId={companyId} />}
          {initialTab === 'matrix' && <MatrixView companyId={companyId} />}
        </div>
      </div>
    </div>
  );
}

// ── Employees ────────────────────────────────────────────────────────────────
function EmployeesView({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const [employees, setEmployees] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleCatalogWarning, setRoleCatalogWarning] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const revealedEmployeePanel = useRevealedPanel(showCreate);
  const [handoff, setHandoff] = useState<any | null>(null);
  const [linePackage, setLinePackage] = useState<{ employeeId: string } & any | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const query = trimmed(search).toLowerCase();
  const visibleEmployees = query
    ? employees.filter((emp) =>
        [emp.displayName, emp.legalName, emp.phoneNumber]
          .filter(Boolean)
          .some((value: string) => value.toLowerCase().includes(query)))
    : employees;
  const activeCount = employees.filter((emp) => emp.status === 'ACTIVE').length;
  const lineLinkedCount = employees.filter((emp) => emp.lineLinked).length;
  const roleNameSet = new Set(employees.flatMap((emp) => emp.roles.map((role: any) => roleDisplayName(role, locale))));

  const reload = useCallback(async () => {
    setError(null);
    setRoleCatalogWarning(null);
    const [employeesResult, rolesResult] = await Promise.allSettled([
      listEmployees(companyId),
      listRoles(companyId),
    ]);

    if (employeesResult.status === 'fulfilled') {
      setEmployees(employeesResult.value);
    } else {
      setError(localizedErrorMessage(employeesResult.reason, locale, { fallback: 'error.load_failed' }));
    }

    if (rolesResult.status === 'fulfilled') {
      setRoles(assignableRoles(rolesResult.value));
    } else {
      setRoles([]);
      setRoleCatalogWarning('โหลดรายการบทบาทไม่สำเร็จ จึงยังเพิ่มพนักงานใหม่หรือเปลี่ยนบทบาทไม่ได้ แต่ยังแก้ชื่อและเบอร์โทรของรายการเดิมได้');
    }

    setLoading(false);
  }, [companyId, locale]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}
      {roleCatalogWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{roleCatalogWarning}</div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <StatTile icon={<GroupIcon className="h-5 w-5" />} label="พนักงานทั้งหมด" value={String(employees.length)} />
        <StatTile icon={<CheckCircleIcon className="h-5 w-5" />} label="ใช้งานอยู่" value={String(activeCount)} tone="blue" />
        <StatTile icon={<BoltIcon className="h-5 w-5" />} label="เชื่อม LINE แล้ว" value={`${lineLinkedCount}/${employees.length || 0}`} tone="gold" />
      </div>

      <div className={`${panelClass} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle eyebrow="การเข้าถึงพนักงาน" title="รายชื่อพนักงาน">
            ค้นหา เพิ่มบัญชี และจัดการสิทธิ์การเข้าใช้งานของพนักงาน
          </SectionTitle>
          <button className={showCreate ? ghostClass : btnClass} disabled={roles.length === 0} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'ยกเลิก' : <><PlusIcon className="h-4 w-4" /> เพิ่มพนักงาน</>}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:max-w-sm">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาชื่อ เบอร์โทร หรือชื่อกฎหมาย…"
              aria-label="ค้นหาพนักงาน"
              className={`${inputClass} pl-9`}
            />
            <GridIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>
          <span className={chipClass}>{visibleEmployees.length} รายการที่แสดง</span>
          <span className={chipClass}>{roleNameSet.size} บทบาทที่ใช้งาน</span>
        </div>
      </div>

      {showCreate && (
        <div ref={revealedEmployeePanel}>
          <CreateEmployeeForm
            companyId={companyId}
            roles={roles}
            onCancel={() => setShowCreate(false)}
            onCreated={(result) => { setShowCreate(false); setHandoff(result); void reload(); }}
          />
        </div>
      )}

      {handoff && (
        <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-800"><CheckCircleIcon className="h-4 w-4" /> สร้างพนักงานสำเร็จ</p>
          <p className="text-sm text-gray-700">ชื่อผู้ใช้: <span className="font-mono font-semibold">{handoff.username}</span></p>
          <p className="text-sm text-gray-700">รหัสผ่าน: <span className="font-mono font-semibold">{handoff.temporaryPassword}</span></p>
          <p className="text-xs text-gray-500">ใช้วันเดือนปีเกิดรูปแบบ DDMMYYYY — ไม่ต้องเปลี่ยนรหัสผ่านตอนเข้าสู่ระบบครั้งแรก</p>
          {handoff.lineLink && (
            <>
              <p className="text-xs text-gray-600">QR เชื่อม LINE ของพนักงานคนนี้ (ใช้ได้ครั้งเดียว ผูกกับผู้ใช้นี้เท่านั้น) — หากหมดอายุ สร้างใหม่ได้จากปุ่ม “สร้าง QR เชื่อม LINE”</p>
              <QrLinkCard linkUrl={handoff.lineLink.linkUrl} qrImageUrl={handoff.lineLink.qrImageUrl} expiresAt={handoff.lineLink.expiresAt} />
            </>
          )}
          <button className={ghostClass} onClick={() => setHandoff(null)}>ปิด</button>
        </div>
      )}

      {employees.length === 0 ? <Empty text="ยังไม่มีพนักงาน" /> : visibleEmployees.length === 0 ? (
        <Empty text="ไม่พบพนักงานที่ตรงกับเงื่อนไข" />
      ) : (
        <div className="grid gap-3">
          {visibleEmployees.map((emp) => (
            <div key={emp.id} className={`${panelClass} p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  {/* The avatar stays on the bare name: initials should never start at คำนำหน้า. */}
                  <InitialAvatar label={emp.displayName} muted={emp.status === 'DISABLED'} />
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-gray-900">{employeeFullName(emp)}</div>
                    <div className="mt-1 text-xs text-gray-500">{emp.identityMasked} · {emp.phoneNumber}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                      <span>{emp.mustChangePassword ? 'ยังไม่เปลี่ยนรหัสผ่าน' : 'เปลี่ยนรหัสผ่านแล้ว'}</span>
                      <span>{emp.lineLinked ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {emp.roles.map((r: any) => (
                    <span key={r.id} className={brandChipClass}>{roleDisplayName(r, locale)}</span>
                  ))}
                  <StatusBadge status={emp.status} />
                  <button className={ghostClass} onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}>
                    {expandedId === emp.id ? 'ย่อ' : 'จัดการ'}
                  </button>
                </div>
              </div>

              {expandedId === emp.id && (
                <EmployeeDetailPanel
                  companyId={companyId}
                  employee={emp}
                  roles={roles}
                  onChanged={() => void reload()}
                  onHandoff={(h) => setHandoff(h)}
                  onLinePackage={(p) => setLinePackage({ employeeId: emp.id, ...p })}
                />
              )}

              {linePackage?.employeeId === emp.id && (
                <QrLinkCard linkUrl={linePackage.linkUrl} qrImageUrl={linePackage.qrImageUrl} expiresAt={linePackage.expiresAt} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateEmployeeForm({ companyId, roles, onCancel, onCreated }: { companyId: string; roles: any[]; onCancel: () => void; onCreated: (result: any) => void }) {
  const locale = useWorkspaceLocale();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [identityType, setIdentityType] = useState('THAI_NATIONAL_ID');
  const [identityNumber, setIdentityNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (roleIds.length !== 1) { setError('กรุณาเลือกบทบาทเพียง 1 บทบาท'); return; }
    setSaving(true); setError(null);
    try {
      const result = await createEmployee(companyId, {
        displayName: trimmed(displayName),
        username: trimmed(username),
        legalName: trimmed(legalName) || undefined,
        dateOfBirth,
        identityType,
        identityNumber: trimmed(identityNumber),
        phoneNumber: trimmed(phoneNumber),
        roleIds,
      });
      onCreated(result);
    } catch (e) { setError(localizedErrorMessage(e, locale, { 409: 'error.conflict', fallback: 'error.save_failed' })); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-gray-100 bg-linear-to-r from-brand-25 to-white px-5 py-4">
        <SectionTitle eyebrow="พนักงานใหม่" title="เพิ่มพนักงาน">
          กรอกข้อมูลหลัก กำหนดบทบาท แล้วระบบจะสร้างบัญชีเข้าใช้งานให้ทันที
        </SectionTitle>
      </div>
      <div className="space-y-5 p-5">
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className={`${mutedPanelClass} p-4`}>
          <SectionTitle title="ข้อมูลส่วนตัว" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
          <FieldLabel>Username</FieldLabel>
          <input className={inputClass} required pattern="[a-zA-Z0-9._-]+" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
          <div>
          <FieldLabel>ชื่อที่ใช้แสดง</FieldLabel>
          <input className={inputClass} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>ชื่อตามกฎหมาย (ถ้ามี)</FieldLabel>
          <input className={inputClass} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>วันเดือนปีเกิด</FieldLabel>
          <ThemedDate className={inputClass} required value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        </div>
        <div>
          <FieldLabel>ประเภทเอกสาร</FieldLabel>
          <ThemedSelect className={inputClass} value={identityType} onChange={(e) => setIdentityType(e.target.value)}>
            <option value="THAI_NATIONAL_ID">บัตรประชาชนไทย</option>
            <option value="PASSPORT">พาสปอร์ต</option>
          </ThemedSelect>
        </div>
        <div>
          <FieldLabel>เลขบัตรประชาชน/พาสปอร์ต</FieldLabel>
          <input className={inputClass} required value={identityNumber} onChange={(e) => setIdentityNumber(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel>เบอร์โทรศัพท์</FieldLabel>
          <input className={inputClass} required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
        </div>
      </div>
        </div>
        <div className={`${mutedPanelClass} p-4`}>
        <SectionTitle title="บทบาทและการเข้าใช้งาน">
          เลือกบทบาทที่พนักงานจะได้รับในบริษัทนี้
        </SectionTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          {roles.map((r) => (
            <label key={r.id} className={cx(
              'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
              roleIds.includes(r.id) ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200',
            )}>
              <input type="radio" name="create-employee-role" checked={roleIds.length === 1 && roleIds[0] === r.id} onChange={() => setRoleIds([r.id])} />
              {roleDisplayName(r, locale)}
            </label>
          ))}
          {roles.length === 0 && <div className="text-sm text-gray-400">ยังไม่มีบทบาทที่เลือกได้</div>}
        </div>
        <div className="mt-4 rounded-lg border border-dashed border-brand-200 bg-white p-3 text-xs leading-5 text-gray-500">
          หลังสร้าง ระบบจะแสดงชื่อผู้ใช้ รหัสผ่านวันเดือนปีเกิด และ QR เชื่อม LINE สำหรับส่งต่อให้พนักงาน
        </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" className={ghostClass} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className={btnClass} disabled={saving}>
          <PlusIcon className="h-4 w-4" />
          {saving ? 'กำลังบันทึก...' : 'สร้างพนักงาน'}
        </button>
      </div>
      </div>
    </form>
  );
}

function EmployeeDetailPanel({ companyId, employee, roles, onChanged, onHandoff, onLinePackage }: {
  companyId: string; employee: any; roles: any[];
  onChanged: () => void; onHandoff: (h: any) => void; onLinePackage: (p: any) => void;
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(employee.displayName);
  const [phoneNumber, setPhoneNumber] = useState(employee.phoneNumber);
  const [roleIds, setRoleIds] = useState<string[]>(employee.roles.map((r: any) => r.id));
  // 10D branch scope assignment (governs web + LINE data visibility)
  const [branchScopeMode, setBranchScopeMode] = useState<string>(employee.branchScopeMode ?? 'ALL_BRANCHES');
  const [scopeBranchIds, setScopeBranchIds] = useState<string[]>(employee.branchScopeBranchIds ?? []);
  const [defaultBranchId, setDefaultBranchId] = useState<string>(employee.defaultBranchId ?? '');
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCompanyBranches(companyId).then(setBranches).catch(() => { /* no branch.read → hide section */ });
  }, [companyId]);

  // `done` is omitted for actions that already show their result in a panel (credential handoff, LINE QR).
  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key); setError(null);
    try { await fn(); if (done) toast.success(done); } catch (e) { setError(localizedErrorMessage(e, locale, { 409: 'error.conflict', fallback: 'error.save_failed' })); }
    finally { setBusy(null); }
  };

  const saveEmployee = async () => {
    if (roleIds.length !== 1) { setError('กรุณาเลือกบทบาทเพียง 1 บทบาท'); return; }
    if (branchScopeMode === 'SELECTED_BRANCHES' && scopeBranchIds.length === 0) {
      setError('เลือกอย่างน้อย 1 สาขาสำหรับขอบเขตแบบเฉพาะสาขา'); return;
    }
    if (branchScopeMode === 'DEFAULT_BRANCH_ONLY' && !defaultBranchId) {
      setError('เลือกสาขาหลักสำหรับขอบเขตแบบสาขาหลักเท่านั้น'); return;
    }
    await updateEmployee(companyId, employee.id, {
      displayName,
      phoneNumber,
      roleIds,
      branchScopeMode,
      defaultBranchId: defaultBranchId || null,
      branchIds: branchScopeMode === 'SELECTED_BRANCHES' ? scopeBranchIds : [],
    });
    onChanged();
  };

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-brand-100 bg-brand-25/60 p-4">
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className={`${panelClass} p-4`}>
          <SectionTitle title="ข้อมูลพนักงาน">
            แก้ข้อมูลหลักที่ใช้แสดงในระบบและเอกสารส่งมอบ
          </SectionTitle>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>ชื่อที่ใช้แสดง</FieldLabel>
              <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <FieldLabel>เบอร์โทรศัพท์</FieldLabel>
              <input className={inputClass} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </div>
          </div>
        </div>
        <div className={`${panelClass} p-4`}>
          <SectionTitle title="บทบาท">
            เลือกบทบาทที่กำหนดว่าพนักงานคนนี้ทำอะไรได้บ้าง
          </SectionTitle>
          <div className="mt-4 flex flex-wrap gap-2">
            {roles.map((r) => (
              <label key={r.id} className={cx(
                'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                roleIds.includes(r.id) ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200',
              )}>
                <input type="radio" name={`employee-role-${employee.id}`} checked={roleIds.length === 1 && roleIds[0] === r.id} onChange={() => setRoleIds([r.id])} />
                {roleDisplayName(r, locale)}
              </label>
            ))}
          </div>
        </div>
      </div>
      {branches.length > 0 && (
        <div className={`${panelClass} p-4`}>
          <SectionTitle title="ขอบเขตสาขา">
            ใช้ควบคุมข้อมูลที่พนักงานเห็นทั้งบนเว็บและ LINE
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>โหมดการมองเห็น</FieldLabel>
              <ThemedSelect className={inputClass} value={branchScopeMode} onChange={(e) => setBranchScopeMode(e.target.value)}>
                <option value="ALL_BRANCHES">เห็นทุกสาขา</option>
                <option value="SELECTED_BRANCHES">เฉพาะสาขาที่เลือก</option>
                <option value="DEFAULT_BRANCH_ONLY">เฉพาะสาขาหลักเท่านั้น</option>
              </ThemedSelect>
            </div>
            <div>
              <FieldLabel>สาขาหลัก</FieldLabel>
              <ThemedSelect className={inputClass} value={defaultBranchId} onChange={(e) => setDefaultBranchId(e.target.value)}>
                <option value="">— สาขาหลัก (ไม่ระบุ) —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </ThemedSelect>
            </div>
          </div>
          {branchScopeMode === 'SELECTED_BRANCHES' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {branches.map((b) => (
                <label key={b.id} className={cx(
                  'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                  scopeBranchIds.includes(b.id) ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200',
                )}>
                  <input
                    type="checkbox"
                    checked={scopeBranchIds.includes(b.id)}
                    onChange={(e) => setScopeBranchIds((prev) => e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id))}
                  />
                  {b.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={`${panelClass} flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center`}>
        <button className={ghostClass} disabled={busy !== null} onClick={() => run('save', saveEmployee, 'บันทึกข้อมูลพนักงานแล้ว')}>
          <CheckCircleIcon className="h-4 w-4" />
          {busy === 'save' ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
        </button>
        <button className={ghostClass} disabled={busy !== null} onClick={() => run('cred', async () => { onHandoff(await regenerateEmployeeCredential(companyId, employee.id)); })}>
          <LockIcon className="h-4 w-4" />
          {busy === 'cred' ? 'กำลังสร้าง...' : 'สร้างรหัสผ่านชั่วคราวใหม่'}
        </button>
        <button className={ghostClass} disabled={busy !== null} onClick={() => run('qr', async () => { onLinePackage(await issueEmployeeLineLinkToken(companyId, employee.id)); })}>
          <CopyIcon className="h-4 w-4" />
          {busy === 'qr' ? 'กำลังสร้าง...' : 'สร้าง QR เชื่อม LINE'}
        </button>
        <button className={ghostClass} disabled={busy !== null} onClick={() => run('revoke', async () => { await revokeEmployeeLineLinkToken(companyId, employee.id); onChanged(); }, 'ยกเลิกลิงก์ LINE ที่รอดำเนินการแล้ว')}>
          ยกเลิกลิงก์ LINE ที่รอดำเนินการ
        </button>
        {employee.status !== 'ACTIVE' && employee.status !== 'DRAFT' && (
          <button className={ghostClass} disabled={busy !== null} onClick={() => run('enable', async () => { await setEmployeeStatus(companyId, employee.id, 'ACTIVE'); onChanged(); }, 'เปิดใช้งานพนักงานอีกครั้งแล้ว')}>
            เปิดใช้งานอีกครั้ง
          </button>
        )}
        {employee.status === 'ACTIVE' && (
          <button className={ghostClass} disabled={busy !== null} onClick={() => run('suspend', async () => { await setEmployeeStatus(companyId, employee.id, 'SUSPENDED'); onChanged(); }, 'ระงับพนักงานชั่วคราวแล้ว')}>
            ระงับชั่วคราว
          </button>
        )}
        {employee.status !== 'DISABLED' && (
          <button className={dangerClass} disabled={busy !== null} onClick={() => run('disable', async () => { await setEmployeeStatus(companyId, employee.id, 'DISABLED'); onChanged(); }, 'ปิดการใช้งานพนักงานแล้ว')}>
            <TrashIcon className="h-4 w-4" />
            ปิดการใช้งาน
          </button>
        )}
      </div>
    </div>
  );
}

// ── Roles ────────────────────────────────────────────────────────────────────
function RolesView({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [disablingRoleId, setDisablingRoleId] = useState<string | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [packModules, setPackModules] = useState<Array<{ module: string; packs: CapabilityPackView[] }>>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [smartRolesWarning, setSmartRolesWarning] = useState<string | null>(null);
  const [roleOptionsAvailable, setRoleOptionsAvailable] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const revealedRolePanel = useRevealedPanel(showCreate);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setSmartRolesWarning(null);
    const [rolesResult, catalogResult, packsResult, templatesResult] = await Promise.allSettled([
      listRoles(companyId),
      listPermissionCatalog(companyId),
      listCapabilityPacks(companyId),
      listRoleTemplates(companyId),
    ]);

    let nextError: string | null = null;
    if (rolesResult.status === 'fulfilled') {
      setRoles(rolesResult.value);
    } else {
      setRoles([]);
      nextError = localizedErrorMessage(rolesResult.reason, locale, { fallback: 'error.load_failed' });
    }

    if (catalogResult.status === 'fulfilled') {
      setCatalog(catalogResult.value);
    } else if (!nextError) {
      setCatalog([]);
      nextError = localizedErrorMessage(catalogResult.reason, locale, { fallback: 'error.load_failed' });
    } else {
      setCatalog([]);
    }

    const smartWarnings: string[] = [];
    if (packsResult.status === 'fulfilled') {
      setPackModules(packsResult.value.modules);
      setRoleOptionsAvailable(true);
    } else {
      setPackModules([]);
      setRoleOptionsAvailable(false);
      smartWarnings.push('ตัวเลือกงาน');
    }

    if (templatesResult.status === 'fulfilled') {
      setTemplates(templatesResult.value);
    } else {
      setTemplates([]);
      smartWarnings.push('บทบาทแนะนำ');
    }

    if (smartWarnings.length > 0) {
      setSmartRolesWarning(`โหลด${smartWarnings.join('และ')}ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`);
    }

    setError(nextError);
    setLoading(false);
  }, [companyId, locale]);

  useEffect(() => { void reload(); }, [reload]);

  const allPacks = useMemo(() => packModules.flatMap((m) => m.packs), [packModules]);
  const canEditRoles = catalog.length > 0 && roleOptionsAvailable;

  if (loading) return <LoadingState label="กำลังโหลด..." />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}
      {smartRolesWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{smartRolesWarning}</div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile icon={<LockIcon className="h-5 w-5" />} label="บทบาททั้งหมด" value={String(roles.length)} />
        <StatTile icon={<BoltIcon className="h-5 w-5" />} label="งานที่เลือกได้" value={String(allPacks.filter((p) => !p.isCore && !p.locked && p.grantableByCurrentUser).length)} tone="blue" />
        <StatTile icon={<TableIcon className="h-5 w-5" />} label="บทบาทที่กำหนดเอง" value={String(roles.filter((role) => !role.isSystem).length)} tone="gold" />
      </div>
      <div className={`${panelClass} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <SectionTitle eyebrow="บทบาทตามความสามารถ" title="บทบาทและสิทธิ์">
          เลือกงานที่คนในบทบาทนี้ทำได้ ระบบจะจัดสิทธิ์ที่จำเป็นให้เอง
        </SectionTitle>
        <button className={showCreate ? ghostClass : btnClass} disabled={!canEditRoles} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'ยกเลิก' : <><PlusIcon className="h-4 w-4" /> เพิ่มบทบาท</>}
        </button>
      </div>

      {showCreate && canEditRoles && (
        <div ref={revealedRolePanel}>
        <RoleBuilder
          companyId={companyId} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable} permissionCatalog={catalog}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (body) => { await createRole(companyId, body); toast.success('สร้างบทบาทแล้ว'); setShowCreate(false); void reload(); }}
        />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {roles.map((role) => {
          const caps = coveredPacks(role.permissionKeys, allPacks);
          return (
            <div key={role.id} className={`${panelClass} space-y-3 p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700">
                    <LockIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-gray-900">{roleDisplayName(role, locale)} {role.isSystem && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">ระบบ</span>}</div>
                    <div className="mt-1 text-xs leading-5 text-gray-500">{role.description || 'ไม่มีคำอธิบาย'}</div>
                  </div>
                </div>
                {!role.isSystem && (
                  <div className="flex flex-wrap gap-2">
                    <button className={ghostClass} disabled={!canEditRoles} onClick={() => setEditingRoleId(editingRoleId === role.id ? null : role.id)}>
                      {editingRoleId === role.id ? 'ย่อ' : 'แก้ไข'}
                    </button>
                    <button className={dangerClass} disabled={!canEditRoles || disablingRoleId !== null} onClick={async () => { setDisablingRoleId(role.id); try { await disableRole(companyId, role.id); toast.success('ปิดใช้งานบทบาทแล้ว'); void reload(); } catch (e) { setError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' })); } finally { setDisablingRoleId(null); } }}>
                      <TrashIcon className="h-4 w-4" />
                      {disablingRoleId === role.id ? 'กำลังปิดใช้งาน...' : 'ปิดใช้งาน'}
                    </button>
                  </div>
                )}
              </div>
              {caps.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {caps.map((p) => (
                    <span key={p.key} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                      {p.nameTh}<RiskBadge risk={p.riskLevel} />
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500">ตั้งค่าสิทธิ์ตามบทบาทนี้แล้ว</div>
              )}
              {editingRoleId === role.id && canEditRoles && (
                <RoleBuilder
                  companyId={companyId} packModules={packModules} allPacks={allPacks} templates={templates} roleOptionsAvailable={roleOptionsAvailable} permissionCatalog={catalog}
                  initial={role}
                  onCancel={() => setEditingRoleId(null)}
                  onSubmit={async (body) => { await updateRole(companyId, role.id, body); toast.success('บันทึกบทบาทแล้ว'); setEditingRoleId(null); void reload(); }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Guided role builder: job template → plain-language work options → live preview.
export function RoleBuilder({ companyId, packModules, allPacks, templates, roleOptionsAvailable, permissionCatalog = [], initial, onCancel, onSubmit }: {
  companyId: string;
  packModules: Array<{ module: string; packs: CapabilityPackView[] }>;
  allPacks: CapabilityPackView[];
  templates: RoleTemplate[];
  roleOptionsAvailable: boolean;
  permissionCatalog?: PermissionCatalogItem[];
  initial?: any;
  onCancel: () => void;
  onSubmit: (body: any) => Promise<void>;
}) {
  const locale = useWorkspaceLocale();
  const coreKeys = useMemo(() => new Set(allPacks.filter((p) => p.isCore).flatMap((p) => p.permissionKeys)), [allPacks]);
  const availablePackKeys = useMemo(
    () => new Set(allPacks.filter((p) => !p.isCore && !p.locked && p.grantableByCurrentUser).map((p) => p.key)),
    [allPacks],
  );

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // Round-trip an edited role: visible packs become toggles; unmatched keys stay preserved but hidden.
  const initSelected = useMemo(
    () => (initial ? coveredPacks(initial.permissionKeys, allPacks).filter((p) => availablePackKeys.has(p.key)).map((p) => p.key) : []),
    [initial, allPacks, availablePackKeys],
  );
  const [selectedPacks, setSelectedPacks] = useState<string[]>(initSelected);
  const initPreserved = useMemo(() => {
    if (!initial) return [] as string[];
    const covered = new Set([...coreKeys, ...allPacks.filter((p) => initSelected.includes(p.key)).flatMap((p) => p.permissionKeys)]);
    return (initial.permissionKeys as string[]).filter((k) => !covered.has(k));
  }, [initial, initSelected, allPacks, coreKeys]);
  const [preservedKeys, setPreservedKeys] = useState<string[]>(initPreserved);
  const [preview, setPreview] = useState<RolePreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePack = (key: string) =>
    setSelectedPacks((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const applyPreset = (tpl: RoleTemplate) => {
    // Expand the preset into pack toggles client-side; the compiled keys are identical to sending the
    // template key, but this keeps deselecting a preset pack working (the API unions template packs).
    // Skip packs this company can't enable (not entitled) or this user can't grant — the preview would
    // only drop them anyway.
    setSelectedPacks(tpl.capabilityPackKeys);
    setPreservedKeys([]);
    if (!name) setName(tpl.nameTh);
  };

  // Debounced live preview whenever the selection changes.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!roleOptionsAvailable) { setPreview(null); setPreviewing(false); return; }
    if (selectedPacks.length === 0 && preservedKeys.length === 0) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewing(true);
    debounceRef.current = setTimeout(() => {
      previewRole(companyId, { capabilityPackKeys: selectedPacks, permissionKeys: preservedKeys, roleId: initial?.id })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [companyId, selectedPacks, preservedKeys, initial?.id, roleOptionsAvailable]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleOptionsAvailable) { setError('ยังโหลดตัวเลือกไม่ได้ กรุณายกเลิกแล้วลองใหม่อีกครั้ง'); return; }
    if (selectedPacks.length === 0 && preservedKeys.length === 0) { setError('กรุณาเลือกงานอย่างน้อย 1 รายการ'); return; }
    setSaving(true); setError(null);
    try { await onSubmit({ name: trimmed(name), description: trimmed(description) || undefined, capabilityPackKeys: selectedPacks, permissionKeys: preservedKeys }); }
    catch (e2) { setError(localizedErrorMessage(e2, locale, { fallback: 'error.save_failed' })); }
    finally { setSaving(false); }
  };

  const byIndustry = useMemo(() => {
    const map = new Map<string, RoleTemplate[]>();
    for (const t of templates.filter((tpl) => tpl.capabilityPackKeys.every((key) => availablePackKeys.has(key)))) {
      const k = t.industryTag ?? 'crosscutting'; map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()];
  }, [templates, availablePackKeys]);

  return (
    <form onSubmit={submit} className={`${panelClass} min-w-0 overflow-hidden lg:col-span-2`}>
      <div className="border-b border-gray-100 bg-linear-to-r from-brand-25 to-white px-5 py-4">
        <SectionTitle eyebrow={initial ? 'แก้ไขบทบาท' : 'บทบาทใหม่'} title={initial ? 'แก้ไขบทบาท' : 'เพิ่มบทบาท'}>
          เลือกหน้าที่และงานที่ทำได้ ระบบจะจัดสิทธิ์ที่จำเป็นให้เอง
        </SectionTitle>
      </div>
      <div className="space-y-5 p-5">
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>ชื่อบทบาท</FieldLabel>
          <input className={inputClass} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>คำอธิบาย (ถ้ามี)</FieldLabel>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: guided selection */}
        <div className="min-w-0 space-y-4">
          {/* Step 1 — Job preset */}
          {roleOptionsAvailable && byIndustry.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-bold text-gray-600">1. เลือกบทบาทตั้งต้น (ไม่บังคับ)</div>
              <div className={`${mutedPanelClass} space-y-3 p-3`}>
                {byIndustry.map(([industry, tpls]) => (
                  <div key={industry}>
                    <div className="mb-1 text-[11px] font-semibold uppercase text-gray-400">{INDUSTRY_LABEL[industry] ?? 'งานทั่วไป'}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {tpls.map((t) => (
                        <button type="button" key={t.key} onClick={() => applyPreset(t)} title={t.description}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-brand-300 hover:bg-brand-50">
                          {t.nameTh}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Capability packs */}
          {roleOptionsAvailable && (
            <div>
              <div className="mb-2 text-xs font-bold text-gray-600">{byIndustry.length > 0 ? '2. เลือกงานที่ทำได้' : 'เลือกงานที่ทำได้'}</div>
              <div className={`${mutedPanelClass} max-h-96 space-y-3 overflow-y-auto p-3`}>
                {packModules.map(({ module, packs }) => {
                  const shown = packs.filter((p) => availablePackKeys.has(p.key));
                  if (shown.length === 0) return null;
                  return (
                    <div key={module}>
                      <div className="mb-1 text-[11px] font-semibold uppercase text-gray-400">{MODULE_LABEL[module] ?? 'งานอื่น ๆ'}</div>
                      <div className="space-y-1.5">
                        {shown.map((p) => {
                          const checked = selectedPacks.includes(p.key);
                          return (
                            <label key={p.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? 'border-brand-200 bg-brand-50' : 'border-gray-200 bg-white hover:border-brand-300'}`}>
                              <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => togglePack(p.key)} />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-gray-800">{p.nameTh}</span>
                                  <RiskBadge risk={p.riskLevel} />
                                </span>
                                <span className="block text-[11px] text-gray-500">{p.description}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {availablePackKeys.size === 0 && (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                  บริษัทนี้ยังไม่มีงานเพิ่มเติมที่เปิดให้กำหนด
                </div>
              )}
              {preservedKeys.length > 0 && (
                <details className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs" open>
                  <summary className="cursor-pointer font-semibold">สิทธิ์เดิมที่คงไว้ ({preservedKeys.length} รายการ)</summary>
                  <p className="mt-2 text-gray-600">สิทธิ์เหล่านี้ไม่ได้เป็นงานครบทั้งชุด จึงไม่ติ๊กช่องงานด้านบน การบันทึกจะคงสิทธิ์เดิมไว้ การเลือกบทบาทตั้งต้นใหม่จะใช้สิทธิ์ของชุดที่เลือกแทน</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {preservedKeys.map((key) => <li key={key}>{permissionCatalog.find((p) => p.key === key)?.description ?? key}</li>)}
                  </ul>
                </details>
              )}
              <p className="mt-1 text-[11px] text-gray-400">ทุกบทบาทเข้าสู่ระบบ ดูหน้าหลัก และรับการแจ้งเตือนได้โดยอัตโนมัติ</p>
            </div>
          )}

          {!roleOptionsAvailable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              ยังโหลดตัวเลือกสำหรับกำหนดบทบาทไม่ได้ กรุณายกเลิกแล้วลองใหม่อีกครั้ง
            </div>
          )}
        </div>

        {/* Right: live preview */}
        <div className="min-w-0 space-y-3 rounded-lg border border-brand-100 bg-brand-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between">
            <div className="text-sm font-bold text-gray-800">สรุปว่างานนี้ทำอะไรได้บ้าง</div>
            {previewing && <span className="text-[11px] text-gray-400">กำลังคำนวณ...</span>}
          </div>
          {!roleOptionsAvailable && <p className="text-xs text-gray-500">ยังแสดงตัวอย่างไม่ได้ กรุณาลองใหม่อีกครั้ง</p>}
          {!preview && !previewing && roleOptionsAvailable && <p className="text-xs text-gray-400">เลือกงานเพื่อดูตัวอย่าง</p>}
          {preview && (
            <>
              <div className="text-[11px] text-gray-500">{preview.capabilities.length} กลุ่มงาน</div>
              <div className="flex flex-wrap gap-1">
                {preview.capabilities.length === 0 && <span className="text-xs text-gray-400">ยังไม่มีกลุ่มงานที่เลือก</span>}
                {preview.capabilities.map((c) => (
                  <span key={c.packKey} className="inline-flex items-center gap-1 rounded bg-white border border-brand-100 px-2 py-0.5 text-[11px] text-brand-700">
                    {c.nameTh}<RiskBadge risk={c.riskLevel} />
                  </span>
                ))}
              </div>
              {initial && ((preview.addedVsCurrent?.length ?? 0) > 0 || (preview.removedVsCurrent?.length ?? 0) > 0) && (
                <div className="text-[11px] text-gray-500">
                  {(preview.addedVsCurrent?.length ?? 0) > 0 && <span className="text-green-700">+{preview.addedVsCurrent!.length} เพิ่ม</span>}{' '}
                  {(preview.removedVsCurrent?.length ?? 0) > 0 && <span className="text-red-700">−{preview.removedVsCurrent!.length} เอาออก</span>}
                </div>
              )}
              {preview.droppedKeys.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                  <div className="font-medium">บางรายการไม่สามารถเพิ่มได้:</div>
                  <ul className="list-disc pl-4">
                    {[...new Set(preview.droppedKeys.map((d) => d.reason))].map((r) => (
                      <li key={r}>{DROP_REASON_LABEL[r] ?? 'รายการนี้ไม่พร้อมใช้งาน'} ({preview.droppedKeys.filter((d) => d.reason === r).length})</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" className={ghostClass} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className={btnClass} disabled={saving || !roleOptionsAvailable}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
      </div>
    </form>
  );
}

// ── Who-can-do-what matrix ────────────────────────────────────────────────────
function MatrixView({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const [rows, setRows] = useState<CompanyAccessMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    getEffectiveAccessMatrix(companyId)
      .then((m) => setRows(m.rows))
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error != null) return <ErrorBanner message={localizedErrorMessage(error, locale, { 403: 'error.forbidden', fallback: 'error.load_failed' })} />;
  if (rows.length === 0) return <Empty text="ยังไม่มีพนักงานที่ใช้งานอยู่" />;
  const highRiskTotal = rows.reduce((sum, row) => sum + row.highRiskCount, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile icon={<GroupIcon className="h-5 w-5" />} label="พนักงานทั้งหมด" value={String(rows.length)} />
        <StatTile icon={<BoltIcon className="h-5 w-5" />} label="สิทธิ์เสี่ยงสูง" value={String(highRiskTotal)} tone={highRiskTotal > 0 ? 'gold' : 'gray'} />
        <StatTile icon={<TableIcon className="h-5 w-5" />} label="ข้อมูลที่แสดง" value="ตามการใช้งานจริง" tone="blue" />
      </div>
      <div className={`${panelClass} p-4`}>
        <SectionTitle eyebrow="ภาพรวมการเข้าถึง" title="ภาพรวมสิทธิ์">
          ใครทำอะไรได้บ้าง — สรุปความสามารถของพนักงานที่ใช้งานอยู่ทั้งหมด
        </SectionTitle>
      </div>
      <div className={`${panelClass} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-bold uppercase tracking-[.04em] text-gray-400">
              <th className="px-4 py-3">พนักงาน</th>
              <th className="px-4 py-3">บทบาท</th>
              <th className="px-4 py-3">ความสามารถ</th>
              <th className="px-4 py-3">เสี่ยงสูง</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <MatrixRow key={r.membershipId} companyId={companyId} row={r} open={openId === r.membershipId}
                onToggle={() => setOpenId(openId === r.membershipId ? null : r.membershipId)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatrixRow({ companyId, row, open, onToggle }: {
  companyId: string; row: CompanyAccessMatrixRow; open: boolean; onToggle: () => void;
}) {
  const locale = useWorkspaceLocale();
  const [detail, setDetail] = useState<EffectiveAccessView | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open && !detail) {
      getMembershipEffectiveAccess(companyId, row.membershipId).then(setDetail).catch((e) => setError(e));
    }
  }, [open, detail, companyId, row.membershipId]);

  return (
    <>
      <tr className="align-top">
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <InitialAvatar label={row.displayName} />
            <span className="font-bold text-gray-900">{employeeFullName(row)}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {row.roleKeys.map((k) => <span key={k} className={chipClass}>{roleDisplayName(k, locale)}</span>)}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {row.capabilitySummary.length === 0 ? <span className="text-[11px] text-gray-400">พื้นฐานเท่านั้น</span>
              : row.capabilitySummary.map((c, i) => <span key={i} className={brandChipClass}>{c}</span>)}
          </div>
        </td>
        <td className="px-4 py-3">{row.highRiskCount > 0 ? <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${RISK_STYLE.HIGH}`}>{row.highRiskCount}</span> : <span className="text-[11px] text-gray-300">0</span>}</td>
        <td className="px-4 py-3 text-right"><button className={ghostClass} onClick={onToggle}>{open ? 'ย่อ' : 'รายละเอียด'}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-brand-25/50 px-4 py-4">
            {error != null && <ErrorBanner message={localizedErrorMessage(error, locale, { fallback: 'error.load_failed' })} />}
            {detail == null && error == null && <div className="text-xs text-gray-400">กำลังโหลด...</div>}
            {detail && (
              <div className={`${panelClass} space-y-3 p-4`}>
                <div className="text-sm font-bold text-gray-800">ทำอะไรได้บ้าง ({detail.capabilities.length} กลุ่มงาน)</div>
                <div className="flex flex-wrap gap-1">
                  {detail.capabilities.length === 0 && <span className="text-[11px] text-gray-400">สิทธิ์พื้นฐานเท่านั้น (เข้าสู่ระบบ, แดชบอร์ด, แจ้งเตือน)</span>}
                  {detail.capabilities.map((c) => (
                    <span key={c.packKey} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                      {c.nameTh}<RiskBadge risk={c.riskLevel} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
