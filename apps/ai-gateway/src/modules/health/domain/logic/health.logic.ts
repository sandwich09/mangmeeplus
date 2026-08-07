import type { HealthServiceName, HealthStatus } from '../models/health-status.model';

export function buildHealthStatus(service: HealthServiceName): HealthStatus {
  return {
    service,
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
}
