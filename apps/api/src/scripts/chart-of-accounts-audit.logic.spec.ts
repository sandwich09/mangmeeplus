import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChartOfAccountsReadiness } from '@watchdog-bms/contracts';
import type { ChartTemplatePreview } from '../modules/ledger/domain/logic/chart-template.logic.js';
import {
  buildChartAuditReport,
  chartAuditReportToCsv,
  safeChartAuditErrorCode,
  summarizeChartAuditCompany,
} from './chart-of-accounts-audit.logic.js';

const readiness: ChartOfAccountsReadiness = {
  chartTemplateApplied: true,
  chartTemplateKey: 'TH_SME_COA_V1',
  chartTemplateVersion: 1,
  chartTemplateChecksum: 'accounts-checksum',
  chartTemplateAppliedAt: '2026-07-29T00:00:00.000Z',
  chartAccountCount: 175,
  chartConflicts: 2,
  requiredPostingRolesMissing: ['EXPENSE_CONFIRMED'],
  requiredTaxAccountRolesMissing: ['INPUT_VAT'],
  taxProfilesNeedingReview: 1,
  bankLedgerLinksInvalid: 1,
  legacyTaxHeaderMismatches: 2,
  sourcePostingErrors: 3,
  taxConfigurationRequired: true,
  readyForManualLedger: true,
  readyForAutomaticPosting: false,
};

const preview: ChartTemplatePreview = {
  templateKey: 'TH_SME_COA_V1',
  templateVersion: 1,
  templateChecksum: 'accounts-checksum',
  previewChecksum: 'preview-checksum',
  exact: 172,
  missing: 1,
  unusedConflicts: 1,
  inUseConflicts: 1,
  rows: [
    {
      code: '1210-00',
      existingAccountId: 'account-1',
      classification: 'UNUSED_CONFLICT',
      dependencyCount: 0,
      dependencies: {},
      differingFields: ['nameTh'],
    },
    {
      code: '5310-01',
      existingAccountId: 'account-2',
      classification: 'IN_USE_CONFLICT',
      dependencyCount: 3,
      dependencies: { PostingRuleCode: 1, JournalLine: 2 },
      differingFields: ['reportGroup', 'nameTh'],
    },
    {
      code: '1110-01',
      existingAccountId: 'account-3',
      classification: 'EXACT',
      dependencyCount: 1,
      dependencies: { BankAccount: 1 },
      differingFields: [],
    },
  ],
};

describe('chart-of-accounts audit evidence', () => {
  it('reports every readiness surface and bounds conflict details', () => {
    const company = summarizeChartAuditCompany({
      companyId: 'company-1',
      preview,
      readiness,
      conflictSampleLimit: 1,
    });

    assert.deepEqual(company.coverage, {
      chartAccountCount: 175,
      exact: 172,
      missing: 1,
      unusedConflicts: 1,
      inUseConflicts: 1,
    });
    assert.deepEqual(company.dependencies, {
      total: 4,
      bySource: { BankAccount: 1, JournalLine: 2, PostingRuleCode: 1 },
    });
    assert.deepEqual(company.conflictSamples.map((row) => row.code), ['1210-00']);
    assert.equal(company.conflictSamplesTruncated, true);
    assert.equal(company.readiness.bankLedgerLinksInvalid, 1);
    assert.equal(company.readiness.legacyTaxHeaderMismatches, 2);
  });

  it('writes one bounded CSV row per company and preserves explicit scan failures', () => {
    const company = summarizeChartAuditCompany({ companyId: 'company,"1', preview, readiness });
    const report = buildChartAuditReport({
      generatedAt: '2026-07-29T00:00:00.000Z',
      conflictSampleLimit: 20,
      template: {
        key: 'TH_SME_COA_V1',
        version: 1,
        accountsChecksum: 'accounts-checksum',
        mappingManifestVersion: 1,
        mappingManifestChecksum: 'mapping-checksum',
      },
      companies: [
        company,
        { companyId: 'company-2', status: 'ERROR', errorCode: 'P2021' },
      ],
    });
    const csv = chartAuditReportToCsv(report);

    assert.equal(report.summary.companyCount, 2);
    assert.equal(report.summary.failedCompanyCount, 1);
    assert.equal(report.summary.automaticPostingReadyCount, 0);
    assert.equal(csv.trimEnd().split('\n').length, 3);
    assert.match(csv, /"company,""1"/);
    assert.match(csv, /company-2,ERROR,P2021/);
    assert.doesNotMatch(csv, /companyName|taxId|email|credential/i);
  });

  it('returns a stable safe code without exposing raw error text', () => {
    assert.equal(safeChartAuditErrorCode({ code: 'P2021', message: 'secret database detail' }), 'P2021');
    assert.equal(safeChartAuditErrorCode(new TypeError('secret database detail')), 'coa_audit_typeerror');
    assert.equal(safeChartAuditErrorCode('secret database detail'), 'coa_audit_unknown_error');
  });
});
