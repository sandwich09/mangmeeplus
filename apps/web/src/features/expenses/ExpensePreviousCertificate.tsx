import type { WhtCertificateHandoffDto } from '@watchdog-bms/contracts';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';

export function ExpensePreviousCertificate({ previous, locale = 'th' }: { previous: NonNullable<WhtCertificateHandoffDto['previousCertificate']>; locale?: SupportedLocale }) {
  return <p className="break-words text-sm leading-6 text-gray-600">
    {t(previous.kind === 'SYSTEM' ? 'expenses.certificate_card.previous_system' : 'expenses.certificate_card.previous_external', locale)}
    {previous.number && <span className="inline-block max-w-full">{t('expenses.certificate_card.previous_number', locale)}{' '}<span className={previous.number.length > 30 ? undefined : 'whitespace-nowrap'}>{previous.number}</span></span>}{' '}
    <span className="whitespace-nowrap">{formatMessage(t('expenses.certificate_card.previous_cancelled', locale), { date: formatThaiDate(previous.cancelledAt) })}</span>
  </p>;
}
