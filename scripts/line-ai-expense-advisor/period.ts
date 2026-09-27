/**
 * Relative period tokens for the expense-advisor eval corpus.
 *
 * The corpus is authored once but may run on any future date (§ task brief), so a gold call's
 * period is never a literal date — it is one of these tokens, resolved at run time against the
 * SAME civil-date rules `resolveBusinessReadPeriod` (apps/api .../business-read-source.logic.ts)
 * uses for a real tool call. That is what makes an oracle-resolved date range comparable with
 * whatever fromDate/toDate/periodKey a real model turn would have sent.
 */
// Relative source import, not the `@watchdog-bms/contracts` package specifier: these scripts run
// with `tsx` straight from the repo, before `packages/contracts` has necessarily been built.
import { civilPeriodKey, civilPeriodRange, todayCivilDate, DEFAULT_COMPANY_TIME_ZONE } from '../../packages/contracts/src/civil-date';

export const PERIOD_TOKENS = ['today', 'this_month', 'last_month', 'this_month_to_date'] as const;
export type PeriodToken = (typeof PERIOD_TOKENS)[number];

export type ResolvedPeriod = { fromDate: string; toDate: string };

function previousPeriodKey(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number);
  const prev = new Date(Date.UTC(year!, month! - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Resolves a corpus period token against `now` (defaults to the real clock at call time). */
export function resolvePeriodToken(token: PeriodToken, now = new Date()): ResolvedPeriod {
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
  const thisMonthKey = civilPeriodKey(today);
  switch (token) {
    case 'today':
      return { fromDate: today, toDate: today };
    case 'this_month_to_date':
      return { fromDate: `${thisMonthKey}-01`, toDate: today };
    case 'this_month': {
      const range = civilPeriodRange(thisMonthKey);
      return { fromDate: range.startDate, toDate: range.endDate };
    }
    case 'last_month': {
      const range = civilPeriodRange(previousPeriodKey(thisMonthKey));
      return { fromDate: range.startDate, toDate: range.endDate };
    }
    default: {
      const never: never = token;
      throw new Error(`Unknown period token: ${String(never)}`);
    }
  }
}

export function isPeriodToken(value: unknown): value is PeriodToken {
  return typeof value === 'string' && (PERIOD_TOKENS as readonly string[]).includes(value);
}
