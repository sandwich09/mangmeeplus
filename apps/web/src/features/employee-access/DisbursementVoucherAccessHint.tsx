import { t } from '@/common/i18n/workspace-i18n.logic';

export function DisbursementVoucherAccessHint({ entryOpen }: { entryOpen: boolean }) {
  return entryOpen ? <p className="mb-2 min-w-0 text-xs leading-5 text-gray-600 [overflow-wrap:anywhere]">{t('expenses.disbursement.access_hint', 'th')}</p> : null;
}
