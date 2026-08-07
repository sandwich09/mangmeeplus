import type {
  ReimbursementApproverMode,
  ReimbursementDuplicatePolicy,
} from '@watchdog-bms/contracts';
import type { ReimbursementPolicyRecord } from './models/reimbursement.model';

/** AttachmentLink coordinates of the wet-ink signed claim form uploaded back into the system. */
export const REIMBURSEMENT_ATTACHMENT_TARGET_TYPE = 'reimbursement_request';
export const REIMBURSEMENT_SIGNED_COPY_PURPOSE = 'reimbursement.claim_form.signed';

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
  financeReviewRequired: true,
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
  };
}
