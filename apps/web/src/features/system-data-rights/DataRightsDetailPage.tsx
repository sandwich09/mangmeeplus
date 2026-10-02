'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  DATA_RIGHTS_AUTHORITY_METHODS,
  DATA_RIGHTS_DECISION_CATEGORIES,
  DATA_RIGHTS_IDENTITY_METHODS,
  DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH,
  DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH,
  dataRightsAllowedDispositions,
  dataRightsCaseRequiresTenantAuthority,
  type DataRightsAuthorityMethod,
  type DataRightsDecisionCategory,
  type DataRightsDisposition,
  type DataRightsEvidenceType,
  type DataRightsIdentityMethod,
  type DataRightsSingleAdminStep,
} from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { Modal, useConfirm } from '@/common/components/modal';
import {
  approveDataRightsCase,
  beginDataRightsRetentionReview,
  closeDataRightsCase,
  completeDataRightsCase,
  getDataRightsCase,
  recordDataRightsDecision,
  recordDataRightsEvidence,
  startDataRightsExecution,
  startDataRightsVerification,
  verifyDataRightsAuthority,
  verifyDataRightsIdentity,
  type DataRightsCaseDetail,
  type DataRightsCommandResult,
  type DataRightsDecisionRecord,
} from './data-rights.api';
import {
  CASE_TYPE_DESCRIPTION,
  CASE_TYPE_LABEL,
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
  DISPOSITION_LABEL,
  EVIDENCE_REFERENCE_PATTERN,
  EVIDENCE_TYPE_LABEL,
  SOURCE_LABEL,
  SINGLE_ADMIN_STEP_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  canBeginRetentionReview,
  completionOutcomeForDecisions,
  dataRightsSameActorModes,
  evidenceTypeRequiresCategory,
  isValidEvidenceSha256,
  isOverdueCase,
  isTerminalStatus,
  latestDecisions,
  missingDecisionCategories,
  missingEvidenceRequirements,
  recordableEvidenceTypesForStatus,
  requiredEvidenceCategory,
  retainedDecisionCategories,
  singleAdminReasonError,
  singleAdminReasonOfAction,
  singleAdminSteps,
  type DataRightsSameActorMode,
} from './data-rights.logic';

const inputClass = 'h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50';
const textareaClass = 'min-h-24 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50';

const IDENTITY_METHOD_LABEL: Record<DataRightsIdentityMethod, string> = {
  AUTHENTICATED_SESSION: 'เซสชันที่ยืนยันแล้ว',
  VERIFIED_EMAIL_CHALLENGE: 'ตอบ challenge ผ่านอีเมลที่ยืนยันแล้ว',
  COMPANY_ADMIN_ATTESTATION: 'ผู้ดูแลกิจการรับรอง',
  LEGAL_REPRESENTATIVE_DOCUMENT_REVIEWED: 'ตรวจเอกสารผู้แทนโดยชอบแล้ว',
  OTHER_PROPORTIONATE_METHOD: 'วิธีอื่นที่ได้สัดส่วนกับความเสี่ยง',
};

const AUTHORITY_METHOD_LABEL: Record<DataRightsAuthorityMethod, string> = {
  NOT_REQUIRED: 'ไม่ต้องยืนยันอำนาจ',
  CURRENT_OWNER_MEMBERSHIP: 'ตรวจสถานะเจ้าของกิจการปัจจุบัน',
  COMPANY_AFFIDAVIT_REVIEWED: 'ตรวจหนังสือรับรองนิติบุคคลแล้ว',
  SIGNED_AUTHORIZATION_REVIEWED: 'ตรวจหนังสือมอบอำนาจลงนามแล้ว',
  OTHER_LEGAL_REVIEW: 'ผ่านการตรวจอำนาจทางกฎหมายอื่น',
};

const ACTION_LABEL: Record<string, string> = {
  CASE_CREATED: 'เปิดเคส',
  IDENTITY_VERIFIED: 'ยืนยันตัวตน',
  AUTHORITY_VERIFIED: 'ยืนยันอำนาจกิจการ',
  RETENTION_REVIEW_STARTED: 'เริ่มทบทวนการเก็บรักษา',
  DECISION_RECORDED: 'บันทึกคำตัดสิน',
  EVIDENCE_RECORDED: 'เพิ่มหลักฐาน',
  APPROVED: 'อนุมัติแผน',
  EXECUTION_STARTED: 'เริ่มดำเนินการตาม runbook',
  VERIFICATION_STARTED: 'เริ่มตรวจยืนยัน',
  CASE_COMPLETED: 'ปิดเคสสำเร็จ',
  CASE_BLOCKED: 'หยุดดำเนินการและเปิดทางให้เคสติดตาม',
  CASE_REJECTED: 'ปฏิเสธคำขอ',
  CASE_CANCELLED: 'ยกเลิกเคส',
};

const PHASES = [
  ['RECEIVED', 'รับเรื่อง'],
  ['IDENTITY_VERIFIED', 'ตรวจตัวตน'],
  ['RETENTION_REVIEW', 'ตัดสินใจ'],
  ['APPROVED', 'อนุมัติ'],
  ['EXECUTING', 'ดำเนินการ'],
  ['VERIFICATION', 'ตรวจยืนยัน'],
  ['COMPLETED', 'เสร็จสิ้น'],
] as const;

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function actor(value?: string | null): string {
  return value || 'ยังไม่มีผู้รับบทบาท';
}

function priorCaseReference(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { priorCaseReference?: unknown }).priorCaseReference;
  return typeof value === 'string' && /^case:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function blockedRemediationHref(detail: DataRightsCaseDetail): string {
  const query = new URLSearchParams({
    priorCaseReference: `case://${detail.id}`,
    caseType: detail.caseType,
  });
  if (detail.targetUserId) query.set('targetUserId', detail.targetUserId);
  if (detail.companyId) query.set('companyId', detail.companyId);
  if (detail.membershipId) query.set('membershipId', detail.membershipId);
  return `/system/data-rights/new?${query.toString()}`;
}

function RequiredLabel({ children }: { children: ReactNode }) {
  return <>{children} <span className="text-red-600" aria-label="จำเป็น">*</span></>;
}

function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p role="alert" className="mt-1 text-xs text-red-600">{children}</p>;
}

/**
 * The explicit single-admin step: the reason the only System Admin gives for taking a step that a
 * second person would normally take. Shown only when the server says there is one active admin.
 */
