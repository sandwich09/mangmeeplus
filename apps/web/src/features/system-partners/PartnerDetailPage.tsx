'use client';

import {
  FEATURE_CATALOG,
  FEATURE_PACKAGE_PRESETS,
  MENU_ENTITLEMENT_BINDINGS,
  type FeaturePackagePresetKey,
  type MenuEntitlementBinding,
  type PartnerFeatureEntitlementDto,
} from '@watchdog-bms/contracts';
import Link from 'next/link';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { getMangmeeMenuTone, mangmeeToneClass } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal/Modal';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';
import { useEffect, useRef, useState } from 'react';
import { WORKSPACE_ICON_NODES } from '@/features/web-core-workspace/design-icons';
import {
  getPartnerDetail,
  updatePartnerProfile,
  partnerLifecycleTransition,
  setPartnerFeatures,
  setPartnerAiModel,
  setPartnerVatRegistration,
  getPartnerAiUsage,
  getPartnerMembers,
  unlinkPartnerMemberLine,
  resetPartnerMemberPassword,
  revealPartnerMemberTempPassword,
} from './system-partners.api';
import type {
  PartnerCompanyDetailDto,
  LineContextHealth,
  PartnerAiUsageDto,
  PartnerMemberDto,
} from './system-partners.api';
import {
  budgetBarClass,
  budgetBarWidth,
  budgetPercent,
  budgetTextClass,
  parseBudgetBahtInput,
  satangToBaht,
  satangToBahtInput,
} from './ai-budget.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  applyPreset,
  buildMenuCards,
  cascadeOffItems,
  changedEntitlements,
  commandFailureMessage,
  dependencyBlockMessage,
  disableBlockForChange,
  diffEntitlements,
  entitlementEnabled,
  filterMenuCards,
  isAmbiguousCommandFailure,
  isNormalizationPending,
  previewNavGroups,
  toggleMenuCard,
  toggleMenuGroup,
  toggleSubmenu,
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

