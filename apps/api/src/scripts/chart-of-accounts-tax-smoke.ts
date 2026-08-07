import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { LedgerSourcePostingInput } from '@watchdog-bms/contracts';
import { PrismaClient } from '../generated/prisma/client';
import { buildTransactionTaxPostingLines } from '../modules/ledger/domain/logic/posting-engine.logic.js';
import {
  primaryTaxReportAmount,
  reconcileTaxFact,
} from '../modules/tax/domain/logic/tax-reconciliation.logic.js';
import { resolveTransactionTaxPreview } from '../modules/tax/domain/logic/transaction-tax.logic.js';
import { PrismaTransactionTaxRepository } from '../modules/tax/infrastructure/repositories/prisma-transaction-tax.repository.js';

type Options = {
  companyId: string;
  profileKey: string;
  expenseAccountCode: string;
  payableAccountCode: string;
  taxCode: string;
  documentDate: string;
};

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (!argument.startsWith('--') || !argv[index + 1]) throw new Error('chart_tax_smoke_invalid_arguments');
    values.set(argument.slice(2), argv[index + 1]!);
    index += 1;
  }
  const options = {
    companyId: values.get('company-id'),
    profileKey: values.get('profile-key'),
    expenseAccountCode: values.get('expense-account-code'),
    payableAccountCode: values.get('payable-account-code'),
    taxCode: values.get('tax-code'),
    documentDate: values.get('document-date'),
  };
  if (Object.values(options).some((value) => !value)) throw new Error('chart_tax_smoke_required_argument_missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.documentDate!)) throw new Error('chart_tax_smoke_invalid_document_date');
  return options as Options;
}

