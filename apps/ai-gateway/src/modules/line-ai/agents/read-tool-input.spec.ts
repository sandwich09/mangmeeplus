import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversationReadCandidates } from './read-tool-input';

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
