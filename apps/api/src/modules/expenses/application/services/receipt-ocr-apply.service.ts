import { resetInputVatDecisionForType } from '../../infrastructure/expense-input-vat-decision';
import { applyExpenseInputVatPreset } from '../../infrastructure/expense-input-vat';
import { toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { assertFreeExpenseSourceActor } from '../../../system-partner-management/application/free-expense-access';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
import { PrismaService } from '../../../../common/database/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import Decimal from 'decimal.js';
import {
  EXPENSE_LINE_CHARGE_KIND_LABELS,
  expenseLineCharges,
  receiptPayeeEntityKind,
  isAssumedDateReading,
  RECEIPT_ADDITIONAL_CHARGE_KINDS,
  RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
  todayCivilDate,
  type BuyerEntityKind,
  type ExpenseChargeSummary,
  type ExpenseDocumentDateStatus,
  type ExpenseLineChargeKind,
  type ExpenseVatMode,
  type ExpenseVatCaptureSnapshotV1,
  type ExpenseVatSourceInput,
  type ExpenseWhtCapture,
  type ReceiptOcrAdditionalCharge,
  type ReceiptOcrFieldResult,
  type VendorCounterpartyAutoSaveResult,
  validateExpenseWhtInput,
} from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { reconcileExpenseDuplicateCandidates } from './expense-duplicate-detection';
import { calcDocumentTotals, calcLineTotals } from '../../domain/logic/expense-totals.logic';
import { reconcileExpenseVat, vatSourceFromSnapshot } from '../../domain/logic/expense-vat-reconciliation.logic';
import { applyExpenseWhtInput, expenseWhtLineRate } from '../../domain/logic/expense-wht-input.logic';
import { EnsureVendorCounterpartyFromExpenseUseCase } from '../../../accounting-documents/application/use-cases/ensure-vendor-counterparty-from-expense.use-case';
import { recheckBuyerAsPrinted } from '../../domain/logic/buyer-as-printed.logic';

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
  chargesFolded: 'ค่าใช้จ่ายเพิ่มถูกรวมในยอดเดียว – ตรวจก่อนยืนยัน',
  vatRounding: 'บิลปัดเศษ VAT เป็นบาทเต็ม',
  whtWithCharges: 'ตรวจฐานหัก ณ ที่จ่ายกับค่าบริการ',
} as const;

/** The rows are the document's rows and the record's VAT is `rate × taxable`, so the baht the
 *  merchant rounded its VAT box to cannot be reproduced without inventing a line. It is named
 *  instead, together with the one control that records the printed figure: the reviewer's existing
 *  "ใช้ยอดตามเอกสาร" puts the remainder in the VAT — where the merchant put it — and leaves the tax
 *  base alone. */
function vatRoundingReason(remainder: number): string {
  return `${RECEIPT_REVIEW_REASONS.vatRounding} ต่างจากที่คำนวณ ${remainder.toFixed(2)} บาท`
    + ' – กด ใช้ยอดตามเอกสาร เพื่อบันทึกตามใบเสร็จ';
}

/** How far a printed date may sit from today before it is evidence of a misread rather than a date.
 *  A receipt can be issued a day ahead across a timezone, never a year ahead; and a bill older than
 *  two years is outside every filing window this ERP works in, so it is worth a human look. */
const DATE_MAX_FUTURE_DAYS = 1;
const DATE_MAX_PAST_YEARS = 2;

export type ReceiptDateReview = {
  /** The four-state answer every surface renders from (contracts `ExpenseDocumentDateStatus`). */
  status: ExpenseDocumentDateStatus;
  /** The stored `expenseDate` came off the document and is plausible. */
  verified: boolean;
  /** Spec §5.2: the reading applied the Thai DD/MM convention or chose an era. Still a usable date
   *  — it stays on the record and does NOT force review — but every surface must say it was read
   *  rather than stated, or the receipt mode has only replaced one confident wrong answer. */
  assumed: boolean;
  /** The `VALUE_ASSUMPTIONS` markers behind `assumed`, kept as the field-level evidence. */
  assumptions?: string[];
  reason?: string;
};

/**
 * Spec §5.2. `ExpenseRecord.expenseDate` is NOT NULL, so a receipt whose date nobody could read
 * still carries the day it was sent. That placeholder is fine; passing it off as a reading is not.
 * UAT 2026-09-03: a bill printing 03/09/69 was stored with today's date while the LINE card said
 * "วันที่: ยังไม่ระบุ", and no field anywhere held both facts at once.
 *
 * Three outcomes, not two: unread and implausible are review; a date the reader had to INFER part
 * of is kept and flagged. Forcing review on an assumed reading would have made receipt mode
 * pointless — every Thai `DD/MM/YY` bill would land in review exactly as if the date were unread.
 */
export function reviewReceiptDate(
  expenseDate: string | undefined,
  todayIso: string,
  assumptions?: readonly string[],
): ReceiptDateReview {
  const read = validDate(expenseDate);
  if (!read) return { status: 'unverified', verified: false, assumed: false, reason: RECEIPT_REVIEW_REASONS.dateUnverified };
  const assumed = isAssumedDateReading(assumptions);
  const flags = assumed ? { assumed: true, assumptions: [...assumptions!] } : { assumed: false };
  const ok = { status: assumed ? ('assumed' as const) : ('verified' as const), verified: true, ...flags };
  const today = validDate(todayIso);
  if (!today) return ok;
  const latest = new Date(today.getTime() + DATE_MAX_FUTURE_DAYS * 86_400_000);
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - DATE_MAX_PAST_YEARS);
  return read > latest || read < earliest
    ? { status: 'implausible', verified: false, ...flags, reason: RECEIPT_REVIEW_REASONS.dateImplausible }
    : ok;
}

const VAT_TOLERANCE = 0.05;
const MAX_IMPLIED_VAT_RATE = 0.2;
const MAX_OCR_ADDITIONAL_CHARGES = 10;
/** How far a WHOLE-BAHT printed VAT box (and the total that carries it) may sit from the computed
 *  figures and still be that merchant rounding its own VAT rather than a misread number. STRICTLY
 *  under one baht, either way: a POS that rounds prints 56 where 55.79 was due, one that truncates
 *  prints 55. The comparison is exclusive because a gap of exactly ฿1.00 means the computed VAT is
 *  itself a whole baht, and a whole baht is not the rounding of another — that page disagrees with
 *  itself and has to reach the reviewer as a fold with both numbers.
 *  Nothing is accepted by this — the record keeps the computed VAT and stays a MISMATCH — it only
 *  decides whether the reviewer sees the document's real rows or a single folded summary line. */
const MAX_WHOLE_BAHT_VAT_ROUNDING = 1;
// Mirrors the gateway's bounded receipt item admission.
const MAX_OCR_ITEM_LINES = 200;

/** A printed money figure that may legitimately be zero: a free or included item row. The expense
 *  model already allows a zero unit price ("the general expense flow supports free-of-charge lines"),
 *  so rejecting the row here only served to delete the breakdown around it. */
