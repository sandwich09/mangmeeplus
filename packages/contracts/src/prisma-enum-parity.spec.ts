// Guard: every runtime enum list in contracts stays set-equal to the Prisma enum
// it mirrors. The incident this exists for: a supplier created with supplierType
// "COMPANY" reached Prisma with a value the schema does not have and answered 500.
//
// Why this lives in packages/contracts and not apps/api: apps/api resolves
// @watchdog-bms/contracts through the built dist/, and the suites do not build
// first — an apps/api-hosted copy of this test would assert against a stale build
// and go green while the source had already drifted. Here the source modules are
// imported directly.
//
// Reading apps/api/prisma/schema.prisma from a contracts spec inverts the package
// layering. That is deliberate and confined to this dev-only file: the schema TEXT
// is the source of truth for what the database accepts, and it can be ahead of the
// generated client, which is what a client-based check would see.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as companyProfile from './company-profile.js';
import * as companyTaxIdentity from './company-tax-identity.js';
import * as crmAi from './crm-ai.js';
import * as dataRights from './data-rights.js';
import * as expenses from './expenses.js';
// The barrel also declares a few inline enums (document sequences); import it as a
// namespace so the discovery sweep below can resolve what it finds in index.ts.
import * as index from './index.js';
import * as lineAi from './line-ai.js';
import * as procurement from './procurement.js';
import * as transactionTax from './transaction-tax.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
// packages/contracts/src -> three hops up is the repo root.
const SCHEMA_PATH = path.resolve(SRC_DIR, '../../../apps/api/prisma/schema.prisma');

// The schema carries ~220 enums. A moved file or a broken regex must fail the
// suite, never quietly assert nothing.
const MIN_SCHEMA_ENUMS = 50;

assert.ok(
  existsSync(SCHEMA_PATH),
  `schema.prisma not found at ${SCHEMA_PATH} — this spec resolves it relative to its own location; fix the path rather than deleting the check.`,
);

function parseSchemaEnums(schemaText: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const withoutComments = schemaText.replace(/\/\/.*$/gm, '');
  for (const block of withoutComments.matchAll(/\benum\s+(\w+)\s*\{([^}]*)\}/g)) {
    const values = block[2]
      .split('\n')
      .map((line) => /^([A-Za-z_]\w*)/.exec(line.trim())?.[1])
      .filter((value): value is string => value !== undefined);
    enums.set(block[1], values);
  }
  return enums;
}

const SCHEMA_ENUMS = parseSchemaEnums(readFileSync(SCHEMA_PATH, 'utf8'));

// Namespace objects keyed by file so the registry stays a plain data table and a
// renamed or missing export fails as a readable test, not a compile error.
const SOURCES = {
  'company-profile.ts': companyProfile,
  'company-tax-identity.ts': companyTaxIdentity,
  'crm-ai.ts': crmAi,
  'data-rights.ts': dataRights,
  'expenses.ts': expenses,
  'index.ts': index,
  'line-ai.ts': lineAi,
  'procurement.ts': procurement,
  'transaction-tax.ts': transactionTax,
} as unknown as Record<string, Record<string, unknown>>;

type Registration = {
  /** contracts source file, relative to packages/contracts/src */
  source: string;
  arrayName: string;
  prismaEnum: string;
};

