import { isCivilDate } from '@watchdog-bms/contracts';

export type AddressMissingListFilter = { vendorAddressMissing: true; fromDate?: string; toDate?: string };

/**
 * §11.4: the URL -> list-filter decision for the "addressMissing" view. The ภ.พ.30 workpaper
 * checklist links here WITH `fromDate`/`toDate` so its "ในงวดนี้" label stays true; the manual
 * "ยังไม่มีที่อยู่" chip on this page links here WITHOUT dates, on purpose, so it keeps browsing the
 * whole backlog across every period (§8: old documents get fixed whenever, not just this month).
 * Scopes to the range only when the URL actually carries a valid, ordered pair - the same
 * `isCivilDate` + `from <= to` check the `confirmed` view already uses - and silently falls back
 * to unscoped otherwise (missing, malformed, or inverted), never throwing.
 */
export function addressMissingListFilter(fromDate: string | null, toDate: string | null): AddressMissingListFilter {
  if (isCivilDate(fromDate) && isCivilDate(toDate) && fromDate <= toDate) {
    return { vendorAddressMissing: true, fromDate, toDate };
  }
  return { vendorAddressMissing: true };
}
