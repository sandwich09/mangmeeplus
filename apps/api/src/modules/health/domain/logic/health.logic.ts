import type { HealthServiceName, HealthStatus } from '../models/health-status.model';

/**
 * L-13: `db` is omitted entirely — not set to undefined — when no readiness probe ran, so the
 * public liveness body carries no datastore key at all for an unauthenticated caller to read.
 */
export function buildHealthStatus(
  service: HealthServiceName,
  db?: 'ok' | 'error',
): HealthStatus {
  return {
    service,
    status: db === 'error' ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    ...(db ? { db } : {}),
  };
}
