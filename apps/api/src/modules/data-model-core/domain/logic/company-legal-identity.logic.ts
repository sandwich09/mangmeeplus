// Company legal identity rules (spec §4.1, §4.3, §12) — pure decisions, no I/O.
//
// Everything here answers one of two questions: "is this value a legal identity value at all"
// and "is this the right KIND of change to make to it". The second one is the whole point of
// the feature: a typo fixed as a legal change fences every backdated document, and a legal name
// change recorded as a typo makes the company's own tax invoices unreconstructable.
import {
  COMPANY_LEGAL_ADDRESS_KEYS,
  LEGAL_IDENTITY_CORRECTION_REASONS,
  USER_LEGAL_IDENTITY_CHANGE_KINDS,
  isCivilDate,
  type CivilDate,
  type CompanyLegalAddress,
  type LegalIdentityCorrectionReason,
  type UserLegalIdentityChangeKind,
} from '@watchdog-bms/contracts';

export type LegalIdentityField = 'taxId' | 'registeredName' | 'addressJson';

/** Everything the change-kind decision needs, all of it already loaded by the caller. */
export type LegalIdentityChangeContext = {
  changedFields: readonly LegalIdentityField[];
  captureWindowOpen: boolean;
  authoritativeLatched: boolean;
  /** Fields that already have a LEGAL_CHANGE revision, so the next edit must be one too. */
  fieldLatched: { registeredName: boolean; addressJson: boolean };
  lastLegalChangeEffectiveDate: CivilDate | null;
  today: CivilDate;
};

export type LegalIdentityChangeInput = {
  changeKind: UserLegalIdentityChangeKind;
  effectiveFrom?: CivilDate | null;
  correctionReason?: LegalIdentityCorrectionReason | null;
  note?: string | null;
};

/** A rejection the caller turns into 422. `allowedChangeKinds` is what the UI should offer. */
export type LegalIdentityChangeRejection = {
  code: 'identity_change_kind_not_allowed';
  reason: string;
  allowedChangeKinds: UserLegalIdentityChangeKind[];
};

const THAI_TAX_ID = /^\d{13}$/;
const THAI_POSTAL_CODE = /^\d{5}$/;

/** Digits only. Users paste `0-1055-56000-00-1` off a ภ.พ.20 and that is the same number. */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function isThaiTaxId(value: string): boolean {
  return THAI_TAX_ID.test(value);
}

/**
 * Thai 13-digit mod-11 check digit. A WARNING, never a block (Q1): the algorithm is real but
 * the consequence of a false negative — refusing a company its own number — is worse than
 * storing an unverified one, and the RD lookup is the authoritative check anyway.
 */
export function thaiTaxIdChecksumValid(value: string): boolean {
  if (!isThaiTaxId(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(value[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}

export type AddressValidationResult =
  | { ok: true; value: CompanyLegalAddress }
  | { ok: false; errors: string[] };

/**
 * The address is a closed shape: an unknown key is an ERROR, not something to drop. Silently
 * dropping it would accept a request the user believes was saved, and the field would be
 * missing from the address printed on their tax invoices.
 */
export function validateLegalAddress(input: unknown): AddressValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['addressJson must be an object'] };
  }
  const source = input as Record<string, unknown>;
  const errors: string[] = [];

  const allowed = new Set<string>(COMPANY_LEGAL_ADDRESS_KEYS);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) errors.push(`addressJson.${key} is not an allowed field`);
  }

  const text = (key: string, required: boolean): string | null => {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) errors.push(`addressJson.${key} is required`);
      return null;
    }
    if (typeof raw !== 'string') {
      errors.push(`addressJson.${key} must be a string`);
      return null;
    }
    const trimmed = raw.trim();
    if (required && trimmed.length === 0) errors.push(`addressJson.${key} is required`);
    return trimmed;
  };

  const line1 = text('line1', true);
  const line2 = text('line2', false);
  const subdistrict = text('subdistrict', true);
  const district = text('district', true);
  const province = text('province', true);
  const postalCode = text('postalCode', true);
  if (postalCode !== null && !THAI_POSTAL_CODE.test(postalCode)) {
    errors.push('addressJson.postalCode must be 5 digits');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      line1: line1 as string,
      line2: line2 ?? null,
      subdistrict: subdistrict as string,
      district: district as string,
      province: province as string,
      postalCode: postalCode as string,
    },
  };
}

/**
 * Which change kinds the server will actually accept for this edit. The wizard asks first and
 * only offers these, so a user is never shown an option that comes back rejected (§11).
 */
export function allowedChangeKinds(context: LegalIdentityChangeContext): UserLegalIdentityChangeKind[] {
  // While the company is still capturing, everything is capture. The window is bound to
  // `legalIdentityCaptureCompletedAt` and NOT to version 0, because the wizard saves per step
  // and the version has already moved by step 2.
  if (context.captureWindowOpen) return ['INITIAL_CAPTURE'];

  const touchesTaxId = context.changedFields.includes('taxId');
  // A tax id never changes by typo after the window closes: correcting one is a reconciliation
  // repair (§16), and changing one is a legal change. Neither is CORRECTION.
  if (touchesTaxId) return ['LEGAL_CHANGE'];

  // Per-field latch: a field that already carries a LEGAL_CHANGE revision can only take another.
  const touchesLatchedField = context.changedFields.some(
    (field) => (field === 'registeredName' || field === 'addressJson') && context.fieldLatched[field],
  );

  if (context.authoritativeLatched || touchesLatchedField) return ['LEGAL_CHANGE'];
  return ['CORRECTION', 'LEGAL_CHANGE'];
}

