import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlindReviewSheet, scoreBlindComparison, type BlindReview } from './line-ai-reliability-blind-comparison';
const pair = (i: number, repeat = 0) => ({ scenarioId: `scenario-${i}`, familyId: `family-${i}`, repeat, split: 'held_out' as const,
  question: 'Synthetic question', candidate: 'answer-a', reference: 'answer-b' });
describe('blind comparison and family uncertainty', () => {
  it('hides candidate labels and binds adjudication to exact displayed answer bytes', () => {
    const { sheet, key } = buildBlindReviewSheet([pair(1)], () => 1);
    assert.equal(sheet[0]?.left, 'answer-b'); assert.equal(sheet[0]?.right, 'answer-a');
    assert.equal('candidateSide' in sheet[0]!, false); assert.equal('familyId' in sheet[0]!, false);
    const review: BlindReview = { id: key[0]!.id, answerDigest: key[0]!.answerDigest, winner: 'right', leftUsable: true, rightUsable: true,
      adjudicated: true, reviewerId: 'synthetic-reviewer', reason: 'synthetic rubric' };
    assert.equal(scoreBlindComparison(key, [review]).status, 'inconclusive');
    assert.throws(() => scoreBlindComparison(key, [{ ...review, answerDigest: 'changed' }]), /ANSWER_CHANGED/);
    assert.throws(() => scoreBlindComparison(key, [{ ...review, adjudicated: false }]), /HUMAN_ADJUDICATION/);
  });
  it('never counts two unusable answers as a passing tie or repeats as independent families', () => {
    const { key } = buildBlindReviewSheet(Array.from({ length: 150 }, (_, i) => pair(1, i)), () => 0);
    const reviews = key.map(row => ({ id: row.id, answerDigest: row.answerDigest, winner: 'tie' as const, leftUsable: false, rightUsable: false,
      adjudicated: true, reviewerId: 'fixture', reason: 'both failed' }));
    const result = scoreBlindComparison(key, reviews); assert.equal(result.usableAndNotWorse, 0); assert.equal(result.interval.independentFamilies, 1);
    for (const row of reviews) row.leftUsable = true;
    const repeated = scoreBlindComparison(key, reviews); assert.equal(repeated.status, 'inconclusive'); assert.ok(repeated.interval.lower < 0.9);
  });
  it('requires every review and rejects split leakage or duplicate pairs', () => {
    assert.throws(() => buildBlindReviewSheet([{ ...pair(1), split: 'development' }]), /HELD_OUT_ONLY/);
    assert.throws(() => buildBlindReviewSheet([pair(1), pair(1)]), /DUPLICATE_PAIR/);
    const { key } = buildBlindReviewSheet([pair(1)]); assert.throws(() => scoreBlindComparison(key, []), /EVERY_PAIR/);
  });
  it('reports a conservative family interval even when every held-out comparison passes', () => {
    const { key } = buildBlindReviewSheet(Array.from({ length: 50 }, (_, i) => pair(i)), () => 0);
    const result = scoreBlindComparison(key, key.map(row => ({ id: row.id, answerDigest: row.answerDigest, winner: 'left', leftUsable: true, rightUsable: true,
      adjudicated: true, reviewerId: 'fixture', reason: 'synthetic fixture, not actual acceptance' })));
    assert.equal(result.status, 'passed'); assert.ok(result.interval.lower > 0.9 && result.interval.lower < 1);
    assert.equal(result.scope, 'blind_usefulness_comparison_only');
  });
});
