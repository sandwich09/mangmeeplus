import {
  DEFAULT_COMPANY_TIME_ZONE,
  civilPeriodKey,
  civilPeriodRange,
  isCivilDate,
  isCivilPeriodKey,
  todayCivilDate,
  type SourceFact,
  type SourceRef,
  type ToolQueryApplied,
  type ToolResult,
  type ToolResultCompleteness,
} from '@watchdog-bms/contracts';

export const BUSINESS_READ_BASIS_VERSION = 'mangmee-business-read-v2';

export type AppliedPeriod = {
  fromDate: string;
  toDate: string;
  periodKey?: string;
  defaulted: boolean;
};

export type PeriodResolution =
  | { ok: true; period: AppliedPeriod }
  | { ok: false; errorCode: 'INCOMPLETE_RANGE' | 'INVALID_PERIOD' | 'CONFLICTING_PERIOD_FILTERS' };

/** One strict calendar policy for every ERP read adapter. */
export function resolveBusinessReadPeriod(
  input: { periodKey?: unknown; fromDate?: unknown; toDate?: unknown } | undefined,
  now = new Date(),
): PeriodResolution {
  const hasPeriod = input?.periodKey !== undefined;
  const hasFrom = input?.fromDate !== undefined;
  const hasTo = input?.toDate !== undefined;
  if (hasPeriod && (hasFrom || hasTo)) return { ok: false, errorCode: 'CONFLICTING_PERIOD_FILTERS' };
  if (hasPeriod) {
    if (!isCivilPeriodKey(input?.periodKey)) return { ok: false, errorCode: 'INVALID_PERIOD' };
    const range = civilPeriodRange(input.periodKey);
    return { ok: true, period: { fromDate: range.startDate, toDate: range.endDate, periodKey: input.periodKey, defaulted: false } };
  }
  if (hasFrom !== hasTo) return { ok: false, errorCode: 'INCOMPLETE_RANGE' };
  if (hasFrom && hasTo) {
    if (!isCivilDate(input?.fromDate) || !isCivilDate(input?.toDate)) return { ok: false, errorCode: 'INVALID_PERIOD' };
    if (input.fromDate > input.toDate) return { ok: false, errorCode: 'INVALID_PERIOD' };
    return { ok: true, period: { fromDate: input.fromDate, toDate: input.toDate, defaulted: false } };
  }
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
  return { ok: true, period: { fromDate: `${civilPeriodKey(today)}-01`, toDate: today, defaulted: true } };
}

export function periodError(toolName: string, asOf: string, resolution: Extract<PeriodResolution, { ok: false }>): ToolResult {
  return {
    toolName,
    status: 'error',
    sourceRefs: [],
    asOf,
    errorCode: resolution.errorCode,
    errorMessage: resolution.errorCode === 'INCOMPLETE_RANGE'
      ? 'Both fromDate and toDate are required.'
      : 'The requested period is invalid.',
  };
}

export function sourceRefId(ref: SourceRef): string {
  return ref.id ?? `${ref.module}:${ref.entityType}:${ref.entityId ?? 'summary'}`;
}

export function completeResult(rows = 0, hasMoreRows = false, groups = 0, hasMoreGroups = false): ToolResultCompleteness {
  return {
    aggregate: 'complete',
    rows: { returned: rows, hasMore: hasMoreRows, nextCursor: null },
    groups: { returned: groups, hasMore: hasMoreGroups, nextCursor: null },
    businessRecording: 'unknown',
  };
}

export function appliedQuery(
  period: AppliedPeriod | undefined,
  input: Omit<ToolQueryApplied, 'timezone' | 'period'>,
): ToolQueryApplied {
  return {
    timezone: DEFAULT_COMPANY_TIME_ZONE,
    ...(period ? { period: {
      startDate: period.fromDate,
      endDate: period.toDate,
      timezone: DEFAULT_COMPANY_TIME_ZONE,
      defaulted: period.defaulted,
      ...(period.periodKey ? { periodKey: period.periodKey } : {}),
    } } : {}),
    ...input,
  };
}

export function fact(input: Omit<SourceFact, 'id' | 'asOf' | 'state'> & {
  id: string;
  asOf: string;
  state?: SourceFact['state'];
}): SourceFact {
  return { ...input, state: input.state ?? (input.value === null ? 'unknown' : 'known') };
}
