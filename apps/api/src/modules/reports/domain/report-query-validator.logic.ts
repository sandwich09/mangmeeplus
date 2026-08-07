import { BadRequestException } from '@nestjs/common';
import type { ReportDatasetDefinitionDto, ReportQueryInput } from '@watchdog-bms/contracts';
import { civilDate, civilPeriodKey } from '@watchdog-bms/contracts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;

export const REPORT_MAX_PAGE_SIZE = 100;
export const REPORT_SYNC_EXPORT_MAX_ROWS = 5_000;

export function defaultPeriodKey(now = new Date()): string {
  return civilPeriodKey(civilDate(now));
}

export function defaultDateRange(now = new Date()): { fromDate: string; toDate: string } {
  const today = civilDate(now);
  return { fromDate: `${today.slice(0, 8)}01`, toDate: today };
}

export function validateReportQuery(definition: ReportDatasetDefinitionDto, input: ReportQueryInput): Required<Pick<ReportQueryInput, 'filters' | 'dimensions' | 'measures' | 'sort' | 'page' | 'pageSize'>> & Pick<ReportQueryInput, 'chartKind' | 'datasetCode'> {
  const filterKeys = new Set(definition.supportedFilters.map((filter) => filter.key));
  const dimensionKeys = new Set(definition.supportedDimensions.map((dimension) => dimension.key));
  const measureKeys = new Set(definition.supportedMeasures.map((measure) => measure.key));
  const sortKeys = new Set([...filterKeys, ...dimensionKeys, ...measureKeys]);

  const filters = { ...(input.filters ?? {}) };
  if (definition.supportedFilters.some((filter) => filter.key === 'periodKey') && !filters.periodKey) {
    filters.periodKey = defaultPeriodKey();
  }
  if (definition.supportedFilters.some((filter) => filter.key === 'fromDate') && !filters.fromDate && !filters.toDate) {
    const range = defaultDateRange();
    if (filterKeys.has('fromDate')) filters.fromDate = range.fromDate;
    if (filterKeys.has('toDate')) filters.toDate = range.toDate;
  }

  for (const [key, value] of Object.entries(filters)) {
    if (!filterKeys.has(key)) throw new BadRequestException({ code: 'invalid_filter', message: `Unknown filter: ${key}` });
    if ((key === 'fromDate' || key === 'toDate' || key === 'asOfDate') && typeof value === 'string' && !DATE_RE.test(value)) {
      throw new BadRequestException({ code: 'invalid_filter', message: `Invalid date filter: ${key}` });
    }
    if (key === 'periodKey' && typeof value === 'string' && !PERIOD_RE.test(value)) {
      throw new BadRequestException({ code: 'invalid_filter', message: 'Invalid periodKey' });
    }
  }

  const dimensions = input.dimensions ?? [];
  for (const dimension of dimensions) {
    if (!dimensionKeys.has(dimension)) throw new BadRequestException({ code: 'invalid_dimension', message: `Unknown dimension: ${dimension}` });
  }

  const measures = input.measures ?? [];
  for (const measure of measures) {
    if (!measureKeys.has(measure)) throw new BadRequestException({ code: 'invalid_measure', message: `Unknown measure: ${measure}` });
  }

  const sort = input.sort ?? [];
  for (const item of sort) {
    if (!sortKeys.has(item.field)) throw new BadRequestException({ code: 'invalid_sort', message: `Unknown sort field: ${item.field}` });
    if (item.direction !== 'asc' && item.direction !== 'desc') throw new BadRequestException({ code: 'invalid_sort', message: 'Invalid sort direction' });
  }

  const page = Number(input.page ?? 1);
  const pageSize = Number(input.pageSize ?? REPORT_MAX_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException({ code: 'invalid_page', message: 'Invalid page' });
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > REPORT_MAX_PAGE_SIZE) {
    throw new BadRequestException({ code: 'invalid_page_size', message: `pageSize must be 1-${REPORT_MAX_PAGE_SIZE}` });
  }

  const chartKind = input.chartKind ?? definition.supportedChartKinds[0] ?? 'table';
  if (!definition.supportedChartKinds.includes(chartKind)) {
    throw new BadRequestException({ code: 'invalid_chart_kind', message: `Unsupported chart kind: ${chartKind}` });
  }

  return { datasetCode: input.datasetCode, filters, dimensions, measures, sort, chartKind, page, pageSize };
}
