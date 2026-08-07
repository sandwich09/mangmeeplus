import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REVIEWED_CONTRA_ACCOUNTS,
  TH_SME_COA_V1,
  TH_SME_COA_V1_ACCOUNTS,
  computeChartAccountsChecksum,
} from '../catalog/th-sme-chart-of-accounts-v1.js';
import {
  computeChartReadiness,
  deriveAccountClass,
  isSemanticallyEqual,
  normalizeChartText,
  previewChartTemplate,
  validateChartTemplate,
  type ExistingChartAccount,
} from './chart-template.logic.js';
import { selectPostingRuleCandidate } from './posting-engine.logic.js';

function existing(code: string, overrides: Partial<ExistingChartAccount> = {}): ExistingChartAccount {
  const template = TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === code)!;
  return {
    id: `account-${code}`,
    companyId: 'company-1',
    code: template.code,
    nameTh: template.nameTh,
    accountClass: template.accountClass,
    normalBalance: template.normalBalance,
    reportGroup: template.reportGroup,
    isPosting: template.isPosting,
    isControlled: template.isControlled,
    ...overrides,
  };
}

describe('TH_SME_COA_V1 catalog', () => {
  it('locks 175 normalized accounts and the reviewed checksum', () => {
    assert.equal(TH_SME_COA_V1_ACCOUNTS.length, 175);
    assert.equal(computeChartAccountsChecksum(TH_SME_COA_V1_ACCOUNTS), TH_SME_COA_V1.accountsChecksum);
    assert.deepEqual(validateChartTemplate(), []);
  });

  it('stores all nine reviewed contra normal balances', () => {
    assert.equal(REVIEWED_CONTRA_ACCOUNTS.size, 9);
    for (const [code, normalBalance] of REVIEWED_CONTRA_ACCOUNTS) {
      assert.equal(TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === code)?.normalBalance, normalBalance);
    }
  });

  it('normalizes source defects without guessing bank identity', () => {
    assert.equal(normalizeChartText(' Service\u00a0 expesnes '), 'Service expenses');
    assert.equal(TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === '1113-02')?.nameTh, 'เงินฝากออมทรัพย์ 2');
    assert.equal(TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === '1210-00')?.nameTh, 'ลูกหนี้เงินให้กู้ยืม');
    assert.equal(TH_SME_COA_V1_ACCOUNTS.some((account) => /999-9-99999|นาย…|\u00a0/.test(account.nameTh)), false);
  });

  it('derives classes from code and normalized group', () => {
    assert.equal(deriveAccountClass('4100-01', 'Income'), 'REVENUE');
    assert.equal(deriveAccountClass('5130-01', 'Cost'), 'COST');
    assert.equal(deriveAccountClass('5310-01', 'Service expesnes'), 'EXPENSE');
    assert.equal(deriveAccountClass('6000-00', 'Service expenses'), 'TAX_EXPENSE');
    assert.equal(deriveAccountClass('9999-99', 'Service expenses'), 'SUSPENSE');
  });
});

