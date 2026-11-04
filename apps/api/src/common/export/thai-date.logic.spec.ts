import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import {
  ACCOUNTANT_INDEX_COLUMNS,
  type AccountantPackageIndexRow,
} from '@watchdog-bms/contracts';
import {
  buildAccountantIndexCsv,
  buildAccountantWorkbook,
} from '../../modules/expenses/domain/logic/expense-export.logic';
import { buildTaxExportArtifact } from '../../modules/tax/domain/logic/tax-export.logic';
import { formatThaiExportDate, isIsoDateLike } from './thai-date.logic';

function sheetXml(workbook: Buffer): string {
  for (let offset = 0; workbook.readUInt32LE(offset) === 0x04034b50;) {
    const size = workbook.readUInt32LE(offset + 18);
    const nameLength = workbook.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + workbook.readUInt16LE(offset + 28);
    if (workbook.subarray(offset + 30, offset + 30 + nameLength).toString() === 'xl/worksheets/sheet1.xml') {
      const data = workbook.subarray(start, start + size);
      return (workbook.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset = start + size;
  }
  throw new Error('Workbook has no first sheet');
}

describe('Thai export date formatting', () => {
  it('renders ISO dates with Thai months and Buddhist years', () => {
    assert.equal(formatThaiExportDate('2026-07-28'), '28 ก.ค. 2569');
    assert.equal(formatThaiExportDate('2026-01-05'), '5 ม.ค. 2569');
    assert.equal(formatThaiExportDate('2026-12-31'), '31 ธ.ค. 2569');
  });

  it('renders timestamps in Bangkok time regardless of the host time zone', () => {
    assert.equal(formatThaiExportDate('2026-07-28T23:59:00Z'), '29 ก.ค. 2569');
  });

  it('passes non-dates through unchanged', () => {
    assert.equal(formatThaiExportDate('2026-07'), '2026-07');
    assert.equal(formatThaiExportDate(''), '');
    assert.equal(formatThaiExportDate('RB-202607-00005'), 'RB-202607-00005');
    assert.equal(formatThaiExportDate(null), '');
    assert.equal(formatThaiExportDate('not a date'), 'not a date');
  });

  it('recognizes only strict ISO date and date-time forms', () => {
    for (const value of [
      '2026-07-28',
      '2026-07-28T23:59',
      '2026-07-28 23:59:00',
      '2026-07-28T23:59:00.123Z',
      '2026-07-28T23:59:00+07:00',
    ]) {
      assert.equal(isIsoDateLike(value), true, value);
    }
    for (const value of ['2026-07', '2026-7-8', 20260728]) {
      assert.equal(isIsoDateLike(value), false, String(value));
    }
  });
});

describe('XLSX-only Thai export dates', () => {
  it('keeps the existing accountant CSV columns byte-identical while appending the VAT decision', () => {
    const row = Object.fromEntries(
      ACCOUNTANT_INDEX_COLUMNS.map((column) => [column, '']),
    ) as AccountantPackageIndexRow;
    Object.assign(row, {
      accounting_period: '2026-07',
      uploaded_at: '2026-07-28T23:59:00Z',
      document_date: '2026-07-28',
      expense_number: 'RB-202607-00005',
      grand_total_amount: '100.0000',
      paid_at: '2026-07-28T12:00:00Z',
    });

    const csv = buildAccountantIndexCsv([row]);
    const xlsx = sheetXml(buildAccountantWorkbook({ rows: [{ ...row, last_paid_at: row.paid_at, description: row.accounting_period }], payments: [], withholding: [], visible: {}, about: { 'ช่วงวันที่': row.accounting_period } }));

    // The full CSV now includes the appended document/evidence/address columns; dates stay ISO.
    assert.equal(csv.split('\n')[0], ACCOUNTANT_INDEX_COLUMNS.join(','));
    assert.ok(csv.includes('2026-07-28T23:59:00Z'));
    assert.ok(csv.includes('2026-07-28T12:00:00Z'));
    assert.equal(
      createHash('sha256').update(csv.split('\n').map(line => line.split(',').slice(0, -7).join(',')).join('\n')).digest('hex'),
      '166ccf1be75f9f933cc439efef421396f041e0a4d317e146883ed57fc3e0b1a4',
    );
    assert.ok(xlsx.includes('29 ก.ค. 2569'));
    assert.ok(xlsx.includes('28 ก.ค. 2569'));
    assert.ok(xlsx.includes('2026-07'));
    assert.ok(!xlsx.includes('2026-07-28'));
  });

  it('keeps the tax CSV byte-identical while formatting only ISO-like XLSX values', () => {
    const rows = [{
      eventDate: '2026-07-28',
      accounting_period: '2026-07',
      sourceId: 'RB-202607-00005',
      amount: 100,
    }];
    const csv = Buffer.from(
      buildTaxExportArtifact('CSV', 'tax', rows, {}).contentBase64,
      'base64',
    );
    const xlsx = sheetXml(Buffer.from(
      buildTaxExportArtifact('XLSX', 'tax', rows, {}).contentBase64,
      'base64',
    ));

    assert.equal(
      createHash('sha256').update(csv).digest('hex'),
      'ef2400c45089ba402d1ebad48d7c151cad520bb7799ff7b26815fbd25fac8ac1',
    );
    assert.ok(xlsx.includes('28 ก.ค. 2569'));
    assert.ok(xlsx.includes('2026-07'));
    assert.ok(xlsx.includes('RB-202607-00005'));
    assert.ok(xlsx.includes('<v>100</v>'));
    assert.ok(!xlsx.includes('2026-07-28'));
  });
});
