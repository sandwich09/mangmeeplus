import { Prisma } from '../../../../generated/prisma/client.js';
import { TH_SME_COA_V1 } from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import {
  computeChartReadiness,
  previewChartTemplate,
  type ChartDependencyCounts,
  type ChartTemplatePreview,
  type ExistingChartAccount,
} from '../../domain/logic/chart-template.logic.js';
import {
  REQUIRED_EXPENSE_AUTO_POST_RULES,
  selectPostingRuleCandidate,
} from '../../domain/logic/posting-engine.logic.js';
import { requiredAccountAssignments } from '../../../tax/domain/logic/tax-configuration.logic.js';
import { isBankLedgerAccount } from '../../../banking/domain/logic/bank-ledger-account.logic.js';
import type { ChartOfAccountsReadiness } from '@watchdog-bms/contracts';

type ChartTemplateDb = Prisma.TransactionClient;
type GroupCountRow = { accountId: string | null; _count: { _all: number } };
type JsonDependencyRow = { source: string; accountId: string; count: number | bigint };

function addDependency(
  dependenciesByCode: Record<string, ChartDependencyCounts>,
  code: string | undefined,
  source: string,
  count: number,
): void {
  if (!code || count <= 0) return;
  const dependencies = dependenciesByCode[code] ?? {};
  dependencies[source] = (dependencies[source] ?? 0) + count;
  dependenciesByCode[code] = dependencies;
}

function postingRuleCodes(mappingJson: unknown): string[] {
  if (!mappingJson || typeof mappingJson !== 'object' || Array.isArray(mappingJson)) return [];
  const mapping = mappingJson as Record<string, unknown>;
  return ['debitAccountCode', 'creditAccountCode']
    .map((key) => mapping[key])
    .filter((value): value is string => typeof value === 'string');
}

async function loadJsonAssignmentDependencies(
  db: ChartTemplateDb,
  companyId: string,
  accountIds: string[],
): Promise<JsonDependencyRow[]> {
  if (accountIds.length === 0) return [];
  return db.$queryRaw<JsonDependencyRow[]>(Prisma.sql`
    WITH refs AS (
      SELECT 'AccountingDocumentLineAssignment' AS source, assignment ->> 'accountId' AS "accountId"
      FROM "AccountingDocumentLine" line
      JOIN "AccountingDocument" parent
        ON parent."companyId" = line."companyId" AND parent."id" = line."documentId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(line."accountAssignmentsJson") = 'array'
          THEN line."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE line."companyId" = ${companyId}
        AND parent."postingStatus" NOT IN ('posted', 'reversed')

      UNION ALL
      SELECT 'ExpenseLineAssignment', assignment ->> 'accountId'
      FROM "ExpenseLine" line
      JOIN "ExpenseRecord" parent ON parent."id" = line."expenseId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(line."accountAssignmentsJson") = 'array'
          THEN line."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE line."companyId" = ${companyId}
        AND parent."postingStatus" NOT IN ('posted', 'reversed')

      UNION ALL
      SELECT 'PurchaseRequestLineAssignment', assignment ->> 'accountId'
      FROM "PurchaseRequestLine" line
      JOIN "PurchaseRequest" parent ON parent."id" = line."purchaseRequestId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(line."accountAssignmentsJson") = 'array'
          THEN line."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE line."companyId" = ${companyId}
        AND parent."status" NOT IN ('REJECTED', 'CANCELLED', 'CONVERTED')

      UNION ALL
      SELECT 'PurchaseOrderLineAssignment', assignment ->> 'accountId'
      FROM "PurchaseOrderLine" line
      JOIN "PurchaseOrder" parent ON parent."id" = line."purchaseOrderId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(line."accountAssignmentsJson") = 'array'
          THEN line."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE line."companyId" = ${companyId}
        AND parent."postingStatus" NOT IN ('posted', 'reversed')

      UNION ALL
      SELECT 'VendorBillLineAssignment', assignment ->> 'accountId'
      FROM "VendorBillLine" line
      JOIN "VendorBill" parent ON parent."id" = line."vendorBillId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(line."accountAssignmentsJson") = 'array'
          THEN line."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE line."companyId" = ${companyId}
        AND parent."postingStatus" NOT IN ('posted', 'reversed')

      UNION ALL
      SELECT 'TaxEventAssignment', assignment ->> 'accountId'
      FROM "TaxEvent" event
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(event."accountAssignmentsJson") = 'array'
          THEN event."accountAssignmentsJson" ELSE '[]'::jsonb END
      ) assignment
      WHERE event."companyId" = ${companyId}
    )
    SELECT source, "accountId", COUNT(*)::int AS count
    FROM refs
    WHERE "accountId" IN (${Prisma.join(accountIds)})
    GROUP BY source, "accountId"
  `);
}

