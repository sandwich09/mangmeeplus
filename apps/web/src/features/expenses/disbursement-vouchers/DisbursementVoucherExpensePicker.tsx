'use client';
import { useEffect, useState } from 'react';
import { disbursementExpenseReasonMessage, DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { TextField } from '@/common/components/field';
import { Modal } from '@/common/components/modal';
import { EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, btnClass } from '../ExpensesUi';
import { listDisbursementPayableExpenses } from './disbursement-vouchers.api';
import { amountError, lockOtherBranchRows } from './disbursement-voucher-form.logic';
import type { DisbursementPayableExpense } from './disbursement-vouchers.model';
import styles from './disbursement-voucher-form.module.css';

export function DisbursementVoucherExpenseRows({ rows, amounts, onToggle, onAmount, disabled = false, reasons, branchId, payeeName }: {
  rows: DisbursementPayableExpense[]; amounts: Record<string, string>; reasons?: Record<string, string>;
  onToggle: (row: DisbursementPayableExpense) => void; onAmount?: (id: string, value: string) => void; disabled?: boolean; branchId?: string | null; payeeName?: string;
}) {
  const selectedBranch = branchId ?? rows.find(row => amounts[row.expenseId] !== undefined && row.branchId)?.branchId;
  const multipleBranches = new Set(rows.map(row => row.branchId).filter(Boolean)).size > 1;
  return <div className={styles.stack} data-testid="disbursement-payable-expense-card-list">
    {rows.map(row => {
      const checked = amounts[row.expenseId] !== undefined;
      const error = checked ? amountError(amounts[row.expenseId]!, row.outstandingAmount) : null;
      const reason = reasons?.[row.expenseId] ?? (row.reasonCode ? disbursementExpenseReasonMessage(row.reasonCode, row.reservation?.documentNumber) : DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_expense_unreadable);
      return <div key={row.expenseId} className={`${styles.expenseRow} ${!row.selectable ? styles.unavailable : ''}`}>
        <label className={styles.tickRow}>
          <input type="checkbox" checked={checked} disabled={disabled || !row.selectable} onChange={() => onToggle(row)} />
          <span>
            <span className={styles.rowIdentity} data-line="identity">
              <strong className="whitespace-nowrap">{row.expenseNumber ?? t('expenses.disbursement.no_number', 'th')}</strong>
              <span className={styles.rowDate}>{formatThaiDate(row.expenseDate)}</span>
            </span>
            <span className={styles.rowDescription} data-line="description">
              {row.vendorName && row.vendorName.trim() !== payeeName?.trim() && <span className={styles.rowContext} title={row.vendorName}>{row.vendorName} · </span>}
              {row.branchName && (selectedBranch ? row.branchId !== selectedBranch : multipleBranches) && <span className={styles.rowContext}>
                {t('expenses.disbursement.other_branch_name', 'th').replace('{name}', row.branchName)} ·
              </span>}
              {row.description && <span className={styles.description} title={row.description}>{row.description}</span>}
              {row.vendorInvoiceNumber && <span className={`${styles.rowInvoice} whitespace-nowrap`} title={t('expenses.disbursement.vendor_invoice', 'th').replace('{number}', row.vendorInvoiceNumber)}>{row.vendorInvoiceNumber}</span>}
            </span>
            <span className={styles.rowBalance} data-line="balance">
              <span>{t('expenses.disbursement.outstanding', 'th').replace('{amount}', baht(row.outstandingAmount))}</span>
              {Number(row.whtAmount) > 0 && <span className={styles.withholdingHint}>
                {t('expenses.disbursement.wht_hint', 'th').replace('{wht}', baht(row.whtAmount))}
              </span>}
            </span>
          </span>
        </label>
        {!row.selectable ? <p className={styles.reason} data-line="reason">{row.reservation?.documentNumber && reason.includes(row.reservation.documentNumber)
          ? <>{reason.split(row.reservation.documentNumber)[0]}<span className="whitespace-nowrap">{row.reservation.documentNumber}</span>{reason.split(row.reservation.documentNumber).slice(1).join(row.reservation.documentNumber)}</>
          : reason}</p>
          : checked && onAmount && <div data-line="amount"><TextField id={`amount-${row.expenseId}`} inputMode="decimal" type="text" maxLength={17} label={t('expenses.disbursement.line_amount', 'th')}
            frameClassName={styles.amountField} value={amounts[row.expenseId]} onChange={event => onAmount(row.expenseId, event.target.value)} disabled={disabled}
            title={t('expenses.disbursement.partial_hint', 'th')} error={error ?? undefined} /></div>}
      </div>;
    })}
  </div>;
}

export function DisbursementVoucherOtherExpenses({ companyId, amounts, onToggle, onClose, error: selectionError, branchId, payeeName }: {
  companyId: string; amounts: Record<string, string>; onToggle: (row: DisbursementPayableExpense) => void; onClose: () => void; error: string | null; branchId?: string | null; payeeName?: string;
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DisbursementPayableExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(() => {
      void listDisbursementPayableExpenses(companyId, { search })
        .then(data => { if (active) setRows(data); })
        .catch(failure => { if (active) setError(failure); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, search, retry]);
  return <Modal open title={t('expenses.disbursement.add_other', 'th')} onClose={onClose} closeOnBackdrop={false}
    footer={<div className={styles.sheetFooter}><button type="button" className={btnClass} onClick={onClose}>{t('expenses.disbursement.use_selected', 'th')}</button></div>}>
    <div className={styles.stack}>
      <TextField type="search" label={t('expenses.disbursement.search_payee', 'th')} value={search} onChange={event => setSearch(event.target.value)} />
      {selectionError && <p role="alert" className={styles.error}>{selectionError}</p>}
      {loading ? <LoadingState label={t('expenses.disbursement.loading_sources', 'th')} /> : error ? <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry(value => value + 1)} />
        : rows.length === 0 ? <EmptyState title={t(search.trim() ? 'list.no_results' : 'expenses.disbursement.empty_payees', 'th')} description="" />
          : <DisbursementVoucherExpenseRows {...lockOtherBranchRows(rows, amounts, branchId)} amounts={amounts} onToggle={onToggle} branchId={branchId} payeeName={payeeName} />}
    </div>
  </Modal>;
}
