import Link from 'next/link';
import { companyProfilePath, THAI_SYSTEM_ROLE_NAMES, whtPayerMissingLabel, type WhtPayerMissing } from '@watchdog-bms/contracts';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { btnClass } from './ExpensesUi';

export function WhtPayerIdentityNotice({ companyId, missing, permissions, primary = false, returnTo }: { companyId: string; missing: readonly WhtPayerMissing[]; permissions: readonly string[]; primary?: boolean; returnTo?: string }) {
  if (!missing.length) return null;
  return <div className="min-w-0 space-y-2 text-sm leading-6">
    <p>{formatMessage(t('expenses.certificate_card.payer_missing', 'th'), { missing: whtPayerMissingLabel(missing) })}</p>
    {permissions.includes('company.legal_identity.manage') ? <Link href={`${companyProfilePath(companyId)}${returnTo ? `?${new URLSearchParams({ returnTo })}` : ''}`} className={primary ? `${btnClass} w-full sm:w-auto` : 'min-h-11 inline-flex items-center underline underline-offset-2'}>
      {t(primary ? 'expenses.certificate_card.payer_fill' : 'expenses.certificate_card.payer_fill_link', 'th')}</Link>
      : <p>{formatMessage(t('expenses.certificate_card.payer_ask', 'th'), { owner: THAI_SYSTEM_ROLE_NAMES.OWNER })}</p>}
  </div>;
}
