import type { ExpenseDetail } from './expenses.model';
import { t } from '@/common/i18n/workspace-i18n.logic';

export function ExpenseDisbursementReopenNotice({ payments }: { payments?: ExpenseDetail['payments'] }) {
  const numbers = [...new Set(payments?.filter(payment => payment.status !== 'VOIDED' && payment.disbursementVoucher)
    .map(payment => payment.disbursementVoucher!.documentNumber))];
  if (!numbers.length) return null;
  const [before, after] = t('expenses.disbursement.reopen_paid_notice', 'th').split('{number}');
  return <p className="text-sm leading-6 text-gray-700 [overflow-wrap:anywhere]">{before}{numbers.map((number, index) => <span key={number}>{index > 0 && ', '}<span className="whitespace-nowrap">{number}</span></span>)}{after}</p>;
}
