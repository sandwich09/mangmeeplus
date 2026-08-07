import type { LedgerJournalLineInput } from '@watchdog-bms/contracts';

function n(s: string | undefined | null): number { return parseFloat(s ?? '0') || 0; }
function d4(v: number): string { return v.toFixed(4); }

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

  let totalDebit = 0;
  let totalCredit = 0;

  lines.forEach((line, idx) => {
    const dr = n(line.debitAmount);
    const cr = n(line.creditAmount);

    if (dr < 0 || cr < 0) {
      errors.push(`บรรทัด ${idx + 1}: จำนวนเงินต้องเป็นบวก`);
    }
    if (dr > 0 && cr > 0) {
      errors.push(`บรรทัด ${idx + 1}: ไม่สามารถมีทั้งเดบิตและเครดิตในบรรทัดเดียว`);
    }
    if (dr === 0 && cr === 0) {
      errors.push(`บรรทัด ${idx + 1}: ต้องมีเดบิตหรือเครดิตอย่างน้อยหนึ่งรายการ`);
    }

    totalDebit += dr;
    totalCredit += cr;
  });

  const isBalanced = errors.length === 0 && Math.abs(totalDebit - totalCredit) < 0.0001 && totalDebit > 0;
  if (!isBalanced && errors.length === 0) {
    errors.push(`ยอดเดบิต (${d4(totalDebit)}) ไม่เท่ากับยอดเครดิต (${d4(totalCredit)})`);
  }

  return {
    totalDebit: d4(totalDebit),
    totalCredit: d4(totalCredit),
    isBalanced: errors.length === 0 && Math.abs(totalDebit - totalCredit) < 0.0001 && totalDebit > 0,
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
  const dr = typeof totalDebit === 'number' ? totalDebit : n(totalDebit);
  const cr = typeof totalCredit === 'number' ? totalCredit : n(totalCredit);
  return normalBalance === 'DEBIT' ? dr - cr : cr - dr;
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
    debitAmount: n(l.creditAmount) > 0 ? l.creditAmount : undefined,
    creditAmount: n(l.debitAmount) > 0 ? l.debitAmount : undefined,
    currency: l.currency,
    taxCode: l.taxCode ?? undefined,
  }));
}
