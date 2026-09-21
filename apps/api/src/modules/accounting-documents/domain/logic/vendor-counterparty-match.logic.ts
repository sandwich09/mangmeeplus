/**
 * Pure domain logic for the vendor-address-and-counterparty-autosave feature
 * (docs/specs/vendor-address-and-counterparty-autosave-spec-th.md §6, §7). No I/O — the caller
 * reads the existing counterparty row (if any) and writes the result; this file only decides
 * what that result should be.
 */

import type { CounterpartyAddressV2 } from '@watchdog-bms/contracts';
import { COUNTERPARTY_ADDRESS_SOURCES } from '@watchdog-bms/contracts';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const THAI_TAX_ID_LENGTH = 13;
const BRANCH_CODE_LENGTH = 5;
const MAX_SEEN_ON_DOCUMENTS = 5;

// Folds the short forms a supplier prints on a receipt to the full word a Thai reader would use
// when typing the same address by hand, so both spellings normalize to one string (§7).
// `แขวง`/`เขต` (Bangkok's equivalents of `ตำบล`/`อำเภอ`) have no shorter form to fold — they are
// already the canonical spelling wherever they appear, so there is nothing to add for them.
const THAI_ADDRESS_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/ถ\./g, 'ถนน'],
  [/ซ\./g, 'ซอย'],
  [/ต\./g, 'ตำบล'],
  [/อ\./g, 'อำเภอ'],
  [/จ\./g, 'จังหวัด'],
  [/ม\./g, 'หมู่'],
];

// expense-duplicate.logic.ts already folds Thai numerals and strips everything else to bare
// ASCII digits, but keeps the helper module-private, and this file may not touch the expenses
// module to export it. Mirrored here rather than reinvented, so a tax id normalizes identically
// on both sides of the vendor-matching boundary.
function toAsciiDigits(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .replace(/\D/g, '');
}

// NFKC already unifies Thai สระอำ: U+0E33 has a COMPATIBILITY decomposition to นิคหิต+สระอา
// (U+0E4D U+0E32), so both spellings — the precomposed one and the two-character one produced by
// legacy TIS-620 conversions, some fonts and OCR — come out of NFKC as the decomposed pair.
// This fold then puts them back to the precomposed form, and that is load-bearing, not
// decorative: the abbreviation table below substitutes literals such as 'ตำบล' that are written
// precomposed in THIS source file and are therefore inserted AFTER the NFKC pass. Without the
// fold, "ต.บางโฉลง" (expanded to a precomposed 'ตำบล') and a typed "ตำบลบางโฉลง" (decomposed by
// NFKC) would compare unequal. Run it before the table, never after.
function foldThaiSaraAm(value: string): string {
  return value.replace(/ํา/g, 'ำ');
}

// Same mirroring note as toAsciiDigits: expense-duplicate.logic.ts's normalizeVendorName is
// module-private. Matching must fold names identically to duplicate-detection's fold, or the
// same store could match under one code path and miss under the other. That file's NFKC pass
// already handles สระอำ on its own (see above) — it has no such bug to fix.
function normalizeVendorName(value: string | null | undefined): string {
  return foldThaiSaraAm(String(value ?? '').normalize('NFKC')).toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Comparison-only normalization — never store the result, it throws away the punctuation and
 * casing a printed address actually has. Folds the §7 abbreviations, then strips ALL
 * whitespace/punctuation rather than collapsing it to one space: "ถ.สุขุมวิท" (no space after the
 * fold target) and "ถนน สุขุมวิท" (a space, when someone types the full word by hand) must land
 * on the same string, and collapsing to a single space would still leave them different.
 */
export function normalizeThaiAddress(value: string | null | undefined): string {
  let text = foldThaiSaraAm(String(value ?? '').normalize('NFKC'));
  for (const [pattern, full] of THAI_ADDRESS_ABBREVIATIONS) {
    text = text.replace(pattern, full);
  }
  // Separators vanish EXCEPT between two digits: "99/9" and "9/99" are different houses, and
  // stripping every separator collapsed both to "999" — the caller would then read a changed
  // address as unchanged and never record it. One pass, so the inserted '-' is not re-scanned.
  return text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, (run, offset: number, whole: string) => {
    const before = whole[offset - 1];
    const after = whole[offset + run.length];
    return before && after && /\d/.test(before) && /\d/.test(after) ? '-' : '';
  });
}

