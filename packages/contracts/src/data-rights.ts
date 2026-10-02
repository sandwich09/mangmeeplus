export const DATA_RIGHTS_CASE_TYPES = [
  'USER_ACCOUNT_ERASURE',
  'MEMBERSHIP_EXIT',
  'COMPANY_WORKSPACE_OFFBOARDING',
] as const;
export type DataRightsCaseType = typeof DATA_RIGHTS_CASE_TYPES[number];

export const DATA_RIGHTS_CASE_STATUSES = [
  'RECEIVED',
  'IDENTITY_VERIFIED',
  'RETENTION_REVIEW',
  'APPROVED',
  'EXECUTING',
  'VERIFICATION',
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'BLOCKED',
  'REJECTED',
  'CANCELLED',
] as const;
export type DataRightsCaseStatus = typeof DATA_RIGHTS_CASE_STATUSES[number];

export const DATA_RIGHTS_REQUEST_SOURCES = [
  'EMAIL',
  'SUPPORT',
  'IN_APP',
  'OTHER_MONITORED_CHANNEL',
] as const;
export type DataRightsRequestSource = typeof DATA_RIGHTS_REQUEST_SOURCES[number];

export const DATA_RIGHTS_DECISION_CATEGORIES = [
  'ACCOUNT_IDENTITY',
  'AUTHENTICATION_SECRETS',
  'MEMBERSHIPS_ACCESS',
  'TENANT_OPERATIONAL_DATA',
  'ACCOUNTING_TAX_DOCUMENTS',
  'ATTACHMENTS_OBJECT_VERSIONS',
  'AI_OCR_DATA',
  'AUDIT_SECURITY_LOGS',
  'QUEUES_CACHES',
  'PROCESSORS',
  'BACKUPS',
  'LEGAL_ACCEPTANCE_EVIDENCE',
] as const;
export type DataRightsDecisionCategory = typeof DATA_RIGHTS_DECISION_CATEGORIES[number];

export const DATA_RIGHTS_DISPOSITIONS = [
  'DELETE',
  'ANONYMIZE',
  'RESTRICT',
  'RETAIN',
  'RETURN',
  'NOT_APPLICABLE',
] as const;
export type DataRightsDisposition = typeof DATA_RIGHTS_DISPOSITIONS[number];

const DATA_RIGHTS_NOT_APPLICABLE_ONLY = ['NOT_APPLICABLE'] as const;
const DATA_RIGHTS_MEMBERSHIP_ACCESS_DISPOSITIONS = ['DELETE', 'RESTRICT', 'NOT_APPLICABLE'] as const;
const DATA_RIGHTS_TENANT_RECORD_PRESERVATION_DISPOSITIONS = ['RESTRICT', 'RETAIN', 'NOT_APPLICABLE'] as const;

/**
 * Conservative cross-scope boundary. This does not decide the lawful outcome;
 * it prevents one request type from destroying data owned by another scope.
 */
export function dataRightsAllowedDispositions(
  caseType: DataRightsCaseType,
  category: DataRightsDecisionCategory,
): readonly DataRightsDisposition[] {
  if (caseType === 'MEMBERSHIP_EXIT') {
    return category === 'MEMBERSHIPS_ACCESS'
      ? DATA_RIGHTS_MEMBERSHIP_ACCESS_DISPOSITIONS
      : DATA_RIGHTS_NOT_APPLICABLE_ONLY;
  }
  if (
    caseType === 'USER_ACCOUNT_ERASURE'
    && (
      category === 'TENANT_OPERATIONAL_DATA'
      || category === 'ACCOUNTING_TAX_DOCUMENTS'
      || category === 'ATTACHMENTS_OBJECT_VERSIONS'
    )
  ) {
    return DATA_RIGHTS_TENANT_RECORD_PRESERVATION_DISPOSITIONS;
  }
  if (
    caseType === 'COMPANY_WORKSPACE_OFFBOARDING'
    && (category === 'ACCOUNT_IDENTITY' || category === 'AUTHENTICATION_SECRETS')
  ) {
    return DATA_RIGHTS_NOT_APPLICABLE_ONLY;
  }
  return DATA_RIGHTS_DISPOSITIONS;
}

