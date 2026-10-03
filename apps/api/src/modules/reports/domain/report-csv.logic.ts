import * as crypto from 'crypto';
import { civilDate, DEFAULT_COMPANY_TIME_ZONE, isCivilDate, type ReportFieldType, type ReportResultDto } from '@watchdog-bms/contracts';
import { safeCsvCell } from '../../../common/export/csv.logic';

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_COMPANY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A date as the company's day (YYYY-MM-DD) and a time as its day and clock (YYYY-MM-DD HH:mm): a spreadsheet sorts both. */
function csvValue(value: ReportResultDto['rows'][number][string], type: ReportFieldType): ReportResultDto['rows'][number][string] {
  if ((type !== 'date' && type !== 'datetime') || typeof value !== 'string' || !value) return value;
  if (type === 'date' && isCivilDate(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  return type === 'date' ? civilDate(instant) : `${civilDate(instant)} ${clock.format(instant)}`;
}

export function buildReportCsv(result: Pick<ReportResultDto, 'columns' | 'rows'>): string {
  const header = result.columns.map((column) => safeCsvCell(column.label)).join(',');
  const rows = result.rows.map((row) => result.columns.map((column) => safeCsvCell(csvValue(row[column.key], column.type))).join(','));
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

/** The file a person downloads: the report's Thai title and the company's day; a character a file name may not hold becomes '-'. */
export function reportCsvFileName(title: string, day: string, partial: boolean): string {
  const name = title.replace(/[^\u0E00-\u0E7FA-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'รายงาน';
  return `${name}-${day}${partial ? '-ข้อมูลบางส่วน' : ''}.csv`;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
