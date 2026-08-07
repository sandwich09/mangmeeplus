// Dashboard and Notification shared contracts (Item 06)

export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'last_month' | 'custom';

export type DashboardMetricFreshness = 'fresh' | 'stale' | 'unavailable';

export type DashboardWidgetKind =
  | 'metric_card'
  | 'metric_list'
  | 'trend'
  | 'queue'
  | 'alert_digest'
  | 'module_status';

export type DashboardSourceRef = {
  module: string;
  sourceType: string;
  sourceId?: string;
  label: string;
  href?: string;
  permissionKey?: string;
};

export type DashboardMetricValue = {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  severity?: 'normal' | 'info' | 'warning' | 'critical';
  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
    value: number | null;
    label: string;
  };
  freshness: DashboardMetricFreshness;
  sourceRefs: DashboardSourceRef[];
  computedAt: string;
};

export type DashboardWidget = {
  key: string;
  title: string;
  kind: DashboardWidgetKind;
  module: string;
  metrics: DashboardMetricValue[];
  href?: string;
  unavailableReason?: string;
};

export type DashboardSnapshotDto = {
  id: string;
  companyId: string;
  periodKind: DashboardPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  freshnessStatus: 'fresh' | 'stale' | 'partial' | 'unavailable';
  widgets: DashboardWidget[];
};

export type GenerateSnapshotDto = {
  periodKind?: DashboardPeriodKind;
  periodStart?: string;
  periodEnd?: string;
};
