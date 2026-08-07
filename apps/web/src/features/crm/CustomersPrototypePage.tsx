'use client';

import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CrmBookingSummary,
  CrmAccountingCustomerSummary,
  CrmCustomerDetail,
  CrmCustomerOriginSource,
  CrmCustomerLineIdentitySummary,
  CrmCustomerSummary,
  CrmMarketingCustomerSummary,
  CrmProjectedCustomerSummary,
  CrmCustomerTier,
  CrmDuplicateWarning,
  EmployeeSummary,
  PreviewCrmCustomerMergeResult,
} from '@watchdog-bms/contracts';
import { MangmeeBranchChip } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { listBranches, type Branch } from '@/features/branch-settings/branches.api';
import { employeeShortName, listEmployees } from '@/features/employee-access/employee-access.api';
import { listConversations } from '@/features/crm-inbox/crm-inbox.api';
import { avatarColor, avatarInitial } from '@/features/crm-inbox/crm-inbox.logic';
import {
  archiveCrmCustomer,
  assignCrmCustomer,
  createCrmCustomer,
  extractCrmCustomerProfile,
  getCrmCustomer,
  linkCrmCustomerLineIdentity,
  listCrmCustomers,
  listCustomerBookings,
  mergeCrmCustomers,
  previewCrmCustomerMerge,
  updateCrmCustomer,
} from './crm.api';
import {
  CONSENT_STATUS_LABEL,
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_STATUS_META,
  CUSTOMER_TYPE_LABEL,
  customerStatusParam,
  displayValue,
  findCustomerDuplicateMatches,
  validateCustomerForm,
  type CustomerDuplicateMatch,
  type CustomerStatusFilter,
} from './customers-prototype.model';

type CustomerDirectoryEntry = {
  id: string;
  name: string;
  phone: string;
  tier: CrmCustomerTier;
  ltv: string;
  lastVisit: string;
  branchName: string;
  initial: string;
  color: string;
  raw: CrmCustomerSummary;
};

type CustomerFormDraft = {
  displayName: string;
  primaryPhone: string;
  tier: CrmCustomerTier;
  notes: string;
  originSource: CrmCustomerOriginSource;
  ownerUserId: string;
};

type CustomerFormState = {
  mode: 'create' | 'edit';
  customerId?: string;
  originalOwnerUserId?: string;
  aiAssisted: boolean;
  draft: CustomerFormDraft;
};

type DuplicatePrompt = { matches: CustomerDuplicateMatch[]; draft: CustomerFormDraft };

const EMPTY_FORM: CustomerFormDraft = {
  displayName: '', primaryPhone: '', tier: 'LEAD', notes: '', originSource: 'MANUAL', ownerUserId: '',
};

const SOURCE_OPTIONS: { value: CrmCustomerOriginSource; label: string }[] = [
  { value: 'MANUAL', label: 'เพิ่มโดยพนักงาน' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'โทรศัพท์' },
  { value: 'WEB', label: 'เว็บไซต์' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

const TIER_OPTIONS: { value: CrmCustomerTier; label: string }[] = [
  { value: 'LEAD', label: 'ลูกค้าใหม่' },
  { value: 'ACTIVE', label: 'ลูกค้าประจำ' },
  { value: 'VIP', label: 'VIP' },
];

const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-100 disabled:text-gray-400';
const primaryButton = 'rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton = 'rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';

function errorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  const translated = code ? ({
    duplicate_customer_candidate: 'พบลูกค้าที่มีเบอร์โทรหรืออีเมลตรงกัน',
    duplicate_candidate_requires_manager_review: 'พบข้อมูลซ้ำที่คุณไม่มีสิทธิ์เปิด กรุณาให้ผู้จัดการตรวจสอบ',
    duplicate_tax_id: 'เลขประจำตัวผู้เสียภาษีนี้มีอยู่แล้ว',
    customer_merge_conflict: 'ข้อมูลลูกค้าสองรายการขัดแย้งกัน จึงยังรวมไม่ได้',
    primary_customer_not_active: 'ข้อมูลหลักต้องเป็นลูกค้าที่ใช้งานอยู่',
    secondary_already_merged: 'ข้อมูลรองถูกรวมไปแล้ว',
    tax_id_conflict: 'เลขประจำตัวผู้เสียภาษีของสองรายการไม่ตรงกัน',
    accounting_counterparty_conflict: 'คู่ค้าทางบัญชีของสองรายการไม่ตรงกัน',
    line_identity_changed: 'LINE identity ถูกเปลี่ยนโดยผู้ใช้อื่น กรุณาโหลดใหม่',
    target_line_identity_conflict: 'ลูกค้าหลักมี LINE identity นี้อยู่แล้ว',
  } as Record<string, string>)[code] : undefined;
  if (translated) return translated;
  const status = (error as { status?: number } | null)?.status;
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ';
  if (status === 409) return 'ข้อมูลถูกเปลี่ยนหรือพบลูกค้าซ้ำ กรุณาตรวจสอบอีกครั้ง';
  if (status === 422 || status === 400) return 'ข้อมูลไม่ผ่านเงื่อนไข กรุณาตรวจสอบแล้วลองใหม่';
  return error instanceof Error && error.message && !/^API error/.test(error.message) ? error.message : fallback;
}

function mergeConflictLabel(code: string): string {
  return ({
    primary_customer_not_active: 'ข้อมูลหลักไม่ได้อยู่ในสถานะใช้งาน',
    secondary_already_merged: 'ข้อมูลรองถูกรวมไปแล้ว',
    tax_id_conflict: 'เลขประจำตัวผู้เสียภาษีไม่ตรงกัน',
    accounting_counterparty_conflict: 'คู่ค้าทางบัญชีไม่ตรงกัน',
  } as Record<string, string>)[code] ?? 'พบเงื่อนไขที่ต้องให้ผู้จัดการตรวจสอบ';
}

function money(value?: string): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '0';
}

function shortDate(value?: string): string {
  return formatThaiDate(value);
}

function shortDateTime(value?: string): string {
  return formatThaiDateTime(value);
}