function opaque(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('chart_tax_smoke_database_url_required');
  const options = parseOptions(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const evidence = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const company = await tx.company.findUnique({
        where: { id: options.companyId },
        select: { baseCurrency: true, chartOfAccountsTemplateChecksum: true },
      });
      assert.ok(company?.chartOfAccountsTemplateChecksum, 'chart_tax_smoke_template_provenance_missing');
      const taxRepo = new PrismaTransactionTaxRepository({ client: tx } as any);
      const profiles = (await taxRepo.listProfiles(options.companyId, {
        status: 'ACTIVE',
        effectiveDate: options.documentDate,
      }, tx)).filter((profile) => profile.sourceProfileKey === options.profileKey);
      assert.equal(profiles.length, 1, 'chart_tax_smoke_active_profile_not_unique');
      const profile = profiles[0]!;
      const definitions = await taxRepo.listDefinitions(options.companyId, {
        profileId: profile.id,
        externalCode: options.taxCode,
        direction: 'INPUT',
        transactionContext: 'DOMESTIC_PURCHASE',
        status: 'ACTIVE',
        effectiveDate: options.documentDate,
      }, tx);
      assert.equal(definitions.length, 1, 'chart_tax_smoke_tax_code_not_unique');
      const definition = definitions[0]!;
      const [accountRules, reportRules, commercialAccounts] = await Promise.all([
        taxRepo.listAccountRules(options.companyId, {
          direction: 'INPUT',
          status: 'ACTIVE',
          effectiveDate: options.documentDate,
        }, tx),
        taxRepo.listReportRules(options.companyId, {
          taxCodeDefinitionId: definition.id,
          status: 'ACTIVE',
          effectiveDate: options.documentDate,
        }, tx),
        tx.chartOfAccount.findMany({
          where: {
            companyId: options.companyId,
            code: { in: [options.expenseAccountCode, options.payableAccountCode] },
          },
          select: {
            id: true,
            code: true,
            status: true,
            isPosting: true,
            isControlled: true,
          },
        }),
      ]);
      const accountsByCode = new Map(commercialAccounts.map((account) => [account.code, account]));
      const expenseAccount = accountsByCode.get(options.expenseAccountCode);
      const payableAccount = accountsByCode.get(options.payableAccountCode);
      for (const account of [expenseAccount, payableAccount]) {
        assert.ok(
          account?.status === 'ACTIVE' && account.isPosting && !account.isControlled,
          'chart_tax_smoke_commercial_account_invalid',
        );
      }

      const preview = resolveTransactionTaxPreview({
        definitions,
        accountRules,
        reportRules,
        input: {
          sourceType: 'expense.record',
          sourceId: 'read-only-chart-tax-smoke',
          sourceLineId: 'read-only-chart-tax-smoke-line',
          transactionContext: 'DOMESTIC_PURCHASE',
          documentDate: options.documentDate,
          currency: company.baseCurrency,
          taxCodeDefinitionId: definition.id,
          externalTaxCode: definition.externalCode,
          netAmount: '100',
          grossAmount: '107',
          enteredTaxAmount: '7',
          evidenceRefs: ['read-only-smoke-evidence'],
        },
        profileId: profile.id,
        direction: 'INPUT',
        sourceModule: 'expenses',
        profileKey: profile.sourceProfileKey,
        profileVersion: profile.version,
        roundingPolicy: {
          roundingMode: profile.roundingMode,
          roundingScale: profile.roundingScale,
          taxAmountTolerance: profile.taxAmountTolerance,
        },
      });
      assert.deepEqual(preview.errors, [], 'chart_tax_smoke_tax_resolution_failed');
      assert.equal(preview.components.length, 1, 'chart_tax_smoke_component_count_invalid');
      const component = preview.components[0]!;
      assert.equal(component.componentKey, 'VAT', 'chart_tax_smoke_component_invalid');
      assert.equal(component.accountAssignments.length, 1, 'chart_tax_smoke_account_assignment_missing');
      assert.ok(component.reportContributions.length > 0, 'chart_tax_smoke_report_mapping_missing');
      const taxAccountId = component.accountAssignments[0]!.accountId;
      const taxAccount = await tx.chartOfAccount.findFirst({
        where: {
          id: taxAccountId,
          companyId: options.companyId,
          status: 'ACTIVE',
          isPosting: true,
        },
        select: { id: true, code: true },
      });
      assert.ok(taxAccount, 'chart_tax_smoke_tax_account_not_company_owned');

      const source: LedgerSourcePostingInput = {
        companyId: options.companyId,
        sourceType: 'expense.record',
        sourceId: 'read-only-chart-tax-smoke',
        sourceEventType: 'expense.confirmed',
        idempotencyKey: 'read-only-chart-tax-smoke',
        sourceDate: options.documentDate,
        periodKey: options.documentDate.slice(0, 7),
        currency: company.baseCurrency,
        totalAmount: '107',
        taxTotal: '7',
        whtTotal: '0',
        lines: [{
          sourceLineId: 'read-only-chart-tax-smoke-line',
          netAmount: '100',
          vatAmount: '7',
          taxComponents: preview.components,
        }],
      };
      const posting = buildTransactionTaxPostingLines(source, [
        { accountId: expenseAccount!.id, debitAmount: '107', currency: company.baseCurrency },
        { accountId: payableAccount!.id, creditAmount: '107', currency: company.baseCurrency },
      ]);
      assert.equal(posting.error, undefined, 'chart_tax_smoke_posting_failed');
      const journalTaxLine = posting.lines?.find((line) =>
        line.accountId === taxAccountId && line.taxComponentKey === 'VAT');
      assert.ok(journalTaxLine, 'chart_tax_smoke_journal_tax_line_missing');
      const debit = (posting.lines ?? []).reduce((sum, line) => sum + Number(line.debitAmount ?? 0), 0);
      const credit = (posting.lines ?? []).reduce((sum, line) => sum + Number(line.creditAmount ?? 0), 0);
      assert.ok(Math.abs(debit - credit) < 0.0001, 'chart_tax_smoke_journal_unbalanced');

      const reportAmount = primaryTaxReportAmount(
        component.reportContributions,
        component.snapshot.taxAmount,
      );
      const journalTaxAmount = String(
        Number(journalTaxLine.debitAmount ?? 0) - Number(journalTaxLine.creditAmount ?? 0),
      );
      const reconciliation = reconcileTaxFact({
        componentKey: component.componentKey,
        externalTaxCode: component.snapshot.externalTaxCode,
        evidenceStatus: component.snapshot.evidenceStatus,
        accountAssignmentsPresent: component.accountAssignments.length > 0,
        reportMappingPresent: component.reportContributions.length > 0,
        sourceBaseAmount: component.snapshot.taxBaseAmount,
        sourceTaxAmount: component.snapshot.taxAmount,
        eventBaseAmount: component.snapshot.taxBaseAmount,
        eventTaxAmount: component.snapshot.taxAmount,
        journalTaxAmount,
        reportAmount,
        taxAmountTolerance: component.snapshot.taxAmountTolerance,
      });
      assert.equal(reconciliation.issueCode, 'MATCHED', 'chart_tax_smoke_reconciliation_failed');

      return {
        companyId: options.companyId,
        templateChecksum: company.chartOfAccountsTemplateChecksum,
        taxProfile: { key: profile.sourceProfileKey, version: profile.version },
        taxCode: definition.externalCode,
        taxRole: component.accountAssignments[0]!.accountRole,
        accountCodes: {
          expense: expenseAccount!.code,
          payable: payableAccount!.code,
          tax: taxAccount.code,
        },
        accountRefs: {
          expense: opaque(expenseAccount!.id),
          payable: opaque(payableAccount!.id),
          tax: opaque(taxAccount.id),
        },
        sourceTaxAmount: component.snapshot.taxAmount,
        journalTaxAmount,
        reportAmount,
        reconciliation,
      };
    }, { maxWait: 5_000, timeout: 30_000 });

    console.log(JSON.stringify({
      event: 'chart_of_accounts_tax_smoke_pass',
      readOnly: true,
      evidence,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const message = error instanceof Error && /^[a-z0-9_:.-]+$/i.test(error.message)
    ? error.message
    : 'chart_tax_smoke_failed';
  console.error(JSON.stringify({ event: 'chart_of_accounts_tax_smoke_failed', errorCode: message }));
  process.exit(1);
});
