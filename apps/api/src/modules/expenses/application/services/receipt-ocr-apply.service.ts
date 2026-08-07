import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  RECEIPT_ADDITIONAL_CHARGE_KINDS,
  RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
  type ExpenseVatMode,
  type ReceiptOcrFieldResult,
} from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { reconcileExpenseDuplicateCandidates } from './expense-duplicate-detection';
import { calcDocumentTotals, calcLineTotals } from '../../domain/logic/expense-totals.logic';

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

const VAT_TOLERANCE = 0.05;
const MAX_IMPLIED_VAT_RATE = 0.2;
const MAX_OCR_ADDITIONAL_CHARGES = 10;

function positiveMoney(value: string | undefined): number | undefined {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
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

function completeWhtFields(fields: ReceiptOcrFieldResult): ReceiptOcrFieldResult {
  const out = { ...fields };
  const grand = positiveMoney(fields.grandTotalAmount);
  const taxable = positiveMoney(fields.taxableAmount) ?? grand;
  const wht = positiveMoney(fields.whtAmount);
  if (!grand || !taxable || !wht || wht > grand) {
    delete out.whtAmount;
    delete out.whtRate;
    return out;
  }
  const printed = Number.parseFloat(String(fields.whtRate ?? ''));
  const printedUsable = Number.isFinite(printed) && printed > 0 && printed < 1
    && Math.abs(taxable * printed - wht) <= VAT_TOLERANCE;
  const derived = wht / taxable;
  const rate = printedUsable ? printed : derived > 0 && derived < 1 ? derived : undefined;
  if (rate === undefined) {
    delete out.whtAmount;
    delete out.whtRate;
  } else {
    out.whtRate = rate.toFixed(4);
  }
  return out;
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

export type ReceiptChargeReconciliationStatus =
  | 'SUMMARY_LINE'
  | 'RECONCILED_CHARGE_LINES'
  | 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW';

type PreparedOcrLine = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string | null;
  whtRate: string | null;
  sourceLineText?: string;
  aiLineConfidence?: number;
  totals: ReturnType<typeof calcLineTotals>;
};

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

function closeEnough(actual: string, expected: string | undefined): boolean {
  if (!expected) return true;
  return Math.abs(Number(actual) - Number(toMoney4(expected))) <= VAT_TOLERANCE;
}

function prepareOcrLines(
  fields: ReceiptOcrFieldResult,
  lineTotal: string,
): {
  status: ReceiptChargeReconciliationStatus;
  lines: PreparedOcrLine[];
  totals: ReturnType<typeof calcDocumentTotals>;
} {
  const vatMode = documentVatMode(fields);
  const whtRate = fields.whtRate ?? null;
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
      ...charges.map((charge) => prepareLine({
        description: charge.description,
        quantity: '1.0000',
        unitPrice: toMoney4(charge.amount),
        vatRate: charge.vatRate ?? defaultLineVatRate(fields),
        whtRate,
        sourceLineText: charge.evidenceSignal,
        aiLineConfidence: charge.confidence,
      }, vatMode)),
    ];
    const totals = calcDocumentTotals({ lines: candidate.map((line) => line.totals) });
    const candidateVatRates = new Set(candidate.map((line) => line.vatRate ?? ''));
    const taxableIsComparable = candidateVatRates.size <= 1;
    if (
      closeEnough(totals.grandTotalAmount, fields.grandTotalAmount)
      && (!taxableIsComparable || closeEnough(totals.taxableAmount, fields.taxableAmount))
      && closeEnough(totals.vatAmount, fields.vatAmount)
      && closeEnough(totals.whtAmount, fields.whtAmount)
    ) {
      return { status: 'RECONCILED_CHARGE_LINES', lines: candidate, totals };
    }
  }

  const summaryVatRate = summaryLineVatRate(fields);
  const summary = prepareLine({
    description: fields.description ?? 'รายการตามใบเสร็จ (AI สรุปยอดรวม)',
    quantity: toMoney4(fields.quantity ?? '1'),
    unitPrice: deriveUnitPrice(fields, lineTotal, summaryVatRate),
    vatRate: summaryVatRate,
    whtRate,
  }, vatMode, toMoney4(fields.discountAmount));
  return {
    status: hadChargeSuggestions ? 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW' : 'SUMMARY_LINE',
    lines: [summary],
    totals: calcDocumentTotals({ lines: [summary.totals] }),
  };
}

type ReceiptCategoryFallback = {
  expenseCategoryId: string;
  confidence: number;
};

type AppliedReceiptCategory = {
  categoryId: string | null;
  categoryName: string | null;
  categoryAutoFilled: boolean;
};

