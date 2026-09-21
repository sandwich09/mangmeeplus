/**
 * Vendor-address spec §5 row 2, §6, §8 (Slice 2): the buyer block a full tax invoice printed — our own
 * company as the seller typed it — compared with the company registry. Warn-only by construction:
 * the outputs are a status and the differences a person should look at, never a change to
 * `taxEvidenceStatus` or `inputVatClaimStatus` (E11).
 *
 * The owner has rejected noisy warnings before (a duplicate rule that flagged everything was called
 * useless), so MISMATCH needs hard evidence: a different tax id, a different branch under the same
 * tax id, a name that matches none of the company's names, or two postcodes that differ. A name
 * printed differently under the right tax id, or an address laid out another way, is formatting or
 * OCR noise and reads as MATCH.
 */
import {
  formatCompanyLegalAddress,
  type CompanyLegalAddress,
  type ExpenseBuyerAsPrinted,
  type ExpenseBuyerMatchStatus,
} from '@watchdog-bms/contracts';
import { normalizeBranchCode, normalizeVendorName } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';

export type BuyerAsPrintedFields = Pick<ExpenseBuyerAsPrinted, 'name' | 'taxId' | 'branchCode' | 'addressText'>;

/** The registry side, as `getSubstituteCompanyContext` reads it. */
export type BuyerRegistryIdentity = {
  taxId: string | null;
  registeredName: string | null;
  displayName: string;
  brandName: string | null;
  addressJson: unknown;
};

export type BuyerComparison = {
  matchStatus: ExpenseBuyerMatchStatus;
  differences: NonNullable<ExpenseBuyerAsPrinted['differences']>;
};

const PRINTED_KEYS = ['name', 'taxId', 'branchCode', 'addressText'] as const;
const MATCH_STATUSES: readonly string[] = ['MATCH', 'MISMATCH', 'UNCHECKED', 'NOT_PRINTED'];
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const HEAD_OFFICE = '00000';

// Legal-form words, stripped before names are compared: "บริษัท มั่งมีพลัส จำกัด" and "มั่งมีพลัส" are
// the same buyer. Longest first — "ห้างหุ้นส่วนจำกัด" must go before "จำกัด", or "ห้างหุ้นส่วน" is left
// behind. Thai is written without spaces, so the Thai words match anywhere; the Latin ones need a
// word boundary, so "Co." never eats the start of "Coffee".
const COMPANY_FORM_WORDS: RegExp[] = [
  /ห้างหุ้นส่วนจำกัด/g, /ห้างหุ้นส่วนสามัญ/g, /บริษัท/g, /จำกัด/g, /มหาชน/g,
  /บจก\.?/g, /บมจ\.?/g, /หจก\.?/g, /หสม\.?/g,
  /\bpublic\s+company\s+limited\b/gi, /\bcompany\s+limited\b/gi, /\blimited\b/gi,
  /\bltd\b\.?/gi, /\bpcl\b\.?/gi, /\bco\b\.?/gi,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asciiDigits(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)));
}

function thirteenDigitTaxId(value: unknown): string | null {
  const digits = asciiDigits(value).replace(/\D/g, '');
  return digits.length === 13 ? digits : null;
}

/** The last standalone five-digit run: a Thai address ends with its postcode, and a 13-digit id or a
 *  phone number is never mistaken for one. */
function postalCode(value: unknown): string | null {
  const runs = asciiDigits(value).match(/(?<!\d)\d{5}(?!\d)/g);
  return runs ? runs[runs.length - 1]! : null;
}

/**
 * Comparison-only. NFKC splits สระอำ (U+0E33) into นิคหิต+สระอา, so the fold puts it back BEFORE the
 * form words are stripped — they are written precomposed above, and "จํากัด" from an OCR or TIS-620
 * source must still meet them. Phase 2's `normalizeVendorName` then does the rest of the fold.
 */
function canonicalName(value: unknown): string {
  let text = String(value ?? '').normalize('NFKC').replace(/\u0E4D\u0E32/g, '\u0E33');
  for (const form of COMPANY_FORM_WORDS) text = text.replace(form, ' ');
  return normalizeVendorName(text);
}

/** Equal, or one contains the other and the shorter side is at least three characters. */
function namesMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const [shorter, longer] = [...left].length <= [...right].length ? [left, right] : [right, left];
  return [...shorter].length >= 3 && longer.includes(shorter);
}

export function hasPrintedBuyer(printed: BuyerAsPrintedFields): boolean {
  return Boolean(printed.name || printed.taxId || printed.addressText);
}

/** The four printed values, trimmed, from wherever they were kept: this read's OCR result, the stored
 *  column, or `aiVerifiedFieldsJson.buyerAsPrinted` on a draft read before the column existed. */
export function buyerPrintedFields(value: unknown): BuyerAsPrintedFields {
  const record = isRecord(value) ? value : {};
  const printed: BuyerAsPrintedFields = {};
  for (const key of PRINTED_KEYS) {
    const text = typeof record[key] === 'string' ? (record[key] as string).trim() : '';
    if (text) printed[key] = text;
  }
  return printed;
}

/** The stored column, or null when it holds nothing this code wrote. */
export function readBuyerAsPrinted(value: unknown): ExpenseBuyerAsPrinted | null {
  return isRecord(value) && MATCH_STATUSES.includes(String(value.matchStatus)) && typeof value.checkedAt === 'string'
    ? (value as ExpenseBuyerAsPrinted)
    : null;
}

