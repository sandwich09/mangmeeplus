import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import Decimal from 'decimal.js';
import {
  EXPENSE_LINE_CHARGE_KIND_LABELS,
  RECEIPT_ADDITIONAL_CHARGE_KINDS,
  RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
  todayCivilDate,
  type ExpenseLineChargeKind,
  type ExpenseVatMode,
  type ExpenseVatCaptureSnapshotV1,
  type ExpenseVatSourceInput,
  type ExpenseWhtCapture,
  type ReceiptOcrAdditionalCharge,
  type ReceiptOcrFieldResult,
  validateExpenseWhtInput,
} from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { reconcileExpenseDuplicateCandidates } from './expense-duplicate-detection';
import { calcDocumentTotals, calcLineTotals } from '../../domain/logic/expense-totals.logic';
import { reconcileExpenseVat, vatSourceFromSnapshot } from '../../domain/logic/expense-vat-reconciliation.logic';
import { applyExpenseWhtInput, expenseWhtLineRate } from '../../domain/logic/expense-wht-input.logic';

export function toMoney4(value: string | undefined | null): string {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n.toFixed(4) : '0.0000';
}

function validDate(value: string | undefined | null): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function validVatMode(value: string | undefined): 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW' | undefined {
  return value === 'NO_VAT' || value === 'VAT_INCLUDED' || value === 'VAT_EXCLUDED' || value === 'EXEMPT' || value === 'NEEDS_REVIEW' ? value : undefined;
}

/** Spec §5.1/§5.2: the reasons this service can raise, in the words the reviewer reads. They travel
 *  back on the outcome instead of being written here, because the LINE and web capture paths each
 *  compose (and overwrite) `aiVerificationSummaryJson` after this service returns. */
export const RECEIPT_REVIEW_REASONS = {
  dateUnverified: 'วันที่บนเอกสารยังอ่านไม่ได้ – ใช้วันที่ส่งไว้ก่อน',
  dateImplausible: 'วันที่ผิดปกติ',
  chargeVatUnknown: 'ค่าใช้จ่ายเพิ่มยังไม่รู้ VAT – ตรวจก่อนยืนยัน',
  whtWithCharges: 'ตรวจฐานหัก ณ ที่จ่ายกับค่าบริการ',
} as const;

/** How far a printed date may sit from today before it is evidence of a misread rather than a date.
 *  A receipt can be issued a day ahead across a timezone, never a year ahead; and a bill older than
 *  two years is outside every filing window this ERP works in, so it is worth a human look. */
const DATE_MAX_FUTURE_DAYS = 1;
const DATE_MAX_PAST_YEARS = 2;

export type ReceiptDateReview = { verified: boolean; reason?: string };

/**
 * Spec §5.2. `ExpenseRecord.expenseDate` is NOT NULL, so a receipt whose date nobody could read
 * still carries the day it was sent. That placeholder is fine; passing it off as a reading is not.
 * UAT 2026-09-03: a bill printing 03/09/69 was stored with today's date while the LINE card said
 * "วันที่: ยังไม่ระบุ", and no field anywhere held both facts at once.
 */
export function reviewReceiptDate(expenseDate: string | undefined, todayIso: string): ReceiptDateReview {
  const read = validDate(expenseDate);
  if (!read) return { verified: false, reason: RECEIPT_REVIEW_REASONS.dateUnverified };
  const today = validDate(todayIso);
  if (!today) return { verified: true };
  const latest = new Date(today.getTime() + DATE_MAX_FUTURE_DAYS * 86_400_000);
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - DATE_MAX_PAST_YEARS);
  return read > latest || read < earliest
    ? { verified: false, reason: RECEIPT_REVIEW_REASONS.dateImplausible }
    : { verified: true };
}

const VAT_TOLERANCE = 0.05;
const MAX_IMPLIED_VAT_RATE = 0.2;
const MAX_OCR_ADDITIONAL_CHARGES = 10;
// Mirrors the gateway prompt bound; past this the item block is a catalogue, not an expense.
const MAX_OCR_ITEM_LINES = 40;

/** A printed money figure that may legitimately be zero: a free or included item row. The expense
 *  model already allows a zero unit price ("the general expense flow supports free-of-charge lines"),
 *  so rejecting the row here only served to delete the breakdown around it. */
