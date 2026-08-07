import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  TH_SME_COA_V1,
  TH_SME_COA_V1_ACCOUNTS,
} from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import { ChartTemplateService } from './chart-template.service.js';

type State = {
  accounts: any[];
  company: any;
  journalDependencies: Record<string, number>;
  postingRules: any[];
};

const ctx = (permissions = ['ledger.account.read', 'ledger.account.manage']): RequestContext => ({
  requestId: 'req-1',
  authSubject: 'subject-1',
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  roles: ['OWNER'],
  permissions,
  scopes: {},
  authProvider: 'dev',
});

function persistedAccount(code: string, overrides: Record<string, unknown> = {}) {
  const template = TH_SME_COA_V1_ACCOUNTS.find((account) => account.code === code)!;
  return {
    id: `account-${code}`,
    companyId: 'company-1',
    ...template,
    parentAccountId: null,
    isSystem: false,
    status: 'ACTIVE',
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    ...overrides,
  };
}

function cloneState(state: State): State {
  return {
    accounts: state.accounts.map((account) => ({ ...account })),
    company: { ...state.company },
    journalDependencies: { ...state.journalDependencies },
    postingRules: state.postingRules.map((rule) => ({ ...rule, mappingJson: { ...rule.mappingJson } })),
  };
}

function database(stateRef: { current: State }) {
  const dbFor = (getState: () => State) => {
    const zeroCount = { count: async () => 0 };
    return {
      chartOfAccount: {
        findMany: async ({ where, select }: any) => {
          const state = getState();
          let rows = state.accounts;
          if (where?.code?.in) rows = rows.filter((row) => where.code.in.includes(row.code));
          else if (where?.companyId && where?.id?.in) {
            rows = rows.filter((row) => row.companyId === where.companyId && where.id.in.includes(row.id));
          } else if (where?.OR) {
            // Hierarchy query; this fixture has no parent/child rows.
            rows = [];
          }
          if (!select) return rows.map((row) => ({ ...row }));
          return rows.map((row) => Object.fromEntries(
            Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]),
          ));
        },
        count: async ({ where }: any) =>
          getState().accounts.filter((row) => row.companyId === where.companyId).length,
        createMany: async ({ data }: any) => {
          const state = getState();
          state.accounts.push(...data.map((row: any, index: number) => ({
            id: `created-${state.accounts.length + index}`,
            ...row,
          })));
          return { count: data.length };
        },
        update: async ({ where, data }: any) => {
          const state = getState();
          const key = where.companyId_id;
          const row = state.accounts.find((account) => account.companyId === key.companyId && account.id === key.id);
          if (!row) throw new Error('account not found');
          Object.assign(row, data);
          return row;
        },
      },
      journalLine: {
        groupBy: async () => Object.entries(getState().journalDependencies).map(([accountId, count]) => ({
          accountId,
          _count: { _all: count },
        })),
      },
      postingRule: { findMany: async () => getState().postingRules },
      taxAccountDeterminationRule: { groupBy: async () => [], findMany: async () => [] },
      taxReconciliationLine: { groupBy: async () => [] },
      bankAccount: { groupBy: async () => [], findMany: async () => [] },
      bankAdjustment: { groupBy: async () => [], count: async () => 0 },
      company: {
        findUnique: async () => ({ ...getState().company }),
        update: async ({ data }: any) => {
          Object.assign(getState().company, data);
          return { ...getState().company };
        },
      },
      companyFeatureEntitlement: { findMany: async () => [] },
      companyTaxCodeProfile: { findMany: async () => [] },
      accountingDocument: { findMany: async () => [], count: async () => 0 },
      accountingPayment: zeroCount,
      expenseRecord: zeroCount,
      purchaseOrder: zeroCount,
      goodsReceipt: zeroCount,
      vendorBill: zeroCount,
      supplierPayment: zeroCount,
      reimbursementRequest: zeroCount,
      reimbursementPayment: zeroCount,
      $queryRaw: async () => [],
    } as any;
  };

  const root = dbFor(() => stateRef.current);
  let transactionAttempts = 0;
  let serializeFirst = false;
  let mutateAfterSerialization: (() => void) | undefined;
  root.$transaction = async (fn: (tx: any) => Promise<any>, options: any) => {
    transactionAttempts += 1;
    root.lastTransactionOptions = options;
    const working = cloneState(stateRef.current);
    const tx = dbFor(() => working);
    const result = await fn(tx);
    if (serializeFirst && transactionAttempts === 1) {
      mutateAfterSerialization?.();
      const error = new Error('serialization failure 40001') as Error & { code: string };
      error.code = 'P2034';
      throw error;
    }
    stateRef.current = working;
    return result;
  };
  root.enableSerializationRetry = (mutation: () => void) => {
    serializeFirst = true;
    mutateAfterSerialization = mutation;
  };
  root.transactionAttempts = () => transactionAttempts;
  return root;
}

