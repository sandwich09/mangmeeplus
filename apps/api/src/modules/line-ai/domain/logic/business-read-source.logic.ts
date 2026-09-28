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

/** Leading words a category query commonly carries ("หมวดหมู่อาหาร", "หมวดเดินทาง") that are never
 *  part of the category's own stored name. Longest first: "หมวดหมู่" starts with "หมวด", so the
 *  more specific word must be tried before the shorter one that is its own prefix. */
export const CATEGORY_NAME_STRIP_PREFIXES = ['หมวดหมู่', 'หมวด'] as const;

/** Leading words a vendor query commonly carries ("ร้านสมใจ", "บริษัทเอบีซี") that are never part
 *  of the counterparty's own stored display name. */
export const VENDOR_NAME_STRIP_PREFIXES = ['บริษัท', 'ร้าน'] as const;

type ScoredCandidate = { candidate: NameCandidate; norm: string };

/** Exact match, then forward-contains (candidate contains the query) — the pair every later stage
 *  below also reruns once on a stripped query. Empty query never contains-matches everything. */
function exactThenContains(query: string, scored: readonly ScoredCandidate[]): ScoredCandidate[] {
  const exact = scored.filter((row) => row.norm === query);
  if (exact.length > 0) return exact;
  if (query.length === 0) return [];
  return scored.filter((row) => row.norm.includes(query));
}

/** Strips ONE leading prefix word (with or without a following space) from `query`, trying the
 *  longest candidate prefix first. Returns undefined when no listed prefix leads the query, or the
 *  remainder would be empty. */
function stripLeadingWord(query: string, prefixes: readonly string[]): string | undefined {
  const ordered = [...prefixes].sort((a, b) => b.length - a.length);
  for (const prefix of ordered) {
    const normPrefix = normalizeNameQuery(prefix);
    if (normPrefix.length > 0 && query.startsWith(normPrefix)) {
      const stripped = query.slice(normPrefix.length).trimStart();
      if (stripped.length > 0) return stripped;
    }
  }
  return undefined;
}

/**
 * categoryName/vendorName resolution (spec §3 row 6; relaxed per 2026-09-27 review — Thai users
 * routinely type a leading "หมวด"/"ร้าน" word the stored name never carries, or name the category
 * inside a longer phrase). Four stages, tried in order; a stage's result is used and the walk stops
 * the moment a stage is non-empty — later stages never widen or override an earlier match:
 *   (a) exact match on the normalised name;
 *   (b) forward contains — the candidate's name contains the query;
 *   (c) strip a leading category/vendor word from the QUERY only, then repeat (a) and (b);
 *   (d) reverse contains — the query contains the candidate's name — for candidates 2+ chars only,
 *       so a one-character category/vendor name can't match almost anything.
 * At most 10 candidates come back either way, as near-matches or as the available catalog to pick
 * from.
 */
export function resolveNameCandidate(
  rawQuery: string,
  candidates: readonly NameCandidate[],
  stripPrefixes: readonly string[] = [],
): NameResolution {
  const query = normalizeNameQuery(rawQuery);
  const scored = candidates.map((candidate) => ({ candidate, norm: normalizeNameQuery(candidate.name) }));

  let pool = exactThenContains(query, scored);

  if (pool.length === 0) {
    const stripped = stripLeadingWord(query, stripPrefixes);
    if (stripped !== undefined) pool = exactThenContains(stripped, scored);
  }

  if (pool.length === 0) {
    pool = scored.filter((row) => row.norm.length >= 2 && query.includes(row.norm));
  }

  if (pool.length === 1) return { kind: 'resolved', id: pool[0]!.candidate.id, name: pool[0]!.candidate.name };
  if (pool.length > 1) return { kind: 'ambiguous', matches: pool.slice(0, NAME_MATCH_DISPLAY_LIMIT).map((row) => row.candidate) };
  return { kind: 'not_found', available: candidates.slice(0, NAME_MATCH_DISPLAY_LIMIT) };
}

// ---- branchId resolution (C3, batch 5c, T-148-b: "branchId": "2" for "สาขา 2" never resolved) ----

export type BranchCandidate = { id: string; name: string; code: string | null };

export type BranchResolution =
  | { kind: 'resolved'; id: string; name: string; code: string | null }
  | { kind: 'ambiguous'; matches: BranchCandidate[] }
  | { kind: 'not_found' };

/** NFC + lowercase + ALL whitespace removed. Branches differ from each other only by a space
 *  ("สาขา 2" vs "สาขา2") or case ("BR2" vs "br2") far more often than category/vendor names do, so
 *  this is its own normalizer rather than `normalizeNameQuery` above (which only trims the ends). */
function normalizeBranchText(raw: string): string {
  return raw.normalize('NFC').toLowerCase().replace(/\s+/gu, '');
}

/** The trailing run of digits in a normalized name, if any — lets a bare "2" resolve "สาขา 2"
 *  without the customer repeating "สาขา". */
function trailingDigits(normalized: string): string | undefined {
  return /(\d+)$/u.exec(normalized)?.[1];
}

/**
 * Matches a branchId/code/name/number the model copied from the user, once the CALLER has already
 * tried an exact (case/whitespace-sensitive) id/code/name lookup and found nothing. Staged, like
 * `resolveNameCandidate` above — a stage that finds anything stops the walk before the next stage
 * ever runs:
 *   1. exact match on the normalized name or code;
 *   2. otherwise, a unique match: the normalized query is contained in the normalized name, OR the
 *      query is a bare number equal to the trailing number of the normalized name (the two ways of
 *      matching are unioned before counting, since either can name the same branch).
 * More than one candidate at whichever stage matches is ambiguous; none is not_found.
 */
export function resolveBranchCandidate(rawQuery: string, candidates: readonly BranchCandidate[]): BranchResolution {
  const query = normalizeBranchText(rawQuery);
  if (!query) return { kind: 'not_found' };
  const scored = candidates.map((candidate) => ({
    candidate,
    normName: normalizeBranchText(candidate.name),
    normCode: candidate.code ? normalizeBranchText(candidate.code) : undefined,
  }));

  let pool = scored.filter((row) => row.normName === query || row.normCode === query);

  if (pool.length === 0) {
    const queryDigits = /^\d+$/u.test(query) ? query : undefined;
    pool = scored.filter((row) => row.normName.includes(query)
      || (queryDigits !== undefined && trailingDigits(row.normName) === queryDigits));
  }

  if (pool.length === 1) {
    const b = pool[0]!.candidate;
    return { kind: 'resolved', id: b.id, name: b.name, code: b.code };
  }
  if (pool.length > 1) return { kind: 'ambiguous', matches: pool.map((row) => row.candidate) };
  return { kind: 'not_found' };
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
  stripPrefixes: readonly string[] = [],
): AppliedNameFilter {
  if (!givenName) return { status: 'applied', id: givenId };
  const resolution = resolveNameCandidate(givenName, candidates, stripPrefixes);
  if (resolution.kind === 'resolved') {
    if (givenId && givenId !== resolution.id) return { status: 'conflict' };
    return { status: 'applied', id: resolution.id, name: resolution.name };
  }
  if (givenId) return { status: 'applied', id: givenId };
  return resolution.kind === 'ambiguous'
    ? { status: 'ambiguous', matches: resolution.matches }
    : { status: 'not_found', available: resolution.available };
}
