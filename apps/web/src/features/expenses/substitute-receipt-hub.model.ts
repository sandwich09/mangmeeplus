import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptListItem,
} from '@watchdog-bms/contracts';
import { mayApproveSubstituteReceipt } from './substitute-receipt-wizard.model';

/**
 * The one status a row of the list shows. The list used to print two words per row from two
 * vocabularies (the expense's badge and the certificate's own word); this is the certificate's
 * state as the reader needs it, including the two paper waits that the stored status does not name.
 */
export type SubstituteReceiptHubStatus = 'waitingSignature' | 'waitingPaper' | 'waitingPaperReview' | 'waitingApproval' | 'issued' | 'cancelled';

export function substituteReceiptHubStatus(
  item: Pick<SubstituteReceiptListItem, 'status' | 'signatureMode' | 'payerUserId' | 'paperSubmission'>,
): SubstituteReceiptHubStatus {
  if (item.status === 'SUPERSEDED') return 'cancelled';
  if (item.status === 'ISSUED') return 'issued';
  if (item.status === 'PAYER_CERTIFIED') return 'waitingApproval';
  if (item.signatureMode === 'PAPER' && !item.payerUserId) return item.paperSubmission ? 'waitingPaperReview' : 'waitingPaper';
  return 'waitingSignature';
}

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
  const waitingForApproval = items.filter((item) => (item.status === 'PAYER_CERTIFIED' || (item.status === 'PREPARED' && Boolean(item.paperSubmission)))
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
    awaitingSignatureCount: items.filter((item) => item.status === 'PREPARED' && !item.paperSubmission).length,
    awaitingApprovalCount: items.filter((item) => (item.status === 'PAYER_CERTIFIED' || (item.status === 'PREPARED' && Boolean(item.paperSubmission)))).length,
    supersededCount: items.filter((item) => item.status === 'SUPERSEDED').length,
  };
}


export const SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE = 10;
export const SUBSTITUTE_RECEIPT_HUB_TABS = [
  { key: '', label: 'ทั้งหมด' }, { key: 'PREPARED', label: 'รอเซ็น' },
  { key: 'PAYER_CERTIFIED', label: 'รออนุมัติ' }, { key: 'ISSUED', label: 'ออกแล้ว' },
  { key: 'SUPERSEDED', label: 'ยกเลิกแล้ว' },
] as const;
export type SubstituteReceiptHubListState = {
  status: typeof SUBSTITUTE_RECEIPT_HUB_TABS[number]['key']; yearMonth: string; page: number; order: 'newest' | 'oldest';
};
export function substituteReceiptHubListState(params: Pick<URLSearchParams, 'get'>): SubstituteReceiptHubListState {
  const status = params.get('status'); const month = params.get('yearMonth') ?? ''; const page = Number(params.get('page'));
  return {
    status: SUBSTITUTE_RECEIPT_HUB_TABS.find(tab => tab.key === status)?.key ?? '',
    yearMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
  };
}
export function substituteReceiptHubListQuery(params: URLSearchParams, state: SubstituteReceiptHubListState): string {
  for (const [key, value] of Object.entries(state)) {
    if (value === '') params.delete(key); else params.set(key, String(value));
  }
  return params.toString();
}
