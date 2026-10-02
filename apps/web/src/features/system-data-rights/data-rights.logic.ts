import {
  DATA_RIGHTS_DECISION_CATEGORIES,
  DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH,
  DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH,
  dataRightsAllowedDispositions,
  dataRightsCaseRequiresTenantAuthority,
  dataRightsCaseEvidenceRequirements,
  dataRightsSingleAdminReasonProblem,
  type DataRightsCaseStatus,
  type DataRightsCaseType,
  type DataRightsDecisionCategory,
  type DataRightsDisposition,
  type DataRightsEvidenceType,
  type DataRightsRequestSource,
  type DataRightsSingleAdminStep,
} from '@watchdog-bms/contracts';

export type DataRightsTargetField = 'targetUserId' | 'companyId' | 'membershipId';

export type CreateDataRightsCaseForm = {
  requestKey: string;
  caseType: DataRightsCaseType;
  requestSource: DataRightsRequestSource;
  requesterContact: string;
  targetUserId: string;
  companyId: string;
  membershipId: string;
  receivedAt: string;
  dueAt: string;
  priorCaseReference: string;
  targetConfirmed: boolean;
};

export type CreateDataRightsCaseErrors = Partial<Record<keyof CreateDataRightsCaseForm, string>>;

export type DecisionLike = {
  category: DataRightsDecisionCategory;
  disposition: DataRightsDisposition;
  revision: number;
};

export type EvidenceLike = {
  evidenceType: DataRightsEvidenceType;
  category?: DataRightsDecisionCategory | null;
  sha256?: string | null;
};

/**
 * How the reader may take a step that is refused to the person who took the step before.
 * - NORMAL: somebody else took that step, so the reader simply takes this one.
 * - SINGLE_ADMIN: the reader took it and is the only active System Admin, so this step is offered
 *   as an explicit self-step with a reason (P31 §8).
 * - SECOND_ADMIN: the reader took it and another active System Admin exists; that person takes it.
 */
export type DataRightsSameActorMode = 'NORMAL' | 'SINGLE_ADMIN' | 'SECOND_ADMIN';

export type DataRightsSameActorModes = {
  approval: DataRightsSameActorMode;
  execution: DataRightsSameActorMode;
  /** Starting verification, recording independent verification and closing the case. */
  verification: DataRightsSameActorMode;
};

