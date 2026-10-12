'use client';

import { useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { cx } from '@/common/components/mangmee';
import { btnClass, ghostClass } from '../ExpensesUi';
import { downloadDisbursementVoucherDocument } from './disbursement-vouchers.api';
import { disbursementDocumentKind } from './disbursement-voucher-document.logic';
import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

export function DisbursementVoucherDocumentFile({ companyId, header, primary = false, actionBlocked = false }: {
  companyId: string; header: DisbursementVoucherHeader; primary?: boolean; actionBlocked?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const kind = disbursementDocumentKind(header);
  const download = async () => {
    if (inFlight.current || actionBlocked || !kind || !header.documentNumber) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await downloadDisbursementVoucherDocument(companyId, header.id, header.documentNumber); }
    catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (!kind) return null;
  return <div className={primary ? styles.journeyBar : styles.stack}>
    <div className={primary ? styles.journeyBarInner : styles.stack}>
      {error !== null && <p role="alert" className={styles.error}>{apiErrorMessage(error)}</p>}
      <button type="button" className={primary ? cx(btnClass, styles.action) : ghostClass} disabled={busy || actionBlocked} aria-busy={busy || actionBlocked} onClick={() => void download()}>
        {t(busy ? 'expenses.disbursement.working' : header.status === 'CANCELLED' ? kind === 'paid' ? 'expenses.disbursement.download_cancelled' : 'expenses.disbursement.print_cancelled' : kind === 'paid' ? 'expenses.disbursement.download' : 'expenses.disbursement.print', 'th')}
      </button>
    </div>
  </div>;
}
