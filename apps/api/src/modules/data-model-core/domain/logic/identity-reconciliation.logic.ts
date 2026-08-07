// Company identity reconciliation (spec §4.6, §16) — what the generator decides, as pure logic.
//
// The generator NEVER touches Company, CompanyTaxProfile or a revision. It reads, compares, and
// writes reconciliation items. Every domain mutation goes through a resolver command that has
// its own compare-and-set, revision and CRITICAL audit — because "the migration fixed it" is
// exactly the kind of change nobody can explain to an auditor two years later.
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import type { ReconciliationKind, ReconciliationSourceState } from '@watchdog-bms/contracts';

/** Discriminators the generator uses for the one-row-per-company kinds. */
export const TAX_ID_DISCRIMINATOR = 'TAX_ID';
export const VAT_HINT_DISCRIMINATOR = 'VAT_HINT';
/**
 * A second ACTIVE head office is a duplicate the Release B1 constraint will refuse, but it has
 * no taxBranchCode to key on — an unregistered head office carries none. Its own discriminator
 * keeps it under one BRANCH_DUP kind without colliding with a real branch code.
 */
export const ACTIVE_HEAD_OFFICE_DISCRIMINATOR = '__ACTIVE_HEAD_OFFICE__';

export type ReconciliationFinding = {
  kind: ReconciliationKind;
  discriminator: string;
  sourceState: ReconciliationSourceState;
  sourceFingerprint: string;
  payloadMaskedJson: Record<string, unknown>;
};

export type BranchRow = {
  id: string;
  type: string;
  status: string;
  taxBranchCode: string | null;
};

export type GeneratorInput = {
  companyTaxId: string | null;
  profileTaxId: string | null;
  companyVatRegistered: boolean;
  profileVatRegistered: boolean;
  profileVatEffectiveDate: Date | null;
  hasLiveVatFact: boolean;
  branches: readonly BranchRow[];
};

/** Last four digits, or null. Reports and audit metadata never carry the whole number (§15). */
export function maskTaxId(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? value : `••••${value.slice(-4)}`;
}

/**
 * Company vs the deprecated CompanyTaxProfile. Returns null when they agree — an agreeing pair
 * is not a finding, and writing a row for every company on every run would turn a report into a
 * table scan of noise.
 */
export function compareTaxId(input: Pick<GeneratorInput, 'companyTaxId' | 'profileTaxId'>): ReconciliationFinding | null {
  const companyTaxId = input.companyTaxId || null;
  const profileTaxId = input.profileTaxId || null;
  if (companyTaxId === profileTaxId) return null;

  const oneSided = companyTaxId === null || profileTaxId === null;
  return {
    kind: 'TAX_ID',
    discriminator: TAX_ID_DISCRIMINATOR,
    sourceState: oneSided ? 'PENDING_ONE_SIDED' : 'PENDING_CONFLICT',
    sourceFingerprint: canonicalFingerprint({ companyTaxId, profileTaxId }),
    payloadMaskedJson: { companyTaxIdLast4: maskTaxId(companyTaxId), profileTaxIdLast4: maskTaxId(profileTaxId) },
  };
}

/**
 * Duplicates the Release B1 partial uniques will refuse. Only ACTIVE branches count: an archived
 * branch keeping its old code is history, and the constraint is scoped the same way.
 */
export function findBranchDuplicates(branches: readonly BranchRow[]): ReconciliationFinding[] {
  const active = branches.filter((branch) => branch.status === 'ACTIVE');
  const findings: ReconciliationFinding[] = [];

  const byCode = new Map<string, string[]>();
  for (const branch of active) {
    if (!branch.taxBranchCode) continue;
    byCode.set(branch.taxBranchCode, [...(byCode.get(branch.taxBranchCode) ?? []), branch.id]);
  }
  for (const [taxBranchCode, ids] of [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (ids.length < 2) continue;
    const branchIdsSorted = [...ids].sort();
    findings.push({
      kind: 'BRANCH_DUP',
      discriminator: taxBranchCode,
      sourceState: 'PENDING_CONFLICT',
      sourceFingerprint: canonicalFingerprint({ taxBranchCode, branchIdsSorted }),
      payloadMaskedJson: { taxBranchCode, branchIds: branchIdsSorted },
    });
  }

  const headOffices = active.filter((branch) => branch.type === 'HEAD_OFFICE').map((branch) => branch.id).sort();
  if (headOffices.length > 1) {
    findings.push({
      kind: 'BRANCH_DUP',
      discriminator: ACTIVE_HEAD_OFFICE_DISCRIMINATOR,
      sourceState: 'PENDING_CONFLICT',
      sourceFingerprint: canonicalFingerprint({ taxBranchCode: null, branchIdsSorted: headOffices }),
      payloadMaskedJson: { reason: 'multiple ACTIVE head offices', branchIds: headOffices },
    });
  }

  return findings;
}

/**
 * A legacy `vatRegistered = true` with no date is a HINT: somebody once ticked a box. It is not
 * a fact and must never be seeded as one (§5.4) — a human has to supply the date off the ภ.พ.20.
 * Once any live fact exists the hint has been answered and stops being a finding.
 */
export function findVatHint(
  input: Pick<GeneratorInput, 'companyVatRegistered' | 'profileVatRegistered' | 'profileVatEffectiveDate' | 'hasLiveVatFact'>,
): ReconciliationFinding | null {
  if (input.hasLiveVatFact) return null;
  const claimed = input.companyVatRegistered || input.profileVatRegistered;
  if (!claimed) return null;
  const vatEffectiveDate = input.profileVatEffectiveDate ? input.profileVatEffectiveDate.toISOString().slice(0, 10) : null;
  return {
    kind: 'VAT_HINT',
    discriminator: VAT_HINT_DISCRIMINATOR,
    sourceState: 'PENDING_ONE_SIDED',
    sourceFingerprint: canonicalFingerprint({ vatRegistered: claimed, vatEffectiveDate }),
    payloadMaskedJson: { vatRegistered: claimed, vatEffectiveDate },
  };
}

/** Everything the generator would record for one company, in a stable order. */
export function generateFindings(input: GeneratorInput): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const taxId = compareTaxId(input);
  if (taxId) findings.push(taxId);
  findings.push(...findBranchDuplicates(input.branches));
  const vatHint = findVatHint(input);
  if (vatHint) findings.push(vatHint);
  return findings;
}
