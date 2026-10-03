export type ReportDatasetCategory =
  | 'FINANCIAL'
  | 'SALES'
  | 'INVENTORY'
  | 'EXPENSE'
  | 'TAX'
  | 'BANK'
  | 'CRM'
  | 'PROCUREMENT'
  | 'OPERATIONS'
  | 'AI'
  | 'CUSTOM';

export type ReportDatasetStatus = 'ENABLED' | 'FORBIDDEN' | 'UNAVAILABLE' | 'DISABLED';

export type ReportQueryStatus =
  | 'READY'
  | 'PARTIAL'
  | 'EMPTY'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'STALE'
  | 'INVALID_FILTER'
  | 'FAILED';

export type ReportChartKind = 'table' | 'kpi' | 'bar' | 'line' | 'stacked_bar' | 'donut' | 'aging_bucket';
export type ReportFieldType = 'string' | 'number' | 'money' | 'date' | 'datetime' | 'boolean' | 'enum';
export type ReportPermissionMode = 'all' | 'any';

export type ReportFieldDefinition = {
  key: string;
  label: string;
  type: ReportFieldType;
  required?: boolean;
  options?: string[];
};

export type ReportDatasetDefinitionDto = {
  code: string;
  version: number;
  title: string;
  description: string;
  category: ReportDatasetCategory;
  sourceModule: string;
  status: ReportDatasetStatus;
  unavailableReason?: string;
  requiredReportPermissions: string[];
  requiredSourcePermissions: string[];
  sourcePermissionMode: ReportPermissionMode;
  supportedFilters: ReportFieldDefinition[];
  supportedDimensions: ReportFieldDefinition[];
  supportedMeasures: ReportFieldDefinition[];
  supportedChartKinds: ReportChartKind[];
  freshnessSlaSeconds: number;
};

export type ReportCatalogDto = {
  generatedAt: string;
  datasets: ReportDatasetDefinitionDto[];
};

export type ReportFilterValue = string | number | boolean | string[] | null;

export type ReportSortInput = {
  field: string;
  direction: 'asc' | 'desc';
};

export type ReportQueryInput = {
  datasetCode: string;
  filters?: Record<string, ReportFilterValue>;
  dimensions?: string[];
  measures?: string[];
  sort?: ReportSortInput[];
  chartKind?: ReportChartKind;
  page?: number;
  pageSize?: number;
};

export type ReportColumnDto = {
  key: string;
  label: string;
  type: ReportFieldType;
};

export type ReportSourceRefDto = {
  label: string;
  module: string;
  entityType: string;
  entityId?: string;
  asOf?: string;
  permissionChecked: true;
  webPath?: string;
};

export type ReportFreshnessDto = {
  computedAt: string;
  sourceModules: string[];
  freshnessStatus: 'fresh' | 'stale' | 'unknown';
  staleReason?: string;
};

/** The report page's freshness card and the report rows that carry a freshness use these words. */
export const REPORT_FRESHNESS_LABELS: Record<ReportFreshnessDto['freshnessStatus'], string> = {
  fresh: 'ข้อมูลล่าสุด',
  stale: 'ข้อมูลอาจไม่ล่าสุด',
  unknown: 'ยังตรวจเวลาอัปเดตไม่ได้',
};

/** Report rows and amounts: the baht has a Thai word; another currency keeps its code, as on every other page. */
export const REPORT_CURRENCY_WORDS: Readonly<Record<string, string>> = { THB: 'บาท' };

export type ReportChartDto = {
  kind: ReportChartKind;
  labels: string[];
  series: Array<{ key: string; label: string; values: Array<string | number | null> }>;
};

