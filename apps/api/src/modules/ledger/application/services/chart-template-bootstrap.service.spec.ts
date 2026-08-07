import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { TH_SME_COA_V1 } from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import { bootstrapCompanyChartOfAccounts } from './chart-template-bootstrap.service.js';

function makeTx(options: { globalShadowCode?: string; createdCount?: number } = {}) {
  const rows: any[] = [];
  let companyUpdate: any;
  let createCalls = 0;
  const tx = {
    chartOfAccount: {
      count: async ({ where }: any) => rows.filter((row) => row.companyId === where.companyId).length,
      findMany: async ({ where }: any) => {
        if (where.companyId === null) {
          return options.globalShadowCode ? [{ code: options.globalShadowCode }] : [];
        }
        return rows.filter((row) => row.companyId === where.companyId);
      },
      createMany: async ({ data }: any) => {
        createCalls += 1;
        const count = options.createdCount ?? data.length;
        rows.push(...data.slice(0, count).map((row: any, index: number) => ({ id: `coa-${index}`, ...row })));
        return { count };
      },
    },
    company: {
      update: async (args: any) => {
        companyUpdate = args;
        return { id: args.where.id };
      },
    },
  } as any;
  return { tx, rows, getCompanyUpdate: () => companyUpdate, getCreateCalls: () => createCalls };
}

describe('bootstrapCompanyChartOfAccounts', () => {
  it('persists the fixed company-owned catalog and stamps provenance after post-conditions pass', async () => {
    const state = makeTx();
    const result = await bootstrapCompanyChartOfAccounts(state.tx, {
      companyId: 'co-1',
      createdByUserId: 'owner-1',
      appliedAt: new Date('2026-07-29T00:00:00.000Z'),
    });

    assert.equal(state.rows.length, 175);
    assert.ok(state.rows.every((row) => row.companyId === 'co-1' && row.isSystem === false));
    assert.equal(state.rows.find((row) => row.code === '1130-03')?.normalBalance, 'CREDIT');
    assert.equal(state.rows.find((row) => row.code === '4100-03')?.normalBalance, 'DEBIT');
    assert.equal(result.templateChecksum, TH_SME_COA_V1.accountsChecksum);
    assert.equal(result.readyForManualLedger, true);
    assert.equal(result.readyForAutomaticPosting, false);
    assert.deepEqual(state.getCompanyUpdate().data, {
      chartOfAccountsTemplateKey: 'TH_SME_COA_V1',
      chartOfAccountsTemplateVersion: 1,
      chartOfAccountsTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      chartOfAccountsTemplateAppliedAt: new Date('2026-07-29T00:00:00.000Z'),
    });
  });

  it('fails before writes when a global system account shadows a template code', async () => {
    const state = makeTx({ globalShadowCode: '1111-00' });
    await assert.rejects(
      () => bootstrapCompanyChartOfAccounts(state.tx, { companyId: 'co-1', createdByUserId: 'owner-1' }),
      (error: any) => error.getResponse?.().code === 'coa_semantic_conflict',
    );
    assert.equal(state.getCreateCalls(), 0);
    assert.equal(state.getCompanyUpdate(), undefined);
  });

  it('does not stamp provenance when the inserted row count is incomplete', async () => {
    const state = makeTx({ createdCount: 174 });
    await assert.rejects(
      () => bootstrapCompanyChartOfAccounts(state.tx, { companyId: 'co-1', createdByUserId: 'owner-1' }),
      (error: any) => error.getResponse?.().code === 'coa_postcondition_failed',
    );
    assert.equal(state.getCompanyUpdate(), undefined);
  });

  it('keeps the bank-link migration fail-closed before adding the company-scoped FK', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../../../prisma/migrations/20260801120000_chart_of_accounts_master_bootstrap/migration.sql',
      ),
      'utf8',
    );
    const precheck = sql.indexOf('ledger_account_invalid_for_bank');
    const foreignKey = sql.indexOf('BankAccount_companyId_ledgerAccountId_fkey');
    assert.ok(precheck >= 0 && precheck < foreignKey);
    assert.match(sql, /account\."companyId" = bank\."companyId"/);
    assert.match(sql, /account\."status" <> 'ACTIVE'/);
    assert.doesNotMatch(sql, /UPDATE\s+"BankAccount"/);
  });
});