function nonNegativeMoney(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function positiveMoney(value: string | undefined): number | undefined {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Every reader of the extractor's charge block goes through this. `additionalCharges` is JSON from
 *  a separate service, so a non-array there is a value to ignore, not a crash: the guard used to sit
 *  in one reader while `completeVatFields` reached `.some()` on the raw field first and threw a
 *  TypeError that took the whole apply — and the draft — with it. */
function ocrCharges(fields: ReceiptOcrFieldResult): readonly ReceiptOcrAdditionalCharge[] {
  return Array.isArray(fields.additionalCharges) ? fields.additionalCharges : [];
}

function ocrChargeAmount(charge: ReceiptOcrAdditionalCharge): number | undefined {
  if (charge.kind !== 'ROUNDING') return positiveMoney(charge.amount);
  const amount = Number(String(charge.amount ?? '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount !== 0 ? amount : undefined;
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
  // Some mixed-tax summaries print the AFTER-discount pre-VAT total beside the taxed-only
  // base. Their difference is untaxed goods, never a second discount.
  if (subtotal !== undefined && grand !== undefined && vat !== undefined
    && positiveMoney(fields.taxableAmount) !== undefined
    && subtotal > positiveMoney(fields.taxableAmount)! + VAT_TOLERANCE
    && Math.abs(subtotal + vat - grand) <= VAT_TOLERANCE) {
    return { ...fields, discountAmount: discount.toFixed(2) };
  }
  const rounding = ocrCharges(fields).filter(charge => charge.kind === 'ROUNDING')
    .reduce((sum, charge) => sum + (ocrChargeAmount(charge) ?? 0), 0);
  const base = fields.vatMode === 'VAT_EXCLUDED'
    ? positiveMoney(fields.taxableAmount) ?? (grand !== undefined && vat !== undefined ? grand - vat - rounding : undefined)
    : grand !== undefined ? grand - rounding : undefined;
  const charges = ocrCharges(fields).filter(charge => charge.kind !== 'ROUNDING')
    .reduce((sum, charge) => sum + (ocrChargeAmount(charge) ?? 0), 0);
  const implied = subtotal !== undefined && base !== undefined ? subtotal + charges - base : undefined;
  if (implied !== undefined && Math.abs(implied - discount) <= VAT_TOLERANCE) {
    return printed > 0 ? fields : { ...fields, discountAmount: discount.toFixed(2) };
  }
  const out = { ...fields };
  if (implied !== undefined && implied > VAT_TOLERANCE && implied <= subtotal!) out.discountAmount = implied.toFixed(2);
  else delete out.discountAmount;
  return out;
}

/**
 * Which side of the printed total the VAT sits on, decided by the document's own arithmetic rather
 * than by the word the extractor put in `vatMode`.
 *
 * UAT 2026-09-06 (records cmtp9v5bc…, cmtp9ul5d…, cmtp9tw7q…): three bills printing
 * `130.00 + ค่าบริการ 13.00 + VAT 10.01 = 153.01` — VAT plainly ADDED ON TOP, exact to the satang —
 * arrived labelled `VAT_INCLUDED`. Read as inclusive, the base and the charge come to 143.00, no
 * reading reconciles against the printed 153.01, and `prepareOcrLines` folded the printed service
 * charge into a single summary line: the chat card promised a charge row the record did not have.
 *
 * `subtotalAmount` is the goods total BEFORE the additional charges (the extractor prompt says so),
 * so the charged base is `subtotal − discount + Σ charges`. Adding the printed VAT to that and
 * hitting the printed total proves the VAT was added; reaching the total WITHOUT it proves the VAT
 * was already inside. Returns null when neither reading explains the total — the extractor's word is
 * still the answer there, exactly as before.
 */
function printedVatMode(
  fields: ReceiptOcrFieldResult,
  vat: number | undefined,
  grand: number | undefined,
): 'VAT_INCLUDED' | 'VAT_EXCLUDED' | null {
  const subtotal = positiveMoney(fields.subtotalAmount);
  if (subtotal === undefined || vat === undefined || grand === undefined) return null;
  const charges = ocrCharges(fields).reduce((sum, charge) => sum + (ocrChargeAmount(charge) ?? 0), 0);
  // Printed item prices can be VAT-inclusive while the subtotal printed below them is pre-VAT
  // (mixed supermarket bills). Test the actual item block before interpreting the summary label.
  const items = usableItemLines(fields);
  const quantity = positiveMoney(fields.quantity);
  const unitPrice = positiveMoney(fields.unitPrice);
  if (quantity && unitPrice) {
    const extended = quantity * unitPrice - (nonNegativeMoney(fields.discountAmount) ?? 0) + charges;
    if (Math.abs(extended - grand) <= VAT_TOLERANCE) return 'VAT_INCLUDED';
    if (Math.abs(extended + vat - grand) <= VAT_TOLERANCE) return 'VAT_EXCLUDED';
  }
  if (items.length >= 2) {
    const itemBase = items.reduce((sum, item) => sum + (nonNegativeMoney(item.amount) ?? 0), 0)
      - (nonNegativeMoney(fields.discountAmount) ?? 0) + charges;
    if (Math.abs(itemBase - grand) <= VAT_TOLERANCE) return 'VAT_INCLUDED';
    if (Math.abs(itemBase + vat - grand) <= VAT_TOLERANCE) return 'VAT_EXCLUDED';
  }
  const base = subtotal - (nonNegativeMoney(fields.discountAmount) ?? 0) + charges;
  if (Math.abs(base + vat - grand) <= VAT_TOLERANCE) return 'VAT_EXCLUDED';
  if (Math.abs(base - grand) <= VAT_TOLERANCE) return 'VAT_INCLUDED';
  return null;
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
  const rounding = ocrCharges(fields).filter(charge => charge.kind === 'ROUNDING')
    .reduce((sum, charge) => sum + (ocrChargeAmount(charge) ?? 0), 0);
  const hasPerChargeVatTreatment = ocrCharges(fields).some((charge) => charge.vatRate !== undefined);
  const hasPerLineVatTreatment = usableItemLines(fields).some((line) => line.vatRate !== undefined);
  if (taxable && vat && grand && Math.abs(taxable + vat + rounding - grand) > VAT_TOLERANCE
    && !hasPerChargeVatTreatment && !hasPerLineVatTreatment) return out;

  if (taxable && grand && !vat && saneVat(grand - taxable - rounding, taxable)) {
    vat = grand - taxable - rounding;
    out.vatAmount = vat.toFixed(2);
  } else if (vat && grand && !taxable && saneVat(vat, grand - vat - rounding)) {
    taxable = grand - vat - rounding;
    out.taxableAmount = taxable.toFixed(2);
  } else if (taxable && vat && !grand && saneVat(vat, taxable)) {
    grand = taxable + vat + rounding;
    out.grandTotalAmount = grand.toFixed(2);
  }

  const printed = Number.parseFloat(String(fields.vatRate ?? ''));
  // Spec §19g decision 2: `printed >= 0` — a printed zero rate is a zero-rated supply and must
  // survive here, or §19f decision 3 only held because the old `defaultLineVatRate` fallback
  // happened to re-add a '0'. A printed 0 contradicted by a non-zero VAT amount still falls through
  // to the derived rate below, because the consistency test rejects it.
  const printedUsable = Number.isFinite(printed) && printed >= 0 && printed < 1
    && (hasPerChargeVatTreatment || hasPerLineVatTreatment || !taxable || !vat || Math.abs(taxable * printed - vat) <= VAT_TOLERANCE);
  // A derived rate is only a rate while the implied ratio is sane — otherwise the pair is a
  // misread, and stamping vat/taxable on the line would re-inflate it on the next recompute.
  const derived = taxable && vat && saneVat(vat, taxable) ? Number((vat / taxable).toFixed(4)) : undefined;
  const rate = printedUsable ? printed : derived;
  if (rate === undefined) delete out.vatRate;
  else out.vatRate = (Math.abs(rate - 0.07) <= 0.002 ? 0.07 : rate).toFixed(4);

  const provenVat = Boolean(taxable && vat && grand && Math.abs(taxable + vat + rounding - grand) <= VAT_TOLERANCE);
  if (provenVat && (!validVatMode(out.vatMode) || out.vatMode === 'NO_VAT')) out.vatMode = 'VAT_EXCLUDED';
  // The printed arithmetic outranks a mode the extractor GUESSED — VAT_INCLUDED, VAT_EXCLUDED,
  // NO_VAT, or a word that is not a mode at all. It does not outrank EXEMPT or NEEDS_REVIEW: those
  // are answers about the document's tax POSITION, not readings of its totals, and a supply exempted
  // by law does not become taxable because a box on the slip adds up (the same line `provenVat`
  // above already refuses to cross).
  const deliberateMode = out.vatMode === 'EXEMPT' || out.vatMode === 'NEEDS_REVIEW';
  const printedMode = deliberateMode ? null : printedVatMode(fields, vat, grand);
  if (printedMode) out.vatMode = printedMode;
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
      const base = nonNegativeMoney(fields.whtBaseAmount);
      const input = { inputType, value: value.toFixed(2), ...(base !== undefined && { baseAmount: base.toFixed(2) }) };
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
  const charges = ocrCharges(fields).reduce((sum, charge) => sum + (Number(toMoney4(charge.amount)) || 0), 0);
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

/** `exclusive` is the whole-baht window only (see `MAX_WHOLE_BAHT_VAT_ROUNDING`): a gap of exactly
 *  ฿1.00 means the computed VAT is a whole baht too, and one whole baht is not a rounding of
 *  another. The ฿0.05 satang tolerance keeps its inclusive comparison, unchanged. */
function closeEnough(
  actual: string,
  expected: string | undefined,
  tolerance = VAT_TOLERANCE,
  exclusive = false,
): boolean {
  if (!expected) return true;
  const gap = Math.abs(Number(actual) - Number(toMoney4(expected)));
  return exclusive ? gap < tolerance : gap <= tolerance;
}

/**
 * A merchant that prints its VAT as a whole baht has rounded (or truncated) its own VAT box, and the
 * printed total carries the same remainder. The Owner's check bill: goods 725.00, Gratuity 72.00,
 * VAT box "56" where 7% of 797.00 is 55.79, total 853.00 — both figures 0.21 out, `closeEnough`
 * rejected each of them, and the whole bill folded, deleting the gratuity to hide the remainder.
 *
 * True widens ONLY the VAT and grand-total comparisons below, and only while the printed rows still
 * add up to the printed subtotal: the rounding lives in the TAX, so a base that disagrees is a
 * different problem and must keep failing (it becomes ITEMS_DID_NOT_RECONCILE). Nothing here is
 * accepted as the record's VAT — the record keeps the computed figure and the printed one stays a
 * MISMATCH the reviewer has to answer.
 */
function printedVatIsWholeBaht(fields: ReceiptOcrFieldResult, totals: ReturnType<typeof calcDocumentTotals>): boolean {
  const printedVat = positiveMoney(fields.vatAmount);
  if (printedVat === undefined || !Number.isInteger(printedVat)) return false;
  // Both figures have to be on the page: a whole-baht VAT box with no printed total to carry the
  // same remainder is a coincidence, not evidence — and widening on it would let a charge inherit
  // the document rate that §5.1 says nothing proved (a slip reading 100.00 + 10.00, VAT 7.00).
  if (positiveMoney(fields.grandTotalAmount) === undefined || fields.subtotalAmount === undefined) return false;
  // And the printed item rows must already reach the printed subtotal. This gate is REAL only on
  // the item branch: a bill whose own rows disagree with its own subtotal is a different
  // disagreement, and the summary fold — ITEMS_DID_NOT_RECONCILE, with both numbers — is what has
  // to carry that one to the reviewer. The fallback half is not a gate: with no usable item block
  // the only branch left is the charge branch, which builds its single base line FROM
  // `fields.subtotalAmount`, so this candidate's goods total agrees by construction.
  const items = usableItemLines(fields);
  const rowsSubtotal = items.length >= 2
    ? items.reduce((sum, item) => sum + (positiveMoney(item.amount) ?? 0), 0).toFixed(4)
    : totals.subtotalAmount;
  return closeEnough(rowsSubtotal, fields.subtotalAmount);
}

/** A breakdown may replace the summary line only when it reproduces the document's own printed
 *  totals, so a misread row can never change what the company recorded. Returns the reconciled
 *  totals, or null when the candidate contradicts the document. */
function reconciledTotals(
  candidate: PreparedOcrLine[],
  fields: ReceiptOcrFieldResult,
): ReturnType<typeof calcDocumentTotals> | null {
  const vat = reconcileExpenseVat({ vatMode: documentVatMode(fields),
    lines: candidate.map((line, index) => ({ lineNumber: index + 1, chargeKind: line.chargeKind,
      quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.totals.discountAmount,
      vatRate: line.vatRate, whtRate: line.whtRate })), source: ocrVatSource(fields),
    sourceTaxableAmount: fields.taxableAmount ?? fields.subtotalAmount, sourceGrossAmount: fields.grandTotalAmount });
  const totals = vat.snapshot.reconciliation.status === 'MATCHED' ? vat.totals
    : calcDocumentTotals({ lines: candidate.map((line) => ({ ...line.totals, chargeKind: line.chargeKind ?? null })) });
  const wholeBaht = printedVatIsWholeBaht(fields, totals);
  const taxTolerance = wholeBaht ? MAX_WHOLE_BAHT_VAT_ROUNDING : VAT_TOLERANCE;
  // Mixed per-line VAT rates make the document's single printed taxable base incomparable.
  const taxableIsComparable = new Set(candidate.map((line) => line.vatRate ?? '')).size <= 1;
  // The whole-baht window is STRICTLY under one baht in either direction; the satang tolerance
  // beside it keeps comparing inclusively, exactly as it did before this widening existed.
  const ok = closeEnough(totals.grandTotalAmount, fields.grandTotalAmount, taxTolerance, wholeBaht)
    // Never widened: the tax BASE is the document's own arithmetic, not its rounding.
    && (!taxableIsComparable || closeEnough(totals.taxableAmount, fields.taxableAmount))
    && closeEnough(totals.vatAmount, fields.vatAmount, taxTolerance, wholeBaht);
  return ok ? totals : null;
}

/** Spec §5.1: a remainder the reconciled record could not reproduce is named, never hidden — and
 *  never paid for with a line the document did not print. Empty while the two agree to the satang. */
function vatRoundingReasons(
  fields: ReceiptOcrFieldResult,
  totals: ReturnType<typeof calcDocumentTotals>,
): string[] {
  const printedVat = positiveMoney(fields.vatAmount);
  if (printedVat === undefined) return [];
  const remainder = Number((printedVat - Number(totals.vatAmount)).toFixed(2));
  return Math.abs(remainder) > VAT_TOLERANCE ? [vatRoundingReason(remainder)] : [];
}

/** Spec §5: the extracted item block, re-validated here because the gateway is a separate service
 *  and its output is a suggestion, never a trusted contract. */
export function usableItemLines(fields: ReceiptOcrFieldResult): NonNullable<ReceiptOcrFieldResult['lines']> {
  const lines = fields.lines;
  if (fields.missingFields?.includes('lines') || !Array.isArray(lines) || lines.length < 2 || lines.length > MAX_OCR_ITEM_LINES) return [];
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

/**
 * W10 D1: true when every printed row amount is ALREADY net of the document-level discount.
 *
 * The FlowAccount/PEAK/Leceipt full form prints `50 × 250.00, ส่วนลด 5 %, มูลค่า 11,875.00` and then
 * repeats the same 625.00 in the summary. Placing that discount on a row whose amount already has it
 * taken off under-totals the draft by exactly the discount, and the whole item breakdown then falls
 * back to one "AI สรุปยอดรวม" line — the reviewer loses the rows the document printed.
 *
 * Proven from printed figures only, and only when EVERY row prints a unit price: the rows' gross
 * (quantity × unit price) must reach the printed pre-discount subtotal while their printed amounts
 * reach that subtotal minus the printed discount. Gross rows reach the subtotal with their amounts,
 * so the ordinary layout (a staff discount on a bill whose rows are gross) can never match.
 */
function itemRowsNetOfDocumentDiscount(
  fields: ReceiptOcrFieldResult,
  items: NonNullable<ReceiptOcrFieldResult['lines']>,
): boolean {
  const discount = nonNegativeMoney(fields.discountAmount) ?? 0;
  const subtotal = positiveMoney(fields.subtotalAmount);
  if (items.length < 2 || subtotal === undefined || discount <= VAT_TOLERANCE) return false;
  let gross = 0;
  let net = 0;
  for (const item of items) {
    const unitPrice = positiveMoney(item.unitPrice);
    if (unitPrice === undefined) return false;
    gross += unitPrice * (positiveMoney(item.quantity) ?? 1);
    net += nonNegativeMoney(item.amount) ?? 0;
  }
  return Math.abs(gross - subtotal) <= VAT_TOLERANCE
    && Math.abs(net - (subtotal - discount)) <= VAT_TOLERANCE;
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
  const hadChargeSuggestions = ocrCharges(fields).length > 0;
  const charges = ocrCharges(fields).length <= MAX_OCR_ADDITIONAL_CHARGES
    ? ocrCharges(fields).filter((charge) => {
        const amount = ocrChargeAmount(charge);
        const rate = charge.vatRate === undefined ? undefined : Number(charge.vatRate);
        return Boolean(
          amount
          && charge.amount.length <= 32
          && charge.description.trim() && charge.description.length <= 120
          && charge.evidenceSignal.trim() && charge.evidenceSignal.length <= 120
          && RECEIPT_ADDITIONAL_CHARGE_KINDS.includes(charge.kind)
          && (rate === undefined || (Number.isFinite(rate) && rate >= 0 && rate < 1))
          && (charge.kind !== 'ROUNDING' || rate === undefined || rate === 0),
        );
      })
    : [];
  const printedSubtotal = positiveMoney(fields.subtotalAmount);
  // Spec §5.1: withholding is computed on a base the payer and payee agreed, and a service charge
  // is not automatically part of it. Nothing here decides that — it asks the person who can.
  const whtReason = charges.length > 0 && ocrWhtInput(fields) ? [RECEIPT_REVIEW_REASONS.whtWithCharges] : [];
  /**
   * Two readings of the same printed rows. `document` taxes each charge at the rate the page carries;
   * `unproven` leaves it null. Which one is right is not a property of the charge — it is whether the
   * document's own printed totals ADD UP with the charge taxed, and only `reconciledTotals` below can
   * answer that. Deciding it up-front (as the first cut did, on whether a rate string existed) nulled
   * the rate on a bill whose printed VAT proved it, broke reconciliation, and folded the charge away
   * entirely: a slip printing 100.00 + 10.00 with VAT 7.70 recorded a 100.00 total and no charge.
   */
  const chargeLines = (reading: 'document' | 'unproven') => charges.map((charge) => prepareLine({
    description: chargeDescription(charge),
    chargeKind: charge.kind,
    quantity: '1.0000',
    unitPrice: toMoney4(charge.amount),
    vatRate: charge.kind === 'ROUNDING' ? '0' : reading === 'document' ? charge.vatRate ?? defaultLineVatRate(fields) : charge.vatRate ?? null,
    // Spec §5.1: never spread the document's WHT rate onto a charge row. Doing so withheld tax on a
    // base nobody computed — and on a ROUNDING row, on money that was never a payment at all.
    whtRate: null,
    needsReview: charge.kind !== 'ROUNDING' && reading === 'unproven' && charge.vatRate === undefined,
    sourceLineText: chargeSourceLineText(charge),
    aiLineConfidence: charge.confidence,
  }, vatMode));

  /**
   * The printed totals did not add up with the charges taxed at the document rate, so nothing proves
   * that rate. Spec §5.1 forbids keeping the guess — but dropping the whole split is worse: the
   * charge is a row the page really printed, and folding it deletes it from the record. Keep every
   * row, leave the charge un-rated and in review, and name the VAT the arithmetic could not explain
   * so the reviewer sees the actual gap instead of being told only that something is wrong.
   */
  const unprovenCharges = (base: PreparedOcrLine[]) => {
    const lines = [...base, ...chargeLines('unproven')];
    const totals = calcDocumentTotals({ lines: lines.map((line) => line.totals) });
    // The one thing that may NOT move is what the company paid. Un-rating the charge lowers the
    // computed VAT, so this split is only honest while it still reaches the printed grand total;
    // a page whose own figures contradict each other by more than its charges' VAT is a different
    // problem, and the summary fold below records the printed total for it, as it always has.
    if (!closeEnough(totals.grandTotalAmount, fields.grandTotalAmount)) return null;
    const printedVat = positiveMoney(fields.vatAmount);
    const remainder = printedVat === undefined ? 0 : printedVat - Number(totals.vatAmount);
    const reason = Math.abs(remainder) > VAT_TOLERANCE
      ? `${RECEIPT_REVIEW_REASONS.chargeVatUnknown} (VAT ที่อธิบายไม่ได้ ${remainder.toFixed(2)})`
      : RECEIPT_REVIEW_REASONS.chargeVatUnknown;
    return {
      status: 'RECONCILED_CHARGE_LINES' as const,
      lines,
      totals,
      chargesApplied: charges.length,
      chargeReviewReasons: [reason, ...whtReason],
    };
  };

  // Spec §5/§569: one draft line per printed item row when the document's own arithmetic proves the
  // split, so a two-item bill stops collapsing into a single "AI สรุปยอดรวม" line. Tried before the
  // charge branch because an item breakdown supersedes it — the charge lines ride along either way.
  const items = usableItemLines(fields);
  // W10 D1: FlowAccount/PEAK/Leceipt print the line discount INSIDE the row's money column and
  // repeat the same total in the summary. The row's printed unit price is then the gross one, so the
  // summary discount has a base to come off and both printed figures survive on the draft.
  const rowsNetOfDiscount = itemRowsNetOfDocumentDiscount(fields, items);
  if (items.length >= 2) {
    const candidate = [
      ...items.map((item, index) => {
        const qty = positiveMoney(item.quantity) ?? 1;
        // usableItemLines already proved a printed amount; a free row must retain zero here too.
        const amount = nonNegativeMoney(item.amount)!;
        const printedUnit = positiveMoney(item.unitPrice);
        // Thai bills print the row's extended amount far more often than its unit price, so the
        // printed unit price is kept only when it explains that amount — or, on the net-row layout
        // above, when the rows plus the printed discount explain the printed subtotal.
        const unitPrice = printedUnit && (rowsNetOfDiscount || Math.abs(printedUnit * qty - amount) <= VAT_TOLERANCE)
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
    ];
    const proven = [...candidate, ...chargeLines('document')];
    const totals = reconciledTotals(proven, fields);
    // The printed totals adding up WITH the charges taxed is the proof §5.1 asks for — no guess and
    // nothing to review. Only when they do not does the charge rate become an open question.
    if (totals) {
      return {
        status: 'RECONCILED_ITEM_LINES', lines: proven, totals, chargesApplied: charges.length,
        // A whole-baht VAT box may have widened the acceptance above; whatever it did, a remainder
        // the record could not reproduce is named here rather than papered over with a line.
        chargeReviewReasons: [...vatRoundingReasons(fields, totals), ...whtReason],
      };
    }
    if (charges.length > 0) {
      const unproven = unprovenCharges(candidate);
      if (unproven) return { ...unproven, status: 'RECONCILED_ITEM_LINES' as const };
    }
  }

  if (charges.length > 0 && printedSubtotal) {
    const qty = positiveMoney(fields.quantity) ?? 1;
    const modelUnit = positiveMoney(fields.unitPrice);
    const baseUnit = modelUnit && Math.abs(modelUnit * qty - printedSubtotal) <= VAT_TOLERANCE
      ? modelUnit
      : printedSubtotal / qty;
    const base = [
      prepareLine({
        description: fields.description ?? 'รายการตามใบเสร็จ (AI สรุปยอดรวม)',
        quantity: qty.toFixed(4),
        unitPrice: baseUnit.toFixed(4),
        vatRate: defaultLineVatRate(fields),
        whtRate,
      }, vatMode, toMoney4(fields.discountAmount)),
    ];
    const proven = [...base, ...chargeLines('document')];
    const totals = reconciledTotals(proven, fields);
    if (totals) {
      return {
        status: 'RECONCILED_CHARGE_LINES', lines: proven, totals, chargesApplied: charges.length,
        chargeReviewReasons: [...vatRoundingReasons(fields, totals), ...whtReason],
      };
    }
    const unproven = unprovenCharges(base);
    if (unproven) return unproven;
  }

  // A taxed-only base plus VAT below the gross proves a separate untaxed portion. Keep two
  // net summary rows instead of inventing a blended VAT rate. The original discount stays in
  // source evidence: allocating it over these net groups would invent a per-group allocation.
  const taxBase = positiveMoney(fields.taxableAmount);
  const sourceVat = positiveMoney(fields.vatAmount);
  const sourceGross = positiveMoney(fields.grandTotalAmount);
  const sourceRate = positiveMoney(fields.vatRate);
  if (charges.length === 0 && taxBase && sourceVat && sourceGross && sourceRate
    && ['VAT_INCLUDED', 'VAT_EXCLUDED'].includes(vatMode)
    && Math.abs(taxBase * sourceRate - sourceVat) <= VAT_TOLERANCE
    && sourceGross - taxBase - sourceVat > VAT_TOLERANCE) {
    const netLabel = positiveMoney(fields.discountAmount) ? ' (รวมส่วนลดแล้ว)' : '';
    const groups = [
      prepareLine({ description: `ยอดสินค้าที่เสีย VAT${netLabel}`, quantity: '1',
        unitPrice: (taxBase + (vatMode === 'VAT_INCLUDED' ? sourceVat : 0)).toFixed(2),
        vatRate: sourceRate.toFixed(4), whtRate, needsReview: true }, vatMode),
      prepareLine({ description: `ยอดสินค้าที่ไม่มี VAT${netLabel}`, quantity: '1',
        unitPrice: (sourceGross - taxBase - sourceVat).toFixed(2),
        vatRate: '0', whtRate, needsReview: true }, vatMode),
    ];
    const totals = reconciledTotals(groups, fields);
    if (totals) return { status: 'SUMMARY_LINE', lines: groups, totals, chargesApplied: 0,
      chargeReviewReasons: ['เก็บยอดสรุปแยกตามภาษีแล้ว รายละเอียดยังต้องตรวจจากเอกสาร'
        + (netLabel ? ' ส่วนลดรวมอยู่ในยอดแล้ว ไม่ต้องหักซ้ำ' : '')] };
  }
  const summaryVatRate = summaryLineVatRate(fields);
  const summary = prepareLine({
    description: fields.description ?? 'รายการตามใบเสร็จ (AI สรุปยอดรวม)',
    quantity: toMoney4(fields.quantity ?? '1'),
    unitPrice: deriveUnitPrice(fields, lineTotal, summaryVatRate),
    vatRate: summaryVatRate,
    whtRate,
  }, vatMode, toMoney4(fields.discountAmount));
  // Fractional quantities and rounded printed unit prices can differ from the printed payable
  // by a satang. Preserve both printed inputs and name the calculated settlement adjustment.
  const fractionalQuantity = positiveMoney(fields.quantity);
  const printedUnitPrice = positiveMoney(fields.unitPrice);
  const settlementDifference = sourceGross === undefined ? 0
    : Math.round((sourceGross - Number(summary.totals.lineTotalAmount)) * 100) / 100;
  if (!hadChargeSuggestions && fractionalQuantity && !Number.isInteger(fractionalQuantity)
    && printedUnitPrice && Number(summary.unitPrice) === printedUnitPrice
    && Math.abs(settlementDifference) > 0 && Math.abs(settlementDifference) <= 0.02) {
    const rounding = prepareLine({ description: 'ปรับเศษจากจำนวนและราคาต่อหน่วย',
      chargeKind: 'ROUNDING', quantity: '1', unitPrice: settlementDifference.toFixed(2),
      vatRate: '0', whtRate: null, sourceLineText: 'ระบบคำนวณส่วนต่างจากยอดสุทธิที่พิมพ์บนเอกสาร' }, vatMode);
    const lines = [summary, rounding];
    const totals = reconciledTotals(lines, fields);
    if (totals) return { status: 'RECONCILED_CHARGE_LINES', lines, totals,
      chargesApplied: 1, chargeReviewReasons: [] };
  }
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
    // Reached with charges only when the page printed no subtotal to build a base line from, so
    // they really are folded into the summary. That is still a fact the reviewer has to be told in
    // words — returning [] here left `aiVerificationStatus` at PARTIAL on a draft that had just
    // swallowed a printed service charge.
    chargeReviewReasons: charges.length > 0 ? [RECEIPT_REVIEW_REASONS.chargesFolded, ...whtReason] : [],
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
  acceptedAmounts?: { grandTotalAmount: string; vatAmount: string; whtAmount: string; netPayableAmount: string; vatMode: string; discountAmount?: string };
  chargeReconciliationStatus: ReceiptChargeReconciliationStatus;
  /** Only with ITEMS_DID_NOT_RECONCILE: what the printed rows add up to, for the reviewer to compare. */
  itemsSumAmount?: string;
  chargesApplied: number;
  /** Spec §5.1: the charge rows this apply actually WROTE, derived by `expenseLineCharges` — the
   *  same one the web summary and the S-3 read tool answer from. The LINE capture card printed the
   *  OCR's `additionalCharges` suggestion instead and promised rows the record did not have
   *  (UAT 2026-09-06); a caller that wants to name a charge reads this and nothing else. */
  charges: ExpenseChargeSummary[];
  /** Spec §5.1/§5.2: readable reasons this draft must be reviewed, for the caller to put in
   *  `aiVerificationSummaryJson` and in its own reply. Returned rather than written here because
   *  both capture paths compose that JSON themselves after this service returns. */
  reviewReasons: string[];
  /** Spec §5.2: false when the stored `expenseDate` is the upload-day placeholder rather than a date
   *  read off the document, or is so far from today that it reads as a misreading. */
  dateVerified: boolean;
  /** Spec §5.2: the date IS off the document and plausible, but the reader had to infer the
   *  วัน/เดือน order or the era to get there. Not a review trigger — a label every surface shows. */
  dateAssumed: boolean;
  /** The four-state answer every surface renders from — card, review page, list, export. */
  dateStatus: ExpenseDocumentDateStatus;
  /** The `VALUE_ASSUMPTIONS` markers behind `dateAssumed`, for the field-level evidence. */
  dateAssumptions?: string[];
};

/** The applied result, or — when the record moved under the OCR round trip — the same shape with
 *  `staleSkipped` set and nothing written. One shape rather than a union so every existing caller
 *  and fixture keeps compiling; `isStaleOcrApply` is the only correct way to read it. */
export type ReceiptOcrApplyOutcome = {
  candidatesCreated: number; staleSkipped?: true; committedUpdatedAt?: Date;
  /** §7: the LINE summary adds one line for case a ("บันทึกร้านนี้ลงทะเบียนคู่ค้าแล้ว"). */
  vendorCounterpartyAutoSave?: VendorCounterpartyAutoSaveResult;
} & AppliedReceiptResult;

export function isStaleOcrApply(outcome: ReceiptOcrApplyOutcome): boolean {
  return outcome.staleSkipped === true;
}

@Injectable()
export class ReceiptOcrApplyService {
  private readonly logger = new Logger(ReceiptOcrApplyService.name);

  // Optional for the same reason as `UpdateExpenseDraftUseCase`: the registry is a side effect, and
  // the many bare-constructed specs of this service must keep applying receipts without it.
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: PrismaExpenseRepository,
    private readonly ensureVendorCounterparty?: EnsureVendorCounterpartyFromExpenseUseCase,
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
    options: {
      fallbackCategorySuggestion?: ReceiptCategoryFallback; expectedUpdatedAt?: Date; todayIso?: string;
      /** The attachment these fields were read FROM (§16.4); see the `sourceStale` clear below. */
      sourceAttachmentId?: string;
      /** Server-derived admission mode. An upgrade during a read must not add master-data writes. */
      sourceOnly?: boolean;
      /** Commit quota success with the usable source facts, or roll both back. */
      onUsablePersisted?: (tx: Prisma.TransactionClient) => Promise<void>;
      /** Classification of this same successfully applied read, fenced with its facts. */
      sourceDocumentType?: ReturnType<typeof toSourceDocumentType>;
      /** This read's classification, independent of the reviewer's chosen document type. */
      ocrDocumentType?: ReturnType<typeof toSourceDocumentType>;
    } = {},
  ): Promise<ReceiptOcrApplyOutcome> {
    const completed = completeVatFields(verifyDiscountAmount(fields));
    const lineTotal = receiptFallbackLineTotal(completed);
    let prepared = lineTotal ? prepareOcrLines(completed, lineTotal) : null;
    let dateReview = reviewReceiptDate(
      completed.expenseDate,
      options.todayIso ?? todayCivilDate(),
      completed.expenseDateAssumptions,
    );
    let reviewReasons = [
      ...(fields.missingFields?.includes('lines') ? ['อ่านรายละเอียดบางรายการไม่ครบ เก็บยอดรวมไว้แล้ว กรุณาตรวจรายการกับภาพใบเสร็จ'] : []),
      ...(dateReview.reason ? [dateReview.reason] : []),
      ...(prepared?.chargeReviewReasons ?? []),
    ];
    const data: Record<string, unknown> = {
      // Spec §5.2: an unread date is not a partial read, it is a value nobody has confirmed. Leaving
      // this at PARTIAL let a draft carrying the upload day pass as if the page had been read.
      ...(options.sourceDocumentType ? { sourceDocumentType: options.sourceDocumentType } : {}),
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
    const appliedCategory = await this.prisma.client.$transaction(async (tx): Promise<ReceiptOcrApplyOutcome | { stale: ExpenseChargeSummary[] }> => {
      if (options.sourceOnly) {
        // Match OCR/admin lock order so a lifecycle hold cannot pass the source commit.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${ctx.companyId}`}))`;
        await lockPlanTermCompany(tx, ctx.companyId);
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`${ctx.companyId}:vat-registration`}))`;
      // Match correction/duplicate lock order before taking the record's write lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:duplicate-reconciliation`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${expenseId}:substitute-receipt`}))`;
      const finish = async (result: AppliedReceiptResult): Promise<ReceiptOcrApplyOutcome> => {
        const duplicate = await reconcileExpenseDuplicateCandidates(this.expenses, ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {}, tx);
        // Read inside the transaction that produced these facts. A later read could bless a
        // human edit with an old OCR summary; callers must fence their follow-up writes.
        const saved = await tx.expenseRecord.findFirstOrThrow({ where: { id: expenseId, companyId: ctx.companyId }, select: { updatedAt: true } });
        await options.onUsablePersisted?.(tx);
        return { ...result, candidatesCreated: duplicate.openCandidates, committedUpdatedAt: saved.updatedAt,
          ...(autoSave && autoSave.result.case !== 'SKIPPED' ? { vendorCounterpartyAutoSave: autoSave.result } : {}) };
      };
      const currentExpense = await tx.expenseRecord.findFirst({
        where: { id: expenseId, companyId: ctx.companyId },
        select: {
          id: true, inputVatClaimStatus: true, taxEvidenceStatus: true, companyId: true, status: true, sourceDocumentType: true, sourceChannelMetadataJson: true,
          expenseCategoryId: true,
          createdByUserId: true,
          reviewedAt: true,
          expenseDate: true, aiVerificationSummaryJson: true,
          primaryAttachmentId: true,
          vendorEntityKindSnapshot: true,
          // For the vendor registry auto-save below: what the record already carries, so a re-read
          // that writes nothing new still matches against the right shop.
          captureSource: true, sourceReimbursementRequestId: true, vendorCounterpartyId: true,
          vendorNameSnapshot: true, vendorTaxIdSnapshot: true, vendorBranchCodeSnapshot: true, vendorAddressSnapshot: true,
          // Slice 2: the branch whose tax code the printed buyer branch is compared with, and the
          // previous check, whose confirmed override may survive this read.
          branchId: true, buyerAsPrintedJson: true,
          grandTotalAmount: true, vatAmount: true, whtAmount: true, netPayableAmount: true, vatMode: true,
          discountAmount: true,
          updatedAt: true,
          vatCaptureSnapshotJson: true,
          whtInputJson: true,
          // The charge columns come along because an outcome that writes NO lines still has to say
          // what the record carries: `expenseLineCharges` over exactly these rows (F5).
          lines: { select: { whtRate: true, vatTreatment: true, chargeKind: true, lineSubtotalAmount: true, vatAmount: true } },
          expenseCategory: { select: { id: true, name: true, companyId: true } },
        },
      });
      /** Spec §5.1: what the record CARRIES right now, for every outcome that writes no lines of its
       *  own. Returning `[]` there told the LINE card the charges had been folded into one total,
       *  and it printed that sentence over records holding a real SERVICE_CHARGE row. */
      const persistedCharges = expenseLineCharges((currentExpense?.lines ?? []).map((line) => ({
        chargeKind: line.chargeKind,
        lineSubtotalAmount: toMoney4(String(line.lineSubtotalAmount)),
        vatAmount: toMoney4(String(line.vatAmount)),
      })));
      if (options.expectedUpdatedAt && currentExpense?.updatedAt
        && currentExpense.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
        return { stale: persistedCharges };
      }
      if (!currentExpense) throw new NotFoundException(`Expense ${expenseId} not found`);
      if (options.sourceOnly) {
        if (currentExpense.createdByUserId !== ctx.userId || !['DRAFT', 'NEEDS_REVIEW'].includes(currentExpense.status)) {
          throw new ForbiddenException('เปิดอ่านได้เฉพาะร่างที่คุณมีสิทธิ์ค่ะ');
        }
        await assertFreeExpenseSourceActor(tx, { companyId: ctx.companyId, userId: ctx.userId, branchId: currentExpense.branchId });
      }
      const summary = currentExpense.aiVerificationSummaryJson as Record<string, unknown> | null;
      // §16.4: `sourceStale` means "these values were read from the file that was REPLACED". This
      // read is of the file the record carries NOW, so the warning it raised has been answered and
      // must go with the values it was about. The synchronous lane composes a fresh summary and
      // drops it for free; the durable job lane writes no summary of its own, which is how a
      // re-read of the new file left the page still saying the numbers came from the old one.
      if (options.sourceAttachmentId && currentExpense.primaryAttachmentId === options.sourceAttachmentId
        && summary && ('sourceStale' in summary || 'sourceAttachmentId' in summary)) {
        const { sourceStale: _stale, sourceAttachmentId: _replaced, ...kept } = summary;
        data['aiVerificationSummaryJson'] = kept;
      }
      const resolvedDate = summary?.['dateResolution'] as { expenseDate?: string; resolvedByUserId?: string } | undefined;
      if (resolvedDate?.resolvedByUserId && resolvedDate.expenseDate
        && resolvedDate.expenseDate === currentExpense.expenseDate?.toISOString().slice(0, 10)) {
        // A human-supplied document date wins over an unread or different OCR date.
        delete data['expenseDate'];
        dateReview = { verified: true, assumed: false, status: 'verified' };
        reviewReasons = reviewReasons.filter(reason => reason !== RECEIPT_REVIEW_REASONS.dateUnverified && reason !== RECEIPT_REVIEW_REASONS.dateImplausible);
        data['aiVerificationStatus'] = reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'PARTIAL';
      }
      /**
       * Vendor-address §7 (Phase 4): the reader's address fills the field only while it is still
       * empty. The `reviewedAt` filter just below protects a record somebody already reviewed; a
       * draft is not reviewed yet, so without this a re-read would overwrite the address the payer
       * typed into the LINE question or the review form. `buyerAsPrinted` never reaches a seller
       * column; Slice 2 compares it with the company registry further down.
       */
      if (completed.vendorAddress && !currentExpense.vendorAddressSnapshot) {
        data['vendorAddressSnapshot'] = completed.vendorAddress;
      }
      // Re-reading a receipt must not replace a reviewer's chosen identity.
      if (currentExpense.reviewedAt) {
        // CON-5: `vendorAddressSnapshot` belongs in this set from the day the column exists — a
        // re-read must not delete an address a reviewer typed once OCR starts reading one (Phase 4).
        for (const key of ['vendorNameSnapshot', 'vendorTaxIdSnapshot', 'vendorBranchCodeSnapshot', 'vendorAddressSnapshot', 'vendorDocumentNumber', 'expenseDate']) delete data[key];
      } else if (!currentExpense.vendorEntityKindSnapshot) {
        const kind = receiptPayeeEntityKind(completed.vendorName, completed.vendorIdentityEvidence);
        if (kind && kind === completed.vendorEntityKind) data['vendorEntityKindSnapshot'] = kind;
      }
      /**
       * D4/§7 from the LINE/OCR side. Placed AFTER the CON-5 protected-field filtering, so the
       * values it matches on are the ones this apply will actually leave on the record, and before
       * the write, so `vendorCounterpartyId` (GAP-4) and the registry's taxpayer class (CON-7) land
       * in the same statement.
       *
       * The registry write runs on the base client, not on `tx`: a failure inside this transaction
       * would abort the receipt apply, and §8 says the expense always wins. The cost is that a
       * later rollback here leaves a counterparty row behind — harmless, since the next save links
       * to it instead of making another.
       */
      // Payment evidence identifies the payee, not a supplier purchase for the registry.
      const savedDocumentKind = (summary?.['classification'] as { documentKind?: string } | undefined)?.documentKind;
      const vendorRegistry = options.sourceOnly || [options.ocrDocumentType, options.sourceDocumentType, currentExpense.sourceDocumentType, savedDocumentKind].includes('TRANSFER_SLIP') ? undefined : this.ensureVendorCounterparty;
      const receiptUploaderUserId = vendorRegistry && currentExpense.primaryAttachmentId
        ? await this.expenses.findPrimaryReceiptUploader(ctx.companyId, expenseId, currentExpense.primaryAttachmentId)
        : null;
      if (!currentExpense.reviewedAt && completed.vendorTaxId) {
        const registeredName = await vendorRegistry?.resolveOcrVendorName(ctx, completed.vendorTaxId);
        if (registeredName) data['vendorNameSnapshot'] = registeredName;
      }
      const autoSave = await vendorRegistry?.execute(ctx, {
        expenseId,
        sourceDocumentType: options.sourceDocumentType ?? currentExpense.sourceDocumentType,
        ocrDocumentType: options.ocrDocumentType ?? savedDocumentKind,
        ...(receiptUploaderUserId ? { receiptUploaderUserId } : {}),
        captureSource: currentExpense.captureSource,
        sourceReimbursementRequestId: currentExpense.sourceReimbursementRequestId,
        vendorCounterpartyId: currentExpense.vendorCounterpartyId,
        vendorName: (data['vendorNameSnapshot'] as string | undefined) ?? currentExpense.vendorNameSnapshot,
        vendorTaxId: (data['vendorTaxIdSnapshot'] as string | undefined) ?? currentExpense.vendorTaxIdSnapshot,
        vendorBranchCode: (data['vendorBranchCodeSnapshot'] as string | undefined) ?? currentExpense.vendorBranchCodeSnapshot,
        vendorAddressText: (data['vendorAddressSnapshot'] as string | undefined) ?? currentExpense.vendorAddressSnapshot,
        vendorEntityKind: (data['vendorEntityKindSnapshot'] as BuyerEntityKind | undefined) ?? currentExpense.vendorEntityKindSnapshot,
      });
      if (autoSave?.linkCounterpartyId) data['vendorCounterpartyId'] = autoSave.linkCounterpartyId;
      if (autoSave?.fillEntityKind && !data['vendorEntityKindSnapshot']) data['vendorEntityKindSnapshot'] = autoSave.fillEntityKind;
      // Slice 2 (§5 row 2): compare the buyer block this read printed with the company registry.
      // Written whenever there is a block to judge — this read's, or an earlier one a re-read of a
      // page without it has to replace. Warn-only: no tax or claim column moves because of it (E11).
      if (completed.buyerAsPrinted || currentExpense.buyerAsPrintedJson) {
        data['buyerAsPrintedJson'] = await recheckBuyerAsPrinted({
          printed: completed.buyerAsPrinted,
          previous: currentExpense.buyerAsPrintedJson,
          readRegistry: () => this.expenses.getSubstituteCompanyContext(ctx.companyId, currentExpense.branchId ?? null),
          checkedAt: new Date().toISOString(),
        });
      }
      const priorWht = currentExpense.whtInputJson as ExpenseWhtCapture | null;
      // A rerun may change line order/count. Never attach reviewed tax meaning to a new OCR row
      // by index, or erase a saved whole-bill amount/mixed historical rates with provider output.
      const priorVat = currentExpense.vatCaptureSnapshotJson as ExpenseVatCaptureSnapshotV1 | null;
      const preserveReviewedLines = Boolean(currentExpense.reviewedAt)
        || (priorVat?.source.origin === 'REVIEWER' && (currentExpense.lines?.length ?? 0) > 0)
        || priorWht?.origin === 'REVIEWER'
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
          sourceTaxableAmount: keepReviewerSource ? prior.source.taxableAmount : fields.taxableAmount ?? fields.subtotalAmount ?? null,
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
        if (whtError) {
          applyExpenseWhtInput(vat, { inputType: 'AMOUNT', value: '0' });
          reviewReasons.push('ยอดภาษีหัก ณ ที่จ่ายไม่สอดคล้องกับยอดเอกสาร กรุณาตรวจในเว็บ');
          data['aiVerificationStatus'] = 'NEEDS_REVIEW';
        }
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
      // Durable PDF reads have no later synchronous summary write. Persist their date provenance
      // with the same fenced apply, so neither LINE nor source-draft review sees the upload day.
      if (options.sourceAttachmentId && options.sourceDocumentType && currentExpense.primaryAttachmentId === options.sourceAttachmentId && !currentExpense.reviewedAt) {
        const { expenseDate: _rawDate, ...recognized } = fields;
        const acceptedDate = dateReview.verified ? ((data['expenseDate'] as Date | undefined) ?? currentExpense.expenseDate)?.toISOString().slice(0, 10) : undefined;
        const missing = new Set(fields.missingFields ?? []);
        if (acceptedDate) missing.delete('expenseDate'); else missing.add('expenseDate');
        data['aiVerificationSummaryJson'] = { ...((data['aiVerificationSummaryJson'] ?? summary ?? {}) as Record<string, unknown>),
          dateStatus: dateReview.status, missingFields: [...missing],
          recognizedFields: { ...recognized, ...(acceptedDate ? { expenseDate: acceptedDate } : {}) } };
      }
      if (effectiveCategory) data['expenseCategoryId'] = effectiveCategory.id;
      const nextVatFacts = { ...currentExpense, ...data };
      Object.assign(data, await resetInputVatDecisionForType(tx, currentExpense, nextVatFacts, ctx)
        ?? await applyExpenseInputVatPreset(tx, nextVatFacts));
      await tx.expenseRecord.update({ where: { id: expenseId, companyId: ctx.companyId, ...(options.expectedUpdatedAt && { updatedAt: options.expectedUpdatedAt }) }, data });
      const acceptedAmounts = Object.fromEntries(['grandTotalAmount', 'vatAmount', 'whtAmount', 'netPayableAmount', 'vatMode', 'discountAmount']
        .map((key) => [key, String(data[key] ?? currentExpense[key as keyof typeof currentExpense] ?? (key === 'vatMode' ? 'NO_VAT' : '0'))])) as NonNullable<AppliedReceiptResult['acceptedAmounts']>;
      if (!lineTotal || preserveReviewedLines) {
        return finish({
          acceptedAmounts,
          categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
          categoryName: effectiveCategory?.name ?? null,
          categoryAutoFilled,
          ...(categorySuggestion ? { categorySuggestion } : {}),
          chargeReconciliationStatus: 'SUMMARY_LINE',
          chargesApplied: 0,
          // This apply wrote no lines, so the charges are the ones already on the record — not none.
          charges: persistedCharges,
          reviewReasons,
          dateVerified: dateReview.verified,
          dateAssumed: dateReview.assumed,
          dateStatus: dateReview.status,
          ...(dateReview.assumptions ? { dateAssumptions: dateReview.assumptions } : {}),
        });
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
      return finish({
        acceptedAmounts,
        categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
        categoryName: effectiveCategory?.name ?? null,
        categoryAutoFilled,
        ...(categorySuggestion ? { categorySuggestion } : {}),
        chargeReconciliationStatus: prepared!.status,
        ...(prepared!.itemsSumAmount ? { itemsSumAmount: prepared!.itemsSumAmount } : {}),
        chargesApplied: prepared!.chargesApplied,
        charges: expenseLineCharges(prepared!.lines.map((line) => ({ chargeKind: line.chargeKind ?? null, ...line.totals }))),
        reviewReasons,
        dateVerified: dateReview.verified,
        dateAssumed: dateReview.assumed,
        dateStatus: dateReview.status,
        ...(dateReview.assumptions ? { dateAssumptions: dateReview.assumptions } : {}),
      });
    });
    if ('stale' in appliedCategory) {
      // F12: one honest shape, no cast that omits half the fields. Nothing was applied, so this
      // outcome verified no date and raised no reason — but the record's own charge rows are real
      // and the caller's card must be able to print them.
      return {
        staleSkipped: true, candidatesCreated: 0,
        categoryId: null, categoryName: null, categoryAutoFilled: false,
        chargeReconciliationStatus: 'SUMMARY_LINE', chargesApplied: 0, charges: appliedCategory.stale,
        reviewReasons: [], dateVerified: false, dateAssumed: false, dateStatus: 'unverified',
      };
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
    return appliedCategory;
  }
}
