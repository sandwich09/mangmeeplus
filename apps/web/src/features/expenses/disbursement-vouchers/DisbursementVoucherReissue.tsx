'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/common/components/toast';
import { MangmeeCard, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { btnClass, ghostClass } from '../ExpensesUi';
import { reissueDisbursementVoucher } from './disbursement-vouchers.api';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import { canReissueDisbursementVoucher, disbursementCancelledPaymentSentence, disbursementCancelledPaymentReason, disbursementReissueConfirmation } from './disbursement-voucher-reissue.logic';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

export function DisbursementVoucherReissue({ companyId, detail, children }: {
  companyId: string; detail: DisbursementVoucherDetail;
  children: (button: (primary?: boolean) => ReactNode, notice: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  const allowed = canReissueDisbursementVoucher(detail);
  const issue = async () => {
    if (inFlight.current || !allowed || !open) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      commandId.current = nextDraftCommand(commandId.current, false, () => crypto.randomUUID());
      const header = await reissueDisbursementVoucher(companyId, detail.header.id, { commandId: commandId.current });
      toast.success(t('expenses.disbursement.issued_toast', 'th').replace('{number}', header.documentNumber!));
      router.push(`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(header.id)}`);
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const button = (primary = false) => allowed && <button type="button" className={primary ? cx(btnClass, styles.action) : ghostClass}
    disabled={busy} aria-busy={busy} onClick={() => { setError(null); setOpen(true); }}>{t(busy ? 'expenses.disbursement.working' : 'expenses.disbursement.reissue', 'th')}</button>;
  const sentence = disbursementCancelledPaymentSentence(detail);
  const cancellationReason = disbursementCancelledPaymentReason(detail);
  const reference = (kind: 'reissued' | 'replaces', voucher: NonNullable<DisbursementVoucherDetail['reissuedVoucher']>) => {
    const label = t(kind === 'reissued' ? 'expenses.disbursement.reissued' : 'expenses.disbursement.replaces', 'th').replace('{number}', voucher.documentNumber);
    return voucher.id ? <Link className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(voucher.id)}`}>{label}</Link> : <p>{label}</p>;
  };
  const cancelled = detail.header.status === 'CANCELLED';
  const notice = (cancelled || sentence || cancellationReason || detail.reissuedVoucher || detail.replacesVoucher || detail.header.status === 'PAID' && detail.sourceChangedAfterPaid) && <MangmeeCard className={cx(styles.section, styles.stack)}>
    {cancelled && <p>ยกเลิกโดย {detail.cancelledByName ?? detail.header.cancelledByName ?? t('expenses.disbursement.removed_member', 'th')} · <span className="mangmee-unit">{formatThaiDateTime(detail.header.cancelledAt)}</span></p>}
    {cancelled && detail.header.cancelReason && <p className={styles.historyReason}>{detail.header.cancelReason}</p>}
    {sentence && <p role="status">{sentence}</p>}
    {cancellationReason && detail.header.cancelSourceReason !== detail.header.cancelReason && <p>{cancellationReason}</p>}
    {detail.reissuedVoucher && reference('reissued', detail.reissuedVoucher)}
    {detail.replacesVoucher && reference('replaces', detail.replacesVoucher)}
    {detail.header.status === 'PAID' && detail.sourceChangedAfterPaid && <p>{t('expenses.disbursement.source_changed_after_paid', 'th')}</p>}
    {button(true)}
  </MangmeeCard>;
  const close = () => { if (!inFlight.current) setOpen(false); };
  return <>{children(button, notice)}
    <Modal open={open} title={t('expenses.disbursement.reissue_submit', 'th')} closeOnBackdrop={false} size="sm" onClose={close}
      footer={<>
        <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={close}>{t('expenses.disbursement.reissue_safe', 'th')}</button>
        <button type="button" className={btnClass} disabled={busy || !allowed} aria-busy={busy} onClick={() => void issue()}>
          {t(busy ? 'expenses.disbursement.working' : 'expenses.disbursement.reissue_submit', 'th')}
        </button>
      </>}>
      <CoverLoader active={busy} scope="modal" label={t('expenses.disbursement.working', 'th')}>
        <p>{disbursementReissueConfirmation(detail)}</p>
        {error !== null && <p role="alert" className={styles.error}>{apiErrorMessage(error)}</p>}
      </CoverLoader>
    </Modal>
  </>;
}