function nonNegativeMoney(value: string | undefined): number | undefined {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function positiveMoney(value: string | undefined): number | undefined {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A VAT rate as the contracts express it: a decimal fraction in [0,1), e.g. "0.07" or "0". */
function isUnitFraction(value: string | undefined): boolean {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1;
}

export function ocrVatSource(fields: ReceiptOcrFieldResult): ExpenseVatSourceInput {
  const rawRate = Number(String(fields.vatRate ?? '').replace(/,/g, ''));
  const rawAmount = Number(String(fields.vatAmount ?? '').replace(/,/g, ''));
  const hasRate = typeof fields.vatRate === 'string' && fields.vatRate.trim() !== ''
    && Number.isFinite(rawRate) && rawRate >= 0 && rawRate < 1;
  const hasAmount = typeof fields.vatAmount === 'string' && fields.vatAmount.trim() !== ''
    && Number.isFinite(rawAmount) && rawAmount >= 0;
  return {
    inputType: hasRate && hasAmount ? 'BOTH' : hasRate ? 'RATE' : hasAmount ? 'AMOUNT' : 'NONE',
    ...(hasRate && { vatRatePercent: (rawRate * 100).toFixed(4) }),
    ...(hasAmount && { vatAmount: rawAmount.toFixed(2) }),
  };
}

function saneVat(vat: number, taxable: number): boolean {
  return vat > 0 && taxable > 0 && vat / taxable <= MAX_IMPLIED_VAT_RATE;
}

/** Spec §19i decision 2: a discount is carried only when the document's own printed figures prove
 *  it. The summary line folds `discountAmount` back into the pre-discount unit price
 *  (`deriveLineSubtotal` = charged base + discount), so a positive add-on item misread as a
 *  discount invents a unit price the slip never printed — the reported Starbucks slip turned its
 *  ฿20.00 extra shot into a ฿20.00 discount and a ฿200.00 unit price. The proof is the printed
 *  pre-discount subtotal: `subtotal − discount + additionalCharges` must reach the charged base
 *  (the ex-VAT base when VAT is added on top, otherwise the total). A discount the printed
 *  arithmetic contradicts is corrected to what those figures imply; one nothing can prove is
 *  dropped. Either way the recorded total is unchanged — the line nets back to the charged base
 *  whatever the discount is, so only the reviewer-visible split moves. */
export function verifyDiscountAmount(fields: ReceiptOcrFieldResult): ReceiptOcrFieldResult {
  // A slip prints its discount negative ("Total Discount -15.00") and the prompt reads that sign as
  // the marker, so the amount arrives either way while the stored field is always a magnitude.
  const printed = Number(String(fields.discountAmount ?? '').replace(/,/g, ''));
  const discount = Number.isFinite(printed) && printed !== 0 ? Math.abs(printed) : undefined;
  if (discount === undefined) return fields;
  const subtotal = positiveMoney(fields.subtotalAmount);
  const grand = positiveMoney(fields.grandTotalAmount);
  const vat = positiveMoney(fields.vatAmount);
  const base = fields.vatMode === 'VAT_EXCLUDED'
    ? positiveMoney(fields.taxableAmount) ?? (grand !== undefined && vat !== undefined ? grand - vat : undefined)
    : grand;
  const charges = (fields.additionalCharges ?? []).reduce((sum, charge) => sum + (positiveMoney(charge.amount) ?? 0), 0);
  const implied = subtotal !== undefined && base !== undefined ? subtotal + charges - base : undefined;
  if (implied !== undefined && Math.abs(implied - discount) <= VAT_TOLERANCE) {
    return printed > 0 ? fields : { ...fields, discountAmount: discount.toFixed(2) };
  }
  const out = { ...fields };
  if (implied !== undefined && implied > VAT_TOLERANCE && implied <= subtotal!) out.discountAmount = implied.toFixed(2);
  else delete out.discountAmount;
  return out;
}

/** Spec §19c decision 4: deterministic completion, not AI invention. When exactly one of
 *  base/VAT/total is missing, the other two printed values complete it by arithmetic, and the
 *  line rate is the printed rate when consistent, else vat/taxable. Inconsistent triples are
 *  left exactly as extracted so the existing mismatch warnings still fire. */
export function completeVatFields(fields: ReceiptOcrFieldResult): ReceiptOcrFieldResult {
  const out: ReceiptOcrFieldResult = { ...fields };
  let taxable = positiveMoney(fields.taxableAmount);
  let vat = positiveMoney(fields.vatAmount);
  let grand = positiveMoney(fields.grandTotalAmount);
  if (taxable && vat && grand && Math.abs(taxable + vat - grand) > VAT_TOLERANCE) return out;

  if (taxable && grand && !vat && saneVat(grand - taxable, taxable)) {
    vat = grand - taxable;
    out.vatAmount = vat.toFixed(2);
  } else if (vat && grand && !taxable && saneVat(vat, grand - vat)) {
    taxable = grand - vat;
    out.taxableAmount = taxable.toFixed(2);
  } else if (taxable && vat && !grand && saneVat(vat, taxable)) {
    grand = taxable + vat;
    out.grandTotalAmount = grand.toFixed(2);
  }

  const printed = Number.parseFloat(String(fields.vatRate ?? ''));
  const hasPerChargeVatTreatment = fields.additionalCharges?.some((charge) => charge.vatRate !== undefined) ?? false;
  // Spec §19g decision 2: `printed >= 0` — a printed zero rate is a zero-rated supply and must
  // survive here, or §19f decision 3 only held because the old `defaultLineVatRate` fallback
  // happened to re-add a '0'. A printed 0 contradicted by a non-zero VAT amount still falls through
  // to the derived rate below, because the consistency test rejects it.
  const printedUsable = Number.isFinite(printed) && printed >= 0 && printed < 1
    && (hasPerChargeVatTreatment || !taxable || !vat || Math.abs(taxable * printed - vat) <= VAT_TOLERANCE);
  // A derived rate is only a rate while the implied ratio is sane — otherwise the pair is a
  // misread, and stamping vat/taxable on the line would re-inflate it on the next recompute.
  const derived = taxable && vat && saneVat(vat, taxable) ? Number((vat / taxable).toFixed(4)) : undefined;
  const rate = printedUsable ? printed : derived;
  if (rate === undefined) delete out.vatRate;
  else out.vatRate = (Math.abs(rate - 0.07) <= 0.002 ? 0.07 : rate).toFixed(4);

  const provenVat = Boolean(taxable && vat && grand && Math.abs(taxable + vat - grand) <= VAT_TOLERANCE);
  if (provenVat && (!validVatMode(out.vatMode) || out.vatMode === 'NO_VAT')) out.vatMode = 'VAT_EXCLUDED';
  // Only a proven base+VAT=total triple makes taxableAmount the subtotal: without it the line
  // unit price would be derived from a base that does not explain the total (deriveUnitPrice),
  // and the next review save would recompute the document DOWN to that base.
  if (provenVat && !out.subtotalAmount && out.taxableAmount) out.subtotalAmount = out.taxableAmount;
  return out;
}

/** Keep the printed amount, never a rate inferred from it. OCR fields use fractional rates. */
export function ocrWhtInput(fields: ReceiptOcrFieldResult): ExpenseWhtCapture | null {
  for (const [inputType, raw] of [['AMOUNT', fields.whtAmount], ['RATE', fields.whtRate]] as const) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    try {
      const number = new Decimal(raw.replace(/,/g, ''));
      const value = inputType === 'RATE' ? number.mul(100) : number;
      if (!value.isFinite() || value.decimalPlaces() > 2) continue;
      const input = { inputType, value: value.toFixed(2) };
      if (!validateExpenseWhtInput(input)) return { ...input, origin: 'OCR' };
    } catch { /* Invalid OCR evidence stays raw; it cannot authorize a money mutation. */ }
  }
  return null;
}

function deriveLineSubtotal(fields: ReceiptOcrFieldResult, lineTotal: string, lineVatRate: string | null): number {
  const discount = Number(toMoney4(fields.discountAmount));
  const taxable = positiveMoney(fields.taxableAmount);
  if (fields.vatMode === 'VAT_EXCLUDED') {
    const gross = Number(toMoney4(fields.grandTotalAmount ?? lineTotal));
    const printedRate = Number.parseFloat(String(lineVatRate ?? ''));
    const vat = positiveMoney(fields.vatAmount);
    const derivedRate = taxable && vat ? vat / taxable : undefined;
    const rate = Number.isFinite(printedRate) && printedRate >= 0 && printedRate < 1
      ? printedRate
      : derivedRate && derivedRate > 0 && derivedRate < 1
        ? derivedRate
        : vat ? 0.07 : 0;
    if (taxable && Math.abs(taxable + Math.round(taxable * rate * 100) / 100 - gross) <= VAT_TOLERANCE) {
      return taxable + discount;
    }
    const center = Math.round((gross / (1 + rate)) * 100);
    let best = center / 100;
    let bestDifference = Number.POSITIVE_INFINITY;
    for (let cents = center - 5; cents <= center + 5; cents += 1) {
      const candidate = cents / 100;
      const candidateGross = candidate + Math.round(candidate * rate * 100) / 100;
      const difference = Math.abs(candidateGross - gross);
      if (difference < bestDifference) {
        best = candidate;
        bestDifference = difference;
      }
    }
    return best + discount;
  }
  if (fields.grandTotalAmount) return Number(toMoney4(fields.grandTotalAmount)) + discount;
  return Number(toMoney4(lineTotal));
}

function deriveUnitPrice(fields: ReceiptOcrFieldResult, lineTotal: string, lineVatRate: string | null): string {
  const qty = Number(toMoney4(fields.quantity ?? '1')) || 1;
  const modelUnit = Number(toMoney4(fields.unitPrice));
  // The review form recomputes from quantity × unit price. Use the amount that explains the
  // paid total so printed service charges/surcharges cannot disappear on the next save.
  const subtotal = deriveLineSubtotal(fields, lineTotal, lineVatRate);
  if (modelUnit > 0 && Math.abs((modelUnit * qty) - subtotal) < 0.05) return modelUnit.toFixed(4);
  return (subtotal / qty).toFixed(4);
}

/**
 * The single line's amount when the page printed no grand total. `subtotalAmount` alone under-totals
 * a bill that prints its charges separately — a restaurant slip reading 1,520 + 152 service charge
 * with no "TOTAL" box recorded 1,520 and the service charge vanished. Rebuild it the way §5.1 says
 * the record adds up: goods − discount + charges (+ VAT when the page printed one).
 */
export function receiptFallbackLineTotal(fields: ReceiptOcrFieldResult): string | undefined {
  if (fields.grandTotalAmount) return fields.grandTotalAmount;
  const subtotal = positiveMoney(fields.subtotalAmount);
  if (subtotal === undefined) return undefined;
  const charges = (Array.isArray(fields.additionalCharges) ? fields.additionalCharges : [])
    .reduce((sum, charge) => sum + (Number(toMoney4(charge.amount)) || 0), 0);
  // VAT_INCLUDED already has the tax inside the printed figures; adding it again double-counts.
  const vat = validVatMode(fields.vatMode) === 'VAT_INCLUDED' ? 0 : nonNegativeMoney(fields.vatAmount) ?? 0;
  const total = subtotal - (nonNegativeMoney(fields.discountAmount) ?? 0) + charges + vat;
  return total > 0 ? total.toFixed(4) : undefined;
}

export type ReceiptChargeReconciliationStatus =
  | 'SUMMARY_LINE'
  | 'RECONCILED_ITEM_LINES'
  | 'RECONCILED_CHARGE_LINES'
  | 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW'
  /** The page printed item rows that do NOT add up to its own total. Folding them into one summary
   *  line is still the right record — the printed total is what was paid — but the disagreement is
   *  the first thing an accountant checks, and it used to disappear here without a word. A real
   *  2026-08-28 example: a หจก. cash bill whose rows read 260+350+300+130=1,040 while the total box
   *  was confirmed by a person as 7,040. One of the two is wrong and nobody was ever told. */
  | 'ITEMS_DID_NOT_RECONCILE';

type PreparedOcrLine = {
  description: string;
  /** Set only on an additional-charge row (spec S-1); product rows leave it null. */
  chargeKind?: ExpenseLineChargeKind | null;
  quantity: string;
  unitPrice: string;
  vatRate: string | null;
  /** ZERO_RATED / EXEMPT / NON_VAT when the page marked this row untaxed; null otherwise. */
  vatTreatment?: string | null;
  whtRate: string | null;
  /** The row carries a tax position the document did not prove, so it must not read as reviewed. */
  needsReview?: boolean;
  sourceLineText?: string;
  aiLineConfidence?: number;
  totals: ReturnType<typeof calcLineTotals>;
};

/**
 * Spec §5.1: an additional-charge row is named in Thai by its kind, keeping the percent the document
 * printed when the extractor read one ("ค่าบริการ 10%"). The percent may be in either field — the
 * extractor sometimes puts it in its own wording ("Service charge 10%") and sometimes only in the
 * quoted span — so both are read, description first.
 */
function chargeDescription(charge: ReceiptOcrAdditionalCharge): string {
  const label = EXPENSE_LINE_CHARGE_KIND_LABELS[charge.kind];
  const percent = /(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(`${charge.description} ${charge.evidenceSignal}`)?.[1];
  return percent ? `${label} ${percent}%` : label;
}

/**
 * Renaming the row in Thai must not lose what the extractor called it, so `sourceLineText` — the
 * same column an item row uses for its own source text — carries whichever of the two says more.
 * The quoted OCR span usually reproduces the printed row ("Service charge 100.00") and therefore
 * already contains the wording plus the amount; when it does not, the extractor's own wording
 * ("Service charge 10%") is the only place the row's printed name survives. Either way the whole
 * raw extractor result is still stored verbatim in `aiVerifiedFieldsJson` for provenance.
 */
function chargeSourceLineText(charge: ReceiptOcrAdditionalCharge): string {
  const wording = charge.description.trim();
  const span = charge.evidenceSignal.trim();
  return span.includes(wording) ? span : wording || span;
}

function documentVatMode(fields: ReceiptOcrFieldResult): ExpenseVatMode {
  return validVatMode(fields.vatMode) ?? 'NO_VAT';
}

// Spec §19g decision 1: when the document neither printed a rate nor proved one, the rate is
// unknown and stays null. Writing '0' here asserted a zero-rated supply on every slip whose VAT
// the model simply failed to read, dropping the whole gross into taxableAmount. An extracted
// rate — including an explicit '0' per §19f decision 3 — is data and passes through unchanged.
function defaultLineVatRate(fields: ReceiptOcrFieldResult): string | null {
  if (documentVatMode(fields) === 'NO_VAT' || documentVatMode(fields) === 'EXEMPT') return null;
  return fields.vatRate ?? (positiveMoney(fields.vatAmount) ? '0.0700' : null);
}

/** Spec §19g decision 1: true when the applied draft asserts VAT but carries no rate to compute it
 *  with, so the review UI must ask for one. Runs the same completion the apply path runs, because a
 *  rate the arithmetic proves is not missing. */
export function ocrLineVatRateUnknown(fields: ReceiptOcrFieldResult): boolean {
  const completed = completeVatFields(fields);
  const mode = documentVatMode(completed);
  return (mode === 'VAT_INCLUDED' || mode === 'VAT_EXCLUDED') && defaultLineVatRate(completed) === null;
}

/** Spec §5.1: an additional-charge row's VAT is what the page printed — the row's own rate, or the
 *  document's. The one thing it may never be is the 7% `defaultLineVatRate` invents when a VAT
 *  amount was printed but no rate: that turns an unread number into a tax position on a line nobody
 *  read, and a service charge is exactly where a wrong base changes what the company can claim. */
function chargeVatUnproven(charge: { vatRate?: string }, fields: ReceiptOcrFieldResult): boolean {
  if (charge.vatRate !== undefined) return false;
  const mode = documentVatMode(fields);
  if (mode === 'NO_VAT' || mode === 'EXEMPT') return false;
  return fields.vatRate === undefined;
}

/** Spec §5.1 says `ROUNDING` is the one kind a document may print negative, and every other kind
 *  must be positive. Only the second half is enforceable here: `calcLineTotals` clamps a document
 *  discount with `min(discount, lineSubtotal)`, which on a negative subtotal cancels the row to
 *  zero — so a negative rounding line would be silently dropped from the total rather than applied.
 *  ponytail: keep the protective half; a negative row needs `calcLineTotals` to stop clamping
 *  against a negative subtotal, which is a shared money path and belongs with the `chargeKind`
 *  column (slice B), not here. Until then a rounding line the page printed negative stays a
 *  reviewer's edit, and the record's total is the printed total either way.
 *
 *  ponytail: `positiveMoney` unchanged, add negative ROUNDING when `calcLineTotals` handles it. */
function summaryLineVatRate(fields: ReceiptOcrFieldResult): string | null {
  const fallback = defaultLineVatRate(fields);
  if (documentVatMode(fields) !== 'VAT_EXCLUDED') return fallback;
  const grand = positiveMoney(fields.grandTotalAmount);
  const vat = positiveMoney(fields.vatAmount);
  const taxable = positiveMoney(fields.taxableAmount);
  if (!grand || !vat || grand <= vat) return fallback;
  if (taxable && Math.abs(taxable + vat - grand) <= VAT_TOLERANCE) return fallback;
  return (vat / (grand - vat)).toFixed(4);
}

function prepareLine(
  input: Omit<PreparedOcrLine, 'totals'>,
  vatMode: ExpenseVatMode,
  discountAmount = '0',
): PreparedOcrLine {
  return {
    ...input,
    totals: calcLineTotals({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discountAmount,
      vatRate: input.vatRate,
      whtRate: input.whtRate,
      vatMode,
    }),
  };
}

function closeEnough(actual: string, expected: string | undefined): boolean {
  if (!expected) return true;
  return Math.abs(Number(actual) - Number(toMoney4(expected))) <= VAT_TOLERANCE;
}

/** A breakdown may replace the summary line only when it reproduces the document's own printed
 *  totals, so a misread row can never change what the company recorded. Returns the reconciled
 *  totals, or null when the candidate contradicts the document. */
function reconciledTotals(
  candidate: PreparedOcrLine[],
  fields: ReceiptOcrFieldResult,
): ReturnType<typeof calcDocumentTotals> | null {
  const totals = calcDocumentTotals({ lines: candidate.map((line) => ({ ...line.totals, chargeKind: line.chargeKind ?? null })) });
  // Mixed per-line VAT rates make the document's single printed taxable base incomparable.
  const taxableIsComparable = new Set(candidate.map((line) => line.vatRate ?? '')).size <= 1;
  const ok = closeEnough(totals.grandTotalAmount, fields.grandTotalAmount)
    && (!taxableIsComparable || closeEnough(totals.taxableAmount, fields.taxableAmount))
    && closeEnough(totals.vatAmount, fields.vatAmount);
  return ok ? totals : null;
}

/** Spec §5: the extracted item block, re-validated here because the gateway is a separate service
 *  and its output is a suggestion, never a trusted contract. */
export function usableItemLines(fields: ReceiptOcrFieldResult): NonNullable<ReceiptOcrFieldResult['lines']> {
  const lines = fields.lines;
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > MAX_OCR_ITEM_LINES) return [];
  const usable = lines.filter((line) => Boolean(
    line
    && typeof line.description === 'string' && line.description.trim() && line.description.length <= 200
    // Zero is a printed amount, not a missing one — and since a single rejected row discards the
    // whole block below, treating a 0.00 modifier as malformed cost the bill its entire breakdown.
    && typeof line.amount === 'string' && line.amount.trim() !== '' && nonNegativeMoney(line.amount) !== undefined
    && (line.unitPrice === undefined || nonNegativeMoney(line.unitPrice) !== undefined)
    && (line.quantity === undefined || positiveMoney(line.quantity))
    // Per-row VAT is re-checked here, not trusted: a rate must be a real 0..1 fraction, and a
    // treatment is only meaningful together with a zero rate (the same pairing the web draft
    // validator enforces). Anything malformed drops the whole item block to the summary path.
    && (line.vatRate === undefined || isUnitFraction(line.vatRate))
    && (line.vatTreatment === undefined
      || (['ZERO_RATED', 'EXEMPT', 'NON_VAT'].includes(line.vatTreatment) && line.vatRate !== undefined && Number(line.vatRate) === 0)),
  ));
  // Half a bill is not a breakdown of the bill; drop the whole set rather than record a partial one.
  return usable.length === lines.length ? usable : [];
}

function prepareOcrLines(
  fields: ReceiptOcrFieldResult,
  lineTotal: string,
): {
  status: ReceiptChargeReconciliationStatus;
  lines: PreparedOcrLine[];
  totals: ReturnType<typeof calcDocumentTotals>;
  chargesApplied: number;
  /** Set only with ITEMS_DID_NOT_RECONCILE: what the printed rows actually add up to. */
  itemsSumAmount?: string;
  /** Spec §5.1 review reasons the charge rules raised, in the reviewer's words. */
  chargeReviewReasons: string[];
} {
  const vatMode = documentVatMode(fields);
  const whtRate = expenseWhtLineRate(ocrWhtInput(fields));
  const hadChargeSuggestions = Array.isArray(fields.additionalCharges) && fields.additionalCharges.length > 0;
  const charges = Array.isArray(fields.additionalCharges) && fields.additionalCharges.length <= MAX_OCR_ADDITIONAL_CHARGES
    ? fields.additionalCharges.filter((charge) => {
        const amount = positiveMoney(charge.amount);
        const rate = charge.vatRate === undefined ? undefined : Number(charge.vatRate);
        return Boolean(
          amount
          && charge.amount.length <= 32
          && charge.description.trim() && charge.description.length <= 120
          && charge.evidenceSignal.trim() && charge.evidenceSignal.length <= 120
          && RECEIPT_ADDITIONAL_CHARGE_KINDS.includes(charge.kind)
          && (rate === undefined || (Number.isFinite(rate) && rate >= 0 && rate < 1)),
        );
      })
    : [];
  const printedSubtotal = positiveMoney(fields.subtotalAmount);
  const chargeVatUnknown = charges.some((charge) => chargeVatUnproven(charge, fields));
  const chargeReviewReasons = charges.length === 0 ? [] : [
    ...(chargeVatUnknown ? [RECEIPT_REVIEW_REASONS.chargeVatUnknown] : []),
    // Spec §5.1: withholding is computed on a base the payer and payee agreed, and a service charge
    // is not automatically part of it. Nothing here decides that — it asks the person who can.
    ...(ocrWhtInput(fields) ? [RECEIPT_REVIEW_REASONS.whtWithCharges] : []),
  ];
  const chargeLines = () => charges.map((charge) => prepareLine({
    description: chargeDescription(charge),
    chargeKind: charge.kind,
    quantity: '1.0000',
    unitPrice: toMoney4(charge.amount),
    vatRate: chargeVatUnproven(charge, fields) ? null : charge.vatRate ?? defaultLineVatRate(fields),
    // Spec §5.1: never spread the document's WHT rate onto a charge row. Doing so withheld tax on a
    // base nobody computed — and on a ROUNDING row, on money that was never a payment at all.
    whtRate: null,
    needsReview: chargeVatUnproven(charge, fields),
    sourceLineText: chargeSourceLineText(charge),
    aiLineConfidence: charge.confidence,
  }, vatMode));

  // Spec §5/§569: one draft line per printed item row when the document's own arithmetic proves the
  // split, so a two-item bill stops collapsing into a single "AI สรุปยอดรวม" line. Tried before the
  // charge branch because an item breakdown supersedes it — the charge lines ride along either way.
  const items = usableItemLines(fields);
  if (items.length >= 2) {
    const candidate = [
      ...items.map((item, index) => {
        const qty = positiveMoney(item.quantity) ?? 1;
        const amount = positiveMoney(item.amount)!;
        const printedUnit = positiveMoney(item.unitPrice);
        // Thai bills print the row's extended amount far more often than its unit price, so the
        // printed unit price is kept only when it explains that amount; otherwise it is derived.
        const unitPrice = printedUnit && Math.abs(printedUnit * qty - amount) <= VAT_TOLERANCE
          ? printedUnit
          : amount / qty;
        return prepareLine({
          description: item.description.trim(),
          quantity: qty.toFixed(4),
          unitPrice: unitPrice.toFixed(4),
          // The document rate is the default, not the law: a row the page itself marked as taxed
          // or exempt keeps its own rate. Mixed bills reconcile through calcDocumentTotals below,
          // which compares the summed VAT against the printed VAT and rejects the split if they
          // disagree — so a wrong per-row reading cannot silently become an accounting record.
          vatRate: item.vatRate ?? defaultLineVatRate(fields),
          vatTreatment: item.vatTreatment ?? null,
          whtRate,
          sourceLineText: item.evidenceSignal,
          aiLineConfidence: item.confidence,
          // A document-level discount has no printed row to sit on, so it lands on the first item
          // and `calcLineTotals` clamps it there; when that clamp loses part of it the totals stop
          // matching and the whole split falls back to the summary line below.
        }, vatMode, index === 0 ? toMoney4(fields.discountAmount) : '0');
      }),
      ...chargeLines(),
    ];
    const totals = reconciledTotals(candidate, fields);
    if (totals) return { status: 'RECONCILED_ITEM_LINES', lines: candidate, totals, chargesApplied: charges.length, chargeReviewReasons };
  }

  if (charges.length > 0 && printedSubtotal) {
    const qty = positiveMoney(fields.quantity) ?? 1;
    const modelUnit = positiveMoney(fields.unitPrice);
    const baseUnit = modelUnit && Math.abs(modelUnit * qty - printedSubtotal) <= VAT_TOLERANCE
      ? modelUnit
      : printedSubtotal / qty;
    const candidate = [
      prepareLine({
        description: fields.description ?? 'รายการตามใบเสร็จ (AI สรุปยอดรวม)',
        quantity: qty.toFixed(4),
        unitPrice: baseUnit.toFixed(4),
        vatRate: defaultLineVatRate(fields),
        whtRate,
      }, vatMode, toMoney4(fields.discountAmount)),
      ...chargeLines(),
    ];
    const totals = reconciledTotals(candidate, fields);
    if (totals) return { status: 'RECONCILED_CHARGE_LINES', lines: candidate, totals, chargesApplied: charges.length, chargeReviewReasons };
  }

  const summaryVatRate = summaryLineVatRate(fields);
  const summary = prepareLine({
    description: fields.description ?? 'รายการตามใบเสร็จ (AI สรุปยอดรวม)',
    quantity: toMoney4(fields.quantity ?? '1'),
    unitPrice: deriveUnitPrice(fields, lineTotal, summaryVatRate),
    vatRate: summaryVatRate,
    whtRate,
  }, vatMode, toMoney4(fields.discountAmount));
  // Rows that were readable but would not reconcile outrank a folded charge: the arithmetic on the
  // page contradicts itself, which is a stronger signal than a charge the split could not place.
  const itemsSum = items.length >= 2
    ? items.reduce((sum, item) => sum + (positiveMoney(item.amount) ?? 0), 0)
    : undefined;
  return {
    status: itemsSum !== undefined
      ? 'ITEMS_DID_NOT_RECONCILE'
      : hadChargeSuggestions ? 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW' : 'SUMMARY_LINE',
    lines: [summary],
    totals: calcDocumentTotals({ lines: [summary.totals] }),
    chargesApplied: 0,
    // No charge line survived, so the charge rules have nothing to say — the folded status above is
    // already the louder signal, and repeating it as a second reason only crowds the review banner.
    chargeReviewReasons: [],
    // Carried so the reviewer is shown the two numbers, not merely told they disagree.
    ...(itemsSum !== undefined ? { itemsSumAmount: itemsSum.toFixed(2) } : {}),
  };
}

type ReceiptCategoryFallback = {
  expenseCategoryId: string;
  confidence: number;
};

/** Spec S1-R4: the AI's category for the document, resolved against the company's ACTIVE catalogue
 *  and returned whatever the confidence. Below `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE` it is a
 *  recommendation the reviewer must accept, never a value the server wrote — `categoryAutoFilled`
 *  is the only thing that says the category was applied. */
export type ReceiptCategorySuggestion = {
  expenseCategoryId: string;
  confidence: number;
  categoryName: string;
};

type AppliedReceiptCategory = {
  categoryId: string | null;
  categoryName: string | null;
  categoryAutoFilled: boolean;
  categorySuggestion?: ReceiptCategorySuggestion;
};

type AppliedReceiptResult = AppliedReceiptCategory & {
  chargeReconciliationStatus: ReceiptChargeReconciliationStatus;
  /** Only with ITEMS_DID_NOT_RECONCILE: what the printed rows add up to, for the reviewer to compare. */
  itemsSumAmount?: string;
  chargesApplied: number;
  /** Spec §5.1/§5.2: readable reasons this draft must be reviewed, for the caller to put in
   *  `aiVerificationSummaryJson` and in its own reply. Returned rather than written here because
   *  both capture paths compose that JSON themselves after this service returns. */
  reviewReasons: string[];
  /** Spec §5.2: false when the stored `expenseDate` is the upload-day placeholder rather than a date
   *  read off the document, or is so far from today that it reads as a misreading. */
  dateVerified: boolean;
};

/** The applied result, or — when the record moved under the OCR round trip — the same shape with
 *  `staleSkipped` set and nothing written. One shape rather than a union so every existing caller
 *  and fixture keeps compiling; `isStaleOcrApply` is the only correct way to read it. */
export type ReceiptOcrApplyOutcome = { candidatesCreated: number; staleSkipped?: true } & AppliedReceiptResult;

export function isStaleOcrApply(outcome: ReceiptOcrApplyOutcome): boolean {
  return outcome.staleSkipped === true;
}

@Injectable()
export class ReceiptOcrApplyService {
  private readonly logger = new Logger(ReceiptOcrApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: PrismaExpenseRepository,
  ) {}

  /**
   * `expectedUpdatedAt` is the record version read BEFORE the external OCR call. The model round
   * trip takes seconds, and a LINE correction can land inside it — applying a result computed
   * from the pre-correction record would silently undo the user's edit. When the version moved,
   * nothing in the write set lands and the caller is told `stale_skipped` so it also skips its
   * own follow-up summary write.
   */
  async apply(
    ctx: { companyId: string; userId: string; scopes?: { branchIds?: string[] } },
    expenseId: string,
    fields: ReceiptOcrFieldResult,
    options: { fallbackCategorySuggestion?: ReceiptCategoryFallback; expectedUpdatedAt?: Date; todayIso?: string } = {},
  ): Promise<ReceiptOcrApplyOutcome> {
    const completed = completeVatFields(verifyDiscountAmount(fields));
    const lineTotal = receiptFallbackLineTotal(completed);
    let prepared = lineTotal ? prepareOcrLines(completed, lineTotal) : null;
    const dateReview = reviewReceiptDate(completed.expenseDate, options.todayIso ?? todayCivilDate());
    const reviewReasons = [
      ...(dateReview.reason ? [dateReview.reason] : []),
      ...(prepared?.chargeReviewReasons ?? []),
    ];
    const data: Record<string, unknown> = {
      // Spec §5.2: an unread date is not a partial read, it is a value nobody has confirmed. Leaving
      // this at PARTIAL let a draft carrying the upload day pass as if the page had been read.
      aiVerificationStatus: reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'PARTIAL',
      aiVerifiedFieldsJson: fields, // provenance: the original AI output, never the completed one
      aiVerificationConfidence: fields.confidence,
      aiVerifiedAt: new Date(),
      updatedByUserId: ctx.userId,
    };
    if (completed.vendorName) data['vendorNameSnapshot'] = completed.vendorName;
    if (completed.vendorTaxId) data['vendorTaxIdSnapshot'] = completed.vendorTaxId;
    if (completed.vendorBranchCode) data['vendorBranchCodeSnapshot'] = completed.vendorBranchCode;
    if (completed.documentNumber) data['vendorDocumentNumber'] = completed.documentNumber;
    const date = validDate(completed.expenseDate);
    if (date) data['expenseDate'] = date;
    const vatMode = validVatMode(completed.vatMode);
    if (vatMode) data['vatMode'] = vatMode;
    const appliedCategory = await this.prisma.client.$transaction(async (tx): Promise<AppliedReceiptResult | 'stale'> => {
      const currentExpense = await tx.expenseRecord.findFirst({
        where: { id: expenseId, companyId: ctx.companyId },
        select: {
          expenseCategoryId: true,
          updatedAt: true,
          vatCaptureSnapshotJson: true,
          whtInputJson: true,
          lines: { select: { whtRate: true, vatTreatment: true } },
          expenseCategory: { select: { id: true, name: true, companyId: true } },
        },
      });
      if (options.expectedUpdatedAt && currentExpense?.updatedAt
        && currentExpense.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
        return 'stale';
      }
      if (!currentExpense) throw new NotFoundException(`Expense ${expenseId} not found`);
      const priorWht = currentExpense.whtInputJson as ExpenseWhtCapture | null;
      // A rerun may change line order/count. Never attach reviewed tax meaning to a new OCR row
      // by index, or erase a saved whole-bill amount/mixed historical rates with provider output.
      const preserveReviewedLines = priorWht?.origin === 'REVIEWER'
        || (currentExpense.lines ?? []).some((line) => line.vatTreatment != null)
        || new Set((currentExpense.lines ?? []).map((line) => line.whtRate?.toString() ?? '')).size > 1;
      if (preserveReviewedLines) delete data['vatMode'];
      if (prepared && !preserveReviewedLines) {
        const prior = currentExpense.vatCaptureSnapshotJson as ExpenseVatCaptureSnapshotV1 | null;
        const keepReviewerSource = prior?.version === 1 && prior.source.origin === 'REVIEWER';
        const source = keepReviewerSource ? vatSourceFromSnapshot(prior) : ocrVatSource(fields);
        const vat = reconcileExpenseVat({
          vatMode: vatMode ?? 'NO_VAT',
          lines: prepared.lines.map((line, index) => ({
            lineNumber: index + 1,
            chargeKind: line.chargeKind ?? null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountAmount: line.totals.discountAmount,
            vatRate: line.vatRate,
            whtRate: line.whtRate,
          })),
          source,
          sourceOrigin: keepReviewerSource ? 'REVIEWER' : 'OCR',
          sourceTaxableAmount: keepReviewerSource ? prior.source.taxableAmount : fields.taxableAmount ?? null,
          sourceGrossAmount: keepReviewerSource ? prior.source.grossAmount : fields.grandTotalAmount ?? null,
          sourceEvidenceRefs: keepReviewerSource ? prior.source.evidenceRefs : undefined,
          capturedAt: keepReviewerSource ? prior.source.capturedAt : undefined,
        });
        const whtInput = ocrWhtInput(fields);
        // Spec §5.1: the printed withholding belongs to the rows it was withheld against. A charge
        // row is excluded from the allocation, not merely stripped of its rate afterwards — sharing
        // the amount with it and then zeroing the row would quietly lose part of the printed WHT.
        const chargeLineNumbers = new Set(prepared.lines
          .map((line, index) => (line.chargeKind != null ? index + 1 : 0))
          .filter((lineNumber) => lineNumber > 0));
        const whtError = applyExpenseWhtInput(vat, whtInput, chargeLineNumbers);
        // Invalid printed WHT stays review evidence, never a negative payable or inferred rate.
        const acceptedWhtInput = whtError ? null : whtInput;
        prepared = {
          ...prepared,
          totals: vat.totals,
          lines: prepared.lines.map((line, index) => ({
            ...line,
            vatRate: vat.lines[index]!.vatRate,
            // Reconciliation may move a row onto the document rate; the treatment only survives
            // while that row is still genuinely zero-rated.
            vatTreatment: Number(vat.lines[index]!.vatRate ?? '0') === 0 ? line.vatTreatment ?? null : null,
            // Spec §5.1: the accepted WHT rate goes on the rows it was withheld against. A charge
            // row keeps null here for the same reason it was never given one above.
            whtRate: line.chargeKind != null ? null : expenseWhtLineRate(acceptedWhtInput),
            totals: vat.lines[index]!.totals,
          })),
        };
        Object.assign(data, vat.totals);
        data['outstandingAmount'] = vat.totals.netPayableAmount;
        data['vatCaptureSnapshotJson'] = vat.snapshot;
        data['whtInputJson'] = acceptedWhtInput ?? Prisma.DbNull;
      }
      let effectiveCategory = currentExpense?.expenseCategory
        && (currentExpense.expenseCategory.companyId === null || currentExpense.expenseCategory.companyId === ctx.companyId)
        ? currentExpense.expenseCategory
        : null;
      let categoryAutoFilled = false;
      let categorySuggestion: ReceiptCategorySuggestion | undefined;
      if (!effectiveCategory && !currentExpense?.expenseCategoryId) {
        const ocrSuggestion = fields.categorySuggestion;
        const ocrCandidate = ocrSuggestion
          && typeof ocrSuggestion.expenseCategoryId === 'string'
          && ocrSuggestion.expenseCategoryId.length > 0
          && typeof ocrSuggestion.confidence === 'number'
          && Number.isFinite(ocrSuggestion.confidence)
          && Array.isArray(ocrSuggestion.evidenceSignals)
          && ocrSuggestion.evidenceSignals.length > 0
          ? ocrSuggestion
          : undefined;
        const fallbackCandidate = options.fallbackCategorySuggestion
          && typeof options.fallbackCategorySuggestion.expenseCategoryId === 'string'
          && options.fallbackCategorySuggestion.expenseCategoryId.length > 0
          && Number.isFinite(options.fallbackCategorySuggestion.confidence)
          ? options.fallbackCategorySuggestion
          : undefined;
        // Spec S1-R4: a below-threshold suggestion used to be dropped right here, so the review
        // form never saw one. It is resolved and returned now, but only a candidate that clears
        // the bar is ever written. Auto-fill still picks exactly as before — the first candidate
        // at or above the threshold — so a weak OCR guess cannot shadow a strong capture hint and
        // silently downgrade an auto-fill into a recommendation.
        const autoFillable = (candidate?: { confidence: number }): boolean =>
          candidate !== undefined && candidate.confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE;
        const suggested = autoFillable(ocrCandidate)
          ? ocrCandidate
          : autoFillable(fallbackCandidate)
            ? fallbackCandidate
            : ocrCandidate ?? fallbackCandidate;
        if (suggested) {
          const resolved = await tx.expenseCategory.findFirst({
            where: {
              id: suggested.expenseCategoryId,
              status: 'ACTIVE',
              OR: [{ companyId: ctx.companyId }, { companyId: null }],
            },
            select: { id: true, name: true, companyId: true },
          });
          if (resolved) {
            categorySuggestion = { expenseCategoryId: resolved.id, confidence: suggested.confidence, categoryName: resolved.name };
            if (autoFillable(suggested)) {
              effectiveCategory = resolved;
              categoryAutoFilled = true;
            }
          }
        }
      }
      if (effectiveCategory) data['expenseCategoryId'] = effectiveCategory.id;
      await tx.expenseRecord.update({ where: { id: expenseId }, data });
      if (!lineTotal || preserveReviewedLines) {
        return {
          categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
          categoryName: effectiveCategory?.name ?? null,
          categoryAutoFilled,
          ...(categorySuggestion ? { categorySuggestion } : {}),
          chargeReconciliationStatus: 'SUMMARY_LINE',
          chargesApplied: 0,
          reviewReasons,
          dateVerified: dateReview.verified,
        };
      }
      await tx.expenseLine.deleteMany({ where: { expenseId } });
      for (const [index, line] of prepared!.lines.entries()) {
        await tx.expenseLine.create({ data: {
          companyId: ctx.companyId,
          expenseId,
          lineNumber: index + 1,
          description: line.description,
          chargeKind: line.chargeKind ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.totals.discountAmount,
          taxableAmount: line.totals.taxableAmount,
          vatRate: line.vatRate,
          // Only meaningful with a zero rate (ExpenseLine contract + the web draft validator), so
          // a reconciled non-zero rate clears it rather than leaving a contradictory pair behind.
          vatTreatment: line.vatTreatment && Number(line.vatRate ?? '0') === 0 ? line.vatTreatment : null,
          vatAmount: line.totals.vatAmount,
          whtRate: line.whtRate,
          whtAmount: line.totals.whtAmount,
          lineSubtotalAmount: line.totals.lineSubtotalAmount,
          lineTotalAmount: line.totals.lineTotalAmount,
          expenseCategoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
          sourceLineText: line.sourceLineText,
          aiLineConfidence: line.aiLineConfidence,
          // Spec §5.1: a charge row whose VAT the page never proved is not a suggestion to accept
          // at a glance — it is a tax position that must be decided before the record is confirmed.
          reviewStatus: line.needsReview ? 'NEEDS_REVIEW' : line.sourceLineText ? 'SUGGESTED' : 'REVIEWED',
        } });
      }
      return {
        categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
        categoryName: effectiveCategory?.name ?? null,
        categoryAutoFilled,
        ...(categorySuggestion ? { categorySuggestion } : {}),
        chargeReconciliationStatus: prepared!.status,
        ...(prepared!.itemsSumAmount ? { itemsSumAmount: prepared!.itemsSumAmount } : {}),
        chargesApplied: prepared!.chargesApplied,
        reviewReasons,
        dateVerified: dateReview.verified,
      };
    });
    if (appliedCategory === 'stale') {
      return { staleSkipped: true, candidatesCreated: 0, categoryId: null, categoryName: null, categoryAutoFilled: false } as unknown as ReceiptOcrApplyOutcome;
    }
    // Spec S1-R5: ids, a boolean and a confidence band only — never the category name, the OCR text
    // or any document content. `autoFilled` splits "the server wrote it" from "the reviewer is only
    // offered it", which is the denominator for the override rate.
    if (appliedCategory.categorySuggestion) {
      this.logger.log({
        msg: 'expense_category_suggested',
        companyId: ctx.companyId,
        expenseId,
        expenseCategoryId: appliedCategory.categorySuggestion.expenseCategoryId,
        autoFilled: appliedCategory.categoryAutoFilled,
        confidenceBand: appliedCategory.categorySuggestion.confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE ? 'high' : 'low',
      });
    }
    const duplicateResult = await reconcileExpenseDuplicateCandidates(
      this.expenses,
      ctx.companyId,
      expenseId,
      ctx.userId,
      ctx.scopes ?? {},
    );
    return { candidatesCreated: duplicateResult.openCandidates, ...appliedCategory };
  }
}
