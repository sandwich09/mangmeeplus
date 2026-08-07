import { createHash } from 'node:crypto';

export const U5_CAPACITY_LIMITS = Object.freeze({
  smokeRows: 100,
  fullRows: 5_000,
  seedChunkRows: 250,
  maxSeedRowsPerSecond: 500,
  claimBatchSizes: [1, 25] as const,
  claimConcurrencies: [1, 2, 5] as const,
  processingConcurrency: 2,
  backlogDepths: [100, 500, 1_000, 2_500, 5_000] as const,
  samplesPerDepthAndShape: 20,
  lockConcurrencies: [2, 5, 10] as const,
  lockIterations: 20,
  lockHoldMs: 10,
  maxWallMs: 10 * 60_000,
  claimP95AbortMs: 250,
  lockP95AbortMs: 500,
  connectionRatioAbort: 0.70,
  statementTimeoutMs: 2_000,
  lockTimeoutMs: 500,
  idleInTransactionTimeoutMs: 5_000,
});

export const U5_CAPACITY_APPROVAL_REF = 'owner-approved:2026-08-03:u5-c-v2';

export type CapacityConfig = {
  environment: 'uat';
  sourceCommit: string;
  marker: string;
  approvalRef: string;
};

export function parseCapacityConfig(env: NodeJS.ProcessEnv): CapacityConfig {
  const environment = env['DEPLOY_ENV'] ?? env['DEPLOY_ENVIRONMENT'];
  if (environment !== 'uat') throw new Error('capacity_environment_refused');
  const sourceCommit = (env['GIT_SHA'] ?? '').trim();
  const marker = (env['U5_CAPACITY_MARKER'] ?? '').trim();
  const approvalRef = (env['U5_CAPACITY_APPROVAL_REF'] ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('capacity_source_sha_invalid');
  if (!/^U5C-[0-9A-F]{12,32}$/.test(marker)) throw new Error('capacity_marker_invalid');
  if (approvalRef !== U5_CAPACITY_APPROVAL_REF) {
    throw new Error('capacity_exact_approval_missing');
  }
  return { environment: 'uat', sourceCommit, marker, approvalRef };
}

export function parseCapacityBaselineHash(env: NodeJS.ProcessEnv): string {
  const value = (env['U5_CAPACITY_BASELINE_HASH'] ?? '').trim();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('capacity_baseline_hash_missing');
  return value;
}

export function percentile(values: readonly number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return Math.round(sorted[index]! * 100) / 100;
}

export function latencySummary(values: readonly number[]): {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
} {
  return {
    count: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: values.length === 0 ? 0 : Math.round(Math.max(...values) * 100) / 100,
  };
}

export function markerCompanyId(marker: string): string {
  if (!/^U5C-[0-9A-F]{12,32}$/.test(marker)) throw new Error('capacity_marker_invalid');
  return `u5c-${marker.toLowerCase()}`;
}

export function markerHash(marker: string): string {
  return createHash('sha256').update(marker).digest('hex');
}

/** Canonical JSON used by the independently recomputed capacity evidence hash. */
export function canonicalCapacityJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('capacity_non_json_number');
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]));
    }
    throw new Error('capacity_non_json_value');
  };
  return JSON.stringify(normalize(value));
}

export function capacityEvidenceHash(value: unknown): string {
  return createHash('sha256').update(`${canonicalCapacityJson(value)}\n`).digest('hex');
}

/** PostgreSQL's two-int advisory-lock namespace; deterministic and isolated per fixture marker. */
export function advisoryLockKeys(marker: string): readonly [number, number] {
  const digest = createHash('sha256').update(`watchdog-u5-capacity:${marker}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)] as const;
}

export function assertClaimRowsScoped(
  rows: ReadonlyArray<{ companyId: string | null; aggregateType: string; eventKey: string }>,
  companyId: string,
  marker: string,
): void {
  for (const row of rows) {
    if (row.companyId !== companyId || row.aggregateType !== 'U5CapacityProbe' || !row.eventKey.startsWith(`${marker}:`)) {
      throw new Error('capacity_non_fixture_row_touched');
    }
  }
}

export function capacityThresholdsPass(input: {
  claimP95Ms: number;
  lockP95Ms: number;
  connectionRatio: number;
  elapsedMs: number;
}): boolean {
  return input.claimP95Ms <= U5_CAPACITY_LIMITS.claimP95AbortMs
    && input.lockP95Ms <= U5_CAPACITY_LIMITS.lockP95AbortMs
    && input.connectionRatio < U5_CAPACITY_LIMITS.connectionRatioAbort
    && input.elapsedMs <= U5_CAPACITY_LIMITS.maxWallMs;
}