function sourceLabel(source?: CrmCustomerOriginSource): string {
  if (!source) return 'ไม่ระบุ';
  if (source === 'LINE') return 'LINE';
  if (source === 'WALK_IN') return 'Walk-in';
  if (source === 'PHONE') return 'โทรศัพท์';
  if (source === 'WEB') return 'เว็บไซต์';
  if (source === 'MANUAL') return 'พนักงาน';
  if (source === 'FACEBOOK') return 'Facebook';
  if (source === 'MARKETPLACE') return 'Marketplace';
  if (source === 'REFERRAL') return 'แนะนำต่อ';
  if (source === 'IMPORT') return 'นำเข้า';
  return source;
}

function lineIdentityStatusLabel(status: CrmCustomerLineIdentitySummary['status']): string {
  if (status === 'ACTIVE') return 'ใช้งานอยู่';
  if (status === 'UNFOLLOWED') return 'เลิกติดตามแล้ว';
  return status === 'BLOCKED' ? 'บล็อกบัญชีแล้ว' : status;
}

function buildDirectory(customers: CrmCustomerSummary[], branches: Branch[]): CustomerDirectoryEntry[] {
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.displayName,
    phone: customer.primaryPhone ?? '—',
    tier: customer.tier,
    ltv: money(customer.lifetimeValueAmount),
    lastVisit: shortDate(customer.lastActivityAt ?? customer.updatedAt),
    branchName: customer.branchId ? branchNames.get(customer.branchId) ?? 'ไม่ระบุสาขา' : 'ทุกสาขา',
    initial: avatarInitial(customer.displayName),
    color: avatarColor(customer.id),
    raw: customer,
  }));
}

function AccountingCustomerRow({ customer }: { customer: CrmAccountingCustomerSummary }) {
  return <tr className="bg-sky-50/30">
    <td className="px-5 py-3"><strong className="block text-gray-900">{customer.displayName}</strong><span className="text-xs text-gray-400">{customer.code ?? customer.legalName ?? 'ข้อมูลสำหรับงานบัญชี'}</span></td>
    <td className="px-5 py-3"><span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">บัญชี/ผู้ติดต่อ</span></td>
    <td className="px-5 py-3 text-gray-600">{customer.primaryPhone ?? '—'}</td>
    <td className="px-5 py-3 text-xs text-gray-400">ซ่อนตามสิทธิ์</td>
    <td className="px-5 py-3 text-xs text-gray-400">—</td>
    <td className="px-5 py-3"><div className="text-xs text-gray-500">อัปเดต {shortDate(customer.updatedAt)}</div>{customer.taxId && <div className="mt-1 text-xs text-gray-400">Tax ID {customer.taxId}</div>}</td>
    <td className="px-5 py-3 text-right"><span className="text-xs font-semibold text-gray-400">อ่านอย่างเดียว</span></td>
  </tr>;
}

function MarketingCustomerRow({ customer }: { customer: CrmMarketingCustomerSummary }) {
  return <tr className="bg-violet-50/20">
    <td className="px-5 py-3"><strong className="block text-gray-900">Customer {customer.customerRef.slice(0, 8)}</strong><span className="text-xs text-gray-400">ข้อมูลนามแฝงสำหรับการแบ่งกลุ่ม</span></td>
    <td className="px-5 py-3"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{sourceLabel(customer.originSource)}</span></td>
    <td className="px-5 py-3 text-xs text-gray-400">ซ่อนตามสิทธิ์</td>
    <td className="px-5 py-3 text-xs text-gray-400">ซ่อนตามสิทธิ์</td>
    <td className="px-5 py-3"><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">{TIER_OPTIONS.find((item) => item.value === customer.tier)?.label}</span></td>
    <td className="px-5 py-3 text-xs text-gray-500">{CONSENT_STATUS_LABEL[customer.consentStatus]}</td>
    <td className="px-5 py-3 text-right"><span className="text-xs font-semibold text-gray-400">ไม่เปิดเผย PII</span></td>
  </tr>;
}

function operationalCustomers(items: CrmProjectedCustomerSummary[]): CrmCustomerSummary[] {
  return items.flatMap((item) => item.projection === 'OPERATIONAL' ? [item.customer] : []);
}

async function findActiveAndInactiveCustomers(companyId: string, search: string): Promise<CrmCustomerSummary[]> {
  const results = await Promise.all((['ACTIVE', 'INACTIVE'] as const).map((status) =>
    listCrmCustomers(companyId, { scope: 'all', status, search, pageSize: 20 }),
  ));
  return [...new Map(results.flatMap((result) => operationalCustomers(result.items)).map((customer) => [customer.id, customer])).values()];
}