function harness(
  accounts: any[] = [],
  journalDependencies: Record<string, number> = {},
  postingRules: any[] = [],
) {
  const stateRef = {
    current: {
      accounts,
      company: {
        id: 'company-1',
        vatRegistered: false,
        chartOfAccountsTemplateKey: null,
        chartOfAccountsTemplateVersion: null,
        chartOfAccountsTemplateChecksum: null,
        chartOfAccountsTemplateAppliedAt: null,
      },
      journalDependencies,
      postingRules,
    },
  };
  const client = database(stateRef);
  const audits: Array<{ entry: any; tx: any }> = [];
  const service = new ChartTemplateService(
    { client } as any,
    { log: async (entry: any, tx?: any) => { audits.push({ entry, tx }); } } as any,
  );
  return { service, stateRef, client, audits };
}

describe('ChartTemplateService', () => {
  it('previews without writes and enforces read permission', async () => {
    const h = harness();
    const preview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    assert.equal(preview.missing, 175);
    assert.equal(h.stateRef.current.accounts.length, 0);
    await assert.rejects(
      () => h.service.preview(ctx([]), TH_SME_COA_V1.key),
      /Missing permission/,
    );
    await assert.rejects(
      () => h.service.apply(ctx(['ledger.account.read']), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
      }),
      /Missing permission/,
    );
  });

  it('applies all missing accounts atomically and exact reapply is idempotent', async () => {
    const h = harness();
    const preview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    const first = await h.service.apply(ctx(), TH_SME_COA_V1.key, {
      expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      expectedPreviewChecksum: preview.previewChecksum,
    });
    assert.equal(first.created, 175);
    assert.equal(first.updated, 0);
    assert.equal(first.readiness.readyForManualLedger, true);
    assert.equal(first.readiness.readyForAutomaticPosting, false);
    assert.equal(h.stateRef.current.accounts.length, 175);
    assert.equal(h.stateRef.current.company.chartOfAccountsTemplateKey, TH_SME_COA_V1.key);
    assert.deepEqual(h.client.lastTransactionOptions, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
    assert.ok(h.audits.some((audit) => audit.entry.action === 'ledger.chart_template.apply' && audit.tx));

    const exactPreview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    const second = await h.service.apply(ctx(), TH_SME_COA_V1.key, {
      expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      expectedPreviewChecksum: exactPreview.previewChecksum,
    });
    assert.deepEqual({ created: second.created, updated: second.updated, skipped: second.skipped }, {
      created: 0,
      updated: 0,
      skipped: 175,
    });
  });

  it('requires usable company rules for both expense auto-post journeys', async () => {
    const rules = [
      {
        companyId: 'company-1',
        documentType: 'expense.record',
        ruleKey: 'expense.confirmed',
        version: 1,
        mappingJson: { debitAccountCode: '5310-02', creditAccountCode: '2120-01' },
      },
      {
        companyId: 'company-1',
        documentType: 'expense.record',
        ruleKey: 'expense.claim.confirmed',
        version: 1,
        mappingJson: { debitAccountCode: '5310-02', creditAccountCode: '2120-01' },
      },
    ];
    const h = harness([], {}, rules);
    const preview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    const result = await h.service.apply(ctx(), TH_SME_COA_V1.key, {
      expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      expectedPreviewChecksum: preview.previewChecksum,
    });
    assert.deepEqual(result.readiness.requiredPostingRolesMissing, []);
    assert.equal(result.readiness.readyForAutomaticPosting, true);

    h.stateRef.current.postingRules[1].ruleKey = 'unrelated.event';
    const readiness = await h.service.readiness(ctx());
    assert.deepEqual(readiness.requiredPostingRolesMissing, ['EXPENSE_CLAIM_CONFIRMED']);
    assert.equal(readiness.readyForAutomaticPosting, false);
  });

  it('rejects a stale preview and writes nothing', async () => {
    const h = harness();
    await assert.rejects(
      () => h.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: '0'.repeat(64),
      }),
      (error: any) => error.getResponse?.().code === 'coa_preview_changed',
    );
    assert.equal(h.stateRef.current.accounts.length, 0);
    assert.equal(h.stateRef.current.company.chartOfAccountsTemplateKey, null);
    assert.ok(h.audits.some((audit) =>
      audit.entry.action === 'ledger.chart_template.apply_failed'
      && audit.entry.metadataJson.error === 'coa_preview_changed'));
  });

  it('audits a stale template checksum and bounds conflict details', async () => {
    const stale = harness();
    const stalePreview = await stale.service.preview(ctx(), TH_SME_COA_V1.key);
    await assert.rejects(
      () => stale.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: '0'.repeat(64),
        expectedPreviewChecksum: stalePreview.previewChecksum,
      }),
      (error: any) => error.getResponse?.().code === 'coa_template_checksum_mismatch',
    );
    assert.ok(stale.audits.some((audit) =>
      audit.entry.action === 'ledger.chart_template.apply_failed'
      && audit.entry.metadataJson.error === 'coa_template_checksum_mismatch'));

    const conflicts = harness(
      TH_SME_COA_V1_ACCOUNTS.slice(0, 25).map((account) =>
        persistedAccount(account.code, { nameTh: `legacy-${account.code}` })),
    );
    const preview = await conflicts.service.preview(ctx(), TH_SME_COA_V1.key);
    await assert.rejects(
      () => conflicts.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
      }),
      (error: any) =>
        error.getResponse?.().code === 'coa_semantic_conflict'
        && error.getResponse?.().conflicts.length === 20,
    );
  });

  it('creates only missing rows when an unused conflict is explicitly acknowledged', async () => {
    const h = harness([
      persistedAccount('1210-00', { nameTh: 'Accounts receivable' }),
    ]);
    const preview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    assert.equal(preview.unusedConflicts, 1);
    await assert.rejects(
      () => h.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
      }),
      (error: any) => error.getResponse?.().code === 'coa_semantic_conflict',
    );
    assert.equal(h.stateRef.current.accounts.length, 1);

    const result = await h.service.apply(ctx(), TH_SME_COA_V1.key, {
      expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      expectedPreviewChecksum: preview.previewChecksum,
      acknowledgeConflicts: true,
    });
    assert.equal(result.created, 174);
    assert.equal(result.updated, 0);
    assert.equal(result.acknowledgedConflicts, 1);
    assert.equal(h.stateRef.current.accounts.find((row) => row.code === '1210-00')?.nameTh, 'Accounts receivable');
  });

  it('replaces only unused conflicts and blocks an account with dependencies', async () => {
    const unused = harness([persistedAccount('5310-01', { nameTh: 'General expenses', isSystem: true })]);
    const preview = await unused.service.preview(ctx(), TH_SME_COA_V1.key);
    const replaced = await unused.service.apply(ctx(), TH_SME_COA_V1.key, {
      expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      expectedPreviewChecksum: preview.previewChecksum,
      mode: 'REPLACE_UNUSED',
    });
    assert.equal(replaced.created, 174);
    assert.equal(replaced.updated, 1);
    const salary = unused.stateRef.current.accounts.find((row) => row.code === '5310-01');
    assert.equal(salary?.nameTh, 'เงินเดือน');
    assert.equal(salary?.isSystem, false);
    assert.ok(unused.audits.some((audit) => audit.entry.action === 'ledger.chart_template.unused_conflict_replace'));

    const inUseAccount = persistedAccount('5310-01', { nameTh: 'General expenses' });
    const inUse = harness([inUseAccount], { [inUseAccount.id]: 1 });
    const inUsePreview = await inUse.service.preview(ctx(), TH_SME_COA_V1.key);
    await assert.rejects(
      () => inUse.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: inUsePreview.previewChecksum,
        mode: 'REPLACE_UNUSED',
      }),
      (error: any) => error.getResponse?.().code === 'coa_account_in_use_conflict',
    );
    assert.equal(inUse.stateRef.current.accounts.length, 1);
  });

  it('retries one serialization failure and rejects when the rechecked preview diverges', async () => {
    const h = harness();
    const preview = await h.service.preview(ctx(), TH_SME_COA_V1.key);
    h.client.enableSerializationRetry(() => {
      h.stateRef.current.accounts.push(persistedAccount('1210-00', { nameTh: 'Accounts receivable' }));
    });
    await assert.rejects(
      () => h.service.apply(ctx(), TH_SME_COA_V1.key, {
        expectedTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
      }),
      (error: any) => error.getResponse?.().code === 'coa_preview_changed',
    );
    assert.equal(h.client.transactionAttempts(), 2);
    assert.equal(h.stateRef.current.accounts.length, 1);
  });
});
