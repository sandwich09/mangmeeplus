import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptListItem,
} from '@watchdog-bms/contracts';
import { mayApproveSubstituteReceipt } from './substitute-receipt-wizard.model';

export type SubstituteReceiptHubModel = {
  waitingForSignature: SubstituteReceiptListItem[];
  waitingForApproval: SubstituteReceiptListItem[];
  issuedThisMonthCount: number;
  issuedThisMonthAmount: number;
  awaitingSignatureCount: number;
  awaitingApprovalCount: number;
  supersededCount: number;
};

export function buildSubstituteReceiptHubModel(
  items: SubstituteReceiptListItem[],
  input: {
    userId: string;
    canApprove: boolean;
    /** Self-approval needs an OWNER/ADMIN/MANAGER role server-side (owner decision 2026-08-10); without this the strip offers work the API rejects. */
    canSelfApprove: boolean;
    approvalMode: SubstituteReceiptApprovalMode;
    currentYearMonth: string;
  },
): SubstituteReceiptHubModel {
  const waitingForSignature = items.filter(
    (item) => item.status === 'PREPARED' && item.payerUserId === input.userId,
  );
  const waitingForApproval = items.filter((item) => item.status === 'PAYER_CERTIFIED'
    && mayApproveSubstituteReceipt({
      userId: input.userId,
      payerUserId: item.payerUserId,
      canConfirm: input.canApprove,
      canSelfApprove: input.canSelfApprove,
      approvalMode: input.approvalMode,
    }));
  const issuedThisMonth = items.filter(
    (item) => item.status === 'ISSUED' && item.updatedAt.startsWith(input.currentYearMonth),
  );
  return {
    waitingForSignature,
    waitingForApproval,
    issuedThisMonthCount: issuedThisMonth.length,
    issuedThisMonthAmount: issuedThisMonth.reduce(
      (sum, item) => sum + (Number(item.grandTotalAmount) || 0),
      0,
    ),
    awaitingSignatureCount: items.filter((item) => item.status === 'PREPARED').length,
    awaitingApprovalCount: items.filter((item) => item.status === 'PAYER_CERTIFIED').length,
    supersededCount: items.filter((item) => item.status === 'SUPERSEDED').length,
  };
}
