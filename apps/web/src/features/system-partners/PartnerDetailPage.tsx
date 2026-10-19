'use client';

import {
  DEFAULT_CHAT_CREDIT_SATANG,
  FEATURE_CATALOG,
  MENU_ENTITLEMENT_BINDINGS,
  PARTNER_LINE_MESSAGE_MAX_LENGTH,
  PLAN_TIER_PRESETS,
  partnerAdjustmentReason,
  planTermState,
  planTermStateLabel,
  SALES_DEAL_REASON_MAX,
  signupDiscoveryLabel,
  companyBusinessTypeLabel,
  type CompanyPlanTermDto,
  type CompanyPlanTermViewDto,
  type SetCompanyPlanTermBody,
  type RenewCompanyPlanTermBody,
  type MenuEntitlementBinding,
  type PartnerFeatureEntitlementDto,
  type PlanTierKey,
  type PartnerIdentityControlDto,
  type PatchPartnerIdentityDto,
} from '@watchdog-bms/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ThaiAddressFields } from '@/common/components/field/ThaiAddressFields';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { getMangmeeMenuTone, mangmeeToneClass } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal/Modal';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';
import { useEffect, useRef, useState } from 'react';
import { WORKSPACE_ICON_NODES } from '@/features/web-core-workspace/design-icons';
import { QrLinkCard } from '@/features/employee-access/EmployeeAccessPages';
import { setCompanyReferral } from '@/features/sales-console/sales.api';
import {
  companyReferral, normalizeSalesCodeInput, referralLabel, referralWindowOpen, salesCodeError,
  type CompanyReferralView,
} from '@/features/sales-console/sales-console.logic';
import PartnerReportLabels from './PartnerReportLabels';
import PartnerTeamNote from './PartnerTeamNote';
import PartnerAiAdjustmentHistory from './PartnerAiAdjustmentHistory';
import PartnerPlanAdjustmentHistory from './PartnerPlanAdjustmentHistory';
import {
  getPartnerDetail,
  updatePartnerProfile,
  partnerLifecycleTransition,
  setPartnerFeatures,
  setPartnerAiModel,
  setPartnerOcrConfig,
  setPartnerManualExpenseWebEntry,
  setPartnerDisbursementVoucherWebEntry,
  setPartnerVatRegistration,
  getPartnerAiUsage,
  getPartnerMembers,
  getPartnerPlanTerm,
  setPartnerPlanTerm,
  renewPartnerPlanTerm,
  unlinkPartnerMemberLine,
  issuePartnerMemberLineLinkToken,
  resetPartnerMemberPassword,
  setPartnerMemberContact,
  setPartnerOwnerName,
  revealPartnerMemberTempPassword,
  endPartnerPlanTermWarmup,
  getPartnerTimeline,
  sendPartnerLineMessage,
  getPartnerAiCreditHolds,
  actOnPartnerAiCreditHold,
  getPartnerIdentityControl,
  patchPartnerIdentity,
} from './system-partners.api';
import type {
  PartnerCompanyDetailDto,
  LineContextHealth,
  PartnerAiUsageDto,
  PartnerAiUsageMeasuresDto,
  PartnerAiCreditHoldDto,
  PartnerAiCreditHoldsDto,
  PartnerMemberDto,
  EmployeeLineLinkPackage,
  PartnerTimelineEntryDto,
} from './system-partners.api';
import {
  AI_BUDGET_BUCKET_LABELS,
  AI_BUDGET_MODE_LABELS,
  AI_BUDGET_RESERVED_NOTE,
  AI_BUDGET_STALE_MESSAGE,
  AI_CREDIT_HOLD_ACTION_LABELS,
  AI_CREDIT_HOLD_EMPTY_NOTE,
  AI_CREDIT_HOLD_HELP_NOTE,
  AI_REQUEST_KIND_LABELS,
  AI_USAGE_BASIS_LABELS,
  aiAverageCostLabel,
  aiBudgetAvailableLabel,
  aiBudgetCapLabel,
  aiBudgetCurrentMonthKey,
  aiBudgetDraftChanged,
  aiBudgetDraftFromPolicy,
  aiBudgetInvalidNotice,
  aiBudgetMonthOptions,
  aiBudgetPendingText,
  aiBudgetScopeRows,
  aiCacheCostLabel,
  aiCoverageNotice,
  aiCreditHoldAgeLabel,
  aiCreditHoldConsequence,
  aiCreditHoldKindLabel,
  aiCreditHoldStepLabel,
  isAiCreditHoldConflict,
  type AiCreditHoldAction,
  aiUsageBasisNote,
  aiChatCreditSourceText,
  aiTabStatusRows,
  canManageAiBudget,
  chatCreditConfirmMessage,
  chatCreditDraftChanged,
  chatCreditInputFromUsage,
  chatCreditPolicyRequest,
  hasAiBudgetPolicy,
  parseChatCreditInput,
  receiptImagesSourceText,
  receiptImageTiles,
  receiptQuotaControlVisible,
  reloadAfterAiBudgetConflict,
  safetyCeilingConfirmMessage,
  validateAiBudgetDraft,
  type AiBudgetDraft,
  type AiBudgetPolicyRequest,
  type AiTabStatusTone,
  budgetBarClass,
  budgetBarWidth,
  budgetPercent,
  budgetTextClass,
  hasAiUsageBreakdown,
  OCR_CONFIG_STALE_MESSAGE,
  parseBudgetBahtInput,
  parseOcrMonthlyLimitInput,
  ocrUnsavedToggleMessage,
  ocrUsageTrackingNote,
  satangToBaht,
  satangToBahtInput,
} from './ai-budget.logic';
import {
  parseDaysInput,
  parseLimitInput,
  planTermLimitsText,
  planTermStatusChip,
  renewedEndsAt,
  type PlanTermChip,
  type PlanTermChipTone,
} from './plan-term.logic';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import {
  PARTNER_FEATURE_PRESETS,
  type PartnerFeaturePresetKey,
  type MenuFeatureControl,
  applyPreset,
  buildMenuCards,
  cascadeOffItems,
  changedEntitlements,
  commandFailureMessage,
  dependencyBlockMessage,
  disableBlockForChange,
  diffEntitlements,
  entitlementEnabled,
  featurePackageEditingNotice,
  filterMenuCards,
  isAmbiguousCommandFailure,
  isNormalizationPending,
  presetTurningOffItems,
  previewNavGroups,
  savedFeaturePresetStatus,
  toggleMenuCard,
  toggleMenuGroup,
  toggleSubmenu,
  manualWebEntryRow,
  MANUAL_WEB_ENTRY_COPY,
  MANUAL_WEB_ENTRY_SUBMENU_KEY,
  disbursementVoucherWebEntryRow,
  disbursementVoucherRoleNotice,
  updateWebEntrySettings,
  DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY,
  type WebEntrySettings,
  NORMALIZATION_PENDING_NOTICE,
  type Entitlement,
} from './system-partners.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';

// -- types

type PartnerStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED';

// -- approved AI models (source: APPROVED_AI_MODEL_IDS config default)
const APPROVED_AI_MODELS = [
  'global.anthropic.claude-sonnet-4-6',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  'apac.anthropic.claude-3-haiku-20240307-v1:0',
];

// -- helpers

function formatDate(iso?: string): string {
  return formatThaiDateTime(iso);
}

// -- status badge

const STATUS_CLASS: Record<PartnerStatus, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  DISABLED: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  ARCHIVED: 'bg-gray-100 text-gray-500 border-gray-200',
  SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_LABEL: Record<PartnerStatus,string> = { ACTIVE:'ใช้งานอยู่', DISABLED:'ปิดใช้งาน', ARCHIVED:'เก็บถาวร', SUSPENDED:'ระงับชั่วคราว' };
// Purchase without setup PR E (R-E3): the identity form's "ลักษณะการแก้ไข" and CORRECTION "สาเหตุ".
const CHANGE_KIND_LABEL: Record<string,string> = {
  INITIAL_CAPTURE: 'กรอกครั้งแรก (ยังอยู่ในช่วงตั้งค่า)',
  CORRECTION: 'แก้คำผิด/รูปแบบ (ข้อมูลเดิมถูกต้องตามกฎหมายอยู่แล้ว)',
  LEGAL_CHANGE: 'เปลี่ยนตามเอกสารทางการ (มีวันที่มีผล)',
};
const CORRECTION_REASON_LABEL: Record<string,string> = { TYPO: 'พิมพ์ผิด', FORMATTING: 'รูปแบบ/การเว้นวรรค', TRANSLITERATION: 'การสะกดชื่อ' };

