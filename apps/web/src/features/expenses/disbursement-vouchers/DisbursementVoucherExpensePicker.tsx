'use client';
import { useEffect, useRef, useState } from 'react';
import { disbursementExpenseReasonMessage, DISBURSEMENT_VOUCHER_MAX_LINES, DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import Link from 'next/link';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { TextField } from '@/common/components/field';
import { Modal } from '@/common/components/modal';
import { EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { amountText, btnClass, ghostClass } from '../ExpensesUi';
import { listDisbursementPayableExpenses } from './disbursement-vouchers.api';
import { amountError, groupAmountInput, initialAmount, lockOtherBranchRows } from './disbursement-voucher-form.logic';
import type { DisbursementPayableExpense } from './disbursement-vouchers.model';
import styles from './disbursement-voucher-form.module.css';

/** The amount of one line: a text box with the number pad. Commas may be typed or pasted; while the box is not being typed in, the amount reads with commas. */
function LineAmountBox({ id, value, error, disabled, onChange }: { id: string; value: string; error: string | null; disabled: boolean; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  return <TextField id={id} inputMode="decimal" type="text" autoComplete="off" maxLength={17} label={t('expenses.disbursement.line_amount', 'th')}
    frameClassName={styles.amountField} value={focused ? value : groupAmountInput(value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onChange={event => onChange(event.target.value)} disabled={disabled} title={t('expenses.disbursement.partial_hint', 'th')} error={error ?? undefined} />;
}

export function DisbursementVoucherExpenseRows({ rows, amounts, onToggle, onAmount, disabled = false, reasons, branchId, payeeName, companyId, onSelectAll, otherPayeeKey, onRemove, billNames = false }: {
  otherPayeeKey?: string; onRemove?: (row: DisbursementPayableExpense) => void; billNames?: boolean;
  companyId?: string; onSelectAll?: (checked: boolean) => void;
  rows: DisbursementPayableExpense[]; amounts: Record<string, string>; reasons?: Record<string, string>;
  onToggle: (row: DisbursementPayableExpense) => void; onAmount?: (id: string, value: string) => void; disabled?: boolean; branchId?: string | null; payeeName?: string;
}) {
  const selectable = rows.filter(row => row.selectable);
  const selectedCount = selectable.filter(row => amounts[row.expenseId] !== undefined).length;
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedCount > 0 && selectedCount < selectable.length; }, [selectedCount, selectable.length]);
  const selectedBranch = branchId ?? rows.find(row => amounts[row.expenseId] !== undefined && row.branchId)?.branchId;
  const multipleBranches = new Set(rows.map(row => row.branchId).filter(Boolean)).size > 1;
  return <div className={styles.stack} data-testid="disbursement-payable-expense-card-list">
    {selectable.length > 1 && onSelectAll && <label className={styles.tickRow}><input ref={selectAll} type="checkbox" checked={selectedCount === selectable.length} aria-checked={selectedCount > 0 && selectedCount < selectable.length ? 'mixed' : selectedCount === selectable.length}
      disabled={disabled} onChange={event => onSelectAll(event.target.checked)} />เลือกทั้งหมด</label>}
    {rows.map(row => {
      const checked = amounts[row.expenseId] !== undefined;
      const expenseNumber = row.expenseNumber?.trim();
      const error = checked ? amountError(amounts[row.expenseId]!, row.outstandingAmount) : null;
      const reason = reasons?.[row.expenseId] ?? (row.reasonCode ? disbursementExpenseReasonMessage(row.reasonCode, row.reservation?.documentNumber) : DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_expense_unreadable);
      return <div key={row.expenseId} className={`${styles.expenseRow} ${!row.selectable ? styles.unavailable : ''}`}>
        <label className={styles.tickRow}>
          <input type="checkbox" checked={checked} disabled={disabled || !row.selectable} onChange={() => onToggle(row)} />
          <span>
            <span className={styles.rowDescription} data-line="description">
              <strong className={styles.description} title={row.description ?? undefined}>{(billNames ? row.vendorName : row.description) || row.expenseNumber || t('expenses.disbursement.no_number', 'th')}</strong>
              <span className={styles.rowBalance} data-line="balance">{amountText(row.outstandingAmount)} บาท</span>
            </span>
            <span className={styles.rowIdentity} data-line="identity">
              {expenseNumber && <span className="whitespace-nowrap">{expenseNumber}</span>}
              <span className={styles.rowDate}>{expenseNumber ? '· ' : ''}{formatThaiDate(row.expenseDate)}</span>
              {row.vendorInvoiceNumber && <span className={`${styles.rowInvoice} whitespace-nowrap`} title={t('expenses.disbursement.vendor_invoice', 'th').replace('{number}', row.vendorInvoiceNumber)}>· {row.vendorInvoiceNumber}</span>}
            </span>
            {otherPayeeKey && row.payeeKey !== otherPayeeKey && <span className="inline-block rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">ชื่อบนบิล: {row.vendorName}</span>}
            {/* A name or a branch that differs from the step's own is a whole line of its own: nothing cut, no dot left hanging. */}
            {(row.vendorName && !billNames && !(otherPayeeKey && row.payeeKey !== otherPayeeKey) && row.vendorName.trim() !== payeeName?.trim() || row.branchName && (selectedBranch ? row.branchId !== selectedBranch : multipleBranches)) && <span className={styles.rowContext} data-line="context">
              {[row.vendorName && !billNames && !(otherPayeeKey && row.payeeKey !== otherPayeeKey) && row.vendorName.trim() !== payeeName?.trim() ? row.vendorName : null,
                row.branchName && (selectedBranch ? row.branchId !== selectedBranch : multipleBranches) ? t('expenses.disbursement.other_branch_name', 'th').replace('{name}', row.branchName) : null].filter(Boolean).join(' · ')}
            </span>}
            {Number(row.whtAmount) > 0 && <span className={styles.withholdingHint}>หัก ณ ที่จ่ายไว้แล้ว {amountText(row.whtAmount)} บาท</span>}
          </span>
        </label>
        {onRemove && otherPayeeKey && row.payeeKey !== otherPayeeKey && <button type="button" className="min-h-11 justify-self-start text-sm text-gray-500 underline" disabled={disabled} onClick={() => onRemove(row)}>เอาออก</button>}
        {!row.selectable ? <p className={styles.reason} data-line="reason">{row.reservation?.documentNumber && reason.includes(row.reservation.documentNumber)
          ? <>{reason.split(row.reservation.documentNumber)[0]}{row.reservation.voucherId ? <Link className="underline whitespace-nowrap" href={`/companies/${companyId}/expenses/disbursement-vouchers/${row.reservation.voucherId}`}>{row.reservation.documentNumber}</Link> : <span>{row.reservation.documentNumber}</span>}{reason.split(row.reservation.documentNumber).slice(1).join(row.reservation.documentNumber)}</>
          : reason}</p>
          : checked && onAmount && <div data-line="amount"><LineAmountBox id={`amount-${row.expenseId}`} value={amounts[row.expenseId]!} error={error} disabled={disabled}
            onChange={value => onAmount(row.expenseId, value)} /></div>}
      </div>;
    })}
  </div>;
}

export function DisbursementVoucherOtherExpenses({ companyId, amounts, onAdd, onClose, branchId, payeeName, excludeIds = [], initialRows = [] }: {
  companyId: string; amounts: Record<string, string>; onAdd: (rows: DisbursementPayableExpense[]) => void; onClose: () => void; initialRows?: DisbursementPayableExpense[]; branchId?: string | null; payeeName?: string;
  /** Already displayed rows are not offered for addition again. */
  excludeIds?: readonly string[];
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DisbursementPayableExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<DisbursementPayableExpense[]>(initialRows);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectedAmounts = Object.fromEntries(selected.map(row => [row.expenseId, initialAmount(row.outstandingAmount)]));
  const allAmounts = { ...amounts, ...selectedAmounts };
  const toggle = (row: DisbursementPayableExpense) => {
    if (!row.selectable) return;
    if (!selectedAmounts[row.expenseId] && Object.keys(allAmounts).length >= DISBURSEMENT_VOUCHER_MAX_LINES) { setSelectionError(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_too_many_lines); return; }
    setSelectionError(null);
    setSelected(previous => previous.some(item => item.expenseId === row.expenseId) ? previous.filter(item => item.expenseId !== row.expenseId) : [...previous, row]);
  };
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(() => {
      void listDisbursementPayableExpenses(companyId, { search })
        .then(data => { if (active) setRows(data.filter(row => row.selectable && !excludeIds.includes(row.expenseId))); }) // a bill that cannot be paid is not offered
        .catch(failure => { if (active) setError(failure); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, search, retry]);
  // Pressing the add button is the confirmation: the sentence above it, in the footer that never scrolls away, says what it confirms.
  const recovering = initialRows.length > 0 && selected.length === initialRows.length;
  return <Modal open title="เพิ่มบิลที่บันทึกไว้คนละชื่อ" onClose={onClose} closeOnBackdrop={false}
    footer={<div className={styles.stack}>
      {selectionError ? <p role="alert" className={styles.error}>{selectionError}</p>
        : selected.length > 0 && <p className={styles.hint}>{t('expenses.disbursement.confirm_payee', 'th').replace('{name}', payeeName ?? 'ผู้รับเงินรายนี้')}</p>}
      <ActionGroup><button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
      <button type="button" className={btnClass} onClick={() => {
        if (!selected.length) { setSelectionError('เลือกอย่างน้อย 1 รายการ'); return; }
        onAdd(selected);
      }}>{recovering ? 'ยืนยัน' : selected.length ? `เพิ่ม ${selected.length} รายการ` : 'เพิ่มรายการ'}</button></ActionGroup>
    </div>}>
    <div className={styles.stack}>
      <p className={styles.hint}>{t('expenses.disbursement.add_other_hint', 'th')}</p>
      <TextField type="search" label={t('expenses.disbursement.search_payee', 'th')} value={search} onChange={event => setSearch(event.target.value)} />
      {initialRows.length > 0 && <DisbursementVoucherExpenseRows companyId={companyId} rows={initialRows} amounts={selectedAmounts} onToggle={() => {}} disabled billNames payeeName={payeeName} />}
      {loading ? <LoadingState label={t('expenses.disbursement.loading_sources', 'th')} /> : error ? <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry(value => value + 1)} />
        : rows.length === 0 ? <EmptyState title={t(search.trim() ? 'list.no_results' : 'expenses.disbursement.empty_payees', 'th')} description="" />
          : <DisbursementVoucherExpenseRows companyId={companyId} {...lockOtherBranchRows(rows, allAmounts, branchId ?? selected.find(row => row.branchId)?.branchId)} amounts={selectedAmounts} onToggle={toggle} billNames branchId={branchId} payeeName={payeeName} />}
    </div>
  </Modal>;
}
