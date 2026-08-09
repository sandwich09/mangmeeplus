import type {
  DataRightsAuthorityMethod,
  DataRightsCaseStatus,
  DataRightsCaseType,
  DataRightsDecisionCategory,
  DataRightsDisposition,
  DataRightsEvidenceType,
  DataRightsIdentityMethod,
  DataRightsRequestSource,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type DataRightsCaseSummary = {
  id: string;
  requestKey: string;
  caseType: DataRightsCaseType;
  status: DataRightsCaseStatus;
  requestSource: DataRightsRequestSource;
  targetUserId: string | null;
  companyId: string | null;
  membershipId: string | null;
  receivedAt: string;
  dueAt: string;
  createdByUserId: string;
  identityVerifiedAt: string | null;
  identityVerifiedByUserId: string | null;
  authorityVerifiedAt: string | null;
  authorityVerifiedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  executionStartedAt: string | null;
  executionStartedByUserId: string | null;
  verificationStartedAt: string | null;
  verificationStartedByUserId: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  outcomeSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DataRightsDecisionRecord = {
  id: string;
  revision: number;
  category: DataRightsDecisionCategory;
  disposition: DataRightsDisposition;
  legalBasisCode: string;
  rationale: string;
  retentionUntil: string | null;
  accessRestriction: string | null;
  recordedByUserId: string;
  recordedAt: string;
};

export type DataRightsEvidenceRecord = {
  id: string;
  evidenceType: DataRightsEvidenceType;
  category: DataRightsDecisionCategory | null;
  reference: string;
  sha256: string | null;
  note: string | null;
  recordedByUserId: string;
  recordedAt: string;
};

export type DataRightsActionRecord = {
  id: string;
  commandId: string;
  action: string;
  fromStatus: DataRightsCaseStatus | null;
  toStatus: DataRightsCaseStatus | null;
  actorUserId: string;
  requestId: string;
  metadataJson: unknown;
  createdAt: string;
};

export type DataRightsCaseDetail = DataRightsCaseSummary & {
  decisions: DataRightsDecisionRecord[];
  evidence: DataRightsEvidenceRecord[];
  actions: DataRightsActionRecord[];
};

export type DataRightsCommandResult = {
  caseId: string;
  replayed: boolean;
  case: DataRightsCaseDetail;
};

export type CreateDataRightsCaseInput = {
  commandId: string;
  requestKey: string;
  caseType: DataRightsCaseType;
  requestSource: DataRightsRequestSource;
  requesterContact?: string;
  targetUserId?: string;
  companyId?: string;
  membershipId?: string;
  receivedAt?: string;
  dueAt: string;
  priorCaseReference?: string;
};

export type DataRightsDueFilter = 'ALL' | 'OVERDUE' | 'OPEN' | 'RESOLVED';

type VerificationEvidenceInput = {
  commandId: string;
  reference: string;
  sha256?: string;
  note?: string;
};

export type ListDataRightsCasesParams = {
  status?: DataRightsCaseStatus;
  caseType?: DataRightsCaseType;
  companyId?: string;
  targetUserId?: string;
  cursor?: string;
  pageSize?: number;
  dueFilter?: DataRightsDueFilter;
};

export function buildDataRightsCasesPath(params: ListDataRightsCasesParams = {}): string {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.caseType) query.set('caseType', params.caseType);
  if (params.companyId) query.set('companyId', params.companyId);
  if (params.targetUserId) query.set('targetUserId', params.targetUserId);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.dueFilter) query.set('dueFilter', params.dueFilter);
  return `/v1/system/data-rights/cases${query.size ? `?${query.toString()}` : ''}`;
}

export function listDataRightsCases(params: ListDataRightsCasesParams = {}) {
  return apiFetch<{ items: DataRightsCaseSummary[]; nextCursor: string | null }>(buildDataRightsCasesPath(params));
}

export function getDataRightsCase(caseId: string) {
  return apiFetch<DataRightsCaseDetail>(`/v1/system/data-rights/cases/${encodeURIComponent(caseId)}`);
}

export function createDataRightsCase(input: CreateDataRightsCaseInput) {
  return apiFetch<DataRightsCommandResult>('/v1/system/data-rights/cases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

function postCaseCommand<T extends object>(caseId: string, action: string, input: T) {
  return apiFetch<DataRightsCommandResult>(
    `/v1/system/data-rights/cases/${encodeURIComponent(caseId)}/${action}`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function verifyDataRightsIdentity(
  caseId: string,
  input: VerificationEvidenceInput & { method: DataRightsIdentityMethod },
) {
  return postCaseCommand(caseId, 'verify-identity', input);
}

export function verifyDataRightsAuthority(
  caseId: string,
  input: VerificationEvidenceInput & { method: DataRightsAuthorityMethod },
) {
  return postCaseCommand(caseId, 'verify-authority', input);
}

export function beginDataRightsRetentionReview(caseId: string, commandId: string) {
  return postCaseCommand(caseId, 'begin-retention-review', { commandId });
}

export function recordDataRightsDecision(caseId: string, input: {
  commandId: string;
  category: DataRightsDecisionCategory;
  disposition: DataRightsDisposition;
  legalBasisCode: string;
  rationale: string;
  retentionUntil?: string;
  accessRestriction?: string;
}) {
  return postCaseCommand(caseId, 'decisions', input);
}

export function recordDataRightsEvidence(caseId: string, input: VerificationEvidenceInput & {
  evidenceType: DataRightsEvidenceType;
  category?: DataRightsDecisionCategory;
  sha256: string;
}) {
  return postCaseCommand(caseId, 'evidence', input);
}

export function approveDataRightsCase(caseId: string, commandId: string) {
  return postCaseCommand(caseId, 'approve', { commandId });
}

export function startDataRightsExecution(caseId: string, commandId: string) {
  return postCaseCommand(caseId, 'start-execution', { commandId });
}

export function startDataRightsVerification(caseId: string, commandId: string) {
  return postCaseCommand(caseId, 'start-verification', { commandId });
}

export function completeDataRightsCase(caseId: string, input: {
  commandId: string;
  outcome: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTION';
  outcomeSummary: string;
}) {
  return postCaseCommand(caseId, 'complete', input);
}

export function closeDataRightsCase(caseId: string, input: {
  commandId: string;
  outcome: 'REJECTED' | 'CANCELLED' | 'BLOCKED';
  reason: string;
}) {
  return postCaseCommand(caseId, 'close', input);
}
