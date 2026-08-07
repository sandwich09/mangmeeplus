import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptEvidenceStatus,
} from '@watchdog-bms/contracts';

export type WizardStep = 'expense' | 'details' | 'evidence' | 'certify' | 'approve' | 'done';

export type PayeeIdentityIssue =
  | 'payee_name_required'
  | 'payee_name_too_long'
  | 'payee_address_too_long'
  | 'payee_tax_id_13';

export type PayeeIdentityIssues = Partial<Record<'payeeName' | 'payeeAddress' | 'payeeTaxId', PayeeIdentityIssue>>;

export function payeeTaxIdDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function validatePayeeIdentity(input: {
  payeeName: string;
  payeeAddress: string;
  payeeTaxId: string;
  vendorNameSnapshot: string | null | undefined;
}): PayeeIdentityIssues {
  const issues: PayeeIdentityIssues = {};
  const name = input.payeeName.trim();
  if (!name && !input.vendorNameSnapshot?.trim()) issues.payeeName = 'payee_name_required';
  else if (name.length > 200) issues.payeeName = 'payee_name_too_long';
  if (input.payeeAddress.trim().length > 300) issues.payeeAddress = 'payee_address_too_long';
  if (input.payeeTaxId.trim() && payeeTaxIdDigits(input.payeeTaxId).length !== 13) {
    issues.payeeTaxId = 'payee_tax_id_13';
  }
  return issues;
}

export function mayApproveSubstituteReceipt(input: {
  userId: string;
  payerUserId: string;
  canConfirm: boolean;
  isOwner: boolean;
  approvalMode: SubstituteReceiptApprovalMode | null | undefined;
}): boolean {
  return input.canConfirm
    && (input.payerUserId !== input.userId
      || (input.approvalMode === 'OWNER_SELF' && input.isOwner));
}

export function resolveWizardStep(
  evidence: { status: SubstituteReceiptEvidenceStatus } | null,
): WizardStep {
  if (!evidence) return 'expense';
  if (evidence.status === 'PREPARED') return 'certify';
  if (evidence.status === 'PAYER_CERTIFIED') return 'approve';
  return 'done';
}
