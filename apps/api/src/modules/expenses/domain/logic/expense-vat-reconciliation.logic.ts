import Decimal from 'decimal.js';
import {
  EXPENSE_MAX_ITEM_LINES,
  EXPENSE_VAT_SOURCE_INPUT_TYPES,
  type ExpenseLineChargeKind,
  type ExpenseVatCaptureSnapshotV1,
  type ExpenseVatMode,
  type ExpenseVatSourceInput,
  type ExpenseVatSourceOrigin,
  type ExpenseVatSourceOverrideInput,
} from '@watchdog-bms/contracts';
import { EXPENSE_TOTALS_TOLERANCE, calcDocumentTotals, calcLineTotals, documentTotalsLines, type LineTotalsResult } from './expense-totals.logic';
import type { ExpenseRecordWithRelations } from '../models/expense.model';
import { EXPENSE_DECIMAL_18_4_PATTERN, validateExpenseDraftAmounts } from './expense-draft-amount-validation.logic';
import { applyExpenseWhtInput } from './expense-wht-input.logic';

const TOLERANCE = EXPENSE_TOTALS_TOLERANCE;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const PERCENT = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

export type ExpenseVatReconciliationLineInput = {
  lineNumber: number;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string | null;
  whtRate?: string | null;
  /** §5.1: an additional-charge row. Reconciles like any other line; only the document subtotal
   *  treats it differently. */
  chargeKind?: ExpenseLineChargeKind | null;
};

export type ExpenseVatReconciliationResult = {
  lines: Array<{
    lineNumber: number;
    vatRate: string | null;
    /** Kept beside `totals`, not inside it: the accepted-VAT confirm path writes `totals` straight
     *  into Prisma and sweeps its values as amounts, and a charge kind is neither. */
    chargeKind?: ExpenseLineChargeKind | null;
    totals: LineTotalsResult;
  }>;
  totals: ReturnType<typeof calcDocumentTotals>;
  snapshot: ExpenseVatCaptureSnapshotV1;
};

function decimal(value: string | null | undefined): Decimal {
  try {
    const result = new Decimal(value ?? 0);
    return result.isFinite() ? result : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function money4(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4);
}

function rate4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function percent4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function sourceHasRate(input: { inputType: string }): boolean {
  return input.inputType === 'RATE' || input.inputType === 'BOTH';
}

function sourceHasAmount(input: { inputType: string }): boolean {
  return input.inputType === 'AMOUNT' || input.inputType === 'BOTH';
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Runtime boundary guard: controller bodies use contract types, so ERP Core validates again. */
export function validateExpenseVatSourceInput(
  value: unknown,
  vatMode: ExpenseVatMode,
  lineNumbers: number[],
): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'vatSource must be an object.';
  const source = value as Record<string, unknown>;
  if (!allowedKeys(source, ['inputType', 'vatRatePercent', 'vatAmount', 'lines'])) {
    return 'vatSource contains server-owned or unsupported fields.';
  }
  if (!EXPENSE_VAT_SOURCE_INPUT_TYPES.includes(source['inputType'] as any)) {
    return 'vatSource.inputType is invalid.';
  }
  const inputType = source['inputType'] as ExpenseVatSourceInput['inputType'];
  const rate = source['vatRatePercent'];
  const amount = source['vatAmount'];
  if (sourceHasRate({ inputType }) !== (typeof rate === 'string' && PERCENT.test(rate))) {
    return inputType + ' requires exactly the matching vatRatePercent field.';
  }
  if (sourceHasAmount({ inputType }) !== (typeof amount === 'string' && MONEY.test(amount))) {
    return inputType + ' requires exactly the matching vatAmount field.';
  }
  const lines = source['lines'];
  if (lines !== undefined) {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > EXPENSE_MAX_ITEM_LINES) {
      return `vatSource.lines must contain 1 to ${EXPENSE_MAX_ITEM_LINES} entries.`;
    }
    if (inputType !== 'NONE' || rate !== undefined || amount !== undefined) {
      return 'Use either document VAT source or line VAT sources, not both.';
    }
    const known = new Set(lineNumbers);
    const seen = new Set<number>();
    for (const raw of lines) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Each VAT line source must be an object.';
      const line = raw as Record<string, unknown>;
      if (!allowedKeys(line, ['lineNumber', 'inputType', 'vatRatePercent', 'vatAmount'])) {
        return 'VAT line source contains server-owned or unsupported fields.';
      }
      const lineNumber = line['lineNumber'];
      if (!Number.isInteger(lineNumber) || !known.has(lineNumber as number) || seen.has(lineNumber as number)) {
        return 'VAT line source must reference one unique line in this expense.';
      }
      seen.add(lineNumber as number);
      const error = validateExpenseVatSourceInput(
        { inputType: line['inputType'], vatRatePercent: line['vatRatePercent'], vatAmount: line['vatAmount'] },
        vatMode,
        [],
      );
      if (error) return error;
    }
  }
  const positiveSource = (typeof rate === 'string' && decimal(rate).gt(0))
    || (typeof amount === 'string' && decimal(amount).gt(0))
    || (Array.isArray(lines) && lines.some((line) => line && typeof line === 'object'
      && ((typeof (line as Record<string, unknown>)['vatRatePercent'] === 'string'
        && decimal((line as Record<string, string>)['vatRatePercent']).gt(0))
        || (typeof (line as Record<string, unknown>)['vatAmount'] === 'string'
          && decimal((line as Record<string, string>)['vatAmount']).gt(0)))));
  if ((vatMode === 'NO_VAT' || vatMode === 'EXEMPT') && positiveSource) {
    return 'NO_VAT and EXEMPT expenses cannot contain a positive VAT source rate or amount.';
  }
  return null;
}

