import * as crypto from 'crypto';
import type { TaxExportFormat } from '@watchdog-bms/contracts';
import { formatThaiExportDate, isIsoDateLike } from '../../../../common/export/thai-date.logic';
import { XLSX_MIME_TYPE, buildXlsx } from '../../../../common/export/xlsx.logic';
import { safeCsvCell } from '../../../../common/export/csv.logic';

export type TaxExportArtifact = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  checksum: string;
  byteLength: number;
};

type ExportRow = Record<string, string | number | null | undefined>;

export function buildTaxExportArtifact(format: TaxExportFormat, fileStem: string, rows: ExportRow[], payload: Record<string, unknown>): TaxExportArtifact {
  const built = buildExportBuffer(format, rows, payload);
  const checksum = crypto.createHash('sha256').update(built.buffer).digest('hex');
  return {
    fileName: `${fileStem}.${built.extension}`,
    mimeType: built.mimeType,
    contentBase64: built.buffer.toString('base64'),
    checksum,
    byteLength: built.buffer.byteLength,
  };
}

function buildExportBuffer(format: TaxExportFormat, rows: ExportRow[], payload: Record<string, unknown>) {
  switch (format) {
    case 'REVIEW_JSON':
      return { extension: 'json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8') };
    case 'CSV':
      return { extension: 'csv', mimeType: 'text/csv', buffer: Buffer.from(toCsv(rows), 'utf8') };
    case 'XLSX':
      return {
        extension: 'xlsx',
        mimeType: XLSX_MIME_TYPE,
        buffer: buildMinimalXlsx(rows),
      };
    case 'PDF':
      return { extension: 'pdf', mimeType: 'application/pdf', buffer: buildMinimalPdf(summaryLines(payload)) };
  }
}

function toCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const csvRows = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))];
  return csvRows.map((row) => row.map(safeCsvCell).join(',')).join('\n');
}

function buildMinimalXlsx(rows: ExportRow[]): Buffer {
  const headers = rows.length ? Object.keys(rows[0]!) : ['message'];
  const data = rows.length ? rows : [{ message: 'No rows' }];
  return buildXlsx(
    [headers, ...data.map((row) => headers.map((header) => {
      const value = row[header] ?? '';
      return isIsoDateLike(value) ? formatThaiExportDate(value) : value;
    }))],
    'Tax Review',
  );
}

function buildMinimalPdf(lines: string[]): Buffer {
  const text = lines.map((line, index) => `BT /F1 10 Tf 50 ${760 - index * 16} Td (${pdfText(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(chunks.join('')));
    chunks.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'utf8');
}

function pdfText(value: string): string {
  return value.replace(/[()\\]/g, (match) => `\\${match}`).slice(0, 180);
}

function summaryLines(payload: Record<string, unknown>): string[] {
  const period = payload.period as Record<string, unknown> | undefined;
  const rows = payload.rows as unknown[] | undefined;
  const issues = payload.reviewIssues as unknown[] | undefined;
  return [
    'WatchDog-BMS Thai Tax Review Export',
    `Form: ${period?.formType ?? 'unknown'}`,
    `Period: ${period?.periodKey ?? 'unknown'}`,
    `Status: ${period?.status ?? 'unknown'}`,
    `Rows: ${rows?.length ?? 0}`,
    `Open review issues: ${issues?.length ?? 0}`,
    'Manual filing only. Confirm with accountant/RD before submission.',
  ];
}
