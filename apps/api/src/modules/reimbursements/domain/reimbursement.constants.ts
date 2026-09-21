import type {
  ReimbursementApproverMode,
  ReimbursementDuplicatePolicy,
  ReimbursementPolicySnapshotV1,
  ReimbursementPolicyStatus,
} from '@watchdog-bms/contracts';
import type { ReimbursementPolicyRecord, ReimbursementRequestRecord } from './models/reimbursement.model';

/** AttachmentLink coordinates of the wet-ink signed claim form uploaded back into the system. */
export const REIMBURSEMENT_ATTACHMENT_TARGET_TYPE = 'reimbursement_request';
export const REIMBURSEMENT_SIGNED_COPY_PURPOSE = 'reimbursement.claim_form.signed';
/**
 * Scan attachment metadata key holding the A4 declaration (no new column, spec §14). The value
 * carries the link row id: a client can pre-fill metadata at upload but cannot know that id, and a
 * link recreated after a reopen gets a new one, so neither a forged nor a stale entry counts.
 */
export const REIMBURSEMENT_SIGNED_COPY_ACK_KEY = 'reimbursementSignedCopyAck';

/** Decision-relevant policy fields, resolved from a DB policy or company defaults. */
export type EffectivePolicy = {
  currency: string;
  approvalRequiredFromAmount: string;
  approverMode: ReimbursementApproverMode;
  defaultApproverUserId?: string;
  defaultApproverRole?: string;
  allowSelfApproval: boolean;
  requireReceipt: boolean;
  allowMissingReceiptWithReason: boolean;
  duplicatePolicy: ReimbursementDuplicatePolicy;
  financeReviewRequired: boolean;
  slaHours?: number;
  status: ReimbursementPolicyStatus;
};

export const REIMBURSEMENT_POLICY_DEFAULTS: EffectivePolicy = {
  currency: 'THB',
  approvalRequiredFromAmount: '1.00',
  approverMode: 'MANAGER_ROLE',
  defaultApproverRole: 'MANAGER',
  allowSelfApproval: false,
  requireReceipt: true,
  allowMissingReceiptWithReason: false,
  duplicatePolicy: 'BLOCK_PAYMENT',
  // Step-journey spec §7 / owner decision D2 + A1 (2026-09-19): default OFF so a solo owner can
  // finish a claim in one sitting. Companies that want finance review back can switch it on.
  financeReviewRequired: false,
  status: 'ACTIVE',
};

export function effectivePolicy(record: ReimbursementPolicyRecord | null): EffectivePolicy {
  if (!record) return REIMBURSEMENT_POLICY_DEFAULTS;
  return {
    currency: record.currency,
    approvalRequiredFromAmount: record.approvalRequiredFromAmount,
    approverMode: record.approverMode,
    defaultApproverUserId: record.defaultApproverUserId,
    defaultApproverRole: record.defaultApproverRole,
    allowSelfApproval: record.allowSelfApproval,
    requireReceipt: record.requireReceipt,
    allowMissingReceiptWithReason: record.allowMissingReceiptWithReason,
    duplicatePolicy: record.duplicatePolicy,
    financeReviewRequired: record.financeReviewRequired,
    slaHours: record.slaHours,
    status: record.status,
  };
}

const POLICY_SNAPSHOT_KEYS = new Set([
  'schemaVersion', 'policyId', 'policyVersion', 'approvalRequiredFromAmount', 'requiresApproval',
  'route', 'allowSelfApproval', 'requireReceipt', 'allowMissingReceiptWithReason',
  'duplicatePolicy', 'financeReviewRequired', 'slaHours',
]);
const ROUTE_KEYS = new Set(['mode', 'roleKey', 'effectiveTaskRole', 'ownerFallbackUsedAtSubmission']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** New snapshots fail closed; null remains the explicit legacy compatibility path. */
export function parseReimbursementPolicySnapshot(value: unknown): ReimbursementPolicySnapshotV1 | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || Object.keys(value).some((key) => !POLICY_SNAPSHOT_KEYS.has(key))) {
    throw new Error('invalid_reimbursement_policy_snapshot');
  }
  const route = value['route'];
  const validRoute = route === null || (isRecord(route)
    && !Object.keys(route).some((key) => !ROUTE_KEYS.has(key))
    && ['MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_ROLE'].includes(String(route['mode']))
    && typeof route['roleKey'] === 'string' && route['roleKey'].length > 0
    && typeof route['effectiveTaskRole'] === 'string' && route['effectiveTaskRole'].length > 0
    && typeof route['ownerFallbackUsedAtSubmission'] === 'boolean');
  const threshold = value['approvalRequiredFromAmount'];
  const requiresHumanApproval = value['requiresApproval'];
  const valid = value['schemaVersion'] === 1
    && typeof value['policyId'] === 'string' && value['policyId'].length > 0
    && typeof value['policyVersion'] === 'string' && value['policyVersion'].length > 0
    && typeof threshold === 'string' && /^\d{1,14}(?:\.\d{1,4})?$/.test(threshold)
    && typeof requiresHumanApproval === 'boolean'
    && validRoute
    && (requiresHumanApproval ? route !== null : route === null)
    && typeof value['allowSelfApproval'] === 'boolean'
    && typeof value['requireReceipt'] === 'boolean'
    && typeof value['allowMissingReceiptWithReason'] === 'boolean'
    && ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'].includes(String(value['duplicatePolicy']))
    && typeof value['financeReviewRequired'] === 'boolean'
    && (value['slaHours'] === undefined || (Number.isInteger(value['slaHours']) && Number(value['slaHours']) >= 0 && Number(value['slaHours']) <= 8760));
  if (!valid) throw new Error('invalid_reimbursement_policy_snapshot');
  return value as ReimbursementPolicySnapshotV1;
}

/** Frozen business facts for submitted work; current policy remains the legacy fallback only. */
export function effectivePolicyForRequest(
  request: Pick<ReimbursementRequestRecord, 'approvalPolicySnapshotJson'>,
  current: EffectivePolicy,
): EffectivePolicy {
  const snapshot = parseReimbursementPolicySnapshot(request.approvalPolicySnapshotJson);
  if (!snapshot) return current;
  return {
    currency: current.currency,
    approvalRequiredFromAmount: snapshot.approvalRequiredFromAmount,
    approverMode: snapshot.route?.mode ?? current.approverMode,
    defaultApproverRole: snapshot.route?.roleKey,
    allowSelfApproval: snapshot.allowSelfApproval,
    requireReceipt: snapshot.requireReceipt,
    allowMissingReceiptWithReason: snapshot.allowMissingReceiptWithReason,
    duplicatePolicy: snapshot.duplicatePolicy,
    financeReviewRequired: snapshot.financeReviewRequired,
    slaHours: snapshot.slaHours,
    status: 'ACTIVE',
  };
}
