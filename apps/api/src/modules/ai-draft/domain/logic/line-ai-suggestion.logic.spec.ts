import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLineSuggestionIntent,
  buildLineRequestAck,
  buildLineRefusal,
  buildLinePendingSummary,
} from './line-ai-suggestion.logic';

describe('classifyLineSuggestionIntent', () => {
  it('refusal wins over request when the text asks to create/accept a draft', () => {
    assert.equal(classifyLineSuggestionIntent('ขอคำแนะนำแล้วสร้างร่างเลย'), 'refuse_web_only');
    assert.equal(classifyLineSuggestionIntent('accept the draft'), 'refuse_web_only');
  });
  it('classifies a plain suggestion ask as request', () => {
    assert.equal(classifyLineSuggestionIntent('ขอคำแนะนำ'), 'request');
    assert.equal(classifyLineSuggestionIntent('please suggest next steps'), 'request');
  });
  it('classifies a pending ask as pending_summary', () => {
    assert.equal(classifyLineSuggestionIntent('รายการรอรีวิว'), 'pending_summary');
  });
  it('defaults to help', () => {
    assert.equal(classifyLineSuggestionIntent('สวัสดี'), 'help');
  });
});

describe('LINE response builders', () => {
  it('request ack and refusal both include the web deep link', () => {
    assert.match(buildLineRequestAck('https://x.io/', 'co-1'), /x\.io\/companies\/co-1\/ai-suggestions/);
    assert.match(buildLineRefusal('https://x.io', 'co-1'), /รีวิวในเว็บ/);
  });
  it('pending summary shows count, up to 3 labels, and a link', () => {
    const text = buildLinePendingSummary('https://x.io', 'co-1', [
      { title: 'A', riskLevel: 'HIGH', citationCount: 2 },
      { title: 'B', riskLevel: 'LOW', citationCount: 0 },
      { title: 'C', riskLevel: 'MEDIUM', citationCount: 1 },
      { title: 'D', riskLevel: 'LOW', citationCount: 0 },
    ]);
    assert.match(text, /4 รายการ/);
    assert.match(text, /1\. A/);
    assert.ok(!text.includes('4. D')); // capped at 3
  });
  it('pending summary handles empty', () => {
    assert.match(buildLinePendingSummary('https://x.io', 'co-1', []), /ไม่มีคำแนะนำ/);
  });
});
