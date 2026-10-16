'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DISBURSEMENT_VOUCHER_WORDS } from '@watchdog-bms/contracts';
import { Pagination } from '@/common/components/data-table/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { amountText, ghostClass, inputClass } from '../ExpensesUi';
import { listDisbursementPayees } from './disbursement-vouchers.api';
import type { DisbursementPayee, DisbursementPayeePage } from './disbursement-vouchers.model';
import styles from './disbursement-voucher-form.module.css';

export function DisbursementVoucherPayeePicker({ companyId, selectedKey, onChoose, search, onSearch, visible = true }: {
  visible?: boolean; search: string; onSearch: (value: string) => void; companyId: string; selectedKey?: string; onChoose: (payee: DisbursementPayee) => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DisbursementPayeePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(() => {
      void listDisbursementPayees(companyId, { search, page, pageSize: 10 })
        .then(data => { if (active) { setResult(data); } })
        .catch(failure => { if (active) setError(failure); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, search, page, retry]);
  const rows = result?.data ?? [];
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / 10));
  return <div className={styles.stack}>
    {/* One label for the step ("จ่ายให้ใคร", the heading above); what to type is said inside the box. */}
    <input type="search" className={inputClass} aria-label={t('expenses.disbursement.search_payee', 'th')} placeholder={t('expenses.disbursement.search_payee', 'th')}
      value={search} onChange={event => { onSearch(event.target.value); setPage(1); }} />
    {loading ? <LoadingState label={t('expenses.disbursement.loading_payees', 'th')} />
      : error ? <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry(value => value + 1)} />
        : rows.length === 0 ? <EmptyState title={t(search.trim() ? 'list.no_results' : 'expenses.disbursement.empty_payees', 'th')} description={search.trim() ? '' : t('expenses.disbursement.empty_payees_help', 'th')}
          action={search.trim() ? undefined : <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>{t('expenses.disbursement.go_expenses', 'th')}</Link>} /> : null}
    {!loading && !error && rows.length === 0 && search.trim() && <p className={styles.hint}>{t('expenses.disbursement.search_empty_help', 'th')}</p>}
    {!loading && !error && <div className={styles.stack} data-testid="disbursement-payee-card-list">
      {rows.map(payee => <DisbursementVoucherPayeeRow key={payee.payeeKey} companyId={companyId} payee={payee} selected={selectedKey === payee.payeeKey} onChoose={onChoose} visible={visible} />)}
      {totalPages > 1 && <Pagination prominent page={page} totalPages={totalPages} onPageChange={setPage} />}
    </div>}
  </div>;
}

export function DisbursementVoucherPayeeRow({ payee, selected, onChoose, visible = true }: {
  visible?: boolean; companyId: string; payee: DisbursementPayee; selected: boolean; onChoose: (payee: DisbursementPayee) => void;
}) {
  const displayName = payee.displayName?.trim() || DISBURSEMENT_VOUCHER_WORDS.unnamedPayee;
  const chosenRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (selected && visible) chosenRow.current?.scrollIntoView({ block: 'nearest' }); }, [selected, visible]);
  // The server offers only payees with a bill that can be paid now (owner 2026-10-15), so every row opens.
  return <button ref={chosenRow} type="button" aria-pressed={selected} className={styles.payeeRow} onClick={() => onChoose({ ...payee, displayName })}>
      {/* Two lines: who, then what is owed, with the tax number quiet at the end of that line. */}
      <strong>{displayName}</strong>
      <span className={styles.payeeFacts}>
        <span>ค้างจ่าย {payee.expenseCount} รายการ · <span className="mangmee-unit">{amountText(payee.totalOutstanding)} บาท</span></span>
        {payee.taxId && <span className={styles.payeeTax}>{t('expenses.disbursement.payee_tax', 'th').replace('{id}', payee.taxId)}</span>}
      </span>
    </button>;
}
