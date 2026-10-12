import type { DisbursementVoucherStatus, ExpensePaymentMethod } from '@watchdog-bms/contracts';

export type {
  DisbursementVoucherCommandInput, SubmitDisbursementVoucherInput, RemindDisbursementVoucherInput, EndDisbursementVoucherInput, PayDisbursementVoucherInput, IssueDisbursementVoucherInput, ReissueDisbursementVoucherInput,
  CreateDisbursementVoucherDraftInput, UpdateDisbursementVoucherDraftInput, DisbursementVoucherHeader,
  DisbursementPayee, DisbursementPayeePage, DisbursementPayeeQuery, DisbursementPayableExpense, DisbursementPayableExpenseQuery,
  DisbursementVoucherDetail, DisbursementVoucherListPage, DisbursementVoucherListQuery,
  DisbursementVoucherListRow, DisbursementVoucherPrimaryAction, DisbursementVoucherStatus,
} from '@watchdog-bms/contracts';

export type DisbursementVoucherFilter = 'all' | DisbursementVoucherStatus;
export type DisbursementPaymentFields = { paidDate: string; paymentMethod: ExpensePaymentMethod | ''; paidFromRef: string; slipAttachmentId?: string };

export type DisbursementApprover = { userId: string; displayName: string };
export type DisbursementDialogKind = 'submit' | 'selfApprove' | 'approve' | 'return' | 'withdraw' | 'cancel' | 'delete' | 'remind';
export type DisbursementHistoryEvent = { key: string; at: string; label: string; actor: string | null; recipient?: string | null; reason?: string | null };