export async function loadChartTemplatePreview(
  db: ChartTemplateDb,
  companyId: string,
): Promise<ChartTemplatePreview> {
  const templateCodes = TH_SME_COA_V1.accounts.map((account) => account.code);
  const rows = await db.chartOfAccount.findMany({
    where: {
      code: { in: templateCodes },
      OR: [{ companyId }, { companyId: null, isSystem: true }],
    },
    select: {
      id: true,
      companyId: true,
      code: true,
      nameTh: true,
      accountClass: true,
      reportGroup: true,
      normalBalance: true,
      isPosting: true,
      isControlled: true,
    },
  }) as ExistingChartAccount[];
  const accountIds = rows.map((row) => row.id);
  const codeById = new Map(rows.map((row) => [row.id, row.code]));
  const dependenciesByCode: Record<string, ChartDependencyCounts> = {};

  const [
    journalLines,
    postingRules,
    taxAccountRules,
    taxReconciliationLines,
    bankAccounts,
    debitAdjustments,
    creditAdjustments,
    hierarchyRows,
    jsonAssignments,
  ] = await Promise.all([
    (db.journalLine.groupBy as any)({
      by: ['accountId'],
      where: { companyId, accountId: { in: accountIds } },
      _count: { _all: true },
    }) as Promise<GroupCountRow[]>,
    db.postingRule.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      select: { debitAccountId: true, creditAccountId: true, mappingJson: true },
    }),
    (db.taxAccountDeterminationRule.groupBy as any)({
      by: ['accountId'],
      where: { companyId, accountId: { in: accountIds } },
      _count: { _all: true },
    }) as Promise<GroupCountRow[]>,
    (db.taxReconciliationLine.groupBy as any)({
      by: ['journalTaxAccountId'],
      where: { companyId, journalTaxAccountId: { in: accountIds } },
      _count: { _all: true },
    }) as unknown as Promise<Array<{ journalTaxAccountId: string | null; _count: { _all: number } }>>,
    (db.bankAccount.groupBy as any)({
      by: ['ledgerAccountId'],
      where: { companyId, ledgerAccountId: { in: accountIds } },
      _count: { _all: true },
    }) as unknown as Promise<Array<{ ledgerAccountId: string | null; _count: { _all: number } }>>,
    (db.bankAdjustment.groupBy as any)({
      by: ['ledgerDebitAccountId'],
      where: { companyId, ledgerDebitAccountId: { in: accountIds } },
      _count: { _all: true },
    }) as unknown as Promise<Array<{ ledgerDebitAccountId: string | null; _count: { _all: number } }>>,
    (db.bankAdjustment.groupBy as any)({
      by: ['ledgerCreditAccountId'],
      where: { companyId, ledgerCreditAccountId: { in: accountIds } },
      _count: { _all: true },
    }) as unknown as Promise<Array<{ ledgerCreditAccountId: string | null; _count: { _all: number } }>>,
    db.chartOfAccount.findMany({
      where: {
        OR: [
          { id: { in: accountIds }, parentAccountId: { not: null } },
          { parentAccountId: { in: accountIds } },
        ],
      },
      select: { id: true, parentAccountId: true },
    }),
    loadJsonAssignmentDependencies(db, companyId, accountIds),
  ]);

  for (const row of journalLines) addDependency(dependenciesByCode, codeById.get(row.accountId ?? ''), 'JournalLine', row._count._all);
  for (const rule of postingRules) {
    addDependency(dependenciesByCode, codeById.get(rule.debitAccountId ?? ''), 'PostingRuleAccount', 1);
    addDependency(dependenciesByCode, codeById.get(rule.creditAccountId ?? ''), 'PostingRuleAccount', 1);
    for (const code of postingRuleCodes(rule.mappingJson)) {
      if (templateCodes.includes(code)) addDependency(dependenciesByCode, code, 'PostingRuleCode', 1);
    }
  }
  for (const row of taxAccountRules) addDependency(dependenciesByCode, codeById.get(row.accountId ?? ''), 'TaxAccountRule', row._count._all);
  for (const row of taxReconciliationLines) addDependency(dependenciesByCode, codeById.get(row.journalTaxAccountId ?? ''), 'TaxReconciliationLine', row._count._all);
  for (const row of bankAccounts) addDependency(dependenciesByCode, codeById.get(row.ledgerAccountId ?? ''), 'BankAccount', row._count._all);
  for (const row of debitAdjustments) addDependency(dependenciesByCode, codeById.get(row.ledgerDebitAccountId ?? ''), 'BankAdjustment', row._count._all);
  for (const row of creditAdjustments) addDependency(dependenciesByCode, codeById.get(row.ledgerCreditAccountId ?? ''), 'BankAdjustment', row._count._all);
  for (const row of hierarchyRows) {
    addDependency(dependenciesByCode, codeById.get(row.id), 'AccountHierarchy', row.parentAccountId ? 1 : 0);
    addDependency(dependenciesByCode, codeById.get(row.parentAccountId ?? ''), 'AccountHierarchy', 1);
  }
  for (const row of jsonAssignments) {
    addDependency(dependenciesByCode, codeById.get(row.accountId), row.source, Number(row.count));
  }

  return previewChartTemplate({ existingAccounts: rows, dependenciesByCode });
}

