export type DuplicateCheckInput = {
  checksumSha256?: string | null;
  perceptualHash?: string | null;
  vendorDocumentNumber?: string | null;
  vendorTaxId?: string | null;
  expenseDate?: string | null;
  grandTotalAmount?: string | null;
  vendorCounterpartyId?: string | null;
  vendorName?: string | null;
};

export type DuplicateCandidate = {
  expenseId: string;
  reasonCodes: string[];
  score: number;
};

export type ExistingExpenseRef = {
  id: string;
  checksumSha256?: string | null;
  perceptualHash?: string | null;
  vendorDocumentNumber?: string | null;
  vendorTaxId?: string | null;
  expenseDate?: string | null;
  grandTotalAmount?: string | null;
  vendorCounterpartyId?: string | null;
  vendorName?: string | null;
};

export const MAX_PERCEPTUAL_HASH_DISTANCE = 6;

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

function normalizeDigits(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .replace(/\D/g, '');
}

function normalizeDocumentNumber(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function normalizeVendorName(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

function dateDistanceDays(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeDate(left);
  const b = normalizeDate(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function moneyInSatang(value: string | null | undefined): number | null {
  const amount = Number(String(value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

export function perceptualHashDistance(left: string | null | undefined, right: string | null | undefined): number {
  if (!left || !right || !/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) {
    return Number.POSITIVE_INFINITY;
  }
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits > 0n) {
    bits &= bits - 1n;
    distance += 1;
  }
  return distance;
}

export function scoreAndFindDuplicates(
  subject: DuplicateCheckInput,
  candidates: ExistingExpenseRef[],
): DuplicateCandidate[] {
  const results: DuplicateCandidate[] = [];

  for (const candidate of candidates) {
    const reasonCodes: string[] = [];
    let score = 0;

    // Checksum match is strongest signal
    if (subject.checksumSha256 && candidate.checksumSha256 && subject.checksumSha256 === candidate.checksumSha256) {
      reasonCodes.push('same_checksum');
      score += 40;
    }

    if (perceptualHashDistance(subject.perceptualHash, candidate.perceptualHash) <= MAX_PERCEPTUAL_HASH_DISTANCE) {
      reasonCodes.push('same_visual_fingerprint');
      score += 35;
    }

    // Same vendor document number
    const subjectDocumentNumber = normalizeDocumentNumber(subject.vendorDocumentNumber);
    const candidateDocumentNumber = normalizeDocumentNumber(candidate.vendorDocumentNumber);
    if (
      subjectDocumentNumber &&
      candidateDocumentNumber &&
      subjectDocumentNumber === candidateDocumentNumber
    ) {
      reasonCodes.push('same_vendor_document_number');
      score += 30;
    }

    // Same vendor + date + amount
    const subjectVendorName = normalizeVendorName(subject.vendorName);
    const sameVendor = Boolean(
      (subject.vendorCounterpartyId &&
        candidate.vendorCounterpartyId &&
        subject.vendorCounterpartyId === candidate.vendorCounterpartyId) ||
      (subjectVendorName &&
        subjectVendorName === normalizeVendorName(candidate.vendorName)),
    );
    const sameDate = dateDistanceDays(subject.expenseDate, candidate.expenseDate) === 0;
    const subjectAmount = moneyInSatang(subject.grandTotalAmount);
    const candidateAmount = moneyInSatang(candidate.grandTotalAmount);
    const sameAmount = subjectAmount !== null && candidateAmount !== null && subjectAmount === candidateAmount;

    if (sameVendor && sameDate && sameAmount) {
      reasonCodes.push('same_vendor_date_amount');
      score += 25;
    }

    // Same vendor tax id + amount + near date
    if (
      normalizeDigits(subject.vendorTaxId) &&
      normalizeDigits(subject.vendorTaxId) === normalizeDigits(candidate.vendorTaxId) &&
      sameAmount &&
      dateDistanceDays(subject.expenseDate, candidate.expenseDate) <= 3
    ) {
      reasonCodes.push('same_vendor_tax_id_amount_near_date');
      score += 20;
    }

    if (score > 0) {
      results.push({ expenseId: candidate.id, reasonCodes, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function isDuplicateRisk(score: number, threshold = 20): boolean {
  return score >= threshold;
}