// Authoritative list of pairs. Cross-named pairs are NOT discoverable by the
// sweep below — adding one here is the only thing that covers it.
const REGISTRY: Registration[] = [
  { source: 'company-profile.ts', arrayName: 'COMPANY_BUSINESS_CATEGORIES', prismaEnum: 'CompanyBusinessCategory' },
  { source: 'index.ts', arrayName: 'DOCUMENT_RESET_POLICIES', prismaEnum: 'DocumentResetPolicy' },
  { source: 'procurement.ts', arrayName: 'SUPPLIER_STATUSES', prismaEnum: 'SupplierStatus' },
  { source: 'procurement.ts', arrayName: 'SUPPLIER_TYPES', prismaEnum: 'SupplierType' },
  { source: 'procurement.ts', arrayName: 'PURCHASE_LINE_TYPES', prismaEnum: 'PurchaseLineType' },
  { source: 'procurement.ts', arrayName: 'PURCHASE_MATCHING_MODES', prismaEnum: 'PurchaseMatchingMode' },
  // Cross-named: procurement VAT modes and payment methods are stored in the shared accounting enums.
  { source: 'procurement.ts', arrayName: 'PROCUREMENT_VAT_MODES', prismaEnum: 'AccountingVatMode' },
  { source: 'procurement.ts', arrayName: 'PAYMENT_METHODS', prismaEnum: 'AccountingPaymentMethod' },
  { source: 'expenses.ts', arrayName: 'INPUT_VAT_CLAIM_STATUSES', prismaEnum: 'InputVatClaimStatus' },
  { source: 'expenses.ts', arrayName: 'EXPENSE_PAYMENT_METHODS', prismaEnum: 'ExpensePaymentMethod' },
  // Cross-named: the LINE turn intent list mirrors the Prisma AiTurnIntent enum.
  { source: 'line-ai.ts', arrayName: 'AI_TURN_INTENT_VALUES', prismaEnum: 'AiTurnIntent' },
  { source: 'transaction-tax.ts', arrayName: 'TAX_SOURCE_SYSTEMS', prismaEnum: 'TaxSourceSystem' },
  { source: 'transaction-tax.ts', arrayName: 'TRANSACTION_TAX_REGIMES', prismaEnum: 'TransactionTaxRegime' },
  { source: 'transaction-tax.ts', arrayName: 'TRANSACTION_TAX_DIRECTIONS', prismaEnum: 'TransactionTaxDirection' },
  { source: 'transaction-tax.ts', arrayName: 'TRANSACTION_TAX_TREATMENTS', prismaEnum: 'TransactionTaxTreatment' },
  { source: 'transaction-tax.ts', arrayName: 'TRANSACTION_TAX_CONTEXTS', prismaEnum: 'TransactionTaxContext' },
  { source: 'transaction-tax.ts', arrayName: 'TAX_ACCOUNT_ROLES', prismaEnum: 'TaxAccountRole' },
  // Cross-named.
  { source: 'crm-ai.ts', arrayName: 'CRM_AI_SENTIMENTS', prismaEnum: 'CrmSentiment' },
  { source: 'crm-ai.ts', arrayName: 'CRM_AI_CUSTOMER_RISKS', prismaEnum: 'CrmRiskLevel' },
  // Restricted user/company data-rights orchestration.
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_CASE_TYPES', prismaEnum: 'DataRightsCaseType' },
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_CASE_STATUSES', prismaEnum: 'DataRightsCaseStatus' },
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_REQUEST_SOURCES', prismaEnum: 'DataRightsRequestSource' },
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_DECISION_CATEGORIES', prismaEnum: 'DataRightsDecisionCategory' },
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_DISPOSITIONS', prismaEnum: 'DataRightsDisposition' },
  { source: 'data-rights.ts', arrayName: 'DATA_RIGHTS_EVIDENCE_TYPES', prismaEnum: 'DataRightsEvidenceType' },
  // Step 0 company tax identity.
  { source: 'company-tax-identity.ts', arrayName: 'LEGAL_IDENTITY_AUTHORITY_REASONS', prismaEnum: 'LegalIdentityAuthorityReason' },
  { source: 'company-tax-identity.ts', arrayName: 'TIN_EXISTENCE_STATUSES', prismaEnum: 'TinExistenceStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'VAT_DETAIL_STATUSES', prismaEnum: 'VatDetailStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'VERIFICATION_ATTEMPT_STATUSES', prismaEnum: 'VerificationAttemptStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'LEGAL_IDENTITY_CHANGE_KINDS', prismaEnum: 'LegalIdentityChangeKind' },
  { source: 'company-tax-identity.ts', arrayName: 'LEGAL_IDENTITY_CORRECTION_REASONS', prismaEnum: 'LegalIdentityCorrectionReason' },
  { source: 'company-tax-identity.ts', arrayName: 'BUYER_ENTITY_KINDS', prismaEnum: 'BuyerEntityKind' },
  { source: 'company-tax-identity.ts', arrayName: 'BUYER_VAT_STATUSES', prismaEnum: 'BuyerVatStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'VAT_FACT_STATUSES', prismaEnum: 'VatFactStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'VAT_FACT_SOURCES', prismaEnum: 'VatFactSource' },
  { source: 'company-tax-identity.ts', arrayName: 'RECONCILIATION_KINDS', prismaEnum: 'ReconciliationKind' },
  { source: 'company-tax-identity.ts', arrayName: 'RECONCILIATION_SOURCE_STATES', prismaEnum: 'ReconciliationSourceState' },
  { source: 'company-tax-identity.ts', arrayName: 'RECONCILIATION_STATUSES', prismaEnum: 'ReconciliationStatus' },
  { source: 'company-tax-identity.ts', arrayName: 'BUYER_EVIDENCE_CHANGE_KINDS', prismaEnum: 'BuyerEvidenceChangeKind' },
];

// arrayName -> reason it is deliberately not registered. Keep empty unless an
// array genuinely mirrors nothing in the schema despite sharing a name.
const DISCOVERY_IGNORE: Record<string, string> = {};

describe('contracts enum arrays are set-equal to their schema.prisma enums', () => {
  it(`parses at least ${MIN_SCHEMA_ENUMS} enums out of schema.prisma`, () => {
    assert.ok(
      SCHEMA_ENUMS.size >= MIN_SCHEMA_ENUMS,
      `parsed only ${SCHEMA_ENUMS.size} enums from ${SCHEMA_PATH} — the parser or the file moved; every parity assertion below is meaningless until this is fixed.`,
    );
  });

  for (const entry of REGISTRY) {
    it(`${entry.arrayName} (${entry.source}) === enum ${entry.prismaEnum}`, () => {
      const exported = SOURCES[entry.source]?.[entry.arrayName];
      assert.ok(
        Array.isArray(exported) && exported.every((value) => typeof value === 'string'),
        `${entry.arrayName} is not exported as a string array from src/${entry.source} (resolved ${JSON.stringify(exported)}). Either the export was renamed or removed, or this branch predates the commit that added it.`,
      );

      const contractsValues = exported as string[];
      assert.ok(contractsValues.length > 0, `${entry.arrayName} is empty`);
      assert.equal(
        new Set(contractsValues).size,
        contractsValues.length,
        `${entry.arrayName} has duplicate values: ${contractsValues.join(', ')}`,
      );

      const prismaValues = SCHEMA_ENUMS.get(entry.prismaEnum);
      assert.ok(
        prismaValues,
        `enum ${entry.prismaEnum} is not in schema.prisma — the registry entry for ${entry.arrayName} is stale (renamed or dropped enum).`,
      );

      const contractsSet = new Set(contractsValues);
      const prismaSet = new Set(prismaValues);
      const missingInContracts = prismaValues.filter((value) => !contractsSet.has(value));
      const extraInContracts = contractsValues.filter((value) => !prismaSet.has(value));
      assert.ok(
        missingInContracts.length === 0 && extraInContracts.length === 0,
        `${entry.arrayName} (contracts src/${entry.source}) and enum ${entry.prismaEnum} (schema.prisma) are not set-equal:\n` +
          `  missingInContracts: [${missingInContracts.join(', ')}]\n` +
          `  extraInContracts:   [${extraInContracts.join(', ')}]`,
      );
    });
  }
});

// Order matters: _TYPES/_MODES/_ROLES need no special case because the generic
// trailing-S drop already yields TYPE/MODE/ROLE.
function toPrismaEnumName(arrayName: string): string {
  let singular = arrayName;
  if (singular.endsWith('_STATUSES')) singular = `${singular.slice(0, -'_STATUSES'.length)}_STATUS`;
  else if (singular.endsWith('IES')) singular = `${singular.slice(0, -3)}Y`;
  else if (singular.endsWith('S')) singular = singular.slice(0, -1);
  return singular
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join('');
}

const AS_CONST_ARRAY = /export const ([A-Z][A-Z0-9_]*)\s*=\s*\[([\s\S]*?)\]\s*as const/g;

// ponytail: comma split, so a string literal containing a comma reads as a
// non-string list and is skipped. No such array exists; widen to a real tokenizer
// if one appears.
function isStringLiteralList(body: string): boolean {
  const items = body
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 && items.every((item) => /^'[^']*'$/.test(item));
}

describe('enum parity registry covers every same-named contracts array', () => {
  it('flags as const string arrays whose name matches a Prisma enum but are unregistered', () => {
    const registered = new Set(REGISTRY.map((entry) => entry.arrayName));
    const findings: string[] = [];

    const files = readdirSync(SRC_DIR)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .sort();
    for (const file of files) {
      const text = readFileSync(path.join(SRC_DIR, file), 'utf8');
      for (const match of text.matchAll(AS_CONST_ARRAY)) {
        const arrayName = match[1];
        if (registered.has(arrayName) || arrayName in DISCOVERY_IGNORE) continue;
        if (!isStringLiteralList(match[2])) continue;
        const derived = toPrismaEnumName(arrayName);
        if (!SCHEMA_ENUMS.has(derived)) continue;
        findings.push(`  src/${file}: ${arrayName} matches Prisma enum ${derived}`);
      }
    }

    assert.ok(
      findings.length === 0,
      `contracts arrays that mirror a Prisma enum but are not in REGISTRY:\n${findings.join('\n')}\n` +
        'Register the pair in REGISTRY, or add it to DISCOVERY_IGNORE with a reason.',
    );
  });
});
