import * as crypto from 'crypto';
import type { ReportResultDto } from '@watchdog-bms/contracts';
import { safeCsvCell } from '../../../common/export/csv.logic';

export function buildReportCsv(result: Pick<ReportResultDto, 'columns' | 'rows'>): string {
  const header = result.columns.map((column) => safeCsvCell(column.label)).join(',');
  const rows = result.rows.map((row) => result.columns.map((column) => safeCsvCell(row[column.key])).join(','));
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