/**
 * The gate every identity PATCH passes. Returns null when the change is allowed.
 *
 * Split from `allowedChangeKinds` on purpose: the UI needs the list, the server needs the
 * verdict, and computing them separately is how they drift apart.
 */
export function rejectLegalIdentityChange(
  input: LegalIdentityChangeInput,
  context: LegalIdentityChangeContext,
): LegalIdentityChangeRejection | { code: 'validation'; reason: string } | null {
  if (!(USER_LEGAL_IDENTITY_CHANGE_KINDS as readonly string[]).includes(input.changeKind)) {
    return { code: 'validation', reason: `changeKind must be one of ${USER_LEGAL_IDENTITY_CHANGE_KINDS.join(', ')}` };
  }
  if (context.changedFields.length === 0) {
    return { code: 'validation', reason: 'no identity field was changed' };
  }

  const allowed = allowedChangeKinds(context);
  if (!allowed.includes(input.changeKind)) {
    return {
      code: 'identity_change_kind_not_allowed',
      reason: context.captureWindowOpen
        ? 'the capture window is open, so every identity edit is an initial capture'
        : 'this field is already established, so the edit must be recorded as a legal change',
      allowedChangeKinds: allowed,
    };
  }

  if (input.changeKind === 'LEGAL_CHANGE') {
    const effectiveFrom = input.effectiveFrom ?? null;
    if (!effectiveFrom || !isCivilDate(effectiveFrom)) {
      return { code: 'validation', reason: 'effectiveFrom (YYYY-MM-DD) is required for a legal change' };
    }
    // Monotonic: string comparison is chronological for a fixed-width civil date.
    if (context.lastLegalChangeEffectiveDate && effectiveFrom < context.lastLegalChangeEffectiveDate) {
      return {
        code: 'validation',
        reason: `effectiveFrom must not precede the previous legal change (${context.lastLegalChangeEffectiveDate})`,
      };
    }
    // No future-dating: identity has no future-fact machinery the way VAT registration does
    // (§5.3), so a future date would be a fact nothing ever applies.
    if (effectiveFrom > context.today) {
      return { code: 'validation', reason: 'effectiveFrom must not be in the future' };
    }
  }

  if (input.changeKind === 'CORRECTION') {
    if (!input.correctionReason || !(LEGAL_IDENTITY_CORRECTION_REASONS as readonly string[]).includes(input.correctionReason)) {
      return {
        code: 'validation',
        reason: `correctionReason must be one of ${LEGAL_IDENTITY_CORRECTION_REASONS.join(', ')}`,
      };
    }
    if (!input.note || input.note.trim().length === 0) {
      return { code: 'validation', reason: 'note is required for a correction' };
    }
  }

  // INITIAL_CAPTURE and CORRECTION never carry a legal date: accepting one would let a caller
  // move `lastLegalChangeEffectiveDate` without creating the fence that goes with it.
  if (input.changeKind !== 'LEGAL_CHANGE' && input.effectiveFrom) {
    return { code: 'validation', reason: 'effectiveFrom is only valid for a legal change' };
  }

  return null;
}

/** The fields a PATCH actually changes, comparing normalized values (§4.3 needs the exact set). */
export function changedIdentityFields(
  current: { taxId: string | null; registeredName: string | null; addressJson: unknown },
  next: { taxId?: string; registeredName?: string; addressJson?: CompanyLegalAddress },
): LegalIdentityField[] {
  const changed: LegalIdentityField[] = [];
  if (next.taxId !== undefined && next.taxId !== (current.taxId ?? '')) changed.push('taxId');
  if (next.registeredName !== undefined && next.registeredName.trim() !== (current.registeredName ?? '')) {
    changed.push('registeredName');
  }
  if (next.addressJson !== undefined && !sameAddress(current.addressJson, next.addressJson)) {
    changed.push('addressJson');
  }
  return changed;
}

/**
 * Which fields already carry a LEGAL_CHANGE, derived by comparing each such revision with the
 * one before it. Derived rather than stored: the revision keeps a full snapshot, and a second
 * "which fields changed" column would be a copy of the same truth that can disagree with it.
 * Revisions must arrive ordered by `legalIdentityVersion`.
 */
export function fieldLatchFromRevisions(
  revisions: readonly { legalIdentityVersion: number; changeKind: string; snapshotJson: unknown }[],
): { registeredName: boolean; addressJson: boolean } {
  const latch = { registeredName: false, addressJson: false };
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (revision.changeKind !== 'LEGAL_CHANGE') continue;
    const before = (revisions[index - 1]?.snapshotJson ?? null) as Record<string, unknown> | null;
    const after = revision.snapshotJson as Record<string, unknown> | null;
    if (!after) continue;
    // The first revision of all being a LEGAL_CHANGE latches whatever it carries: there is no
    // earlier snapshot to say it did not change.
    if (!before || JSON.stringify(before.registeredName ?? null) !== JSON.stringify(after.registeredName ?? null)) {
      latch.registeredName = true;
    }
    if (!before || JSON.stringify(before.addressJson ?? null) !== JSON.stringify(after.addressJson ?? null)) {
      latch.addressJson = true;
    }
  }
  return latch;
}

function sameAddress(current: unknown, next: CompanyLegalAddress): boolean {
  if (typeof current !== 'object' || current === null) return false;
  const existing = current as Record<string, unknown>;
  return COMPANY_LEGAL_ADDRESS_KEYS.every((key) => (existing[key] ?? null) === (next[key] ?? null));
}
