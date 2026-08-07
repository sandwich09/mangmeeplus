import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunPeriodCloseChecksUseCase } from './period.use-case.js';

const period = {
  id: 'period-1',
  companyId: 'company-1',
  periodKey: '2026-07',
  startDate: new Date('2026-07-01T00:00:00.000Z'),
  endDate: new Date('2026-07-31T23:59:59.999Z'),
  status: 'OPEN',
};

const ctx = {
  companyId: 'company-1',
  userId: 'user-1',
  requestId: 'request-1',
  permissions: ['ledger.period.close'],
} as any;

function harness(input: {
  previewRows?: any[];
  chartAccounts?: any[];
  chartCompany?: Record<string, unknown>;
  balances?: Array<{ accountId: string; totalDebit: string; totalCredit: string }>;
  readiness?: Record<string, unknown>;
  supplementalPostingErrors?: [number, number, number, number];
} = {}) {
  const noBlockers = { pending: 0, errors: 0 };
  const supplemental = input.supplementalPostingErrors ?? [0, 0, 0, 0];
  const prisma = {
    client: {
      company: { findUnique: async () => input.chartCompany ?? {
        chartOfAccountsTemplateKey: 'TH_SME_COA_V1',
        chartOfAccountsTemplateVersion: 1,
        chartOfAccountsTemplateChecksum: 'checksum',
        chartOfAccountsTemplateAppliedAt: new Date(),
      } },
      chartOfAccount: { findMany: async () => input.chartAccounts ?? [] },
      accountingPeriod: { findMany: async () => [{ id: period.id }] },
      purchaseOrder: { count: async () => supplemental[0] },
      goodsReceipt: { count: async () => supplemental[1] },
      bankAdjustment: { count: async () => supplemental[2] },
      reimbursementRequest: { count: async () => supplemental[3] },
      taxEvent: { findMany: async () => [] },
      taxReconciliationRun: { findMany: async () => [] },
      taxReviewIssue: { count: async () => 0 },
      vendorBillLine: { findMany: async () => [] },
    },
  } as any;
  const chartReadiness = {
    inspect: async () => ({
      preview: { rows: input.previewRows ?? [] },
      readiness: {
        taxConfigurationRequired: false,
        requiredTaxAccountRolesMissing: [],
        taxProfilesNeedingReview: 0,
        ...input.readiness,
      },
    }),
  } as any;
  return new RunPeriodCloseChecksUseCase(
    {
      findPeriodById: async () => period,
      countDraftJournals: async () => 0,
      getAccountBalances: async () => input.balances ?? [],
      createCloseRun: async () => 'run-1',
      updateCloseRun: async () => undefined,
    } as any,
    {
      countPostingBlockers: async () => noBlockers,
      countPaymentPostingBlockers: async () => noBlockers,
    } as any,
    { countPostingBlockers: async () => noBlockers } as any,
    {
      countVendorBillPostingBlockers: async () => noBlockers,
      countSupplierPaymentPostingBlockers: async () => noBlockers,
    } as any,
    {
      countReimbursementPostingBlockers: async () => ({
        unconfirmedClaimExpenses: 0,
        pendingPayments: 0,
        paymentErrors: 0,
      }),
    } as any,
    prisma,
    chartReadiness,
  );
}

function check(summary: any, key: string) {
  return summary.checks.find((candidate: any) => candidate.checkKey === key);
}

describe('chart and mapping period-close gates', () => {
  it('does not block an ordinary company customization that only diverges from the template', async () => {
    const summary = await harness({
      previewRows: [{
        existingAccountId: 'account-1',
        classification: 'UNUSED_CONFLICT',
        differingFields: ['nameTh', 'reportGroup'],
      }],
      chartAccounts: [{ id: 'account-1', isSystem: false, accountClass: 'ASSET' }],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'chart_conflict_remediation_clear').status, 'PASSED');
    assert.equal(check(summary, 'chart_semantics_valid').status, 'PASSED');
    assert.equal(summary.status, 'PASSED');
  });

  it('blocks an unused legacy system-account conflict until remediation replaces it', async () => {
    const summary = await harness({
      previewRows: [{
        existingAccountId: 'legacy-account',
        classification: 'UNUSED_CONFLICT',
        differingFields: ['nameTh'],
      }],
      chartAccounts: [{ id: 'legacy-account', isSystem: true, accountClass: 'ASSET' }],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'chart_conflict_remediation_clear').status, 'FAILED');
    assert.equal(check(summary, 'chart_conflict_remediation_clear').count, 1);
    assert.equal(check(summary, 'chart_semantics_valid').status, 'PASSED');
  });

  it('does not impose template remediation on an unmigrated legacy company', async () => {
    const summary = await harness({
      chartCompany: {},
      previewRows: [{
        existingAccountId: 'legacy-account',
        classification: 'UNUSED_CONFLICT',
        differingFields: ['accountClass'],
      }],
      chartAccounts: [{ id: 'legacy-account', isSystem: true, accountClass: 'ASSET' }],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'chart_conflict_remediation_clear').status, 'PASSED');
    assert.equal(check(summary, 'chart_semantics_valid').status, 'PASSED');
  });

  it('blocks invalid class or normal-balance semantics but not name-only divergence', async () => {
    const summary = await harness({
      previewRows: [
        { existingAccountId: 'account-1', classification: 'IN_USE_CONFLICT', differingFields: ['normalBalance'] },
        { existingAccountId: 'account-2', classification: 'UNUSED_CONFLICT', differingFields: ['nameTh'] },
      ],
      chartAccounts: [
        { id: 'account-1', isSystem: false, accountClass: 'ASSET' },
        { id: 'account-2', isSystem: false, accountClass: 'ASSET' },
      ],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'chart_semantics_valid').status, 'FAILED');
    assert.equal(check(summary, 'chart_semantics_valid').count, 1);
  });

  it('blocks a non-zero suspense balance and reports its absolute amount', async () => {
    const summary = await harness({
      chartAccounts: [{ id: 'suspense-1', isSystem: false, accountClass: 'SUSPENSE' }],
      balances: [{ accountId: 'suspense-1', totalDebit: '25.00', totalCredit: '5.00' }],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'suspense_balance_zero').status, 'FAILED');
    assert.equal(check(summary, 'suspense_balance_zero').amount, '20.00');
  });

  it('blocks required tax mapping gaps and supplemental source posting errors', async () => {
    const summary = await harness({
      readiness: {
        taxConfigurationRequired: true,
        requiredTaxAccountRolesMissing: ['INPUT_VAT_CLAIMABLE', 'OUTPUT_VAT_PAYABLE'],
        taxProfilesNeedingReview: 1,
      },
      supplementalPostingErrors: [0, 0, 2, 0],
    }).execute(ctx, period.id);
    assert.equal(check(summary, 'tax_account_mapping_valid').status, 'FAILED');
    assert.equal(check(summary, 'tax_account_mapping_valid').count, 3);
    assert.equal(check(summary, 'no_source_posting_errors').status, 'FAILED');
    assert.equal(check(summary, 'no_source_posting_errors').count, 2);
  });
});