function StatusBadge({ status }: { status: PartnerStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[status] ?? STATUS_CLASS.ARCHIVED}`}>
      {status}
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
  LINKED: 'LINE Linked',
  UNLINKED: 'No LINE Link',
  NEEDS_COMPANY_SELECTION: 'Needs Company Selection',
  UNKNOWN: 'Unknown',
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
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
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
      showToast('VAT registration saved.', 'success');
      await onSaved();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-xs text-gray-500 mb-2">
        VAT Registration — decides whether this company is asked Thai VAT questions when recording
        expenses, and whether it may claim input VAT. UNKNOWN is not &quot;not registered&quot;: it means nobody
        has answered, and every reader keeps behaving as it does today.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <ThemedSelect className={inputClass} value={status} disabled={disabled || busy}
            onChange={(e) => setStatus(e.target.value as '' | 'REGISTERED' | 'NOT_REGISTERED')}>
            <option value="">— UNKNOWN (unanswered) —</option>
            <option value="REGISTERED">REGISTERED / จดทะเบียนแล้ว</option>
            <option value="NOT_REGISTERED">NOT_REGISTERED / ยังไม่ได้จดทะเบียน</option>
          </ThemedSelect>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Effective From</label>
          <ThemedDate className={inputClass} value={effectiveFrom} disabled={disabled || busy}
            onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        <button type="button" className={btnPrimary} disabled={disabled || busy || !status} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save VAT status'}
        </button>
        <span className="text-xs text-gray-400">v{value.version}</span>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-mono">{value || '—'}</p>
    </div>
  );
}

const inputClass = 'mangmee-input';
const btnPrimary = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const btnSecondary = 'rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const btnDanger = 'rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';

// -- lifecycle confirm modal

type LifecycleAction = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';

const LIFECYCLE_CONSEQUENCE: Record<LifecycleAction, string> = {
  ACTIVE: 'The company will be marked as ACTIVE. Users will be able to log in and use the platform.',
  DISABLED: 'The company will be DISABLED. Existing users will lose access until re-enabled.',
  ARCHIVED: 'The company will be ARCHIVED (soft removal). All customer access is revoked and its data becomes read-only. Data is never hard-deleted; a system admin can re-activate it later.',
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
            Confirm: Set status to {action}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-700">{LIFECYCLE_CONSEQUENCE[action]}</p>
          {action === 'ARCHIVED' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Warning: while archived, all customer access is revoked and fields are locked.
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
            <input
              className={inputClass}
              type="text"
              placeholder="e.g. contract ended"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className={action === 'ARCHIVED' ? btnDanger : btnPrimary}
            disabled={loading}
            onClick={() => onConfirm(reason)}
          >
            {loading ? 'Applying…' : `Confirm ${action}`}
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
  showToast,
}: {
  companyId: string;
  showToast: (message: string, variant: 'success' | 'error') => void;
}) {
  const [members, setMembers] = useState<PartnerMemberDto[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  // userId -> revealed plaintext; absent = masked. Kept client-side only.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const loadMembers = async () => {
    try {
      setMembers((await getPartnerMembers(companyId)).items);
      setMembersError(null);
    } catch (err) {
      const e = err as Error & { status?: number };
      setMembersError(e.status === 403 ? 'You do not have permission to view members.' : apiErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadMembers();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      title: 'Reset password',
      message: `Issue a new temporary password for "${member.displayName}"? The current password stops working immediately.`,
      confirmLabel: 'Reset password',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    setBusyUserId(member.userId);
    try {
      const result = await resetPartnerMemberPassword(companyId, member.userId);
      setRevealed((prev) => ({ ...prev, [member.userId]: result.temporaryPassword }));
      showToast('New temporary password issued.', 'success');
      await loadMembers();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUnlinkLine = async (member: PartnerMemberDto) => {
    const confirmed = await confirm({
      title: 'Unlink LINE',
      message: `Unlink LINE for "${member.displayName}"? They must scan a fresh QR to relink.`,
      confirmLabel: 'Unlink LINE',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    setBusyUserId(member.userId);
    try {
      await unlinkPartnerMemberLine(companyId, member.userId);
      showToast('LINE unlinked.', 'success');
      await loadMembers();
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <SectionCard title="Members">
      {membersError ? (
        <p className="text-sm text-red-600">{membersError}</p>
      ) : !members ? (
        <div className="h-16 rounded border border-gray-100 animate-pulse" />
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500">No members.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Member</th>
                <th className="py-2 pr-4 font-medium">Roles</th>
                <th className="py-2 pr-4 font-medium">LINE</th>
                <th className="py-2 pr-4 font-medium">Password</th>
                <th className="py-2 font-medium">Actions</th>
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
                        <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Linked</span>
                      ) : (
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">Not linked</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-gray-700">
                          {shown !== undefined ? shown : canReveal ? '••••••••' : '—'}
                        </span>
                        <button
                          type="button"
                          disabled={!canReveal || busy}
                          onClick={() => void toggleReveal(m)}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title={
                            shown !== undefined
                              ? 'Hide'
                              : canReveal
                                ? 'Show temporary password (audited)'
                                : 'No revealable password — the user changed it. Reset to issue a new one.'
                          }
                        >
                          <EyeIcon off={shown !== undefined} />
                        </button>
                      </div>
                      {m.credential?.status === 'TEMPORARY' && m.credential.expiresAt && (
                        <p className="mt-0.5 text-xs text-gray-400">expires {formatDate(m.credential.expiresAt)}</p>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy || !m.credential}
                          onClick={() => void handleResetPassword(m)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                          disabled={busy || !m.lineLinked}
                          onClick={() => void handleUnlinkLine(m)}
                        >
                          Unlink LINE
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
    </SectionCard>
  );
}

// -- package menu mirror

function PackageMenuSection({
  companyId,
  entitlements,
  setVersion,
  fieldsLocked,
  normalizationPending,
  showToast,
  onSaved,
}: {
  companyId: string;
  entitlements: PartnerFeatureEntitlementDto[];
  setVersion: number;
  fieldsLocked: boolean;
  normalizationPending: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
  onSaved: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Entitlement[]>(
    entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })),
  );
  const [search, setSearch] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [showDisabledPreview, setShowDisabledPreview] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const commandId = useRef<string | null>(null);

  useEffect(() => {
    setPending(entitlements.map(({ featureKey, enabled }) => ({ featureKey, enabled })));
    setReviewOpen(false);
    commandId.current = null;
  }, [entitlements]);

  const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, pending);
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
        title="ตรวจสอบการเปลี่ยนแปลงแพ็กเกจ"
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

      <section className="mangmee-card">
        <div className="mangmee-card-header flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-gray-900">แพ็กเกจการใช้งาน</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
              เลือกจากเมนูเดียวกับแถบข้างของบริษัท แล้วตรวจสอบผลรวมก่อนบันทึก
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(FEATURE_PACKAGE_PRESETS) as FeaturePackagePresetKey[]).map((presetKey) => {
              const next = applyPreset(pending, presetKey);
              const disableBlock = disableBlockForChange(entitlements, next, entitlements);
              return (
                <button
                  key={presetKey}
                  type="button"
                  className="mangmee-btn mangmee-btn-secondary min-h-11 disabled:opacity-50"
                  disabled={controlsLocked || Boolean(disableBlock)}
                  title={disableBlock?.reason}
                  onClick={() => updatePending(next)}
                >
                  {FEATURE_PACKAGE_PRESETS[presetKey].labelTh}
                </button>
              );
            })}
            <span className="mangmee-badge mangmee-badge-brand basis-full sm:basis-auto">
              เปิด {enabledCardCount}/{cards.length} เมนู
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            ตัวเลือกที่ต้องปิดฟีเจอร์ซึ่งระบบยังเตรียมไม่เสร็จจะกดไม่ได้ แต่การเปิดเพิ่มยังทำได้ตามปกติ
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
                disabled={controlsLocked}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            {navGroups.map((navGroup) => {
              const groupCards = cards.filter((card) => card.group === navGroup.group);
              const visibleCards = filteredCards.filter((card) => card.group === navGroup.group);
              if (visibleCards.length === 0) return null;
              const sellableCards = groupCards.filter((card) => card.entitlementKeys.length > 0);
              const allEnabled = sellableCards.every((card) => card.enabled);
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
                      <article key={card.navKey} className="mangmee-card overflow-hidden shadow-none">
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

                        {card.submenus.length > 0 && (
                          <div className="border-t border-gray-100 px-4 py-3">
                            <button
                              type="button"
                              className="mangmee-badge mangmee-badge-brand disabled:opacity-50"
                              disabled={controlsLocked}
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
                                    <div key={submenu.key} className="flex items-start gap-3 py-3">
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
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
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
                  className="mangmee-btn mangmee-btn-secondary px-2 py-1 text-xs disabled:opacity-50 lg:hidden"
                  disabled={controlsLocked}
                  aria-expanded={previewOpen}
                  onClick={() => setPreviewOpen((open) => !open)}
                >
                  {previewOpen ? 'ซ่อน' : 'แสดง'}
                </button>
              </div>
              <div className={`${previewOpen ? 'block' : 'hidden'} mangmee-card-body space-y-4 lg:block`}>
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

// -- AI usage meter + monthly budget override (metering spec §7.7)

function AiUsageBudgetSection({
  companyId,
  fieldsLocked,
  showToast,
}: {
  companyId: string;
  fieldsLocked: boolean;
  showToast: (message: string, variant: 'success' | 'error') => void;
}) {
  const [usage, setUsage] = useState<PartnerAiUsageDto | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetLoading, setBudgetLoading] = useState(false);

  const loadUsage = async () => {
    try {
      const result = await getPartnerAiUsage(companyId);
      setUsage(result);
      setBudgetInput(result.budget.overrideSatang === null ? '' : satangToBahtInput(result.budget.overrideSatang));
      setUsageError(null);
    } catch (err) {
      const e = err as Error & { status?: number };
      setUsageError(e.status === 403 ? 'You do not have permission to view AI usage.' : apiErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadUsage();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBudgetSave = async () => {
    const parsed = parseBudgetBahtInput(budgetInput);
    if (!parsed.ok) {
      showToast(parsed.message, 'error');
      return;
    }
    setBudgetLoading(true);
    try {
      const result = await setPartnerAiModel(companyId, { monthlyBudgetSatang: parsed.monthlyBudgetSatang });
      setUsage((prev) => prev ? {
        ...prev,
        budget: {
          ...prev.budget,
          overrideSatang: result.monthlyBudgetSatang,
          effectiveSatang: result.monthlyBudgetSatang ?? prev.budget.defaultSatang,
        },
      } : prev);
      showToast(
        result.monthlyBudgetSatang === null
          ? 'Monthly AI budget cleared — this company now inherits the platform default.'
          : `Monthly AI budget set to ${satangToBaht(result.monthlyBudgetSatang)}.`,
        'success',
      );
    } catch (err) {
      // Reviewed API codes/messages keep their actionable copy; unknown diagnostics stay hidden.
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setBudgetLoading(false);
    }
  };

  const spendSatang = usage?.current?.costSatang ?? 0;
  const percent = usage ? budgetPercent(spendSatang, usage.budget.effectiveSatang) : 0;

  return (
    <SectionCard title="AI Usage & Budget">
      {usageError ? (
        <p className="text-sm text-red-600">{usageError}</p>
      ) : !usage ? (
        <div className="h-16 rounded border border-gray-100 animate-pulse" />
      ) : (
        <>
          <p className="text-xs text-gray-500">
            งบ AI ต่อเดือนของบริษัทนี้ — ใช้ครบเมื่อไร ระบบจะปฏิเสธการเรียก AI ทุกช่องทางจนถึงเดือนถัดไป
            เว้นว่างไว้ = ใช้ค่าเริ่มต้นของแพลตฟอร์ม
          </p>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-gray-700">
                Month to date{' '}
                <span className="font-semibold tabular-nums text-gray-900">{satangToBaht(spendSatang)}</span>
                {' of '}
                <span className="tabular-nums">{satangToBaht(usage.budget.effectiveSatang)}</span>
                {usage.budget.overrideSatang === null ? ' (platform default)' : ' (company override)'}
              </p>
              <span className={`text-xs font-medium tabular-nums ${budgetTextClass(percent)}`}>{percent}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full rounded-full ${budgetBarClass(percent)}`} style={{ width: `${budgetBarWidth(percent)}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {usage.current
                ? `${formatThaiMonth(usage.current.monthKey)} · ${usage.current.callCount} calls · ${usage.current.inputTokens.toLocaleString('th-TH')} in / ${usage.current.outputTokens.toLocaleString('th-TH')} out tokens`
                : 'No AI calls recorded this month.'}
            </p>
          </div>

          <p className="text-sm text-gray-600">
            {usage.previous
              ? <>Previous month ({formatThaiMonth(usage.previous.monthKey)}): <span className="tabular-nums">{satangToBaht(usage.previous.costSatang)}</span> · {usage.previous.callCount} calls</>
              : 'No AI spend recorded last month.'}
          </p>

          {usage.topTags.length === 0 ? (
            <p className="text-sm text-gray-500">No AI usage recorded this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-2 pr-4 font-medium">Tag</th>
                    <th className="py-2 pr-4 font-medium">Cost</th>
                    <th className="py-2 font-medium">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.topTags.map((row) => (
                    <tr key={row.tag} className="border-b border-gray-100">
                      <td className="py-2.5 pr-4 font-mono text-gray-700">{row.tag}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-gray-800">{satangToBaht(row.costSatang)}</td>
                      <td className="py-2.5 tabular-nums text-gray-800">{row.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-end gap-3 border-t border-gray-100 pt-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1" htmlFor="ai-monthly-budget">Monthly Budget (฿)</label>
              <input
                id="ai-monthly-budget"
                className={inputClass}
                type="number"
                min={1}
                step={0.01}
                inputMode="decimal"
                placeholder={satangToBahtInput(usage.budget.defaultSatang)}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                disabled={budgetLoading || fieldsLocked}
              />
            </div>
            <button
              type="button"
              className={btnPrimary}
              disabled={budgetLoading || fieldsLocked}
              onClick={() => void handleBudgetSave()}
            >
              {budgetLoading ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Leave empty to inherit the platform default {satangToBaht(usage.budget.defaultSatang)}.
            Platform ceiling {satangToBaht(usage.budget.ceilingSatang)}.
          </p>
        </>
      )}
    </SectionCard>
  );
}

// -- main page

export default function PartnerDetailPage({ companyId }: { companyId: string }) {
  const toast = useToast();
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

  // AI model
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiModelInput, setAiModelInput] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getPartnerDetail(companyId);
      setDetail(d);
      setAiModelInput(d.aiConfiguration?.modelId ?? '');
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) setForbidden(true);
      else if (e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
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
      showToast('Profile updated.', 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setEditLoading(false);
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
      showToast(`Status changed to ${lifecycleAction}.`, 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
      setLifecycleAction(null);
    } finally {
      setLifecycleLoading(false);
    }
  };

  const handleAiModelSave = async () => {
    if (!aiModelInput) return;
    setAiModelLoading(true);
    try {
      const result = await setPartnerAiModel(companyId, { modelId: aiModelInput });
      if (detail) {
        setDetail({ ...detail, aiConfiguration: { modelId: result.modelId, updatedAt: result.updatedAt } });
      }
      showToast(`AI model set to ${result.modelId}.`, 'success');
    } catch (err) {
      showToast(apiErrorMessage(err), 'error');
    } finally {
      setAiModelLoading(false);
    }
  };

  // -- render

  if (forbidden) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Access Denied</h1>
          <p className="text-sm text-gray-500 mt-1">You do not have permission to view partner details.</p>
          <div className="mt-3 flex justify-center">
            <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Partner Not Found</h1>
          <p className="text-sm text-gray-500 mt-1">Company ID: {companyId}</p>
          <div className="mt-3 flex justify-center">
            <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Error</h1>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <button type="button" className="mt-3 text-sm text-brand-700 hover:underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading || !detail) {
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

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      {lifecycleAction && (
        <LifecycleConfirmModal
          action={lifecycleAction}
          loading={lifecycleLoading}
          onConfirm={handleLifecycleConfirm}
          onCancel={() => setLifecycleAction(null)}
        />
      )}

      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/system/partners" className="hover:text-brand-700">Partners</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{detail.name}</span>
        </div>

        {/* Header card */}
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900">{detail.name}</h1>
                <StatusBadge status={currentStatus} />
              </div>
              {detail.brandName && (
                <p className="text-sm text-gray-500">Brand: {detail.brandName}</p>
              )}
              <p className="text-xs text-gray-400 font-mono">ID: {detail.id}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                className={btnSecondary}
                onClick={startEdit}
                disabled={fieldsLocked}
                title={fieldsLocked ? `Profile is read-only while ${currentStatus}.` : undefined}
              >
                Edit Profile
              </button>
            </div>
          </div>

          {/* Lifecycle action buttons */}
          <div className="mt-4 flex items-center gap-2 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-500 mr-1">Lifecycle:</span>
            {currentStatus !== 'ACTIVE' && (
              <button
                type="button"
                className="rounded border border-green-300 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                onClick={() => setLifecycleAction('ACTIVE')}
              >
                {currentStatus === 'ARCHIVED' ? 'Re-activate' : 'Activate'}
              </button>
            )}
            {currentStatus === 'ACTIVE' && (
              <button
                type="button"
                className="rounded border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-100"
                onClick={() => setLifecycleAction('DISABLED')}
              >
                Disable
              </button>
            )}
            {currentStatus !== 'ARCHIVED' && (
              <button
                type="button"
                className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                onClick={() => setLifecycleAction('ARCHIVED')}
              >
                Archive
              </button>
            )}
          </div>
        </div>

        {/* Read-only notice for DISABLED/ARCHIVED */}
        {fieldsLocked && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-5 py-3 text-sm text-yellow-800">
            This company is <span className="font-semibold">{currentStatus}</span> — profile, features, and AI model are read-only.
            Only the lifecycle status above can be changed.
          </div>
        )}

        {/* Edit profile form */}
        {editMode && !fieldsLocked && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Edit Company Profile</h2>
            <form onSubmit={handleEditSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Company Name *</label>
                <input className={inputClass} required value={editName} onChange={(e) => setEditName(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Brand Name</label>
                <input className={inputClass} value={editBrandName} onChange={(e) => setEditBrandName(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Timezone *</label>
                <input className={inputClass} required value={editTimezone} onChange={(e) => setEditTimezone(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Locale *</label>
                <input className={inputClass} required value={editLocale} onChange={(e) => setEditLocale(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Phone</label>
                <input className={inputClass} value={editPhone} onChange={(e) => setEditPhone(e.target.value)} disabled={editLoading} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                <input className={inputClass} type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} disabled={editLoading} />
              </div>
              <div className="col-span-full mt-1 flex items-center gap-2">
                <button type="submit" className={btnPrimary} disabled={editLoading}>
                  {editLoading ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setEditMode(false)} disabled={editLoading}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Identity section */}
        <SectionCard title="Company Identity">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <ReadOnlyField label="Registered Name" value={detail.registeredName} />
            <ReadOnlyField label="Tax ID" value={detail.taxId} />
            <ReadOnlyField label="Base Currency" value={detail.baseCurrency} />
            <ReadOnlyField label="Created At" value={formatDate(detail.createdAt)} />
            <ReadOnlyField label="Activated At" value={formatDate(detail.activatedAt)} />
            <ReadOnlyField label="Disabled At" value={formatDate(detail.disabledAt)} />
          </div>
          <VatRegistrationField
            companyId={companyId}
            value={detail.vatRegistration}
            disabled={fieldsLocked}
            showToast={showToast}
            onSaved={load}
          />
        </SectionCard>

        {/* Members: credentials + LINE link administration */}
        <MembersSection companyId={companyId} showToast={showToast} />

        {/* Feature entitlements */}
        <PackageMenuSection
          companyId={companyId}
          entitlements={detail.featureEntitlements}
          setVersion={detail.setVersion}
          fieldsLocked={fieldsLocked}
          normalizationPending={isNormalizationPending(detail.entitlementNormalizationPending)}
          showToast={showToast}
          onSaved={load}
        />

        {/* AI model */}
        <SectionCard title="AI Model Configuration">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Approved AI Model</label>
              <ThemedSelect
                className={inputClass}
                value={aiModelInput}
                onChange={(e) => setAiModelInput(e.target.value)}
                disabled={aiModelLoading || fieldsLocked}
              >
                <option value="">Select model…</option>
                {APPROVED_AI_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </ThemedSelect>
            </div>
            <button
              type="button"
              className={btnPrimary}
              disabled={aiModelLoading || !aiModelInput || fieldsLocked}
              onClick={handleAiModelSave}
            >
              {aiModelLoading ? 'Saving…' : 'Save'}
            </button>
          </div>
          {detail.aiConfiguration && (
            <p className="text-xs text-gray-400 mt-1">
              Current: <span className="font-mono">{detail.aiConfiguration.modelId}</span>
              {' — updated '}
              {formatDate(detail.aiConfiguration.updatedAt)}
            </p>
          )}
        </SectionCard>

        {/* AI spend meter + monthly budget override */}
        <AiUsageBudgetSection companyId={companyId} fieldsLocked={fieldsLocked} showToast={showToast} />

        {/* LINE context health */}
        <SectionCard title="LINE Context">
          <div className="flex flex-wrap items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">LINE Account Link Status</span>
                <LineContextBadge health={detail.lineContextHealth} />
              </div>
              <p className="text-xs text-gray-400">
                Shows whether any member of this company has linked their LINE account.
                NEEDS_COMPANY_SELECTION means the user belongs to multiple companies and has not yet selected this one.
              </p>
            </div>
            {/* Audit H-14: hidden with the screen it points at — saving there cannot rotate a
                credential the webhook reads from AWS/env. Restore both together. */}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
