/**
 * tuning-3 item 3 (spec R-A5, eval T-007/T-052/T-130/T-131/T-133): น้องมั่งมี always speaks with
 * ค่ะ/คะ and never ครับ/ผม, even when the customer's own message used them — a real model sometimes
 * mirrors the customer's tone into its OWN composed reply anyway. `sanitizeMangmeePersonaText` is
 * the deterministic backstop wired into semantic-turn-v2.ts's compose step (see
 * semantic-turn-v2-compose-pipeline.spec.ts for the end-to-end wiring).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MANGMEE_PERSONA_LINES, MANGMEE_PERSONA_PROMPT, sanitizeMangmeePersonaText } from './mangmee-persona';

describe('sanitizeMangmeePersonaText', () => {
  it('rewrites ครับ to ค่ะ (T-052: "...มีดังนี้ครับ")', () => {
    assert.equal(sanitizeMangmeePersonaText('ยอดรวมทั้งสิ้น 17,765 บาท มีดังนี้ครับ'), 'ยอดรวมทั้งสิ้น 17,765 บาท มีดังนี้ค่ะ');
  });

  it('rewrites ผม to น้องมั่งมี (T-007: "ขอโทษครับ ผมยังไม่มีข้อมูล...")', () => {
    assert.equal(sanitizeMangmeePersonaText('ขอโทษครับ ผมยังไม่มีข้อมูลใบเบิกของคุณ'), 'ขอโทษค่ะ น้องมั่งมียังไม่มีข้อมูลใบเบิกของคุณ');
  });

  it('rewrites every occurrence, not only the first', () => {
    assert.equal(sanitizeMangmeePersonaText('ครับ ครับ ผม ผม'), 'ค่ะ ค่ะ น้องมั่งมี น้องมั่งมี');
  });

  it('leaves text with neither token unchanged', () => {
    const text = 'ค่าใช้จ่ายเดือนนี้ 17,765 บาทค่ะ';
    assert.equal(sanitizeMangmeePersonaText(text), text);
  });
});

describe('persona prompt content', () => {
  it('forbids the male ครับ particle and reserves น้องมั่งมี as the only self-reference', () => {
    assert.ok(MANGMEE_PERSONA_LINES.some((line) => line.includes('never the male ครับ')));
    assert.ok(MANGMEE_PERSONA_LINES.some((line) => /หนู, ผม, or ดิฉัน/.test(line)));
  });

  it('tuning-3 item 3: forbids English business/system jargon in favor of the Thai word customers see', () => {
    const jargonLine = MANGMEE_PERSONA_LINES.find((line) => line.includes('Sales/AR'));
    assert.ok(jargonLine, 'expected a persona line naming the forbidden English jargon');
    assert.match(jargonLine!, /Expense/);
    assert.match(jargonLine!, /Reimbursement/);
    assert.match(jargonLine!, /ค่าใช้จ่าย/);
  });

  it('joins every line into one prompt block', () => {
    for (const line of MANGMEE_PERSONA_LINES) assert.ok(MANGMEE_PERSONA_PROMPT.includes(line));
  });
});
