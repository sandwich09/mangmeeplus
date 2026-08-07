/**
 * Pure domain logic for banking / reconciliation (Item 13).
 * No NestJS, no Prisma, no framework dependencies.
 * Amounts are decimal strings; integer cent arithmetic for safety.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a decimal string to integer cents (2 decimal places). */
function toCents(v: string | undefined | null): bigint {
  const s = (v ?? '0').trim().replace(/,/g, '');
  if (!s || s === '-' || s === '') return 0n;
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [intPart = '0', fracPart = ''] = abs.split('.');
  const frac = (fracPart + '00').slice(0, 2);
  const cents = BigInt(intPart) * 100n + BigInt(frac);
  return neg ? -cents : cents;
}

/** Format integer cents back to a decimal string with 2 decimal places. */
function fromCents(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const intPart = abs / 100n;
  const fracPart = abs % 100n;
  const frac = fracPart.toString().padStart(2, '0');
  return `${neg ? '-' : ''}${intPart}.${frac}`;
}

/** Sum an array of decimal strings using cent arithmetic. */
function sumCents(vals: string[]): bigint {
  return vals.reduce((acc, v) => acc + toCents(v), 0n);
}

export function sumDecimalAmounts(vals: string[]): string {
  return fromCents(sumCents(vals));
}

// ---------------------------------------------------------------------------
// 1. Statement row normalization
// ---------------------------------------------------------------------------

export type RawStatementRow = {
  date?: string;
  postedDate?: string;
  'Transaction Date'?: string;
  'วันที่'?: string;
  'วันที่ทำรายการ'?: string;
  description?: string;
  Details?: string;
  'รายการ'?: string;
  'รายละเอียด'?: string;
  debit?: string;
  Debit?: string;
  'ถอน'?: string;
  'เดบิต'?: string;
  credit?: string;
  Credit?: string;
  'ฝาก'?: string;
  'เครดิต'?: string;
  amount?: string;
  Amount?: string;
  'จำนวนเงิน'?: string;
  balance?: string;
  Balance?: string;
  'ยอดคงเหลือ'?: string;
  bankReference?: string;
  Reference?: string;
  'อ้างอิง'?: string;
  [key: string]: string | undefined;
};

export type NormalizedStatementRow = {
  postedDate: string;
  description: string;
  signedAmount: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL' | 'ZERO';
  currency: string;
  debitAmount?: string;
  creditAmount?: string;
  runningBalanceAmount?: string;
  bankReference?: string;
  errors: string[];
};

