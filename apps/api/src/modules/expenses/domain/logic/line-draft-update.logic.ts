/**
 * Deterministic guards and arithmetic for a LINE draft edit (draft-control spec §5.4).
 *
 * A model proposes; this file decides. Three things happen here and nowhere else:
 *
 * 1. **Parsing** — a tool call arrives as loose primitives (the orchestrator's sanitizer keeps only
 *    whitelisted primitive values), so every field is re-read, re-typed and bounded here. An
 *    unparseable call is a refusal, never a best-effort write.
 * 2. **Grounding** — every number a patch writes must have been said by the user or already be on
 *    the record. The check is the correction lane's, imported rather than re-derived: two copies of
 *    a grounding rule is how one of them silently gets looser.
 * 3. **Projection** — the patch is turned into the FULL replacement line set that
 *    `UpdateExpenseDraftUseCase` expects, preserving every field of every untouched line (tax code
 *    selections included). `UpdateExpenseDraftUseCase` replaces the whole set, so a line this file
 *    forgets to copy is a line the edit deletes.
 *
 * What is deliberately NOT here: totals. They are produced by running the real use case as a
 * rolled-back transaction (see `line-draft-update.use-case.ts`), so a preview can never state a
 * number the apply would not produce.
 */
import Decimal from 'decimal.js';
import {
  EXPENSE_LINE_CHARGE_KINDS,
  EXPENSE_LINE_CHARGE_KIND_LABELS,
  expenseChargeKindAllowsNegative,
  normalizeScrubDigits,
  scrubRecordIdentifier,
  scrubRecordText,
  type CreateExpenseDraftInput,
  type ExpenseLineChargeKind,
  type ExpenseLineSummary,
  type ExpenseLineVatTreatment,
  type ExpenseVatMode,
  type LineDraftUpdateDiffField,
  type LineDraftUpdateTool,
} from '@watchdog-bms/contracts';
import { amountAppearsInEvidence, dateAppearsInEvidence, textAppearsInEvidence, type CorrectionEvidence } from './line-correction.logic';

/** The line payload `UpdateExpenseDraftInput` carries. Named so the projection below cannot drift
 *  from the contract the web form posts. */
export type DraftLineInput = CreateExpenseDraftInput['lines'][number];

export type LineDraftPatch =
  | { tool: 'expense.draft.set_header'; expenseDate?: string; vendorName?: string; documentNumber?: string; noteAppend?: string }
  | { tool: 'expense.draft.set_line'; lineNumber: number; description?: string; amount?: string; vatTreatment?: ExpenseLineVatTreatment | null; chargeKind?: ExpenseLineChargeKind | null }
  | { tool: 'expense.draft.add_charge'; kind: ExpenseLineChargeKind; amount?: string; percentOfSubtotal?: string }
  | { tool: 'expense.draft.remove_line'; lineNumber: number }
  | { tool: 'expense.draft.set_vat_mode'; vatMode: ExpenseVatMode; rate?: string };

export type LineDraftPatchParse = { ok: true; patch: LineDraftPatch } | { ok: false; reason: string };

/** A LINE note append stays short enough to read on a phone and never eats the capture provenance. */
export const DRAFT_NOTE_APPEND_MAX = 500;
/** No document this channel captures has more rows than this; a "line 900" is a misread, not an edit. */
const MAX_LINE_NUMBER = 200;
const VAT_TREATMENTS: readonly string[] = ['ZERO_RATED', 'EXEMPT', 'NON_VAT'];
const VAT_MODES: readonly string[] = ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW'];
const AMOUNT_PATTERN = /^-?\d{1,14}(\.\d{1,4})?$/;

function str(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** Accepts what the model wire can carry for a money field — a bounded numeric string or a finite
 *  number — and normalises it to the decimal string Prisma and the validators expect. */
function amount(value: unknown): string | undefined {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : str(value, 24);
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, '');
  return AMOUNT_PATTERN.test(cleaned) ? cleaned : undefined;
}

function lineNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(str(value, 8) ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_LINE_NUMBER ? parsed : undefined;
}

/** ISO date only. The receipt-mode normalizer owns every other date spelling; a tool input that is
 *  not already a resolved date is a routing bug, not something to guess at. */