/** `expectedBranchCode` is the expense branch's `taxBranchCode`; null or blank is head office. */
export function compareBuyerAsPrinted(
  printed: BuyerAsPrintedFields,
  company: BuyerRegistryIdentity,
  expectedBranchCode: string | null,
): BuyerComparison {
  if (!hasPrintedBuyer(printed)) return { matchStatus: 'NOT_PRINTED', differences: [] };
  const companyTaxId = thirteenDigitTaxId(company.taxId);
  if (!companyTaxId && !formatCompanyLegalAddress(company.addressJson as CompanyLegalAddress | null)) {
    return { matchStatus: 'UNCHECKED', differences: [] };
  }
  const printedTaxId = thirteenDigitTaxId(printed.taxId);
  if (printedTaxId && companyTaxId) {
    if (printedTaxId !== companyTaxId) {
      return { matchStatus: 'MISMATCH', differences: [{ reason: 'TAX_ID', printed: printedTaxId, registered: companyTaxId }] };
    }
    // The right tax id is the buyer's identity. Only the establishment can still be wrong, and only
    // when the page printed one: a missing branch code is not evidence of anything.
    const printedBranch = normalizeBranchCode(printed.branchCode) ?? HEAD_OFFICE;
    const expected = normalizeBranchCode(expectedBranchCode) ?? HEAD_OFFICE;
    return printed.branchCode && printedBranch !== expected
      ? { matchStatus: 'MISMATCH', differences: [{ reason: 'BRANCH', printed: printedBranch, registered: expected }] }
      : { matchStatus: 'MATCH', differences: [] };
  }
  const differences: BuyerComparison['differences'] = [];
  const printedName = canonicalName(printed.name);
  const registeredNames = [company.registeredName, company.displayName, company.brandName]
    .filter((name): name is string => Boolean(canonicalName(name)));
  if (printedName && registeredNames.length > 0
    && !registeredNames.some((name) => namesMatch(printedName, canonicalName(name)))) {
    differences.push({ reason: 'NAME', printed: printed.name!, registered: registeredNames[0]!.trim() });
  }
  // Only two postcodes are evidence. The rest of an address is never judged: a road spelt ถ. on one
  // side and ถนน on the other is the same place.
  const printedPostalCode = postalCode(printed.addressText);
  const registeredPostalCode = postalCode(isRecord(company.addressJson) ? company.addressJson.postalCode : null);
  if (printedPostalCode && registeredPostalCode && printedPostalCode !== registeredPostalCode) {
    differences.push({ reason: 'POSTAL_CODE', printed: printedPostalCode, registered: registeredPostalCode });
  }
  return differences.length > 0 ? { matchStatus: 'MISMATCH', differences } : { matchStatus: 'MATCH', differences: [] };
}

/**
 * The value to store. A confirmed override survives a re-check only while it still describes the
 * same thing a person looked at: the same MISMATCH reasons over the same printed values. Anything
 * else — a match now, another reason, a re-read that printed something different — drops it.
 */
export function nextBuyerAsPrinted(
  printed: BuyerAsPrintedFields,
  comparison: BuyerComparison,
  previous: ExpenseBuyerAsPrinted | null,
  checkedAt: string,
): ExpenseBuyerAsPrinted {
  const reasons = comparison.differences.map((difference) => difference.reason);
  const keepOverride = Boolean(previous?.overrideReason)
    && comparison.matchStatus === 'MISMATCH' && previous!.matchStatus === 'MISMATCH'
    && (previous!.reasons ?? []).join() === reasons.join()
    && PRINTED_KEYS.every((key) => (previous![key] ?? '') === (printed[key] ?? ''));
  return {
    ...printed,
    matchStatus: comparison.matchStatus,
    ...(reasons.length > 0 ? { reasons, differences: comparison.differences } : {}),
    checkedAt,
    ...(keepOverride ? { overrideReason: previous!.overrideReason! } : {}),
    ...(keepOverride && previous!.overriddenByUserId ? { overriddenByUserId: previous!.overriddenByUserId } : {}),
    ...(keepOverride && previous!.overriddenAt ? { overriddenAt: previous!.overriddenAt } : {}),
  };
}

/**
 * Both writers (OCR apply and the review save) go through here. The registry is read only when the
 * page printed something to compare; the reader is a callback so a document without a buyer block
 * costs no query at all.
 */
export async function recheckBuyerAsPrinted(input: {
  printed: unknown;
  previous: unknown;
  readRegistry: () => Promise<BuyerRegistryIdentity & { branchTaxCode: string | null }>;
  checkedAt: string;
}): Promise<ExpenseBuyerAsPrinted> {
  const printed = buyerPrintedFields(input.printed);
  const registry = hasPrintedBuyer(printed) ? await input.readRegistry() : null;
  const comparison: BuyerComparison = registry
    ? compareBuyerAsPrinted(printed, registry, registry.branchTaxCode)
    : { matchStatus: 'NOT_PRINTED', differences: [] };
  return nextBuyerAsPrinted(printed, comparison, readBuyerAsPrinted(input.previous), input.checkedAt);
}

/** "ยืนยันว่าใช้ได้ พร้อมเหตุผล" (§8): an annotation on a live MISMATCH, or null when there is none. */
export function confirmBuyerMismatch(
  stored: unknown,
  input: { reason: string; userId: string; at: string },
): ExpenseBuyerAsPrinted | null {
  const current = readBuyerAsPrinted(stored);
  return current?.matchStatus === 'MISMATCH'
    ? { ...current, overrideReason: input.reason, overriddenByUserId: input.userId, overriddenAt: input.at }
    : null;
}
