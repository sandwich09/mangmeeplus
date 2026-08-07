import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
