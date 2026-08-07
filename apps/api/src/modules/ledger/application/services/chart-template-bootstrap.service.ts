import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client.js';
import {
  TH_SME_COA_V1,
  type ChartTemplateAccount,
} from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import { normalizeChartText, validateChartTemplate } from '../../domain/logic/chart-template.logic.js';

export type ChartTemplateBootstrapSummary = {
  templateKey: string;
  templateVersion: number;
  templateChecksum: string;
  mappingManifestChecksum: string;
  accountCount: number;
  readyForManualLedger: boolean;
  readyForAutomaticPosting: boolean;
};

function bootstrapError(code: string, message: string, details?: Record<string, unknown>) {
  return new UnprocessableEntityException({ code, message, ...(details && { details }) });
}

function persistedAccountMatchesTemplate(row: any, template: ChartTemplateAccount): boolean {
  return row.companyId !== null
    && row.isSystem === false
    && normalizeChartText(row.nameTh) === template.nameTh
    && (row.nameEn ?? null) === template.nameEn
    && row.accountClass === template.accountClass
    && normalizeChartText(row.reportGroup) === template.reportGroup
    && row.normalBalance === template.normalBalance
    && row.parentAccountId === null
    && row.isPosting === template.isPosting
    && row.isControlled === template.isControlled
    && (row.taxCategory ?? null) === template.taxCategory
    && (row.cashFlowCategory ?? null) === template.cashFlowCategory
    && normalizeChartText(row.sourceGroup1) === template.sourceGroup1
    && normalizeChartText(row.sourceGroup2) === template.sourceGroup2
    && row.status === 'ACTIVE';
}

export function chartTemplateAccountWriteData(
  account: ChartTemplateAccount,
  actorUserId: string,
): Record<string, unknown> {
  return {
    code: account.code,
    nameTh: account.nameTh,
    nameEn: account.nameEn,
    accountClass: account.accountClass,
    reportGroup: account.reportGroup,
    normalBalance: account.normalBalance,
    parentAccountId: null,
    isPosting: account.isPosting,
    isSystem: false,
    isControlled: account.isControlled,
    taxCategory: account.taxCategory,
    cashFlowCategory: account.cashFlowCategory,
    sourceGroup1: account.sourceGroup1,
    sourceGroup2: account.sourceGroup2,
    status: 'ACTIVE',
    updatedByUserId: actorUserId,
  };
}

async function persistCompanyChartOfAccounts(
  tx: Prisma.TransactionClient,
  input: { companyId: string; createdByUserId: string; appliedAt?: Date },
): Promise<ChartTemplateBootstrapSummary> {
  const codes = TH_SME_COA_V1.accounts.map((account) => account.code);
  const [existingCompanyCount, shadowRows] = await Promise.all([
    tx.chartOfAccount.count({ where: { companyId: input.companyId } }),
    tx.chartOfAccount.findMany({
      where: { companyId: null, isSystem: true, code: { in: codes } },
      select: { code: true },
      take: 20,
    }),
  ]);
  if (existingCompanyCount !== 0 || shadowRows.length > 0) {
    throw bootstrapError('coa_semantic_conflict', 'Company chart is not empty or a global account shadows the template.', {
      existingCompanyAccountCount: existingCompanyCount,
      globalShadowCodes: shadowRows.map((row) => row.code),
    });
  }

  const created = await tx.chartOfAccount.createMany({
    data: TH_SME_COA_V1.accounts.map((account) => ({
      ...chartTemplateAccountWriteData(account, input.createdByUserId),
      companyId: input.companyId,
      createdByUserId: input.createdByUserId,
    })) as any,
  });
  if (created.count !== TH_SME_COA_V1.accounts.length) {
    throw bootstrapError('coa_postcondition_failed', 'Chart template row count did not match the catalog.', {
      expected: TH_SME_COA_V1.accounts.length,
      created: created.count,
    });
  }

  const [rows, shadowRowsAfterInsert] = await Promise.all([
    tx.chartOfAccount.findMany({
      where: { companyId: input.companyId, code: { in: codes } },
    }),
    tx.chartOfAccount.findMany({
      where: { companyId: null, isSystem: true, code: { in: codes } },
      select: { code: true },
      take: 20,
    }),
  ]);
  const rowsByCode = new Map(rows.map((row) => [row.code, row]));
  const mismatchedCodes = TH_SME_COA_V1.accounts
    .filter((account) => {
      const row = rowsByCode.get(account.code);
      return !row || !persistedAccountMatchesTemplate(row, account);
    })
    .map((account) => account.code);
  const totalCompanyAccounts = await tx.chartOfAccount.count({ where: { companyId: input.companyId } });
  if (
    totalCompanyAccounts !== TH_SME_COA_V1.accounts.length
    || rows.length !== TH_SME_COA_V1.accounts.length
    || mismatchedCodes.length > 0
    || shadowRowsAfterInsert.length > 0
  ) {
    throw bootstrapError('coa_postcondition_failed', 'Persisted chart failed its semantic post-condition.', {
      expected: TH_SME_COA_V1.accounts.length,
      actual: totalCompanyAccounts,
      mismatchedCodes: mismatchedCodes.slice(0, 20),
      globalShadowCodes: shadowRowsAfterInsert.map((row) => row.code),
    });
  }

  await tx.company.update({
    where: { id: input.companyId },
    data: {
      chartOfAccountsTemplateKey: TH_SME_COA_V1.key,
      chartOfAccountsTemplateVersion: TH_SME_COA_V1.version,
      chartOfAccountsTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
      chartOfAccountsTemplateAppliedAt: input.appliedAt ?? new Date(),
    },
  });

  return {
    templateKey: TH_SME_COA_V1.key,
    templateVersion: TH_SME_COA_V1.version,
    templateChecksum: TH_SME_COA_V1.accountsChecksum,
    mappingManifestChecksum: TH_SME_COA_V1.mappingManifestChecksum,
    accountCount: TH_SME_COA_V1.accounts.length,
    readyForManualLedger: true,
    // Productive posting and tax mappings remain explicitly review-required.
    readyForAutomaticPosting: false,
  };
}

export async function bootstrapCompanyChartOfAccounts(
  tx: Prisma.TransactionClient,
  input: { companyId: string; createdByUserId: string; appliedAt?: Date },
): Promise<ChartTemplateBootstrapSummary> {
  const validationErrors = validateChartTemplate();
  if (validationErrors.length > 0) {
    throw bootstrapError('coa_template_invalid', 'Chart template validation failed.', {
      errors: validationErrors.slice(0, 20),
    });
  }

  try {
    return await persistCompanyChartOfAccounts(tx, input);
  } catch (error) {
    if (error instanceof UnprocessableEntityException) throw error;
    throw bootstrapError('coa_postcondition_failed', 'Chart bootstrap could not be completed.');
  }
}