export function normalizeStatementRow(row: RawStatementRow): NormalizedStatementRow {
  const errors: string[] = [];

  // Date resolution (priority order)
  const rawDate =
    row.postedDate ??
    row.date ??
    row['Transaction Date'] ??
    row['วันที่ทำรายการ'] ??
    row['วันที่'] ??
    '';

  let postedDate = rawDate.trim();
  if (!postedDate) {
    errors.push('Missing posted date');
    postedDate = '';
  }

  // Description resolution
  const description = (
    row.description ??
    row.Details ??
    row['รายการ'] ??
    row['รายละเอียด'] ??
    ''
  ).trim();

  // Amount resolution — try debit/credit columns first, then signed amount
  const rawDebit =
    row.debit ?? row.Debit ?? row['ถอน'] ?? row['เดบิต'] ?? '';
  const rawCredit =
    row.credit ?? row.Credit ?? row['ฝาก'] ?? row['เครดิต'] ?? '';
  const rawAmount =
    row.amount ?? row.Amount ?? row['จำนวนเงิน'] ?? '';

  let signedAmount: string;
  let direction: 'DEPOSIT' | 'WITHDRAWAL' | 'ZERO';
  let debitAmount: string | undefined;
  let creditAmount: string | undefined;

  if (rawDebit.trim() || rawCredit.trim()) {
    const debitCents = toCents(rawDebit || '0');
    const creditCents = toCents(rawCredit || '0');
    debitAmount = rawDebit.trim() ? fromCents(debitCents < 0n ? -debitCents : debitCents) : undefined;
    creditAmount = rawCredit.trim() ? fromCents(creditCents < 0n ? -creditCents : creditCents) : undefined;
    const netCents = creditCents - debitCents;
    signedAmount = fromCents(netCents);
    if (netCents > 0n) direction = 'DEPOSIT';
    else if (netCents < 0n) direction = 'WITHDRAWAL';
    else direction = 'ZERO';
  } else if (rawAmount.trim()) {
    const cents = toCents(rawAmount);
    signedAmount = fromCents(cents);
    if (cents > 0n) direction = 'DEPOSIT';
    else if (cents < 0n) direction = 'WITHDRAWAL';
    else direction = 'ZERO';
  } else {
    errors.push('Missing amount');
    signedAmount = '0.00';
    direction = 'ZERO';
  }

  // Running balance
  const rawBalance =
    row.balance ?? row.Balance ?? row['ยอดคงเหลือ'] ?? '';
  const runningBalanceAmount = rawBalance.trim()
    ? fromCents(toCents(rawBalance))
    : undefined;

  // Bank reference
  const rawRef =
    row.bankReference ?? row.Reference ?? row['อ้างอิง'] ?? '';
  const bankReference = rawRef.trim() || undefined;

  return {
    postedDate,
    description,
    signedAmount,
    direction,
    currency: 'THB',
    debitAmount,
    creditAmount,
    runningBalanceAmount,
    bankReference,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 2. Duplicate detection hash
// ---------------------------------------------------------------------------

export function statementLineHash(params: {
  companyId: string;
  bankAccountId: string;
  postedDate: string;
  signedAmount: string;
  currency: string;
  bankReference?: string;
  normalizedDescription?: string;
  runningBalanceAmount?: string;
}): string {
  const parts = [
    params.companyId,
    params.bankAccountId,
    params.postedDate,
    fromCents(toCents(params.signedAmount)), // normalize amount format
    params.currency.toUpperCase(),
    params.bankReference ?? '',
    params.normalizedDescription ?? '',
    params.runningBalanceAmount ? fromCents(toCents(params.runningBalanceAmount)) : '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

// ---------------------------------------------------------------------------
// 3. Match suggestion scoring (0-100)
// ---------------------------------------------------------------------------

export function scoreMatchCandidate(
  line: {
    postedDate: string;
    signedAmount: string;
    currency: string;
    bankReference?: string;
    normalizedDescription?: string;
  },
  candidate: {
    paymentDate: string;
    amount: string;
    currency: string;
    reference?: string;
    counterpartyName?: string;
  },
): number {
  // Currency must match exactly
  if (line.currency.toUpperCase() !== candidate.currency.toUpperCase()) return 0;

  // Amount must match exactly (absolute value comparison)
  const lineCents = toCents(line.signedAmount) < 0n ? -toCents(line.signedAmount) : toCents(line.signedAmount);
  const candCents = toCents(candidate.amount) < 0n ? -toCents(candidate.amount) : toCents(candidate.amount);
  if (lineCents !== candCents) return 0;

  let score = 50; // base for currency + amount match

  // Date proximity: +7 days window gives full bonus; degrades linearly
  const lineDate = new Date(line.postedDate).getTime();
  const candDate = new Date(candidate.paymentDate).getTime();
  if (!isNaN(lineDate) && !isNaN(candDate)) {
    const diffDays = Math.abs(lineDate - candDate) / 86_400_000;
    if (diffDays === 0) score += 30;
    else if (diffDays <= 3) score += 20;
    else if (diffDays <= 7) score += 10;
    // > 7 days: no date bonus but still a valid candidate
  }

  // Reference match
  if (
    line.bankReference &&
    candidate.reference &&
    line.bankReference.toLowerCase().includes(candidate.reference.toLowerCase())
  ) {
    score += 15;
  }

  // Description / counterparty name hint
  if (
    line.normalizedDescription &&
    candidate.counterpartyName &&
    line.normalizedDescription.toLowerCase().includes(candidate.counterpartyName.toLowerCase())
  ) {
    score += 5;
  }

  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// 4. Match allocation guard
// ---------------------------------------------------------------------------

export function validateMatchAllocation(params: {
  statementLineAmount: string;
  alreadyAllocated: string;
  newAllocation: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL' | 'ZERO';
  candidateDirection: 'DEPOSIT' | 'WITHDRAWAL';
}): { valid: boolean; error?: string } {
  // Signs must agree
  if (params.direction === 'ZERO') {
    return { valid: false, error: 'Cannot match a ZERO-direction statement line' };
  }
  if (params.direction !== params.candidateDirection) {
    return {
      valid: false,
      error: `Direction mismatch: statement line is ${params.direction} but candidate is ${params.candidateDirection}`,
    };
  }

  const lineCents = toCents(params.statementLineAmount) < 0n
    ? -toCents(params.statementLineAmount)
    : toCents(params.statementLineAmount);
  const allocatedCents = toCents(params.alreadyAllocated);
  const newCents = toCents(params.newAllocation);

  if (newCents <= 0n) {
    return { valid: false, error: 'Allocation amount must be positive' };
  }
  if (allocatedCents + newCents > lineCents) {
    const remaining = fromCents(lineCents - allocatedCents);
    return {
      valid: false,
      error: `Over-allocation: remaining unmatched amount is ${remaining}, requested ${params.newAllocation}`,
    };
  }

  return { valid: true };
}

export function calculateStatementLineMatchStatus(params: {
  statementLineAmount: string;
  confirmedAllocations: string[];
}): 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' {
  const lineCents = toCents(params.statementLineAmount);
  const absoluteLineCents = lineCents < 0n ? -lineCents : lineCents;
  const allocatedCents = sumCents(params.confirmedAllocations);

  if (allocatedCents <= 0n) return 'UNMATCHED';
  return allocatedCents >= absoluteLineCents ? 'MATCHED' : 'PARTIALLY_MATCHED';
}

// ---------------------------------------------------------------------------
// 5. Reconciliation balance calculation
// ---------------------------------------------------------------------------

export function calculateReconciliationBalance(params: {
  openingStatementBalance: string;
  statementMovements: string[];
  openingBookBalance: string;
  reconciledMovements: string[];
}): {
  closingStatementBalance: string;
  calculatedBookBalance: string;
  difference: string;
} {
  const closingStatementCents =
    toCents(params.openingStatementBalance) + sumCents(params.statementMovements);
  const calculatedBookCents =
    toCents(params.openingBookBalance) + sumCents(params.reconciledMovements);
  const differenceCents = closingStatementCents - calculatedBookCents;

  return {
    closingStatementBalance: fromCents(closingStatementCents),
    calculatedBookBalance: fromCents(calculatedBookCents),
    difference: fromCents(differenceCents),
  };
}

export function calculateInitialReconciliationSession(params: {
  openingStatementBalance: string;
  closingStatementBalance: string;
}): {
  calculatedStatementMovementAmount: string;
  calculatedBookMovementAmount: string;
  calculatedBookBalanceAmount: string;
  differenceAmount: string;
} {
  const openingCents = toCents(params.openingStatementBalance);
  const closingCents = toCents(params.closingStatementBalance);
  const statementMovementCents = closingCents - openingCents;

  return {
    calculatedStatementMovementAmount: fromCents(statementMovementCents),
    calculatedBookMovementAmount: '0.00',
    calculatedBookBalanceAmount: fromCents(openingCents),
    differenceAmount: fromCents(statementMovementCents),
  };
}

// ---------------------------------------------------------------------------
// 6. Reconciliation completion guard
// ---------------------------------------------------------------------------

export function canCompleteReconciliation(params: {
  unmatchedRequiredLinesCount: number;
  ignoredWithoutReviewCount: number;
  differenceAmount: string;
  hasLedgerLink: boolean;
  isPeriodClosed: boolean;
}): { canComplete: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (params.unmatchedRequiredLinesCount > 0) {
    blockers.push(
      `${params.unmatchedRequiredLinesCount} statement line(s) are unmatched and require matching or explicit ignore`,
    );
  }
  if (params.ignoredWithoutReviewCount > 0) {
    blockers.push(
      `${params.ignoredWithoutReviewCount} ignored line(s) require Accountant review before completion`,
    );
  }
  if (toCents(params.differenceAmount) !== 0n) {
    blockers.push(
      `Balance difference of ${params.differenceAmount} must be zero to complete (or override permission required)`,
    );
  }
  if (!params.hasLedgerLink) {
    blockers.push('Bank account is not linked to a ledger cash/bank account');
  }
  if (params.isPeriodClosed) {
    blockers.push('Ledger period is closed; reopen or use period override permission');
  }

  return { canComplete: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// 7. Bank adjustment posting input builder
// ---------------------------------------------------------------------------

export function buildAdjustmentPostingInput(adj: {
  id: string;
  companyId: string;
  adjustmentNumber: string;
  category: string;
  adjustmentDate: string;
  description: string;
  signedAmount: string;
  currency: string;
  ledgerDebitAccountId?: string;
  ledgerCreditAccountId?: string;
}): {
  lines: { ledgerAccountId: string; debitAmount: string; creditAmount: string; description: string }[];
  error?: string;
} {
  const { ledgerDebitAccountId, ledgerCreditAccountId, signedAmount, description } = adj;

  if (!ledgerDebitAccountId || !ledgerCreditAccountId) {
    return {
      lines: [],
      error: 'Both ledgerDebitAccountId and ledgerCreditAccountId are required to build posting input',
    };
  }

  const cents = toCents(signedAmount);
  const absCents = cents < 0n ? -cents : cents;
  const absAmount = fromCents(absCents);

  return {
    lines: [
      {
        ledgerAccountId: ledgerDebitAccountId,
        debitAmount: absAmount,
        creditAmount: '0.00',
        description,
      },
      {
        ledgerAccountId: ledgerCreditAccountId,
        debitAmount: '0.00',
        creditAmount: absAmount,
        description,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. Account number masking
// ---------------------------------------------------------------------------

/** Mask all but the last 4 digits of an account number. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const visible = digits.slice(-4);
  const masked = '*'.repeat(digits.length - 4) + visible;
  return masked;
}

/** Extract the last 4 digits of an account number. */
export function extractLast4(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  return digits.slice(-4);
}

// ---------------------------------------------------------------------------
// 9. Running-balance continuity guardrail (spec §20)
// ---------------------------------------------------------------------------

/**
 * Check that each row's running balance equals the previous balance plus the
 * row's signed amount. Rows without a balance reset the chain (partial
 * statements stay importable). Returns 1-based row numbers that break the
 * chain — the strongest deterministic signal that OCR/extraction misread a
 * figure.
 */
export function checkRunningBalanceContinuity(
  rows: { signedAmount: string; runningBalanceAmount?: string }[],
): number[] {
  const breaks: number[] = [];
  let prevBalance: bigint | null = null;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].runningBalanceAmount;
    if (raw === undefined || raw.trim() === '') {
      prevBalance = null;
      continue;
    }
    const balance = toCents(raw);
    if (prevBalance !== null && balance !== prevBalance + toCents(rows[i].signedAmount)) {
      breaks.push(i + 1);
    }
    prevBalance = balance;
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// 10. PDF text-layer table clustering (spec §20 pdf_text path — no AI model)
// ---------------------------------------------------------------------------

export type PdfTextItem = {
  str: string;
  x: number;
  /** Reading-order vertical position: larger = further down the document. */
  y: number;
  width?: number;
};

/** Canonical keys are the lowercase aliases normalizeStatementRow already reads. */
const PDF_HEADER_ALIASES: Record<string, string[]> = {
  postedDate: ['posteddate', 'date', 'transaction date', 'วันที่ทำรายการ', 'วันที่'],
  description: ['description', 'details', 'รายการ', 'รายละเอียด', 'transaction description'],
  debit: ['debit', 'withdrawal', 'ถอน', 'เดบิต', 'ถอนเงิน'],
  credit: ['credit', 'deposit', 'ฝาก', 'เครดิต', 'ฝากเงิน'],
  amount: ['amount', 'จำนวนเงิน'],
  balance: ['balance', 'outstanding balance', 'ยอดคงเหลือ'],
  bankReference: ['bankreference', 'reference', 'ref', 'อ้างอิง', 'เลขที่อ้างอิง'],
};

function matchHeaderAlias(cell: string): string | undefined {
  const normalized = cell.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [canonical, aliases] of Object.entries(PDF_HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return canonical;
  }
  return undefined;
}

type PdfCell = { text: string; x: number };

/** Group items into visual lines (y tolerance), merge near-adjacent items into cells. */
function toLines(items: PdfTextItem[], yTolerance: number, mergeGap: number): PdfCell[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(item.y - line.y) <= yTolerance) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => {
    const cells: PdfCell[] = [];
    let current: { text: string; x: number; end: number } | null = null;
    for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
      const width = item.width ?? item.str.length * 5;
      if (current && item.x - current.end <= mergeGap) {
        current.text += item.str;
        current.end = item.x + width;
      } else {
        if (current) cells.push({ text: current.text, x: current.x });
        current = { text: item.str, x: item.x, end: item.x + width };
      }
    }
    if (current) cells.push({ text: current.text, x: current.x });
    return cells;
  });
}

function headerColumnsFromLine(cells: PdfCell[]): { key: string; x: number }[] | null {
  const columns: { key: string; x: number }[] = [];
  for (const cell of cells) {
    const key = matchHeaderAlias(cell.text);
    if (key && !columns.some((c) => c.key === key)) columns.push({ key, x: cell.x });
  }
  const keys = columns.map((c) => c.key);
  const hasDate = keys.includes('postedDate');
  const hasAmount = keys.includes('amount') || keys.includes('debit') || keys.includes('credit');
  return columns.length >= 3 && hasDate && hasAmount ? columns : null;
}

/**
 * Deterministically reconstruct table rows from positioned PDF text items:
 * find the header line via the same column aliases the CSV path accepts,
 * then assign each following line's cells to the nearest header column.
 * Repeated header lines (page 2+) are skipped. Rows come back keyed by the
 * canonical alias, so normalizeStatementRow consumes them like CSV rows.
 */
export function clusterPdfTextRows(
  items: PdfTextItem[],
  opts: { yTolerance?: number; mergeGap?: number } = {},
): { headerFound: boolean; rows: Record<string, string>[] } {
  const lines = toLines(items, opts.yTolerance ?? 2.5, opts.mergeGap ?? 6);

  let columns: { key: string; x: number }[] | null = null;
  const rows: Record<string, string>[] = [];

  for (const cells of lines) {
    if (cells.length === 0) continue;
    const headerCandidate = headerColumnsFromLine(cells);
    if (!columns) {
      if (headerCandidate) columns = headerCandidate;
      continue;
    }
    if (headerCandidate) continue; // repeated header on a later page

    const row: Record<string, string> = {};
    for (const cell of cells) {
      let nearest = columns[0];
      for (const col of columns) {
        if (Math.abs(cell.x - col.x) < Math.abs(cell.x - nearest.x)) nearest = col;
      }
      row[nearest.key] = row[nearest.key] ? `${row[nearest.key]} ${cell.text.trim()}` : cell.text.trim();
    }
    if (Object.values(row).some((v) => v !== '')) rows.push(row);
  }

  return { headerFound: columns !== null, rows };
}

// ---------------------------------------------------------------------------
// 11. Source candidate remaining allocation
// ---------------------------------------------------------------------------

export function candidateAllocationKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

/**
 * Subtract already-confirmed match allocations from source candidates and
 * drop candidates with nothing left to match. Amounts are absolute values;
 * allocations are always positive (see validateMatchAllocation).
 */
export function applyConfirmedAllocations<T extends { sourceType: string; sourceId: string; amount: string }>(
  candidates: T[],
  confirmedTotalsByKey: Record<string, string>,
): (T & { remainingUnmatchedAmount: string })[] {
  const result: (T & { remainingUnmatchedAmount: string })[] = [];
  for (const c of candidates) {
    const amountCents = toCents(c.amount);
    const absAmountCents = amountCents < 0n ? -amountCents : amountCents;
    const matchedCents = toCents(confirmedTotalsByKey[candidateAllocationKey(c.sourceType, c.sourceId)] ?? '0');
    const remainingCents = absAmountCents - matchedCents;
    if (remainingCents <= 0n) continue;
    result.push({ ...c, remainingUnmatchedAmount: fromCents(remainingCents) });
  }
  return result;
}
