/** W14 blind review support. The private answer key must be stored separately from the sheet. */
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';

export type BlindPair = {
  scenarioId: string; familyId: string; repeat: number; split: 'development' | 'held_out';
  question: string; candidate: string; reference: string;
};
export type BlindKey = { id: string; scenarioId: string; familyId: string; repeat: number; candidateSide: 'left' | 'right'; answerDigest: string };
export type BlindReview = { id: string; winner: 'left' | 'right' | 'tie' | 'neither'; leftUsable: boolean; rightUsable: boolean;
  adjudicated: boolean; reviewerId: string; reason: string; answerDigest: string };

export function buildBlindReviewSheet(pairs: readonly BlindPair[], chooseSide: () => number = () => randomInt(2)) {
  const seen = new Set<string>();
  const key: BlindKey[] = [], sheet: Array<{ id: string; question: string; left: string; right: string; answerDigest: string }> = [];
  for (const pair of pairs) {
    assert.equal(pair.split, 'held_out', 'HELD_OUT_ONLY');
    const identity = `${pair.scenarioId}:${pair.repeat}`;
    assert.ok(pair.scenarioId && pair.familyId && Number.isSafeInteger(pair.repeat) && pair.repeat >= 0 && !seen.has(identity), 'INVALID_OR_DUPLICATE_PAIR');
    seen.add(identity);
    const id = createHash('sha256').update(identity).digest('hex').slice(0, 24);
    const side = chooseSide(); assert.ok(side === 0 || side === 1, 'INVALID_BLIND_ORDER');
    const candidateSide = side === 0 ? 'left' as const : 'right' as const;
    const left = candidateSide === 'left' ? pair.candidate : pair.reference;
    const right = candidateSide === 'right' ? pair.candidate : pair.reference;
    const answerDigest = createHash('sha256').update(JSON.stringify([pair.question, left, right])).digest('hex');
    sheet.push({ id, question: pair.question, left, right, answerDigest });
    key.push({ id, scenarioId: pair.scenarioId, familyId: pair.familyId, repeat: pair.repeat, candidateSide, answerDigest });
  }
  return { sheet, key };
}

/** Resample whole independent families, including every paraphrase/repeat. The Wilson envelope
 * uses family count, not repeated answers; it avoids a spuriously exact [1,1] with zero failures. */
export function familyConfidenceInterval(values: readonly number[], draws = 2000) {
  assert.ok(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'INVALID_FAMILY_SCORES');
  assert.ok(Number.isInteger(draws) && draws >= 1000 && draws <= 10000, 'INVALID_BOOTSTRAP_DRAWS');
  let state = 0x51ab72cd;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const bootstrap = Array.from({ length: draws }, () => values.reduce(sum => sum + values[Math.floor(random() * values.length)]!, 0) / values.length).sort((a, b) => a - b);
  const z = 1.959963984540054, n = values.length, divisor = 1 + z * z / n;
  const centre = (mean + z * z / (2 * n)) / divisor;
  const half = z * Math.sqrt(mean * (1 - mean) / n + z * z / (4 * n * n)) / divisor;
  return { method: 'family-cluster-bootstrap-with-wilson-envelope' as const, independentFamilies: n, estimate: mean,
    lower: Math.max(0, Math.min(bootstrap[Math.floor(draws * 0.025)]!, centre - half)),
    upper: Math.min(1, Math.max(bootstrap[Math.ceil(draws * 0.975) - 1]!, centre + half)), confidence: 0.95, bootstrapDraws: draws };
}

export function scoreBlindComparison(key: readonly BlindKey[], reviews: readonly BlindReview[]) {
  assert.ok(key.length > 0 && key.length === reviews.length, 'EVERY_PAIR_REQUIRES_REVIEW');
  const keys = new Map(key.map(row => [row.id, row])); assert.equal(keys.size, key.length, 'DUPLICATE_KEY');
  const seen = new Set<string>(), families = new Map<string, boolean[]>(); let passing = 0;
  for (const review of reviews) {
    const row = keys.get(review.id);
    assert.ok(row && !seen.has(review.id), 'UNKNOWN_OR_DUPLICATE_REVIEW'); seen.add(review.id);
    assert.equal(review.answerDigest, row.answerDigest, 'ANSWER_CHANGED_AFTER_BLINDING');
    assert.ok(review.adjudicated && typeof review.reviewerId === 'string' && review.reviewerId.trim()
      && typeof review.reason === 'string' && review.reason.trim(), 'HUMAN_ADJUDICATION_REQUIRED');
    assert.ok(['left', 'right', 'tie', 'neither'].includes(review.winner)
      && typeof review.leftUsable === 'boolean' && typeof review.rightUsable === 'boolean', 'INVALID_REVIEW');
    const candidateUsable = row.candidateSide === 'left' ? review.leftUsable : review.rightUsable;
    const passed = candidateUsable && (review.winner === row.candidateSide || review.winner === 'tie');
    passing += Number(passed);
    families.set(row.familyId, [...(families.get(row.familyId) ?? []), passed]);
  }
  const interval = familyConfidenceInterval([...families.values()].map(rows => rows.filter(Boolean).length / rows.length));
  return { status: interval.independentFamilies < 50 || interval.lower < 0.9 && interval.upper >= 0.9 ? 'inconclusive'
    : interval.upper < 0.9 ? 'failed' : 'passed', usableAndNotWorse: passing, comparisons: reviews.length, interval,
    scope: 'blind_usefulness_comparison_only', remainingGates: ['EXACT_SECURITY_FINANCE_ORACLES', 'NATIVE_LINE_RELEASE_ACCEPTANCE'] };
}