/**
 * CON-8: the sales side already treats blank as head office and never writes a placeholder for
 * it; the purchase side had no rule at all. This gives it the same one — digits only, exactly 5
 * or the field is empty. A blank/short/long input is `null`, never the string `'00000'`; that
 * substitution only happens inside the A2 match key (vendorMatchKey below), never in storage.
 */
export function normalizeBranchCode(value: string | null | undefined): string | null {
  const digits = toAsciiDigits(value);
  return digits.length === BRANCH_CODE_LENGTH ? digits : null;
}

/**
 * A2: the tax id is the vendor's real identity, so a 13-digit id plus branch code (blank = head
 * office, '00000') always wins. Without one, fall back to the exact normalized name — loose
 * enough to survive re-typing, strict enough (whole-string equality, not substring) to not merge
 * two unrelated shops. A blank name is not "no tax id, match on empty string": §7 says it must
 * skip matching entirely, or every nameless vendor would collide into one counterparty.
 */
export function vendorMatchKey(input: {
  taxId?: string | null;
  branchCode?: string | null;
  name?: string | null;
}): { kind: 'TAX_ID'; taxId: string; branchCode: string } | { kind: 'NAME'; name: string } | null {
  const taxId = toAsciiDigits(input.taxId);
  if (taxId.length === THAI_TAX_ID_LENGTH) {
    const branchCode = normalizeBranchCode(input.branchCode) ?? '00000';
    return { kind: 'TAX_ID', taxId, branchCode };
  }
  const name = normalizeVendorName(input.name);
  return name ? { kind: 'NAME', name } : null;
}

/**
 * Reads the address a document should print regardless of which module last wrote this JSON
 * column: the v2 shape this feature introduces, or the free-form object procurement already
 * writes into the same `billingAddressJson` (CON-9 — no fixed shape there, whatever the client
 * posted). Defensive by construction — a legacy or malformed value must never crash a render.
 */
export function counterpartyAddressText(json: unknown): string | null {
  if (json == null) return null;
  if (typeof json === 'string') {
    const trimmed = json.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!isRecord(json)) return null;

  if (typeof json.addressText === 'string' && json.addressText.trim().length > 0) {
    return json.addressText.trim();
  }

  // Legacy free-shape: no fixed keys, so try the single free-text key first, then the
  // structured-address fields this codebase already uses elsewhere (AddressSnapshot), and give
  // up rather than guess further.
  if (typeof json.address === 'string' && json.address.trim().length > 0) {
    return json.address.trim();
  }
  const parts = [json.line1, json.line2, json.subdistrict, json.district, json.province, json.postalCode]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(' ') : null;
}

function isSeenOnDocumentEntry(value: unknown): value is { addressText: string; expenseId: string; at: string } {
  return (
    isRecord(value) &&
    typeof value.addressText === 'string' &&
    typeof value.expenseId === 'string' &&
    typeof value.at === 'string'
  );
}

/**
 * Assembles the JSON value to persist. What becomes the new primary address, and whether an
 * entry should be remembered, are decided by `decideVendorAutoSave` below — this function only
 * wires provenance and re-caps history, so it stays correct for every caller (expense auto-save,
 * the counterparty page's manual "use this as primary", an RD lookup) without duplicating their
 * case logic here. `structured` carries forward untouched: an expense auto-save never has
 * RD-verified structured data to offer, and must not erase one a prior lookup already found.
 */