export function isValidEvidenceSha256(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Every data-rights case uses the same role boundaries, whatever its type. */
export function dataRightsSameActorModes(input: {
  currentUserId: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  executionStartedByUserId: string | null;
  singleAdminAvailable: boolean;
}): DataRightsSameActorModes {
  const mode = (priorActorUserId: string | null): DataRightsSameActorMode => {
    if (!input.currentUserId || priorActorUserId !== input.currentUserId) return 'NORMAL';
    return input.singleAdminAvailable ? 'SINGLE_ADMIN' : 'SECOND_ADMIN';
  };
  return {
    approval: mode(input.createdByUserId),
    execution: mode(input.approvedByUserId),
    verification: mode(input.executionStartedByUserId),
  };
}

export const SINGLE_ADMIN_STEP_LABEL: Record<DataRightsSingleAdminStep, string> = {
  APPROVAL: 'อนุมัติแผน',
  EXECUTION: 'เริ่มดำเนินการ',
  VERIFICATION: 'เริ่มตรวจยืนยัน',
  INDEPENDENT_VERIFICATION: 'บันทึกผลตรวจยืนยัน',
  COMPLETION: 'สรุปผลและปิดเคส',
};

/** The steps of a case that one person took alone, in order, each with the reason given for it. */
export function singleAdminSteps(input: {
  approvalSingleAdmin: boolean; approvalSingleAdminReason: string | null;
  executionSingleAdmin: boolean; executionSingleAdminReason: string | null;
  verificationSingleAdmin: boolean; verificationSingleAdminReason: string | null;
  completionSingleAdmin: boolean; completionSingleAdminReason: string | null;
  evidence: readonly { evidenceType: DataRightsEvidenceType; singleAdmin?: boolean; singleAdminReason?: string | null }[];
}): Array<{ step: DataRightsSingleAdminStep; reason: string }> {
  const independent = input.evidence.find((item) => item.evidenceType === 'INDEPENDENT_VERIFICATION' && item.singleAdmin === true);
  return ([
    ['APPROVAL', input.approvalSingleAdmin, input.approvalSingleAdminReason],
    ['EXECUTION', input.executionSingleAdmin, input.executionSingleAdminReason],
    ['VERIFICATION', input.verificationSingleAdmin, input.verificationSingleAdminReason],
    ['INDEPENDENT_VERIFICATION', Boolean(independent), independent?.singleAdminReason ?? null],
    ['COMPLETION', input.completionSingleAdmin, input.completionSingleAdminReason],
  ] as const).filter(([, taken]) => taken).map(([step, , reason]) => ({ step, reason: reason ?? '' }));
}

/** What to tell the admin about a reason the server would refuse; null when it is acceptable. */
export function singleAdminReasonError(reason: string): string | null {
  switch (dataRightsSingleAdminReasonProblem(reason)) {
    case 'REQUIRED': return 'กรุณาเขียนเหตุผลที่ทำขั้นตอนนี้ด้วยตนเอง';
    case 'TOO_SHORT': return `เหตุผลสั้นเกินไป กรุณาเขียนอย่างน้อย ${DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH} ตัวอักษร`;
    case 'TOO_LONG': return `เหตุผลยาวเกินไป กรุณาเขียนไม่เกิน ${DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH} ตัวอักษร`;
    case 'TRIVIAL': return 'กรุณาเขียนเหตุผลเป็นประโยคที่อ่านแล้วเข้าใจ';
    default: return null;
  }
}

/** The reason kept on a history entry of a single-admin step; null for every other entry. */
export function singleAdminReasonOfAction(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = metadata as { singleAdmin?: unknown; singleAdminReason?: unknown };
  return value.singleAdmin === true && typeof value.singleAdminReason === 'string' ? value.singleAdminReason : null;
}

const OPAQUE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIOR_CASE_REFERENCE = /^case:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const EVIDENCE_REFERENCE_PATTERN = /^(?:evidence|run|approval|case):\/\/[A-Za-z0-9][A-Za-z0-9._~:/-]{0,479}$/;
const TERMINAL_STATUSES = new Set<DataRightsCaseStatus>([
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'BLOCKED',
  'REJECTED',
  'CANCELLED',
]);

const FIXED_EVIDENCE_CATEGORY: Partial<Record<DataRightsEvidenceType, DataRightsDecisionCategory>> = {
  ACCESS_REVOCATION: 'MEMBERSHIPS_ACCESS',
  OBJECT_STORAGE_INVENTORY: 'ATTACHMENTS_OBJECT_VERSIONS',
  QUEUE_CACHE_PURGE: 'QUEUES_CACHES',
  PROCESSOR_CONFIRMATION: 'PROCESSORS',
  BACKUP_MANIFEST: 'BACKUPS',
};

const EXECUTION_EVIDENCE_TYPES: DataRightsEvidenceType[] = [
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
];

export const CASE_TYPE_LABEL: Record<DataRightsCaseType, string> = {
  USER_ACCOUNT_ERASURE: 'ลบบัญชีผู้ใช้',
  MEMBERSHIP_EXIT: 'ออกจากกิจการหนึ่งแห่ง',
  COMPANY_WORKSPACE_OFFBOARDING: 'ปิดพื้นที่ทำงานทั้งกิจการ',
};

export const CASE_TYPE_DESCRIPTION: Record<DataRightsCaseType, string> = {
  USER_ACCOUNT_ERASURE: 'ยกเลิกบัญชีส่วนบุคคล โดยไม่ลบเอกสารของกิจการหรือบัญชีของผู้อื่น',
  MEMBERSHIP_EXIT: 'ถอนสิทธิ์ผู้ใช้จากกิจการที่ระบุ โดยบัญชีและกิจการอื่นยังอยู่',
  COMPANY_WORKSPACE_OFFBOARDING: 'จัดการข้อมูลทั้งพื้นที่ทำงานตามอำนาจและแผนเก็บรักษาที่อนุมัติ',
};

export const STATUS_LABEL: Record<DataRightsCaseStatus, string> = {
  RECEIVED: 'รับเรื่องแล้ว',
  IDENTITY_VERIFIED: 'ยืนยันตัวตนแล้ว',
  RETENTION_REVIEW: 'ทบทวนการเก็บรักษา',
  APPROVED: 'อนุมัติแผนแล้ว',
  EXECUTING: 'กำลังดำเนินการ',
  VERIFICATION: 'กำลังตรวจยืนยัน',
  COMPLETED: 'เสร็จสมบูรณ์',
  COMPLETED_WITH_EXCEPTION: 'เสร็จพร้อมข้อยกเว้น',
  BLOCKED: 'หยุดดำเนินการ — ต้องเปิดเคสติดตาม',
  REJECTED: 'ปฏิเสธคำขอ',
  CANCELLED: 'ยกเลิกเคส',
};

export const STATUS_TONE: Record<DataRightsCaseStatus, string> = {
  RECEIVED: 'border-blue-200 bg-blue-50 text-blue-700',
  IDENTITY_VERIFIED: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  RETENTION_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  APPROVED: 'border-violet-200 bg-violet-50 text-violet-700',
  EXECUTING: 'border-orange-200 bg-orange-50 text-orange-700',
  VERIFICATION: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMPLETED_WITH_EXCEPTION: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  BLOCKED: 'border-red-300 bg-red-50 text-red-800',
  REJECTED: 'border-red-200 bg-red-50 text-red-700',
  CANCELLED: 'border-gray-200 bg-gray-100 text-gray-600',
};

export const SOURCE_LABEL: Record<DataRightsRequestSource, string> = {
  EMAIL: 'อีเมล',
  SUPPORT: 'ฝ่ายช่วยเหลือ',
  IN_APP: 'ในระบบ',
  OTHER_MONITORED_CHANNEL: 'ช่องทางอื่นที่มีผู้รับผิดชอบ',
};

export const CATEGORY_LABEL: Record<DataRightsDecisionCategory, string> = {
  ACCOUNT_IDENTITY: 'บัญชีและข้อมูลระบุตัวตน',
  AUTHENTICATION_SECRETS: 'รหัสผ่าน เซสชัน และโทเคน',
  MEMBERSHIPS_ACCESS: 'สมาชิก บทบาท และสิทธิ์เข้าถึง',
  TENANT_OPERATIONAL_DATA: 'ข้อมูลงานภายในกิจการ',
  ACCOUNTING_TAX_DOCUMENTS: 'เอกสารบัญชีและภาษี',
  ATTACHMENTS_OBJECT_VERSIONS: 'ไฟล์แนบและทุกเวอร์ชันของไฟล์',
  AI_OCR_DATA: 'ข้อมูล AI และ OCR',
  AUDIT_SECURITY_LOGS: 'บันทึกตรวจสอบและความปลอดภัย',
  QUEUES_CACHES: 'คิว แคช และงานที่รอดำเนินการ',
  PROCESSORS: 'ผู้ประมวลผลข้อมูลภายนอก',
  BACKUPS: 'ข้อมูลสำรองและแผน replay',
  LEGAL_ACCEPTANCE_EVIDENCE: 'หลักฐานการยอมรับข้อกำหนด',
};

export const CATEGORY_DESCRIPTION: Record<DataRightsDecisionCategory, string> = {
  ACCOUNT_IDENTITY: 'โปรไฟล์ ชื่อ อีเมล เบอร์โทร และตัวระบุบัญชี',
  AUTHENTICATION_SECRETS: 'รหัสผ่าน เซสชัน รีเซ็ตรหัส และช่องทางเชื่อมต่อ',
  MEMBERSHIPS_ACCESS: 'สมาชิก บทบาท สาขา ผู้อนุมัติ และคำเชิญ',
  TENANT_OPERATIONAL_DATA: 'CRM พนักงาน ผู้ติดต่อ สินค้า และรายการดำเนินงาน',
  ACCOUNTING_TAX_DOCUMENTS: 'รายการบัญชี ภาษี ธนาคาร ค่าใช้จ่าย และเอกสารลงนาม',
  ATTACHMENTS_OBJECT_VERSIONS: 'ไฟล์ปัจจุบัน เวอร์ชันเก่า blob และไฟล์ส่งออกชั่วคราว',
  AI_OCR_DATA: 'ข้อความ ร่าง ผล OCR lineage และข้อมูลช่วยประมวลผล',
  AUDIT_SECURITY_LOGS: 'audit log, security log, support และ billing ที่เกี่ยวข้อง',
  QUEUES_CACHES: 'ข้อความรอประมวลผล แคช job และไฟล์ชั่วคราว',
  PROCESSORS: 'สำเนาหรือผลประมวลผลที่อยู่กับ vendor/subprocessor',
  BACKUPS: 'ชุดสำรอง tombstone วันหมดอายุ และผลหลัง restore',
  LEGAL_ACCEPTANCE_EVIDENCE: 'หลักฐาน clickwrap ที่จำเป็นต่อการพิสูจน์สิทธิและสัญญา',
};

export const DISPOSITION_LABEL: Record<DataRightsDisposition, string> = {
  DELETE: 'ลบตามแผน (ยังไม่ดำเนินการ)',
  ANONYMIZE: 'ทำให้ไม่สามารถระบุตัวบุคคล',
  RESTRICT: 'จำกัดการใช้และการเข้าถึง',
  RETAIN: 'เก็บรักษาตามฐานกฎหมาย',
  RETURN: 'ส่งคืน/ส่งออกให้ผู้ขอ',
  NOT_APPLICABLE: 'ไม่เกี่ยวข้องกับเคสนี้',
};

export const EVIDENCE_TYPE_LABEL: Record<DataRightsEvidenceType, string> = {
  IDENTITY_VERIFICATION: 'ยืนยันตัวตน',
  AUTHORITY_VERIFICATION: 'ยืนยันอำนาจ',
  EXPORT_DELIVERY: 'ส่งมอบข้อมูลส่งออก',
  ACCESS_REVOCATION: 'ถอนสิทธิ์และเซสชัน',
  DATABASE_EXECUTION: 'ผลดำเนินการฐานข้อมูล',
  OBJECT_STORAGE_INVENTORY: 'ตรวจไฟล์และทุก object version',
  QUEUE_CACHE_PURGE: 'ล้างคิวและแคช',
  PROCESSOR_CONFIRMATION: 'ยืนยันจากผู้ประมวลผล',
  BACKUP_MANIFEST: 'manifest/tombstone ของ backup',
  RETENTION_HOLD: 'หลักฐาน retention/legal hold',
  INDEPENDENT_VERIFICATION: 'ตรวจยืนยันโดยผู้ตรวจอิสระ',
};

export function targetFieldsForCaseType(caseType: DataRightsCaseType): readonly DataRightsTargetField[] {
  if (caseType === 'USER_ACCOUNT_ERASURE') return ['targetUserId'];
  if (caseType === 'MEMBERSHIP_EXIT') return ['targetUserId', 'companyId', 'membershipId'];
  return ['companyId'];
}

export function validateCreateCase(
  form: CreateDataRightsCaseForm,
  now = new Date(),
): CreateDataRightsCaseErrors {
  const errors: CreateDataRightsCaseErrors = {};
  const requiredTargets = new Set(targetFieldsForCaseType(form.caseType));

  if (!form.requestKey.trim()) errors.requestKey = 'กรุณาระบุเลขอ้างอิงคำขอ';
  else if (!OPAQUE_KEY.test(form.requestKey.trim())) {
    errors.requestKey = 'ใช้ได้เฉพาะ A-Z, a-z, 0-9, จุด, ขีดกลาง, ขีดล่าง หรือโคลอน (ไม่เกิน 128 ตัวอักษร)';
  }

  for (const field of ['targetUserId', 'companyId', 'membershipId'] as const) {
    if (requiredTargets.has(field) && !form[field].trim()) errors[field] = 'จำเป็นต้องระบุให้ตรงกับข้อมูลในระบบ';
    if (!requiredTargets.has(field) && form[field].trim()) errors[field] = 'เคสประเภทนี้ต้องไม่ส่งรหัสช่องนี้';
  }

  const receivedAt = form.receivedAt ? new Date(form.receivedAt) : now;
  const dueAt = new Date(form.dueAt);
  if (form.receivedAt && Number.isNaN(receivedAt.getTime())) errors.receivedAt = 'วันที่รับเรื่องไม่ถูกต้อง';
  else if (receivedAt.getTime() > now.getTime() + 5 * 60_000) errors.receivedAt = 'วันที่รับเรื่องต้องไม่อยู่ในอนาคต';
  if (!form.dueAt) errors.dueAt = 'กรุณาระบุกำหนดตอบกลับ';
  else if (Number.isNaN(dueAt.getTime())) errors.dueAt = 'กำหนดตอบกลับไม่ถูกต้อง';
  else if (dueAt <= receivedAt) errors.dueAt = 'กำหนดตอบกลับต้องอยู่หลังวันที่รับเรื่อง';
  if (form.priorCaseReference.trim() && !PRIOR_CASE_REFERENCE.test(form.priorCaseReference.trim())) {
    errors.priorCaseReference = 'ใช้อ้างอิงรูปแบบ case://<case-id> เท่านั้น';
  }
  if (!form.targetConfirmed) errors.targetConfirmed = 'ต้องยืนยันว่าตรวจรหัสเป้าหมายแล้ว';

  return errors;
}

export function isTerminalStatus(status: DataRightsCaseStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isLatestRequestEpoch(requestEpoch: number, latestEpoch: number): boolean {
  return requestEpoch === latestEpoch;
}

export function isOverdueCase(
  item: { status: DataRightsCaseStatus; dueAt: string },
  now = new Date(),
): boolean {
  return (item.status === 'BLOCKED' || !isTerminalStatus(item.status))
    && new Date(item.dueAt).getTime() < now.getTime();
}

export function latestDecisions<T extends DecisionLike>(decisions: readonly T[]): Map<DataRightsDecisionCategory, T> {
  const result = new Map<DataRightsDecisionCategory, T>();
  for (const decision of decisions) {
    const current = result.get(decision.category);
    if (!current || decision.revision > current.revision) result.set(decision.category, decision);
  }
  return result;
}

export function missingDecisionCategories(decisions: readonly DecisionLike[]): DataRightsDecisionCategory[] {
  const current = latestDecisions(decisions);
  return DATA_RIGHTS_DECISION_CATEGORIES.filter((category) => !current.has(category));
}

export function allowedDispositionsForDecision(
  caseType: DataRightsCaseType,
  category: DataRightsDecisionCategory,
): readonly DataRightsDisposition[] {
  return dataRightsAllowedDispositions(caseType, category);
}

export function requiredEvidenceTypes(
  caseType: DataRightsCaseType,
  decisions: readonly DecisionLike[],
  completing: boolean,
): DataRightsEvidenceType[] {
  const required = new Set<DataRightsEvidenceType>(
    dataRightsCaseEvidenceRequirements(caseType, [...latestDecisions(decisions).values()]).map((item) => item.evidenceType),
  );
  if (completing) required.add('INDEPENDENT_VERIFICATION');
  return [...required];
}

export function requiredEvidenceCategory(type: DataRightsEvidenceType): DataRightsDecisionCategory | null {
  return FIXED_EVIDENCE_CATEGORY[type] ?? null;
}

export function evidenceCategoriesForType(
  caseType: DataRightsCaseType,
  type: DataRightsEvidenceType,
  decisions: readonly DecisionLike[],
): DataRightsDecisionCategory[] {
  return dataRightsCaseEvidenceRequirements(caseType, [...latestDecisions(decisions).values()])
    .filter((item) => item.evidenceType === type)
    .map((item) => item.category);
}

export function evidenceTypeRequiresCategory(type: DataRightsEvidenceType): boolean {
  return type !== 'IDENTITY_VERIFICATION'
    && type !== 'AUTHORITY_VERIFICATION'
    && type !== 'INDEPENDENT_VERIFICATION';
}

export function retainedDecisionCategories(decisions: readonly DecisionLike[]): DataRightsDecisionCategory[] {
  return [...latestDecisions(decisions).entries()]
    .filter(([, decision]) => decision.disposition === 'RETAIN' || decision.disposition === 'RESTRICT')
    .map(([category]) => category);
}

export function completionOutcomeForDecisions(
  decisions: readonly DecisionLike[],
): 'COMPLETED' | 'COMPLETED_WITH_EXCEPTION' {
  return retainedDecisionCategories(decisions).length ? 'COMPLETED_WITH_EXCEPTION' : 'COMPLETED';
}

export function recordableEvidenceTypesForStatus(status?: DataRightsCaseStatus): DataRightsEvidenceType[] {
  if (status === 'RETENTION_REVIEW' || status === 'APPROVED') return ['EXPORT_DELIVERY'];
  if (status === 'EXECUTING') return ['EXPORT_DELIVERY', ...EXECUTION_EVIDENCE_TYPES];
  if (status === 'VERIFICATION') return ['INDEPENDENT_VERIFICATION'];
  return [];
}

export function missingEvidenceTypes(
  caseType: DataRightsCaseType,
  decisions: readonly DecisionLike[],
  evidence: readonly EvidenceLike[],
  completing: boolean,
): DataRightsEvidenceType[] {
  const requirements: Array<{ evidenceType: DataRightsEvidenceType; category: DataRightsDecisionCategory | null }> = [
    ...dataRightsCaseEvidenceRequirements(caseType, [...latestDecisions(decisions).values()]),
    ...(completing ? [{ evidenceType: 'INDEPENDENT_VERIFICATION' as const, category: null }] : []),
  ];
  return [...new Set(requirements
    .filter((requirement) => !evidence.some((item) => item.evidenceType === requirement.evidenceType
      && (item.category ?? null) === requirement.category
      && isValidEvidenceSha256(item.sha256)))
    .map((requirement) => requirement.evidenceType))];
}

export function missingEvidenceRequirements(
  caseType: DataRightsCaseType,
  decisions: readonly DecisionLike[],
  evidence: readonly EvidenceLike[],
  completing: boolean,
): Array<{ evidenceType: DataRightsEvidenceType; category: DataRightsDecisionCategory | null }> {
  const requirements: Array<{ evidenceType: DataRightsEvidenceType; category: DataRightsDecisionCategory | null }> = [
    ...dataRightsCaseEvidenceRequirements(caseType, [...latestDecisions(decisions).values()]),
    ...(completing ? [{ evidenceType: 'INDEPENDENT_VERIFICATION' as const, category: null }] : []),
  ];
  return requirements.filter((requirement) => !evidence.some((item) =>
    item.evidenceType === requirement.evidenceType
      && (item.category ?? null) === requirement.category
      && isValidEvidenceSha256(item.sha256)));
}

export function missingRetentionEvidenceCategories(
  decisions: readonly DecisionLike[],
  evidence: readonly EvidenceLike[],
): DataRightsDecisionCategory[] {
  return retainedDecisionCategories(decisions).filter((category) => !evidence.some(
    (item) => item.evidenceType === 'RETENTION_HOLD'
      && item.category === category
      && isValidEvidenceSha256(item.sha256),
  ));
}

export function canBeginRetentionReview(input: {
  caseType: DataRightsCaseType;
  status: DataRightsCaseStatus;
  identityVerifiedAt: string | null;
  authorityVerifiedAt: string | null;
}): boolean {
  return input.status === 'IDENTITY_VERIFIED'
    && Boolean(input.identityVerifiedAt)
    && (!dataRightsCaseRequiresTenantAuthority(input.caseType) || Boolean(input.authorityVerifiedAt));
}