export function isDataRightsDispositionAllowed(
  caseType: DataRightsCaseType,
  category: DataRightsDecisionCategory,
  disposition: DataRightsDisposition,
): boolean {
  return dataRightsAllowedDispositions(caseType, category).includes(disposition);
}

export const DATA_RIGHTS_EVIDENCE_TYPES = [
  'IDENTITY_VERIFICATION',
  'AUTHORITY_VERIFICATION',
  'EXPORT_DELIVERY',
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
  'INDEPENDENT_VERIFICATION',
] as const;
export type DataRightsEvidenceType = typeof DATA_RIGHTS_EVIDENCE_TYPES[number];

export type DataRightsEvidenceRequirement = {
  evidenceType: DataRightsEvidenceType;
  category: DataRightsDecisionCategory;
};

export function dataRightsBaselineEvidenceRequirements(
  caseType: DataRightsCaseType,
): DataRightsEvidenceRequirement[] {
  if (caseType === 'MEMBERSHIP_EXIT') {
    return [{ evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' }];
  }
  if (caseType === 'USER_ACCOUNT_ERASURE') {
    return [
      { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' },
      { evidenceType: 'DATABASE_EXECUTION', category: 'ACCOUNT_IDENTITY' },
      { evidenceType: 'QUEUE_CACHE_PURGE', category: 'QUEUES_CACHES' },
      { evidenceType: 'BACKUP_MANIFEST', category: 'BACKUPS' },
    ];
  }
  return [
    { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' },
    { evidenceType: 'DATABASE_EXECUTION', category: 'TENANT_OPERATIONAL_DATA' },
    { evidenceType: 'OBJECT_STORAGE_INVENTORY', category: 'ATTACHMENTS_OBJECT_VERSIONS' },
    { evidenceType: 'QUEUE_CACHE_PURGE', category: 'QUEUES_CACHES' },
    { evidenceType: 'PROCESSOR_CONFIRMATION', category: 'PROCESSORS' },
    { evidenceType: 'BACKUP_MANIFEST', category: 'BACKUPS' },
  ];
}

/** Evidence needed for the latest approved disposition of each category. */
export function dataRightsEvidenceRequirements(
  decisions: readonly { category: DataRightsDecisionCategory; disposition: DataRightsDisposition }[],
): DataRightsEvidenceRequirement[] {
  const requirements: DataRightsEvidenceRequirement[] = [];
  const add = (evidenceType: DataRightsEvidenceType, category: DataRightsDecisionCategory) => {
    if (!requirements.some((item) => item.evidenceType === evidenceType && item.category === category)) {
      requirements.push({ evidenceType, category });
    }
  };

  for (const decision of decisions) {
    const { category, disposition } = decision;
    if (category === 'MEMBERSHIPS_ACCESS' && (disposition === 'DELETE' || disposition === 'RESTRICT')) {
      add('ACCESS_REVOCATION', category);
    }
    if (disposition === 'DELETE' || disposition === 'ANONYMIZE') add('DATABASE_EXECUTION', category);
    if (category === 'ATTACHMENTS_OBJECT_VERSIONS' && (disposition === 'DELETE' || disposition === 'ANONYMIZE')) {
      add('OBJECT_STORAGE_INVENTORY', category);
    }
    if (category === 'QUEUES_CACHES' && (disposition === 'DELETE' || disposition === 'ANONYMIZE')) {
      add('QUEUE_CACHE_PURGE', category);
    }
    if (category === 'PROCESSORS' && disposition !== 'NOT_APPLICABLE') add('PROCESSOR_CONFIRMATION', category);
    if (category === 'BACKUPS' && disposition !== 'NOT_APPLICABLE') add('BACKUP_MANIFEST', category);
    if (disposition === 'RETURN') add('EXPORT_DELIVERY', category);
    if (disposition === 'RETAIN' || disposition === 'RESTRICT') add('RETENTION_HOLD', category);
  }
  return requirements;
}

export function dataRightsCaseEvidenceRequirements(
  caseType: DataRightsCaseType,
  decisions: readonly { category: DataRightsDecisionCategory; disposition: DataRightsDisposition }[],
): DataRightsEvidenceRequirement[] {
  const result = [...dataRightsBaselineEvidenceRequirements(caseType)];
  for (const requirement of dataRightsEvidenceRequirements(decisions)) {
    if (!result.some((item) => item.evidenceType === requirement.evidenceType && item.category === requirement.category)) {
      result.push(requirement);
    }
  }
  return result;
}

export const DATA_RIGHTS_IDENTITY_METHODS = [
  'AUTHENTICATED_SESSION',
  'VERIFIED_EMAIL_CHALLENGE',
  'COMPANY_ADMIN_ATTESTATION',
  'LEGAL_REPRESENTATIVE_DOCUMENT_REVIEWED',
  'OTHER_PROPORTIONATE_METHOD',
] as const;
export type DataRightsIdentityMethod = typeof DATA_RIGHTS_IDENTITY_METHODS[number];

export const DATA_RIGHTS_AUTHORITY_METHODS = [
  'NOT_REQUIRED',
  'CURRENT_OWNER_MEMBERSHIP',
  'COMPANY_AFFIDAVIT_REVIEWED',
  'SIGNED_AUTHORIZATION_REVIEWED',
  'OTHER_LEGAL_REVIEW',
] as const;
export type DataRightsAuthorityMethod = typeof DATA_RIGHTS_AUTHORITY_METHODS[number];

export function dataRightsCaseRequiresTenantAuthority(caseType: DataRightsCaseType): boolean {
  return caseType !== 'USER_ACCOUNT_ERASURE';
}

export function dataRightsRequiredExecutionEvidence(caseType: DataRightsCaseType): readonly DataRightsEvidenceType[] {
  if (caseType === 'MEMBERSHIP_EXIT') return ['ACCESS_REVOCATION'];
  if (caseType === 'USER_ACCOUNT_ERASURE') {
    return ['ACCESS_REVOCATION', 'DATABASE_EXECUTION', 'QUEUE_CACHE_PURGE', 'BACKUP_MANIFEST'];
  }
  return [
    'ACCESS_REVOCATION',
    'DATABASE_EXECUTION',
    'OBJECT_STORAGE_INVENTORY',
    'QUEUE_CACHE_PURGE',
    'PROCESSOR_CONFIRMATION',
    'BACKUP_MANIFEST',
  ];
}

/**
 * P31 §8 single-admin mode. Five steps of a case are normally refused to the person who took the
 * step before (creator/approver, approver/executor, executor/verification starter,
 * executor/independent verifier, executor/completer). While the platform has exactly one active
 * System Admin, that person may take such a step as an explicit self-step: a stored marker, a reason
 * and an audit row of its own. With a second active System Admin the separation rules apply.
 */
export const DATA_RIGHTS_SINGLE_ADMIN_STEPS = [
  'APPROVAL',
  'EXECUTION',
  'VERIFICATION',
  'INDEPENDENT_VERIFICATION',
  'COMPLETION',
] as const;
export type DataRightsSingleAdminStep = typeof DATA_RIGHTS_SINGLE_ADMIN_STEPS[number];

/** The database refuses a shorter reason too (the two `*_single_admin_reason_check` constraints). */
export const DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH = 20;
export const DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH = 1_000;
const DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_DISTINCT_LETTERS = 8;

/** Whitespace is collapsed first, so padding cannot stand in for a reason. */
export function normalizeDataRightsSingleAdminReason(reason: string): string {
  return reason.replace(/\s+/gu, ' ').trim();
}

export type DataRightsSingleAdminReasonProblem = 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | 'TRIVIAL';

/**
 * The reason replaces what a second person would have asked, so one character repeated, digits or
 * a word typed over and over do not count: it needs enough different letters to be a sentence.
 */
export function dataRightsSingleAdminReasonProblem(
  reason: string | null | undefined,
): DataRightsSingleAdminReasonProblem | null {
  const text = normalizeDataRightsSingleAdminReason(reason ?? '');
  if (!text) return 'REQUIRED';
  if (text.length < DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_LENGTH) return 'TOO_SHORT';
  if (text.length > DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH) return 'TOO_LONG';
  const letters = new Set(text.toLowerCase().match(/[\p{L}\p{M}]/gu) ?? []);
  return letters.size < DATA_RIGHTS_SINGLE_ADMIN_REASON_MIN_DISTINCT_LETTERS ? 'TRIVIAL' : null;
}
