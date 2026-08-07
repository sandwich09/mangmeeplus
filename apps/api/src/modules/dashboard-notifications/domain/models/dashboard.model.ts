// Domain models for Dashboard (Item 06) — no framework imports

export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'last_month' | 'custom';
export type DashboardScope = 'company' | 'role' | 'user';
export type DashboardFreshnessStatus = 'fresh' | 'stale' | 'partial' | 'unavailable';
export type DashboardGeneratedBy = 'system' | 'manual' | 'worker' | 'ai_gateway';
export type DashboardWidgetStatus = 'enabled' | 'disabled';

export type DashboardSnapshot = {
  id: string;
  companyId: string;
  scope: DashboardScope;
  scopeKey?: string;
  periodKind: DashboardPeriodKind;
  periodStart: Date;
  periodEnd: Date;
  metricsJson: Record<string, unknown>;
  sourceRefsJson: Record<string, unknown>;
  freshnessStatus: DashboardFreshnessStatus;
  generatedBy: DashboardGeneratedBy;
  generatedAt: Date;
  createdAt: Date;
};

export type DashboardWidgetConfig = {
  id: string;
  companyId: string;
  widgetKey: string;
  moduleKey: string;
  status: DashboardWidgetStatus;
  position?: number;
  configJson: Record<string, unknown>;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

// Freshness threshold in minutes
export const SNAPSHOT_FRESH_THRESHOLD_MINUTES = 15;
