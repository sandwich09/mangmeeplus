'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TextField } from '@/common/components/field';
import { CoverLoader, EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, ghostClass } from '../ExpensesUi';
import { listDisbursementPayees, listDisbursementPayableExpenses } from './disbursement-vouchers.api';
import type { DisbursementPayee, DisbursementPayeePage } from './disbursement-vouchers.model';
import styles from './disbursement-voucher-form.module.css';

export function DisbursementVoucherPayeePicker({ companyId, selectedKey, onChoose, search, onSearch, visible = true }: {
  visible?: boolean; search: string; onSearch: (value: string) => void; companyId: string; selectedKey?: string; onChoose: (payee: DisbursementPayee) => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DisbursementPayeePage | null>(null);
  const [rows, setRows] = useState<DisbursementPayee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(() => {
      void listDisbursementPayees(companyId, { search, page, pageSize: 20 })
        .then(data => { if (active) { setResult(data); setRows(previous => page === 1 ? data.data : [...previous, ...data.data]); } })
        .catch(failure => { if (active) setError(failure); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, search, page, retry]);
  return <div className={styles.stack}>
    <TextField type="search" label={t('expenses.disbursement.search_payee', 'th')} value={search} onChange={event => { onSearch(event.target.value); setPage(1); }} />
    {loading ? <LoadingState label={t('expenses.disbursement.loading_payees', 'th')} />
      : error ? <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry(value => value + 1)} />
        : rows.length === 0 ? <EmptyState title={t(search.trim() ? 'list.no_results' : 'expenses.disbursement.empty_payees', 'th')} description={search.trim() ? '' : t('expenses.disbursement.empty_payees_help', 'th')}
          action={search.trim() ? undefined : <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>{t('expenses.disbursement.go_expenses', 'th')}</Link>} /> : null}
    {!loading && !error && rows.length === 0 && search.trim() && <p className={styles.hint}>{t('expenses.disbursement.search_empty_help', 'th')}</p>}
    {!loading && !error && <div className={styles.stack} data-testid="disbursement-payee-card-list">
      {rows.map(payee => <DisbursementVoucherPayeeRow key={payee.payeeKey} companyId={companyId} payee={payee} selected={selectedKey === payee.payeeKey} onChoose={onChoose} visible={visible} />)}
      {result && page * result.pageSize < result.total && <button type="button" className={ghostClass} onClick={() => setPage(value => value + 1)}>{t('expenses.disbursement.load_more', 'th')}</button>}
    </div>}
  </div>;
}

export function DisbursementVoucherPayeeRow({ companyId, payee, selected, onChoose, visible = true }: {
  visible?: boolean; companyId: string; payee: DisbursementPayee; selected: boolean; onChoose: (payee: DisbursementPayee) => void;
}) {
  const chosenRow = useRef<HTMLButtonElement>(null);
  const [allReserved, setAllReserved] = useState(false);
  const [loading, setLoading] = useState(payee.selectableExpenseCount === 0);
  useEffect(() => {
    let active = true;
    setAllReserved(false);
    if (payee.selectableExpenseCount !== 0) { setLoading(false); return; }
    setLoading(true);
    void listDisbursementPayableExpenses(companyId, { payeeKey: payee.payeeKey }, { suppressErrorToast: true })
      .then(rows => { if (active) setAllReserved(rows.length > 0 && rows.every(row => row.reasonCode === 'reserved')); })
      // A failed extra read keeps the ordinary, truthful outstanding label; the row still opens the full list.
      .catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, payee.payeeKey, payee.selectableExpenseCount, payee.expenseCount, payee.totalOutstanding]);
  useEffect(() => { if (selected && visible) chosenRow.current?.scrollIntoView({ block: 'nearest' }); }, [selected, visible]);
  return <CoverLoader active={loading} scope="section" label={t('expenses.disbursement.loading_sources', 'th')}>
    <button ref={chosenRow} type="button" aria-pressed={selected} className={styles.payeeRow} disabled={loading} aria-busy={loading} onClick={() => onChoose(payee)}>
      <strong>{payee.displayName}</strong>
      {payee.taxId && <span>{t('expenses.disbursement.payee_tax', 'th').replace('{id}', payee.taxId)}</span>}
      <span>{t(allReserved ? 'expenses.disbursement.payee_reserved' : 'expenses.disbursement.payee_outstanding', 'th').replace('{n}', String(payee.expenseCount)).replace('{amount}', baht(payee.totalOutstanding))}</span>
    </button>
  </CoverLoader>;
}