function DialogShell({ title, description, onClose, children, width = 'max-w-xl' }: {
  title: string; description?: string; onClose: () => void; children: React.ReactNode; width?: string;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.5)] p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-2xl bg-white shadow-2xl`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div><h2 className="text-xl font-extrabold text-gray-900">{title}</h2>{description && <p className="mt-1 text-sm text-gray-500">{description}</p>}</div>
          <button type="button" className="rounded-lg px-2 py-1 text-xl text-gray-400 hover:bg-gray-100" onClick={onClose} aria-label="ปิด">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-gray-700"><span className="mb-1.5 block">{label}</span>{children}{error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}</label>;
}

function CustomerFormDialog({ companyId, state, setState, employees, canUpdate, canAssign, canAi, saving, error, onClose, onSubmit }: {
  companyId: string;
  state: CustomerFormState;
  setState: React.Dispatch<React.SetStateAction<CustomerFormState | null>>;
  employees: EmployeeSummary[];
  canUpdate: boolean;
  canAssign: boolean;
  canAi: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [errors, setErrors] = useState<Partial<Record<'displayName' | 'primaryPhone', string>>>({});
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const editable = state.mode === 'create' || canUpdate;
  const updateDraft = (patch: Partial<CustomerFormDraft>) => setState((current) => current ? ({ ...current, draft: { ...current.draft, ...patch } }) : current);
  const submit = () => {
    const next = validateCustomerForm(state.draft);
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit();
  };
  const extract = async () => {
    if (aiText.trim().length < 2) return;
    setAiLoading(true); setAiNote(null);
    try {
      const result = await extractCrmCustomerProfile(companyId, { text: aiText.trim(), locale: 'th-TH' });
      if (result.status !== 'ok') { setAiNote('AI ยังสรุปข้อมูลไม่มั่นใจ กรุณากรอกเอง'); return; }
      updateDraft({
        displayName: result.suggested.displayName ?? state.draft.displayName,
        primaryPhone: result.suggested.primaryPhone ?? state.draft.primaryPhone,
        notes: result.suggested.notes ?? state.draft.notes,
      });
      setState((current) => current ? { ...current, aiAssisted: true } : current);
      setAiNote(`เติมแบบร่างแล้ว ความมั่นใจ ${Math.round(result.confidence <= 1 ? result.confidence * 100 : result.confidence)}% — กรุณาตรวจสอบก่อนบันทึก`);
    } catch (extractError) { setAiNote(errorMessage(extractError, 'AI ช่วยกรอกไม่สำเร็จ')); }
    finally { setAiLoading(false); }
  };

  return (
    <DialogShell title={state.mode === 'create' ? 'เพิ่มลูกค้า' : 'แก้ไขลูกค้า'} description="LINE identity และรหัสภายในเป็นข้อมูลระบบ จึงไม่เปิดให้แก้ด้วยมือ" onClose={onClose}>
      <div className="space-y-5 p-6">
        {canAi && state.mode === 'create' && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="font-bold text-violet-900">✨ ให้ AI ช่วยกรอกแบบร่าง</div>
            <p className="mt-1 text-xs text-violet-700">AI เติมฟอร์มเท่านั้น ไม่บันทึก ไม่เชื่อม LINE และไม่รวมลูกค้าอัตโนมัติ</p>
            <textarea className={`${inputClass} mt-3 min-h-20`} value={aiText} onChange={(event) => setAiText(event.target.value)} placeholder="เช่น ลูกค้าชื่อสมชาย โทร 081-234-5678 สนใจบริการรายเดือน" maxLength={2000} />
            <div className="mt-2 flex items-center gap-3"><button type="button" className={secondaryButton} disabled={aiLoading || aiText.trim().length < 2} onClick={() => void extract()}>{aiLoading ? 'กำลังวิเคราะห์…' : 'สร้างแบบร่าง'}</button>{aiNote && <span className="text-xs text-violet-700">{aiNote}</span>}</div>
          </div>
        )}

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อลูกค้า *" error={errors.displayName}><input className={inputClass} disabled={!editable} value={state.draft.displayName} onChange={(event) => updateDraft({ displayName: event.target.value })} maxLength={160} /></Field>
          <Field label="เบอร์โทร" error={errors.primaryPhone}><input className={inputClass} disabled={!editable} inputMode="tel" value={state.draft.primaryPhone} onChange={(event) => updateDraft({ primaryPhone: event.target.value })} placeholder="เช่น 081-234-5678" maxLength={40} /></Field>
          <Field label="ระดับลูกค้า"><ThemedSelect className={inputClass} disabled={!editable} value={state.draft.tier} onChange={(event) => updateDraft({ tier: event.target.value as CrmCustomerTier })}>{TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ThemedSelect></Field>
          {state.mode === 'create' ? <Field label="ช่องทางต้นทาง"><ThemedSelect className={inputClass} value={state.draft.originSource} onChange={(event) => updateDraft({ originSource: event.target.value as CrmCustomerOriginSource })}>{SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ThemedSelect></Field> : <Field label="ช่องทางต้นทาง"><input className={inputClass} disabled value={sourceLabel(state.draft.originSource)} /></Field>}
          {canAssign && employees.length > 0 && <Field label="ผู้ดูแล"><ThemedSelect className={inputClass} value={state.draft.ownerUserId} onChange={(event) => updateDraft({ ownerUserId: event.target.value })}>{state.mode === 'create' && <option value="">ใช้ผู้สร้างเป็นผู้ดูแล</option>}{state.draft.ownerUserId && !employees.some((employee) => employee.userId === state.draft.ownerUserId) && <option value={state.draft.ownerUserId}>ผู้ดูแลปัจจุบัน</option>}{employees.filter((employee) => employee.status === 'ACTIVE').map((employee) => <option key={employee.userId} value={employee.userId}>{employeeShortName(employee)}</option>)}</ThemedSelect></Field>}
          <div className="sm:col-span-2"><Field label="บันทึก"><textarea className={`${inputClass} min-h-24`} disabled={!editable} value={state.draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} maxLength={5000} /></Field></div>
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4"><button type="button" className={secondaryButton} onClick={onClose} disabled={saving}>ยกเลิก</button><button type="button" className={primaryButton} onClick={submit} disabled={saving || (!editable && !canAssign)}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button></footer>
    </DialogShell>
  );
}

function DuplicateDialog({ prompt, saving, onUseExisting, onContinue, onClose }: {
  prompt: DuplicatePrompt; saving: boolean; onUseExisting: (id: string) => void; onContinue: () => void; onClose: () => void;
}) {
  return (
    <DialogShell title="พบลูกค้าที่อาจเป็นคนเดียวกัน" description="ตรวจสอบก่อนสร้างหรือแก้ไข ระบบจะไม่รวมข้อมูลให้อัตโนมัติ" onClose={onClose}>
      <div className="space-y-3 p-6">{prompt.matches.map((match) => <div key={match.customer.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div><div className="font-bold text-gray-900">{match.customer.displayName}</div><div className="mt-1 text-xs text-gray-600">{match.matchType === 'PHONE' ? 'เบอร์โทรตรงกัน' : 'ชื่อตรงกัน'} · {displayValue(match.customer.primaryPhone)}</div></div><button type="button" className={secondaryButton} onClick={() => onUseExisting(match.customer.id)}>ใช้ข้อมูลนี้</button></div>)}</div>
      <footer className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4"><button type="button" className={secondaryButton} onClick={onClose}>กลับไปตรวจสอบ</button><button type="button" className={primaryButton} disabled={saving} onClick={onContinue}>{saving ? 'กำลังบันทึก…' : 'ยืนยันทำต่อ'}</button></footer>
    </DialogShell>
  );
}

function ArchiveDialog({ customer, saving, error, onClose, onConfirm }: { customer: CrmCustomerSummary; saving: boolean; error: string | null; onClose: () => void; onConfirm: (reason: string, override: boolean) => void }) {
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  return (
    <DialogShell title="เก็บลูกค้าเข้าคลัง" description={`ข้อมูลและประวัติของ ${customer.displayName} จะยังอยู่ ไม่ถูกลบ`} onClose={onClose}>
      <div className="space-y-4 p-6">{error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<Field label="เหตุผล *"><textarea className={`${inputClass} min-h-24`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Field><label className="flex items-start gap-2 text-sm text-gray-600"><input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} className="mt-1" /><span>ยืนยันเก็บแม้ยังมีดีลหรืองานติดตามที่เปิดอยู่</span></label></div>
      <footer className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4"><button type="button" className={secondaryButton} onClick={onClose}>ยกเลิก</button><button type="button" className={dangerButton} disabled={saving || !reason.trim()} onClick={() => onConfirm(reason.trim(), override)}>{saving ? 'กำลังเก็บ…' : 'ยืนยันเก็บเข้าคลัง'}</button></footer>
    </DialogShell>
  );
}

function impactLabel(key: keyof PreviewCrmCustomerMergeResult['impact']): string {
  return ({ bookings: 'การจอง', contacts: 'ผู้ติดต่อ', opportunities: 'ดีล', activities: 'กิจกรรม', followUps: 'งานติดตาม', quotationLinks: 'ใบเสนอราคา', convertedLeads: 'ลีด', lineIdentities: 'LINE identities', conversations: 'บทสนทนา' })[key];
}

function MergeDialog({ companyId, primary, onClose, onDone }: { companyId: string; primary: CrmCustomerDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<CrmCustomerSummary[]>([]);
  const [secondary, setSecondary] = useState<CrmCustomerDetail | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewCrmCustomerMergeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setCandidates([]); return; }
    let active = true;
    const timer = window.setTimeout(() => void findActiveAndInactiveCustomers(companyId, query.trim()).then((rows) => { if (active) setCandidates(rows.filter((customer) => customer.id !== primary.id)); }).catch((loadError) => { if (active) setError(errorMessage(loadError, 'ค้นหาลูกค้าไม่สำเร็จ')); }), 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, primary.id, query]);

  const select = async (customer: CrmCustomerSummary) => {
    setBusy(true); setError(null); setPreview(null);
    try {
      const result = await getCrmCustomer(companyId, customer.id);
      if (result.projection !== 'OPERATIONAL') throw new Error('ไม่มีสิทธิ์รวมข้อมูลลูกค้ารายนี้');
      setSecondary(result.customer);
    }
    catch (selectError) { setError(errorMessage(selectError, 'โหลดข้อมูลลูกค้าไม่สำเร็จ')); }
    finally { setBusy(false); }
  };
  const loadPreview = async () => {
    if (!secondary || !reason.trim()) return;
    setBusy(true); setError(null);
    try { setPreview(await previewCrmCustomerMerge(companyId, { primaryCustomerId: primary.id, secondaryCustomerId: secondary.id, reason: reason.trim() })); }
    catch (previewError) { setError(errorMessage(previewError, 'ตรวจสอบผลกระทบไม่สำเร็จ')); }
    finally { setBusy(false); }
  };
  const merge = async () => {
    if (!secondary || !preview?.canMerge) return;
    setBusy(true); setError(null);
    try { await mergeCrmCustomers(companyId, { primaryCustomerId: primary.id, secondaryCustomerId: secondary.id, reason: reason.trim() }); toast.success('รวมข้อมูลลูกค้าเรียบร้อยแล้ว'); onDone(); }
    catch (mergeError) { setError(errorMessage(mergeError, 'รวมข้อมูลลูกค้าไม่สำเร็จ')); }
    finally { setBusy(false); }
  };
  const linkIdentity = async (identity: CrmCustomerLineIdentitySummary) => {
    if (!secondary || !reason.trim()) return;
    setBusy(true); setError(null);
    try { await linkCrmCustomerLineIdentity(companyId, primary.id, identity.id, { expectedCurrentCustomerId: secondary.id, reason: reason.trim() }); toast.success('ย้ายบัญชี LINE มาที่ข้อมูลหลักเรียบร้อยแล้ว'); onDone(); }
    catch (linkError) { setError(errorMessage(linkError, 'เชื่อม LINE identity ไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  return (
    <DialogShell title="เชื่อมหรือรวมข้อมูลคนเดียวกัน" description={`เก็บ ${primary.displayName} เป็นข้อมูลหลัก ประวัติจะไม่ถูกลบ`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5 p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {!secondary ? <><Field label="ค้นหาข้อมูลซ้ำด้วยชื่อหรือเบอร์"><input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" /></Field><div className="space-y-2">{candidates.map((candidate) => <button key={candidate.id} type="button" className="flex w-full items-center justify-between rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50" onClick={() => void select(candidate)}><span><strong>{candidate.displayName}</strong><span className="ml-2 text-sm text-gray-500">{displayValue(candidate.primaryPhone)}</span></span><span className="text-sm font-semibold text-brand-600">เลือก</span></button>)}</div></> : <>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4"><div className="text-xs font-semibold text-gray-500">ข้อมูลรองที่เลือก</div><div className="mt-1 font-bold text-gray-900">{secondary.displayName} · {displayValue(secondary.primaryPhone)}</div><button type="button" className="mt-2 text-sm font-semibold text-brand-600" onClick={() => { setSecondary(null); setPreview(null); }}>เลือกใหม่</button></div>
          <Field label="เหตุผล *"><textarea className={`${inputClass} min-h-20`} value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} placeholder="เช่น ยืนยันกับลูกค้าแล้วว่าเป็นบุคคลเดียวกัน" maxLength={500} /></Field>
          {secondary.lineIdentities.length > 0 && <div><div className="mb-2 text-sm font-bold text-gray-700">ย้ายเฉพาะบัญชี LINE</div><p className="mb-2 text-xs text-gray-500">ใช้เมื่อข้อมูลลูกค้าถูกต้องอยู่แล้ว แต่บัญชี LINE เชื่อมอยู่กับรายการซ้ำ</p><div className="space-y-2">{secondary.lineIdentities.map((identity) => <div key={identity.id} className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-3"><div className="text-sm"><strong>{identity.displayName ?? 'ลูกค้า LINE'}</strong><div className="text-xs text-gray-500">{identity.maskedProviderUserId} · {lineIdentityStatusLabel(identity.status)}</div></div><button type="button" className={secondaryButton} disabled={busy || !reason.trim()} onClick={() => void linkIdentity(identity)}>ย้าย LINE มาที่ข้อมูลหลัก</button></div>)}</div></div>}
          {!preview ? <button type="button" className={primaryButton} disabled={busy || !reason.trim()} onClick={() => void loadPreview()}>{busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบผลกระทบ'}</button> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="font-bold text-amber-900">ผลกระทบ</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{(Object.entries(preview.impact) as [keyof PreviewCrmCustomerMergeResult['impact'], number][]).map(([key, count]) => <div key={key} className="rounded-lg bg-white px-3 py-2 text-sm"><span className="text-gray-500">{impactLabel(key)}</span><strong className="ml-2">{count}</strong></div>)}</div>{preview.conflicts.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-red-700">{preview.conflicts.map((conflict) => <li key={conflict}>{mergeConflictLabel(conflict)}</li>)}</ul>}</div>}
        </>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4"><button type="button" className={secondaryButton} onClick={onClose}>ยกเลิก</button>{preview && <button type="button" className={dangerButton} disabled={busy || !preview.canMerge} onClick={() => void merge()}>{busy ? 'กำลังรวม…' : 'ยืนยันรวมข้อมูล'}</button>}</footer>
    </DialogShell>
  );
}

function CustomerProfileModal({ companyId, summary, detail, bookings, conversationId, loading, error, ownerName, permissions, canAssignAvailable, canMergeCustomers, onClose, onRetry, onEdit, onArchive, onMerge }: {
  companyId: string;
  summary: CustomerDirectoryEntry;
  detail: CrmCustomerDetail | null;
  bookings: CrmBookingSummary[];
  conversationId: string | null;
  loading: boolean;
  error: string | null;
  ownerName?: string;
  permissions: string[];
  canAssignAvailable: boolean;
  canMergeCustomers: boolean;
  onClose: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onMerge: () => void;
}) {
  const customer = detail ?? summary.raw;
  const canEdit = permissions.includes('crm.customer.update') || canAssignAvailable;
  const canArchive = Boolean(detail) && permissions.includes('crm.customer.archive') && customer.status !== 'ARCHIVED' && customer.status !== 'MERGED';
  const canMerge = Boolean(detail) && canMergeCustomers && customer.status === 'ACTIVE';
  const nextBooking = bookings.find((booking) => booking.status === 'BOOKED');
  return (
    <DialogShell title={summary.name} description={`${CUSTOMER_TYPE_LABEL[customer.customerType]} · ${CUSTOMER_STATUS_META[customer.status].label}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white" style={{ background: summary.color }}>{summary.initial}</div><div><div className="text-sm text-gray-500">รหัสลูกค้า</div><div className="max-w-[26rem] truncate font-mono text-sm text-gray-800">{customer.code ?? customer.id}</div></div></div>
        {loading && <div className="rounded-xl bg-gray-50 p-5 text-center text-sm font-semibold text-gray-400">กำลังโหลดข้อมูลลูกค้า…</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}<button type="button" className="ml-3 font-bold underline" onClick={onRetry}>ลองใหม่</button></div>}
        {detail && <>
          <dl className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-2">{[
            ['เบอร์โทร', displayValue(detail.primaryPhone)], ['ช่องทางต้นทาง', sourceLabel(detail.originSource)], ['ผู้ดูแล', ownerName ?? (detail.ownerUserId ? 'พนักงานที่ได้รับมอบหมาย' : 'ยังไม่ระบุ')], ['ความยินยอม', CONSENT_STATUS_LABEL[detail.consentStatus]], ['ระดับลูกค้า', TIER_OPTIONS.find((item) => item.value === detail.tier)?.label ?? detail.tier], ['ใช้งานล่าสุด', shortDate(detail.lastActivityAt ?? detail.updatedAt)],
          ].map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-gray-500">{label}</dt><dd className="mt-1 text-sm font-bold text-gray-800">{value}</dd></div>)}</dl>
          <div><div className="mb-2 text-sm font-bold text-gray-700">LINE ที่เชื่อมไว้</div>{detail.lineIdentities.length === 0 ? <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">ยังไม่มีบัญชี LINE ที่เชื่อมกับลูกค้ารายนี้</div> : <div className="space-y-2">{detail.lineIdentities.map((identity) => { const verified = Boolean(identity.verifiedLinkAt); return <div key={identity.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${verified ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}><div><div className="font-bold text-gray-900">{identity.displayName ?? 'ลูกค้า LINE'}</div><div className="text-xs text-gray-600">{identity.maskedProviderUserId}</div></div><div className="text-right text-xs"><div className="font-bold text-gray-800">{lineIdentityStatusLabel(identity.status)}</div><div className={verified ? 'text-green-700' : 'text-amber-700'}>{verified ? `ยืนยันตัวตนแล้ว · ${identity.verifiedLinkVia ?? 'ระบบ'}` : 'ยังไม่ได้ยืนยันว่าเป็นเจ้าของบัญชีเดียวกัน'}</div></div></div>; })}</div>}</div>
          {detail.notes && <div className="rounded-xl border border-gray-100 p-4"><div className="text-xs font-semibold text-gray-500">บันทึกภายใน</div><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{detail.notes}</p></div>}
          {nextBooking && <div className="rounded-xl border border-green-200 bg-green-50 p-4"><div className="text-xs font-bold text-green-700">นัดหมายถัดไป</div><div className="mt-1 font-semibold text-gray-800">{nextBooking.serviceName} · {shortDateTime(nextBooking.startAt)}</div></div>}
          {(canEdit || canMerge || canArchive) && <div className="rounded-xl border border-gray-200 bg-gray-50 p-4"><div className="text-sm font-bold text-gray-800">จัดการข้อมูลลูกค้า</div><p className="mt-1 text-xs text-gray-500">แก้ข้อมูลทั่วไป ตรวจสอบรายการซ้ำ หรือเก็บลูกค้าที่เลิกใช้งาน</p><div className="mt-3 flex flex-wrap gap-2">{canEdit && <button type="button" className={secondaryButton} onClick={onEdit}>แก้ไขข้อมูล</button>}{canMerge && <button type="button" className={secondaryButton} onClick={onMerge}>ตรวจสอบข้อมูลซ้ำ</button>}{canArchive && <button type="button" className={dangerButton} onClick={onArchive}>เก็บเข้าคลัง</button>}</div></div>}
        </>}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-6 py-4"><Link className={conversationId ? secondaryButton : primaryButton} href={`/companies/${companyId}/crm/customers/${customer.id}`}>ดูประวัติลูกค้าทั้งหมด</Link>{conversationId && <Link className={primaryButton} href={`/companies/${companyId}/inbox?conversation=${conversationId}`}>เปิดแชท LINE</Link>}</footer>
    </DialogShell>
  );
}

