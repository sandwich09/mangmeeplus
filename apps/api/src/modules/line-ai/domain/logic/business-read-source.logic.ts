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

// ---- categoryName / vendorName resolution (spec §3 row 6) ----

export type NameCandidate = { id: string; name: string };

export type NameResolution =
  | { kind: 'resolved'; id: string; name: string }
  | { kind: 'ambiguous'; matches: NameCandidate[] }
  | { kind: 'not_found'; available: NameCandidate[] };

const NAME_MATCH_DISPLAY_LIMIT = 10;

/** Thai-safe fold for name matching. NFC only — NFKC recomposes/decomposes Thai combining marks
 *  into forms that no longer compare equal to what the user actually typed. */
export function normalizeNameQuery(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase();
}

/** Exact match first, then contains; at most 10 candidates come back either way, as near-matches
 *  or as the available catalog to pick from. */
export function resolveNameCandidate(rawQuery: string, candidates: readonly NameCandidate[]): NameResolution {
  const query = normalizeNameQuery(rawQuery);
  const scored = candidates.map((candidate) => ({ candidate, norm: normalizeNameQuery(candidate.name) }));
  const exact = scored.filter((row) => row.norm === query);
  const pool = exact.length > 0 ? exact : scored.filter((row) => row.norm.includes(query));
  if (pool.length === 1) return { kind: 'resolved', id: pool[0]!.candidate.id, name: pool[0]!.candidate.name };
  if (pool.length > 1) return { kind: 'ambiguous', matches: pool.slice(0, NAME_MATCH_DISPLAY_LIMIT).map((row) => row.candidate) };
  return { kind: 'not_found', available: candidates.slice(0, NAME_MATCH_DISPLAY_LIMIT) };
}

export type AppliedNameFilter =
  | { status: 'applied'; id?: string; name?: string }
  | { status: 'ambiguous'; matches: NameCandidate[] }
  | { status: 'not_found'; available: NameCandidate[] }
  | { status: 'conflict' };

/** Combines an id that may already be known (e.g. from a prior turn) with a free-text name for the
 *  SAME field. An id that disagrees with an unambiguous name resolution is a caller/model input
 *  error; an id alongside an ambiguous or unresolved name is trusted as-is, since the id is already
 *  precise and the name is redundant context in that case. */
export function applyNameFilter(
  givenId: string | undefined,
  givenName: string | undefined,
  candidates: readonly NameCandidate[],
): AppliedNameFilter {
  if (!givenName) return { status: 'applied', id: givenId };
  const resolution = resolveNameCandidate(givenName, candidates);
  if (resolution.kind === 'resolved') {
    if (givenId && givenId !== resolution.id) return { status: 'conflict' };
    return { status: 'applied', id: resolution.id, name: resolution.name };
  }
  if (givenId) return { status: 'applied', id: givenId };
  return resolution.kind === 'ambiguous'
    ? { status: 'ambiguous', matches: resolution.matches }
    : { status: 'not_found', available: resolution.available };
}
