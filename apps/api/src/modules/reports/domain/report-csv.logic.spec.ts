import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as csvLogic from './report-csv.logic';
import { buildReportCsv } from './report-csv.logic';

describe('buildReportCsv', () => {
  it('escapes commas, quotes, and spreadsheet formulas', () => {
    const csv = buildReportCsv({
      columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: [{ name: '=cmd, "bad"', amount: '10.00' }],
    });
    assert.equal(csv, '\uFEFFName,Amount\n\"\'=cmd, \"\"bad\"\"\",10.00');
  });

  it('neutralizes every supported formula prefix including whitespace, tab, CR, and BOM', () => {
    const values = ['+1', '-1', '@sum', ' =1', '\t=1', '\r=1', '\n=1', '\u00A0=1', '\uFEFF =1'];
    const csv = buildReportCsv({
      columns: values.map((_, index) => ({ key: String(index), label: String(index), type: 'string' as const })),
      rows: [Object.fromEntries(values.map((value, index) => [String(index), value]))],
    });
    for (const value of values) assert.ok(csv.includes(`'${value}`), value);
  });
});

// A person opens the CSV in a spreadsheet: dates and times are the company's (Asia/Bangkok), written so the
// spreadsheet still sorts them, and the file is named by the report's Thai title and the day.
describe('CSV dates and file name', () => {
  it('writes the Bangkok day and time, sortable, and keeps a civil date as it is', () => {
    const csv = buildReportCsv({
      columns: [
        { key: 'day', label: 'วันที่เอกสาร', type: 'date' },
        { key: 'at', label: 'วันและเวลา', type: 'datetime' },
        { key: 'due', label: 'วันครบกำหนด', type: 'date' },
      ],
      rows: [{ day: '2026-08-31T17:00:00.000Z', at: '2026-09-02T03:05:00.000Z', due: '2026-09-30' }, { day: null, at: null, due: null }],
    });
    assert.equal(csv, '\uFEFFวันที่เอกสาร,วันและเวลา,วันครบกำหนด\n2026-09-01,2026-09-02 10:05,2026-09-30\n,,');
  });

  it('names the file by the Thai title and the day, with characters every system accepts', () => {
    const fileName = (csvLogic as unknown as { reportCsvFileName?: (title: string, day: string, partial: boolean) => string }).reportCsvFileName;
    assert.equal(typeof fileName, 'function', 'reportCsvFileName');
    assert.equal(fileName!('สรุปคำแนะนำจาก AI', '2026-10-03', false), 'สรุปคำแนะนำจาก-AI-2026-10-03.csv');
    assert.equal(fileName!('อายุหนี้ลูกหนี้การค้า', '2026-10-03', true), 'อายุหนี้ลูกหนี้การค้า-2026-10-03-ข้อมูลบางส่วน.csv');
    assert.doesNotMatch(fileName!('ก/ข:ค*?"<>|', '2026-10-03', false), /[\/\\:*?"<>| ]/);
  });
});
