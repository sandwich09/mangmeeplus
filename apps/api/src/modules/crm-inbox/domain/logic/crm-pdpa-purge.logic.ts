// Pure PDPA retention/purge logic (Dev A A6). No I/O, no Nest imports — unit-tested.
// Owner decision 2026-07-09: 24 months for text, 12 months for media; finance-linked
// records are exempt (that exemption is a DB filter in the repository, not here).

import { PDPA_MEDIA_RETENTION_MONTHS, PDPA_TEXT_RETENTION_MONTHS } from '../crm-inbox.constants';

export interface RetentionCutoffs {
  /** Text messages created strictly before this instant are purgeable. */
  textBefore: Date;
  /** Media blobs created strictly before this instant are purgeable. */
  mediaBefore: Date;
}

/**
 * Subtract whole months from a date without drifting when the target month is
 * shorter (e.g. purging on the 31st clamps to the last day of the target month
 * instead of overflowing into the next). Pure — no reliance on the local clock.
 */
export function subtractMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetMonthIndex = d.getUTCMonth() - months;
  const day = d.getUTCDate();
  // Move to the 1st first so setUTCMonth never overflows, then clamp the day.
  const result = new Date(Date.UTC(d.getUTCFullYear(), targetMonthIndex, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDayOfTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

/** Retention cut-off instants for a given "now". */
export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    textBefore: subtractMonths(now, PDPA_TEXT_RETENTION_MONTHS),
    mediaBefore: subtractMonths(now, PDPA_MEDIA_RETENTION_MONTHS),
  };
}

/**
 * Whether an inbound media attachment may be purged: only ACTIVE attachments with
 * NO entity links (an AttachmentLink appears when staff flag it as a payment proof
 * or attach it to a finance/accounting document — that makes it legally retained).
 */
export function isAttachmentPurgeable(input: { status: string; linkCount: number }): boolean {
  return input.status === 'ACTIVE' && input.linkCount === 0;
}
