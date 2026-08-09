import type { LedgerJournalLineInput } from '@watchdog-bms/contracts';
import { Decimal } from 'decimal.js';

// Same shape as the helper in posting-engine.logic.ts: unparseable input contributes nothing.
function decimal(value: Decimal.Value | undefined | null): Decimal {
  try { return new Decimal(value ?? 0); } catch { return new Decimal(0); }
}
function d4(v: Decimal): string { return v.toFixed(4); }

// One unit of the Decimal(18,4) columns these lines land in — the gate has always meant "equal
// down to the last stored digit". It used to sum float64s, where the rounding error at the top
// of the DTO's range is bigger than the tolerance itself: 27% of exactly balanced entries near
// 1e13 were rejected, and the error message quoted two totals that were both wrong. Same rule,
// exact arithmetic. Every posting path emits 4dp, so this only ever means "difference is zero".
const BALANCE_TOLERANCE = new Decimal('0.0001');

export type JournalBalanceResult = {
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
  errors: string[];
};

/**
 * Validates that a set of journal lines constitutes a balanced double-entry.
 * Pure function – no Prisma or NestJS imports.
 */
export function validateJournalBalance(lines: LedgerJournalLineInput[]): JournalBalanceResult {
  const errors: string[] = [];

  if (!lines || lines.length === 0) {
    errors.push('รายการสมุดรายวันต้องมีอย่างน้อย 2 บรรทัด');
    return { totalDebit: '0', totalCredit: '0', isBalanced: false, errors };
  }
  if (lines.length < 2) {
    errors.push('รายการสมุดรายวันต้องมีอย่างน้อย 2 บรรทัด');
  }

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  lines.forEach((line, idx) => {
    const dr = decimal(line.debitAmount);
    const cr = decimal(line.creditAmount);

    if (dr.lt(0) || cr.lt(0)) {
      errors.push(`บรรทัด ${idx + 1}: จำนวนเงินต้องเป็นบวก`);
    }
    if (dr.gt(0) && cr.gt(0)) {
      errors.push(`บรรทัด ${idx + 1}: ไม่สามารถมีทั้งเดบิตและเครดิตในบรรทัดเดียว`);
    }
    if (dr.isZero() && cr.isZero()) {
      errors.push(`บรรทัด ${idx + 1}: ต้องมีเดบิตหรือเครดิตอย่างน้อยหนึ่งรายการ`);
    }

    totalDebit = totalDebit.plus(dr);
    totalCredit = totalCredit.plus(cr);
  });

  const isBalanced = errors.length === 0
    && totalDebit.minus(totalCredit).abs().lt(BALANCE_TOLERANCE)
    && totalDebit.gt(0);
  if (!isBalanced && errors.length === 0) {
    errors.push(`ยอดเดบิต (${d4(totalDebit)}) ไม่เท่ากับยอดเครดิต (${d4(totalCredit)})`);
  }

  return {
    totalDebit: d4(totalDebit),
    totalCredit: d4(totalCredit),
    isBalanced,
    errors,
  };
}

/**
 * Derives normal-balance sign for reporting.
 * DEBIT-normal accounts: positive when debit > credit
 * CREDIT-normal accounts: positive when credit > debit
 */
export function deriveBalance(
  normalBalance: 'DEBIT' | 'CREDIT',
  totalDebit: number | string,
  totalCredit: number | string,
): number {
  const dr = decimal(totalDebit);
  const cr = decimal(totalCredit);
  return (normalBalance === 'DEBIT' ? dr.minus(cr) : cr.minus(dr)).toNumber();
}

/**
 * Creates a mirror (reversal) of existing journal lines, swapping debit/credit.
 */
export function buildReversalLines(
  originalLines: Array<{ debitAmount: string; creditAmount: string; accountId: string; branchId?: string | null; description?: string | null; currency: string; taxCode?: string | null }>,
): LedgerJournalLineInput[] {
  return originalLines.map((l) => ({
    accountId: l.accountId,
    branchId: l.branchId ?? undefined,
    description: l.description ? `[กลับรายการ] ${l.description}` : '[กลับรายการ]',
    debitAmount: decimal(l.creditAmount).gt(0) ? l.creditAmount : undefined,
    creditAmount: decimal(l.debitAmount).gt(0) ? l.debitAmount : undefined,
    currency: l.currency,
    taxCode: l.taxCode ?? undefined,
  }));
}
