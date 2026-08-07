export type HealthServiceName = 'api';

export type HealthStatus = {
  service: HealthServiceName;
  status: 'ok' | 'degraded';
  timestamp: string;
  db?: 'ok' | 'error';
};
