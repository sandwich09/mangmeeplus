import { UnprocessableEntityException } from '@nestjs/common';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { TH_SME_COA_V1_MAPPING_MANIFEST } from '../../../ledger/domain/catalog/th-sme-chart-of-accounts-v1.js';
import { requiredAccountAssignments, requiredReportMappings } from '../../domain/logic/tax-configuration.logic.js';
import { findTaxCodeProfileTemplate } from '../../domain/tax-code-template.catalog.js';

/**
 * RA-16: a fresh company must be able to resolve claimable input VAT on day one. Without an ACTIVE
 * profile + Tax Codes + reviewed account/report rules, FINAL resolve of a CLAIMABLE purchase line
 * throws 422 `transaction_tax_needs_review` and ภ.พ.30 boxes stay 0.
 *
 * Nothing is invented here: the codes come from the built-in domestic-expense template, the
 * required roles/boxes come from `requiredAccountAssignments`/`requiredReportMappings` (the same
 * functions `activateProfile` uses to decide a profile is complete), and the accounts come from the
 * chart template's own standard mapping manifest.
 *
 * That manifest is NOT human-reviewed, and cannot be: `chart-template.logic.ts:153` pins every
 * suggestion in it to reviewStatus REVIEW_REQUIRED by construction. Bootstrap deliberately adopts
 * the standard template mapping as the launch default and stamps the system actor below as the
 * attestation seam, so each row names a traceable non-human reviewer rather than implying a person
 * approved it.
 */
const ONBOARDING_PROFILE_TEMPLATE_KEY = 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1';

/**
 * Recorded as reviewedBy on rows nobody clicked "review" on, same seam as
 * WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID. Not an FK. The company owner is still the createdBy, but the
 * review attestation must not name a human who has not authenticated yet.
 */
export const TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID = 'system:tax-config-bootstrap';

/** accountRole → account code, from the chart template's standard (REVIEW_REQUIRED) mapping manifest. */
const TAX_ACCOUNT_CODE_BY_ROLE = new Map<string, string>(
  TH_SME_COA_V1_MAPPING_MANIFEST.suggestions
    .filter((suggestion) => suggestion.kind === 'TAX')
    .map((suggestion) => [suggestion.key, suggestion.accountCode]),
);

export type TaxConfigBootstrapSummary = {
  profileId: string;
  profileKey: string;
  profileStatus: 'ACTIVE';
  effectiveFrom: string;
  definitionCount: number;
  accountRuleCount: number;
  reportRuleCount: number;
};

function bootstrapError(code: string, message: string, details?: Record<string, unknown>) {
  return new UnprocessableEntityException({ code, message, ...(details && { details }) });
}