export type ReportResultDto = {
  runId: string;
  dataset: Pick<ReportDatasetDefinitionDto, 'code' | 'version' | 'title' | 'category' | 'sourceModule'>;
  status: ReportQueryStatus;
  computedAt: string;
  freshness: ReportFreshnessDto;
  warnings: string[];
  columns: ReportColumnDto[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totals?: Record<string, string | number | null>;
  chart?: ReportChartDto;
  sourceRefs: ReportSourceRefDto[];
  filters: Record<string, ReportFilterValue>;
  page: number;
  pageSize: number;
  total: number;
};

export type ReportRunHistoryItemDto = {
  id: string;
  datasetCode: string;
  datasetTitle: string;
  datasetVersion: number;
  status: ReportQueryStatus;
  rowCount: number;
  computedAt?: string;
  createdAt: string;
  errorCode?: string;
  own: boolean;
};

export type ReportRunHistoryPageDto = {
  items: ReportRunHistoryItemDto[];
  pageSize: number;
  nextCursor?: string;
};

export type ReportViewVisibility = 'PRIVATE' | 'COMPANY' | 'ROLE' | 'TEAM';

export type ReportViewDto = {
  id: string;
  companyId: string;
  ownerUserId: string;
  datasetCode: string;
  datasetVersion: number;
  name: string;
  description?: string;
  visibility: ReportViewVisibility;
  sharedRoleIds: string[];
  sharedTeamIds: string[];
  filters: Record<string, ReportFilterValue>;
  dimensions: string[];
  measures: string[];
  sort: ReportSortInput[];
  chartConfig: { chartKind?: ReportChartKind };
  pinned: boolean;
  invalidReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateReportViewInput = {
  datasetCode: string;
  name: string;
  description?: string;
  visibility?: ReportViewVisibility;
  sharedRoleIds?: string[];
  sharedTeamIds?: string[];
  filters?: Record<string, ReportFilterValue>;
  dimensions?: string[];
  measures?: string[];
  sort?: ReportSortInput[];
  chartConfig?: { chartKind?: ReportChartKind };
  pinned?: boolean;
};

export type UpdateReportViewInput = Partial<Omit<CreateReportViewInput, 'datasetCode'>>;

export type ReportExportFormat = 'CSV' | 'XLSX';
export type ReportExportStatus = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export type CreateReportExportInput = {
  datasetCode: string;
  format: ReportExportFormat;
  filters?: Record<string, ReportFilterValue>;
  viewId?: string;
};

export type ReportExportRequestDto = {
  id: string;
  companyId: string;
  requestedByUserId: string;
  datasetCode: string;
  datasetTitle?: string;
  datasetVersion: number;
  viewId?: string;
  runId?: string;
  format: ReportExportFormat;
  status: ReportExportStatus;
  rowCount: number;
  fileName?: string;
  fileMimeType?: string;
  fileSizeBytes?: number;
  sha256?: string;
  expiresAt?: string;
  errorCode?: string;
  errorMessage?: string;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ReportExportDownloadDto = {
  request: ReportExportRequestDto;
  content: string;
};

export type ReportDrilldownInput = {
  datasetCode: string;
  sourceRef: ReportSourceRefDto;
};

export type ReportDrilldownDto = {
  allowed: boolean;
  webPath?: string;
  reason?: string;
};

export const REPORT_PERMISSION_KEYS = {
  CATALOG_READ: 'report.catalog.read',
  DATASET_READ: 'report.dataset.read',
  QUERY_RUN: 'report.query.run',
  VIEW_READ: 'report.view.read',
  VIEW_CREATE: 'report.view.create',
  VIEW_UPDATE_OWN: 'report.view.update_own',
  VIEW_MANAGE: 'report.view.manage',
  VIEW_SHARE: 'report.view.share',
  SNAPSHOT_READ: 'report.snapshot.read',
  EXPORT: 'report.export',
  EXPORT_READ_OWN: 'report.export.read_own',
  EXPORT_MANAGE: 'report.export.manage',
  SUBSCRIPTION_MANAGE: 'report.subscription.manage',
  AUDIT_READ: 'report.audit.read',
  BI_VIEW_READ: 'bi.view.read',
  BI_VIEW_CREATE: 'bi.view.create',
  BI_VIEW_UPDATE_OWN: 'bi.view.update_own',
  BI_VIEW_SHARE: 'bi.view.share',
  ADMIN: 'bi.admin',
} as const;
