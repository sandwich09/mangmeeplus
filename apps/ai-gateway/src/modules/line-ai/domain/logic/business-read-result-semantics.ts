type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

const LEGACY_INCOMPLETE_KEY = /truncat|partial|capped|incomplete/i;

/** Aggregate truth is independent from bounded detail rows. */
export function aggregationIncomplete(data: UnknownRecord): boolean {
  const completeness = record(data['completeness']);
  const aggregate = completeness?.['aggregate'];
  if (aggregate !== undefined && aggregate !== 'complete') return true;
  return Object.entries(data).some(([key, value]) => LEGACY_INCOMPLETE_KEY.test(key) && Boolean(value));
}

export function appliedPeriod(data: UnknownRecord | undefined): { fromDate: string; toDate: string } | undefined {
  const query = record(data?.['queryApplied']);
  const period = record(query?.['period']);
  const startDate = period?.['startDate'];
  const endDate = period?.['endDate'];
  if (typeof startDate === 'string' && typeof endDate === 'string') return { fromDate: startDate, toDate: endDate };
  return undefined;
}

export function aggregateState(data: UnknownRecord | undefined): 'known' | 'empty' | 'unknown' | 'conflict' {
  if (!data || aggregationIncomplete(data)) return 'unknown';
  if (data['mixedCurrency'] === true && data['totalAmount'] !== null) return 'conflict';
  const facts = Array.isArray(data['facts']) ? data['facts'] : [];
  if (facts.some((item) => record(item)?.['state'] === 'conflict')) return 'conflict';
  if (facts.length > 0 && facts.every((item) => record(item)?.['state'] === 'empty')) return 'empty';
  return 'known';
}