type AppliedReceiptResult = AppliedReceiptCategory & {
  chargeReconciliationStatus: ReceiptChargeReconciliationStatus;
  chargesApplied: number;
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
    options: { fallbackCategorySuggestion?: ReceiptCategoryFallback; expectedUpdatedAt?: Date } = {},
  ): Promise<ReceiptOcrApplyOutcome> {
    const completed = completeWhtFields(completeVatFields(verifyDiscountAmount(fields)));
    const lineTotal = completed.grandTotalAmount ?? completed.subtotalAmount;
    const prepared = lineTotal ? prepareOcrLines(completed, lineTotal) : null;
    const data: Record<string, unknown> = {
      aiVerificationStatus: 'PARTIAL',
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
    if (prepared) {
      Object.assign(data, prepared.totals);
      data['outstandingAmount'] = prepared.totals.netPayableAmount;
    }

    const appliedCategory = await this.prisma.client.$transaction(async (tx): Promise<AppliedReceiptResult | 'stale'> => {
      const currentExpense = await tx.expenseRecord.findFirst({
        where: { id: expenseId, companyId: ctx.companyId },
        select: {
          expenseCategoryId: true,
          updatedAt: true,
          expenseCategory: { select: { id: true, name: true, companyId: true } },
        },
      });
      if (options.expectedUpdatedAt && currentExpense?.updatedAt
        && currentExpense.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
        return 'stale';
      }
      if (!currentExpense) throw new NotFoundException(`Expense ${expenseId} not found`);
      let effectiveCategory = currentExpense?.expenseCategory
        && (currentExpense.expenseCategory.companyId === null || currentExpense.expenseCategory.companyId === ctx.companyId)
        ? currentExpense.expenseCategory
        : null;
      let categoryAutoFilled = false;
      if (!effectiveCategory && !currentExpense?.expenseCategoryId) {
        const ocrSuggestion = fields.categorySuggestion;
        const suggested = ocrSuggestion
          && typeof ocrSuggestion.expenseCategoryId === 'string'
          && ocrSuggestion.expenseCategoryId.length > 0
          && typeof ocrSuggestion.confidence === 'number'
          && Number.isFinite(ocrSuggestion.confidence)
          && ocrSuggestion.confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE
          && Array.isArray(ocrSuggestion.evidenceSignals)
          && ocrSuggestion.evidenceSignals.length > 0
          ? ocrSuggestion
          : options.fallbackCategorySuggestion
            && typeof options.fallbackCategorySuggestion.expenseCategoryId === 'string'
            && options.fallbackCategorySuggestion.expenseCategoryId.length > 0
            && Number.isFinite(options.fallbackCategorySuggestion.confidence)
            && options.fallbackCategorySuggestion.confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE
            ? options.fallbackCategorySuggestion
            : undefined;
        if (suggested) {
          effectiveCategory = await tx.expenseCategory.findFirst({
            where: {
              id: suggested.expenseCategoryId,
              status: 'ACTIVE',
              OR: [{ companyId: ctx.companyId }, { companyId: null }],
            },
            select: { id: true, name: true, companyId: true },
          });
          categoryAutoFilled = Boolean(effectiveCategory);
        }
      }
      if (effectiveCategory) data['expenseCategoryId'] = effectiveCategory.id;
      await tx.expenseRecord.update({ where: { id: expenseId }, data });
      if (!lineTotal) {
        return {
          categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
          categoryName: effectiveCategory?.name ?? null,
          categoryAutoFilled,
          chargeReconciliationStatus: 'SUMMARY_LINE',
          chargesApplied: 0,
        };
      }
      await tx.expenseLine.deleteMany({ where: { expenseId } });
      for (const [index, line] of prepared!.lines.entries()) {
        await tx.expenseLine.create({ data: {
          companyId: ctx.companyId,
          expenseId,
          lineNumber: index + 1,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.totals.discountAmount,
          taxableAmount: line.totals.taxableAmount,
          vatRate: line.vatRate,
          vatAmount: line.totals.vatAmount,
          whtRate: line.whtRate,
          whtAmount: line.totals.whtAmount,
          lineSubtotalAmount: line.totals.lineSubtotalAmount,
          lineTotalAmount: line.totals.lineTotalAmount,
          expenseCategoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
          sourceLineText: line.sourceLineText,
          aiLineConfidence: line.aiLineConfidence,
          reviewStatus: line.sourceLineText ? 'SUGGESTED' : 'REVIEWED',
        } });
      }
      return {
        categoryId: effectiveCategory?.id ?? currentExpense?.expenseCategoryId ?? null,
        categoryName: effectiveCategory?.name ?? null,
        categoryAutoFilled,
        chargeReconciliationStatus: prepared!.status,
        chargesApplied: prepared!.status === 'RECONCILED_CHARGE_LINES' ? prepared!.lines.length - 1 : 0,
      };
    });
    if (appliedCategory === 'stale') {
      return { staleSkipped: true, candidatesCreated: 0, categoryId: null, categoryName: null, categoryAutoFilled: false } as unknown as ReceiptOcrApplyOutcome;
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