export async function loadChartReadiness(
  db: ChartTemplateDb,
  companyId: string,
  currentPreview?: ChartTemplatePreview,
): Promise<ChartOfAccountsReadiness> {
  const preview = currentPreview ?? await loadChartTemplatePreview(db, companyId);
  const now = new Date();
  const [
    company,
    chartAccounts,
    featureRows,
    postingRules,
    taxProfiles,
    taxAccountRules,
    bankAccounts,
    taxHeaderDocuments,
    sourcePostingErrorCounts,
  ] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        vatRegistered: true,
        chartOfAccountsTemplateKey: true,
        chartOfAccountsTemplateVersion: true,
        chartOfAccountsTemplateChecksum: true,
        chartOfAccountsTemplateAppliedAt: true,
      },
    }),
    db.chartOfAccount.findMany({
      where: { companyId },
      select: { code: true, status: true, isPosting: true, isControlled: true },
    }),
    db.companyFeatureEntitlement.findMany({
      where: { companyId, enabled: true },
      select: { featureKey: true },
    }),
    db.postingRule.findMany({
      where: {
        OR: [{ companyId }, { companyId: null }],
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }],
      },
      select: {
        companyId: true,
        documentType: true,
        ruleKey: true,
        version: true,
        mappingJson: true,
      },
    }),
    db.companyTaxCodeProfile.findMany({
      where: { companyId, status: { not: 'RETIRED' } },
      select: {
        id: true,
        status: true,
        definitions: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            taxRegime: true,
            direction: true,
            treatment: true,
            transactionContextsJson: true,
            rate: true,
            calculationMethod: true,
            claimabilityDefault: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        },
      },
    }),
    db.taxAccountDeterminationRule.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        taxCodeDefinitionId: true,
        accountRole: true,
        postingSide: true,
        account: {
          select: { companyId: true, status: true, isPosting: true },
        },
      },
    }),
    db.bankAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        ledgerAccountId: true,
        ledgerAccount: {
          select: {
            companyId: true,
            status: true,
            isPosting: true,
            isControlled: true,
            accountClass: true,
            normalBalance: true,
            cashFlowCategory: true,
            reportGroup: true,
            code: true,
          },
        },
      },
    }),
    db.accountingDocument.findMany({
      where: {
        companyId,
        documentType: { in: ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
        outputTaxCode: { not: null },
      },
      select: {
        outputTaxCode: true,
        lines: { select: { externalTaxCodeSnapshot: true } },
      },
    }),
    Promise.all([
      db.accountingDocument.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.accountingPayment.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.expenseRecord.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.purchaseOrder.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.goodsReceipt.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.vendorBill.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.supplierPayment.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.bankAdjustment.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.reimbursementRequest.count({ where: { companyId, postingStatus: 'posting_error' } }),
      db.reimbursementPayment.count({ where: { companyId, postingStatus: 'posting_error' } }),
    ]),
  ]);
  if (!company) throw new Error('company_not_found');

  const usableAccountsByCode = new Map(chartAccounts.map((account) => [account.code, account]));
  const requiredPostingRolesMissing = REQUIRED_EXPENSE_AUTO_POST_RULES.flatMap((required) => {
    const rule = selectPostingRuleCandidate(
      postingRules.filter((candidate) =>
        candidate.documentType === required.documentType && candidate.ruleKey === required.ruleKey),
      companyId,
      true,
    );
    const codes = postingRuleCodes(rule?.mappingJson);
    const usable = codes.length === 2 && codes.every((code) => {
      const account = usableAccountsByCode.get(code);
      return account?.status === 'ACTIVE' && account.isPosting && !account.isControlled;
    });
    return usable ? [] : [required.key];
  });

  const enabledFeatures = new Set(featureRows.map((row) => row.featureKey));
  const taxConfigurationRequired = company.vatRegistered || enabledFeatures.has('thai_tax');
  const activeProfiles = taxProfiles.filter((profile) => profile.status === 'ACTIVE');
  const activeDefinitions = activeProfiles.flatMap((profile) => profile.definitions);
  const missingTaxRoles = new Set<string>();
  if (taxConfigurationRequired && activeDefinitions.length === 0) missingTaxRoles.add('ACTIVE_TAX_PROFILE');
  for (const definition of activeDefinitions) {
    const expected = requiredAccountAssignments({
      ...definition,
      transactionContexts: Array.isArray(definition.transactionContextsJson)
        ? definition.transactionContextsJson
        : [],
      rate: definition.rate.toString(),
      effectiveFrom: definition.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: definition.effectiveTo?.toISOString().slice(0, 10) ?? null,
    } as any);
    for (const role of expected) {
      const matching = taxAccountRules.some((rule) =>
        rule.taxCodeDefinitionId === definition.id
        && rule.accountRole === role.accountRole
        && rule.postingSide === role.postingSide
        && rule.account.companyId === companyId
        && rule.account.status === 'ACTIVE'
        && rule.account.isPosting);
      if (!matching) missingTaxRoles.add(role.accountRole);
    }
  }
  const draftProfileCount = taxProfiles.filter((profile) => profile.status !== 'ACTIVE').length;
  const taxProfilesNeedingReview = taxConfigurationRequired && activeProfiles.length === 0
    ? Math.max(1, draftProfileCount)
    : draftProfileCount;

  const bankLedgerLinksInvalid = bankAccounts.filter((bank) =>
    !bank.ledgerAccountId
    || bank.ledgerAccount?.companyId !== companyId
    || !isBankLedgerAccount(bank.ledgerAccount as any)).length;
  const legacyTaxHeaderMismatches = taxHeaderDocuments.filter((document) =>
    document.lines.some((line) =>
      line.externalTaxCodeSnapshot != null
      && line.externalTaxCodeSnapshot !== document.outputTaxCode)).length;
  const chartTemplateApplied = Boolean(
    company.chartOfAccountsTemplateKey
    && company.chartOfAccountsTemplateVersion
    && company.chartOfAccountsTemplateChecksum
    && company.chartOfAccountsTemplateAppliedAt,
  );
  const globalShadowConflict = preview.rows.some((row) => (row.dependencies.GLOBAL_ACCOUNT ?? 0) > 0);

  return computeChartReadiness({
    chartTemplateApplied,
    chartTemplateKey: company.chartOfAccountsTemplateKey,
    chartTemplateVersion: company.chartOfAccountsTemplateVersion,
    chartTemplateChecksum: company.chartOfAccountsTemplateChecksum,
    chartTemplateAppliedAt: company.chartOfAccountsTemplateAppliedAt?.toISOString() ?? null,
    chartAccountCount: chartAccounts.length,
    chartCoverageComplete: preview.missing === 0,
    globalShadowConflict,
    chartConflicts: preview.unusedConflicts + preview.inUseConflicts,
    requiredPostingRolesMissing,
    requiredTaxAccountRolesMissing: [...missingTaxRoles],
    taxProfilesNeedingReview,
    taxConfigurationRequired,
    bankLedgerLinksInvalid,
    legacyTaxHeaderMismatches,
    sourcePostingErrors: sourcePostingErrorCounts.reduce((sum, count) => sum + count, 0),
  });
}