function isoDate(value: unknown): string | undefined {
  const raw = str(value, 32);
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return undefined;
  const day = raw.slice(0, 10);
  return Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime()) ? undefined : day;
}

/**
 * Re-read one tool call into a typed patch, or say why not. Every branch is fail-closed: an absent
 * or malformed required field refuses the whole call rather than writing a partial edit.
 */
export function parseLineDraftPatch(tool: LineDraftUpdateTool, input: Record<string, unknown>): LineDraftPatchParse {
  const recordType = str(input['recordType'], 32) ?? 'expense';
  if (recordType !== 'expense') return { ok: false, reason: 'record_type_not_supported' };

  switch (tool) {
    case 'expense.draft.set_header': {
      const patch: Extract<LineDraftPatch, { tool: 'expense.draft.set_header' }> = { tool };
      const date = input['expenseDate'] === undefined ? undefined : isoDate(input['expenseDate']);
      if (input['expenseDate'] !== undefined && !date) return { ok: false, reason: 'invalid_expense_date' };
      if (date) patch.expenseDate = date;
      const vendor = str(input['vendorName'], 200);
      if (vendor) patch.vendorName = vendor;
      const documentNumber = str(input['documentNumber'], 60);
      if (documentNumber) patch.documentNumber = documentNumber;
      const rawNoteAppend = typeof input['noteAppend'] === 'string' ? input['noteAppend'].trim() : '';
      if (rawNoteAppend.length > DRAFT_NOTE_APPEND_MAX) return { ok: false, reason: 'note_append_too_long' };
      const noteAppend = str(rawNoteAppend, DRAFT_NOTE_APPEND_MAX);
      if (noteAppend) patch.noteAppend = noteAppend;
      const touched = Boolean(patch.expenseDate || patch.vendorName || patch.documentNumber || patch.noteAppend);
      return touched ? { ok: true, patch } : { ok: false, reason: 'no_header_field' };
    }
    case 'expense.draft.set_line': {
      const number = lineNumber(input['lineNumber']);
      if (!number) return { ok: false, reason: 'invalid_line_number' };
      const patch: Extract<LineDraftPatch, { tool: 'expense.draft.set_line' }> = { tool, lineNumber: number };
      const description = str(input['description'], 200);
      if (description) patch.description = description;
      if (input['amount'] !== undefined) {
        const value = amount(input['amount']);
        if (!value) return { ok: false, reason: 'invalid_amount' };
        patch.amount = value;
      }
      if (input['vatTreatment'] !== undefined && input['vatTreatment'] !== null) {
        const treatment = str(input['vatTreatment'], 20);
        if (!treatment || !VAT_TREATMENTS.includes(treatment)) return { ok: false, reason: 'invalid_vat_treatment' };
        patch.vatTreatment = treatment as ExpenseLineVatTreatment;
      } else if (input['vatTreatment'] === null) {
        patch.vatTreatment = null;
      }
      if (input['chargeKind'] !== undefined && input['chargeKind'] !== null) {
        const kind = str(input['chargeKind'], 32);
        if (!kind || !(EXPENSE_LINE_CHARGE_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'invalid_charge_kind' };
        patch.chargeKind = kind as ExpenseLineChargeKind;
      } else if (input['chargeKind'] === null) {
        patch.chargeKind = null;
      }
      const touched = patch.description !== undefined || patch.amount !== undefined
        || patch.vatTreatment !== undefined || patch.chargeKind !== undefined;
      return touched ? { ok: true, patch } : { ok: false, reason: 'no_line_field' };
    }
    case 'expense.draft.add_charge': {
      const kind = str(input['kind'], 32);
      if (!kind || !(EXPENSE_LINE_CHARGE_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'invalid_charge_kind' };
      const explicit = input['amount'] === undefined ? undefined : amount(input['amount']);
      if (input['amount'] !== undefined && !explicit) return { ok: false, reason: 'invalid_amount' };
      const percent = input['percentOfSubtotal'] === undefined ? undefined : amount(input['percentOfSubtotal']);
      if (input['percentOfSubtotal'] !== undefined && !percent) return { ok: false, reason: 'invalid_percent' };
      // Exactly one basis. Both would let a mismatch decide itself; neither is not an instruction.
      if (Boolean(explicit) === Boolean(percent)) return { ok: false, reason: 'charge_needs_one_basis' };
      // Bounded to (0, 100]: a "service charge" larger than the bill it is charged on is a misread
      // percent sign or a hostile number, never an instruction worth previewing.
      if (percent && !(new Decimal(percent).gt(0) && new Decimal(percent).lte(100))) {
        return { ok: false, reason: 'invalid_percent' };
      }
      return {
        ok: true,
        patch: {
          tool,
          kind: kind as ExpenseLineChargeKind,
          ...(explicit ? { amount: explicit } : {}),
          ...(percent ? { percentOfSubtotal: percent } : {}),
        },
      };
    }
    case 'expense.draft.remove_line': {
      const number = lineNumber(input['lineNumber']);
      return number ? { ok: true, patch: { tool, lineNumber: number } } : { ok: false, reason: 'invalid_line_number' };
    }
    case 'expense.draft.set_vat_mode': {
      const mode = str(input['vatMode'], 24);
      if (!mode || !VAT_MODES.includes(mode)) return { ok: false, reason: 'invalid_vat_mode' };
      const rate = input['rate'] === undefined ? undefined : amount(input['rate']);
      if (input['rate'] !== undefined && !rate) return { ok: false, reason: 'invalid_vat_rate' };
      return { ok: true, patch: { tool, vatMode: mode as ExpenseVatMode, ...(rate ? { rate } : {}) } };
    }
    default:
      return { ok: false, reason: 'unknown_tool' };
  }
}

/**
 * The value-grounding rule (spec §5.4): a number a LINE edit writes must appear in what the user
 * said this turn, or already be on the record. Strings must be a span of the message for the same
 * reason — the model selects, it never authors.
 *
 * `recordValues` is the escape hatch that keeps legitimate edits working: "ย้ายค่าบริการ 152 เป็น
 * ช่องค่าบริการ" carries a number the record already holds, so it is grounded by the record even
 * when the user did not retype it.
 */
export function groundingFailure(
  patch: LineDraftPatch,
  evidence: CorrectionEvidence[],
  recordValues: readonly string[],
): string | null {
  const groundedAmount = (value: string): boolean =>
    amountAppearsInEvidence(evidence, value)
    || recordValues.some((known) => sameAmount(known, value));
  switch (patch.tool) {
    case 'expense.draft.set_header': {
      if (patch.expenseDate && !dateAppearsInEvidence(evidence, patch.expenseDate)) return 'expenseDate';
      if (patch.vendorName && !textAppearsInEvidence(evidence, patch.vendorName)) return 'vendorName';
      if (patch.documentNumber && !textAppearsInEvidence(evidence, patch.documentNumber)) return 'documentNumber';
      if (patch.noteAppend && !textAppearsInEvidence(evidence, patch.noteAppend)) return 'noteAppend';
      return null;
    }
    case 'expense.draft.set_line': {
      if (patch.amount !== undefined && !groundedAmount(patch.amount)) return 'amount';
      if (patch.description && !textAppearsInEvidence(evidence, patch.description)) return 'description';
      return null;
    }
    case 'expense.draft.add_charge': {
      if (patch.amount !== undefined && !groundedAmount(patch.amount)) return 'amount';
      if (patch.percentOfSubtotal !== undefined && !groundedAmount(patch.percentOfSubtotal)) return 'percentOfSubtotal';
      return null;
    }
    case 'expense.draft.set_vat_mode':
      // A rate is not free text: it must have been said. The mode itself is an enum the parser
      // already bounded, and "ไม่มี VAT" carries no number to ground.
      return patch.rate !== undefined && !groundedAmount(percentOf(patch.rate)) && !groundedAmount(patch.rate) ? 'rate' : null;
    case 'expense.draft.remove_line':
      return null;
  }
}

/** "0.07" is what the column stores and "7" is what a person types; either spelling grounds the
 *  other so a correct "VAT 7%" is not refused for being written the human way. */
function percentOf(rate: string): string {
  try {
    return new Decimal(rate).mul(100).toString();
  } catch {
    return rate;
  }
}

function sameAmount(a: string, b: string): boolean {
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return false;
  }
}

/** Every number already on the record, as grounding material for the rule above. */
export function recordAmountValues(lines: readonly ExpenseLineSummary[]): string[] {
  return lines.flatMap((line) => [line.unitPrice, line.lineSubtotalAmount, line.lineTotalAmount]);
}

/** Copy one stored line into the shape the update input carries, losing nothing — a field dropped
 *  here is a field the edit silently erases. */
export function storedLineToInput(line: ExpenseLineSummary): DraftLineInput {
  return {
    lineNumber: line.lineNumber,
    description: line.description,
    ...(line.chargeKind ? { chargeKind: line.chargeKind } : {}),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    ...(line.vatRate !== null ? { vatRate: line.vatRate } : {}),
    ...(line.vatTreatment !== undefined ? { vatTreatment: line.vatTreatment ?? null } : {}),
    ...(line.whtRate ? { whtRate: line.whtRate } : {}),
    ...(line.expenseCategoryId ? { expenseCategoryId: line.expenseCategoryId } : {}),
    ...(line.accountHintKey ? { accountHintKey: line.accountHintKey } : {}),
    ...(line.taxCategory ? { taxCategory: line.taxCategory } : {}),
    ...(line.taxSnapshot?.taxCodeDefinitionId ? { taxCodeDefinitionId: line.taxSnapshot.taxCodeDefinitionId } : {}),
    ...(line.taxSnapshot?.externalTaxCode ? { externalTaxCode: line.taxSnapshot.externalTaxCode } : {}),
    ...(line.taxSnapshot?.taxContext ? { transactionContext: line.taxSnapshot.taxContext } : {}),
  };
}

export type LineDraftProjection = {
  /** Full replacement set, product rows first and charge rows renumbered after them (§5.1). */
  lines: DraftLineInput[];
  diff: LineDraftUpdateDiffField[];
  warnings: string[];
};

export type LineDraftProjectionResult = LineDraftProjection | { error: string };

const money = (value: string): string => new Decimal(value).toFixed(2);

/**
 * Every free-text value that reaches the diff — a vendor name, a document number, a line
 * description — is text somebody printed on a receipt or typed into a group chat. It is scrubbed
 * ONCE, here, because this diff is what the confirm card prints, what the confirmation reply
 * repeats and what the audit payload stores: scrubbing at any later point would leave one of the
 * three able to display a money-shaped string the server never computed.
 */
const text = (value: string | null | undefined): string | null => {
  const scrubbed = scrubRecordText(value, 60);
  return scrubbed === '' ? null : scrubbed;
};

/** A document number is the one free-text field whose DIGITS are the value, so masking them the
 *  way a name is masked would leave "ใบเสร็จ-…" and tell the reader nothing (slice C review F13). */
const identifier = (value: string | null | undefined): string | null => scrubRecordIdentifier(value, 40);

/**
 * Turn one patch into the replacement line set plus the diff a confirm card prints.
 *
 * Charge rows are re-sorted after every product row and the whole set renumbered, because
 * `validateExpenseChargeLines` refuses a charge that sorts before a product — the same rule the web
 * form obeys when it adds a charge.
 */
export function projectLineDraftPatch(
  record: { vatMode: ExpenseVatMode; lines: readonly ExpenseLineSummary[]; note: string | null; vendorNameSnapshot: string | null; vendorDocumentNumber: string | null; expenseDate: Date },
  patch: LineDraftPatch,
): LineDraftProjectionResult {
  const diff: LineDraftUpdateDiffField[] = [];
  const warnings: string[] = [];
  const current = record.lines.map(storedLineToInput);

  if (patch.tool === 'expense.draft.set_header') {
    if (patch.expenseDate) {
      diff.push({ field: 'expenseDate', label: 'วันที่เอกสาร', kind: 'date', before: record.expenseDate.toISOString().slice(0, 10), after: patch.expenseDate });
    }
    if (patch.vendorName) diff.push({ field: 'vendorName', label: 'ผู้ขาย/ผู้รับเงิน', kind: 'text', before: text(record.vendorNameSnapshot), after: text(patch.vendorName) });
    if (patch.documentNumber) diff.push({ field: 'documentNumber', label: 'เลขที่เอกสาร', kind: 'identifier', before: identifier(record.vendorDocumentNumber), after: identifier(patch.documentNumber) });
    if (patch.noteAppend) diff.push({ field: 'note', label: 'เพิ่มหมายเหตุ', kind: 'text', before: null, after: text(patch.noteAppend) });
    // Header-only: the stored lines ride along untouched so the use case's whole-set replacement is
    // a no-op on them rather than a deletion.
    return { lines: renumber(current), diff, warnings };
  }

  if (patch.tool === 'expense.draft.set_vat_mode') {
    diff.push({ field: 'vatMode', label: 'โหมด VAT', kind: 'plain', before: record.vatMode, after: patch.vatMode });
    const rate = patch.rate === undefined ? undefined : normalizeRate(patch.rate);
    if (patch.rate !== undefined && rate === undefined) return { error: 'invalid_vat_rate' };
    const next = current.map((line) => ({
      ...line,
      ...(rate !== undefined ? { vatRate: rate } : {}),
      // A stated rate and an explicit zero treatment cannot both hold; the rate the user just gave
      // is the instruction, so the stale treatment is cleared rather than failing validation.
      ...(rate !== undefined && !new Decimal(rate).isZero() ? { vatTreatment: null } : {}),
    }));
    if (rate !== undefined) diff.push({ field: 'vatRate', label: 'อัตรา VAT', kind: 'plain', before: ratePercentLabel(record.lines[0]?.vatRate ?? null), after: ratePercentLabel(rate) });
    return { lines: renumber(next), diff, warnings };
  }

  if (patch.tool === 'expense.draft.remove_line') {
    const target = record.lines.find((line) => line.lineNumber === patch.lineNumber);
    if (!target) return { error: 'line_not_found' };
    if (record.lines.length === 1) return { error: 'last_line' };
    // Two rows, not one joined string: the description is the attacker's and the amount is the
    // server's, and a renderer cannot apply two different rules to halves of one value.
    diff.push({
      field: `line.${patch.lineNumber}.description`,
      label: `ลบบรรทัด ${patch.lineNumber}${target.chargeKind ? ` (${EXPENSE_LINE_CHARGE_KIND_LABELS[target.chargeKind]})` : ''}`,
      kind: 'text',
      before: text(target.description) ?? 'รายการ',
      after: null,
    });
    diff.push({
      field: `line.${patch.lineNumber}.amount`,
      label: `ยอดบรรทัด ${patch.lineNumber} ที่จะหายไป`,
      kind: 'money',
      before: money(target.lineSubtotalAmount),
      after: null,
    });
    return { lines: renumber(current.filter((line) => line.lineNumber !== patch.lineNumber)), diff, warnings };
  }

  if (patch.tool === 'expense.draft.set_line') {
    const target = record.lines.find((line) => line.lineNumber === patch.lineNumber);
    if (!target) return { error: 'line_not_found' };
    const next = current.map((line) => {
      if (line.lineNumber !== patch.lineNumber) return line;
      const updated: DraftLineInput = { ...line };
      if (patch.description !== undefined) {
        diff.push({ field: `line.${patch.lineNumber}.description`, label: `บรรทัด ${patch.lineNumber} รายละเอียด`, kind: 'text', before: text(target.description), after: text(patch.description) });
        updated.description = patch.description;
      }
      if (patch.amount !== undefined) {
        diff.push({ field: `line.${patch.lineNumber}.amount`, label: `บรรทัด ${patch.lineNumber} จำนวนเงิน`, kind: 'money', before: money(target.lineSubtotalAmount), after: money(patch.amount) });
        // The amount a person states is the row's printed TOTAL, so it lands on a quantity-1 row.
        // Collapsing a multi-unit line is a real change to what the document says, so it is stated
        // rather than done quietly — same for a discount the row carried, which no longer has a
        // subtotal to apply to.
        if (!new Decimal(target.quantity).eq(1)) {
          diff.push({
            field: `line.${patch.lineNumber}.quantity`,
            label: `บรรทัด ${patch.lineNumber} จำนวน`,
            kind: 'plain',
            before: target.quantity,
            after: '1',
          });
        }
        if (new Decimal(target.discountAmount).gt(0)) {
          diff.push({
            field: `line.${patch.lineNumber}.discountAmount`,
            label: `บรรทัด ${patch.lineNumber} ส่วนลดที่จะถูกล้าง`,
            kind: 'money',
            before: money(target.discountAmount),
            after: money('0'),
          });
        }
        updated.quantity = '1';
        updated.unitPrice = patch.amount;
        updated.discountAmount = '0';
      }
      if (patch.vatTreatment !== undefined) {
        diff.push({ field: `line.${patch.lineNumber}.vatTreatment`, label: `บรรทัด ${patch.lineNumber} VAT`, kind: 'plain', before: target.vatTreatment ?? null, after: patch.vatTreatment });
        updated.vatTreatment = patch.vatTreatment;
        // An explicit zero treatment requires an explicit zero rate (validateExpenseLineVatTreatments).
        if (patch.vatTreatment !== null) updated.vatRate = '0';
      }
      if (patch.chargeKind !== undefined) {
        diff.push({
          field: `line.${patch.lineNumber}.chargeKind`,
          label: `บรรทัด ${patch.lineNumber} ย้ายเป็นช่องค่าใช้จ่ายเพิ่ม`,
          kind: 'plain',
          before: target.chargeKind ? EXPENSE_LINE_CHARGE_KIND_LABELS[target.chargeKind] : 'รายการสินค้า',
          after: patch.chargeKind ? EXPENSE_LINE_CHARGE_KIND_LABELS[patch.chargeKind] : 'รายการสินค้า',
        });
        if (patch.chargeKind) {
          updated.chargeKind = patch.chargeKind;
          // §5.1 shape: one printed amount on a quantity-1 row.
          updated.unitPrice = new Decimal(updated.quantity).mul(updated.unitPrice).toFixed(4);
          updated.quantity = '1';
        } else {
          delete updated.chargeKind;
        }
      }
      return updated;
    });
    if (diff.length === 0) return { error: 'no_change' };
    return { lines: renumber(next), diff, warnings };
  }

  // add_charge
  const productSubtotal = record.lines
    .filter((line) => line.chargeKind == null)
    .reduce((total, line) => total.plus(new Decimal(line.lineSubtotalAmount)), new Decimal(0));
  const chargeAmount = patch.amount
    ?? productSubtotal.mul(new Decimal(patch.percentOfSubtotal!)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  if (!expenseChargeKindAllowsNegative(patch.kind) && !new Decimal(chargeAmount).gt(0)) return { error: 'charge_not_positive' };
  const existing = record.lines.find((line) => line.chargeKind === patch.kind);
  if (existing) {
    // Spec §5.4 / J3.3: a bill that already carries this charge gets a MOVE proposal from the
    // caller, not a second row. Refusing here is what makes that the only reachable path.
    return { error: `charge_already_present:${existing.lineNumber}` };
  }
  const label = EXPENSE_LINE_CHARGE_KIND_LABELS[patch.kind];
  const description = patch.percentOfSubtotal ? `${label} ${trimPercent(patch.percentOfSubtotal)}%` : label;
  const vatRate = chargeVatRate(record.lines);
  if (vatRate === null) {
    warnings.push('ใบเสร็จไม่ได้บอก VAT ของค่าใช้จ่ายเพิ่ม ระบบจะตั้งเป็นรอตรวจสอบ ไม่เดา 7% ให้ค่ะ');
  }
  diff.push({ field: `charge.${patch.kind}`, label, kind: 'money', before: null, after: money(chargeAmount) });
  return {
    lines: renumber([
      ...current,
      {
        lineNumber: current.length + 1,
        description,
        chargeKind: patch.kind,
        quantity: '1',
        unitPrice: chargeAmount,
        discountAmount: '0',
        ...(vatRate !== null ? { vatRate } : {}),
      },
    ]),
    diff,
    warnings,
  };
}

/** §5.1: a charge inherits the VAT the document already proves on its product rows. When the rows
 *  disagree, or none carries a rate, there is no evidence — and 7% is never assumed. */
function chargeVatRate(lines: readonly ExpenseLineSummary[]): string | null {
  const rates = new Set(lines.filter((line) => line.chargeKind == null).map((line) => line.vatRate ?? ''));
  if (rates.size !== 1) return null;
  const only = [...rates][0]!;
  return only === '' ? null : only;
}

/** Charges always sort after products, then the whole set is renumbered 1..n so the stored line
 *  numbers a later edit refers to are the ones the card just printed. */
function renumber(lines: DraftLineInput[]): DraftLineInput[] {
  const products = lines.filter((line) => line.chargeKind == null);
  const charges = lines.filter((line) => line.chargeKind != null);
  return [...products, ...charges].map((line, index) => ({ ...line, lineNumber: index + 1 }));
}

/** Append-only and never overwrites capture provenance; the use case rejects values over the cap. */
export function appendNote(current: string | null, addition: string): string {
  const line = `ผู้ใช้แจ้ง: ${addition}`;
  const merged = current?.trim() ? `${current.trim()}\n${line}` : line;
  return merged;
}

/** A rate arrives as either "7" or "0.07"; the column stores the fraction. */
function normalizeRate(value: string): string | undefined {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.lt(0)) return undefined;
    const fraction = parsed.gt(1) ? parsed.div(100) : parsed;
    return fraction.gt(1) ? undefined : fraction.toFixed(4);
  } catch {
    return undefined;
  }
}

