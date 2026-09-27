import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence } from './line-ai-input-evidence.js';
import { extractValueCandidatesV2, parseLineAiValueCandidatesV2, verifyLineAiValueCandidatesV2 } from './line-ai-value-normalizer.js';

async function input(...parts: string[]) {
  return (await createLineAiInputEvidence({ turnKey: 'turn-1', parts: parts.map((rawText, index) => ({ partId: `part-${index}`,
    eventIdHash: String(index).repeat(64), acceptedAtMs: Date.parse('2026-09-26T18:00:00Z'), rawText })) }))!.inputEvidence;
}
const TODAY = '2026-09-27';
describe('complete v2 value provenance', () => {
  it('keeps the 21st and 128th reading and refuses every numeric array at 129', async () => {
    const evidence = await input(Array.from({ length: 128 }, (_, i) => `${i + 1} บาท`).join('; '));
    const value = (await extractValueCandidatesV2(evidence, TODAY))!;
    assert.equal(value.completeness, 'complete');
    assert.equal(value.amounts.length, 128);
    assert.equal(value.amounts[20]!.value, '21');
    assert.equal(value.amounts[127]!.value, '128');
    assert.ok(await verifyLineAiValueCandidatesV2(value, evidence));
    const overflow = (await extractValueCandidatesV2(await input(`${evidence.parts[0]!.rawText}; 129 บาท`), TODAY))!;
    assert.equal(overflow.completeness, 'overflow');
    assert.deepEqual(overflow.counts, { amounts: 129, dates: 0, periods: 0 });
    assert.deepEqual([overflow.amounts, overflow.dates, overflow.periods], [[], [], []]);
  });
  it('binds repeated identical spans to their own original UTF-16 coordinates and part', async () => {
    const evidence = await input('😀 ๙๐๐๗๑๙๙๒๕๔๗๔๐๙๙๓.๐๑ บาท; 60 บาท; 60 บาท', '60 บาท');
    const value = (await extractValueCandidatesV2(evidence, TODAY))!;
    assert.equal(value.amounts[0]!.value, '9007199254740993.01');
    assert.equal(value.amounts[0]!.source.startUtf16, 3);
    assert.equal(new Set(value.amounts.map(item => item.candidateId)).size, 4);
    assert.deepEqual(value.amounts.map(item => item.source.partId), ['part-0', 'part-0', 'part-0', 'part-1']);
    const bad = structuredClone(value); bad.amounts[2]!.source = { ...bad.amounts[1]!.source };
    assert.equal(await verifyLineAiValueCandidatesV2(bad, evidence), undefined);
    const omitted = structuredClone(value); omitted.amounts.pop(); omitted.counts.amounts--;
    assert.equal(await verifyLineAiValueCandidatesV2(omitted, evidence), undefined);
    const fakeOverflow = { ...value, completeness: 'overflow', amounts: [], dates: [], periods: [] };
    assert.equal(await verifyLineAiValueCandidatesV2(fakeOverflow, evidence), undefined);
  });
  it('counts every repeated date and period, preserving alternatives and the pinned civil date', async () => {
    const dates = (await extractValueCandidatesV2(await input(Array(64).fill('2026-09-01').join('; ')), TODAY))!;
    assert.equal(dates.dates.length, 64);
    assert.equal(dates.completeness, 'complete');
    const tooManyDates = (await extractValueCandidatesV2(await input(Array(65).fill('2026-09-01').join('; ')), TODAY))!;
    assert.equal(tooManyDates.completeness, 'overflow');
    assert.equal(tooManyDates.counts.dates, 65);
    const evidence = await input(Array(32).fill('เดือนที่แล้ว').join('; '));
    const periods = (await extractValueCandidatesV2(evidence, TODAY))!;
    assert.equal(periods.periods.length, 32);
    assert.equal(periods.periods[0]!.fromDate, '2026-08-01');
    assert.equal(periods.periods[0]!.periodSource, 'relative');
    assert.ok(await verifyLineAiValueCandidatesV2(periods, evidence));
    assert.equal((await extractValueCandidatesV2(await input(Array(33).fill('เดือนที่แล้ว').join('; ')), TODAY))!.completeness, 'overflow');
    const ambiguous = (await extractValueCandidatesV2(await input('9/11/37'), TODAY))!;
    assert.ok(ambiguous.dates.length > 1);
    assert.equal(new Set(ambiguous.dates.map(item => item.candidateId)).size, ambiguous.dates.length);
  });
  it('enforces the complete encoded byte limit and rejects injected evidence/unknown fields', async () => {
    const evidence = await input(Array.from({length: 128}, (_, i) => `${i + 1} บาท`).join('; '), Array(64).fill('2026-09-01').join('; '));
    const value = (await extractValueCandidatesV2(evidence, TODAY))!;
    assert.equal(value.completeness, 'overflow');
    assert.deepEqual(value.counts, { amounts: 128, dates: 64, periods: 0 });
    assert.equal(parseLineAiValueCandidatesV2({ ...value, overflow: true }, evidence.parts.map(item => item.rawText).join('\n')), undefined);
    const tampered = structuredClone(evidence); tampered.parts[0]!.rawText += 'x';
    assert.equal(await extractValueCandidatesV2(tampered, TODAY), undefined);
  });
});
