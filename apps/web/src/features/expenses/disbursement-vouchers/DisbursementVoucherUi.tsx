import { MangmeeBadge } from '@/common/components/mangmee';
import { disbursementVoucherBadge } from './disbursement-vouchers.logic';
import type { DisbursementVoucherStatus } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

export function DisbursementVoucherStatusBadge({ status }: { status: DisbursementVoucherStatus }) {
  const badge = disbursementVoucherBadge(status);
  return <MangmeeBadge tone={badge.tone} className={styles.badge}>{badge.label}</MangmeeBadge>;
}