export function vatSourceFromSnapshot(
  snapshot: ExpenseVatCaptureSnapshotV1 | null | undefined,
): ExpenseVatSourceInput | undefined {
  if (!snapshot || snapshot.version !== 1) return undefined;
  const lines = snapshot.source.lineSources?.map((line) => ({
    lineNumber: line.lineNumber,
    inputType: line.inputType,
    ...(line.vatRatePercent !== undefined && { vatRatePercent: line.vatRatePercent }),
    ...(line.vatAmount !== undefined && { vatAmount: decimal(line.vatAmount).toDecimalPlaces(2).toFixed(2) }),
  }));
  return {
    inputType: snapshot.source.inputType,
    ...(snapshot.source.vatRatePercent !== null && { vatRatePercent: snapshot.source.vatRatePercent }),
    ...(snapshot.source.vatAmount !== null && { vatAmount: decimal(snapshot.source.vatAmount).toDecimalPlaces(2).toFixed(2) }),
    ...(lines?.length && { lines }),
  };
}

function fractionFromPercent(value: string): string {
  return rate4(decimal(value).div(100));
}

function rawAfterDiscount(line: ExpenseVatReconciliationLineInput): Decimal {
  const subtotal = decimal(line.quantity).mul(decimal(line.unitPrice)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const discount = Decimal.min(decimal(line.discountAmount), Decimal.max(subtotal, 0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return subtotal.minus(discount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function derivedFraction(vatMode: ExpenseVatMode, grossOrBase: Decimal, vat: Decimal): string | null {
  if (vat.eq(0)) return '0.0000';
  const base = vatMode === 'VAT_INCLUDED' ? grossOrBase.minus(vat) : grossOrBase;
  if (base.lte(0)) return null;
  const rate = vat.div(base);
  return rate.gte(0) && rate.lt(1) ? rate4(rate) : null;
}

type ReconciledLine = { lineNumber: number; vatRate: string | null; totals: LineTotalsResult };

/**
 * Plan 13.11.B: the residual belongs to the largest VAT base, tie-broken by line number, and never
 * to a no-VAT line — ผัก/ผลไม้ on a mixed receipt must stay at exactly zero however the satang fall.
 * The same line is the one a mismatch points the reviewer at.
 */
function largestVatBaseLine<T extends ReconciledLine>(lines: readonly T[]): T | undefined {
  return lines
    .filter((line) => decimal(line.vatRate).gt(0))
    .sort((left, right) => decimal(right.totals.taxableAmount).cmp(left.totals.taxableAmount)
      || left.lineNumber - right.lineNumber)[0];
}

/** Plan 13.11.B: name the line(s) to fix. Unknown treatments win — guessing them is forbidden. */
function attentionLines(
  status: ExpenseVatCaptureSnapshotV1['reconciliation']['status'],
  calculated: readonly ReconciledLine[],
  mismatchedSourceLines: readonly number[],
): number[] {
  if (status !== 'MISMATCH' && status !== 'NEEDS_REVIEW' && status !== 'SOURCE_ONLY') return [];
  const unknown = calculated.filter((line) => line.vatRate === null).map((line) => line.lineNumber);
  if (unknown.length) return unknown;
  if (mismatchedSourceLines.length) return [...mismatchedSourceLines];
  const target = largestVatBaseLine(calculated);
  return target ? [target.lineNumber] : [];
}

function recomputeAcceptedTotals(
  totals: LineTotalsResult,
  vatMode: ExpenseVatMode,
  whtRate: string | null | undefined,
  acceptedVat: Decimal,
): LineTotalsResult | null {
  const calculatedTaxable = decimal(totals.taxableAmount);
  const calculatedGross = decimal(totals.lineTotalAmount);
  const taxable = vatMode === 'VAT_INCLUDED'
    ? calculatedGross.minus(acceptedVat)
    : calculatedTaxable;
  // Tolerance is not permission to make a tiny VAT carrier's base (or tax) negative.
  if (taxable.lt(0) || acceptedVat.lt(0)) return null;
  const wht = taxable.mul(decimal(whtRate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    ...totals,
    taxableAmount: money4(taxable),
    vatAmount: money4(acceptedVat),
    whtAmount: money4(wht),
    lineTotalAmount: money4(taxable.plus(acceptedVat)),
  };
}

/** Explicit reviewer decision, never a tolerance bypass for Tax Code/evidence validation.
 * Called on the authoritative CAS re-read before FINAL tax resolution and persistence. */
export function acceptExpenseVatSource(
  expense: ExpenseRecordWithRelations,
  decision: Pick<ExpenseVatSourceOverrideInput, 'reason' | 'vatLineNumber'>,
): ExpenseVatReconciliationResult {
  const snapshot = expense.vatCaptureSnapshotJson;
  const source = snapshot?.source;
  const fail = (message: string): never => { throw new Error(message); };
  if (!snapshot || snapshot.version !== 1 || !['MISMATCH', 'NEEDS_REVIEW'].includes(snapshot.reconciliation.status)
    || !['VAT_INCLUDED', 'VAT_EXCLUDED'].includes(expense.vatMode)
    || !source || !sourceHasAmount(source) || source.lineSources?.length
    || typeof source.vatAmount !== 'string' || !EXPENSE_DECIMAL_18_4_PATTERN.test(source.vatAmount)
    || new Decimal(source.vatAmount).decimalPlaces() > 2) {
    return fail('A current document VAT amount is required; resolve missing or line-level VAT evidence first.');
  }
  if (!decision.reason?.trim() || decision.reason.trim().length > 500 || !Number.isSafeInteger(decision.vatLineNumber)) {
    return fail('A written reason and a VAT-bearing line are required.');
  }
  const amountError = validateExpenseDraftAmounts(expense);
  if (amountError) return fail(amountError);
  if (!expense.lines.length || expense.lines.some((line) => !line.vatRate?.trim())) {
    return fail('Every line must have an explicit VAT rate before accepting document VAT.');
  }
  if (sourceHasRate(source) && (typeof source.vatRatePercent !== 'string'
    || !PERCENT.test(source.vatRatePercent)
    || expense.lines.some((line) => decimal(line.vatRate).gt(0)
      && decimal(line.vatRate).minus(decimal(source.vatRatePercent).div(100)).abs().gt('0.00005')))) {
    return fail('The printed VAT rate conflicts with the expense lines; correct the rate before confirmation.');
  }
  const result = reconcileExpenseVat({ vatMode: expense.vatMode, lines: expense.lines, source: vatSourceFromSnapshot(snapshot) });
  const baselineWhtError = applyExpenseWhtInput(result, expense.whtInputJson);
  if (baselineWhtError) return fail(baselineWhtError);
  const same = (left: string | undefined, right: string): boolean =>
    typeof left === 'string' && EXPENSE_DECIMAL_18_4_PATTERN.test(left) && new Decimal(left).eq(right);
  if (!same(snapshot.calculation.vatAmount, result.snapshot.calculation.vatAmount)
    || !same(snapshot.calculation.preVatAmount, result.snapshot.calculation.preVatAmount)
    || !same(snapshot.calculation.grossAmount, result.snapshot.calculation.grossAmount)
    || Object.entries(result.totals).some(([key, value]) => !same(expense[key as keyof typeof result.totals], value))
    || result.lines.some((line) => {
      const current = expense.lines.find((item) => item.lineNumber === line.lineNumber);
      return !current || Object.entries(line.totals).some(([key, value]) => !same(current[key as keyof LineTotalsResult], value));
    })) {
    return fail('The saved VAT calculation no longer matches the expense. Save and review the current lines again.');
  }
  const target = result.lines.find((line) => line.lineNumber === decision.vatLineNumber);
  const current = expense.lines.find((line) => line.lineNumber === decision.vatLineNumber);
  if (!target || !current || current.vatTreatment || !decimal(target.vatRate).gt(0)) {
    return fail('The selected line must bear VAT; zero-rated, exempt and non-VAT lines cannot carry the difference.');
  }
  const residual = new Decimal(source.vatAmount).minus(result.totals.vatAmount);
  const adjusted = recomputeAcceptedTotals(target.totals, expense.vatMode, current.whtRate,
    new Decimal(target.totals.vatAmount).plus(residual));
  if (!adjusted) return fail('Document VAT would make the selected line VAT or pre-VAT amount negative.');
  target.totals = adjusted;
  result.totals = calcDocumentTotals({ lines: documentTotalsLines(result.lines) });
  const whtError = applyExpenseWhtInput(result, expense.whtInputJson);
  if (whtError) return fail(whtError);
  if ([...Object.values(result.totals), ...result.lines.flatMap((line) => Object.values(line.totals))]
    .some((value) => !EXPENSE_DECIMAL_18_4_PATTERN.test(value))) {
    return fail('Accepted document amounts must be non-negative and fit Decimal(18,4).');
  }
  result.snapshot = {
    ...snapshot,
    calculation: {
      ...snapshot.calculation,
      lineResults: result.snapshot.calculation.lineResults.map((line) => {
        const accepted = result.lines.find((item) => item.lineNumber === line.lineNumber)!;
        return { ...line, acceptedTaxableAmount: accepted.totals.taxableAmount,
          acceptedVatAmount: accepted.totals.vatAmount,
          residualAdjustment: money4(new Decimal(accepted.totals.vatAmount).minus(line.calculatedVatAmount)) };
      }),
    },
    reconciliation: { ...snapshot.reconciliation, status: 'REVIEWER_ACCEPTED', acceptedSource: 'SOURCE_AMOUNT', attentionLineNumbers: [] },
  };
  return result;
}

export function reconcileExpenseVat(input: {
  vatMode: ExpenseVatMode;
  lines: ExpenseVatReconciliationLineInput[];
  source?: ExpenseVatSourceInput;
  sourceOrigin?: ExpenseVatSourceOrigin;
  sourceTaxableAmount?: string | null;
  sourceGrossAmount?: string | null;
  sourceEvidenceRefs?: string[];
  capturedAt?: string;
}): ExpenseVatReconciliationResult {
  const source = input.source ?? { inputType: 'NONE' };
  const rates = new Map(input.lines.map((line) => [line.lineNumber, line.vatRate?.trim() || null]));
  const lineSources = new Map((source.lines ?? []).map((line) => [line.lineNumber, line]));
  let documentAmountNeedsAllocation = false;

  for (const line of input.lines) {
    const lineSource = lineSources.get(line.lineNumber);
    if (lineSource && sourceHasRate(lineSource)) {
      rates.set(line.lineNumber, fractionFromPercent(lineSource.vatRatePercent!));
    }
  }

  if (!source.lines?.length && sourceHasRate(source)) {
    const rate = fractionFromPercent(source.vatRatePercent!);
    // A document rate describes the taxable portion. Preserve explicit per-line treatments
    // (for example a 0%-VAT tip); web review already updates every line when the reviewer means
    // to replace the whole document rate.
    for (const line of input.lines) {
      if (rates.get(line.lineNumber) === null) rates.set(line.lineNumber, rate);
    }
  } else if (!source.lines?.length && source.inputType === 'AMOUNT'
    && (input.vatMode === 'VAT_INCLUDED' || input.vatMode === 'VAT_EXCLUDED')) {
    const rateValues = [...rates.values()];
    const knownRateCount = rateValues.filter((rate) => rate !== null).length;
    if (knownRateCount === 0) {
      const beforeVat = input.lines.reduce((sum, line) => sum.plus(rawAfterDiscount(line)), new Decimal(0));
      const derived = derivedFraction(input.vatMode, beforeVat, decimal(source.vatAmount));
      if (derived !== null) for (const line of input.lines) rates.set(line.lineNumber, derived);
    } else if (knownRateCount < rateValues.length) {
      // An amount alone cannot tell us how to allocate VAT between a known 0%/taxable line and
      // an unknown line. Keep the explicit treatment intact and ask for line-level evidence.
      documentAmountNeedsAllocation = true;
    }
  }

  for (const line of input.lines) {
    const lineSource = lineSources.get(line.lineNumber);
    if (!lineSource || lineSource.inputType !== 'AMOUNT' || rates.get(line.lineNumber) !== null) continue;
    const derived = derivedFraction(input.vatMode, rawAfterDiscount(line), decimal(lineSource.vatAmount));
    if (derived !== null) rates.set(line.lineNumber, derived);
  }

  const calculated = input.lines.map((line) => ({
    lineNumber: line.lineNumber,
    vatRate: rates.get(line.lineNumber) ?? null,
    whtRate: line.whtRate,
    chargeKind: line.chargeKind ?? null,
    totals: calcLineTotals({ ...line, vatRate: rates.get(line.lineNumber), vatMode: input.vatMode }),
  }));
  const calculatedTotals = calcDocumentTotals({ lines: documentTotalsLines(calculated) });
  const accepted = calculated.map((line) => ({ ...line, totals: { ...line.totals } }));
  const residuals = new Map(calculated.map((line) => [line.lineNumber, new Decimal(0)]));
  const knownLineNumbers = new Set(input.lines.map((line) => line.lineNumber));
  const hasUnmappedLineSource = Boolean(source.lines?.some((line) => !knownLineNumbers.has(line.lineNumber)));
  let status: ExpenseVatCaptureSnapshotV1['reconciliation']['status'] =
    input.vatMode === 'NO_VAT' || input.vatMode === 'EXEMPT' ? 'NOT_APPLICABLE' : 'CALCULATED_ONLY';
  let acceptedSource: ExpenseVatCaptureSnapshotV1['reconciliation']['acceptedSource'] =
    status === 'NOT_APPLICABLE' ? null : 'CALCULATED';
  let difference: Decimal | null = null;
  const documentSourceRate = !source.lines?.length && sourceHasRate(source)
    ? decimal(source.vatRatePercent).div(100)
    : null;
  const positiveCalculatedRates = new Set(calculated
    .map((line) => line.vatRate)
    .filter((rate): rate is string => rate !== null && decimal(rate).gt(0)));
  const comparableCalculatedRates = positiveCalculatedRates.size > 0
    ? positiveCalculatedRates
    : new Set(calculated.map((line) => line.vatRate).filter((rate): rate is string => rate !== null));
  const rateMismatch = documentSourceRate !== null && comparableCalculatedRates.size > 0
    && [...comparableCalculatedRates].some((rate) => decimal(rate).minus(documentSourceRate).abs().gt('0.00005'));

  const mismatchedSourceLines: number[] = [];
  if (source.lines?.length) {
    let mismatch = false;
    let matchedAmount = false;
    for (const lineSource of source.lines) {
      if (!sourceHasAmount(lineSource)) continue;
      const target = accepted.find((line) => line.lineNumber === lineSource.lineNumber);
      if (!target) continue;
      const diff = decimal(lineSource.vatAmount).minus(target.totals.vatAmount);
      if ((decimal(lineSource.vatAmount).gt(0) && target.vatRate !== null && decimal(target.vatRate).eq(0))
        || diff.abs().gt(TOLERANCE)) {
        mismatch = true;
        mismatchedSourceLines.push(lineSource.lineNumber);
        continue;
      }
      const adjusted = recomputeAcceptedTotals(target.totals, input.vatMode, target.whtRate, decimal(lineSource.vatAmount));
      if (!adjusted) {
        mismatch = true;
        mismatchedSourceLines.push(lineSource.lineNumber);
        continue;
      }
      matchedAmount = true;
      if (!hasUnmappedLineSource) {
        residuals.set(target.lineNumber, diff);
        target.totals = adjusted;
      }
    }
    status = mismatch ? 'MISMATCH' : hasUnmappedLineSource ? 'NEEDS_REVIEW' : matchedAmount ? 'MATCHED' : 'CALCULATED_ONLY';
    acceptedSource = mismatch || hasUnmappedLineSource || !matchedAmount ? 'CALCULATED' : 'SOURCE_AMOUNT';
    const sourceAmount = source.lines
      .filter(sourceHasAmount)
      .reduce((sum, line) => sum.plus(decimal(line.vatAmount)), new Decimal(0));
    const calculatedSourceAmount = source.lines
      .filter(sourceHasAmount)
      .reduce((sum, lineSource) => sum.plus(
        calculated.find((line) => line.lineNumber === lineSource.lineNumber)?.totals.vatAmount ?? 0,
      ), new Decimal(0));
    difference = source.lines.some(sourceHasAmount)
      ? sourceAmount.minus(calculatedSourceAmount)
      : null;
  } else if (sourceHasAmount(source)) {
    difference = decimal(source.vatAmount).minus(calculatedTotals.vatAmount);
    const distinctRates = new Set(calculated.map((line) => line.vatRate).filter((rate): rate is string => rate !== null));
    const onlyExplicitZeroRates = calculated.length > 0
      && calculated.every((line) => line.vatRate !== null && decimal(line.vatRate).eq(0));
    // Plan 13.11.B: one positive rate beside explicit no-VAT lines is the ordinary Thai mixed
    // receipt — 7% goods plus exempt ผัก/ผลไม้. Every treatment is known and only one rate can carry
    // the difference, so the deterministic residual below is the correct answer rather than a guess.
    // Several positive rates, or any unknown line, still have no single answer and stay in review.
    const singleRateMixedDocument = calculated.length > 0
      && calculated.every((line) => line.vatRate !== null)
      && positiveCalculatedRates.size === 1;
    if (rateMismatch || (decimal(source.vatAmount).gt(0) && onlyExplicitZeroRates)) {
      status = 'MISMATCH';
    } else if (documentAmountNeedsAllocation) {
      status = 'NEEDS_REVIEW';
    } else if (distinctRates.size > 1 && !difference.eq(0) && !singleRateMixedDocument) {
      status = 'NEEDS_REVIEW';
    } else if (difference.abs().gt(TOLERANCE)
      // A complete single-rate bill can round VAT once for the document rather than per row.
      // Prove both printed amounts from the unchanged base; never widen a mismatch tolerance.
      && !(distinctRates.size === 1 && calculated.every(line => line.vatRate !== null)
        && input.vatMode === 'VAT_EXCLUDED' && input.sourceTaxableAmount != null && input.sourceGrossAmount != null
        && decimal(input.sourceTaxableAmount).eq(calculatedTotals.taxableAmount)
        && decimal(calculatedTotals.taxableAmount).mul(decimal(calculated[0]?.vatRate))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(decimal(source.vatAmount))
        && decimal(input.sourceGrossAmount).eq(decimal(calculatedTotals.taxableAmount).plus(decimal(source.vatAmount))))) {
      status = 'MISMATCH';
    } else {
      status = 'MATCHED';
      acceptedSource = 'SOURCE_AMOUNT';
      const target = largestVatBaseLine(accepted);
      if (target) {
        const adjusted = recomputeAcceptedTotals(
          target.totals,
          input.vatMode,
          target.whtRate,
          decimal(target.totals.vatAmount).plus(difference),
        );
        if (adjusted) {
          residuals.set(target.lineNumber, difference);
          target.totals = adjusted;
        } else {
          status = 'MISMATCH';
          acceptedSource = 'CALCULATED';
        }
      } else if (!decimal(source.vatAmount).eq(0)) {
        status = 'SOURCE_ONLY';
        acceptedSource = 'CALCULATED';
      }
    }
  } else if (rateMismatch) {
    status = 'MISMATCH';
  }

  const totals = calcDocumentTotals({ lines: documentTotalsLines(accepted) });
  const attention = attentionLines(status, calculated, mismatchedSourceLines);
  const knownRates = new Set(accepted.map((line) => line.vatRate).filter((rate): rate is string => rate !== null));
  const allKnownRatesAreZero = knownRates.size > 0 && [...knownRates].every((rate) => decimal(rate).eq(0));
  const effectiveRate = knownRates.size === 1 ? decimal([...knownRates][0]).mul(100) : null;
  const vatBase = calculated
    .filter((line) => decimal(line.vatRate).gt(0))
    .reduce((sum, line) => sum.plus(line.totals.taxableAmount), new Decimal(0));
  const normalizedSourceAmount = sourceHasAmount(source)
    ? money4(decimal(source.vatAmount))
    : null;
  const normalizedSourceRate = sourceHasRate(source) ? percent4(decimal(source.vatRatePercent)) : null;
  const sourceOrigin = input.sourceOrigin ?? 'REVIEWER';

  return {
    // `chargeKind` travels with the row, not just into `totals` above: `acceptExpenseVatSource` and
    // `applyExpenseWhtInput` both re-derive the header from these rows, and without the flag every
    // charge would be counted into `subtotalAmount` as goods (spec §5.1). `whtRate` stays behind —
    // it is an input, and the accepted-VAT confirm path writes what it finds here into Prisma.
    lines: accepted.map(({ lineNumber, vatRate, chargeKind, totals: lineTotals }) =>
      ({ lineNumber, vatRate, chargeKind, totals: lineTotals })),
    totals,
    snapshot: {
      version: 1,
      source: {
        inputType: source.inputType,
        origin: sourceOrigin,
        vatRatePercent: normalizedSourceRate,
        vatAmount: normalizedSourceAmount,
        taxableAmount: input.sourceTaxableAmount ?? null,
        grossAmount: input.sourceGrossAmount ?? null,
        capturedAt: input.capturedAt ?? new Date().toISOString(),
        ...(input.sourceEvidenceRefs?.length && { evidenceRefs: input.sourceEvidenceRefs.slice(0, 20) }),
        ...(source.lines?.length && {
          lineSources: source.lines.map((line) => ({
            ...line,
            ...(sourceHasRate(line) && { vatRatePercent: percent4(decimal(line.vatRatePercent)) }),
            ...(sourceHasAmount(line) && { vatAmount: money4(decimal(line.vatAmount)) }),
            origin: sourceOrigin,
          })),
        }),
      },
      calculation: {
        formula: (input.vatMode === 'VAT_INCLUDED' || input.vatMode === 'VAT_EXCLUDED') && allKnownRatesAreZero ? 'ZERO'
          : input.vatMode === 'VAT_INCLUDED' ? knownRates.size > 1 ? 'MIXED' : 'INCLUDED'
            : input.vatMode === 'VAT_EXCLUDED' ? knownRates.size > 1 ? 'MIXED' : 'EXCLUDED'
            : input.vatMode === 'NO_VAT' || input.vatMode === 'EXEMPT' ? 'NOT_APPLICABLE'
              : 'MIXED',
        vatRatePercent: effectiveRate === null ? null : percent4(effectiveRate),
        preVatAmount: calculatedTotals.taxableAmount,
        vatBaseAmount: money4(vatBase),
        vatAmount: calculatedTotals.vatAmount,
        grossAmount: calculatedTotals.grandTotalAmount,
        lineResults: calculated.map((line) => ({
          lineNumber: line.lineNumber,
          vatRatePercent: line.vatRate === null ? null : percent4(decimal(line.vatRate).mul(100)),
          calculatedTaxableAmount: line.totals.taxableAmount,
          acceptedTaxableAmount: accepted.find((item) => item.lineNumber === line.lineNumber)!.totals.taxableAmount,
          calculatedVatAmount: line.totals.vatAmount,
          acceptedVatAmount: accepted.find((item) => item.lineNumber === line.lineNumber)!.totals.vatAmount,
          residualAdjustment: money4(residuals.get(line.lineNumber) ?? new Decimal(0)),
        })),
        roundingMode: 'HALF_UP',
        decimalPlaces: 2,
        calculationVersion: 'expense-vat-v1',
      },
      reconciliation: {
        status,
        acceptedSource,
        differenceAmount: difference === null ? null : money4(difference),
        toleranceAmount: '0.05',
        ...(attention.length && { attentionLineNumbers: attention }),
      },
    },
  };
}
