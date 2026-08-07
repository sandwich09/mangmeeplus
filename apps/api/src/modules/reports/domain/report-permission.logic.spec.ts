import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportDatasetDefinitionDto } from '@watchdog-bms/contracts';
import { canRunReport, visibleDatasetStatus } from './report-permission.logic';

const base: ReportDatasetDefinitionDto = {
  code: 'financial.trial_balance',
  version: 1,
  title: 'Trial Balance',
  description: 'Trial balance',
  category: 'FINANCIAL',
  sourceModule: 'ledger',
  status: 'ENABLED',
  requiredReportPermissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run'],
  requiredSourcePermissions: ['ledger.report.read'],
  sourcePermissionMode: 'all',
  supportedFilters: [],
  supportedDimensions: [],
  supportedMeasures: [],
  supportedChartKinds: ['table'],
  freshnessSlaSeconds: 300,
};

describe('report permission policy', () => {
  it('requires catalog permission for catalog visibility', () => {
    assert.equal(visibleDatasetStatus({ permissions: ['ledger.report.read'] }, base), 'FORBIDDEN');
  });

  it('requires both report and source permissions to run', () => {
    assert.equal(canRunReport({ permissions: ['report.catalog.read', 'report.query.run', 'ledger.report.read'] }, base), false);
    assert.equal(canRunReport({ permissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run', 'ledger.report.read'] }, base), true);
  });

  it('supports any-mode source permission', () => {
    const anyDef = { ...base, requiredSourcePermissions: ['expense.read', 'expense.read_own'], sourcePermissionMode: 'any' as const };
    assert.equal(canRunReport({ permissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run', 'expense.read_own'] }, anyDef), true);
  });
});
