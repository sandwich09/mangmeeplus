import { isCivilDate, todayCivilDate, type LinkExternalWhtCertificateDto, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
import { t } from '@/common/i18n/workspace-i18n.logic';

export function certificateCardAction(row: Pick<WhtCertificateHandoffListRowDto, 'status' | 'systemIssuanceOpen' | 'missing'>, permissions: readonly string[]): 'issue' | 'record' | 'download' | null {
  if (row.status === 'SYSTEM_ISSUED') return permissions.some(p => ['wht.certificate.issue', 'wht.external_certificate.link', 'wht.certificate.correct'].includes(p)) ? 'download' : null;
  if (row.status !== 'REQUIRED') return null;
  if (row.systemIssuanceOpen && permissions.includes('wht.certificate.issue') && !row.missing.length) return 'issue';
  return permissions.includes('wht.external_certificate.link') ? 'record' : null;
}

/** Another person issued or recorded this certificate while the dialog was open: this card's own sentence, not the server's. */
export function certificateRecordRefusal(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === 'wht_handoff_not_linkable' || code === 'wht_handoff_already_linked' ? t('expenses.certificate_card.record_taken', 'th') : null;
}

export type SelfIssuedCertificateValues = { number: string; date: string; reference: string; note: string };
export function selfIssuedCertificateBody(values: SelfIssuedCertificateValues, commandId: string, today: string = todayCivilDate('Asia/Bangkok')): LinkExternalWhtCertificateDto {
  if (!values.number.trim()) throw Error(t('expenses.certificate_card.number_required', 'th'));
  if (!isCivilDate(values.date)) throw Error(t('expenses.certificate_card.date_required', 'th'));
  if (values.date > today) throw Error(t('expenses.certificate_card.future_date', 'th'));
  return { commandId, externalCertificateNumber: values.number.trim(), issuedDate: values.date, externalEvidenceRef: values.reference.trim(), note: values.note.trim() || undefined };
}

export function certificateMoneyDisplay(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.replaceAll(',', '').trim());
  if (!match) return value;
  const fraction = (match[3] ?? '').padEnd(3, '0');
  const cents = BigInt(match[2]!) * 100n + BigInt(fraction.slice(0, 2)) + (fraction[2]! >= '5' ? 1n : 0n);
  return `${match[1]}${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(cents % 100n).toString().padStart(2, '0')}`;
}