export function buildCounterpartyAddressV2(input: {
  addressText: string;
  postalCode?: string | null;
  source: (typeof COUNTERPARTY_ADDRESS_SOURCES)[number];
  expenseId?: string;
  userId: string;
  at: string;
  previous?: unknown;
  /**
   * The address this write displaces, when `decideVendorAutoSave` returned `appendToHistory`.
   * Passing it here rather than leaving each caller to splice the array is what keeps
   * "newest first, capped at 5" true everywhere; without it the rule would be re-implemented
   * per call site and drift.
   */
  appendToHistory?: { addressText: string; expenseId: string; at: string };
}): CounterpartyAddressV2 {
  const previous = isRecord(input.previous) ? input.previous : null;
  const rawStructured = previous?.structured;
  const rawHistory = previous?.seenOnDocuments;

  const structured = isRecord(rawStructured) ? (rawStructured as CounterpartyAddressV2['structured']) : undefined;
  const existing = Array.isArray(rawHistory) ? rawHistory.filter(isSeenOnDocumentEntry) : [];
  // An address already remembered under the same text is moved to the front, not stacked: the
  // same shop alternating between two spellings would otherwise fill all five slots with two
  // values and push out the ones worth keeping.
  const appended = input.appendToHistory;
  const history = (appended
    ? [appended, ...existing.filter((entry) => normalizeThaiAddress(entry.addressText) !== normalizeThaiAddress(appended.addressText))]
    : existing
  )
    // History means "the OTHER addresses seen on documents". Whatever is becoming the primary is no
    // longer one of them — without this, promoting an address from the card leaves it listed twice,
    // once as the primary and once under it, and the "ใช้อันนี้เป็นหลัก" button stays on the row
    // that is already primary.
    .filter((entry) => normalizeThaiAddress(entry.addressText) !== normalizeThaiAddress(input.addressText))
    .slice(0, MAX_SEEN_ON_DOCUMENTS);

  return {
    addressText: input.addressText,
    postalCode: input.postalCode ?? null,
    ...(structured ? { structured } : {}),
    // A4: the lock belongs to the counterparty, not to whichever write last rebuilt this JSON.
    // Carried forward like `structured`, or every auto-save would quietly unlock a registry the
    // owner locked on purpose — exactly the silent behaviour change D5 forbids. Only the
    // counterparty screen's switch clears it.
    ...(previous?.locked === true ? { locked: true } : {}),
    provenance: {
      source: input.source,
      ...(input.expenseId ? { expenseId: input.expenseId } : {}),
      userId: input.userId,
      at: input.at,
    },
    ...(history.length > 0 ? { seenOnDocuments: history } : {}),
  };
}

/**
 * §7 cases a-d, plus the locked variant of case c (A4). `matched` alone decides a/CREATE — a
 * brand new counterparty always takes whatever address the document has, even none. Otherwise:
 * no registry address yet is b/FILL; the same address (or no document address to compare against)
 * is a no-op; a genuinely different address is c/HISTORY, where A4 makes the latest reviewed
 * address win unless the registry is locked. The caller derives which text is the displaced one
 * from `promoteToPrimary` (`true` -> the old registry text is the one pushed to history, because
 * the document's text replaced it; `false` -> the document's text is, because it lost to a locked
 * primary).
 */
export function decideVendorAutoSave(input: {
  matched: boolean;
  registryAddressText: string | null;
  documentAddressText: string | null;
  locked: boolean;
}): { case: 'CREATE' | 'FILL' | 'HISTORY' | 'NOOP'; promoteToPrimary: boolean; appendToHistory: boolean } {
  if (!input.matched) {
    return { case: 'CREATE', promoteToPrimary: true, appendToHistory: false };
  }

  const registryText = input.registryAddressText?.trim() || null;
  const documentText = input.documentAddressText?.trim() || null;

  if (!registryText) {
    return { case: 'FILL', promoteToPrimary: Boolean(documentText), appendToHistory: false };
  }

  if (!documentText || normalizeThaiAddress(registryText) === normalizeThaiAddress(documentText)) {
    return { case: 'NOOP', promoteToPrimary: false, appendToHistory: false };
  }

  return input.locked
    ? { case: 'HISTORY', promoteToPrimary: false, appendToHistory: true }
    : { case: 'HISTORY', promoteToPrimary: true, appendToHistory: true };
}
