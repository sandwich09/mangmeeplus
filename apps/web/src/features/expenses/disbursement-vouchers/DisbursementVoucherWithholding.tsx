import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ghostClass } from '../ExpensesUi';
import { disbursementWithholdingGroups } from './disbursement-voucher-payment.logic';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

/** One row for a document line's statements and links: `note` (the state of its payment) and the certificate sentence at the left; `actions` (the receipt link) first, the certificate link beside it. */
export function DisbursementVoucherWithholding({ companyId, detail, line, canIssue, actions, note }: {
  companyId: string; detail: DisbursementVoucherDetail; line: DisbursementVoucherDetail['lines'][number]; canIssue: boolean; actions?: ReactNode; note?: ReactNode;
}) {
  const groups = disbursementWithholdingGroups({ ...detail, lines: [line] });
  if (!actions && !note && groups.length === 0) return null;
  return <div className={styles.statementRow}>
    {note}
    {groups.map(({ state, lines }) => {
      if (state === 'E_WHT') return <p key={state}>{E_WHT_WORDS[detail.header.status === 'PAID' ? 'W-V1' : 'W-V1u']}</p>;
      const pending = state === 'PENDING';
      const numbers = [...new Set(lines.map(line => line.withholdingCertificate.number).filter((number): number is string => Boolean(number)))];
      return <p key={state}>{t(pending ? canIssue ? 'expenses.disbursement.wht_issue_next' : 'expenses.disbursement.wht_external_next'
        : state === 'SYSTEM_ISSUED' ? 'expenses.disbursement.wht_system_done' : 'expenses.disbursement.wht_external_done', 'th')}
        {!pending && numbers.length > 0 && <> {t('expenses.disbursement.certificate_numbers', 'th')} {numbers.map((number, index) => <span key={number}>{index > 0 && ', '}<span className="whitespace-nowrap">{number}</span></span>)}</>}
      </p>;
    })}
    {/* The shared group: one size side by side, or stacked at one width when the names do not fit (a name never wraps inside a narrow button). */}
    <ActionGroup>
      {actions}
      {groups.filter(({ state }) => state !== 'E_WHT').flatMap(({ state, lines }) => lines.map(line => <Link key={`${state}:${line.expenseId}`} href={`/companies/${companyId}/expenses/${encodeURIComponent(line.expenseId)}?section=wht-certificate#wht-certificate`} className={`${ghostClass} whitespace-nowrap`}>
        {t(state === 'PENDING' ? canIssue ? 'expenses.disbursement.go_issue_wht' : 'expenses.disbursement.open_item' : 'expenses.disbursement.view_wht', 'th')}
      </Link>))}
    </ActionGroup>
  </div>;
}