describe('chart template semantic preview', () => {
  it('normalizes both sides so the known report-group typo is exact', () => {
    assert.equal(isSemanticallyEqual(
      existing('5310-02', { reportGroup: 'Service expesnes' }),
      TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === '5310-02')!,
    ), true);
  });

  it('does not treat code equality as semantic equality', () => {
    const preview = previewChartTemplate({
      existingAccounts: [
        existing('1210-00', { nameTh: 'Accounts receivable', reportGroup: 'accounts_receivable' }),
        existing('5310-01', { nameTh: 'General expenses', reportGroup: 'operating_expenses' }),
      ],
    });
    assert.equal(preview.rows.find((row) => row.code === '1210-00')?.classification, 'UNUSED_CONFLICT');
    assert.equal(preview.rows.find((row) => row.code === '5310-01')?.classification, 'UNUSED_CONFLICT');
  });

  it('promotes a semantic conflict to in-use and returns bounded dependency counts', () => {
    const preview = previewChartTemplate({
      existingAccounts: [existing('1210-00', { nameTh: 'Accounts receivable' })],
      dependenciesByCode: { '1210-00': { JournalLine: 2, PostingRuleCode: 1 } },
    });
    const row = preview.rows.find((candidate) => candidate.code === '1210-00')!;
    assert.equal(row.classification, 'IN_USE_CONFLICT');
    assert.equal(row.dependencyCount, 3);
    assert.deepEqual(row.dependencies, { JournalLine: 2, PostingRuleCode: 1 });
  });

  it('blocks a global account shadow even when the company row is absent', () => {
    const preview = previewChartTemplate({
      existingAccounts: [existing('1130-01', { companyId: null })],
    });
    const row = preview.rows.find((candidate) => candidate.code === '1130-01')!;
    assert.equal(row.classification, 'IN_USE_CONFLICT');
    assert.deepEqual(row.dependencies, { GLOBAL_ACCOUNT: 1 });
  });

  it('produces a deterministic preview checksum', () => {
    const accounts = [existing('1130-01'), existing('2120-01')];
    const first = previewChartTemplate({ existingAccounts: accounts });
    const second = previewChartTemplate({ existingAccounts: [...accounts].reverse() });
    assert.equal(first.previewChecksum, second.previewChecksum);
  });
});

describe('chart readiness', () => {
  const readyFacts = {
    chartTemplateApplied: true,
    chartTemplateKey: 'TH_SME_COA_V1',
    chartTemplateVersion: 1,
    chartTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
    chartTemplateAppliedAt: '2026-07-29T00:00:00.000Z',
    chartAccountCount: 175,
    chartCoverageComplete: true,
    globalShadowConflict: false,
    chartConflicts: 2,
    requiredPostingRolesMissing: [] as string[],
    requiredTaxAccountRolesMissing: [] as string[],
    taxProfilesNeedingReview: 0,
    taxConfigurationRequired: false,
    bankLedgerLinksInvalid: 0,
    legacyTaxHeaderMismatches: 0,
    sourcePostingErrors: 0,
  };

  it('treats template divergence as information, not a manual-ledger blocker', () => {
    const readiness = computeChartReadiness(readyFacts);
    assert.equal(readiness.chartConflicts, 2);
    assert.equal(readiness.readyForManualLedger, true);
    assert.equal(readiness.readyForAutomaticPosting, true);
  });

  it('fails automatic posting on every visible mapping or operational gap', () => {
    for (const facts of [
      { requiredPostingRolesMissing: ['ACCOUNTS_RECEIVABLE'] },
      { requiredTaxAccountRolesMissing: ['OUTPUT_VAT_PAYABLE'], taxConfigurationRequired: true },
      { taxProfilesNeedingReview: 1, taxConfigurationRequired: true },
      { bankLedgerLinksInvalid: 1 },
      { legacyTaxHeaderMismatches: 1, taxConfigurationRequired: true },
      { sourcePostingErrors: 1 },
    ]) {
      assert.equal(computeChartReadiness({ ...readyFacts, ...facts }).readyForAutomaticPosting, false);
    }
  });
});

describe('posting-rule selection', () => {
  it('prefers the newest company rule and can fail closed without a company rule', () => {
    const candidates = [
      { id: 'global-v9', companyId: null, version: 9 },
      { id: 'company-v1', companyId: 'company-1', version: 1 },
      { id: 'company-v2', companyId: 'company-1', version: 2 },
    ];
    assert.equal(selectPostingRuleCandidate(candidates, 'company-1')?.id, 'company-v2');
    assert.equal(selectPostingRuleCandidate(candidates, 'company-2')?.id, 'global-v9');
    assert.equal(selectPostingRuleCandidate(candidates, 'company-2', true), null);
  });
});
