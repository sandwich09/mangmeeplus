import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversationReadCandidates, nameFilterGroundedInText, resolvePeriodKeyAlias } from './read-tool-input';

const context = (turns: any[]) => ({ windowMinutes: 15, maxTurns: 15, recentTurns: turns });

describe('bounded conversational read candidates', () => {
  it('anchors each complete USER preview to its Bangkok civil date and deduplicates flat tuples', () => {
    const result = conversationReadCandidates(context([
      { at: '2026-09-30T18:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้', userMessagePreviewComplete: true },
      { at: '2026-09-30T18:01:00.000Z', userMessagePreview: 'เดือนนี้เฉพาะยืนยันแล้ว', userMessagePreviewComplete: true },
    ]));
    assert.equal(result?.turns.length, 2);
    assert.equal(result?.turns[0]?.todayIso, '2026-10-01');
    assert.deepEqual(result?.candidates.periods?.map(period => [period.fromDate, period.toDate]), [['2026-10-01', '2026-10-01']]);
    assert.deepEqual(result?.candidates.amounts, []);
  });

  it('does not admit legacy/incomplete or overflow previews', () => {
    assert.equal(conversationReadCandidates(context([
      { at: '2026-09-27T04:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้' },
      { at: '2026-09-27T04:01:00.000Z', userMessagePreview: 'เดือนนี้ '.repeat(33), userMessagePreviewComplete: true },
    ])), undefined);
  });

  it('blocks historical fallback when current input has any date/period evidence or overflow', () => {
    const history = context([{ at: '2026-09-27T04:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้', userMessagePreviewComplete: true }]);
    assert.equal(conversationReadCandidates(history, { amounts: [], dates: [{ isoDate: '2026-01-02' } as any] }), undefined);
    assert.equal(conversationReadCandidates(history, { version: 2, completeness: 'overflow', dates: [], periods: [], amounts: [] } as any), undefined);
  });
});

describe('item 2b: name filter grounding', () => {
  it('matches after NFC + lowercase + collapsed whitespace, not only raw equality', () => {
    assert.equal(nameFilterGroundedInText('อาหาร', 'ค่าใช้จ่ายหมวด   อาหาร   เดือนนี้'), true);
    assert.equal(nameFilterGroundedInText('Vendor', 'the VENDOR   spent a lot'), true);
    // NFC vs NFD: a decomposed e + combining acute accent must still match a precomposed é.
    assert.equal(nameFilterGroundedInText('Café Vendor', 'invoice from café vendor last week'), true);
  });

  it('rejects a name the message never mentions', () => {
    assert.equal(nameFilterGroundedInText('ร้านสมใจ', 'เดือนนี้ค่าใช้จ่ายเท่าไหร่'), false);
  });

  it('rejects an empty or whitespace-only name', () => {
    assert.equal(nameFilterGroundedInText('', 'อะไรก็ได้'), false);
    assert.equal(nameFilterGroundedInText('   ', 'อะไรก็ได้'), false);
  });
});

describe('item 3: periodKey alias resolution (T-009-a/T-052-a root cause)', () => {
  it('resolves the exact invented alias the real model sent for "เดือนนิ" (this-month typo)', () => {
    assert.equal(resolvePeriodKeyAlias('this_month', '2026-09-28'), '2026-09');
    assert.equal(resolvePeriodKeyAlias('this_month_to_date', '2026-09-28'), '2026-09');
    assert.equal(resolvePeriodKeyAlias('current_month', '2026-01-05'), '2026-01');
  });

  it('resolves last_month across a year boundary', () => {
    assert.equal(resolvePeriodKeyAlias('last_month', '2026-01-15'), '2025-12');
  });

  it('never invents a value for an alias outside the closed list, or with no todayIso', () => {
    assert.equal(resolvePeriodKeyAlias('this_week', '2026-09-28'), undefined);
    assert.equal(resolvePeriodKeyAlias('2026-09', '2026-09-28'), undefined);
    assert.equal(resolvePeriodKeyAlias('this_month', undefined), undefined);
  });
});