function ratePercentLabel(rate: string | null): string | null {
  if (rate === null || rate === '') return null;
  try {
    return `${trimPercent(new Decimal(rate).mul(100).toString())}%`;
  } catch {
    return rate;
  }
}

function trimPercent(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

// ─── Deterministic request detection (correction lane only) ───────────────────────────────────
//
// This runs ONLY on a turn the intake router already classified `EXPENSE_CAPTURE_CORRECTION`, whose
// target the shared chat-provenance rule has already resolved to a record THIS user captured in
// THIS chat. That routing IS the own-record marker, which is why the patterns below do not have to
// re-establish one — and why they must still refuse a message that explicitly names somebody else's
// document, since the chat could hand such a phrase to a correctly-resolved target.
//
// It is an ALLOWLIST: nothing routes to a draft edit unless it matches one of the three shapes
// here. Everything else stays with the existing correction lane or the honest guidance reply.

/** Phrases that name a document which is not the one this chat captured. Refuse, never guess. */
const THIRD_PARTY_MARKERS = ['ร้านอื่น', 'บริษัทอื่น', 'สาขาอื่น', 'คนอื่น', 'ของเพื่อน', 'เจ้าอื่น'];

/** The Thai and English spellings a receipt charge is asked for by, mapped to its stored kind. */
const CHARGE_PHRASES: ReadonlyArray<{ kind: ExpenseLineChargeKind; patterns: readonly string[] }> = [
  { kind: 'SERVICE_CHARGE', patterns: ['ค่าบริการ', 'เซอร์วิสชาร์จ', 'service charge', 'servicecharge'] },
  { kind: 'DELIVERY', patterns: ['ค่าส่ง', 'ค่าจัดส่ง', 'ค่าขนส่ง', 'delivery fee'] },
  { kind: 'PACKAGING', patterns: ['ค่าบรรจุ', 'ค่ากล่อง', 'packaging'] },
  { kind: 'PLATFORM_FEE', patterns: ['ค่าธรรมเนียมแพลตฟอร์ม', 'ค่าธรรมเนียม', 'platform fee'] },
  { kind: 'TIP', patterns: ['ทิป', 'tip'] },
  { kind: 'ROUNDING', patterns: ['ปัดเศษ', 'rounding'] },
];

export type DetectedDraftEdit = { tool: LineDraftUpdateTool; input: Record<string, unknown> };

/**
 * Read one correction message as a draft-edit request, or answer null and leave the turn to the
 * existing lane. Three shapes only:
 *
 *   "…service charge 10%…"                    → add_charge (percent of the goods subtotal)
 *   "…ค่าบริการ 152…"                          → add_charge (exact amount)
 *   "ลบบรรทัด 2" / "เอาบรรทัด 2 ออก"          → remove_line
 *   "ย้ายบรรทัด 2 เป็นช่องค่าบริการ"           → set_line { chargeKind }  (the J3.3 move)
 *
 * The numbers it extracts are still re-grounded by `groundingFailure` before anything is previewed;
 * this function decides WHICH tool, never whether a value may be written.
 */
export function detectLineDraftEditRequest(messageText: string): DetectedDraftEdit | null {
  // Thai and fullwidth numerals first: "ค่าบริการ ๑๕๒" and "ค่าบริการ 152" are the same request,
  // and a parser written against `\d` alone silently ignores the one a Thai keyboard produces.
  const digits = normalizeScrubDigits(messageText);
  const text = digits.toLowerCase();
  if (THIRD_PARTY_MARKERS.some((marker) => text.includes(marker))) return null;

  const move = /ย้าย\s*(?:บรรทัด|รายการ)?\s*(\d{1,3})\s*(?:เป็น|ไป)?\s*(?:ช่อง)?\s*(.{0,20})/u.exec(digits);
  if (move) {
    const kind = chargeKindIn(move[2] ?? '');
    if (kind) return { tool: 'expense.draft.set_line', input: { lineNumber: Number(move[1]), chargeKind: kind } };
  }

  const remove = /(?:ลบ|เอา)\s*(?:บรรทัด|รายการที่|รายการ)\s*(\d{1,3})/u.exec(digits);
  if (remove) return { tool: 'expense.draft.remove_line', input: { lineNumber: Number(remove[1]) } };

  // "บรรทัด 2 เป็น 500" — the answer to the `ambiguous_line` clarify, which tells the user to type
  // exactly this. Without a parser for it the clarify is a loop: the lane asks which line, the user
  // says, and the same question comes back (UAT row J3.7).
  const lineAmount = /(?:บรรทัด(?:ที่)?|รายการที่)\s*(\d{1,3})\s*(?:เป็น|=|คือ|แก้เป็น)\s*([\d,]+(?:\.\d{1,2})?)/u.exec(digits);
  if (lineAmount) {
    return {
      tool: 'expense.draft.set_line',
      input: { lineNumber: Number(lineAmount[1]), amount: lineAmount[2]!.replace(/,/g, '') },
    };
  }

  const charge = CHARGE_PHRASES.flatMap((entry) => entry.patterns.map((pattern) => ({ kind: entry.kind, pattern })))
    .map((entry) => ({ ...entry, at: text.indexOf(entry.pattern) }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => left.at - right.at)[0];
  if (!charge) return null;
  // Only the text AFTER the charge phrase can name its size, so "ยอด 1,520 มีค่าบริการ 10%" cannot
  // read the bill total as the charge.
  const tail = digits.slice(charge.at + charge.pattern.length, charge.at + charge.pattern.length + 40);
  const percent = /(\d{1,3}(?:\.\d+)?)\s*(?:%|เปอร์เซ็น|เปอร์เซ็นต์)/u.exec(tail);
  if (percent) return { tool: 'expense.draft.add_charge', input: { kind: charge.kind, percentOfSubtotal: percent[1] } };
  const flat = /(\d[\d,]*(?:\.\d{1,2})?)/u.exec(tail);
  if (flat) return { tool: 'expense.draft.add_charge', input: { kind: charge.kind, amount: flat[1]!.replace(/,/g, '') } };
  return null;
}

function chargeKindIn(fragment: string): ExpenseLineChargeKind | null {
  const text = fragment.toLowerCase();
  for (const entry of CHARGE_PHRASES) {
    if (entry.patterns.some((pattern) => text.includes(pattern))) return entry.kind;
  }
  return null;
}

/** The charge row a bill already carries under a product description, for the J3.3 move proposal:
 *  "บิลนี้มีค่าบริการเป็นรายการสินค้าอยู่แล้ว — ย้ายเป็นช่องค่าบริการไหมคะ". */
export function existingChargeLikeProductLine(
  lines: readonly ExpenseLineSummary[],
  kind: ExpenseLineChargeKind,
): ExpenseLineSummary | null {
  const patterns = CHARGE_PHRASES.find((entry) => entry.kind === kind)?.patterns ?? [];
  return lines.find((line) => line.chargeKind == null
    && patterns.some((pattern) => line.description.toLowerCase().includes(pattern))) ?? null;
}
