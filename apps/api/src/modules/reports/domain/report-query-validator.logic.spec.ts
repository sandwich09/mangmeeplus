import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportDatasetDefinitionDto } from '@watchdog-bms/contracts';
import { defaultDateRange, defaultPeriodKey, validateReportQuery } from './report-query-validator.logic';

const definition: ReportDatasetDefinitionDto = {
  code: 'test.report',
  version: 1,
  title: 'Test',
  description: 'Test report',
  category: 'CUSTOM',
  sourceModule: 'test',
  status: 'ENABLED',
  requiredReportPermissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run'],
  requiredSourcePermissions: ['test.read'],
  sourcePermissionMode: 'all',
  supportedFilters: [
    { key: 'periodKey', label: 'Period', type: 'string' },
    { key: 'fromDate', label: 'From date', type: 'date' },
    { key: 'toDate', label: 'To date', type: 'date' },
  ],
  supportedDimensions: [{ key: 'account', label: 'Account', type: 'string' }],
  supportedMeasures: [{ key: 'amount', label: 'Amount', type: 'money' }],
  supportedChartKinds: ['table', 'bar'],
  freshnessSlaSeconds: 300,
};

describe('validateReportQuery', () => {
  it('defaults period and caps page size', () => {
    const out = validateReportQuery(definition, { datasetCode: 'test.report', pageSize: 100 });
    assert.match(String(out.filters.periodKey), /^\d{4}-\d{2}$/);
    assert.equal(out.page, 1);
    assert.equal(out.pageSize, 100);
  });

  it('rejects unknown fields', () => {
    assert.throws(
      () => validateReportQuery(definition, { datasetCode: 'test.report', filters: { nope: 'x' } }),
      /Unknown filter/,
    );
    assert.throws(
      () => validateReportQuery(definition, { datasetCode: 'test.report', dimensions: ['nope'] }),
      /Unknown dimension/,
    );
    assert.throws(
      () => validateReportQuery(definition, { datasetCode: 'test.report', measures: ['nope'] }),
      /Unknown measure/,
    );
  });

  it('rejects invalid date, period, chart, and excessive page size', () => {
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { fromDate: '07/04/2026' } }), /Invalid date/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { periodKey: '2026-Q1' } }), /Invalid periodKey/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', chartKind: 'line' }), /Unsupported chart kind/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', pageSize: 101 }), /pageSize/);
  });

  it('accepts a complete real date range and rejects partial, impossible, reversed, or mixed periods', () => {
    const valid = validateReportQuery(definition, {
      datasetCode: 'test.report', filters: { fromDate: '2024-02-29', toDate: '2024-03-01' },
    });
    assert.deepEqual(valid.filters, { fromDate: '2024-02-29', toDate: '2024-03-01' });
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { fromDate: '2026-02-01' } }), /supplied together/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { fromDate: '2026-02-29', toDate: '2026-03-01' } }), /Invalid date/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { fromDate: '2026-03-01', toDate: '2026-02-28' } }), /must not be after/);
    assert.throws(() => validateReportQuery(definition, { datasetCode: 'test.report', filters: { periodKey: '2026-02', fromDate: '2026-02-01', toDate: '2026-02-28' } }), /cannot be combined/);
  });
});

// §5.2 — these defaults read the UTC month/day. Between 00:00 and 07:00 Bangkok that is the
// previous day, and on the 1st the previous MONTH, so a report defaulted to the wrong period
// with nothing on screen to say so. The clock is already injectable here, so no simulation
// is needed — 19:00 UTC on the 31st is 02:00 Bangkok on the 1st.
describe('report period defaults', () => {
  const earlyMorningBangkok = new Date('2026-08-31T19:00:00.000Z'); // 02:00, 1 Sep in Bangkok

  it('defaults the period to the company month, not the UTC one', () => {
    // The old code answered '2026-08' here — a whole month out.
    assert.equal(defaultPeriodKey(earlyMorningBangkok), '2026-09');
  });

  it('defaults the date range to the company day', () => {
    // The old code answered { fromDate: '2026-08-01', toDate: '2026-08-31' }.
    assert.deepEqual(defaultDateRange(earlyMorningBangkok), { fromDate: '2026-09-01', toDate: '2026-09-01' });
  });
});