export async function bootstrapCompanyTaxConfiguration(
  tx: Prisma.TransactionClient,
  input: { companyId: string; createdByUserId: string; appliedAt?: Date },
): Promise<TaxConfigBootstrapSummary> {
  const template = findTaxCodeProfileTemplate(ONBOARDING_PROFILE_TEMPLATE_KEY);
  if (!template) throw bootstrapError('tax_config_template_missing', 'Onboarding Tax Code template is not in the catalog.');

  // A second ACTIVE profile would make every line that carries no explicit Tax Code ambiguous
  // (transaction-tax-config.use-case.ts:469), so this seam refuses to run twice — the same
  // precondition shape `persistCompanyChartOfAccounts` uses for the chart.
  const existingProfileCount = await tx.companyTaxCodeProfile.count({ where: { companyId: input.companyId } });
  if (existingProfileCount !== 0) {
    throw bootstrapError('tax_config_already_bootstrapped', 'Company already has a Tax Code profile.', { existingProfileCount });
  }

  const appliedAt = input.appliedAt ?? new Date();
  // Opens on 1 January of the year BEFORE onboarding: input VAT stays claimable for six months, so
  // a company created in January must still resolve a December tax invoice. `listProfiles` filters
  // `effectiveFrom <= documentDate`, and an earlier window is strictly more permissive on the only
  // profile the company has.
  const effectiveFrom = new Date(Date.UTC(appliedAt.getUTCFullYear() - 1, 0, 1));
  const reviewed = { reviewedByUserId: TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID, reviewedAt: appliedAt };

  const profile = await tx.companyTaxCodeProfile.create({
    data: {
      companyId: input.companyId,
      name: template.name,
      sourceSystem: template.sourceSystem,
      sourceProfileKey: template.key,
      countryCode: 'TH',
      isDefault: false,
      status: 'ACTIVE',
      version: 1,
      effectiveFrom,
      sourceUrl: template.sourceUrl,
      createdByUserId: input.createdByUserId,
      ...reviewed,
    },
  });

  const definitions: TaxCodeDefinitionDto[] = [];
  for (const item of template.definitions) {
    const row = await tx.taxCodeDefinition.create({
      data: {
        companyId: input.companyId,
        profileId: profile.id,
        externalCode: item.externalCode,
        displayName: item.displayName,
        taxRegime: item.taxRegime,
        direction: item.direction,
        treatment: item.treatment,
        transactionContextsJson: item.transactionContexts,
        rate: item.rate,
        calculationMethod: item.calculationMethod,
        sapAccountKey: item.sapAccountKey,
        claimabilityDefault: item.claimabilityDefault,
        evidenceRuleKey: item.evidenceRuleKey,
        status: 'ACTIVE',
        effectiveFrom,
        version: 1,
        sourceMetadataJson: { builtInTemplate: template.key, warning: template.warning, sourceUrl: template.sourceUrl },
        createdByUserId: input.createdByUserId,
        ...reviewed,
      },
    });
    definitions.push({
      ...item,
      id: row.id,
      companyId: input.companyId,
      profileId: profile.id,
      status: 'ACTIVE',
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: null,
      version: 1,
      reviewedByUserId: TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID,
      reviewedAt: appliedAt.toISOString(),
    });
  }

  const expectedAccounts = definitions.flatMap((definition) =>
    requiredAccountAssignments(definition).map((expected) => ({ definition, ...expected })));
  const unmappedRoles = [...new Set(expectedAccounts
    .filter((expected) => !TAX_ACCOUNT_CODE_BY_ROLE.has(expected.accountRole))
    .map((expected) => expected.accountRole))];
  if (unmappedRoles.length) {
    throw bootstrapError('tax_config_account_role_unmapped', 'A required tax account role has no reviewed chart mapping.', { accountRoles: unmappedRoles });
  }

  const codes = [...new Set(expectedAccounts.map((expected) => TAX_ACCOUNT_CODE_BY_ROLE.get(expected.accountRole)!))];
  const accounts = await tx.chartOfAccount.findMany({
    where: { companyId: input.companyId, code: { in: codes }, status: 'ACTIVE', isPosting: true },
    select: { id: true, code: true },
  });
  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const missingCodes = codes.filter((code) => !accountIdByCode.has(code));
  if (missingCodes.length) {
    throw bootstrapError('tax_config_account_missing', 'A mapped tax account is missing, inactive, or not posting-enabled.', { accountCodes: missingCodes });
  }

  // transactionContext / sourceModule stay null: one rule per role serves expense, procurement and
  // accounting alike, which is what `selectTaxAccountRule` ranks as the least specific match.
  const accountRules = expectedAccounts.map((expected) => ({
    companyId: input.companyId,
    taxCodeDefinitionId: expected.definition.id,
    taxRegime: expected.definition.taxRegime,
    direction: expected.definition.direction,
    treatment: expected.definition.treatment,
    accountRole: expected.accountRole,
    postingSide: expected.postingSide,
    accountId: accountIdByCode.get(TAX_ACCOUNT_CODE_BY_ROLE.get(expected.accountRole)!)!,
    status: 'ACTIVE' as const,
    effectiveFrom,
    version: 1,
    // Marks the row as machine-seeded from the chart mapping manifest, not hand-mapped: the only
    // provenance a rule can carry (TaxReportMappingRule has no such column).
    sourceMetadataJson: { bootstrap: 'company-onboarding', builtInTemplate: template.key, mappingManifestVersion: TH_SME_COA_V1_MAPPING_MANIFEST.version },
    createdByUserId: input.createdByUserId,
    ...reviewed,
  }));
  await tx.taxAccountDeterminationRule.createMany({ data: accountRules });

  const reportRules = definitions.flatMap((definition) =>
    requiredReportMappings(definition).map((expected) => ({
      companyId: input.companyId,
      taxCodeDefinitionId: definition.id,
      formType: expected.formType,
      boxKey: expected.boxKey,
      amountSource: expected.amountSource,
      status: 'ACTIVE' as const,
      effectiveFrom,
      version: 1,
      createdByUserId: input.createdByUserId,
      ...reviewed,
    })));
  await tx.taxReportMappingRule.createMany({ data: reportRules });

  return {
    profileId: profile.id,
    profileKey: template.key,
    profileStatus: 'ACTIVE',
    effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
    definitionCount: definitions.length,
    accountRuleCount: accountRules.length,
    reportRuleCount: reportRules.length,
  };
}