function StatusBadge({ status }: { status: PartnerStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[status] ?? STATUS_CLASS.ARCHIVED}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const LINE_CTX_CLASS: Record<LineContextHealth, string> = {
  LINKED: 'bg-green-50 text-green-700 border-green-200',
  UNLINKED: 'bg-gray-100 text-gray-500 border-gray-200',
  NEEDS_COMPANY_SELECTION: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  UNKNOWN: 'bg-gray-100 text-gray-400 border-gray-100',
};

const LINE_CTX_LABEL: Record<LineContextHealth, string> = {
  LINKED: 'เชื่อมแล้ว',
  UNLINKED: 'ยังไม่เชื่อม',
  NEEDS_COMPANY_SELECTION: 'รอเลือกบริษัท',
  UNKNOWN: 'ยังไม่ทราบ',
};

function LineContextBadge({ health }: { health: LineContextHealth }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${LINE_CTX_CLASS[health] ?? LINE_CTX_CLASS.UNKNOWN}`}>
      {LINE_CTX_LABEL[health] ?? health}
    </span>
  );
}

// -- section card

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  );
}

// The only editable part of company identity here. Everything else on this card is a mirror of
// what the company itself owns; VAT registration is editable because nothing else in the product
// can answer it yet for a company created before the question existed on the registration form.
function VatRegistrationField({ companyId, value, disabled, showToast, onSaved }: {
  companyId: string;
  value: PartnerCompanyDetailDto['vatRegistration'];
  disabled: boolean;
  showToast: (message: string, tone: 'success' | 'error') => void;
  onSaved: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<'' | 'REGISTERED' | 'NOT_REGISTERED'>(
    value.status === 'UNKNOWN' ? '' : value.status,
  );
  const [effectiveFrom, setEffectiveFrom] = useState(value.effectiveFrom ?? todayCivilDate());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await setPartnerVatRegistration(companyId, { status, effectiveFrom, expectedVersion: value.version });
      showToast('บันทึกสถานะจด VAT ของร้านแล้ว', 'success');
      await onSaved();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-base text-gray-600 mb-2">สถานะจด VAT ของร้าน — เลือกตามข้อมูลจริงของร้าน เว้นไว้ได้หากยังไม่มีข้อมูล</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`partner-vat-status-${companyId}`} className="block text-base text-gray-600 mb-1">สถานะจด VAT</label>
          <ThemedSelect id={`partner-vat-status-${companyId}`} className={inputClass} value={status} disabled={disabled || busy}
            onChange={(e) => setStatus(e.target.value as '' | 'REGISTERED' | 'NOT_REGISTERED')}>
            <option value="">ยังไม่ระบุ</option>
            <option value="REGISTERED">จด VAT แล้ว</option>
            <option value="NOT_REGISTERED">ยังไม่ได้จด VAT</option>
          </ThemedSelect>
        </div>
        <div>
          <label htmlFor={`partner-vat-from-${companyId}`} className="block text-base text-gray-600 mb-1">วันที่เริ่มมีผล</label>
          <ThemedDate id={`partner-vat-from-${companyId}`} className={inputClass} value={effectiveFrom} disabled={disabled || busy}
            onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        <button type="button" className={btnPrimary} disabled={disabled || busy || !status} aria-busy={Boolean(busy)} onClick={() => void save()}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกสถานะ VAT'}
        </button>
      </div>
    </div>
  );
}

/**
 * D6 (spec §17.1): who this shop is credited to, and the SYSTEM_ADMIN repair for it. The credit
 * decides a เซลล์'s numbers, so it is never editable forever — the API refuses a change more than
 * `SALES_REFERRAL_ADMIN_WINDOW_DAYS` after the shop was created, and this stops offering the edit
 * at the same moment rather than letting an admin type a reason into a refusal.
 *
 * Clearing is a first-class action: an empty code with a reason sends `salesCode: null`, which is
 * how a credit given to the wrong person is taken back rather than moved.
 */
function CompanyReferralField({ companyId, createdAt, referral, disabled, showToast, onSaved }: {
  companyId: string;
  createdAt: string;
  referral: CompanyReferralView | null;
  disabled: boolean;
  showToast: (message: string, tone: 'success' | 'error') => void;
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(referral?.salesCode ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const windowOpen = referralWindowOpen(createdAt);
  const trimmedCode = normalizeSalesCodeInput(code);
  const codeError = trimmedCode ? salesCodeError(trimmedCode) : null;

  const save = async () => {
    if (!reason.trim() || codeError) return;
    setBusy(true);
    try {
      await setCompanyReferral(companyId, { salesCode: trimmedCode || null, reason: reason.trim() });
      showToast(trimmedCode ? 'บันทึกผู้แนะนำของร้านแล้ว' : 'ล้างผู้แนะนำของร้านแล้ว', 'success');
      setEditing(false);
      setReason('');
      await onSaved();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">แนะนำโดยเซลล์</p>
      <p className="break-words text-base text-gray-800">{referralLabel(referral)}</p>
      {!editing ? (
        <button type="button" className="mt-1 min-h-11 text-base font-medium text-brand-800 underline underline-offset-4 disabled:no-underline disabled:opacity-50"
          disabled={disabled || !windowOpen} onClick={() => { setCode(referral?.salesCode ?? ''); setReason(''); setEditing(true); }}>
          แก้ไขผู้แนะนำ
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <div>
            <label htmlFor={`partner-referral-code-${companyId}`} className="block text-base text-gray-600 mb-1">รหัสเซลล์ (เว้นว่าง = ไม่มีผู้แนะนำ)</label>
            <input id={`partner-referral-code-${companyId}`} className={inputClass} value={code} disabled={busy}
              autoComplete="off" onChange={(e) => setCode(normalizeSalesCodeInput(e.target.value))} />
            {codeError && <p role="alert" className="mt-1 text-sm text-error-700">{codeError}</p>}
          </div>
          <div>
            <label htmlFor={`partner-referral-reason-${companyId}`} className="block text-base text-gray-600 mb-1">เหตุผล (จำเป็น)</label>
            <input id={`partner-referral-reason-${companyId}`} className={inputClass} value={reason} disabled={busy}
              maxLength={SALES_DEAL_REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(false)}>ยกเลิก</button>
            <button type="button" className={btnPrimary} disabled={busy || !reason.trim() || Boolean(codeError)} aria-busy={Boolean(busy)} onClick={() => void save()}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกผู้แนะนำ'}
            </button>
          </div>
        </div>
      )}
      {!windowOpen && <p className="mt-1 text-sm text-gray-500">{apiErrorMessage({ code: 'SALES_REFERRAL_WINDOW_CLOSED' })}</p>}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="break-words text-base text-gray-800">{value || '—'}</p>
    </div>
  );
}

const inputClass = 'mangmee-input min-h-11 !text-base';
const btnPrimary = 'mangmee-btn mangmee-btn-primary min-h-11 !text-base disabled:opacity-50';
const btnSecondary = 'min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const btnDanger = 'rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';

// -- lifecycle confirm modal

type LifecycleAction = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';

const LIFECYCLE_CONSEQUENCE: Record<LifecycleAction, string> = {
  ACTIVE: 'เปิดให้สมาชิกของบริษัทเข้าสู่ระบบและใช้งานได้อีกครั้ง',
  DISABLED: 'สมาชิกของบริษัทจะเข้าใช้งานไม่ได้ จนกว่าจะเปิดใช้งานอีกครั้ง',
  ARCHIVED: 'สมาชิกทุกคนจะเข้าใช้งานไม่ได้ และข้อมูลบริษัทจะอ่านได้อย่างเดียว ข้อมูลยังเก็บอยู่ ผู้ดูแลเปิดใช้งานบริษัทอีกครั้งได้',
};

function LifecycleConfirmModal({
  action,
  loading,
  onConfirm,
  onCancel,
}: {
  action: LifecycleAction;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            ยืนยันเปลี่ยนสถานะเป็น {STATUS_LABEL[action]}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-700">{LIFECYCLE_CONSEQUENCE[action]}</p>
          {action === 'ARCHIVED' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              เมื่อเก็บถาวร สมาชิกทุกคนจะใช้งานไม่ได้ และแก้ไขข้อมูลบริษัทไม่ได้
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">เหตุผล (ถ้ามี)</label>
            <input
              className={inputClass}
              type="text"
              placeholder="เช่น ยุติการใช้บริการ"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={loading}>
            ยกเลิก
          </button>
          <button
            type="button"
            className={action === 'ARCHIVED' ? btnDanger : btnPrimary}
            disabled={loading} aria-busy={Boolean(loading)}
            onClick={() => onConfirm(reason)}
          >
            {loading ? 'กำลังบันทึก…' : 'ยืนยันเปลี่ยนสถานะ'}
          </button>
        </div>
      </div>
    </div>
  );
}


// -- members section (credentials + LINE link administration)

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="4" y1="4" x2="20" y2="20" />}
    </svg>
  );
}

function MembersSection({
  companyId,
  canManageMembers,
  showToast,
}: {
  companyId: string;
  canManageMembers: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
}) {
  const [members, setMembers] = useState<PartnerMemberDto[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  // userId -> revealed plaintext; absent = masked. Kept client-side only.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // Shown once, below the table. Never persisted: the link is a bearer credential.
  const [issuedQr, setIssuedQr] = useState<{ displayName: string; lineLink: EmployeeLineLinkPackage } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const loadMembers = async () => {
    try {
      setMembers((await getPartnerMembers(companyId)).items);
      setMembersError(null);
    } catch (err) {
      const e = err as Error & { status?: number };
      setMembersError(e.status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ดูสมาชิก' : apiErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadMembers();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [contactEditing, setContactEditing] = useState<{ userId: string; email: string; phoneNumber: string } | null>(null);
  const [nameEditing, setNameEditing] = useState<{ userId: string; displayName: string; expectedDisplayName: string } | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const saveOwnerName = async () => {
    if (!nameEditing || nameSaving) return;
    setNameSaving(true);
    setNameError(null);
    try {
      const saved = await setPartnerOwnerName(companyId, nameEditing.userId, {
        displayName: nameEditing.displayName.trim(), expectedDisplayName: nameEditing.expectedDisplayName,
      });
      setMembers(current => current?.map(member => member.userId === nameEditing.userId
        ? { ...member, displayName: saved.displayName } : member) ?? null);
      setNameEditing(null);
      showToast('บันทึกชื่อแล้ว ให้เจ้าของร้านรีเฟรชหน้าเพื่อเห็นชื่อใหม่', 'success');
    } catch (err) {
      setNameError(apiErrorMessage(err));
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveContact = async () => {
    if (!contactEditing) return;
    setBusyUserId(contactEditing.userId);
    try {
      await setPartnerMemberContact(companyId, contactEditing.userId, {
        email: contactEditing.email.trim(),
        phoneNumber: contactEditing.phoneNumber.trim(),
      });
      showToast('บันทึกข้อมูลติดต่อแล้ว', 'success');
      setContactEditing(null);
      await loadMembers();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleReveal = async (member: PartnerMemberDto) => {
    if (revealed[member.userId] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[member.userId];
        return next;
      });
      return;
    }
    setBusyUserId(member.userId);
    try {
      const result = await revealPartnerMemberTempPassword(companyId, member.userId);
      setRevealed((prev) => ({ ...prev, [member.userId]: result.temporaryPassword }));
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (member: PartnerMemberDto) => {
    const confirmed = await confirm({
      title: 'ออกรหัสผ่านชั่วคราวใหม่',
      message: `ออกรหัสผ่านชั่วคราวใหม่ให้ "${member.displayName}" รหัสผ่านเดิมจะใช้งานไม่ได้ทันที ยืนยันหรือไม่`,
      confirmLabel: 'ออกรหัสผ่านชั่วคราวใหม่',
      cancelLabel: 'ยกเลิก',
    });
    if (!confirmed) return;
    setBusyUserId(member.userId);
    try {
      const result = await resetPartnerMemberPassword(companyId, member.userId);
      setRevealed((prev) => ({ ...prev, [member.userId]: result.temporaryPassword }));
      showToast('ออกรหัสผ่านชั่วคราวใหม่แล้ว', 'success');
      await loadMembers();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleIssueLineQr = async (member: PartnerMemberDto) => {
    if (member.lineLinked && !(await confirm({
      title: 'สร้าง QR ผูก LINE',
      message: `"${member.displayName}" ผูก LINE แล้ว QR ใหม่ใช้เปลี่ยนบัญชี LINE ที่ผูกอยู่ โดยบัญชีเดิมจะใช้ไม่ได้ ต้องการทำต่อหรือไม่`,
      confirmLabel: 'สร้าง QR',
      cancelLabel: 'ยกเลิก',
    }))) return;
    setBusyUserId(member.userId);
    try {
      const result = await issuePartnerMemberLineLinkToken(companyId, member.userId);
      setIssuedQr({ displayName: member.displayName, lineLink: result.lineLink });
      showToast('สร้าง QR ผูก LINE แล้ว', 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUnlinkLine = async (member: PartnerMemberDto) => {
    const confirmed = await confirm({
      title: 'ยกเลิกการผูก LINE',
      message: `ยกเลิกการผูก LINE ของ "${member.displayName}" หากต้องการผูกอีกครั้ง จะต้องสแกน QR ใหม่`,
      confirmLabel: 'ยกเลิกการผูก LINE',
      cancelLabel: 'ยกเลิก',
    });
    if (!confirmed) return;
    setBusyUserId(member.userId);
    try {
      await unlinkPartnerMemberLine(companyId, member.userId);
      showToast('ยกเลิกการผูก LINE แล้ว', 'success');
      await loadMembers();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <SectionCard title="สมาชิกบริษัท">
      {membersError ? (
        <p className="text-sm text-red-600">{membersError}</p>
      ) : !members ? (
        <div className="h-16 rounded border border-gray-100 animate-pulse" />
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีสมาชิก</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">สมาชิก</th>
                <th className="py-2 pr-4 font-medium">บทบาท</th>
                <th className="py-2 pr-4 font-medium">LINE</th>
                <th className="py-2 pr-4 font-medium">รหัสผ่าน</th>
                <th className="py-2 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const busy = busyUserId === m.userId;
                const shown = revealed[m.userId];
                const canReveal = shown !== undefined || m.credential?.hasTempPassword === true;
                return (
                  <tr key={m.userId} className="border-b border-gray-100 align-top">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-gray-900">{m.displayName}</div>
                      {m.username && <div className="text-xs font-mono text-gray-500">{m.username}</div>}
                      {contactEditing?.userId === m.userId ? (
                        <div className="mt-1.5 space-y-1.5">
                          <input
                            value={contactEditing.email}
                            onChange={(e) => setContactEditing((p) => (p ? { ...p, email: e.target.value } : p))}
                            aria-label="อีเมลสมาชิก" placeholder="อีเมล"
                            className="block w-48 rounded border border-gray-300 px-2 py-1 text-xs"
                          />
                          <input
                            value={contactEditing.phoneNumber}
                            onChange={(e) => setContactEditing((p) => (p ? { ...p, phoneNumber: e.target.value } : p))}
                            aria-label="เบอร์โทรสมาชิก" placeholder="เบอร์โทรศัพท์"
                            className="block w-48 rounded border border-gray-300 px-2 py-1 text-xs"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              disabled={busy} aria-busy={Boolean(busy)}
                              onClick={() => void handleSaveContact()}
                              className="min-h-11 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              บันทึก
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setContactEditing(null)}
                              className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.email && <div className="text-xs text-gray-500">{m.email}</div>}
                          {m.phoneNumber && <div className="text-xs text-gray-500">{m.phoneNumber}</div>}
                        </>
                      )}
                      {m.membershipStatus !== 'ACTIVE' && (
                        <span className="text-xs text-yellow-600">{m.membershipStatus}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r) => (
                          <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      {m.lineLinked ? (
                        <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">เชื่อมแล้ว</span>
                      ) : (
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">ยังไม่เชื่อม</span>
                      )}
                      {m.lineLinked && m.lineMessagingReady === false && (
                        <p className="mt-1 max-w-52 text-xs text-amber-800">ตรวจช่องทาง LINE ของระบบ แล้วออก QR ใหม่เพื่อซ่อมการเชื่อมต่อ</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-gray-700">
                          {shown !== undefined ? shown : canReveal ? '••••••••' : '—'}
                        </span>
                        <button
                          type="button"
                          disabled={!canReveal || busy} aria-busy={Boolean(busy)}
                          onClick={() => void toggleReveal(m)}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title={
                            shown !== undefined
                              ? 'ซ่อนรหัสผ่าน'
                              : canReveal
                                ? 'ดูรหัสผ่านชั่วคราว (บันทึกประวัติการดู)'
                                : 'ผู้ใช้เปลี่ยนรหัสผ่านแล้ว จึงแสดงรหัสเดิมไม่ได้'
                          }
                        >
                          <EyeIcon off={shown !== undefined} />
                        </button>
                      </div>
                      {m.credential?.status === 'TEMPORARY' && m.credential.expiresAt && (
                        <p className="mt-0.5 text-xs text-gray-400">หมดอายุ {formatDate(m.credential.expiresAt)}</p>
                      )}
                    </td>
                    <td className="py-2.5">
                      <details><summary className="min-h-11 cursor-pointer py-2 font-medium text-brand-800">จัดการสมาชิก</summary><div className="flex min-w-48 flex-col items-start gap-2 py-2">
                        {canManageMembers && m.roles.includes('OWNER') && (
                          <button type="button" className={btnSecondary} onClick={() => {
                            setNameError(null);
                            setNameEditing({ userId: m.userId, displayName: m.displayName, expectedDisplayName: m.displayName });
                          }}>
                            แก้ไขชื่อที่แสดง
                          </button>
                        )}
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            setContactEditing({ userId: m.userId, email: m.email ?? '', phoneNumber: m.phoneNumber ?? '' })
                          }
                        >
                          แก้ไขข้อมูลติดต่อ
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy || !m.credential} aria-busy={Boolean(busy)}
                          onClick={() => void handleResetPassword(m)}
                        >
                          ออกรหัสผ่านชั่วคราวใหม่
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy} aria-busy={Boolean(busy)}
                          onClick={() => void handleIssueLineQr(m)}
                        >
                          สร้าง QR ผูก LINE
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                          disabled={busy || !m.lineLinked} aria-busy={Boolean(busy)}
                          onClick={() => void handleUnlinkLine(m)}
                        >
                          ยกเลิกการผูก LINE
                        </button>
                      </div></details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={nameEditing !== null} onClose={() => { if (!nameSaving) setNameEditing(null); }} title="แก้ไขชื่อที่แสดง">
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveOwnerName(); }}>
          <p className="break-words text-sm text-gray-600">ชื่อปัจจุบัน: {nameEditing?.expectedDisplayName}</p>
          <label className="block space-y-1 text-sm font-medium text-gray-700">
            <span>ชื่อที่แสดง</span>
            <input className={inputClass} value={nameEditing?.displayName ?? ''} required maxLength={160} disabled={nameSaving}
              aria-describedby="owner-name-hint" onChange={event => setNameEditing(current => current ? { ...current, displayName: event.target.value } : null)} />
          </label>
          <p id="owner-name-hint" className="text-sm text-gray-600">ชื่อนี้ใช้ทุกบริษัทที่บัญชีนี้เข้าใช้ ไม่เปลี่ยนชื่อร้านหรือชื่อในทะเบียนพนักงาน</p>
          {nameError && <p role="alert" className="text-sm text-red-600">{nameError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} disabled={nameSaving} onClick={() => setNameEditing(null)}>ยกเลิก</button>
            <button type="submit" className={btnPrimary} aria-busy={nameSaving} disabled={nameSaving || !nameEditing?.displayName.trim() || nameEditing.displayName.trim() === nameEditing.expectedDisplayName}>
              {nameSaving ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
            </button>
          </div>
        </form>
      </Modal>
      {issuedQr && (
        <div className="mt-4 space-y-2 rounded border border-green-200 bg-green-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-green-900">
              QR ผูก LINE ของ {issuedQr.displayName} · ส่งให้สมาชิกคนนี้เท่านั้น
            </p>
            <button
              type="button"
              className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
              onClick={() => setIssuedQr(null)}
            >
              ซ่อน QR
            </button>
          </div>
          <p className="text-xs text-gray-600">
            ใช้ได้ครั้งเดียวภายใน 72 ชั่วโมง เฉพาะสมาชิกคนนี้ และไม่เปลี่ยนรหัสผ่าน
            สมาชิกเปิดลิงก์ใน LINE เพื่อผูกบัญชีได้โดยไม่ต้องเข้าสู่ระบบ
          </p>
          <QrLinkCard
            linkUrl={issuedQr.lineLink.linkUrl}
            qrImageUrl={issuedQr.lineLink.qrImageUrl}
            expiresAt={issuedQr.lineLink.expiresAt}
          />
        </div>
      )}
      {confirmDialog}
    </SectionCard>
  );
}

// -- package menu mirror

function PackageMenuSection({
  companyId,
  companyName,
  entitlements,
  setVersion,
  manualExpenseWebEntry,
  disbursementVoucherWebEntry,
  disbursementVoucherRoles = [],
  companyStatus,
  fieldsLocked,
  normalizationPending,
  showToast,
  onSaved,
}: {
  companyId: string;
  companyName: string;
  entitlements: PartnerFeatureEntitlementDto[];
  setVersion: number;
  /** The stored screen setting and its own version; absent only when an older API answered. */
  manualExpenseWebEntry?: PartnerCompanyDetailDto['manualExpenseWebEntry'];
  disbursementVoucherWebEntry?: PartnerCompanyDetailDto['disbursementVoucherWebEntry'];
  disbursementVoucherRoles?: PartnerCompanyDetailDto['disbursementVoucherRoles'];
  companyStatus: PartnerStatus;
  fieldsLocked: boolean;
  normalizationPending: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
  onSaved: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Entitlement[]>(
    entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })),
  );
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('main');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [showDisabledPreview, setShowDisabledPreview] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const commandId = useRef<string | null>(null);
  // "แสดงเมนูบันทึกด้วยมือบนเว็บ": a screen setting, not an entitlement. Its value, version and saving
  // state live apart from `pending`, and it is saved by its own command the moment it is pressed.
  const [webEntries, setWebEntries] = useState<WebEntrySettings>({ manualExpenseWebEntry, disbursementVoucherWebEntry });
  const webEntry = webEntries.manualExpenseWebEntry;
  const disbursementEntry = webEntries.disbursementVoucherWebEntry;
  const setWebEntry = (saved: PartnerCompanyDetailDto['manualExpenseWebEntry']) => {
    setWebEntries((current) => updateWebEntrySettings(current, 'manualExpenseWebEntry', saved));
  };
  const setDisbursementEntry = (saved: PartnerCompanyDetailDto['disbursementVoucherWebEntry']) => {
    setWebEntries((current) => updateWebEntrySettings(current, 'disbursementVoucherWebEntry', saved));
  };
  const [webEntrySaving, setWebEntrySaving] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    setPending(entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })));
    setReviewOpen(false);
    commandId.current = null;
  }, [entitlements]);

  useEffect(() => {
    setWebEntries({ manualExpenseWebEntry, disbursementVoucherWebEntry });
  }, [manualExpenseWebEntry?.enabled, manualExpenseWebEntry?.version, disbursementVoucherWebEntry?.enabled, disbursementVoucherWebEntry?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, pending);
  const savedPresetStatus = savedFeaturePresetStatus(entitlements);
  const pendingPresetStatus = savedFeaturePresetStatus(pending);
  const descriptionPresetKey = pendingPresetStatus.activePresetKey ?? savedPresetStatus.activePresetKey;
  const filteredCards = filterMenuCards(cards, search);
  const navGroups = previewNavGroups(cards);
  const diff = diffEntitlements(entitlements, pending);
  const cascadeItems = cascadeOffItems(pending);
  const turningOffItems = [
    ...diff.turningOff,
    ...cascadeItems.filter((item) => !diff.turningOff.some(({ featureKey }) => featureKey === item.featureKey)),
  ];
  const changes = changedEntitlements(entitlements, pending);
  const visibleChangeCount = turningOffItems.length + diff.turningOn.length;
  // A normalization-pending company has every entitlement command refused server-side, so the
  // toggles are read-only rather than offering a save that cannot succeed (F1.5.1 item 1).
  const commandContractPending = !Number.isInteger(setVersion) || setVersion < 0;
  const controlsLocked = fieldsLocked || saving || normalizationPending || commandContractPending;
  const enabledCardCount = cards.filter((card) => card.enabled).length;
  const aiEnabled = entitlementEnabled(pending, 'ai_line_assistant');
  const aiDisableBlock = aiEnabled
    ? disableBlockForChange(entitlements, toggleSubmenu(pending, 'ai_line_assistant', false), entitlements)
    : null;
  const autoPostEnabled = entitlementEnabled(pending, 'expense_auto_post');
  const autoPostDisableBlock = autoPostEnabled
    ? disableBlockForChange(entitlements, toggleSubmenu(pending, 'expense_auto_post', false), entitlements)
    : null;

  // Both directions come from the one contracts-owned FEATURE_DEPENDENCIES matrix (spec:264);
  // this screen no longer restates the auto-post ⇒ ledger rule.
  const updatePending = (next: Entitlement[]) => {
    const disableBlock = disableBlockForChange(entitlements, next, entitlements);
    if (disableBlock) {
      showToast(disableBlock.reason, 'error');
      return;
    }
    const blocked = dependencyBlockMessage(pending, next);
    if (blocked) {
      showToast(blocked, 'error');
      return;
    }
    commandId.current = null;
    setPending(next);
  };

  const updateCard = (binding: MenuEntitlementBinding, next: boolean) => {
    updatePending(toggleMenuCard(pending, binding, next));
  };

  const updateAutoPost = (next: boolean) => {
    updatePending(toggleSubmenu(pending, 'expense_auto_post', next));
  };

  const choosePreset = async (presetKey: PartnerFeaturePresetKey) => {
    const next = applyPreset(pending, presetKey);
    const turningOff = presetTurningOffItems(entitlements, presetKey);
    if (turningOff.length > 0 && !(await confirm({
      title: 'ใช้ชุดเมนูสำเร็จรูป?',
      message: <>{`ชุด “${PARTNER_FEATURE_PRESETS[presetKey].labelTh}” จะปิด ${turningOff.length} อย่างที่ร้านนี้ใช้อยู่`}{turningOff.map(item => <span key={item.featureKey} className="block">{item.labelTh}</span>)}</>,
      confirmLabel: 'ใช้ชุดนี้', cancelLabel: 'ปิด', variant: 'primary',
    }))) return;
    updatePending(next);
  };

  const featureControl = (control: MenuFeatureControl, menuLess = false) => {
    const next = toggleSubmenu(pending, control.key, !control.enabled);
    const disableBlock = control.enabled ? disableBlockForChange(entitlements, next, entitlements) : null;
    return <article key={control.key} className={`mangmee-card flex items-start gap-3 p-4 shadow-none ${menuLess ? 'ml-4 border-l-2 border-gray-200 pl-3' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-gray-900">{control.labelTh}</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">{menuLess ? 'ร้านจะเห็นเมนู 50 ทวิ และปุ่มออกหนังสือรับรองที่หน้ารายจ่าย' : control.descriptionTh}</p>
        {disableBlock && <p className="mt-1 text-xs leading-5 text-amber-700">{disableBlock.reason}</p>}
      </div>
      <EntitlementSwitch checked={control.enabled} disabled={controlsLocked || Boolean(disableBlock)} disabledReason={disableBlock?.reason}
        label={`${control.enabled ? 'ปิด' : 'เปิด'} ${control.labelTh}`} onClick={() => updatePending(next)} />
    </article>;
  };

  // From the SAVED rows on purpose: a parent feature the operator has switched but not saved yet
  // changes nothing for the shop, so it changes nothing here either.
  const webEntryRow = manualWebEntryRow(entitlements, webEntry ?? { enabled: false }, fieldsLocked);
  const disbursementRow = disbursementVoucherWebEntryRow(entitlements, disbursementEntry ?? { enabled: false }, companyStatus !== 'ACTIVE');

  const toggleDisbursementVoucherWebEntry = async () => {
    if (!disbursementEntry || webEntrySaving || !disbursementRow.editable) return;
    const next = !disbursementEntry.enabled;
    const lines = disbursementRow.confirmLines(next);
    if (lines.length > 0 && !(await confirm({
      message: lines[0],
      confirmLabel: DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.confirmHideLabel,
      cancelLabel: DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.cancelHideLabel,
    }))) return;
    setWebEntrySaving(true);
    try {
      const saved = await setPartnerDisbursementVoucherWebEntry(companyId, { enabled: next, expectedVersion: disbursementEntry.version });
      setDisbursementEntry(saved);
      showToast(saved.enabled ? DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.savedShown : DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.savedHidden, 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setWebEntrySaving(false);
    }
  };

  const toggleManualWebEntry = async () => {
    if (!webEntry || webEntrySaving) return;
    const next = !webEntry.enabled;
    const lines = webEntryRow.confirmLines(next);
    if (lines.length > 0 && !(await confirm({
      message: <>{lines.map((line, index) => (
        <span key={line} className={index === 0 ? 'block' : 'mt-3 block font-semibold text-amber-800'}>{line}</span>
      ))}</>,
      confirmLabel: MANUAL_WEB_ENTRY_COPY.confirmHideLabel, cancelLabel: MANUAL_WEB_ENTRY_COPY.cancelHideLabel,
    }))) return;
    setWebEntrySaving(true);
    try {
      const saved = await setPartnerManualExpenseWebEntry(companyId, { enabled: next, expectedVersion: webEntry.version });
      // Kept here rather than reloading the detail: a reload would reset the package changes the
      // operator has made and not saved yet, and this setting is no part of them.
      setWebEntry(saved);
      showToast(saved.enabled ? MANUAL_WEB_ENTRY_COPY.savedShown : MANUAL_WEB_ENTRY_COPY.savedHidden, 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
      // Somebody else changed it first: show what is stored now, again without touching `pending`.
      if ((err as { status?: number }).status === 409) {
        const latest = await getPartnerDetail(companyId).catch(() => null);
        if (latest?.manualExpenseWebEntry) setWebEntry(latest.manualExpenseWebEntry);
      }
    } finally {
      setWebEntrySaving(false);
    }
  };

  const saveChanges = async () => {
    if (changes.length === 0 || normalizationPending) return;
    const attemptCommandId = commandId.current ?? globalThis.crypto.randomUUID();
    commandId.current = attemptCommandId;
    setReviewOpen(false);
    setSaving(true);
    try {
      await setPartnerFeatures(companyId, {
        features: changes.map(({ featureKey, enabled }) => ({ featureKey, enabled })),
        commandId: attemptCommandId,
        expectedSetVersion: setVersion,
        confirmCascade: cascadeItems.length > 0,
      });
      commandId.current = null;
      await onSaved();
      showToast(`บันทึกแพ็กเกจแล้ว ${visibleChangeCount} รายการ`, 'success');
    } catch (err) {
      const apiError = err as { status?: number; code?: string };
      if (isAmbiguousCommandFailure(apiError.status)) {
        // The request may already have committed. Keep both the exact pending payload and commandId
        // so the next click safely replays the stored result instead of issuing a second command.
        showToast('การเชื่อมต่อขาดหาย กดบันทึกอีกครั้งได้ ระบบจะไม่ทำรายการซ้ำ', 'error');
      } else {
        // A server refusal writes nothing. A 409 also means the displayed setVersion is stale, so
        // refresh before the operator reviews the change again.
        showToast(commandFailureMessage(apiErrorMessage(err), turningOffItems.length), 'error');
        commandId.current = null;
        setPending(entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })));
        await onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={reviewOpen}
        title={`ตรวจสอบการเปลี่ยนแปลงแพ็กเกจ · ${companyName}`}
        size="md"
        closeLabel="ยกเลิก"
        onClose={() => {
          if (!saving) setReviewOpen(false);
        }}
        footer={(
          <>
            <button
              type="button"
              className="mangmee-btn mangmee-btn-secondary min-h-11 min-w-11"
              disabled={saving}
              onClick={() => setReviewOpen(false)}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className="mangmee-btn mangmee-btn-primary min-h-11 min-w-11 disabled:opacity-50"
              disabled={controlsLocked || visibleChangeCount === 0}
              onClick={() => void saveChanges()}
              aria-busy={saving}
            >
              {saving ? 'กำลังบันทึก...' : 'ยืนยันและบันทึก'}
            </button>
          </>
        )}
      >
        <p className="mb-4 text-sm leading-6 text-gray-600">
          ระบบจะบันทึกการเปลี่ยนแปลงทั้งหมดพร้อมกันครั้งเดียว
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="text-sm font-bold text-red-700">
              จะปิดใช้งาน — ข้อมูลเดิมยังอยู่ ({turningOffItems.length})
            </h3>
            {turningOffItems.length === 0 ? (
              <p className="mt-3 text-xs text-red-500">ไม่มีรายการ</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {turningOffItems.map((item) => (
                  <li key={item.featureKey} className="text-sm text-red-800">
                    <span className="block font-bold">{item.labelTh}</span>
                    <span className="text-xs">เปิด → ปิด</span>
                    {cascadeItems.some(({ featureKey }) => featureKey === item.featureKey) && (
                      <span className="text-xs text-red-600">ปิดตามฟีเจอร์ที่เกี่ยวข้อง</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <h3 className="text-sm font-bold text-green-700">จะเพิ่ม ({diff.turningOn.length})</h3>
            {diff.turningOn.length === 0 ? (
              <p className="mt-3 text-xs text-green-600">ไม่มีรายการ</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {diff.turningOn.map((item) => (
                  <li key={item.featureKey} className="text-sm text-green-800">
                    <span className="block font-bold">{item.labelTh}</span>
                    <span className="text-xs">ปิด → เปิด</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {visibleChangeCount > 0 && (
          <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <summary className="min-h-11 cursor-pointer py-3 font-bold text-gray-700">
              รายละเอียดสำหรับฝ่ายสนับสนุน
            </summary>
            <p className="break-all font-mono leading-5">
              {[...turningOffItems, ...diff.turningOn].map(({ featureKey }) => featureKey).join(', ')}
            </p>
          </details>
        )}
      </Modal>
      {confirmDialog}

      <section className="mangmee-card">
        <div className="mangmee-card-header flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">เมนูและฟีเจอร์ที่เปิดให้ใช้</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
              เลือกเมนูและสิทธิ์ที่ลูกค้าจะใช้ได้ สิทธิ์ที่ไม่มีเมนูอยู่ในหมวดที่เกี่ยวข้อง ส่วนผู้ช่วย AI อยู่ในหัวข้อการทำงานเบื้องหลัง ตรวจรายการก่อนบันทึกทุกครั้ง
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="basis-full text-sm font-bold text-gray-700">ชุดเมนูสำเร็จรูป</h3>
            {(Object.keys(PARTNER_FEATURE_PRESETS) as PartnerFeaturePresetKey[]).map((presetKey) => {
              const next = applyPreset(pending, presetKey);
              const disableBlock = disableBlockForChange(entitlements, next, entitlements);
              return (
                <button
                  key={presetKey}
                  type="button"
                  className="mangmee-btn mangmee-btn-secondary min-h-11 disabled:opacity-50"
                  disabled={controlsLocked || Boolean(disableBlock)}
                  title={disableBlock?.reason}
                  onClick={() => void choosePreset(presetKey)}
                >
                  {PARTNER_FEATURE_PRESETS[presetKey].labelTh}{savedPresetStatus.activePresetKey === presetKey && ' ✓ ใช้อยู่'}
                </button>
              );
            })}
            {savedPresetStatus.activePresetKey === null && <p className="basis-full text-xs leading-5 text-gray-500">
              ปรับเอง{savedPresetStatus.nearby && <> · ต่างจาก “{PARTNER_FEATURE_PRESETS[savedPresetStatus.nearby.presetKey].labelTh}” {savedPresetStatus.nearby.count} รายการ</>}
            </p>}
            {descriptionPresetKey && <p className="basis-full text-xs leading-5 text-gray-500">{PARTNER_FEATURE_PRESETS[descriptionPresetKey].descriptionTh}</p>}
            <span className="mangmee-badge mangmee-badge-brand basis-full sm:basis-auto">
              เปิด {enabledCardCount}/{cards.length} เมนู
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            {featurePackageEditingNotice(controlsLocked, Boolean(webEntry) && webEntryRow.editable && !webEntrySaving, Boolean(disbursementEntry) && disbursementRow.editable && !webEntrySaving)}
          </p>
        </div>

        <div className="mangmee-card-body grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-6">
            {normalizationPending && (
              <p
                role="status"
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
              >
                {NORMALIZATION_PENDING_NOTICE}
              </p>
            )}
            {!normalizationPending && commandContractPending && (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                ระบบกำลังเตรียมข้อมูลแพ็กเกจ กรุณารอสักครู่
              </p>
            )}
            <label className="block">
              <span className="sr-only">ค้นหาเมนู</span>
              <input
                type="search"
                className="mangmee-input"
                placeholder="ค้นหาเมนู…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><label className="mb-2 block text-sm text-gray-600">หมวดเมนู</label><ThemedSelect aria-label="หมวดเมนู" className="min-h-11 !text-base" value={groupFilter} disabled={Boolean(search)} onChange={e=>setGroupFilter(e.target.value)}>{navGroups.map(group=><option key={group.group} value={group.group}>{group.labelTh||'เมนูหลัก'}</option>)}</ThemedSelect></div><button type="button" className={btnSecondary} onClick={()=>{setSearch('');setGroupFilter('main');}}>ล้างตัวกรอง</button></div>
            {search&&<p className="text-sm text-gray-600">ค้นหาในทุกหมวดเมนู</p>}
            {filteredCards.length===0&&<p className="py-6 text-gray-600">ไม่พบเมนูที่ตรงกับคำค้น</p>}
            {navGroups.filter(group=>Boolean(search)||group.group===groupFilter).map((navGroup) => {
              const groupCards = cards.filter((card) => card.group === navGroup.group);
              const visibleCards = filteredCards.filter((card) => card.group === navGroup.group);
              if (visibleCards.length === 0) return null;
              const sellableCards = groupCards.filter((card) => card.entitlementKeys.length > 0);
              const allEnabled = sellableCards.every((card) => card.enabled) && groupCards.flatMap(card => card.rights).every(right => right.enabled);
              const groupNext = toggleMenuGroup(pending, groupCards, !allEnabled);
              const groupDisableBlock = allEnabled
                ? disableBlockForChange(entitlements, groupNext, entitlements)
                : null;

              return (
                <div key={navGroup.group} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className={navGroup.labelTh
                      ? 'shrink-0 text-sm font-bold text-gray-700'
                      : 'sr-only'}
                    >
                      {navGroup.labelTh || 'เมนูหลัก'}
                    </h3>
                    <span className="h-px min-w-8 flex-1 bg-gray-200" aria-hidden="true" />
                    {sellableCards.length > 0 && (
                      <button
                        type="button"
                        className="min-h-11 text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                        disabled={controlsLocked || Boolean(groupDisableBlock)}
                        title={groupDisableBlock?.reason}
                        onClick={() => updatePending(groupNext)}
                      >
                        {allEnabled ? 'ปิดทั้งกลุ่ม' : 'เปิดทั้งกลุ่ม'}
                      </button>
                    )}
                    {groupDisableBlock && (
                      <span className="w-full text-right text-xs leading-5 text-amber-700">
                        {groupDisableBlock.reason}
                      </span>
                    )}
                  </div>

                  {visibleCards.map((card) => {
                    const expanded = card.autoExpand || expandedKeys.includes(card.navKey);
                    const toneClass = mangmeeToneClass[getMangmeeMenuTone(card.navKey, card.group)];
                    const submenuEnabled = card.submenus.filter((submenu) => submenu.enabled).length;
                    const foundation = card.entitlementKeys.length === 0;
                    const cardDisableBlock = card.enabled
                      ? disableBlockForChange(entitlements, toggleMenuCard(pending, card, false), entitlements)
                      : null;

                    return (
                      <div key={card.navKey} className="space-y-3"><article className="mangmee-card overflow-hidden shadow-none">
                        <div className="flex items-start gap-3 p-4">
                          <span className={`mangmee-icon-frame ${toneClass.icon}`}>
                            {WORKSPACE_ICON_NODES[card.iconKey] ?? WORKSPACE_ICON_NODES.GridIcon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-gray-900">{card.labelTh}</p>
                              {card.status === 'planned' && (
                                <span className="mangmee-badge mangmee-badge-slate">เร็วๆ นี้</span>
                              )}
                              {foundation && (
                                <span className="mangmee-badge mangmee-badge-brand">
                                  พื้นฐาน — ปิดไม่ได้
                                </span>
                              )}
                            </div>
                            <details className="mt-2 text-xs text-gray-500">
                              <summary className="min-h-11 cursor-pointer py-3 font-medium">
                                รายละเอียดสำหรับฝ่ายสนับสนุน
                              </summary>
                              <p className="break-all font-mono text-brand-700">{card.route}</p>
                              <p className="mt-1 break-all font-mono text-[11px] text-gray-500">
                                {card.entitlementKeys.length > 0
                                  ? card.entitlementKeys.join(', ')
                                  : card.navKey}
                              </p>
                            </details>
                            {cardDisableBlock && (
                              <p className="mt-1 text-xs leading-5 text-amber-700">{cardDisableBlock.reason}</p>
                            )}
                          </div>
                          {!foundation && (
                            <div className="flex shrink-0 items-center gap-2">
                              <span className={`text-xs font-bold ${card.enabled ? 'text-brand-700' : 'text-gray-400'}`}>
                                {card.enabled ? 'เปิด' : 'ปิด'}
                              </span>
                              <EntitlementSwitch
                                checked={card.enabled}
                                disabled={controlsLocked || Boolean(cardDisableBlock)}
                                disabledReason={cardDisableBlock?.reason}
                                label={`${card.enabled ? 'ปิด' : 'เปิด'}เมนู ${card.labelTh}`}
                                onClick={() => updateCard(card, !card.enabled)}
                              />
                            </div>
                          )}
                        </div>

                        {card.parentControl && featureControl(card.parentControl)}
                        {card.submenus.length > 0 && (
                          <div className="border-t border-gray-100 px-4 py-3">
                            {/* Opening the list is reading, not editing: it stays available while the
                                entitlement switches are locked, or a shop whose rows are still being
                                prepared could never reach the screen setting under "บันทึกด้วยมือ". */}
                            <button
                              type="button"
                              className="mangmee-badge mangmee-badge-brand"
                              aria-expanded={expanded}
                              aria-controls={`submenus-${card.navKey}`}
                              onClick={() => setExpandedKeys((current) => (
                                current.includes(card.navKey)
                                  ? current.filter((key) => key !== card.navKey)
                                  : [...current, card.navKey]
                              ))}
                            >
                              <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                              เมนูย่อย {submenuEnabled}/{card.submenus.length}
                            </button>

                            {!card.enabled && (
                              <p className="mt-2 text-xs font-medium text-amber-700">
                                ปิดทั้งหมดเพราะเมนูหลักปิดอยู่
                              </p>
                            )}

                            {expanded && (
                              <div
                                id={`submenus-${card.navKey}`}
                                className={`mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50 px-3 ${
                                  card.enabled ? '' : 'opacity-50'
                                }`}
                              >
                                {card.visibleSubmenus.map((submenu) => {
                                  const next = toggleSubmenu(pending, submenu.key, !submenu.enabled);
                                  const submenuDisableBlock = submenu.enabled
                                    ? disableBlockForChange(entitlements, next, entitlements)
                                    : null;
                                  return (
                                    <div key={submenu.key} className="py-3">
                                    <div className="flex items-start gap-3">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-800">{submenu.labelTh}</p>
                                        <p className="mt-0.5 text-xs leading-5 text-gray-500">
                                          {submenu.descriptionTh}
                                        </p>
                                        <details className="mt-1 text-xs text-gray-500">
                                          <summary className="min-h-11 cursor-pointer py-3 font-medium">
                                            รายละเอียดสำหรับฝ่ายสนับสนุน
                                          </summary>
                                          <p className="break-all font-mono text-[11px]">{submenu.key}</p>
                                          <p className="mt-1 break-all font-mono text-brand-700">{submenu.route}</p>
                                        </details>
                                        {submenuDisableBlock && (
                                          <p className="text-xs leading-5 text-amber-700">
                                            {submenuDisableBlock.reason}
                                          </p>
                                        )}
                                      </div>
                                      <EntitlementSwitch
                                        checked={submenu.enabled}
                                        disabled={controlsLocked || !card.enabled || Boolean(submenuDisableBlock)}
                                        disabledReason={submenuDisableBlock?.reason}
                                        label={`${submenu.enabled ? 'ปิด' : 'เปิด'}เมนู ${submenu.labelTh}`}
                                        onClick={() => updatePending(next)}
                                      />
                                    </div>
                                    {submenu.key === MANUAL_WEB_ENTRY_SUBMENU_KEY && webEntry && (
                                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 sm:ml-4">
                                        <div className="flex items-center gap-3">
                                          <p className="min-w-0 flex-1 text-sm font-bold text-gray-800">{MANUAL_WEB_ENTRY_COPY.label}</p>
                                          <span className={`shrink-0 text-xs font-bold ${webEntryRow.shown ? 'text-brand-700' : 'text-gray-500'}`}>
                                            {webEntryRow.shown ? MANUAL_WEB_ENTRY_COPY.shown : MANUAL_WEB_ENTRY_COPY.notShown}
                                          </span>
                                          <EntitlementSwitch
                                            checked={webEntryRow.shown}
                                            disabled={webEntrySaving || !webEntryRow.editable}
                                            disabledReason={webEntryRow.parentOffMessage ?? undefined}
                                            label={MANUAL_WEB_ENTRY_COPY.label}
                                            onClick={() => void toggleManualWebEntry()}
                                          />
                                        </div>
                                        <p className="mt-1 text-xs leading-5 text-gray-500">{MANUAL_WEB_ENTRY_COPY.description}</p>
                                        {webEntryRow.parentOffMessage && (
                                          <p className="mt-2 text-xs font-medium leading-5 text-amber-700">{webEntryRow.parentOffMessage}</p>
                                        )}
                                        {webEntryRow.uploadOffNote && (
                                          <p role="note" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900">
                                            {webEntryRow.uploadOffNote}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                    {submenu.key === MANUAL_WEB_ENTRY_SUBMENU_KEY && disbursementEntry && (
                                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 sm:ml-4">
                                        <div className="flex items-center gap-3">
                                          <p className="min-w-0 flex-1 text-sm font-bold text-gray-800">
                                            {DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.label.split(/(ใบเตรียมจ่าย|\/|ใบสำคัญจ่าย)/).filter(Boolean).map(part => (
                                              <span key={part}><wbr /><span className="whitespace-nowrap">{part}</span></span>
                                            ))}
                                          </p>
                                          <span className={`shrink-0 text-xs font-bold ${disbursementRow.shown ? 'text-brand-700' : 'text-gray-500'}`}>
                                            {disbursementRow.shown ? DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.shown : DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.notShown}
                                          </span>
                                          <EntitlementSwitch
                                            checked={disbursementRow.shown}
                                            disabled={webEntrySaving || !disbursementRow.editable}
                                            disabledReason={disbursementRow.disabledReason ?? undefined}
                                            label={DISBURSEMENT_VOUCHER_WEB_ENTRY_COPY.label}
                                            onClick={() => void toggleDisbursementVoucherWebEntry()}
                                          />
                                        </div>
                                        {disbursementRow.disabledReason && (
                                          <p className="mt-2 text-xs font-medium leading-5 text-amber-700">{disbursementRow.disabledReason}</p>
                                        )}
                                        {disbursementRow.shown && (
                                          <p role="note" className="mt-2 text-xs leading-5 text-gray-500">{disbursementVoucherRoleNotice(disbursementVoucherRoles)}</p>
                                        )}
                                      </div>
                                    )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                      {card.rights.map(right => featureControl(right, true))}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {filteredCards.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-500">ไม่พบเมนูที่ตรงกับคำค้นหา</p>
            )}

            <div className="space-y-3 border-t border-gray-200 pt-5">
              <div className="flex items-center gap-3">
                <h3 className="shrink-0 text-sm font-bold text-gray-700">
                  การทำงานเบื้องหลัง (ไม่ใช่เมนู)
                </h3>
                <span className="h-px flex-1 bg-gray-200" aria-hidden="true" />
              </div>
              <article className="mangmee-card flex items-start gap-3 p-4 shadow-none">
                <span className={`mangmee-icon-frame ${mangmeeToneClass.amber.icon}`}>
                  {WORKSPACE_ICON_NODES.BoltIcon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900">ผู้ช่วย AI ทาง LINE</p>
                  <p className="mt-0.5 text-sm leading-6 text-gray-600">ช่วยรับข้อความและใบเสร็จผ่าน LINE ตามสิทธิ์และโควตา ไม่มีเมนู AI แนะนำในแถบข้าง</p>
                  {aiDisableBlock && <p className="mt-1 text-xs leading-5 text-amber-700">{aiDisableBlock.reason}</p>}
                </div>
                <EntitlementSwitch
                  checked={aiEnabled}
                  disabled={controlsLocked || Boolean(aiDisableBlock)}
                  disabledReason={aiDisableBlock?.reason}
                  label={`${aiEnabled ? 'ปิด' : 'เปิด'}ผู้ช่วย AI ทาง LINE`}
                  onClick={() => updatePending(toggleSubmenu(pending, 'ai_line_assistant', !aiEnabled))}
                />
              </article>
              <article className="mangmee-card flex items-start gap-3 p-4 shadow-none">
                <span className={`mangmee-icon-frame ${mangmeeToneClass.amber.icon}`}>
                  {WORKSPACE_ICON_NODES.BoltIcon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900">ลงบัญชีค่าใช้จ่ายอัตโนมัติ</p>
                  <p className="mt-0.5 text-sm leading-6 text-gray-600">
                    ลงรายการบัญชีให้อัตโนมัติเมื่อยืนยันค่าใช้จ่าย (ต้องเปิดบัญชีแยกประเภท)
                  </p>
                  <details className="mt-1 text-xs text-gray-500">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                      รายละเอียดสำหรับฝ่ายสนับสนุน
                    </summary>
                    <p className="font-mono text-[11px]">expense_auto_post</p>
                  </details>
                  {autoPostDisableBlock && (
                    <p className="mt-1 text-xs leading-5 text-amber-700">{autoPostDisableBlock.reason}</p>
                  )}
                </div>
                <EntitlementSwitch
                  checked={autoPostEnabled}
                  disabled={controlsLocked || Boolean(autoPostDisableBlock)}
                  disabledReason={autoPostDisableBlock?.reason}
                  label={`${autoPostEnabled ? 'ปิด' : 'เปิด'}ลงบัญชีค่าใช้จ่ายอัตโนมัติ`}
                  onClick={() => updateAutoPost(!autoPostEnabled)}
                />
              </article>
            </div>
          </div>

          <aside className="order-first min-w-0 lg:order-last lg:sticky lg:top-4">
            <div className="mangmee-card overflow-hidden shadow-none">
              <div className="mangmee-card-header flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">เมนูที่บริษัทจะเห็น</h3>
                  <p className="mt-1 text-[11px] leading-5 text-gray-500">
                    สำหรับผู้ใช้ที่มีสิทธิ์ครบ — พนักงานจะเห็นน้อยกว่านี้ตามบทบาท
                  </p>
                </div>
                <button
                  type="button"
                  className="mangmee-btn mangmee-btn-secondary px-2 py-1 text-xs disabled:opacity-50"
                  aria-expanded={previewOpen}
                  onClick={() => setPreviewOpen((open) => !open)}
                >
                  {previewOpen ? 'ซ่อน' : 'แสดง'}
                </button>
              </div>
              <div className={`${previewOpen ? 'block' : 'hidden'} mangmee-card-body space-y-4`}>
                <div className="space-y-4 rounded-xl bg-gray-50 p-3">
                  {navGroups.map((group) => {
                    const items = group.items.filter((item) => showDisabledPreview || item.enabled);
                    if (items.length === 0) return null;
                    return (
                      <div key={group.group}>
                        {group.labelTh && (
                          <p className="mb-1.5 text-[11px] font-bold text-gray-400">{group.labelTh}</p>
                        )}
                        <ul className="space-y-1">
                          {items.map((item) => {
                            const toneClass = mangmeeToneClass[getMangmeeMenuTone(item.navKey, group.group)];
                            return (
                              <li
                                key={item.navKey}
                                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold ${
                                  item.enabled ? 'bg-white text-gray-700' : 'text-gray-400 line-through'
                                }`}
                              >
                                <span className={`mangmee-icon-frame h-7 w-7 rounded-lg ${toneClass.icon}`}>
                                  {WORKSPACE_ICON_NODES[item.iconKey] ?? WORKSPACE_ICON_NODES.GridIcon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{item.labelTh}</span>
                                {item.status === 'planned' && (
                                  <span className="text-[9px] font-medium text-gray-400">เร็วๆ นี้</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={showDisabledPreview}
                    disabled={controlsLocked}
                    onChange={(event) => setShowDisabledPreview(event.target.checked)}
                  />
                  แสดงเมนูที่ปิดด้วย
                </label>
              </div>
            </div>
          </aside>
        </div>

        <div className="mangmee-safe-bottom sticky bottom-0 z-20 flex flex-col gap-3 border-t border-gray-200 bg-white/95 px-5 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm font-bold text-gray-700">
            มีการเปลี่ยนแปลง {visibleChangeCount} รายการ
          </p>
          <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <button
              type="button"
              className="mangmee-btn mangmee-btn-secondary min-h-11 min-w-11 disabled:opacity-50"
              disabled={controlsLocked || visibleChangeCount === 0}
              onClick={() => setPending(
                entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })),
              )}
            >
              คืนค่า
            </button>
            <button
              type="button"
              className="mangmee-btn mangmee-btn-primary min-h-11 min-w-11 disabled:opacity-50"
              disabled={controlsLocked || visibleChangeCount === 0}
              onClick={() => setReviewOpen(true)}
              aria-busy={saving}
            >
              {saving ? 'กำลังบันทึก...' : 'ตรวจสอบและบันทึก'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function EntitlementSwitch({
  checked,
  disabled,
  disabledReason,
  label,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabledReason}
      className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      aria-checked={checked}
      aria-label={label}
      role="switch"
    >
      <span
        className={`pointer-events-none relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-brand-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

/** One measure row of a breakdown; stacks at 390px instead of forcing the page to scroll. */
function AiMeasureRow({ label, measures }: { label: string; measures: PartnerAiUsageMeasuresDto }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-gray-100 py-2 last:border-b-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="tabular-nums text-sm text-gray-900">{satangToBaht(measures.costSatang)}</span>
      <span className="w-full text-xs text-gray-500">
        {measures.calls.toLocaleString('th-TH')} ครั้ง · เฉลี่ย {aiAverageCostLabel(measures.costSatang, measures.calls)}
        {' · '}{measures.inputTokens.toLocaleString('th-TH')} in / {measures.outputTokens.toLocaleString('th-TH')} out
        {' · cache '}{measures.cacheReadInputTokens.toLocaleString('th-TH')} อ่าน / {measures.cacheWriteInputTokens.toLocaleString('th-TH')} เขียน
      </span>
    </li>
  );
}

/** Current-month kind/bucket/basis breakdown (remediation spec §11.1). Read-only: nothing here
 *  depends on the unsaved budget/OCR draft below, so a typed-but-unsaved value never moves a number. */
function AiUsageBreakdown({ usage }: { usage: PartnerAiUsageDto }) {
  // Version skew: a rolling deploy can serve this page from a pre-D1 API with no breakdown at all.
  // Fall back to the old card rather than throwing on the first missing field.
  if (!hasAiUsageBreakdown(usage)) return null;
  const { breakdown } = usage;
  const coverageNotice = aiCoverageNotice(breakdown.coverage, formatThaiDate);
  const basisNote = aiUsageBasisNote(breakdown.byUsageBasis);
  return (
    <section className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3" aria-labelledby="ai-usage-breakdown-title">
      <div>
        <h3 id="ai-usage-breakdown-title" className="text-sm font-bold text-gray-900">
          แยกตามประเภท ({formatThaiMonth(breakdown.monthKey)})
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-600">
          “ครั้ง” คือจำนวนครั้งที่เรียกโมเดล ไม่ใช่จำนวนใบเสร็จ — การอ่านรูปหนึ่งใบอาจใช้หลายครั้ง
          และการทักแชตพร้อมรูปจะรวมการอ่านรูปไว้ในครั้งเดียวกัน
        </p>
      </div>

      <p className="text-sm text-gray-700">
        รวมจากรายการจริง <span className="font-semibold tabular-nums">{satangToBaht(breakdown.total.costSatang)}</span>
        {' · '}{breakdown.total.calls.toLocaleString('th-TH')} ครั้ง
        {' · เฉลี่ย '}<span className="tabular-nums">{aiAverageCostLabel(breakdown.total.costSatang, breakdown.total.calls)}</span> ต่อครั้ง
        {' · ต้นทุน cache '}{aiCacheCostLabel(breakdown.total.cacheCostSatang)}
      </p>

      {coverageNotice && (
        <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs leading-5 text-yellow-800">{coverageNotice}</p>
      )}
      {basisNote && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">{basisNote}</p>
      )}
      {breakdown.adjustments.rows > 0 && (
        <p className="text-xs leading-5 text-gray-600">
          รวมรายการปรับปรุงต้นทุน {breakdown.adjustments.rows.toLocaleString('th-TH')} รายการ
          ({satangToBaht(breakdown.adjustments.costSatang)}) ซึ่งไม่นับเป็นจำนวนครั้งที่เรียกโมเดล
        </p>
      )}

      <div>
        <p className="text-xs font-medium text-gray-500">เครดิตตามส่วน</p>
        <ul className="mt-1">
          {breakdown.byBudgetBucket.map((row) => (
            <AiMeasureRow key={row.budgetBucket} label={AI_BUDGET_BUCKET_LABELS[row.budgetBucket] ?? row.budgetBucket} measures={row} />
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500">ชนิดคำขอ</p>
        <ul className="mt-1">
          {breakdown.byRequestKind.map((row) => (
            <AiMeasureRow key={row.requestKind} label={AI_REQUEST_KIND_LABELS[row.requestKind] ?? row.requestKind} measures={row} />
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500">ที่มาของตัวเลข token</p>
        <ul className="mt-1">
          {breakdown.byUsageBasis.map((row) => (
            <AiMeasureRow key={row.usageBasis} label={AI_USAGE_BASIS_LABELS[row.usageBasis] ?? row.usageBasis} measures={row} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Split CHAT/OCR budget policy (remediation spec §11.3, §12.4, §12.5).
 *
 * Everything above the form is the SAVED server state: the draft below can never move a number.
 * Thin on purpose — every derivation (baht↔satang, month options, validation, labels, availability,
 * conflict handling) lives in `ai-budget.logic.ts` with unit tests.
 */
function AiBudgetPolicyPanel({
  usage, monthKey, draft, onDraft, reason, onReason, saving, busy, canManage, companyLocked, onSave, onCancelPending,
}: {
  usage: PartnerAiUsageDto;
  monthKey: string;
  draft: AiBudgetDraft;
  onDraft: (next: AiBudgetDraft) => void;
  reason: string;
  onReason: (next: string) => void;
  saving: boolean;
  /** Another control on this card is mid-save. */
  busy: boolean;
  /** The CALLER holds `system.partner_ai_model.manage`. */
  canManage: boolean;
  /** The COMPANY is DISABLED/ARCHIVED. A different fact, and a different sentence. */
  companyLocked: boolean;
  onSave: () => void;
  onCancelPending: () => void;
}) {
  const { policy, position } = usage.budget;
  const canEdit = canManage && !companyLocked;
  const rows = aiBudgetScopeRows(usage.budget);
  const invalidNotice = aiBudgetInvalidNotice(policy.invalidReason);
  const pendingText = aiBudgetPendingText(policy.pending, formatThaiMonth);
  const months = aiBudgetMonthOptions(monthKey);
  const changed = aiBudgetDraftChanged(draft, policy, monthKey);

  return (
    <section className="space-y-4 border-t-2 border-gray-100 pt-5" aria-labelledby="ai-budget-policy-title">
      <div>
        <h3 id="ai-budget-policy-title" className="text-base font-bold text-gray-900">โหมดแยกเพดานของร้านนี้</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          ใช้อยู่: <strong className="font-bold text-gray-900">{AI_BUDGET_MODE_LABELS[policy.mode] ?? policy.mode}</strong>
          {policy.source === 'PENDING_ACTIVATED' && ' · เริ่มมีผลแล้วตามที่ตั้งไว้ล่วงหน้า'}
        </p>
      </div>

      {invalidNotice && (
        <p role="alert" data-testid="ai-budget-invalid" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900">
          {invalidNotice}
        </p>
      )}
      {pendingText && (
        <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p data-testid="ai-budget-pending" className="text-sm font-semibold leading-6 text-blue-900">{pendingText}</p>
          {canEdit && (
            <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11 shrink-0 text-base"
              disabled={saving || busy} aria-busy={saving} onClick={onCancelPending}>
              ยกเลิกค่าที่ตั้งไว้
            </button>
          )}
        </div>
      )}

      {/* Four money columns cannot be read at 390px; scroll inside this container, never the page. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm" data-testid="ai-budget-position">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 pr-4 font-medium">ส่วน</th>
              <th className="py-2 pr-4 font-medium">เพดาน</th>
              <th className="py-2 pr-4 font-medium">ใช้แล้ว</th>
              <th className="py-2 pr-4 font-medium">{AI_BUDGET_RESERVED_NOTE}</th>
              <th className="py-2 font-medium">เหลือใช้ได้</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-gray-100" data-testid={`ai-budget-scope-${row.key}`}>
                <td className="py-2.5 pr-4 text-gray-700">{row.label}</td>
                <td className="py-2.5 pr-4 tabular-nums text-gray-900">{aiBudgetCapLabel(row.capSatang)}</td>
                <td className="py-2.5 pr-4 tabular-nums text-gray-800">{satangToBaht(row.spentSatang)}</td>
                <td className="py-2.5 pr-4 tabular-nums text-gray-600">{satangToBaht(row.reservedSatang)}</td>
                <td className="py-2.5 tabular-nums text-gray-900">{aiBudgetAvailableLabel(row.availableSatang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-gray-500">
        “{AI_BUDGET_RESERVED_NOTE}” คือเครดิตที่ระบบกันไว้ให้งานที่กำลังเรียก AI อยู่ ยังไม่ใช่ค่าใช้จ่ายจริง
        และยังไม่นับเป็นจำนวนครั้งที่เรียกโมเดล · เพดานที่ยังไม่ตั้งหมายถึงยังไม่กำหนด ไม่ใช่ไม่จำกัด
      </p>
      {position.unresolvedHolds > 0 && (
        <p data-testid="ai-budget-unresolved" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          มี {position.unresolvedHolds.toLocaleString('th-TH')} รายการที่ยังไม่ทราบผลจากผู้ให้บริการ AI — เครดิตส่วนนั้นยังถูกกันไว้จนกว่าจะได้ผลจริง
        </p>
      )}
      {position.breach && (
        <p role="alert" data-testid="ai-budget-breach" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900">
          มีรายการใช้เกินที่กันไว้และบันทึกยอดจริงครบแล้วค่ะ ระบบยังรับงานตามเครดิตที่เหลือ
        </p>
      )}

      {!canEdit ? (
        <p data-testid="ai-budget-read-only" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">
          {canManage
            ? 'บริษัทนี้อ่านได้อย่างเดียวตามสถานะบริษัท จึงแก้โหมดหรือเพดานเครดิต AI ไม่ได้ เปลี่ยนสถานะได้ในหมวดภาพรวม'
            : 'บัญชีของคุณดูข้อมูลได้ แต่ยังไม่มีสิทธิ์แก้โหมดหรือเพดานเครดิต AI'}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-bold text-gray-700" htmlFor="ai-budget-mode">โหมดเครดิต AI
              <select id="ai-budget-mode" className={`${inputClass} mt-1 min-h-12 text-base`} value={draft.mode}
                disabled={saving || busy} onChange={(e) => onDraft({ ...draft, mode: e.target.value as AiBudgetDraft['mode'] })}>
                <option value="SHARED">{AI_BUDGET_MODE_LABELS.SHARED}</option>
                <option value="SPLIT">{AI_BUDGET_MODE_LABELS.SPLIT}</option>
              </select>
            </label>
            <label className="block text-sm font-bold text-gray-700" htmlFor="ai-budget-month">เดือนที่เริ่มใช้
              <select id="ai-budget-month" className={`${inputClass} mt-1 min-h-12 text-base`} value={draft.effectiveMonthKey}
                disabled={saving || busy} onChange={(e) => onDraft({ ...draft, effectiveMonthKey: e.target.value })}>
                {months.map((month) => (
                  <option key={month.monthKey} value={month.monthKey}>
                    {formatThaiMonth(month.monthKey)}{month.current ? ' (เดือนนี้)' : ' (เดือนถัดไป)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-gray-700" htmlFor="ai-budget-chat-cap">เพดานแชตและ AI ทั่วไป (บาท)
              <input id="ai-budget-chat-cap" className={`${inputClass} mt-1 min-h-12 text-base`} type="text" inputMode="decimal"
                placeholder="0 = ปิดส่วนนี้" value={draft.chat} disabled={saving || busy || draft.mode !== 'SPLIT'}
                onChange={(e) => onDraft({ ...draft, chat: e.target.value })} />
            </label>
            <label className="block text-sm font-bold text-gray-700" htmlFor="ai-budget-ocr-cap">เพดาน AI อ่านเอกสาร (บาท)
              <input id="ai-budget-ocr-cap" className={`${inputClass} mt-1 min-h-12 text-base`} type="text" inputMode="decimal"
                placeholder="0 = ปิดส่วนนี้" value={draft.ocr} disabled={saving || busy || draft.mode !== 'SPLIT'}
                onChange={(e) => onDraft({ ...draft, ocr: e.target.value })} />
            </label>
          </div>
          <p className="text-xs leading-5 text-gray-500">
            ผลรวมเพดานต้องไม่เกินเพดานความปลอดภัยที่บันทึกไว้ {satangToBaht(usage.budget.effectiveSatang)} · ใส่ 0 เพื่อปิดส่วนนั้น
            {' · '}โหมดแยกเพดานต้องตั้งรุ่น AI ของร้านก่อน และถ้าเดือนนี้ร้านใช้ AI ไปแล้วต้องเลือกเริ่มเดือนถัดไป
          </p>
          <label className="block text-base">เหตุผลที่ปรับเพดานเครดิต AI
            <textarea aria-label="เหตุผลที่ปรับเพดานเครดิต AI" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500}
              value={reason} disabled={saving || busy} onChange={(e) => onReason(e.target.value)} />
          </label>
          <button type="button" className={`${btnPrimary} min-h-12 min-w-32 text-base`}
            data-testid="ai-budget-policy-save"
            disabled={saving || busy || !changed} aria-busy={saving} onClick={onSave}>
            {saving ? 'กำลังบันทึก…' : 'บันทึกเพดานเครดิต AI'}
          </button>
        </>
      )}
    </section>
  );
}

/**
 * Held credit that nothing will ever release by itself (hold-reconciliation spec §4.1–4.2).
 *
 * Presentational: the fetch, the reason, the confirm dialog and the reload all live in
 * `AiUsageBudgetSection` under its `generation` token, and every derivation (labels, age, the
 * money consequence text) is in `ai-budget.logic.ts` with unit tests. Nothing here computes money.
 */
function AiCreditHoldsPanel({
  holds, reason, onReason, busyId, canEdit, disabled, onAct,
}: {
  holds: PartnerAiCreditHoldsDto;
  reason: string;
  onReason: (next: string) => void;
  /** The reservation whose action is in flight, so only its own buttons show the busy state. */
  busyId: string | null;
  /** Caller holds `system.partner_ai_model.manage` AND the company is not locked. */
  canEdit: boolean;
  /** Another control on this card is mid-save. */
  disabled: boolean;
  onAct: (hold: PartnerAiCreditHoldDto, action: AiCreditHoldAction) => void;
}) {
  return (
    <section className="space-y-4 border-t-2 border-gray-100 pt-5" aria-labelledby="ai-credit-holds-title">
      <div>
        <h3 id="ai-credit-holds-title" className="text-base font-bold text-gray-900">เครดิตที่กันไว้ค้าง</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          เครดิตที่ระบบกันไว้แล้วยังไม่ทราบผลจากผู้ให้บริการ AI และรายการที่ใช้เกินที่กันไว้ — ระบบไม่ปล่อยคืนเองตามเวลา
          {' '}ค้นทุกเดือนที่ยังมีรายการค้าง ({holds.monthKeys.map((monthKey) => formatThaiMonth(monthKey)).join(' · ')})
        </p>
      </div>

      {holds.items.length === 0 ? (
        <p data-testid="ai-credit-holds-empty" className="text-sm leading-6 text-gray-600">{AI_CREDIT_HOLD_EMPTY_NOTE}</p>
      ) : (
        <>
          {/* Six columns cannot be read at 390px; scroll inside this container, never the page. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="ai-credit-holds-table">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-4 font-medium">ประเภทงาน</th>
                  <th className="py-2 pr-4 font-medium">ส่วน</th>
                  <th className="py-2 pr-4 font-medium">เครดิตที่กันไว้</th>
                  <th className="py-2 pr-4 font-medium">เรียกเมื่อ</th>
                  <th className="py-2 pr-4 font-medium">อายุ</th>
                  <th className="py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {holds.items.map((hold) => (
                  <tr key={hold.id} className="border-b border-gray-100 align-top" data-testid={`ai-credit-hold-${hold.id}`}>
                    <td className="py-2.5 pr-4 text-gray-700">
                      {aiCreditHoldStepLabel(hold.stepKind)}
                      <span className="block font-mono text-xs text-gray-400">{hold.invocationKeyShort}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700">{AI_BUDGET_BUCKET_LABELS[hold.bucket] ?? hold.bucket}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-gray-900">
                      {satangToBaht(hold.upperBoundSatang)}
                      {hold.settledCostSatang !== null && (
                        <span className="block text-xs text-red-800">ใช้จริง {satangToBaht(hold.settledCostSatang)}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600">{formatThaiDateTime(hold.createdAt)}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-gray-700">{aiCreditHoldAgeLabel(hold.createdAt)}</td>
                    <td className="py-2.5 text-gray-700">
                      {aiCreditHoldKindLabel(hold.kind)}
                      {canEdit && (
                        <span className="mt-2 flex flex-wrap gap-2">
                          {hold.kind === 'BREACH' ? (
                            <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11 text-base"
                              data-testid={`ai-credit-hold-acknowledge-${hold.id}`}
                              disabled={disabled || busyId !== null} aria-busy={busyId === hold.id}
                              onClick={() => onAct(hold, 'acknowledge_breach')}>
                              {AI_CREDIT_HOLD_ACTION_LABELS.acknowledge_breach}
                            </button>
                          ) : (
                            <>
                              <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11 text-base"
                                data-testid={`ai-credit-hold-release-${hold.id}`}
                                disabled={disabled || busyId !== null} aria-busy={busyId === hold.id}
                                onClick={() => onAct(hold, 'release')}>
                                {AI_CREDIT_HOLD_ACTION_LABELS.release}
                              </button>
                              <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11 text-base"
                                data-testid={`ai-credit-hold-charge-${hold.id}`}
                                disabled={disabled || busyId !== null} aria-busy={busyId === hold.id}
                                onClick={() => onAct(hold, 'charge_at_bound')}>
                                {AI_CREDIT_HOLD_ACTION_LABELS.charge_at_bound}
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <label className="block text-base">เหตุผลที่จัดการเครดิตที่กันไว้
              <textarea aria-label="เหตุผลที่จัดการเครดิตที่กันไว้" data-testid="ai-credit-holds-reason"
                className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500}
                value={reason} disabled={disabled || busyId !== null} onChange={(e) => onReason(e.target.value)} />
            </label>
          )}
          {!canEdit && (
            <p data-testid="ai-credit-holds-read-only" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">
              {holds.canManage
                ? 'บริษัทนี้อ่านได้อย่างเดียวตามสถานะบริษัท จึงจัดการเครดิตที่กันไว้ไม่ได้ เปลี่ยนสถานะได้ในหมวดภาพรวม'
                : 'บัญชีของคุณดูรายการได้ แต่ยังไม่มีสิทธิ์ปล่อยหรือคิดเครดิตที่กันไว้'}
            </p>
          )}
        </>
      )}
      <p className="text-xs leading-5 text-gray-500">{AI_CREDIT_HOLD_HELP_NOTE}</p>
    </section>
  );
}

// -- "เครดิต AI และอ่านรูป" tab: chat credit, receipt images, safety ceiling (admin tab rework 2026-09-29)

const STATUS_TONE_CLASS: Record<AiTabStatusTone, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-green-500', text: 'text-gray-900', label: 'ใช้ได้' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-900', label: 'ควรตรวจ' },
  stop: { dot: 'bg-red-600', text: 'text-red-800', label: 'หยุดอยู่' },
};

function AiUsageBudgetSection({
  companyId,
  fieldsLocked,
  showToast,
  onChanged,
}: {
  companyId: string;
  fieldsLocked: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
  onChanged: () => void;
}) {
  const [usage, setUsage] = useState<PartnerAiUsageDto | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [receiptQuotaMode, setReceiptQuotaMode] = useState('inherit');
  const [ocrLimitInput, setOcrLimitInput] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [budgetReason,setBudgetReason]=useState(''),[ocrReason,setOcrReason]=useState('');
  // This shop's own chat credit (SHARED `chatMonthlyBudgetSatang`), prefilled from the SAVED policy.
  const [chatInput,setChatInput]=useState('');
  const [chatReason,setChatReason]=useState('');
  const [chatLoading,setChatLoading]=useState(false);
  // Split policy (spec §12.4). The draft is prefilled from the SAVED policy on every load, so a
  // company switch or a conflict reload can never leave the previous company's values in the form.
  const [policyDraft,setPolicyDraft]=useState<AiBudgetDraft|null>(null);
  const [policyReason,setPolicyReason]=useState('');
  const [policyLoading,setPolicyLoading]=useState(false);
  // Held credit (hold spec §4). `null` = not loaded, or an API that predates the route: the panel
  // then simply does not render, the same tolerance the D1 breakdown and the split panel have.
  const [holds,setHolds]=useState<PartnerAiCreditHoldsDto|null>(null);
  const [holdReason,setHoldReason]=useState('');
  const [holdBusyId,setHoldBusyId]=useState<string|null>(null);
  const generation=useRef(0);
  const { confirm, confirmDialog } = useConfirm();

  /** The holds read runs the sweep server-side, so it is always a fresh read, never patched. */
  const loadHolds = async (token: number) => {
    try {
      const result = await getPartnerAiCreditHolds(companyId);
      if(token===generation.current)setHolds(result);
    } catch {
      // A 403/404 here must not take the whole AI card down: a read-only operator without the
      // dashboard-read permission never got this far, and a pre-H3 API has no such route.
      if(token===generation.current)setHolds(null);
    }
  };

  const loadUsage = async () => {
    const token=++generation.current;
    setUsageLoading(true);
    try {
      const result = await getPartnerAiUsage(companyId);
      if(token!==generation.current)return;
      setUsage(result);
      // Version skew: a pre-E1a API sends no `budget.policy`/`budget.position` at all. Leave the
      // draft null and render no panel, exactly as `hasAiUsageBreakdown` drops the D1 breakdown —
      // a TypeError here would put the WHOLE card into its error state.
      const policyReady=hasAiBudgetPolicy(result);
      setPolicyDraft(policyReady
        ? aiBudgetDraftFromPolicy(result.budget.policy, aiBudgetCurrentMonthKey(result))
        : null);
      setChatInput(policyReady ? chatCreditInputFromUsage(result) : '');
      setBudgetInput(result.budget.overrideSatang === null ? '' : satangToBahtInput(result.budget.overrideSatang));
      setOcrEnabled(result.ocr.config.enabled);
      setReceiptQuotaMode(result.ocr.config.receiptQuotaEnforced == null ? 'inherit' : result.ocr.config.receiptQuotaEnforced ? 'enforce' : 'observe');
      setOcrLimitInput(result.ocr.config.monthlyLimit === null ? '' : String(result.ocr.config.monthlyLimit));
      setUsageError(null);
      // Sequential and last: it is the only read on this card that takes a database lock (the
      // sweep), and it must never delay the numbers above it.
      await loadHolds(token);
    } catch (err) {
      if(token!==generation.current)return;
      const e = err as Error & { status?: number };
      setUsageError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูการใช้งาน AI' : apiErrorMessage(err));
    } finally { if(token===generation.current)setUsageLoading(false); }
  };

  useEffect(() => {
    void loadUsage();
    return ()=>{generation.current++;};
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two separate facts, and BOTH must disable every control on this card. `undefined` (a pre-D2 API)
  // keeps the old behaviour of showing the forms and letting the server answer 403.
  const canManage = canManageAiBudget(usage);
  const locked = fieldsLocked || !canManage;
  const saving = budgetLoading || ocrLoading || policyLoading || chatLoading;

  /** The safety ceiling (`monthlyBudgetSatang`). It no longer moves the chat credit (admin tab rework). */
  const handleBudgetSave = async () => {
    if(!usage||locked||saving)return;
    const reason=partnerAdjustmentReason(budgetReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่ปรับเพดานความปลอดภัย','error');return;}
    const parsed=parseBudgetBahtInput(budgetInput);
    if(!parsed.ok){showToast(parsed.message, 'error');return;}
    const token=generation.current,desired=parsed.monthlyBudgetSatang??usage.budget.defaultSatang;
    const accepted=await confirm({title:'ตรวจเพดานความปลอดภัยก่อนบันทึก',message:safetyCeilingConfirmMessage(usage,desired,reason),confirmLabel:'ยืนยันบันทึก',cancelLabel:'กลับไปแก้'});
    if(!accepted||token!==generation.current)return;
    setBudgetLoading(true);
    try {
      const result=await setPartnerAiModel(companyId,{monthlyBudgetSatang:parsed.monthlyBudgetSatang,expectedMonthlyBudgetSatang:usage.budget.overrideSatang,reason});
      if(token!==generation.current)return;
      setBudgetReason('');onChanged();
      showToast(result.monthlyBudgetSatang===null?'บันทึกแล้ว ร้านนี้ใช้เพดานความปลอดภัยค่ากลางของระบบ':`บันทึกเพดานความปลอดภัย ${satangToBaht(result.monthlyBudgetSatang)} แล้ว`,'success');
      setBudgetLoading(false);
      await loadUsage();
    }catch(err){
      if(token!==generation.current)return;
      showToast(apiErrorMessage(err),'error');
      if(apiErrorCode(err)==='partner_ai_configuration_changed'){setBudgetLoading(false);await loadUsage();}
    }finally{if(token===generation.current)setBudgetLoading(false);}
  };

  /** This shop's chat credit, through the existing budget-policy writer (SHARED + chat, this month). */
  const handleChatSave = async () => {
    if(!usage||locked||saving)return;
    const reason=partnerAdjustmentReason(chatReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่ปรับเครดิตแชต','error');return;}
    const parsed=parseChatCreditInput(chatInput);
    if(!parsed.ok){showToast(parsed.notice,'error');return;}
    const token=generation.current;
    const accepted=await confirm({title:'ตรวจเครดิตแชตก่อนบันทึก',message:chatCreditConfirmMessage(usage,parsed.satang,reason,formatThaiDate),
      confirmLabel:'ยืนยันบันทึก',cancelLabel:'กลับไปแก้'});
    if(!accepted||token!==generation.current)return;
    setChatLoading(true);
    try {
      await setPartnerAiModel(companyId,{reason,budgetPolicy:chatCreditPolicyRequest(parsed.satang,aiBudgetCurrentMonthKey(usage)),
        expectedBudgetRevision:usage.budget.policy.revision});
      if(token!==generation.current)return;
      setChatReason('');onChanged();
      showToast(parsed.satang===null?'บันทึกแล้ว ร้านนี้ใช้เครดิตแชตตามค่าเริ่มต้นหรือดีลขาย':`บันทึกเครดิตแชต ${satangToBaht(parsed.satang)} ต่อเดือนแล้ว`,'success');
      setChatLoading(false);
      await loadUsage();
    }catch(err){
      if(token!==generation.current)return;
      setChatLoading(false);
      if(await reloadAfterAiBudgetConflict(apiErrorCode(err),loadUsage)){showToast(AI_BUDGET_STALE_MESSAGE,'error');return;}
      showToast(apiErrorMessage(err),'error');
    }finally{if(token===generation.current)setChatLoading(false);}
  };

  /** One writer for both the policy save and the cancel-pending action (spec §12.4/§12.5). */
  const savePolicy = async (
    body: { budgetPolicy: AiBudgetPolicyRequest | null },
    successMessage: string,
  ) => {
    if(!usage||locked||saving)return;
    const reason=partnerAdjustmentReason(policyReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่ปรับเพดานเครดิต AI','error');return;}
    const token=generation.current;
    setPolicyLoading(true);
    try {
      await setPartnerAiModel(companyId,{reason,...body,expectedBudgetRevision:usage.budget.policy.revision});
      if(token!==generation.current)return;
      setPolicyReason('');onChanged();
      showToast(successMessage,'success');
      setPolicyLoading(false);
      // The writer answers model/total fields only, so the saved policy, the revision and the money
      // position all come back from a fresh read — never from a locally patched object.
      await loadUsage();
    }catch(err){
      if(token!==generation.current)return;
      setPolicyLoading(false);
      // Same shape as the OCR-config fence: reload first, then say what to re-check.
      if(await reloadAfterAiBudgetConflict(apiErrorCode(err),loadUsage)){showToast(AI_BUDGET_STALE_MESSAGE,'error');return;}
      showToast(apiErrorMessage(err),'error');
    }finally{if(token===generation.current)setPolicyLoading(false);}
  };

  const handlePolicySave = async () => {
    if(!usage||!policyDraft)return;
    // Before the dialog: a confirm that prints "เหตุผล: —" and then refuses after the operator
    // pressed Confirm is a wasted decision.
    if(!partnerAdjustmentReason(policyReason)){showToast('กรุณาระบุเหตุผลที่ปรับเพดานเครดิต AI','error');return;}
    const token=generation.current,monthKey=aiBudgetCurrentMonthKey(usage);
    const validated=validateAiBudgetDraft(policyDraft,{
      // The SAVED total, never the unsaved override draft above: it is the number the server compares.
      totalSatang:usage.budget.effectiveSatang,
      monthOptions:aiBudgetMonthOptions(monthKey).map(month=>month.monthKey),
    });
    if(!validated.ok){showToast(validated.notice,'error');return;}
    const scheduled=validated.policy.effectiveMonthKey!==monthKey;
    const accepted=await confirm({title:'ตรวจเพดานเครดิต AI ก่อนบันทึก',
      message:`${AI_BUDGET_MODE_LABELS[validated.policy.mode]}${validated.policy.mode==='SPLIT'?` — แชต ${aiBudgetCapLabel(validated.policy.chatMonthlyBudgetSatang)} · อ่านเอกสาร ${aiBudgetCapLabel(validated.policy.ocrMonthlyBudgetSatang)}`:''}\n${scheduled?`เริ่มเดือน ${formatThaiMonth(validated.policy.effectiveMonthKey)} ค่าที่ใช้อยู่เดือนนี้ไม่เปลี่ยน`:'มีผลกับงานที่เริ่มหลังบันทึก งานที่เริ่มแล้วจะทำจนจบและนับค่าใช้จ่ายตามจริง'}\nเหตุผล: ${partnerAdjustmentReason(policyReason)??'—'}`,
      confirmLabel:'ยืนยันบันทึก',cancelLabel:'กลับไปแก้'});
    if(!accepted||token!==generation.current)return;
    await savePolicy({budgetPolicy:validated.policy},scheduled?'ตั้งเพดานเครดิต AI ให้เริ่มเดือนถัดไปแล้ว':'บันทึกเพดานเครดิต AI แล้ว');
  };

  const handleCancelPending = async () => {
    if(!partnerAdjustmentReason(policyReason)){showToast('กรุณาระบุเหตุผลที่ปรับเพดานเครดิต AI','error');return;}
    const token=generation.current;
    const accepted=await confirm({title:'ยกเลิกค่าที่ตั้งให้เริ่มเดือนถัดไป',
      message:'หลังยกเลิก เดือนถัดไปจะใช้โหมดและเพดานที่ใช้อยู่ตอนนี้ต่อไป ค่าที่ใช้อยู่เดือนนี้ไม่เปลี่ยน',
      confirmLabel:'ยกเลิกค่าที่ตั้งไว้',cancelLabel:'เก็บไว้ก่อน'});
    if(!accepted||token!==generation.current)return;
    await savePolicy({budgetPolicy:null},'ยกเลิกค่าที่ตั้งให้เริ่มเดือนถัดไปแล้ว');
  };

  /**
   * One writer for the three held-credit decisions (hold spec §4.2). Money moves, so: the reason is
   * required BEFORE the dialog (a confirm that prints "เหตุผล: —" and then refuses is a wasted
   * decision), the dialog spells out the consequence in baht, and any 404/409 reloads the list
   * first and then says what changed — the row the operator clicked will simply not be there.
   */
  const handleHoldAction = async (hold: PartnerAiCreditHoldDto, action: AiCreditHoldAction) => {
    if(locked||holdBusyId||saving)return;
    const reason=partnerAdjustmentReason(holdReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่จัดการเครดิตที่กันไว้','error');return;}
    const token=generation.current;
    const accepted=await confirm({...aiCreditHoldConsequence(action,hold,reason),cancelLabel:'กลับไปตรวจก่อน'});
    if(!accepted||token!==generation.current)return;
    setHoldBusyId(hold.id);
    try {
      const path=action==='release'?'release':action==='charge_at_bound'?'charge-at-bound':'acknowledge-breach';
      const result=await actOnPartnerAiCreditHold(companyId,hold.id,path,reason);
      if(token!==generation.current)return;
      setHoldReason('');onChanged();
      showToast(result.action==='release'?`ปล่อยเครดิตที่กันไว้ ${satangToBaht(hold.upperBoundSatang)} แล้ว`
        :result.action==='charge_at_bound'?`บันทึกค่าใช้จ่าย ${satangToBaht(result.chargedSatang)} แล้ว`
        :'รับทราบรายการใช้เกินที่กันไว้แล้ว เปิดรับงาน AI ของส่วนนี้อีกครั้ง','success');
      setHoldBusyId(null);
      // A fresh read of the WHOLE card: released credit changes the money position too.
      await loadUsage();
    } catch (err) {
      if(token!==generation.current)return;
      setHoldBusyId(null);
      const code=apiErrorCode(err);
      showToast(apiErrorMessage(err),'error');
      if(isAiCreditHoldConflict(code))await loadUsage();
    } finally { if(token===generation.current)setHoldBusyId(null); }
  };

  const handleOcrSave = async () => {
    if (!usage||locked||saving) return;
    const reason=partnerAdjustmentReason(ocrReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่ปรับการอ่านเอกสาร','error');return;}
    const token=generation.current;
    const parsed = parseOcrMonthlyLimitInput(ocrLimitInput);
    if (!parsed.ok) {
      showToast(parsed.message, 'error');
      return;
    }
    if (usage?.ocr.config.enabled && !ocrEnabled) {
      const accepted = await confirm({
        title: 'ยืนยันปิด OCR ของบริษัทนี้',
        message: 'หลังบันทึก AI จะไม่เริ่มอ่านใบเสร็จจากเว็บ/LINE หรือรูป statement ใหม่ คำขอที่เริ่มไปแล้วจะทำจนจบ และผู้ใช้ยังอัปโหลด เปิดเอกสารเดิม และกรอกข้อมูลเองได้',
        confirmLabel: 'ปิด OCR',
        cancelLabel: 'ยังไม่ปิด',
      });
      if (!accepted||token!==generation.current) return;
    }
    if (
      ocrEnabled
      && parsed.monthlyLimit !== null
      && parsed.monthlyLimit <= (usage?.ocr.current.usedCount ?? 0)
      && parsed.monthlyLimit !== usage?.ocr.config.monthlyLimit
    ) {
      const accepted = await confirm({
        title: 'ยืนยันจำกัด OCR ตั้งแต่ตอนนี้',
        message: `เดือนนี้อ่านไปแล้ว ${(usage?.ocr.current.usedCount ?? 0).toLocaleString('th-TH')} ครั้ง หากตั้งไว้ ${parsed.monthlyLimit.toLocaleString('th-TH')} ครั้ง ระบบจะไม่อ่านเอกสารใหม่จนถึงเดือนถัดไป`,
        confirmLabel: 'ยืนยันจำนวนนี้',
        cancelLabel: 'กลับไปแก้',
      });
      if (!accepted||token!==generation.current) return;
    }
    setOcrLoading(true);
    try {
      const config = await setPartnerOcrConfig(companyId, {
        reason,
        enabled: ocrEnabled,
        // Omitted = preserved: a paid package always enforces, so its hidden choice is never re-sent.
        ...(usage.ocr.planQuota && receiptQuotaControlVisible(usage.ocr) ? { receiptQuotaEnforced: receiptQuotaMode === 'inherit' ? null : receiptQuotaMode === 'enforce' } : {}),
        monthlyLimit: parsed.monthlyLimit,
        expectedVersion: usage.ocr.config.version,
      });
      if(token!==generation.current)return;
      setUsage((previous) => previous ? { ...previous, ocr: { ...previous.ocr, config } } : previous);
      setOcrEnabled(config.enabled);
      setOcrLimitInput(config.monthlyLimit === null ? '' : String(config.monthlyLimit));
      showToast('บันทึกการตั้งค่า OCR แล้ว', 'success');
      setOcrReason('');onChanged();setOcrLoading(false);
      await loadUsage();
    } catch (err) {
      if(token!==generation.current)return;
      setOcrLoading(false);
      if (apiErrorCode(err)==='ocr_config_version_conflict') {
        showToast(OCR_CONFIG_STALE_MESSAGE, 'error');
        await loadUsage();
      } else {
        showToast(apiErrorMessage(err), 'error');
      }
    } finally {
      if(token===generation.current)setOcrLoading(false);
    }
  };

  const policyReady = !!usage && hasAiBudgetPolicy(usage);
  const statusRows = usage ? aiTabStatusRows(usage, formatThaiDate) : [];
  const images = usage?.ocr.receiptImages;
  const quotaVisible = usage ? receiptQuotaControlVisible(usage.ocr) : false;
  const savedOcrEnabled = usage?.ocr.config.enabled ?? true;
  const ocrTogglePendingMessage = ocrUnsavedToggleMessage(savedOcrEnabled, ocrEnabled);
  const spendSatang = usage?.current?.costSatang ?? 0;
  const percent = usage ? budgetPercent(spendSatang, usage.budget.effectiveSatang) : 0;
  const chat = policyReady ? usage!.budget.position.chat : null;
  const chatCap = policyReady ? usage!.budget.policy.chatCapSatang : null;
  const chatPercent = chat && chatCap ? budgetPercent(chat.spentSatang, chatCap) : 0;
  const split = policyReady && usage!.budget.policy.mode === 'SPLIT';
  const chatChanged = policyReady && chatCreditDraftChanged(usage!, chatInput);
  const deal = usage?.budget.chatCredit?.deal ?? null;
  // Open the advanced split controls only when they are what this shop actually runs on.
  const advancedOpen = policyReady && (split || usage!.budget.policy.pending !== null || !!usage!.budget.policy.invalidReason);
  const readOnlyNote = canManage
    ? 'บริษัทนี้อ่านได้อย่างเดียวตามสถานะบริษัท เปลี่ยนสถานะได้ในหมวดภาพรวม'
    : 'บัญชีของคุณดูข้อมูลได้ แต่ยังไม่มีสิทธิ์แก้การตั้งค่านี้';

  return (
    <>
      <SectionCard title="เงื่อนไขที่ใช้กับร้านนี้ตอนนี้">
        {usageLoading && <p role="status" aria-busy="true" className="flex items-center gap-2 text-sm text-gray-500"><span aria-hidden="true" className="action-loading-spinner h-4 w-4 rounded-full border-2 border-current border-t-transparent" />กำลังโหลดข้อมูล AI...</p>}
        {usageError ? (
          <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm leading-6 text-red-800">{usageError}</p>
            <button
              type="button"
              className="mangmee-btn mangmee-btn-secondary min-h-11 text-base"
              disabled={usageLoading} aria-busy={usageLoading}
              onClick={() => { setUsageError(null); void loadUsage(); }}
            >
              ลองโหลดข้อมูลอีกครั้ง
            </button>
          </div>
        ) : !usage ? (
          <div className="h-16 rounded border border-gray-100 animate-pulse" />
        ) : (
          <dl className="divide-y divide-gray-100" data-testid="ai-tab-status">
            {statusRows.map((row) => (
              <div key={row.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4" data-testid={`ai-status-${row.key}`} data-tone={row.tone}>
                <dt className="flex items-center gap-2 text-sm font-medium text-gray-600 sm:w-56 sm:shrink-0">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_TONE_CLASS[row.tone].dot}`} />
                  {row.label}
                </dt>
                <dd className={`text-base leading-6 ${STATUS_TONE_CLASS[row.tone].text}`}>
                  <span className="sr-only">{STATUS_TONE_CLASS[row.tone].label}: </span>{row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </SectionCard>

      {usage && !usageError && (<>
        <SectionCard title="เครดิต AI">
          {policyReady && chat ? (
            <div className="space-y-2" data-testid="ai-chat-credit">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-gray-700">
                  เครดิตแชตเดือนนี้{' '}
                  <span className="text-2xl font-bold tabular-nums text-gray-900">{aiBudgetCapLabel(chatCap)}</span>
                </p>
                {chatCap ? <span className={`text-xs font-medium tabular-nums ${budgetTextClass(chatPercent)}`}>{chatPercent}%</span> : null}
              </div>
              {chatCap ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full rounded-full ${budgetBarClass(chatPercent)}`} style={{ width: `${budgetBarWidth(chatPercent)}%` }} />
                </div>
              ) : null}
              <p className="text-sm text-gray-700">
                ใช้แล้ว <span className="tabular-nums">{satangToBaht(chat.spentSatang)}</span>
                {' · '}เหลือ <span className="tabular-nums">{aiBudgetAvailableLabel(chat.availableSatang)}</span>
                {chat.reservedSatang > 0 && <>{' · '}{AI_BUDGET_RESERVED_NOTE} <span className="tabular-nums">{satangToBaht(chat.reservedSatang)}</span></>}
              </p>
              <p className="text-sm text-gray-600">มาจาก: {aiChatCreditSourceText(usage, formatThaiDate)}</p>
              {deal && usage.budget.policy.chatSource === 'ADMIN' && (
                <p className="text-sm leading-6 text-gray-600">
                  ร้านนี้มีดีลขาย {satangToBaht(deal.satang)}{deal.endsAt ? ` ถึง ${formatThaiDate(deal.endsAt)}` : ''} แต่ค่าที่ผู้ดูแลตั้งมีผลก่อน ลบค่าที่ตั้งเพื่อใช้เครดิตจากดีล
                </p>
              )}
              <p className="text-xs leading-5 text-gray-500">
                เครดิตแชตใช้กับแชตและงาน AI ทั่วไป ไม่รวมการอ่านรูปใบเสร็จ นับตามเดือนไทยและเริ่มใหม่ทุกต้นเดือน
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600">ยังอ่านเครดิตแชตของร้านนี้ไม่ได้</p>
          )}

          {policyReady && (locked ? (
            <p data-testid="ai-chat-credit-read-only" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">{readOnlyNote}</p>
          ) : split ? (
            <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-700">
              ร้านนี้แยกเพดานแชตกับอ่านเอกสาร ปรับเครดิตแชตได้ในตั้งค่าขั้นสูงด้านล่าง
            </p>
          ) : (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <label className="block text-sm font-bold text-gray-700" htmlFor="ai-chat-credit-input">เครดิตแชตต่อเดือนของร้านนี้ (บาท)
                <input id="ai-chat-credit-input" className={`${inputClass} mt-1 min-h-12 text-base`} type="text" inputMode="decimal"
                  placeholder={`เว้นว่าง = ${deal ? 'ใช้เครดิตจากดีลขาย' : `ค่าเริ่มต้น ${satangToBahtInput(DEFAULT_CHAT_CREDIT_SATANG)} บาท`}`}
                  value={chatInput} disabled={saving} onChange={(e) => setChatInput(e.target.value)} />
              </label>
              <p className="text-xs leading-5 text-gray-500">
                ตั้งได้ทุกแพ็กเกจรวมร้านทดลอง · เว้นว่างเพื่อกลับไปใช้ค่าเริ่มต้นหรือเครดิตจากดีลขาย · ใส่ 0 เพื่อปิดแชต AI ของร้านนี้ · มีผลทันทีกับเดือนนี้
              </p>
              <label className="block text-base">เหตุผลที่ปรับเครดิตแชต
                <textarea aria-label="เหตุผลที่ปรับเครดิตแชต" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500}
                  value={chatReason} disabled={saving} onChange={(e) => setChatReason(e.target.value)} />
              </label>
              <button type="button" className={`${btnPrimary} min-h-12 min-w-32 text-base`} data-testid="ai-chat-credit-save"
                disabled={saving || !chatChanged} aria-busy={chatLoading} onClick={() => void handleChatSave()}>
                {chatLoading ? 'กำลังบันทึก…' : 'ตรวจเครดิตแชตก่อนบันทึก'}
              </button>
            </div>
          ))}

          {policyDraft && (
            <details className="rounded-xl border border-gray-200 bg-white px-4" open={advancedOpen}>
              <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-medium text-gray-700">
                ตั้งค่าขั้นสูง: แยกเพดานเงินของแชตกับอ่านเอกสาร
              </summary>
              <div className="pb-4">
                <AiBudgetPolicyPanel
                  usage={usage}
                  monthKey={aiBudgetCurrentMonthKey(usage)}
                  draft={policyDraft}
                  onDraft={setPolicyDraft}
                  reason={policyReason}
                  onReason={setPolicyReason}
                  saving={policyLoading}
                  busy={budgetLoading || ocrLoading || chatLoading || usageLoading}
                  canManage={canManage}
                  companyLocked={fieldsLocked}
                  onSave={() => void handlePolicySave()}
                  onCancelPending={() => void handleCancelPending()}
                />
              </div>
            </details>
          )}

          {holds && (
            <AiCreditHoldsPanel
              holds={holds}
              reason={holdReason}
              onReason={setHoldReason}
              busyId={holdBusyId}
              canEdit={holds.canManage && !holds.companyLocked && !fieldsLocked}
              disabled={saving || usageLoading}
              onAct={(hold, action) => void handleHoldAction(hold, action)}
            />
          )}
        </SectionCard>

        <SectionCard title="จำนวนอ่านรูปใบเสร็จ">
          <section className="space-y-3" aria-label="ยอดรูปใบเสร็จของร้าน" data-testid="ai-receipt-images">
            {images ? (
              <>
                <p className="text-base font-medium text-gray-900">{receiptImagesSourceText(images, formatThaiDate)}</p>
                {images.basis === 'PACKAGE_LOTS' && !images.active && (
                  <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900">
                    แพ็กเกจหมดอายุหรือถูกพัก ระบบจึงยังไม่อ่านรูปใบเสร็จของร้านนี้
                  </p>
                )}
                {receiptImageTiles(images, formatThaiDate).length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {receiptImageTiles(images, formatThaiDate).map((tile) => (
                      <div key={tile.key} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" data-testid={`ai-receipt-${tile.key}`}>
                        <p className="text-sm font-medium text-gray-600">{tile.label}</p>
                        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{tile.value}</p>
                        <p className="mt-1 text-xs leading-5 text-gray-500">{tile.note}</p>
                      </div>
                    ))}
                  </div>
                )}
                {images.additional.remaining > 0 && (
                  <p className="text-xs leading-5 text-gray-500">ยอดเพิ่มเติมใช้กับรูปใบเสร็จหน้าเดียว (JPG หรือ PNG) ไม่ใช้กับ PDF</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">ยังอ่านยอดรูปใบเสร็จของร้านนี้ไม่ได้</p>
            )}
          </section>

          <section className="space-y-3 border-t border-gray-100 pt-4" aria-labelledby="ocr-usage-title">
            <h3 id="ocr-usage-title" className="text-base font-bold text-gray-900">อ่านเอกสารเดือนนี้ ({formatThaiMonth(usage.ocr.current.monthKey)})</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm font-medium text-blue-800">อ่านแล้วทุกช่องทาง</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-blue-950">
                  {usage.ocr.current.usedCount.toLocaleString('th-TH')}<span className="ml-1 text-base font-medium">ครั้ง</span>
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-700">รวมรูป statement · เทียบกับเพดาน OCR รายเดือน</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-sm font-medium text-violet-800">ใบเสร็จที่อัปโหลดสำเร็จ</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-violet-950">
                  {usage.ocr.current.uploadedReceiptDocumentCount.toLocaleString('th-TH')}<span className="ml-1 text-base font-medium">ฉบับ</span>
                </p>
                <p className="mt-1 text-xs leading-5 text-violet-700">ไม่รวมลายเซ็น ไฟล์ที่ระบบสร้าง และหลักฐานจ่ายเงิน</p>
              </div>
            </div>
            {ocrUsageTrackingNote(usage.ocr.current.monthKey) && (
              <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                {ocrUsageTrackingNote(usage.ocr.current.monthKey)}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {usage.ocr.current.sourceCounts.map((source) => (
                <div key={source.sourceRoute} className="flex min-h-11 items-center justify-between rounded-lg bg-gray-50 px-3 text-sm">
                  <span className="text-gray-600">
                    {source.sourceRoute === 'receipt-ocr-web'
                      ? 'ใบเสร็จบนเว็บ'
                      : source.sourceRoute === 'receipt-ocr-line'
                        ? 'รูปจาก LINE ที่ AI ตรวจ'
                        : 'รูป Statement'}
                  </span>
                  <strong className="tabular-nums text-gray-900">{source.reads.toLocaleString('th-TH')}</strong>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500">
              เดือนก่อน ({formatThaiMonth(usage.ocr.previous.monthKey)}): อ่าน {usage.ocr.previous.usedCount.toLocaleString('th-TH')} ครั้ง ·
              ใบเสร็จอัปโหลด {usage.ocr.previous.uploadedReceiptDocumentCount.toLocaleString('th-TH')} ฉบับ
            </p>
          </section>

          <section className="space-y-4 border-t border-gray-100 pt-4" aria-labelledby="ocr-governance-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="ocr-governance-title" className="text-base font-bold text-gray-900">ควบคุมการอ่านเอกสารด้วย OCR</h3>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  ปิดการอ่าน หรือตั้งเพดานจำนวนครั้งต่อเดือนของร้านนี้ ครอบคลุมใบเสร็จจากเว็บ/LINE และรูป statement
                </p>
              </div>
              <div className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3">
                <EntitlementSwitch
                  checked={ocrEnabled}
                  disabled={saving || locked} aria-busy={Boolean(ocrLoading)}
                  label="เปิดให้ AI อ่านเอกสาร"
                  onClick={() => setOcrEnabled((value) => !value)}
                />
                <div>
                  <p className="text-sm font-bold text-gray-900">เปิดให้ AI อ่านเอกสาร</p>
                  <p className={`text-xs font-semibold ${savedOcrEnabled ? 'text-green-700' : 'text-red-700'}`}>
                    {savedOcrEnabled ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'}
                  </p>
                </div>
              </div>
            </div>

            {ocrTogglePendingMessage && (
              <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
                {ocrTogglePendingMessage}
              </p>
            )}

            {!savedOcrEnabled && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                OCR จะไม่อ่านเอกสารใหม่ แต่ผู้ใช้ยังอัปโหลด เปิดเอกสารเดิม และกรอกข้อมูลเองได้ตามปกติ
              </div>
            )}

            {quotaVisible && (
              <div className="space-y-2">
                <label htmlFor="receipt-quota-mode" className="block text-sm font-bold text-gray-700">เมื่อรูปของแพ็กเกจทดลองหรือแพ็กเกจที่ทีมงานตั้งให้ครบ</label>
                <select id="receipt-quota-mode" className={`${inputClass} min-h-12 text-base`} value={receiptQuotaMode}
                  onChange={(event) => setReceiptQuotaMode(event.target.value)}
                  disabled={saving || locked || !usage.ocr.planQuota}>
                  <option value="inherit">ตามค่าเริ่มต้นของระบบ ({usage.ocr.planQuota?.defaultEnforced ? 'หยุดอ่าน' : 'นับอย่างเดียว'})</option>
                  <option value="enforce">บังคับ — ครบแล้วหยุดอ่านใบใหม่</option>
                  <option value="observe">นับอย่างเดียว — ยังอ่านต่อได้เมื่อครบ</option>
                </select>
                <p className="text-sm leading-6 text-gray-600" data-testid="receipt-quota-effective">
                  {usage.ocr.planQuota
                    ? `สถานะที่บันทึก: ${usage.ocr.planQuota.enforced ? 'บังคับโควตา' : 'นับอย่างเดียว'} · ${usage.ocr.planQuota.source === 'COMPANY' ? 'การตั้งค่าบริษัท' : 'ค่าเริ่มต้นของระบบ'}`
                    : 'ยังโหลดสถานะการบังคับโควตาไม่ได้'}
                </p>
              </div>
            )}
            {!quotaVisible && images?.basis === 'PACKAGE_LOTS' && (
              <p className="text-sm leading-6 text-gray-600" data-testid="receipt-quota-effective">
                แพ็กเกจที่ชำระเงินหยุดอ่านเมื่อรูปหมดหรือแพ็กเกจหมดอายุเสมอ จึงไม่มีตัวเลือกนับอย่างเดียว
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className="mb-1 block text-sm font-bold text-gray-700" htmlFor="ocr-monthly-limit">
                  เพดาน OCR รายเดือนของร้านนี้ (ครั้ง)
                </label>
                <input
                  id="ocr-monthly-limit"
                  className={`${inputClass} min-h-12 text-base`}
                  type="number"
                  min={1}
                  max={1_000_000}
                  step={1}
                  inputMode="numeric"
                  placeholder="เว้นว่าง = ไม่ได้ตั้งเพดาน"
                  value={ocrLimitInput}
                  onChange={(event) => setOcrLimitInput(event.target.value)}
                  disabled={saving || locked} aria-busy={Boolean(ocrLoading)}
                />
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  ถ้าตั้งไว้ ระบบหยุดอ่านเอกสารทุกชนิดเมื่อครบจำนวนนี้ แม้แพ็กเกจยังมีรูปเหลือ · นับทุกครั้งที่ส่งเอกสารให้ OCR แม้อ่านไม่สำเร็จ
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  เปิด OCR: {savedOcrEnabled ? 'เปิด' : 'ปิด'} → {ocrEnabled ? 'เปิด' : 'ปิด'} · เพดาน: {usage.ocr.config.monthlyLimit ?? 'ไม่ได้ตั้ง'} → {ocrLimitInput.trim() || 'ไม่ได้ตั้ง'} ครั้ง/เดือน
                </p>
              </div>
            </div>
            <label className="block text-base">เหตุผลที่ปรับการอ่านเอกสาร
              <textarea aria-label="เหตุผลที่ปรับการอ่านเอกสาร" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500} value={ocrReason} disabled={saving||locked} onChange={e=>setOcrReason(e.target.value)} />
            </label>
            <button
              type="button"
              className={`${btnPrimary} min-h-12 min-w-32 text-base`}
              disabled={saving || locked} aria-busy={Boolean(ocrLoading)}
              onClick={() => void handleOcrSave()}
            >
              {ocrLoading ? 'กำลังบันทึก…' : 'บันทึก OCR'}
            </button>
          </section>
        </SectionCard>

        <SectionCard title="เพดานความปลอดภัยค่า AI ต่อเดือน (ทุกช่องทางรวม)">
          <div className="space-y-2" data-testid="ai-safety-ceiling">
            <p className="text-sm leading-6 text-gray-600">
              เพดานนี้กันค่าใช้ AI ทุกช่องทางของร้านไม่ให้เกินต่อเดือน ไม่ใช่เครดิตของร้าน — ถ้าถึงเพดาน ระบบหยุดเรียก AI ทุกช่องทางจนขึ้นเดือนใหม่
            </p>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-gray-700">
                ใช้ทุกช่องทางเดือนนี้{' '}
                <span className="font-semibold tabular-nums text-gray-900">{satangToBaht(spendSatang)}</span>
                {' จากเพดาน '}
                <span className="tabular-nums">{satangToBaht(usage.budget.effectiveSatang)}</span>
                {usage.budget.overrideSatang === null ? ' (ค่ากลางของระบบ)' : ' (ตั้งเฉพาะร้านนี้)'}
              </p>
              <span className={`text-xs font-medium tabular-nums ${budgetTextClass(percent)}`}>{percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full rounded-full ${budgetBarClass(percent)}`} style={{ width: `${budgetBarWidth(percent)}%` }} />
            </div>
          </div>
          {locked ? (
            <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">{readOnlyNote}</p>
          ) : (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <label className="block text-base">เหตุผลที่ปรับเพดานความปลอดภัย
                <textarea aria-label="เหตุผลที่ปรับเพดานความปลอดภัย" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500} value={budgetReason} disabled={saving} onChange={e=>setBudgetReason(e.target.value)} />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 grow basis-48">
                  <label className="mb-1 block text-sm font-bold text-gray-700" htmlFor="ai-monthly-budget">เพดานของร้านนี้ (บาท)</label>
                  <input
                    id="ai-monthly-budget"
                    className={`${inputClass} min-h-11 text-base`}
                    type="text"
                    inputMode="decimal"
                    placeholder={satangToBahtInput(usage.budget.defaultSatang)}
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    disabled={saving} aria-busy={Boolean(budgetLoading)}
                  />
                </div>
                <button
                  type="button"
                  className={`${btnPrimary} min-h-11 text-base`}
                  disabled={saving} aria-busy={Boolean(budgetLoading)}
                  onClick={() => void handleBudgetSave()}
                >
                  {budgetLoading ? 'กำลังบันทึก…' : 'ตรวจเพดานก่อนบันทึก'}
                </button>
              </div>
              <p className="break-words text-sm text-gray-600">เพดาน: {usage.budget.overrideSatang === null ? 'ค่ากลางของระบบ' : satangToBaht(usage.budget.overrideSatang)} → {budgetInput.trim() ? `฿${budgetInput}` : 'ค่ากลางของระบบ'}</p>
              <p className="text-xs text-gray-500">
                เว้นว่างเพื่อใช้ค่ากลาง {satangToBaht(usage.budget.defaultSatang)} ตั้งได้ไม่เกิน {satangToBaht(usage.budget.ceilingSatang)} · การปรับเพดานไม่เปลี่ยนเครดิตแชต
              </p>
            </div>
          )}
        </SectionCard>

        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">รายละเอียดค่าใช้ AI เดือนนี้</summary>
          <div className="space-y-4 pt-3">
            <p className="text-sm text-gray-600">
              {usage.current
                ? `${formatThaiMonth(usage.current.monthKey)} · ${satangToBaht(usage.current.costSatang)} · ${usage.current.callCount} ครั้ง · ${usage.current.inputTokens.toLocaleString('th-TH')} in / ${usage.current.outputTokens.toLocaleString('th-TH')} out tokens`
                : 'เดือนนี้ยังไม่มีการใช้งาน AI'}
            </p>
            <p className="text-sm text-gray-600">
              {usage.previous
                ? <>เดือนก่อน ({formatThaiMonth(usage.previous.monthKey)}): <span className="tabular-nums">{satangToBaht(usage.previous.costSatang)}</span> · {usage.previous.callCount} ครั้ง</>
                : 'เดือนก่อนยังไม่มีค่าใช้จ่าย AI'}
            </p>

            <AiUsageBreakdown usage={usage} />

            {usage.topTags.length > 0 && (
              <div className="overflow-x-auto">
                {/* Five columns cannot be read at 390px; scroll inside this container, never the page. */}
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-4 font-medium">ประเภทการใช้งาน</th>
                      <th className="py-2 pr-4 font-medium">ค่าใช้จ่าย</th>
                      <th className="py-2 pr-4 font-medium">จำนวนครั้ง</th>
                      <th className="py-2 pr-4 font-medium">in / out tokens</th>
                      <th className="py-2 font-medium">ต้นทุน cache</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.topTags.map((row) => (
                      <tr key={row.tag} className="border-b border-gray-100">
                        <td className="py-2.5 pr-4 font-mono text-gray-700">{row.tag}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-800">{satangToBaht(row.costSatang)}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-800">{row.calls}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-600">
                          {row.inputTokens.toLocaleString('th-TH')} / {row.outputTokens.toLocaleString('th-TH')}
                        </td>
                        <td className="py-2.5 tabular-nums text-gray-600">{aiCacheCostLabel(row.cacheCostSatang)}</td>
                      </tr>
                    ))}
                    {/* Optional chaining for the same version skew: a pre-D1 response has no remainder row. */}
                    {(usage.otherTags?.tags ?? 0) > 0 && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td className="py-2.5 pr-4 text-gray-700">อื่น ๆ ({usage.otherTags.tags.toLocaleString('th-TH')} ประเภท)</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-800">{satangToBaht(usage.otherTags.costSatang)}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-800">{usage.otherTags.calls}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-600">
                          {usage.otherTags.inputTokens.toLocaleString('th-TH')} / {usage.otherTags.outputTokens.toLocaleString('th-TH')}
                        </td>
                        <td className="py-2.5 tabular-nums text-gray-600">{aiCacheCostLabel(usage.otherTags.cacheCostSatang)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </>)}
      {confirmDialog}
    </>
  );
}

// -- main page

// -- plan limits & usage term (P29)

const PLAN_TERM_CHIP_CLASS: Record<PlanTermChipTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
};

function PlanTermBadge({ chip }: { chip: PlanTermChip }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PLAN_TERM_CHIP_CLASS[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

function PlanTermSection({ companyId, companyStatus, fieldsLocked, showToast }: {
  companyId: string;
  companyStatus: PartnerStatus;
  fieldsLocked: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
}) {
  // undefined = still loading; null = grandfathered company with no term row.
  const [term, setTerm] = useState<CompanyPlanTermDto | null | undefined>(undefined);
  const [sourceVersion,setSourceVersion]=useState<string|null>(null);
  const [reason,setReason]=useState('');
  const [renewReason,setRenewReason]=useState('');
  const [historyRevision,setHistoryRevision]=useState(0);
  const [counts,setCounts]=useState({branches:0,members:0});
  const [uncertain,setUncertain]=useState(false);
  const pending=useRef<{kind:'set';body:SetCompanyPlanTermBody}|{kind:'renew';body:RenewCompanyPlanTermBody}|null>(null);
  const generation=useRef(0);
  const applyResult=(result:CompanyPlanTermViewDto)=>{setTerm(result.term);setSourceVersion(result.sourceVersion??null);
    if(result.activeBranches!==undefined&&result.activeMembers!==undefined)setCounts({branches:result.activeBranches,members:result.activeMembers});};
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewDays, setRenewDays] = useState('30');
  const [renewing, setRenewing] = useState(false);
  const [endingWarmup, setEndingWarmup] = useState(false);

  const [tierKey, setTierKey] = useState<PlanTierKey>('STARTER_249');
  const [branchLimit, setBranchLimit] = useState('');
  const [employeeLimit, setEmployeeLimit] = useState('');
  const [monthlySlipLimit, setMonthlySlipLimit] = useState('');
  const [warningDays, setWarningDays] = useState('7');
  const [termDays, setTermDays] = useState('30');

  const load = async () => {
    const token=++generation.current;
    setError(null);
    setTerm(undefined);
    setSourceVersion(null);
    try {
      const result=await getPartnerPlanTerm(companyId);if(token!==generation.current)return;
      applyResult(result);
      setError(null);
    } catch (err) {
      if(token!==generation.current)return;
      const e = err as Error & { status?: number };
      setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูแพ็กเกจของบริษัทนี้' : apiErrorMessage(err));
    }
  };

  useEffect(() => {
    pending.current=null;setUncertain(false);setEditing(false);setRenewOpen(false);
    void load();
    return ()=>{generation.current++;};
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTierPreset = (key: PlanTierKey) => {
    const preset = PLAN_TIER_PRESETS[key];
    setTierKey(key);
    setBranchLimit(String(preset.branchLimit));
    setEmployeeLimit(String(preset.employeeLimit));
    setMonthlySlipLimit(String(preset.monthlySlipLimit));
  };

  const startEditing = () => {
    if (term) {
      setTierKey(term.tierKey);
      setBranchLimit(String(term.branchLimit));
      setEmployeeLimit(String(term.employeeLimit));
      setMonthlySlipLimit(String(term.monthlySlipLimit));
      setWarningDays(String(term.warningDays));
    } else {
      // First-time setup starts from STARTER for 30 days (§4A) — every field stays editable.
      applyTierPreset('STARTER_249');
      setWarningDays('7');
      setTermDays('30');
    }
    setReason('');
    setEditing(true);
  };

  const handleSave = async () => {
    if(pending.current){await sendPending();return;}
    const branch = parseLimitInput(branchLimit);
    const employee = parseLimitInput(employeeLimit);
    const slips = parseLimitInput(monthlySlipLimit);
    const warn = parseLimitInput(warningDays);
    const days = parseDaysInput(termDays);
    if (branch === null || employee === null || slips === null || warn === null) {
      showToast('จำนวนสาขา พนักงาน สลิป และวันแจ้งเตือน ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป', 'error');
      return;
    }
    if (!term && days === null) {
      showToast('จำนวนวันที่ใช้งานต้องเป็นจำนวนเต็มมากกว่า 0', 'error');
      return;
    }
    if(!sourceVersion||!partnerAdjustmentReason(reason)){showToast('กรุณาระบุเหตุผล และโหลดข้อมูลล่าสุดก่อนบันทึก','error');return;}
    pending.current??={kind:'set',body:{commandId:crypto.randomUUID(),expectedVersion:sourceVersion,reason,
      tierKey,branchLimit:branch,employeeLimit:employee,monthlySlipLimit:slips,warningDays:warn,
      ...(term?{}:{termDays:days??undefined})}};
    await sendPending();
  };

  const handleRenew = async () => {
    if(pending.current){await sendPending();return;}
    const days=parseDaysInput(renewDays);
    if(days===null||!sourceVersion||!partnerAdjustmentReason(renewReason)){showToast('กรุณาระบุจำนวนวันและเหตุผลก่อนต่ออายุ','error');return;}
    pending.current={kind:'renew',body:{commandId:crypto.randomUUID(),expectedVersion:sourceVersion,reason:renewReason,days}};
    await sendPending();
  };

  const sendPending=async()=>{
    const command=pending.current;if(!command||saving||renewing)return;
    const token=generation.current;setSaving(command.kind==='set');setRenewing(command.kind==='renew');
    try{
      const result=command.kind==='set'?await setPartnerPlanTerm(companyId,command.body):await renewPartnerPlanTerm(companyId,command.body);
      if(token!==generation.current)return;
      applyResult(result);pending.current=null;setUncertain(false);setEditing(false);setRenewOpen(false);setHistoryRevision(n=>n+1);
      showToast(result.replayed?'คำขอเดิมบันทึกแล้ว แสดงแพ็กเกจล่าสุดของร้าน':'บันทึกการปรับแพ็กเกจและวันใช้งานแล้ว','success');
    }catch(err){
      if(token!==generation.current)return;
      const status=(err as {status?:number}).status;
      if(isAmbiguousCommandFailure(status)){setUncertain(true);showToast('ยังยืนยันผลไม่ได้ กดลองคำขอเดิมได้ ระบบจะไม่เพิ่มวันซ้ำ','error');}
      else{pending.current=null;setUncertain(false);showToast(apiErrorMessage(err),'error');
        if(status===403){setTerm(undefined);setSourceVersion(null);setError('คุณไม่มีสิทธิ์แก้ไขแพ็กเกจของบริษัทนี้');setEditing(false);setRenewOpen(false);}
        else if(status===409){setSaving(false);setRenewing(false);setEditing(false);setRenewOpen(false);await load();setHistoryRevision(n=>n+1);}}
    }finally{if(token===generation.current){setSaving(false);setRenewing(false);}}
  };

  // P10-L §9 "ตรวจแล้ว". The warm-up bounds the damage of a shop nobody has looked at; once an
  // operator HAS looked, keeping it on is only friction. Shown only while there is one to lift.
  const handleEndWarmup = async () => {
    setEndingWarmup(true);
    try {
      await endPartnerPlanTermWarmup(companyId);
      await load();
      showToast('ปลดโควตาอุ่นเครื่องแล้ว ร้านใช้เพดานของแพ็กเกจได้เต็มจำนวน', 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setEndingWarmup(false);
    }
  };

  // Renew restores a company the sweep disabled, but never one an admin disabled by hand (§4C).
  const adminDisabled = companyStatus === 'DISABLED' && !term?.termDisabledAt;
  const previewDays = parseDaysInput(renewDays);
  const warmupActive = Boolean(term?.warmupUntil && new Date(term.warmupUntil).getTime() > Date.now());
  const termState = term ? planTermState(term, new Date(), companyStatus) : null;

  return (
    <><SectionCard title="แพ็กเกจและอายุการใช้งาน">
      {uncertain&&<div role="alert" className="rounded border border-amber-300 p-3 text-base"><p>ยังยืนยันผลคำขอเดิมไม่ได้ ตรวจคำขอเดิมก่อนเริ่มรายการใหม่</p><button type="button" className={`${btnPrimary} mt-2 min-h-11`} disabled={saving||renewing} aria-busy={Boolean(saving || renewing)} onClick={()=>void sendPending()}>ตรวจและลองคำขอเดิม</button></div>}
      {error ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-600">{error}</p>
          {/* Never disabled: `term === undefined` also holds after a failed read. load() clears `error`
              before it reads, so while a read is in flight the skeleton below replaces this block. */}
          <button type="button" className={btnSecondary} onClick={() => void load()}>
            ลองโหลดแพ็กเกจอีกครั้ง
          </button>
        </div>
      ) : term === undefined ? (
        <div className="h-16 animate-pulse rounded border border-gray-100" />
      ) : (
        <>
          {term === null && !editing && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                ลูกค้าเดิม — ยังไม่กำหนดแพ็กเกจ/อายุการใช้งาน (ใช้ได้ไม่จำกัด)
              </p>
              <button type="button" className={btnPrimary} onClick={startEditing} disabled={fieldsLocked||uncertain||!sourceVersion}>
                ตั้งแพ็กเกจและอายุการใช้งาน
              </button>
            </div>
          )}

          {term !== null && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlanTermBadge chip={planTermStatusChip(term, companyStatus)} />
                {termState !== 'NO_PACKAGE' && <span className="text-sm font-medium text-gray-900">{PLAN_TIER_PRESETS[term.tierKey].labelTh}</span>}
              </div>

              {termState !== 'NO_PACKAGE' && <><p className="text-sm text-gray-700">{planTermLimitsText(term)}</p>
              <p className="text-base text-gray-600">{term.paidPlan ? 'จำนวนใบเสร็จที่ใช้ได้จริง ดูจากหน้าการชำระเงินของบริษัท' : 'จำนวนใบเสร็จเป็นโควตาต่อเดือน การอ่านยังขึ้นกับการตั้งค่า AI ของร้าน'}</p></>}
              {term.effectiveCapacity?.temporary&&<p className="rounded-lg border border-emerald-300 p-3 text-base">สิทธิ์ชั่วคราว: {PLAN_TIER_PRESETS[term.effectiveCapacity.tierKey].labelTh} · {term.effectiveCapacity.branchLimit} สาขา · {term.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {formatThaiDateTime(term.effectiveCapacity.temporary.expiresAt)}</p>}

              {warmupActive && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="flex-1 text-sm text-amber-900">
                    ช่วงอุ่นเครื่อง อ่านรูปได้ {term.warmupSlipLimit ?? '—'} ครั้ง จนถึง {formatThaiDateTime(term.warmupUntil!)}
                  </p>
                  <button type="button" className={btnSecondary} onClick={handleEndWarmup} disabled={endingWarmup} aria-busy={Boolean(endingWarmup)}>
                    {endingWarmup ? 'กำลังปลด...' : 'ตรวจแล้ว'}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {termState === 'NO_PACKAGE' ? (
                  <>
                    <ReadOnlyField label="แพ็กเกจ" value="ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ" />
                    <ReadOnlyField label="เปิดร้านเมื่อ" value={formatDate(term.termStartAt)} />
                  </>
                ) : (
                  <>
                    <ReadOnlyField label="เริ่มใช้งาน" value={formatDate(term.termStartAt)} />
                    <ReadOnlyField label="ครบกำหนด" value={formatDate(term.termEndsAt)} />
                  </>
                )}
                <ReadOnlyField label="แจ้งเตือนล่วงหน้า" value={`${term.warningDays} วัน`} />
                <ReadOnlyField
                  label="ต่ออายุแล้ว"
                  value={term.renewCount === 0 ? 'ยังไม่เคยต่ออายุ' : `${term.renewCount} ครั้ง — ล่าสุด ${formatDate(term.lastRenewedAt)}`}
                />
              </div>

              {!editing && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {term.paidPlan ? <Link className={btnSecondary} href={`/system/billing/companies/${encodeURIComponent(companyId)}/plan-adjustments`}>ปรับแพ็กเกจชั่วคราวและดูประวัติ</Link> : <button type="button" className={btnSecondary} onClick={startEditing} disabled={fieldsLocked||uncertain||!sourceVersion}>
                    แก้ไขแพ็กเกจ
                  </button>}
                  {/* Deliberately not gated by fieldsLocked: renewing a company the expiry sweep
                      disabled is the recovery path (§4C), so it has to stay reachable while
                      DISABLED. The dialog warns when the disable came from an admin instead. */}
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={uncertain||!sourceVersion}
                    onClick={() => { setRenewDays('30'); setRenewReason(''); setRenewOpen(true); }}
                  >
                    ต่ออายุ
                  </button>
                </div>
              )}
            </div>
          )}

          {editing && (
            <div className="mt-2 space-y-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">แพ็กเกจ</label>
                <ThemedSelect
                  className={inputClass}
                  value={tierKey}
                  disabled={saving||uncertain}
                  onChange={(e) => applyTierPreset(e.target.value as PlanTierKey)}
                >
                  {(Object.keys(PLAN_TIER_PRESETS) as PlanTierKey[]).map((key) => (
                    <option key={key} value={key}>{PLAN_TIER_PRESETS[key].labelTh}</option>
                  ))}
                </ThemedSelect>
                <p className="mt-1 text-xs text-gray-500">
                  เลือกแพ็กเกจแล้วระบบจะเติมโควตาให้ ปรับรายช่องได้ โดยไม่เปลี่ยนเมนูที่บริษัทใช้งาน
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="plan-branchLimit" className="mb-1 block text-xs text-gray-500">จำนวนสาขา</label>
                  <input id="plan-branchLimit" className={inputClass} inputMode="numeric" value={branchLimit} disabled={saving||uncertain}
                    onChange={(e) => setBranchLimit(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="plan-employeeLimit" className="mb-1 block text-xs text-gray-500">จำนวนพนักงาน</label>
                  <input id="plan-employeeLimit" className={inputClass} inputMode="numeric" value={employeeLimit} disabled={saving||uncertain}
                    onChange={(e) => setEmployeeLimit(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="plan-monthlySlipLimit" className="mb-1 block text-xs text-gray-500">สลิปต่อเดือน</label>
                  <input id="plan-monthlySlipLimit" className={inputClass} inputMode="numeric" value={monthlySlipLimit} disabled={saving||uncertain}
                    onChange={(e) => setMonthlySlipLimit(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-warningDays" className="mb-1 block text-xs text-gray-500">แจ้งเตือนล่วงหน้า (วัน)</label>
                  <input id="plan-warningDays" className={inputClass} inputMode="numeric" value={warningDays} disabled={saving||uncertain}
                    onChange={(e) => setWarningDays(e.target.value)} />
                </div>
                {!term && (
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">จำนวนวันที่ใช้งาน</label>
                    <input className={inputClass} inputMode="numeric" value={termDays} disabled={saving||uncertain}
                      onChange={(e) => setTermDays(e.target.value)} />
                    <p className="mt-1 text-xs text-gray-500">นับจากเวลาที่บันทึก แก้ไขวันหมดอายุภายหลังได้ด้วยการต่ออายุ</p>
                  </div>
                )}
              </div>
              <label className="block text-base">เหตุผลที่ปรับแพ็กเกจ<textarea aria-label="เหตุผลที่ปรับแพ็กเกจ" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500} value={reason} disabled={saving||uncertain} onChange={e=>setReason(e.target.value)} /></label>
              <div className="rounded border border-blue-200 bg-white p-3 text-base" aria-live="polite">
                <p className="font-medium">การเปลี่ยนแปลง: ค่าเดิม → ค่าใหม่</p>
                {[
                  ['แพ็กเกจโควตา', term ? PLAN_TIER_PRESETS[term.tierKey].labelTh : 'ยังไม่กำหนด', PLAN_TIER_PRESETS[tierKey].labelTh],
                  ['สาขา', term?.branchLimit ?? 'ไม่จำกัด', branchLimit],
                  ['พนักงาน', term?.employeeLimit ?? 'ไม่จำกัด', employeeLimit],
                  ['สลิปต่อเดือน', term?.monthlySlipLimit ?? 'ไม่จำกัด', monthlySlipLimit],
                  ['แจ้งเตือนล่วงหน้า (วัน)', term?.warningDays ?? 'ยังไม่กำหนด', warningDays],
                ].filter(([, before, after]) => String(before) !== String(after)).map(([label, before, after]) => (
                  <p key={label}>{label}: {before} → {after || 'ยังไม่ได้กรอก'}</p>
                ))}
                <p className="mt-2">ใช้อยู่ {counts.branches} สาขา · {counts.members} ผู้ใช้ รวมเจ้าของร้าน</p><p className="mt-1 text-gray-600">ข้อมูลและผู้ใช้เดิมยังอยู่ หากเกินจำนวนใหม่จะเพิ่มไม่ได้จนกว่าจะมีที่ว่าง สิทธิ์เมนูคงเดิม</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className={btnPrimary} onClick={handleSave} disabled={saving} aria-busy={Boolean(saving)}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setEditing(false)} disabled={saving||uncertain}>
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {term && (
        <Modal
          open={renewOpen}
          title="ต่ออายุการใช้งาน"
          size="sm"
          onClose={() => {if(!renewing)setRenewOpen(false);}}
          footer={(
            <>
              <button type="button" className={btnSecondary} onClick={() => setRenewOpen(false)} disabled={renewing}>
                ยกเลิก
              </button>
              <button type="button" className={btnPrimary} onClick={handleRenew} disabled={renewing} aria-busy={Boolean(renewing)}>
                {renewing ? 'กำลังต่ออายุ...' : uncertain ? 'ตรวจและลองคำขอเดิม' : 'ต่ออายุ'}
              </button>
            </>
          )}
        >
          <div className="space-y-3">
            {uncertain&&<p role="alert" className="rounded border border-amber-300 p-3 text-base">ยังยืนยันผลไม่ได้ กดลองคำขอเดิมได้ ระบบจะไม่เพิ่มวันซ้ำ</p>}
            <div>
              <label className="mb-1 block text-base text-gray-600">จำนวนวันที่ต่อ</label>
              <input className={inputClass} inputMode="numeric" value={renewDays} disabled={renewing||uncertain}
                onChange={(e) => setRenewDays(e.target.value)} />
            </div>
            <p className="text-sm text-gray-600">
              {previewDays === null
                ? 'กรุณากรอกจำนวนวันเป็นจำนวนเต็มมากกว่า 0'
                : `ครบกำหนด: ${formatDate(term.termEndsAt)} → ${formatDate(renewedEndsAt(term.termEndsAt, previewDays).toISOString())}`}
            </p>
            <label className="block text-base">เหตุผลที่ต่ออายุ<textarea aria-label="เหตุผลที่ต่ออายุ" className={`${inputClass} mt-1 min-h-20 text-base`} maxLength={500} value={renewReason} disabled={renewing||uncertain} onChange={e=>setRenewReason(e.target.value)} /></label>
            {termState === 'NO_PACKAGE' ? (
              <div role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ การต่ออายุ = ให้วันใช้งานฟรี และเปิดสิทธิ์ทดลองใช้: ให้ AI อ่านใบเสร็จ 15 ใบ/เดือน, เครดิตแชตเริ่มต้น, เมนูแพ็กเกจเริ่มต้น, ใบที่อ่านไปยกยอดได้ไม่เกิน 15 ใบเมื่อซื้อครั้งแรก และหน้าจอของลูกค้าจะเรียกช่วงนี้ว่า "ช่วงทดลอง" — ไม่มีการเรียกเก็บเงิน
              </div>
            ) : (
              <p className="text-base text-gray-600">ต่ออายุการใช้งานโดยผู้ดูแล ไม่ใช่การซื้อแพ็กเกจ ไม่มีการเรียกเก็บเงินหรือเพิ่มใบเสร็จจากรายการนี้</p>
            )}
            {adminDisabled && (
              <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                บริษัทนี้ถูกปิดโดยแอดมิน การต่ออายุจะไม่เปิดใช้งานอัตโนมัติ
              </div>
            )}
          </div>
        </Modal>
      )}
    </SectionCard>
    <details className="rounded-xl border border-gray-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 text-gray-600">ดูประวัติการปรับแพ็กเกจและวันใช้งาน</summary><PartnerPlanAdjustmentHistory key={`${companyId}-${historyRevision}`} companyId={companyId} /></details></>
  );
}

/**
 * P10-L §8. One shop's story, read straight from the server's assembly of rows that already exist.
 * Rendered as a plain list on purpose: this is answered while somebody is on the phone.
 */
function ShopTimelineSection({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<PartnerTimelineEntryDto[] | null>(null);
  const [reload,setReload]=useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);setError(null);
    void (async () => {
      try {
        const result = await getPartnerTimeline(companyId);
        if (!cancelled) setEntries(result.entries);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (!cancelled) setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูประวัติร้านนี้' : apiErrorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, [companyId,reload]);

  return (
    <SectionCard title="ประวัติร้าน">
      <button type="button" className="mangmee-btn mangmee-btn-secondary mb-3 min-h-11 text-base" onClick={()=>{setEntries(null);setError(null);setReload(n=>n+1);}}>โหลดประวัติร้านล่าสุด</button>
      {error ? (
        <p role="alert" className="text-base text-red-600">{error}</p>
      ) : entries === null ? (
        <div className="h-16 animate-pulse rounded border border-gray-100" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีเหตุการณ์ที่บันทึกไว้</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={`${entry.kind}-${entry.at ?? index}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-40 shrink-0 text-xs text-gray-500">
                {entry.at ? formatThaiDateTime(entry.at) : 'ตอนนี้'}
              </span>
              <span className={`text-base ${entry.kind === 'ai_refusal' ? 'font-medium text-amber-700' : 'text-gray-900'}`}>
                {entry.label}
              </span>
              {entry.detail && <span className="text-base text-gray-600">{entry.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/**
 * P10-L §8 / SEC-05. The OA runs webhook-only, so an operator cannot type a reply from the LINE OA
 * app at all — this box is the whole answer path for "ติดต่อเจ้าหน้าที่". The server bounds it,
 * fences its links to our own domains, signs it with the operator's name and audits its text; the
 * confirm step here exists because a push cannot be unsent.
 */
function ShopMessageSection({ companyId, supportRequestId, supportAskerRef, showToast }: {
  companyId: string;
  /** The support request this visit came to answer, from the inbox's "เปิดหน้าร้าน" link. */
  supportRequestId?: string;
  supportAskerRef?: string;
  showToast: (message: string, variant: 'success' | 'error') => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const message = text.trim();
    if (!message) return;
    const accepted = await confirm({
      title: 'ส่งข้อความถึงร้าน',
      message: supportRequestId
        ? `ส่งข้อความนี้เข้าไลน์ของเจ้าของร้านและผู้ที่เปิดคำขอ ใช่หรือไม่\n\n${message}`
        : `ส่งข้อความนี้เข้าไลน์ของเจ้าของร้าน ใช่หรือไม่\n\n${message}`,
      confirmLabel: 'ส่งข้อความ',
      variant: 'primary',
    });
    if (!accepted) return;
    setSending(true);
    try {
      const result = await sendPartnerLineMessage(companyId, { text: message, ...(supportRequestId ? { supportRequestId } : {}) });
      if (result.delivered === 0) {
        // Not an error the operator caused, but they must not walk away thinking they answered.
        showToast('ยังไม่ได้ส่ง เพราะเจ้าของร้านยังไม่ได้ผูก LINE', 'error');
      } else {
        showToast('ส่งข้อความให้ร้านแล้ว', 'success');
        setText('');
      }
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <SectionCard title="ส่งข้อความถึงร้าน">
      {confirmDialog}
      <div className="space-y-2">
        {/* Which conversation this box is answering. §3 PDPA: the same hash fragment the inbox
            prints under "รหัสผู้ขอ", so the two pages name one person without a LINE id or a LINE
            display name ever reaching an operator screen. */}
        {supportRequestId && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
            ตอบถึง: ผู้ขอ {supportAskerRef ?? '—'} · ระบบจะทำเครื่องหมายว่าตอบแล้วให้อัตโนมัติ
          </p>
        )}
        <textarea
          aria-label="ข้อความถึงร้าน"
          rows={3}
          maxLength={PARTNER_LINE_MESSAGE_MAX_LENGTH}
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          placeholder="เช่น ได้รับเรื่องแล้วนะคะ ทีมงานกำลังตรวจสอบให้ค่ะ"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none disabled:bg-gray-50"
        />
        <p className="text-xs text-gray-500">
          {supportRequestId
            ? 'ส่งถึงเจ้าของร้านที่ผูก LINE ไว้ และผู้ที่เปิดคำขอนี้ '
            : 'ส่งถึงเจ้าของร้านที่ผูก LINE ไว้ '}
          ระบบจะแนบชื่อผู้ส่งให้อัตโนมัติ ใส่ลิงก์ได้เฉพาะเว็บของเราและ LIFF
          ({text.trim().length}/{PARTNER_LINE_MESSAGE_MAX_LENGTH})
        </p>
        <button type="button" className={btnPrimary} onClick={handleSend} disabled={sending || !text.trim()} aria-busy={Boolean(sending)}>
          {sending ? 'กำลังส่ง...' : 'ส่งข้อความ'}
        </button>
      </div>
    </SectionCard>
  );
}

const COMPANY_VIEWS = [{key:'overview',label:'ภาพรวม'}, {key:'members',label:'สมาชิก'}, {key:'package',label:'แพ็กเกจและฟีเจอร์'}, {key:'ai',label:'เครดิต AI และอ่านรูป'}, {key:'contact',label:'ติดต่อและประวัติ'}] as const;

export default function PartnerDetailPage({ companyId, canManageMembers = false, canEditIdentity = false, canManageReportLabels = false, isPlatformCompany = false, supportRequestId, supportAskerRef }: {
  companyId: string;
  canManageMembers?: boolean;
  /** F19: the API's PATCH …/identity gates on this; hide the button rather than let it 403. */
  canEditIdentity?: boolean;
  canManageReportLabels?: boolean;
  isPlatformCompany?: boolean;
  /** From `?support=`/`?asker=` on the support inbox's "เปิดหน้าร้าน" link — see the route file. */
  supportRequestId?: string;
  supportAskerRef?: string;
}) {
  const searchParams=useSearchParams();
  const requestedView=searchParams.get('view');
  const view=COMPANY_VIEWS.some(item=>item.key===requestedView)?requestedView!:(supportRequestId?'contact':'overview');
  const [visited,setVisited]=useState<string[]>([view]);
  useEffect(()=>{setVisited(old=>old.includes(view)?old:[...old,view]);},[view]);
  const opened=(key:string)=>view===key||visited.includes(key);
  const viewUrl=(key:string)=>{const params=new URLSearchParams(searchParams.toString());params.set('view',key);return `/system/partners/${encodeURIComponent(companyId)}?${params}`;};
  const toast = useToast();
  const generation=useRef(0);
  const [aiHistoryRefresh,setAiHistoryRefresh]=useState(0);
  const [aiModelReason,setAiModelReason]=useState('');
  const {confirm:confirmAiModel,confirmDialog:aiModelConfirmDialog}=useConfirm();
  const [detail, setDetail] = useState<PartnerCompanyDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  function showToast(message: string, variant: 'success' | 'error') {
    if (variant === 'error') toast.error(message);
    else toast.success(message);
  }

  // lifecycle modal
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  // edit profile modal
  const [editMode, setEditMode] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // edit profile form state
  const [editName, setEditName] = useState('');
  const [editBrandName, setEditBrandName] = useState('');
  const [editTimezone, setEditTimezone] = useState('');
  const [editLocale, setEditLocale] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // Purchase without setup PR E (R-E3, DQ9): registered name / tax id / address.
  const [identityEditMode, setIdentityEditMode] = useState(false);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityControl, setIdentityControl] = useState<PartnerIdentityControlDto | null>(null);
  const [identityRegisteredName, setIdentityRegisteredName] = useState('');
  const [identityTaxId, setIdentityTaxId] = useState('');
  const [identityLine1, setIdentityLine1] = useState('');
  const [identityLine2, setIdentityLine2] = useState('');
  const [identityAddress, setIdentityAddress] = useState({ postalCode: '', province: '', district: '', subdistrict: '' });
  const [identityChangeKind, setIdentityChangeKind] = useState<'INITIAL_CAPTURE' | 'CORRECTION' | 'LEGAL_CHANGE'>('CORRECTION');
  const [identityCorrectionReason, setIdentityCorrectionReason] = useState<'TYPO' | 'FORMATTING' | 'TRANSLITERATION'>('TYPO');
  const [identityEffectiveFrom, setIdentityEffectiveFrom] = useState('');
  const [identityEvidenceRef, setIdentityEvidenceRef] = useState('');
  const [identityNote, setIdentityNote] = useState('');
  const [identityReason, setIdentityReason] = useState('');

  // AI model
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiModelInput, setAiModelInput] = useState('');

  const load = async () => {
    const token=++generation.current;
    setLoading(true);
    setError(null);
    try {
      const d = await getPartnerDetail(companyId);
      if(token!==generation.current)return;
      setDetail(d);
      if (!detail || d.aiConfiguration?.modelId !== detail.aiConfiguration?.modelId) setAiModelInput(d.aiConfiguration?.modelId ?? '');
    } catch (err) {
      if(token!==generation.current)return;
      const e = err as Error & { status?: number };
      if (e.status === 403) setForbidden(true);
      else if (e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(err));
    } finally {
      if(token===generation.current)setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return ()=>{generation.current++;};
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    if (!detail) return;
    setEditName(detail.name);
    setEditBrandName(detail.brandName ?? '');
    setEditTimezone(detail.timezone);
    setEditLocale(detail.locale);
    setEditPhone(detail.phone ?? '');
    setEditEmail(detail.email ?? '');
    setEditMode(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditLoading(true);
    try {
      const updated = await updatePartnerProfile(companyId, {
        name: editName,
        brandName: editBrandName || undefined,
        timezone: editTimezone,
        locale: editLocale,
        phone: editPhone || undefined,
        email: editEmail || undefined,
      });
      setDetail(updated);
      setEditMode(false);
      showToast('บันทึกข้อมูลบริษัทแล้ว', 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setEditLoading(false);
    }
  };

  const startIdentityEdit = async () => {
    if (!detail) return;
    setIdentityRegisteredName(detail.registeredName ?? '');
    setIdentityTaxId(detail.taxId ?? '');
    setIdentityLine1(detail.addressJson?.line1 ?? '');
    setIdentityLine2(detail.addressJson?.line2 ?? '');
    setIdentityAddress({
      postalCode: detail.addressJson?.postalCode ?? '', province: detail.addressJson?.province ?? '',
      district: detail.addressJson?.district ?? '', subdistrict: detail.addressJson?.subdistrict ?? '',
    });
    setIdentityChangeKind('CORRECTION');
    setIdentityCorrectionReason('TYPO');
    setIdentityEffectiveFrom('');
    setIdentityEvidenceRef('');
    setIdentityNote('');
    setIdentityReason('');
    setIdentityEditMode(true);
    try {
      setIdentityControl(await getPartnerIdentityControl(companyId));
    } catch (err) {
      setIdentityEditMode(false);
      showToast(apiErrorMessage(err), 'error');
    }
  };

  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityControl) return;
    setIdentityLoading(true);
    try {
      const body: PatchPartnerIdentityDto = {
        expectedLegalIdentityVersion: identityControl.legalIdentityVersion,
        changeKind: identityChangeKind,
        registeredName: identityRegisteredName.trim(),
        taxId: identityTaxId.replace(/\D/g, ''),
        addressJson: {
          line1: identityLine1.trim(), line2: identityLine2.trim() || undefined,
          subdistrict: identityAddress.subdistrict, district: identityAddress.district,
          province: identityAddress.province, postalCode: identityAddress.postalCode,
        },
        ...(identityChangeKind === 'CORRECTION' ? { correctionReason: identityCorrectionReason, note: identityNote.trim() || undefined } : {}),
        ...(identityChangeKind === 'LEGAL_CHANGE' ? { effectiveFrom: identityEffectiveFrom, evidenceRef: identityEvidenceRef.trim() || undefined } : {}),
        reason: identityReason.trim(),
      };
      const updated = await patchPartnerIdentity(companyId, body);
      setDetail(updated);
      setIdentityEditMode(false);
      showToast('บันทึกข้อมูลจดทะเบียนแล้ว ระบบจะปรับข้อมูลลูกค้าใน Stripe ให้ตามหลัง', 'success');
    } catch (err) {
      const e2 = err as Error & { status?: number; code?: string; details?: { details?: { allowedChangeKinds?: string[] } } };
      if (e2.code === 'identity_change_kind_not_allowed') {
        const labels = (e2.details?.details?.allowedChangeKinds ?? []).map((kind) => CHANGE_KIND_LABEL[kind] ?? kind).join(', ');
        showToast(`เลือกลักษณะการแก้ไขที่ระบบอนุญาต: ${labels}`, 'error');
      } else if (e2.status === 409) {
        showToast('ข้อมูลบริษัทเพิ่งถูกแก้จากที่อื่น กรุณาโหลดใหม่', 'error');
      } else {
        showToast(apiErrorMessage(err), 'error');
      }
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleLifecycleConfirm = async (reason: string) => {
    if (!lifecycleAction) return;
    setLifecycleLoading(true);
    try {
      // The lifecycle endpoint returns status + timestamps only — merge into the
      // loaded detail instead of replacing it (replacing crashed the page).
      const result = await partnerLifecycleTransition(companyId, { targetStatus: lifecycleAction, reason: reason || undefined });
      setDetail((prev) => prev ? {
        ...prev,
        status: result.status,
        activatedAt: result.activatedAt,
        disabledAt: result.disabledAt,
        archivedAt: result.archivedAt,
      } : prev);
      setEditMode(false);
      setLifecycleAction(null);
      showToast(`เปลี่ยนสถานะเป็น ${STATUS_LABEL[lifecycleAction]} แล้ว`, 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
      setLifecycleAction(null);
    } finally {
      setLifecycleLoading(false);
    }
  };

  const handleAiModelSave = async () => {
    if(!aiModelInput||!detail||aiModelLoading||fieldsLocked)return;
    const reason=partnerAdjustmentReason(aiModelReason);
    if(!reason){showToast('กรุณาระบุเหตุผลที่เปลี่ยนรุ่น AI','error');return;}
    const token=generation.current;
    const accepted=await confirmAiModel({title:'ตรวจรุ่น AI ก่อนบันทึก',message:`${detail.aiConfiguration?.modelId??'ค่าเริ่มต้นของระบบ'} → ${aiModelInput}\nเหตุผล: ${reason}`,confirmLabel:'ยืนยันบันทึก',cancelLabel:'กลับไปแก้'});
    if(!accepted||token!==generation.current)return;
    setAiModelLoading(true);
    try {
      const result=await setPartnerAiModel(companyId,{modelId:aiModelInput,expectedModelId:detail.aiConfiguration?.modelId??null,reason});
      if(token!==generation.current)return;
      if(result.updatedAt)setDetail(prev=>prev?{...prev,aiConfiguration:{modelId:result.modelId,updatedAt:result.updatedAt!}}:prev);
      setAiModelReason('');setAiHistoryRefresh(n=>n+1);showToast('บันทึกรุ่น AI แล้ว','success');
    }catch(err){
      if(token!==generation.current)return;
      showToast(apiErrorMessage(err),'error');
      if(apiErrorCode(err)==='partner_ai_configuration_changed'){setAiModelLoading(false);await load();}
    }finally{if(token===generation.current)setAiModelLoading(false);}
  };

  // -- render

  if (forbidden) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">ไม่มีสิทธิ์ดูบริษัทนี้</h1>
          <p className="text-sm text-gray-500 mt-1">บัญชีนี้ไม่มีสิทธิ์เปิดข้อมูลบริษัทที่เลือก</p>
          <div className="mt-3 flex justify-center">
            <BackLink href="/system/partners" label="กลับรายชื่อบริษัท" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">ไม่พบบริษัทนี้</h1>
          <p className="text-sm text-gray-500 mt-1">Company ID: {companyId}</p>
          <div className="mt-3 flex justify-center">
            <BackLink href="/system/partners" label="กลับรายชื่อบริษัท" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">ยังเปิดข้อมูลบริษัทไม่ได้</h1>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <button type="button" className="mt-3 text-sm text-brand-700 hover:underline" disabled={loading} aria-busy={loading} onClick={() => void load()}>
            ลองอีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-dvh bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-lg border border-gray-200 bg-white animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const currentStatus = detail.status as PartnerStatus;
  // DISABLED/ARCHIVED companies are metadata-frozen (API enforces the same rule):
  // only lifecycle transitions stay available.
  const fieldsLocked = currentStatus === 'DISABLED' || currentStatus === 'ARCHIVED';
  // R-C6/R-C7: a term-locked shop must never read as an admin "ปิดใช้งาน" — the state chip and the
  // frozen-fields notice both need to say WHY, and the lifecycle "เปิดใช้งานบริษัท" button (which the
  // sweep would just undo again within ~5 minutes) must not appear for it.
  const lockedState = detail.planState === 'NO_PACKAGE' || detail.planState === 'EXPIRED' ? detail.planState : null;
  // R-E3/RV26: a DISABLED company that the sweep locked for a run-out term (lockedState truthy) is
  // a customer state, not an operator hold — profile/identity stay editable; features/AI (fieldsLocked,
  // unchanged above) stay read-only per RV25. ARCHIVED and a true admin hold (DISABLED without a
  // term lock) keep the full freeze.
  const termLocked = currentStatus === 'DISABLED' && Boolean(lockedState);
  const profileLocked = currentStatus === 'ARCHIVED' || (currentStatus === 'DISABLED' && !termLocked);

  return (
    <main className="mx-auto max-w-7xl space-y-6 break-words p-4 text-base sm:p-6 lg:p-8">
      {lifecycleAction&&<LifecycleConfirmModal action={lifecycleAction} loading={lifecycleLoading} onConfirm={handleLifecycleConfirm} onCancel={()=>setLifecycleAction(null)}/>}
      <BackLink href="/system/partners" label="กลับรายชื่อบริษัท"/>
      {/* R-C6/R-C7 (PartnerListPage.tsx's rowLabel rule): a term-locked shop reads by WHY it is
          locked, never the admin "ปิดใช้งาน" badge — so the status badge hides while the lock chip shows. */}
      <header className="space-y-3"><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold text-gray-900">{detail.name}</h1>{lockedState ? <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{planTermStateLabel(lockedState)}</span> : <StatusBadge status={currentStatus}/>}</div>{detail.brandName&&<p className="text-gray-600">ชื่อร้าน / แบรนด์: {detail.brandName}</p>}<p className="text-gray-600">เลือกเรื่องที่ต้องการดูแล ข้อมูลทั่วไปอยู่ในภาพรวม</p></header>
      <nav aria-label="หมวดข้อมูลบริษัท" className="flex flex-wrap gap-x-5 border-b border-gray-200">{COMPANY_VIEWS.map(item=><Link key={item.key} href={viewUrl(item.key)} scroll={false} aria-current={view===item.key?'page':undefined} className={`inline-flex min-h-14 items-center border-b-2 px-1 font-semibold ${view===item.key?'border-brand-700 text-brand-800':'border-transparent text-gray-600 hover:text-gray-900'}`} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();window.history.pushState(null,'',viewUrl(item.key));}}>{item.label}</Link>)}</nav>
      {fieldsLocked&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">บริษัทนี้{lockedState ? (lockedState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : 'แพ็กเกจหมดอายุ') : STATUS_LABEL[currentStatus]} {termLocked ? 'แก้ข้อมูลบริษัทและข้อมูลติดต่อได้ ส่วนฟีเจอร์และ AI อ่านได้อย่างเดียว' : 'ข้อมูลบริษัทและการตั้งค่าบริการอ่านได้อย่างเดียว ยกเว้นข้อมูลสำหรับรายงานผู้บริหาร'} {lockedState ? 'ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือต่ออายุได้ในหมวดแพ็กเกจ' : 'เปลี่ยนสถานะได้ในหมวดภาพรวม'}</p>}
      {opened('overview')&&<section hidden={view!=='overview'} aria-label="ภาพรวมบริษัท" className="space-y-5">
        <SectionCard title="ข้อมูลบริษัท">
          <div className="grid gap-4 sm:grid-cols-3">
            <ReadOnlyField label="ชื่อจดทะเบียน" value={detail.registeredName}/>
            <ReadOnlyField label="เลขประจำตัวผู้เสียภาษี" value={detail.taxId}/>
            <ReadOnlyField label="ประเภทธุรกิจ" value={companyBusinessTypeLabel(detail.businessType)}/>
            <ReadOnlyField label="ที่อยู่ (บ้านเลขที่ ถนน)" value={detail.addressJson?.line1}/>
            <ReadOnlyField label="ที่อยู่เพิ่มเติม" value={detail.addressJson?.line2 ?? undefined}/>
            <ReadOnlyField label="ตำบล / แขวง" value={detail.addressJson?.subdistrict}/>
            <ReadOnlyField label="อำเภอ / เขต" value={detail.addressJson?.district}/>
            <ReadOnlyField label="จังหวัด" value={detail.addressJson?.province}/>
            <ReadOnlyField label="รหัสไปรษณีย์" value={detail.addressJson?.postalCode}/>
            <ReadOnlyField label="สถานะ VAT" value={detail.vatRegistration.status === 'REGISTERED' ? 'จดทะเบียน VAT แล้ว' : detail.vatRegistration.status === 'NOT_REGISTERED' ? 'ยังไม่ได้จดทะเบียน VAT' : 'ยังไม่ได้ตอบ'}/>
            <ReadOnlyField label="วันที่มีผล VAT" value={detail.vatRegistration.effectiveFrom}/>
            <ReadOnlyField label="สกุลเงิน" value={detail.baseCurrency}/>
            <ReadOnlyField label="อีเมลติดต่อ" value={detail.email}/>
            <ReadOnlyField label="โทรศัพท์" value={detail.phone}/>
            <ReadOnlyField label="วันที่เพิ่มบริษัท" value={formatDate(detail.createdAt)}/>
            <ReadOnlyField label="รู้จักเราทางไหน" value={signupDiscoveryLabel(detail.discoverySource, detail.discoverySourceOther)}/>
            <CompanyReferralField companyId={companyId} createdAt={detail.createdAt} referral={companyReferral(detail)} disabled={fieldsLocked} showToast={showToast} onSaved={load}/>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">
            <button type="button" className={btnSecondary} disabled={profileLocked} onClick={startEdit}>แก้ไขข้อมูลบริษัท</button>
            {canEditIdentity && <button type="button" className={btnSecondary} disabled={profileLocked} onClick={()=>void startIdentityEdit()}>แก้ไขข้อมูลจดทะเบียน</button>}
            <Link className="inline-flex min-h-11 items-center px-2 text-brand-800 underline underline-offset-4" href={`/system/billing/companies/${encodeURIComponent(companyId)}`}>ดูการชำระเงินของบริษัท</Link>
          </div>
        </SectionCard>
        <PartnerTeamNote key={companyId} companyId={companyId} />
        <PartnerReportLabels detail={detail} canManage={canManageReportLabels} isPlatformCompany={isPlatformCompany} onSaved={setDetail} />
        {/* Purchase without setup PR E (R-E3): registered name / tax id / address */}
        {identityEditMode && !profileLocked && identityControl && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">แก้ไขข้อมูลจดทะเบียน</h2>
            <form onSubmit={handleIdentitySubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ชื่อจดทะเบียน *</label>
                  <input className={inputClass} required maxLength={255} aria-label="ชื่อจดทะเบียน" value={identityRegisteredName} onChange={(e) => setIdentityRegisteredName(e.target.value)} disabled={identityLoading} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">เลขประจำตัวผู้เสียภาษี *</label>
                  <input className={inputClass} required inputMode="numeric" maxLength={13} aria-label="เลขประจำตัวผู้เสียภาษี" value={identityTaxId} onChange={(e) => setIdentityTaxId(e.target.value.replace(/\D/g, '').slice(0, 13))} disabled={identityLoading} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ที่อยู่ (บ้านเลขที่ ถนน) *</label>
                  <input className={inputClass} required aria-label="ที่อยู่ (บ้านเลขที่ ถนน)" value={identityLine1} onChange={(e) => setIdentityLine1(e.target.value)} disabled={identityLoading} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ที่อยู่เพิ่มเติม</label>
                  <input className={inputClass} aria-label="ที่อยู่เพิ่มเติม" value={identityLine2} onChange={(e) => setIdentityLine2(e.target.value)} disabled={identityLoading} />
                </div>
              </div>
              <ThaiAddressFields addressMasterPath="/system/partners/address-master" value={identityAddress} onChange={setIdentityAddress} disabled={identityLoading} required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ลักษณะการแก้ไข *</label>
                  <select className={inputClass} aria-label="ลักษณะการแก้ไข" value={identityChangeKind} disabled={identityLoading}
                    onChange={(e) => setIdentityChangeKind(e.target.value as typeof identityChangeKind)}>
                    {identityControl.allowedChangeKinds.map((kind) => <option key={kind} value={kind}>{CHANGE_KIND_LABEL[kind] ?? kind}</option>)}
                  </select>
                </div>
                {identityChangeKind === 'CORRECTION' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">สาเหตุ *</label>
                    <select className={inputClass} aria-label="สาเหตุ" value={identityCorrectionReason} disabled={identityLoading}
                      onChange={(e) => setIdentityCorrectionReason(e.target.value as typeof identityCorrectionReason)}>
                      {(['TYPO', 'FORMATTING', 'TRANSLITERATION'] as const).map((reason) => <option key={reason} value={reason}>{CORRECTION_REASON_LABEL[reason]}</option>)}
                    </select>
                  </div>
                )}
                {identityChangeKind === 'LEGAL_CHANGE' && (<>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">วันที่มีผล *</label>
                    <ThemedDate value={identityEffectiveFrom} onChange={(e) => setIdentityEffectiveFrom(e.target.value)} max={new Date().toISOString().slice(0, 10)} disabled={identityLoading} aria-label="วันที่มีผล" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">เลขอ้างอิงเอกสาร (ถ้ามี)</label>
                    <input className={inputClass} maxLength={200} aria-label="เลขอ้างอิงเอกสาร" value={identityEvidenceRef} onChange={(e) => setIdentityEvidenceRef(e.target.value)} disabled={identityLoading} />
                  </div>
                </>)}
              </div>
              {identityChangeKind === 'CORRECTION' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">หมายเหตุ</label>
                  <input className={inputClass} maxLength={500} aria-label="หมายเหตุ" value={identityNote} onChange={(e) => setIdentityNote(e.target.value)} disabled={identityLoading} />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">เหตุผลภายใน (ลูกค้าไม่เห็น) *</label>
                <textarea className={`${inputClass} min-h-20`} required maxLength={500} aria-label="เหตุผลภายใน" value={identityReason} onChange={(e) => setIdentityReason(e.target.value)} disabled={identityLoading} />
              </div>
              <p className="text-sm text-gray-600">ข้อมูลนี้ใช้ออกเอกสารและยื่นภาษี ระบบเก็บเป็นเวอร์ชันและตรวจย้อนหลังได้ ใบที่ออกไปแล้วไม่เปลี่ยน</p>
              <div className="flex items-center gap-2">
                <button type="submit" className={btnPrimary} disabled={identityLoading} aria-busy={Boolean(identityLoading)}>
                  {identityLoading ? 'กำลังบันทึก…' : 'บันทึกข้อมูลจดทะเบียน'}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setIdentityEditMode(false)} disabled={identityLoading}>ยกเลิก</button>
              </div>
            </form>
          </div>
        )}
        {/* Edit profile form */}
        {editMode && !profileLocked && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">แก้ไขข้อมูลบริษัท</h2>
            <form onSubmit={handleEditSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ชื่อบริษัท *</label>
                <input className={inputClass} required aria-label="ชื่อบริษัท" value={editName} onChange={(e) => setEditName(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ชื่อร้าน / แบรนด์</label>
                <input className={inputClass} aria-label="ชื่อร้าน / แบรนด์" value={editBrandName} onChange={(e) => setEditBrandName(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">เขตเวลา *</label>
                <input className={inputClass} required aria-label="เขตเวลา" value={editTimezone} onChange={(e) => setEditTimezone(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ภาษา *</label>
                <input className={inputClass} required aria-label="ภาษา" value={editLocale} onChange={(e) => setEditLocale(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">โทรศัพท์</label>
                <input className={inputClass} aria-label="โทรศัพท์" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">อีเมล</label>
                <input className={inputClass} type="email" aria-label="อีเมล" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} disabled={editLoading} />
              </div>
              <div className="col-span-full mt-1 flex items-center gap-2">
                <button type="submit" className={btnPrimary} disabled={editLoading} aria-busy={Boolean(editLoading)}>
                  {editLoading ? 'กำลังบันทึก…' : 'บันทึกข้อมูลบริษัท'}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setEditMode(false)} disabled={editLoading}>
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        )}

        <details className="rounded-xl border border-gray-200 bg-white p-5"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">สถานะจด VAT ของบริษัท</summary><VatRegistrationField companyId={companyId} value={detail.vatRegistration} disabled={fieldsLocked} showToast={showToast} onSaved={load}/></details>
        <SectionCard title="การเชื่อมบัญชี LINE"><div className="flex flex-wrap items-center gap-3"><LineContextBadge health={detail.lineContextHealth}/><p className="text-gray-600">สถานะการผูก LINE ของสมาชิกบริษัทนี้</p></div><p className="text-sm text-gray-600">หากสมาชิกอยู่หลายบริษัท อาจต้องเลือกบริษัทก่อนใช้ผ่าน LINE ดูสมาชิกแต่ละคนได้ในหมวดสมาชิก</p></SectionCard>
        <details className="rounded-xl border border-gray-200 bg-white p-5"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">เปิด–ปิดการใช้งานบริษัท</summary><div className="space-y-4 pt-3"><p className="text-gray-600">การปิดใช้งานและเก็บถาวรมีผลกับสมาชิกทุกคน ต้องยืนยันก่อนเปลี่ยนสถานะ</p><div className="flex flex-wrap gap-3">{currentStatus!=='ACTIVE'&&!lockedState&&<button type="button" className={btnSecondary} onClick={()=>setLifecycleAction('ACTIVE')}>เปิดใช้งานบริษัท</button>}{currentStatus==='ACTIVE'&&<button type="button" className={btnSecondary} onClick={()=>setLifecycleAction('DISABLED')}>ปิดใช้งานบริษัท</button>}{currentStatus!=='ARCHIVED'&&<button type="button" className={btnSecondary} onClick={()=>setLifecycleAction('ARCHIVED')}>เก็บบริษัทถาวร</button>}</div>{lockedState&&<p className="text-sm text-gray-600">ร้านนี้ถูกพักเพราะ{lockedState==='NO_PACKAGE'?'ยังไม่มีแพ็กเกจ':'แพ็กเกจหมดอายุ'} เปิดใช้งานจากที่นี่ไม่ได้ (ระบบจะพักกลับอัตโนมัติ) ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหมวดแพ็กเกจ</p>}</div></details>
        <details className="rounded-xl border border-gray-200 bg-white p-5"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">ข้อมูลอ้างอิงบริษัท</summary><dl className="grid gap-4 py-3 sm:grid-cols-3"><ReadOnlyField label="รหัสบริษัท" value={detail.id}/><ReadOnlyField label="วันที่เปิดใช้งาน" value={formatDate(detail.activatedAt)}/><ReadOnlyField label="วันที่ปิดใช้งาน" value={formatDate(detail.disabledAt)}/></dl></details>
      </section>}
      {opened('members')&&<section hidden={view!=='members'} aria-label="สมาชิกบริษัท" className="space-y-5"><p className="text-gray-600">ตรวจสมาชิกและการผูก LINE เลือกดำเนินการเฉพาะคนที่ต้องการดูแล</p><MembersSection companyId={companyId} canManageMembers={canManageMembers} showToast={showToast}/></section>}
      {opened('package')&&<section hidden={view!=='package'} aria-label="แพ็กเกจและฟีเจอร์บริษัท" className="space-y-5"><PlanTermSection key={`term-${companyId}`} companyId={companyId} companyStatus={currentStatus} fieldsLocked={fieldsLocked} showToast={showToast}/><PackageMenuSection companyId={companyId} companyName={detail.name} entitlements={detail.featureEntitlements} setVersion={detail.setVersion} manualExpenseWebEntry={detail.manualExpenseWebEntry} disbursementVoucherWebEntry={detail.disbursementVoucherWebEntry} disbursementVoucherRoles={detail.disbursementVoucherRoles} companyStatus={currentStatus} fieldsLocked={fieldsLocked} normalizationPending={isNormalizationPending(detail.entitlementNormalizationPending)} showToast={showToast} onSaved={load}/></section>}
      {opened('ai')&&<section hidden={view!=='ai'} aria-label="เครดิต AI และอ่านรูปของบริษัท" className="space-y-5"><p className="text-gray-600">ดูว่าเงื่อนไขไหนใช้กับร้านนี้ ปรับเครดิตแชต จำนวนอ่านรูป และเพดานความปลอดภัย ระบบให้ตรวจผลกระทบก่อนบันทึก</p>
        <AiUsageBudgetSection key={`ai-budget-${companyId}`} companyId={companyId} fieldsLocked={fieldsLocked} showToast={showToast} onChanged={()=>setAiHistoryRefresh(n=>n+1)} />
        <details className="rounded-xl border border-gray-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">เปลี่ยนรุ่น AI ของบริษัท</summary>
        {/* AI model */}
        <SectionCard title="รุ่น AI ของบริษัท">
          {aiModelConfirmDialog}
          <label className="mb-3 block text-base">เหตุผลที่เปลี่ยนรุ่น AI
            <textarea aria-label="เหตุผลที่เปลี่ยนรุ่น AI" className={`${inputClass} mt-1 min-h-20 text-base`} value={aiModelReason} maxLength={500} disabled={aiModelLoading||fieldsLocked} onChange={e=>setAiModelReason(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">รุ่น AI ที่เปิดให้ใช้</label>
              <ThemedSelect
                aria-label="รุ่น AI ที่เปิดให้ใช้"
                className={inputClass}
                value={aiModelInput}
                onChange={(e) => setAiModelInput(e.target.value)}
                disabled={aiModelLoading || fieldsLocked}
              >
                <option value="">เลือกรุ่น AI…</option>
                {APPROVED_AI_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </ThemedSelect>
            </div>
            <button
              type="button"
              className={btnPrimary}
              disabled={aiModelLoading || !aiModelInput || fieldsLocked} aria-busy={Boolean(aiModelLoading)}
              onClick={handleAiModelSave}
            >
              {aiModelLoading ? 'กำลังบันทึก…' : 'ตรวจรุ่นก่อนบันทึก'}
            </button>
          </div>
          {detail.aiConfiguration && (
            <p className="text-xs text-gray-400 mt-1">
              ใช้อยู่: <span className="font-mono">{detail.aiConfiguration.modelId}</span>
              {' · อัปเดต '}
              {formatDate(detail.aiConfiguration.updatedAt)}
            </p>
          )}
        </SectionCard>

        </details>
        <details className="rounded-xl border border-gray-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 text-gray-600">ดูประวัติการปรับเครดิต AI และอ่านรูป</summary><PartnerAiAdjustmentHistory key={`ai-history-${companyId}-${aiHistoryRefresh}`} companyId={companyId}/></details>
      </section>}
      {opened('contact')&&<section hidden={view!=='contact'} aria-label="ติดต่อและประวัติบริษัท" className="space-y-5"><ShopMessageSection key={`message-${companyId}`} companyId={companyId} supportRequestId={supportRequestId} supportAskerRef={supportAskerRef} showToast={showToast}/><ShopTimelineSection key={`timeline-${companyId}`} companyId={companyId}/></section>}
    </main>
  );
}