export function CustomersPrototypePage({ companyId, permissions, roles }: { companyId: string; permissions: string[]; roles: string[] }) {
  const toast = useToast();
  const canRead = permissions.includes('crm.customer.read');
  const hasOperationalRole = roles.some((role) => ['OWNER', 'ADMIN', 'SALES', 'MANAGER', 'SYSTEM_ADMIN'].includes(role));
  const canCreate = hasOperationalRole && permissions.includes('crm.customer.create');
  const canUpdate = hasOperationalRole && permissions.includes('crm.customer.update');
  const canAssign = hasOperationalRole && permissions.includes('crm.customer.assign');
  const canAi = canCreate && permissions.includes('crm.ai.assist');
  const canMergeCustomers = permissions.includes('crm.customer.merge') && roles.some((role) => role === 'OWNER' || role === 'ADMIN');
  const canPiiSearch = roles.some((role) => ['OWNER', 'ADMIN', 'SALES', 'MANAGER', 'AUDITOR_READONLY', 'FINANCE', 'ACCOUNTANT', 'SYSTEM_ADMIN'].includes(role));
  const [customers, setCustomers] = useState<CrmProjectedCustomerSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestSequence = useRef(0);
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>('ACTIVE');
  const [tierFilter, setTierFilter] = useState<'all' | CrmCustomerTier>('all');
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<CustomerFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null);
  const [warnings, setWarnings] = useState<CrmDuplicateWarning[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<CrmCustomerDetail | null>(null);
  const [profileBookings, setProfileBookings] = useState<CrmBookingSummary[]>([]);
  const [profileConversationId, setProfileConversationId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) return;
    const requestId = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const result = await listCrmCustomers(companyId, { scope: 'all', status: customerStatusParam(statusFilter), tier: tierFilter === 'all' ? undefined : tierFilter, search: debouncedSearch || undefined, sortBy: 'updatedAt', page, pageSize: CUSTOMER_PAGE_SIZE });
      if (requestId !== requestSequence.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / CUSTOMER_PAGE_SIZE));
      setTotal(result.total);
      if (page > lastPage) { setPage(lastPage); return; }
      setCustomers(result.items);
    } catch (loadError) { if (requestId === requestSequence.current) setError(errorMessage(loadError, 'โหลดข้อมูลลูกค้าไม่สำเร็จ')); }
    finally { if (requestId === requestSequence.current) setLoading(false); }
  }, [canRead, companyId, debouncedSearch, page, statusFilter, tierFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!canRead) return; void listBranches(companyId).then(setBranches).catch(() => setBranches([])); }, [canRead, companyId]);
  useEffect(() => { if (!canAssign) return; void listEmployees(companyId).then(setEmployees).catch(() => setEmployees([])); }, [canAssign, companyId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(1); }, [statusFilter, tierFilter]);

  const directory = useMemo(() => buildDirectory(operationalCustomers(customers), branches), [branches, customers]);
  const accountingCustomers = useMemo(
    () => customers.flatMap((item) => item.projection === 'ACCOUNTING_CONTACT' ? [item.customer] : []),
    [customers],
  );
  const marketingCustomers = useMemo(
    () => customers.flatMap((item) => item.projection === 'MARKETING' ? [item.customer] : []),
    [customers],
  );
  const activeProfileDetail = profileDetail?.id === profileId ? profileDetail : null;
  const profileSummary = useMemo(() => {
    if (!profileId) return null;
    const fromList = directory.find((customer) => customer.id === profileId);
    if (fromList) return fromList;
    return activeProfileDetail ? buildDirectory([activeProfileDetail], branches)[0] ?? null : null;
  }, [activeProfileDetail, branches, directory, profileId]);
  const employeeNames = useMemo(() => new Map(employees.map((employee) => [employee.userId, employeeShortName(employee)])), [employees]);

  const loadProfile = useCallback(async (customerId: string) => {
    setProfileLoading(true); setProfileError(null);
    try {
      const [detail, bookings, conversations] = await Promise.all([
        getCrmCustomer(companyId, customerId),
        listCustomerBookings(companyId, customerId).catch(() => ({ items: [] })),
        listConversations(companyId, { customerId, pageSize: 1 }).catch(() => ({ items: [] })),
      ]);
      if (detail.projection !== 'OPERATIONAL') throw new Error('รายละเอียดเชิงปฏิบัติการไม่พร้อมสำหรับสิทธิ์นี้');
      setProfileDetail(detail.customer); setProfileBookings(bookings.items); setProfileConversationId(conversations.items[0]?.id ?? null);
    } catch (loadError) { setProfileError(errorMessage(loadError, 'โหลดรายละเอียดลูกค้าไม่สำเร็จ')); }
    finally { setProfileLoading(false); }
  }, [companyId]);

  useEffect(() => { if (!profileId) { setProfileDetail(null); setProfileBookings([]); setProfileConversationId(null); return; } void loadProfile(profileId); }, [loadProfile, profileId]);

  const openCreate = () => { setWarnings([]); setFormError(null); setFormState({ mode: 'create', aiAssisted: false, draft: { ...EMPTY_FORM } }); };
  const openEdit = () => {
    if (!activeProfileDetail) return;
    setFormError(null);
    setFormState({ mode: 'edit', customerId: activeProfileDetail.id, originalOwnerUserId: activeProfileDetail.ownerUserId, aiAssisted: false, draft: { displayName: activeProfileDetail.displayName, primaryPhone: activeProfileDetail.primaryPhone ?? '', tier: activeProfileDetail.tier, notes: activeProfileDetail.notes ?? '', originSource: activeProfileDetail.originSource, ownerUserId: activeProfileDetail.ownerUserId ?? '' } });
  };

  const saveCustomer = async (skipDuplicateCheck = false) => {
    if (!formState) return;
    setSaving(true); setFormError(null);
    try {
      if (!skipDuplicateCheck && (formState.mode === 'create' || canUpdate)) {
        const lookup = formState.draft.primaryPhone.trim() || formState.draft.displayName.trim();
        const candidates = await findActiveAndInactiveCustomers(companyId, lookup);
        const matches = findCustomerDuplicateMatches(candidates, formState.draft, formState.customerId);
        if (matches.length > 0) { setDuplicatePrompt({ matches, draft: formState.draft }); return; }
      }

      let savedId = formState.customerId;
      let nextWarnings: CrmDuplicateWarning[] = [];
      if (formState.mode === 'create') {
        const result = await createCrmCustomer(companyId, { displayName: formState.draft.displayName.trim(), primaryPhone: formState.draft.primaryPhone.trim() || undefined, tier: formState.draft.tier, notes: formState.draft.notes.trim() || undefined, originSource: formState.draft.originSource, createdByType: formState.aiAssisted ? 'AI_ASSISTED' : undefined, ownerUserId: formState.draft.ownerUserId || undefined, duplicateOverride: skipDuplicateCheck });
        savedId = result.customer.id; nextWarnings = result.duplicateWarnings;
      } else if (canUpdate && formState.customerId) {
        const result = await updateCrmCustomer(companyId, formState.customerId, { displayName: formState.draft.displayName.trim(), primaryPhone: formState.draft.primaryPhone.trim(), tier: formState.draft.tier, notes: formState.draft.notes.trim(), duplicateOverride: skipDuplicateCheck });
        nextWarnings = result.duplicateWarnings;
      }
      if (formState.mode === 'edit' && canAssign && formState.customerId && formState.draft.ownerUserId && formState.draft.ownerUserId !== formState.originalOwnerUserId) await assignCrmCustomer(companyId, formState.customerId, formState.draft.ownerUserId);
      setWarnings(nextWarnings); setFormState(null); setDuplicatePrompt(null); await load();
      if (savedId) { setProfileId(savedId); await loadProfile(savedId); }
      toast.success('บันทึกข้อมูลลูกค้าเรียบร้อยแล้ว');
    } catch (saveError) {
      const details = (saveError as { details?: { warnings?: CrmDuplicateWarning[] } }).details;
      if (details?.warnings?.length) {
        setWarnings(details.warnings);
        const candidateRows = await findActiveAndInactiveCustomers(companyId, formState.draft.primaryPhone || formState.draft.displayName).catch(() => []);
        const matches = findCustomerDuplicateMatches(candidateRows, formState.draft, formState.customerId);
        if (matches.length) setDuplicatePrompt({ matches, draft: formState.draft });
        else setFormError('พบข้อมูลลูกค้าที่อาจซ้ำ แต่บัญชีนี้เปิดรายการเดิมไม่ได้ กรุณาให้ผู้จัดการตรวจสอบ');
        return;
      }
      setFormError(errorMessage(saveError, 'บันทึกลูกค้าไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const archive = async (reason: string, override: boolean) => {
    if (!profileId) return;
    setSaving(true); setArchiveError(null);
    try { await archiveCrmCustomer(companyId, profileId, { reason, override }); toast.success('เก็บลูกค้าเข้าคลังเรียบร้อยแล้ว'); setArchiveOpen(false); setProfileId(null); await load(); }
    catch (archiveFailure) { setArchiveError(errorMessage(archiveFailure, 'เก็บลูกค้าเข้าคลังไม่สำเร็จ')); }
    finally { setSaving(false); }
  };

  if (!canRead) return <div className="mangmee-page"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"><h1 className="text-xl font-bold text-amber-900">ไม่มีสิทธิ์ดูข้อมูลลูกค้า</h1><p className="mt-2 text-sm text-amber-700">ต้องมีสิทธิ์ crm.customer.read</p></div></div>;

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-extrabold text-gray-900">จัดการลูกค้า</h1><p className="mt-2 text-base font-medium text-gray-500">Customer Directory หลักสำหรับข้อมูลจากพนักงาน, Walk-in, LINE และ AI-assisted intake</p></div><div className="flex items-center gap-2"><MangmeeBranchChip />{canCreate && <button type="button" className={primaryButton} onClick={openCreate}>+ เพิ่มลูกค้า</button>}</div></div>
      {warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>พบข้อมูลที่อาจซ้ำ:</strong> {warnings.map((warning) => `${warning.displayName} (${warning.matchType}, ${warning.status ? CUSTOMER_STATUS_META[warning.status].label : 'จำกัดสิทธิ์'})`).join(', ')}</div>}
      {error && <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><span>{error}</span><button type="button" className="underline" onClick={() => void load()}>ลองใหม่</button></div>}
      <div className="rounded-2xl border border-gray-200 bg-white p-4"><div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_auto]"><input className={inputClass} value={search} disabled={!canPiiSearch} onChange={(event) => setSearch(event.target.value)} placeholder={canPiiSearch ? 'ค้นหาชื่อหรือเบอร์โทร' : 'ปิดการค้นหา PII ตามสิทธิ์'} /><ThemedSelect className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CustomerStatusFilter)}>{CUSTOMER_STATUS_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</ThemedSelect><ThemedSelect className={inputClass} value={tierFilter} onChange={(event) => setTierFilter(event.target.value as 'all' | CrmCustomerTier)}><option value="all">ทุกระดับ</option>{TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ThemedSelect><div className="flex items-center justify-end whitespace-nowrap text-sm font-semibold text-gray-500">ทั้งหมด {total.toLocaleString('th-TH')} ราย</div></div></div>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-xs font-bold text-gray-500"><tr><th className="px-5 py-3">ลูกค้า</th><th className="px-5 py-3">ต้นทาง</th><th className="px-5 py-3">เบอร์โทร</th><th className="px-5 py-3">LINE</th><th className="px-5 py-3">ระดับ</th><th className="px-5 py-3">ยอดสะสม / ล่าสุด</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-gray-100">
        {loading && <tr><td colSpan={7} className="px-5 py-12 text-center font-semibold text-gray-400">กำลังโหลดข้อมูลลูกค้า…</td></tr>}
        {!loading && customers.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center"><div className="font-semibold text-gray-500">ไม่พบลูกค้า</div>{canCreate && !debouncedSearch && <button type="button" className={`${primaryButton} mt-3`} onClick={openCreate}>เพิ่มลูกค้าคนแรก</button>}</td></tr>}
        {!loading && directory.map((customer) => <tr key={customer.id} className="hover:bg-brand-25"><td className="px-5 py-3"><button type="button" className="flex items-center gap-3 text-left" onClick={() => setProfileId(customer.id)}><span className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-white" style={{ background: customer.color }}>{customer.initial}</span><span><strong className="block text-gray-900">{customer.name}</strong><span className="text-xs text-gray-400">{customer.branchName}</span></span></button></td><td className="px-5 py-3"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{sourceLabel(customer.raw.originSource)}</span>{customer.raw.createdByType === 'AI_ASSISTED' && <span className="ml-1 rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">AI assist</span>}</td><td className="px-5 py-3 text-gray-600">{customer.phone}</td><td className="px-5 py-3">{customer.raw.lineIdentityCount === 0 ? <span className="text-xs text-gray-400">ยังไม่เชื่อม</span> : <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${customer.raw.lineIdentityStatus === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{customer.raw.lineIdentityStatus === 'ACTIVE' ? 'เชื่อมแล้ว' : customer.raw.lineIdentityStatus === 'UNFOLLOWED' ? 'เลิกติดตาม' : 'บล็อก'}{customer.raw.hasVerifiedLineIdentity ? ' · ยืนยัน' : ''}</span>}</td><td className="px-5 py-3"><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">{TIER_OPTIONS.find((item) => item.value === customer.tier)?.label}</span></td><td className="px-5 py-3"><div className="font-bold text-brand-600">฿{customer.ltv}</div><div className="text-xs text-gray-500">{customer.lastVisit}</div></td><td className="px-5 py-3 text-right"><button type="button" className={secondaryButton} onClick={() => setProfileId(customer.id)}>จัดการ</button></td></tr>)}
        {!loading && accountingCustomers.map((customer) => <AccountingCustomerRow key={`accounting:${customer.id}`} customer={customer} />)}
        {!loading && marketingCustomers.map((customer) => <MarketingCustomerRow key={`marketing:${customer.customerRef}`} customer={customer} />)}
      </tbody></table></div>
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm text-gray-500"><span>หน้า {page} จาก {Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE))}</span><div className="flex gap-2"><button type="button" className={secondaryButton} disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>ก่อนหน้า</button><button type="button" className={secondaryButton} disabled={page * CUSTOMER_PAGE_SIZE >= total || loading} onClick={() => setPage((current) => current + 1)}>ถัดไป</button></div></div></div>

      {profileSummary && <CustomerProfileModal companyId={companyId} summary={profileSummary} detail={activeProfileDetail} bookings={profileBookings} conversationId={profileConversationId} loading={profileLoading} error={profileError} ownerName={activeProfileDetail?.ownerUserId ? employeeNames.get(activeProfileDetail.ownerUserId) : undefined} permissions={permissions} canAssignAvailable={canAssign && employees.length > 0} canMergeCustomers={canMergeCustomers} onClose={() => setProfileId(null)} onRetry={() => void loadProfile(profileSummary.id)} onEdit={openEdit} onArchive={() => { setArchiveError(null); setArchiveOpen(true); }} onMerge={() => setMergeOpen(true)} />}
      {formState && <CustomerFormDialog companyId={companyId} state={formState} setState={setFormState} employees={employees} canUpdate={canUpdate} canAssign={canAssign && employees.length > 0} canAi={canAi} saving={saving} error={formError} onClose={() => setFormState(null)} onSubmit={() => void saveCustomer()} />}
      {duplicatePrompt && <DuplicateDialog prompt={duplicatePrompt} saving={saving} onUseExisting={(id) => { setDuplicatePrompt(null); setFormState(null); setProfileId(id); }} onContinue={() => void saveCustomer(true)} onClose={() => setDuplicatePrompt(null)} />}
      {archiveOpen && activeProfileDetail && <ArchiveDialog customer={activeProfileDetail} saving={saving} error={archiveError} onClose={() => setArchiveOpen(false)} onConfirm={(reason, override) => void archive(reason, override)} />}
      {mergeOpen && activeProfileDetail && <MergeDialog companyId={companyId} primary={activeProfileDetail} onClose={() => setMergeOpen(false)} onDone={() => { setMergeOpen(false); void load(); void loadProfile(activeProfileDetail.id); }} />}
    </div>
  );
}
