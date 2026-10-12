import { DISBURSEMENT_VOUCHER_STATUSES } from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';

export const DISBURSEMENT_VOUCHER_PAGE_SIZE = 20;
export const DISBURSEMENT_VOUCHER_FILTERS = ['all', ...DISBURSEMENT_VOUCHER_STATUSES] as const;
export const DISBURSEMENT_VOUCHER_BADGE_TONES = {
  grey: 'slate', yellow: 'amber', blue: 'sky', green: 'brand', soft_red: 'danger',
} satisfies Record<string, MangmeeTone>;

export const DISBURSEMENT_DIALOG_TITLES = { submit: 'send_title', selfApprove: 'self_approve', approve: 'approve_document', return: 'return_title', withdraw: 'withdraw', cancel: 'cancel_title', delete: 'delete', remind: 'remind_title' } as const;
export const DISBURSEMENT_DIALOG_LABELS = { submit: 'submit', selfApprove: 'self_approve', approve: 'approve_document', return: 'return', withdraw: 'withdraw', cancel: 'cancel', delete: 'delete', remind: 'remind_send' } as const;
