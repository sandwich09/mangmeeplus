/**
 * tuning-3 item 3 (spec R-A5, eval T-007/T-052/T-130/T-131/T-133): น้องมั่งมี always speaks with
 * ค่ะ/คะ and never ครับ/ผม, even when the customer's own message used them — a real model sometimes
 * mirrors the customer's tone into its OWN composed reply anyway. `sanitizeMangmeePersonaText` is
 * the deterministic backstop wired into semantic-turn-v2.ts's compose step (see
 * semantic-turn-v2-compose-pipeline.spec.ts for the end-to-end wiring).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MANGMEE_PERSONA_LINES, MANGMEE_PERSONA_PROMPT, sanitizeMangmeeComposedText, sanitizeMangmeePersonaText } from './mangmee-persona';

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

  it('batch5 A5: forbids Markdown and requires short lines/bullets', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('**bold**'));
    assert.ok(line, 'expected a persona line forbidding Markdown');
    assert.match(line!, /# headings/);
    assert.match(line!, /• /);
  });

  // tuning-6a (E2, run 5: 24/77 compose calls answered in plain prose instead of the required
  // JSON): the Markdown and brevity rules must read as scoped to the text INSIDE the JSON
  // envelope, never as an instruction about the raw model output itself — shared by the intake
  // router prompt and ANSWER_PROMPT alike (mangmee-persona.ts's own history note: "one constant,
  // two prompts", now three).
  it('E2: the Markdown and brevity rules are scoped to the customer-visible text, never the JSON wrapper around it', () => {
    const markdownLine = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('**bold**'));
    const brevityLine = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('be brief'));
    for (const line of [markdownLine, brevityLine]) {
      assert.ok(line, 'expected a persona line governing text shape');
      assert.match(line!, /customer-visible text/);
      assert.match(line!, /never the JSON wrapper/);
    }
  });

  it('batch5 A5: forbids internal/English status keys and names the 8 Thai labels', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('NEEDS_REVIEW'));
    assert.ok(line, 'expected a persona line forbidding raw status keys');
    for (const label of ['จ่ายแล้ว', 'ยังไม่จ่าย', 'จ่ายบางส่วน', 'ร่าง', 'รอตรวจสอบ', 'ยืนยันแล้ว', 'ถูกปฏิเสธ', 'ยกเลิก']) {
      assert.ok(line!.includes(label), `expected the Thai label ${label}`);
    }
  });

  it('batch5 A5: requires the Buddhist-era year and forbids ISO dates/CE years in Thai text', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('Buddhist-era'));
    assert.ok(line, 'expected a persona line requiring Thai-style dates');
    assert.match(line!, /never an ISO date/);
  });

  it('batch5 A5: requires brevity — a direct first line and a short-bullets rule for knowledge answers', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('be brief'));
    assert.ok(line, 'expected a brevity persona line');
    assert.match(line!, /6 short lines/);
    assert.match(line!, /4 short bullets/);
  });
});

describe('sanitizeMangmeeComposedText (batch5 A6)', () => {
  it('T-009-a/T-052-a real sample: converts a markdown table into "• a — b — c" lines and drops the separator row', () => {
    const input = '| วันที่ | คู่ค้า | ยอดรวม | สถานะ |\n|---|---|---|---|\n| 11 ก.ย. 2569 | หจก. ออฟฟิศ ซัพพลาย | 1,670 บาท | ปฏิเสธ |';
    const result = sanitizeMangmeeComposedText(input);
    assert.ok(!result.includes('|'), result);
    assert.ok(!result.includes('---'), result);
    assert.equal(result, '• วันที่ — คู่ค้า — ยอดรวม — สถานะ\n• 11 ก.ย. 2569 — หจก. ออฟฟิศ ซัพพลาย — 1,670 บาท — ปฏิเสธ');
  });

  it('T-012-b real sample: strips ** emphasis and the parenthesized English gloss "(Draft)"', () => {
    const input = '**รายการที่ยังเป็นแบบร่าง (Draft) — รอบันทึกให้สมบูรณ์ก่อน**';
    const result = sanitizeMangmeeComposedText(input);
    assert.ok(!result.includes('**'), result);
    assert.ok(!result.includes('Draft'), result);
    assert.equal(result, 'รายการที่ยังเป็นแบบร่าง — รอบันทึกให้สมบูรณ์ก่อน');
  });

  it('T-013-a real sample: replaces a bare uppercase status token and converts the CE year after a Thai month to BE', () => {
    const input = 'ค่าใช้จ่ายที่จ่ายแล้ว (สถานะ PAID) ในเดือนกันยายน 2026';
    const result = sanitizeMangmeeComposedText(input);
    assert.ok(!result.includes('PAID'), result);
    assert.ok(!result.includes('2026'), result);
    assert.equal(result, 'ค่าใช้จ่ายที่จ่ายแล้ว (สถานะ จ่ายแล้ว) ในเดือนกันยายน 2569');
  });

  it('leaves a vendor name like "Grab" or "PTT" completely untouched', () => {
    const input = 'จ่าย Grab และซื้อน้ำมันที่ PTT รวม 500 บาท';
    assert.equal(sanitizeMangmeeComposedText(input), input);
  });

  it('strips a leading heading marker and a code fence', () => {
    assert.equal(sanitizeMangmeeComposedText('# สรุปยอด\nรวม 100 บาท'), 'สรุปยอด\nรวม 100 บาท');
    assert.equal(sanitizeMangmeeComposedText('```\nรวม 100 บาท\n```'), 'รวม 100 บาท');
  });

  it('replaces every listed status enum with its Thai label', () => {
    const input = 'DRAFT NEEDS_REVIEW CONFIRMED REJECTED VOIDED PAID UNPAID PARTIALLY_PAID READY_FOR_CONFIRMATION';
    assert.equal(sanitizeMangmeeComposedText(input),
      'ร่าง รอตรวจสอบ ยืนยันแล้ว ถูกปฏิเสธ ยกเลิก จ่ายแล้ว ยังไม่จ่าย จ่ายบางส่วน พร้อมยืนยัน');
  });

  it('never touches an already-Buddhist year, or a CE-looking number not adjacent to a Thai month', () => {
    assert.equal(sanitizeMangmeeComposedText('เดือนกันยายน 2569'), 'เดือนกันยายน 2569');
    assert.equal(sanitizeMangmeeComposedText('รหัสอ้างอิง 2026'), 'รหัสอ้างอิง 2026');
  });

  it('still applies the ครับ/ผม persona fix first (wraps sanitizeMangmeePersonaText)', () => {
    assert.equal(sanitizeMangmeeComposedText('ยอดรวม **100 บาท** มีดังนี้ครับ'), 'ยอดรวม 100 บาท มีดังนี้ค่ะ');
  });
});