function SingleAdminStepField({ step, who, value, onChange }: {
  step: DataRightsSingleAdminStep;
  who: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `single-admin-reason-${step.toLowerCase()}`;
  return (
    <div className="w-full rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left">
      <p className="text-sm font-semibold text-violet-950">ทำขั้นตอนนี้ด้วยตนเอง</p>
      <p className="mt-1 text-sm leading-6 text-violet-900">
        {who} ปกติขั้นตอนนี้ต้องให้ผู้ดูแลระบบอีกคนทำ แต่ตอนนี้ระบบมีผู้ดูแลระบบเพียงคนเดียว คุณจึงทำเองได้เมื่อเขียนเหตุผล
        ระบบจะบันทึกว่าขั้นตอนนี้ทำโดยคนเดียวพร้อมเหตุผลนี้ และแก้ภายหลังไม่ได้
      </p>
      <label htmlFor={id} className="mt-3 block text-sm font-medium text-gray-800">
        <RequiredLabel>เหตุผลที่ทำขั้นตอนนี้ด้วยตนเอง</RequiredLabel>
      </label>
      <textarea
        id={id}
        className={`${textareaClass} mt-1.5`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH}
        placeholder="เช่น ระบบมีผู้ดูแลระบบคนเดียว และคำขอนี้ต้องตอบภายในกำหนด"
      />
      <p className="mt-1 text-xs text-gray-600">
        อย่างน้อย {DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH} ตัวอักษร ไม่ต้องใส่ข้อมูลส่วนบุคคลของผู้ขอ
      </p>
      <FieldError>{value ? singleAdminReasonError(value) : null}</FieldError>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="min-h-dvh bg-[#f6f8f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-4">
        <div className="h-5 w-48 rounded bg-gray-200" />
        <div className="h-44 rounded-3xl bg-white" />
        <div className="grid gap-4 lg:grid-cols-3"><div className="h-48 rounded-2xl bg-white lg:col-span-2" /><div className="h-48 rounded-2xl bg-white" /></div>
      </div>
    </main>
  );
}

function roleTone(value: string | null): string {
  return value ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50';
}

type VerificationForm = {
  reference: string;
  sha256: string;
  note: string;
};

const emptyVerificationForm: VerificationForm = { reference: '', sha256: '', note: '' };

export default function DataRightsDetailPage({ caseId, currentUserId }: { caseId: string; currentUserId: string | null }) {
  const [detail, setDetail] = useState<DataRightsCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [identityMethod, setIdentityMethod] = useState<DataRightsIdentityMethod>('AUTHENTICATED_SESSION');
  const [identityForm, setIdentityForm] = useState<VerificationForm>(emptyVerificationForm);
  const [authorityMethod, setAuthorityMethod] = useState<DataRightsAuthorityMethod>('CURRENT_OWNER_MEMBERSHIP');
  const [authorityForm, setAuthorityForm] = useState<VerificationForm>(emptyVerificationForm);
  const [decisionCategory, setDecisionCategory] = useState<DataRightsDecisionCategory | null>(null);
  const [decisionDisposition, setDecisionDisposition] = useState<DataRightsDisposition>('DELETE');
  const [legalBasisCode, setLegalBasisCode] = useState('');
  const [decisionRationale, setDecisionRationale] = useState('');
  const [retentionUntil, setRetentionUntil] = useState('');
  const [accessRestriction, setAccessRestriction] = useState('');
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [evidenceType, setEvidenceType] = useState<DataRightsEvidenceType>('ACCESS_REVOCATION');
  const [evidenceCategory, setEvidenceCategory] = useState<'' | DataRightsDecisionCategory>('');
  const [evidenceForm, setEvidenceForm] = useState<VerificationForm>(emptyVerificationForm);
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<'COMPLETED' | 'COMPLETED_WITH_EXCEPTION'>('COMPLETED');
  const [completionSummary, setCompletionSummary] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeOutcome, setCloseOutcome] = useState<'REJECTED' | 'CANCELLED' | 'BLOCKED'>('REJECTED');
  const [closeReason, setCloseReason] = useState('');
  const [selfReasons, setSelfReasons] = useState<Partial<Record<DataRightsSingleAdminStep, string>>>({});
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDetail(await getDataRightsCase(caseId));
    } catch (caught) {
      const apiError = caught as Error & { status?: number };
      setLoadError(apiError.status === 404 ? 'ไม่พบเคสนี้ หรือไม่มีสิทธิ์เข้าถึง' : apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const applyCommand = async (name: string, successMessage: string, task: () => Promise<DataRightsCommandResult>) => {
    setBusyAction(name);
    setCommandError(null);
    setSuccess(null);
    try {
      const result = await task();
      setDetail(result.case);
      setSuccess(result.replayed ? `${successMessage} (คำสั่งเดิมถูก replay อย่างปลอดภัย)` : successMessage);
      return true;
    } catch (caught) {
      const apiError = caught as Error & { details?: {
        missingCategories?: string[];
        missingEvidence?: Array<{ evidenceType?: string; category?: string | null }>;
      } };
      const missingCategories = apiError.details?.missingCategories?.map((category) =>
        category in CATEGORY_LABEL ? CATEGORY_LABEL[category as DataRightsDecisionCategory] : 'หมวดข้อมูลที่กำหนด');
      const missingEvidence = apiError.details?.missingEvidence?.map((item) => {
        const evidenceLabel = item.evidenceType && item.evidenceType in EVIDENCE_TYPE_LABEL
          ? EVIDENCE_TYPE_LABEL[item.evidenceType as DataRightsEvidenceType]
          : 'หลักฐานที่กำหนด';
        const categoryLabel = item.category && item.category in CATEGORY_LABEL
          ? CATEGORY_LABEL[item.category as DataRightsDecisionCategory]
          : null;
        return `${evidenceLabel}${categoryLabel ? ` / ${categoryLabel}` : ''}`;
      });
      setCommandError([
        apiErrorMessage(caught),
        missingCategories?.length ? `ขาดหมวด: ${missingCategories.join(', ')}` : '',
        missingEvidence?.length ? `ขาดหลักฐาน: ${missingEvidence.join(', ')}` : '',
      ].filter(Boolean).join(' · '));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const currentDecisions = useMemo(() => latestDecisions(detail?.decisions ?? []), [detail?.decisions]);
  const decisionMissing = useMemo(() => missingDecisionCategories(detail?.decisions ?? []), [detail?.decisions]);
  const executionEvidenceMissing = useMemo(() => detail
    ? missingEvidenceRequirements(detail.caseType, detail.decisions, detail.evidence, false)
    : [], [detail]);
  const completionEvidenceMissing = useMemo(() => detail
    ? missingEvidenceRequirements(detail.caseType, detail.decisions, detail.evidence, true)
    : [], [detail]);
  const availableEvidenceTypes = useMemo(() => {
    if (!detail) return [];
    if (detail.status === 'VERIFICATION') {
      const hasOwnIndependentEvidence = detail.evidence.some((item) => item.evidenceType === 'INDEPENDENT_VERIFICATION'
        && (!currentUserId || item.recordedByUserId === currentUserId)
        && isValidEvidenceSha256(item.sha256));
      return hasOwnIndependentEvidence ? [] : ['INDEPENDENT_VERIFICATION' as const];
    }
    const required = new Set(executionEvidenceMissing.map((item) => item.evidenceType));
    return recordableEvidenceTypesForStatus(detail.status).filter((type) => required.has(type));
  }, [currentUserId, detail, executionEvidenceMissing]);
  const retainedCategories = useMemo(() => retainedDecisionCategories(detail?.decisions ?? []), [detail?.decisions]);

  useEffect(() => {
    setCompletionOutcome(completionOutcomeForDecisions(detail?.decisions ?? []));
  }, [detail?.decisions]);

  useEffect(() => {
    if (availableEvidenceTypes.length && detail) {
      const nextType = availableEvidenceTypes.includes(evidenceType)
        ? evidenceType
        : availableEvidenceTypes[0];
      const missing = missingEvidenceRequirements(
        detail.caseType,
        detail.decisions,
        detail.evidence,
        detail.status === 'VERIFICATION',
      );
      const eligibleCategories = missing
        .filter((item) => item.evidenceType === nextType && item.category)
        .map((item) => item.category as DataRightsDecisionCategory);
      const fixedCategory = requiredEvidenceCategory(nextType);
      const nextCategory = fixedCategory
        ?? (evidenceCategory && eligibleCategories.includes(evidenceCategory) ? evidenceCategory : eligibleCategories[0])
        ?? '';

      if (nextType !== evidenceType) {
        setEvidenceType(nextType);
      }
      if (nextCategory !== evidenceCategory) setEvidenceCategory(nextCategory);
    }
  }, [availableEvidenceTypes, detail, evidenceCategory, evidenceType]);

  if (loading) return <DetailSkeleton />;
  if (!detail || loadError) {
    return (
      <main className="min-h-dvh bg-[#f6f8f7] px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-950">เปิดรายละเอียดไม่ได้</h1>
          <p className="mt-2 text-sm text-red-700">{loadError ?? 'ไม่พบข้อมูล'}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/system/data-rights" className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">กลับไปรายการ</Link>
            <button type="button" onClick={() => void load()} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">ลองใหม่</button>
          </div>
        </div>
      </main>
    );
  }

  const requiresAuthority = dataRightsCaseRequiresTenantAuthority(detail.caseType);
  const overdue = isOverdueCase(detail);
  const retainedDecision = decisionDisposition === 'RETAIN' || decisionDisposition === 'RESTRICT';
  const phaseIndex = detail.status === 'COMPLETED_WITH_EXCEPTION' ? PHASES.length - 1 : PHASES.findIndex(([status]) => status === detail.status);
  const canReject = ['RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW'].includes(detail.status);
  const canCancel = ['RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW', 'APPROVED'].includes(detail.status);
  const canClose = canReject || canCancel;
  const canBlock = ['APPROVED', 'EXECUTING', 'VERIFICATION'].includes(detail.status);
  const fixedEvidenceCategory = requiredEvidenceCategory(evidenceType);
  const evidenceCategoryRequired = evidenceTypeRequiresCategory(evidenceType);
  const phaseEvidenceMissing = detail.status === 'VERIFICATION' ? completionEvidenceMissing : executionEvidenceMissing;
  const eligibleEvidenceCategories = [...new Set(phaseEvidenceMissing
    .filter((item) => item.evidenceType === evidenceType && item.category)
    .map((item) => item.category as DataRightsDecisionCategory))];
  const sameActor = dataRightsSameActorModes({
    currentUserId,
    createdByUserId: detail.createdByUserId,
    approvedByUserId: detail.approvedByUserId,
    executionStartedByUserId: detail.executionStartedByUserId,
    singleAdminAvailable: detail.singleAdminAvailable,
  });
  const selfSteps = singleAdminSteps(detail);
  const selfReason = (step: DataRightsSingleAdminStep) => selfReasons[step] ?? '';
  const setSelfReason = (step: DataRightsSingleAdminStep) => (value: string) =>
    setSelfReasons((current) => ({ ...current, [step]: value }));
  /** Sent only with a self-step; a step two different people take carries no reason at all. */
  const selfReasonFor = (mode: DataRightsSameActorMode, step: DataRightsSingleAdminStep) =>
    mode === 'SINGLE_ADMIN' ? selfReason(step).trim() : undefined;
  const selfReasonReady = (mode: DataRightsSameActorMode, step: DataRightsSingleAdminStep) =>
    mode !== 'SINGLE_ADMIN' || singleAdminReasonError(selfReason(step)) === null;
  const selfIndependentEvidence = detail.status === 'VERIFICATION' && sameActor.verification === 'SINGLE_ADMIN';
  const currentUserIndependentEvidence = detail.evidence.some((item) =>
    item.evidenceType === 'INDEPENDENT_VERIFICATION'
      && (!currentUserId || item.recordedByUserId === currentUserId)
      && isValidEvidenceSha256(item.sha256));

  const openDecision = (category: DataRightsDecisionCategory) => {
    const existing = currentDecisions.get(category) as DataRightsDecisionRecord | undefined;
    const allowedDispositions = dataRightsAllowedDispositions(detail.caseType, category);
    setDecisionCategory(category);
    setDecisionDisposition(
      existing && allowedDispositions.includes(existing.disposition)
        ? existing.disposition
        : allowedDispositions[0]!,
    );
    setLegalBasisCode(existing?.legalBasisCode ?? '');
    setDecisionRationale(existing?.rationale ?? '');
    setRetentionUntil(existing?.retentionUntil?.slice(0, 10) ?? '');
    setAccessRestriction(existing?.accessRestriction ?? '');
    setDecisionErrors({});
  };

  const submitIdentity = async (event: FormEvent) => {
    event.preventDefault();
    if (!identityForm.reference.trim()) {
      setCommandError('กรุณาระบุ reference ของหลักฐานยืนยันตัวตน');
      return;
    }
    if (!EVIDENCE_REFERENCE_PATTERN.test(identityForm.reference.trim())) {
      setCommandError('Reference ต้องขึ้นต้นด้วย evidence://, run://, approval:// หรือ case:// และห้ามมีข้อมูลลับ');
      return;
    }
    if (identityForm.sha256 && !/^[0-9a-fA-F]{64}$/.test(identityForm.sha256)) {
      setCommandError('SHA-256 ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร');
      return;
    }
    const ok = await applyCommand('identity', 'ยืนยันตัวตนและบันทึกหลักฐานแล้ว', () => verifyDataRightsIdentity(detail.id, {
      commandId: crypto.randomUUID(),
      method: identityMethod,
      reference: identityForm.reference.trim(),
      ...(identityForm.sha256 ? { sha256: identityForm.sha256.toLowerCase() } : {}),
      ...(identityForm.note.trim() ? { note: identityForm.note.trim() } : {}),
    }));
    if (ok) setIdentityForm(emptyVerificationForm);
  };

  const submitAuthority = async (event: FormEvent) => {
    event.preventDefault();
    if (!authorityForm.reference.trim()) {
      setCommandError('กรุณาระบุ reference ของหลักฐานยืนยันอำนาจ');
      return;
    }
    if (!EVIDENCE_REFERENCE_PATTERN.test(authorityForm.reference.trim())) {
      setCommandError('Reference ต้องขึ้นต้นด้วย evidence://, run://, approval:// หรือ case:// และห้ามมีข้อมูลลับ');
      return;
    }
    if (authorityForm.sha256 && !/^[0-9a-fA-F]{64}$/.test(authorityForm.sha256)) {
      setCommandError('SHA-256 ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร');
      return;
    }
    const ok = await applyCommand('authority', 'ยืนยันอำนาจกิจการแล้ว', () => verifyDataRightsAuthority(detail.id, {
      commandId: crypto.randomUUID(),
      method: authorityMethod,
      reference: authorityForm.reference.trim(),
      ...(authorityForm.sha256 ? { sha256: authorityForm.sha256.toLowerCase() } : {}),
      ...(authorityForm.note.trim() ? { note: authorityForm.note.trim() } : {}),
    }));
    if (ok) setAuthorityForm(emptyVerificationForm);
  };

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!decisionCategory) return;
    const nextErrors: Record<string, string> = {};
    if (!dataRightsAllowedDispositions(detail.caseType, decisionCategory).includes(decisionDisposition)) {
      nextErrors.disposition = 'แนวทางนี้อยู่นอกขอบเขตของประเภทคำขอและไม่สามารถบันทึกได้';
    }
    if (!legalBasisCode.trim()) nextErrors.legalBasisCode = 'กรุณาระบุฐานกฎหมาย/นโยบายที่ตรวจสอบได้';
    if (!decisionRationale.trim()) nextErrors.rationale = 'กรุณาอธิบายเหตุผลเฉพาะหมวดนี้';
    if (retainedDecision && !retentionUntil) nextErrors.retentionUntil = 'ต้องระบุวันสิ้นสุดเมื่อเก็บหรือจำกัดข้อมูล';
    if (retainedDecision && retentionUntil && new Date(`${retentionUntil}T23:59:59+07:00`) <= new Date()) {
      nextErrors.retentionUntil = 'วันทบทวน/สิ้นสุดต้องอยู่ในอนาคต';
    }
    if (retainedDecision && !accessRestriction.trim()) nextErrors.accessRestriction = 'ต้องระบุผู้ที่เข้าถึงได้และข้อจำกัด';
    setDecisionErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const ok = await applyCommand(`decision-${decisionCategory}`, `บันทึกคำตัดสิน “${CATEGORY_LABEL[decisionCategory]}” แล้ว`, () => recordDataRightsDecision(detail.id, {
      commandId: crypto.randomUUID(),
      category: decisionCategory,
      disposition: decisionDisposition,
      legalBasisCode: legalBasisCode.trim(),
      rationale: decisionRationale.trim(),
      ...(retainedDecision ? {
        retentionUntil: new Date(`${retentionUntil}T23:59:59+07:00`).toISOString(),
        accessRestriction: accessRestriction.trim(),
      } : {}),
    }));
    if (ok) setDecisionCategory(null);
  };

  const submitEvidence = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!evidenceForm.reference.trim()) nextErrors.reference = 'กรุณาระบุ URI หรือเลขอ้างอิงในคลังหลักฐานที่จำกัดสิทธิ์';
    else if (!EVIDENCE_REFERENCE_PATTERN.test(evidenceForm.reference.trim())) nextErrors.reference = 'ใช้เฉพาะ evidence://, run://, approval:// หรือ case:// ตามด้วยรหัสที่ไม่ใช่ข้อมูลลับ';
    if (!evidenceForm.sha256) nextErrors.sha256 = 'หลักฐานดำเนินการต้องมี SHA-256';
    else if (!/^[0-9a-fA-F]{64}$/.test(evidenceForm.sha256)) nextErrors.sha256 = 'SHA-256 ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร';
    const fixedCategory = requiredEvidenceCategory(evidenceType);
    const resolvedCategory = fixedCategory ?? evidenceCategory;
    if (evidenceTypeRequiresCategory(evidenceType) && !resolvedCategory) nextErrors.category = 'หลักฐานประเภทนี้ต้องผูกหมวดข้อมูล';
    if (resolvedCategory && !eligibleEvidenceCategories.includes(resolvedCategory)) {
      nextErrors.category = 'หมวดนี้ไม่มีคำตัดสินปัจจุบันที่ต้องใช้หลักฐานประเภทนี้';
    }
    if (evidenceType === 'RETENTION_HOLD' && resolvedCategory && !retainedCategories.includes(resolvedCategory)) {
      nextErrors.category = 'เลือกได้เฉพาะหมวดที่มีคำตัดสิน RETAIN หรือ RESTRICT';
    }
    const selfStepReason = selfIndependentEvidence && evidenceType === 'INDEPENDENT_VERIFICATION'
      ? selfReason('INDEPENDENT_VERIFICATION')
      : undefined;
    const selfStepError = selfStepReason === undefined ? null : singleAdminReasonError(selfStepReason);
    if (selfStepError) nextErrors.singleAdminReason = selfStepError;
    setEvidenceErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const ok = await applyCommand('evidence', 'เพิ่ม reference หลักฐานแล้ว', () => recordDataRightsEvidence(detail.id, {
      commandId: crypto.randomUUID(),
      evidenceType,
      ...(resolvedCategory ? { category: resolvedCategory } : {}),
      reference: evidenceForm.reference.trim(),
      sha256: evidenceForm.sha256.toLowerCase(),
      ...(evidenceForm.note.trim() ? { note: evidenceForm.note.trim() } : {}),
      ...(selfStepReason !== undefined && { singleAdminReason: selfStepReason.trim() }),
    }));
    if (ok) {
      setEvidenceForm(emptyVerificationForm);
      setEvidenceCategory('');
      setEvidenceErrors({});
    }
  };

  const confirmTransition = async (
    name: string,
    title: string,
    message: ReactNode,
    successMessage: string,
    task: () => Promise<DataRightsCommandResult>,
  ) => {
    if (!(await confirm({ title, message, confirmLabel: 'ยืนยันและบันทึก', variant: 'primary' }))) return;
    await applyCommand(name, successMessage, task);
  };

  const submitCompletion = async (event: FormEvent) => {
    event.preventDefault();
    if (!completionSummary.trim()) {
      setCommandError('กรุณาสรุปสิ่งที่ทำ สิ่งที่เก็บไว้ และข้อยกเว้นให้ผู้ตรวจสอบเข้าใจ');
      return;
    }
    const selfStepReason = selfReasonFor(sameActor.verification, 'COMPLETION');
    const selfStepError = selfStepReason === undefined ? null : singleAdminReasonError(selfStepReason);
    if (selfStepError) {
      setCommandError(selfStepError);
      return;
    }
    const ok = await applyCommand('complete', 'ปิดเคสและบันทึกผลแล้ว', () => completeDataRightsCase(detail.id, {
      commandId: crypto.randomUUID(),
      outcome: completionOutcomeForDecisions(detail.decisions),
      outcomeSummary: completionSummary.trim(),
      ...(selfStepReason !== undefined && { singleAdminReason: selfStepReason }),
    }));
    if (ok) setCompletionOpen(false);
  };

  const submitClose = async (event: FormEvent) => {
    event.preventDefault();
    if (!closeReason.trim()) {
      setCommandError('กรุณาระบุเหตุผลที่ตรวจสอบย้อนหลังได้');
      return;
    }
    const ok = await applyCommand(
      'close',
      closeOutcome === 'REJECTED' ? 'ปฏิเสธคำขอแล้ว' : closeOutcome === 'BLOCKED' ? 'หยุดเคสเพื่อแก้ไขข้อขัดข้องแล้ว' : 'ยกเลิกเคสแล้ว',
      () => closeDataRightsCase(detail.id, {
      commandId: crypto.randomUUID(),
      outcome: closeOutcome,
      reason: closeReason.trim(),
      }),
    );
    if (ok) setCloseOpen(false);
  };

  return (
    <main className="min-h-dvh bg-[#f6f8f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/system/data-rights" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-emerald-700">← กลับไปรายการคำขอ</Link>
          <span className="break-all rounded-lg bg-gray-100 px-2.5 py-1 font-mono text-xs text-gray-600">Case ID: {detail.id}</span>
        </div>

        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_40%),linear-gradient(135deg,#ffffff,#f7fff9)] p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_TONE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
                  {overdue && <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">เกินกำหนด</span>}
                  {selfSteps.length > 0 && <span className="rounded-full border border-violet-200 bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-900">มีขั้นตอนที่ทำโดยผู้ดูแลระบบคนเดียว</span>}
                </div>
                <h1 className="mt-3 text-2xl font-bold text-gray-950 sm:text-3xl">{CASE_TYPE_LABEL[detail.caseType]}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{CASE_TYPE_DESCRIPTION[detail.caseType]}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 text-right shadow-sm">
                <p className="text-xs text-gray-500">กำหนดตอบกลับ</p>
                <p className={`mt-1 text-sm font-semibold ${overdue ? 'text-red-700' : 'text-gray-900'}`}>{formatDateTime(detail.dueAt)}</p>
              </div>
            </div>

            {!['REJECTED', 'CANCELLED', 'BLOCKED'].includes(detail.status) && (
              <ol aria-label="ความคืบหน้าเคส" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {PHASES.map(([status, label], index) => {
                  const reached = phaseIndex >= index || isTerminalStatus(detail.status);
                  const active = detail.status === status || (status === 'COMPLETED' && detail.status === 'COMPLETED_WITH_EXCEPTION');
                  return (
                    <li key={status} className={`rounded-xl border px-2.5 py-2 text-center text-xs font-semibold ${active ? 'border-emerald-500 bg-emerald-600 text-white' : reached ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-400'}`}>
                      <span className="block text-[10px] opacity-75">{index + 1}</span>{label}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <div className="grid gap-px border-t border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['เลขอ้างอิง', detail.requestKey],
              ['ช่องทาง', SOURCE_LABEL[detail.requestSource]],
              ['รับเรื่อง', formatDateTime(detail.receivedAt)],
              ['อัปเดตล่าสุด', formatDateTime(detail.updatedAt)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 bg-white px-4 py-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 break-all text-sm font-semibold text-gray-800">{value}</p>
              </div>
            ))}
          </div>
        </section>

        {commandError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{commandError}</div>}
        {success && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">✓ {success}</div>}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">ขอบเขตเป้าหมาย</h2>
                <p className="mt-1 text-sm text-gray-500">รหัส immutable ที่บันทึกตอนรับเรื่อง</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">ห้ามเปลี่ยนระหว่างเคส</span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ['User ID', detail.targetUserId],
                ['Company ID', detail.companyId],
                ['Membership ID', detail.membershipId],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="mt-1 break-all font-mono text-sm font-semibold text-gray-800">{value ?? 'ไม่อยู่ในขอบเขต'}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-semibold text-red-900"><span aria-hidden="true">⚠</span> ระบบไม่ได้ลบข้อมูลให้เอง</h2>
            <p className="mt-2 text-sm leading-6 text-red-800">ระบบบันทึกขั้นตอนของเคสเท่านั้น ไม่ได้ลบ แก้ไข หรือส่งออกข้อมูลของผู้ขอให้เอง ทุกขั้นตอนรวมถึง “เริ่มดำเนินการ” และ “ปิดเคส” เป็นการบันทึกว่าใครทำอะไรเมื่อไร การลบหรือส่งออกข้อมูลจริงต้องทำแยกต่างหากตามคู่มือ แล้วนำหลักฐานมาบันทึกในเคสนี้</p>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">การแยกหน้าที่และผู้รับผิดชอบ</h2>
              <p className="mt-1 text-sm text-gray-500">แต่ละขั้นตอนควรทำโดยคนละคนกับขั้นก่อนหน้า หน้านี้แสดงว่าใครทำขั้นตอนใดเพื่อตรวจสอบย้อนหลัง</p>
            </div>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">{detail.singleAdminAvailable ? 'ตอนนี้มีผู้ดูแลระบบคนเดียว' : 'ต้องใช้ผู้ดูแลระบบสองคน'}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {([
              ['ผู้เปิดเคส', detail.createdByUserId, detail.createdAt, false],
              ['ผู้อนุมัติ', detail.approvedByUserId, detail.approvedAt, detail.approvalSingleAdmin],
              ['ผู้ดำเนินการ', detail.executionStartedByUserId, detail.executionStartedAt, detail.executionSingleAdmin],
              ['ผู้เริ่มตรวจ', detail.verificationStartedByUserId, detail.verificationStartedAt, detail.verificationSingleAdmin],
              ['ผู้ปิดเคส', detail.completedByUserId, detail.completedAt, detail.completionSingleAdmin],
            ] as const).map(([label, userId, at, alone]) => (
              <div key={label} className={`rounded-xl border p-3 ${roleTone(userId)}`}>
                <p className="text-xs font-semibold text-gray-600">{label}</p>
                <p className="mt-1 break-all font-mono text-xs text-gray-900">{actor(userId)}{userId && userId === currentUserId ? ' (คุณ)' : ''}</p>
                <p className="mt-2 text-[11px] text-gray-500">{formatDateTime(at)}</p>
                {alone && <p className="mt-2 text-[11px] font-semibold text-violet-800">ทำโดยผู้ดูแลระบบคนเดียว</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 text-xs text-violet-900 sm:grid-cols-3">
            <p className="rounded-xl bg-violet-50 px-3 py-2">ผู้อนุมัติไม่ควรเป็นผู้เปิดเคส</p>
            <p className="rounded-xl bg-violet-50 px-3 py-2">ผู้ดำเนินการไม่ควรเป็นผู้อนุมัติ</p>
            <p className="rounded-xl bg-violet-50 px-3 py-2">ผู้เริ่มตรวจ ผู้บันทึกผลตรวจ และผู้ปิดเคส ไม่ควรเป็นผู้ดำเนินการ</p>
          </div>
          <p className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-950">
            {detail.singleAdminAvailable
              ? 'ตอนนี้ระบบมีผู้ดูแลระบบเพียงคนเดียว ขั้นตอนที่ปกติต้องให้อีกคนทำ คุณทำเองได้ โดยต้องเขียนเหตุผลทุกครั้ง ระบบจะบันทึกว่าขั้นตอนนั้นทำโดยคนเดียวและเก็บเหตุผลไว้กับเคสนี้ถาวร'
              : 'ตอนนี้ระบบมีผู้ดูแลระบบมากกว่าหนึ่งคน ขั้นตอนที่คุณทำขั้นก่อนหน้าไว้เอง ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ทำ'}
          </p>
          {selfSteps.length > 0 && (
            <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-violet-950">ขั้นตอนที่ทำโดยผู้ดูแลระบบคนเดียวในเคสนี้</h3>
              <ul className="mt-2 space-y-2 text-sm text-gray-800">
                {selfSteps.map(({ step, reason }) => (
                  <li key={step} className="rounded-xl bg-violet-50 px-3 py-2">
                    <span className="font-semibold">{SINGLE_ADMIN_STEP_LABEL[step]}</span>
                    <span className="mt-1 block whitespace-pre-wrap break-words text-gray-700">เหตุผล: {reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">ขั้นที่ 1</p>
              <h2 className="mt-1 text-lg font-semibold text-gray-950">ยืนยันตัวตนและอำนาจ</h2>
            </div>
            <span className="text-xs text-gray-500"><span className="text-red-600">*</span> ข้อมูลจำเป็น</span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className={`rounded-2xl border p-4 ${detail.identityVerifiedAt ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-900">ตัวตนผู้ขอ</h3>
                <span className={`text-xs font-semibold ${detail.identityVerifiedAt ? 'text-emerald-700' : 'text-gray-500'}`}>{detail.identityVerifiedAt ? '✓ ยืนยันแล้ว' : 'รอดำเนินการ'}</span>
              </div>
              {detail.identityVerifiedAt ? (
                <p className="mt-3 text-sm text-gray-600">โดย <span className="font-mono">{detail.identityVerifiedByUserId}</span> · {formatDateTime(detail.identityVerifiedAt)}</p>
              ) : detail.status === 'RECEIVED' ? (
                <form onSubmit={submitIdentity} className="mt-4 space-y-3">
                  <label className="block text-sm font-medium text-gray-700"><RequiredLabel>วิธีตรวจสอบ</RequiredLabel>
                    <ThemedSelect className="mt-1.5" value={identityMethod} onChange={(event) => setIdentityMethod(event.target.value as DataRightsIdentityMethod)}>
                      {DATA_RIGHTS_IDENTITY_METHODS.map((value) => <option key={value} value={value}>{IDENTITY_METHOD_LABEL[value]}</option>)}
                    </ThemedSelect>
                  </label>
                  <label className="block text-sm font-medium text-gray-700"><RequiredLabel>Evidence reference</RequiredLabel>
                    <input className={`${inputClass} mt-1.5`} value={identityForm.reference} onChange={(event) => setIdentityForm((current) => ({ ...current, reference: event.target.value }))} placeholder="evidence://identity/case-reference" maxLength={500} />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">SHA-256 (ถ้ามี)
                    <input className={`${inputClass} mt-1.5 font-mono`} value={identityForm.sha256} onChange={(event) => setIdentityForm((current) => ({ ...current, sha256: event.target.value }))} maxLength={64} />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">หมายเหตุที่ไม่ใช่ข้อมูลดิบ
                    <textarea className={`${textareaClass} mt-1.5 min-h-20`} value={identityForm.note} onChange={(event) => setIdentityForm((current) => ({ ...current, note: event.target.value }))} maxLength={2000} />
                  </label>
                  <Button type="submit" loading={busyAction === 'identity'}>ยืนยันตัวตน</Button>
                </form>
              ) : <p className="mt-3 text-sm text-red-700">สถานะไม่สอดคล้อง: ยังไม่มีหลักฐานยืนยันตัวตน</p>}
            </div>

            <div className={`rounded-2xl border p-4 ${!requiresAuthority || detail.authorityVerifiedAt ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-900">อำนาจสั่งการแทนกิจการ</h3>
                <span className={`text-xs font-semibold ${!requiresAuthority || detail.authorityVerifiedAt ? 'text-emerald-700' : 'text-gray-500'}`}>{!requiresAuthority ? 'ไม่ต้องใช้' : detail.authorityVerifiedAt ? '✓ ยืนยันแล้ว' : 'รอดำเนินการ'}</span>
              </div>
              {!requiresAuthority ? (
                <p className="mt-3 text-sm text-gray-600">การลบบัญชีผู้ใช้ไม่ใช่คำสั่งลบข้อมูลของกิจการ จึงไม่ใช้อำนาจ tenant ในขั้นนี้</p>
              ) : detail.authorityVerifiedAt ? (
                <p className="mt-3 text-sm text-gray-600">โดย <span className="font-mono">{detail.authorityVerifiedByUserId}</span> · {formatDateTime(detail.authorityVerifiedAt)}</p>
              ) : detail.status === 'IDENTITY_VERIFIED' ? (
                <form onSubmit={submitAuthority} className="mt-4 space-y-3">
                  <label className="block text-sm font-medium text-gray-700"><RequiredLabel>วิธีตรวจอำนาจ</RequiredLabel>
                    <ThemedSelect className="mt-1.5" value={authorityMethod} onChange={(event) => setAuthorityMethod(event.target.value as DataRightsAuthorityMethod)}>
                      {DATA_RIGHTS_AUTHORITY_METHODS.filter((value) => value !== 'NOT_REQUIRED').map((value) => <option key={value} value={value}>{AUTHORITY_METHOD_LABEL[value]}</option>)}
                    </ThemedSelect>
                  </label>
                  <label className="block text-sm font-medium text-gray-700"><RequiredLabel>Evidence reference</RequiredLabel>
                    <input className={`${inputClass} mt-1.5`} value={authorityForm.reference} onChange={(event) => setAuthorityForm((current) => ({ ...current, reference: event.target.value }))} placeholder="approval://authority/case-reference" maxLength={500} />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">SHA-256 (ถ้ามี)
                    <input className={`${inputClass} mt-1.5 font-mono`} value={authorityForm.sha256} onChange={(event) => setAuthorityForm((current) => ({ ...current, sha256: event.target.value }))} maxLength={64} />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">หมายเหตุที่ไม่ใช่เอกสารดิบ
                    <textarea className={`${textareaClass} mt-1.5 min-h-20`} value={authorityForm.note} onChange={(event) => setAuthorityForm((current) => ({ ...current, note: event.target.value }))} maxLength={2000} />
                  </label>
                  <Button type="submit" loading={busyAction === 'authority'}>ยืนยันอำนาจ</Button>
                </form>
              ) : <p className="mt-3 text-sm text-gray-600">ยืนยันตัวตนผู้ขอก่อน แล้วจึงตรวจอำนาจสั่งการแทนกิจการ</p>}
            </div>
          </div>

          {canBeginRetentionReview(detail) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div><p className="font-semibold text-emerald-900">พร้อมทบทวนการเก็บรักษา</p><p className="mt-1 text-xs text-emerald-800">ขั้นถัดไปต้องตัดสินใจให้ครบ 12 หมวดก่อนส่งอนุมัติ</p></div>
              <Button
                type="button"
                loading={busyAction === 'retention'}
                onClick={() => void confirmTransition('retention', 'เริ่มทบทวนการเก็บรักษา', 'เมื่อเริ่มแล้ว ให้ผู้ตรวจทบทวนข้อมูลทุกชั้นและบันทึกคำตัดสินทั้ง 12 หมวด', 'เริ่มทบทวนการเก็บรักษาแล้ว', () => beginDataRightsRetentionReview(detail.id, crypto.randomUUID()))}
              >เริ่มทบทวน 12 หมวด</Button>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">ขั้นที่ 2</p>
              <h2 className="mt-1 text-lg font-semibold text-gray-950">คำตัดสินข้อมูล 12 หมวด</h2>
              <p className="mt-1 text-sm text-gray-500">แต่ละหมวดต้องระบุว่าจะลบ ทำให้ไม่ระบุตัว จำกัด เก็บ ส่งคืน หรือไม่เกี่ยวข้อง พร้อมฐานและเหตุผล</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-950">{12 - decisionMissing.length}<span className="text-base text-gray-400">/12</span></p>
              <p className="text-xs text-gray-500">หมวดที่ตัดสินใจแล้ว</p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${((12 - decisionMissing.length) / 12) * 100}%` }} /></div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {DATA_RIGHTS_DECISION_CATEGORIES.map((category, index) => {
              const decision = currentDecisions.get(category);
              return (
                <article key={category} className={`rounded-2xl border p-4 ${decision ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${decision ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{decision ? '✓' : index + 1}</span>
                    {decision && <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800">rev. {decision.revision}</span>}
                  </div>
                  <h3 className="mt-3 font-semibold text-gray-950">{CATEGORY_LABEL[category]}</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{CATEGORY_DESCRIPTION[category]}</p>
                  {decision ? (
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs">
                      <p className="font-semibold text-emerald-800">{DISPOSITION_LABEL[decision.disposition]}</p>
                      <p className="mt-1 line-clamp-2 text-gray-600">{decision.rationale}</p>
                    </div>
                  ) : <p className="mt-3 text-xs font-semibold text-amber-700">ยังไม่มีคำตัดสิน</p>}
                  {detail.status === 'RETENTION_REVIEW' && (
                    <button type="button" onClick={() => openDecision(category)} className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-900">{decision ? 'แก้ไขโดยสร้าง revision ใหม่' : 'บันทึกคำตัดสิน'} →</button>
                  )}
                </article>
              );
            })}
          </div>

          {detail.status === 'RETENTION_REVIEW' && (
            <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${decisionMissing.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div>
                <p className={`font-semibold ${decisionMissing.length ? 'text-amber-900' : 'text-emerald-900'}`}>{decisionMissing.length ? `เหลืออีก ${decisionMissing.length} หมวด` : 'ครบ 12 หมวด พร้อมส่งอนุมัติ'}</p>
                <p className="mt-1 text-xs text-gray-600">การอนุมัติเป็นการยืนยันแผน ไม่ใช่คำสั่ง hard delete</p>
              </div>
              {sameActor.approval === 'SINGLE_ADMIN' && (
                <SingleAdminStepField step="APPROVAL" who="คุณเป็นผู้เปิดเคสนี้" value={selfReason('APPROVAL')} onChange={setSelfReason('APPROVAL')} />
              )}
              <Button
                type="button"
                disabled={decisionMissing.length > 0 || sameActor.approval === 'SECOND_ADMIN' || !selfReasonReady(sameActor.approval, 'APPROVAL')}
                loading={busyAction === 'approve'}
                onClick={() => void confirmTransition(
                  'approve',
                  'อนุมัติแผนจัดการข้อมูล',
                  sameActor.approval === 'SINGLE_ADMIN'
                    ? <span>คุณกำลังอนุมัติเคสที่คุณเปิดเอง ระบบจะบันทึกว่า<strong>ขั้นตอนนี้ทำโดยผู้ดูแลระบบคนเดียว</strong>พร้อมเหตุผลของคุณ การอนุมัติเป็นการยืนยันแผนเท่านั้น ระบบไม่ได้ลบข้อมูลให้</span>
                    : <span>ตรวจครบทั้ง 12 หมวดแล้วหรือไม่? <strong>ผู้อนุมัติต้องไม่ใช่ผู้เปิดเคส</strong></span>,
                  'อนุมัติแผนแล้ว',
                  () => approveDataRightsCase(detail.id, crypto.randomUUID(), selfReasonFor(sameActor.approval, 'APPROVAL')),
                )}
              >{sameActor.approval === 'SINGLE_ADMIN' ? 'อนุมัติแผนด้วยตนเอง' : 'อนุมัติแผน'}</Button>
              {sameActor.approval === 'SECOND_ADMIN' && <p className="w-full text-right text-xs font-semibold text-violet-700">คุณเป็นผู้เปิดเคสนี้ จึงอนุมัติเองไม่ได้ ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้อนุมัติ</p>}
            </div>
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-5">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">ขั้นที่ 3–4</p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">หลักฐานการดำเนินการ</h2>
                <p className="mt-1 text-sm text-gray-500">เก็บเฉพาะ reference, hash และหมายเหตุที่จำเป็น</p>
              </div>
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">ห้ามใส่รหัสผ่าน OTP หรือไฟล์บัตร</span>
            </div>

            {detail.evidence.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">ยังไม่มี reference หลักฐาน</div>
            ) : (
              <div className="mt-4 space-y-2">
                {detail.evidence.map((evidence) => (
                  <article key={evidence.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{EVIDENCE_TYPE_LABEL[evidence.evidenceType]}</p>
                      <p className="text-[11px] text-gray-500">{formatDateTime(evidence.recordedAt)} · <span className="font-mono">{evidence.recordedByUserId}</span></p>
                    </div>
                    <p className="mt-2 break-all rounded-lg bg-white px-2.5 py-2 font-mono text-xs text-gray-700">{evidence.reference}</p>
                    {evidence.category && <p className="mt-2 text-xs text-gray-600">หมวด: {CATEGORY_LABEL[evidence.category]}</p>}
                    {evidence.sha256 && <p className="mt-1 break-all font-mono text-[11px] text-gray-500">SHA-256: {evidence.sha256}</p>}
                    {evidence.note && <p className="mt-1 text-xs leading-5 text-gray-600">{evidence.note}</p>}
                  </article>
                ))}
              </div>
            )}

            {availableEvidenceTypes.length > 0 && !(detail.status === 'VERIFICATION' && sameActor.verification === 'SECOND_ADMIN') && (
              <form onSubmit={submitEvidence} className="mt-5 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                <h3 className="font-semibold text-gray-950">เพิ่ม reference หลักฐาน</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700"><RequiredLabel>ประเภทหลักฐาน</RequiredLabel>
                    <ThemedSelect className="mt-1.5" value={evidenceType} onChange={(event) => {
                      const nextType = event.target.value as DataRightsEvidenceType;
                      setEvidenceType(nextType);
                      const fixed = requiredEvidenceCategory(nextType);
                      setEvidenceCategory(
                        fixed
                        ?? phaseEvidenceMissing.find((item) => item.evidenceType === nextType)?.category
                        ?? '',
                      );
                      setEvidenceErrors({});
                    }}>
                      {availableEvidenceTypes.map((value) => <option key={value} value={value}>{EVIDENCE_TYPE_LABEL[value]}</option>)}
                    </ThemedSelect>
                  </label>
                  <label className="block text-sm font-medium text-gray-700">{evidenceCategoryRequired ? <RequiredLabel>หมวดข้อมูล</RequiredLabel> : 'หมวดข้อมูล (ถ้าเกี่ยวข้อง)'}
                    <ThemedSelect
                      className="mt-1.5"
                      value={fixedEvidenceCategory ?? evidenceCategory}
                      disabled={Boolean(fixedEvidenceCategory)}
                      onChange={(event) => setEvidenceCategory(event.target.value as '' | DataRightsDecisionCategory)}
                    >
                      {!evidenceCategoryRequired && <option value="">ไม่ผูกหมวด</option>}
                      {(fixedEvidenceCategory
                        ? [fixedEvidenceCategory]
                        : eligibleEvidenceCategories
                      ).map((value) => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}
                    </ThemedSelect>
                    {evidenceType === 'RETENTION_HOLD' && retainedCategories.length === 0 && <p className="mt-1 text-xs text-amber-700">ไม่มีหมวด RETAIN/RESTRICT ที่ต้องบันทึก hold</p>}
                    <FieldError>{evidenceErrors.category}</FieldError>
                  </label>
                </div>
                <label className="block text-sm font-medium text-gray-700"><RequiredLabel>Reference</RequiredLabel>
                  <input className={`${inputClass} mt-1.5`} value={evidenceForm.reference} onChange={(event) => setEvidenceForm((current) => ({ ...current, reference: event.target.value }))} placeholder="evidence://…, run://…, approval://… หรือ case://…" maxLength={500} />
                  <FieldError>{evidenceErrors.reference}</FieldError>
                </label>
                <label className="block text-sm font-medium text-gray-700"><RequiredLabel>SHA-256</RequiredLabel>
                  <input className={`${inputClass} mt-1.5 font-mono`} value={evidenceForm.sha256} onChange={(event) => setEvidenceForm((current) => ({ ...current, sha256: event.target.value }))} maxLength={64} />
                  <FieldError>{evidenceErrors.sha256}</FieldError>
                </label>
                <label className="block text-sm font-medium text-gray-700">หมายเหตุ
                  <textarea className={`${textareaClass} mt-1.5 min-h-20`} value={evidenceForm.note} onChange={(event) => setEvidenceForm((current) => ({ ...current, note: event.target.value }))} maxLength={2000} placeholder="สรุปผลโดยไม่คัดลอกข้อมูลลับหรือเนื้อหาเอกสารดิบ" />
                </label>
                {selfIndependentEvidence && evidenceType === 'INDEPENDENT_VERIFICATION' && (
                  <div>
                    <SingleAdminStepField step="INDEPENDENT_VERIFICATION" who="คุณเป็นผู้ดำเนินการเคสนี้ และกำลังบันทึกผลตรวจยืนยันของงานที่คุณทำเอง" value={selfReason('INDEPENDENT_VERIFICATION')} onChange={setSelfReason('INDEPENDENT_VERIFICATION')} />
                    <FieldError>{evidenceErrors.singleAdminReason}</FieldError>
                  </div>
                )}
                <Button type="submit" loading={busyAction === 'evidence'}>บันทึก reference</Button>
              </form>
            )}
            {detail.status === 'VERIFICATION' && sameActor.verification === 'SECOND_ADMIN' && (
              <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">คุณเป็นผู้ดำเนินการเคสนี้ จึงบันทึกผลตรวจยืนยันหรือปิดเคสเองไม่ได้ ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ตรวจ</div>
            )}
          </div>

          <div className="space-y-4 xl:col-span-2">
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-950">การดำเนินการตามสถานะ</h2>
              {detail.status === 'APPROVED' && (
                <div className="mt-4">
                  <p className="text-sm leading-6 text-gray-600">ขั้นตอนนี้บันทึกว่าใครเป็นผู้ดำเนินการ และเปิดให้บันทึกหลักฐาน งานจริงทำตามคู่มือนอกระบบ ผู้ดำเนินการไม่ควรเป็นผู้อนุมัติ</p>
                  {sameActor.execution === 'SINGLE_ADMIN' && (
                    <div className="mt-3">
                      <SingleAdminStepField step="EXECUTION" who="คุณเป็นผู้อนุมัติเคสนี้" value={selfReason('EXECUTION')} onChange={setSelfReason('EXECUTION')} />
                    </div>
                  )}
                  <Button
                    type="button"
                    className="mt-4 w-full"
                    disabled={sameActor.execution === 'SECOND_ADMIN' || !selfReasonReady(sameActor.execution, 'EXECUTION')}
                    loading={busyAction === 'execute'}
                    onClick={() => void confirmTransition(
                      'execute',
                      'เริ่มดำเนินการตามคู่มือ',
                      <span>ขั้นตอนนี้ <strong>ไม่ลบข้อมูลอัตโนมัติ</strong> แต่จะบันทึกคุณเป็นผู้ดำเนินการและเปิดช่วงเก็บหลักฐาน{sameActor.execution === 'SINGLE_ADMIN' ? ' ระบบจะบันทึกว่าขั้นตอนนี้ทำโดยผู้ดูแลระบบคนเดียวพร้อมเหตุผลของคุณ' : ''}</span>,
                      'เริ่มช่วงดำเนินการแล้ว',
                      () => startDataRightsExecution(detail.id, crypto.randomUUID(), selfReasonFor(sameActor.execution, 'EXECUTION')),
                    )}
                  >{sameActor.execution === 'SINGLE_ADMIN' ? 'เริ่มช่วงดำเนินการด้วยตนเอง' : 'เริ่มช่วงดำเนินการ'}</Button>
                  {sameActor.execution === 'SECOND_ADMIN' && <p className="mt-2 text-xs font-semibold text-violet-700">คุณเป็นผู้อนุมัติเคสนี้ จึงเริ่มดำเนินการเองไม่ได้ ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ดำเนินการ</p>}
                </div>
              )}
              {detail.status === 'EXECUTING' && (
                <div className="mt-4">
                  {executionEvidenceMissing.length ? (
                    <><p className="text-sm font-semibold text-amber-800">ยังมีหลักฐานที่ต้องเพิ่ม</p><ul className="mt-2 space-y-1 text-xs text-gray-600">{executionEvidenceMissing.map((item) => <li key={`${item.evidenceType}:${item.category}`}>• {EVIDENCE_TYPE_LABEL[item.evidenceType]}{item.category ? ` — ${CATEGORY_LABEL[item.category]}` : ''}</li>)}</ul></>
                  ) : <p className="text-sm font-semibold text-emerald-800">✓ มีหลักฐานขั้นต่ำพร้อมส่งให้ผู้ตรวจยืนยัน</p>}
                  {sameActor.verification === 'SINGLE_ADMIN' && (
                    <div className="mt-3">
                      <SingleAdminStepField step="VERIFICATION" who="คุณเป็นผู้ดำเนินการเคสนี้" value={selfReason('VERIFICATION')} onChange={setSelfReason('VERIFICATION')} />
                    </div>
                  )}
                  <Button
                    type="button"
                    className="mt-4 w-full"
                    disabled={executionEvidenceMissing.length > 0 || sameActor.verification === 'SECOND_ADMIN' || !selfReasonReady(sameActor.verification, 'VERIFICATION')}
                    loading={busyAction === 'verification'}
                    onClick={() => void confirmTransition(
                      'verification',
                      sameActor.verification === 'SINGLE_ADMIN' ? 'เริ่มตรวจยืนยันด้วยตนเอง' : 'ส่งให้ผู้ตรวจยืนยัน',
                      sameActor.verification === 'SINGLE_ADMIN'
                        ? <span>คุณกำลังเริ่มตรวจงานที่คุณดำเนินการเอง ระบบจะบันทึกว่า<strong>ขั้นตอนนี้ทำโดยผู้ดูแลระบบคนเดียว</strong>พร้อมเหตุผลของคุณ กรุณาตรวจหลักฐานจริง ไม่ใช่ตรวจเฉพาะสถานะ</span>
                        : <span>ผู้เริ่มตรวจต้อง<strong>ไม่ใช่ผู้ดำเนินการ</strong> และต้องตรวจหลักฐานจริง ไม่ใช่ตรวจเฉพาะสถานะ</span>,
                      'เริ่มช่วงตรวจยืนยันแล้ว',
                      () => startDataRightsVerification(detail.id, crypto.randomUUID(), selfReasonFor(sameActor.verification, 'VERIFICATION')),
                    )}
                  >{sameActor.verification === 'SINGLE_ADMIN' ? 'เริ่มตรวจยืนยันด้วยตนเอง' : 'ส่งให้ผู้ตรวจยืนยัน'}</Button>
                  {sameActor.verification === 'SECOND_ADMIN' && <p className="mt-2 text-xs font-semibold text-violet-700">คุณเป็นผู้ดำเนินการเคสนี้ จึงเริ่มตรวจยืนยันเองไม่ได้ ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ตรวจ</p>}
                </div>
              )}
              {detail.status === 'VERIFICATION' && (
                <div className="mt-4">
                  {completionEvidenceMissing.length ? (
                    <><p className="text-sm font-semibold text-amber-800">ยังปิดเคสไม่ได้ ขาดหลักฐาน</p><ul className="mt-2 space-y-1 text-xs text-gray-600">{completionEvidenceMissing.map((item) => <li key={`${item.evidenceType}:${item.category}`}>• {EVIDENCE_TYPE_LABEL[item.evidenceType]}{item.category ? ` — ${CATEGORY_LABEL[item.category]}` : ''}</li>)}</ul></>
                  ) : <><p className="text-sm font-semibold text-emerald-800">✓ หลักฐานขั้นต่ำครบ พร้อมสรุปผล</p><p className="mt-2 text-xs leading-5 text-gray-600">ผู้ปิดเคสต้องเป็นคนเดียวกับผู้บันทึกผลตรวจยืนยัน และไม่ควรเป็นผู้ดำเนินการ</p></>}
                  {!currentUserIndependentEvidence && <p className="mt-2 text-xs font-semibold text-amber-700">บัญชีของคุณยังไม่ได้บันทึกผลตรวจยืนยัน</p>}
                  <Button type="button" className="mt-4 w-full" disabled={completionEvidenceMissing.length > 0 || !currentUserIndependentEvidence || sameActor.verification === 'SECOND_ADMIN'} onClick={() => setCompletionOpen(true)}>{sameActor.verification === 'SINGLE_ADMIN' ? 'สรุปผลและปิดเคสด้วยตนเอง' : 'สรุปผลและปิดเคส'}</Button>
                </div>
              )}
              {detail.status === 'RETENTION_REVIEW' && <p className="mt-4 text-sm text-gray-600">ตัดสินใจให้ครบ 12 หมวด แล้วกด “อนุมัติแผน” ในส่วนด้านบน</p>}
              {detail.status === 'RECEIVED' && <p className="mt-4 text-sm text-gray-600">เริ่มจากยืนยันตัวตนผู้ขอในส่วน “ขั้นที่ 1”</p>}
              {detail.status === 'IDENTITY_VERIFIED' && <p className="mt-4 text-sm text-gray-600">{requiresAuthority && !detail.authorityVerifiedAt ? 'ยืนยันอำนาจกิจการก่อนเริ่มทบทวน' : 'พร้อมเริ่มทบทวนการเก็บรักษา'}</p>}
              {isTerminalStatus(detail.status) && (
                <p className={`mt-4 text-sm ${detail.status === 'BLOCKED' ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                  {detail.status === 'BLOCKED'
                    ? 'เคสนี้หยุดโดยไม่อ้างว่าดำเนินการเสร็จ ต้องเปิดเคสติดตามใหม่และอ้าง case:// เคสนี้'
                    : 'เคสนี้ปิดแล้ว ไม่มี action เปลี่ยนแปลงข้อมูลเพิ่มเติม'}
                </p>
              )}
            </div>

            {detail.outcomeSummary && (
              <div className={`rounded-3xl border p-5 shadow-sm ${detail.status === 'BLOCKED' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <h2 className={`font-semibold ${detail.status === 'BLOCKED' ? 'text-red-950' : 'text-emerald-950'}`}>{detail.status === 'BLOCKED' ? 'เหตุที่หยุดดำเนินการ' : 'ผลสรุปเคส'}</h2>
                <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${detail.status === 'BLOCKED' ? 'text-red-900' : 'text-emerald-900'}`}>{detail.outcomeSummary}</p>
                {(detail.status === 'COMPLETED' || detail.status === 'COMPLETED_WITH_EXCEPTION') && (
                  <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-emerald-950">เคสนี้ปิดแล้ว หมายถึงบันทึกครบทุกขั้นตอน ระบบไม่ได้ลบหรือส่งออกข้อมูลให้เอง ผลที่เกิดขึ้นจริงให้ดูจากสรุปด้านบนและหลักฐานที่บันทึกไว้</p>
                )}
              </div>
            )}

            {detail.status === 'BLOCKED' && (
              <div className="rounded-3xl border border-rose-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-gray-950">เปิดเคสแก้ไขเมื่อข้อขัดข้องพร้อมจัดการ</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">เคสใหม่จะใช้ target เดิมและส่ง <span className="font-mono">case://{detail.id}</span> เพื่อเชื่อม audit trail โดย backend จะตรวจว่าเคสนี้เป็น BLOCKED จริง</p>
                <Link href={blockedRemediationHref(detail)} className="mangmee-btn mangmee-btn-primary mt-4 w-full justify-center">เปิดเคส remediation</Link>
              </div>
            )}

            {canClose && (
              <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-gray-950">ปิดโดยไม่ดำเนินการต่อ</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">ใช้เมื่อคำขอไม่ผ่านเงื่อนไขหรือยกเลิกโดยมีเหตุผลที่ตรวจสอบได้</p>
                <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => {
                  setCloseOutcome(detail.status === 'APPROVED' ? 'CANCELLED' : 'REJECTED');
                  setCloseReason('');
                  setCloseOpen(true);
                }}>ปฏิเสธ/ยกเลิกเคส</Button>
              </div>
            )}

            {canBlock && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
                <h2 className="font-semibold text-red-950">พบข้อขัดข้องที่ดำเนินการต่อไม่ได้</h2>
                <p className="mt-2 text-sm leading-6 text-red-800">ใช้เมื่อพบ Object Lock, legal hold, processor/backup ล้มเหลว หรือข้อเท็จจริงใหม่ ห้ามใช้ BLOCKED แทนการอ้างว่าลบเสร็จ</p>
                <Button type="button" variant="danger" className="mt-4 w-full" onClick={() => {
                  setCloseOutcome('BLOCKED');
                  setCloseReason('');
                  setCloseOpen(true);
                }}>หยุดและเปิดทางให้เคสติดตาม</Button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-gray-950">Timeline ที่แก้ย้อนหลังไม่ได้</h2><p className="mt-1 text-sm text-gray-500">command journal แสดงผู้กระทำ สถานะก่อน–หลัง และเวลา</p></div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">{detail.actions.length} เหตุการณ์</span>
          </div>
          <ol className="mt-5 space-y-0">
            {detail.actions.map((action, index) => (
              <li key={action.id} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-5 last:pb-0">
                {index < detail.actions.length - 1 && <span className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-gray-200" />}
                <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-emerald-600 text-xs font-bold text-white">{index + 1}</span>
                <div className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900">{ACTION_LABEL[action.action] ?? action.action}</p>
                    <time className="text-xs text-gray-500">{formatDateTime(action.createdAt)}</time>
                  </div>
                  <p className="mt-1 break-all text-xs text-gray-600">โดย <span className="font-mono">{action.actorUserId}</span> · Request <span className="font-mono">{action.requestId}</span></p>
                  <p className="mt-2 text-xs text-gray-500">{action.fromStatus ? STATUS_LABEL[action.fromStatus] : 'เริ่มต้น'} → {action.toStatus ? STATUS_LABEL[action.toStatus] : 'ไม่เปลี่ยนสถานะ'}</p>
                  {singleAdminReasonOfAction(action.metadataJson) !== null && (
                    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                      <p className="font-semibold">ทำโดยผู้ดูแลระบบคนเดียว</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">เหตุผล: {singleAdminReasonOfAction(action.metadataJson)}</p>
                    </div>
                  )}
                  {priorCaseReference(action.metadataJson) && (
                    <Link
                      href={`/system/data-rights/${encodeURIComponent(priorCaseReference(action.metadataJson)!.slice('case://'.length))}`}
                      className="mt-2 inline-flex font-mono text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      เคสต้นทาง: {priorCaseReference(action.metadataJson)}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Modal
        open={decisionCategory !== null}
        onClose={() => setDecisionCategory(null)}
        title={decisionCategory ? `คำตัดสิน: ${CATEGORY_LABEL[decisionCategory]}` : 'คำตัดสินข้อมูล'}
        size="lg"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setDecisionCategory(null)}>ยกเลิก</Button>
            <Button type="submit" form="data-rights-decision-form" loading={busyAction?.startsWith('decision-')}>บันทึก revision</Button>
          </>
        )}
      >
        {decisionCategory && (
          <form id="data-rights-decision-form" onSubmit={submitDecision} className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              เลือก “ลบตามแผน” เป็นเพียงคำตัดสินของหมวดนี้ ยังไม่ลบข้อมูลจริง การแก้ไขภายหลังจะสร้าง revision ใหม่โดยไม่ทับประวัติเดิม
            </div>
            <label className="block text-sm font-medium text-gray-700"><RequiredLabel>แนวทางจัดการ</RequiredLabel>
              <ThemedSelect className="mt-1.5" value={decisionDisposition} onChange={(event) => {
                const value = event.target.value as DataRightsDisposition;
                setDecisionDisposition(value);
                if (value !== 'RETAIN' && value !== 'RESTRICT') { setRetentionUntil(''); setAccessRestriction(''); }
              }}>
                {dataRightsAllowedDispositions(detail.caseType, decisionCategory).map((value) => (
                  <option key={value} value={value}>{DISPOSITION_LABEL[value]}</option>
                ))}
              </ThemedSelect>
              <FieldError>{decisionErrors.disposition}</FieldError>
            </label>
            <label className="block text-sm font-medium text-gray-700"><RequiredLabel>รหัสฐานกฎหมาย/นโยบาย</RequiredLabel>
              <input className={`${inputClass} mt-1.5 font-mono`} value={legalBasisCode} onChange={(event) => setLegalBasisCode(event.target.value)} maxLength={120} placeholder="รหัสฐานที่ผ่านการตรวจ เช่น ACCOUNTING-ACT-S14" />
              <FieldError>{decisionErrors.legalBasisCode}</FieldError>
            </label>
            <label className="block text-sm font-medium text-gray-700"><RequiredLabel>เหตุผลเฉพาะหมวด</RequiredLabel>
              <textarea className={`${textareaClass} mt-1.5`} value={decisionRationale} onChange={(event) => setDecisionRationale(event.target.value)} maxLength={4000} placeholder="อธิบายขอบเขต เหตุผล และข้อยกเว้น โดยไม่ใช้ข้อความกว้าง ๆ แทนการตรวจจริง" />
              <FieldError>{decisionErrors.rationale}</FieldError>
            </label>
            {retainedDecision && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700"><RequiredLabel>เก็บ/จำกัดถึงวันที่</RequiredLabel>
                  <input type="date" className={`${inputClass} mt-1.5`} value={retentionUntil} onChange={(event) => setRetentionUntil(event.target.value)} />
                  <FieldError>{decisionErrors.retentionUntil}</FieldError>
                </label>
                <label className="block text-sm font-medium text-gray-700"><RequiredLabel>ข้อจำกัดการเข้าถึง</RequiredLabel>
                  <input className={`${inputClass} mt-1.5`} value={accessRestriction} onChange={(event) => setAccessRestriction(event.target.value)} maxLength={2000} placeholder="เช่น legal + accounting reviewer เท่านั้น" />
                  <FieldError>{decisionErrors.accessRestriction}</FieldError>
                </label>
              </div>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={completionOpen}
        onClose={() => setCompletionOpen(false)}
        title="สรุปผลและปิดเคส"
        size="md"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setCompletionOpen(false)}>ยกเลิก</Button>
            <Button type="submit" form="data-rights-completion-form" loading={busyAction === 'complete'}>ยืนยันปิดเคส</Button>
          </>
        )}
      >
        <form id="data-rights-completion-form" onSubmit={submitCompletion} className="space-y-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">อย่าเขียนว่า “ลบถาวรทั้งหมด” หากหลักฐานไม่ครอบคลุม live data, object versions, processor และ backup ตามขอบเขตจริง</div>
          <label className="block text-sm font-medium text-gray-700"><RequiredLabel>ผลลัพธ์</RequiredLabel>
            <ThemedSelect className="mt-1.5" value={completionOutcome} disabled>
              {retainedCategories.length ? (
                <option value="COMPLETED_WITH_EXCEPTION">เสร็จพร้อมข้อยกเว้น — มีข้อมูล RETAIN/RESTRICT</option>
              ) : (
                <option value="COMPLETED">เสร็จสมบูรณ์ตามขอบเขตที่อนุมัติ</option>
              )}
            </ThemedSelect>
            <p className="mt-1 text-xs font-normal text-gray-500">ระบบกำหนดผลลัพธ์จากคำตัดสินล่าสุด เพื่อไม่อ้างว่าไม่มีข้อยกเว้นเมื่อยังเก็บหรือจำกัดข้อมูล</p>
          </label>
          <label className="block text-sm font-medium text-gray-700"><RequiredLabel>สรุปผลสำหรับตรวจสอบและตอบผู้ขอ</RequiredLabel>
            <textarea className={`${textareaClass} mt-1.5 min-h-40`} value={completionSummary} onChange={(event) => setCompletionSummary(event.target.value)} maxLength={4000} placeholder="สิ่งที่ทำแล้ว / สิ่งที่เก็บไว้และฐาน / วันสิ้นสุด / processor-backup / ข้อยกเว้น" />
          </label>
          {sameActor.verification === 'SINGLE_ADMIN' && (
            <SingleAdminStepField step="COMPLETION" who="คุณเป็นผู้ดำเนินการเคสนี้ และกำลังปิดเคสของงานที่คุณทำเอง" value={selfReason('COMPLETION')} onChange={setSelfReason('COMPLETION')} />
          )}
          <p className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">การปิดเคสเป็นการบันทึกว่าทำครบทุกขั้นตอนแล้ว ระบบไม่ได้ลบหรือส่งออกข้อมูลให้เอง</p>
        </form>
      </Modal>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={closeOutcome === 'BLOCKED' ? 'หยุดเคสโดยไม่อ้างว่าเสร็จ' : 'ปฏิเสธหรือยกเลิกเคส'}
        size="sm"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setCloseOpen(false)}>กลับ</Button>
            <Button type="submit" form="data-rights-close-form" variant="danger" loading={busyAction === 'close'}>ยืนยันปิดเคส</Button>
          </>
        )}
      >
        <form id="data-rights-close-form" onSubmit={submitClose} className="space-y-4">
          <label className="block text-sm font-medium text-gray-700"><RequiredLabel>ผลลัพธ์</RequiredLabel>
            <ThemedSelect className="mt-1.5" value={closeOutcome} onChange={(event) => setCloseOutcome(event.target.value as 'REJECTED' | 'CANCELLED' | 'BLOCKED')}>
              {canReject && <option value="REJECTED">ปฏิเสธคำขอพร้อมเหตุผล</option>}
              {canCancel && <option value="CANCELLED">ยกเลิกเคส</option>}
              {canBlock && <option value="BLOCKED">หยุดเพราะพบข้อขัดข้อง — ต้องเปิดเคสติดตาม</option>}
            </ThemedSelect>
          </label>
          <label className="block text-sm font-medium text-gray-700"><RequiredLabel>เหตุผล</RequiredLabel>
            <textarea className={`${textareaClass} mt-1.5`} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} maxLength={4000} placeholder="ระบุข้อเท็จจริง ฐาน และวิธีแจ้งผู้ขอโดยไม่ใส่ข้อมูลลับ" />
          </label>
        </form>
      </Modal>

      {confirmDialog}
    </main>
  );
}
