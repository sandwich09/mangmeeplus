export type HealthServiceName = 'ai-gateway';

export type HealthStatus = {
  service: HealthServiceName;
  status: 'ok';
  timestamp: string;
};
