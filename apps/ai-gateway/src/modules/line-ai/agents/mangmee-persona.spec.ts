/**
 * tuning-3 item 3 (spec R-A5, eval T-007/T-052/T-130/T-131/T-133): น้องมั่งมี always speaks with
 * ค่ะ/คะ and never ครับ/ผม, even when the customer's own message used them — a real model sometimes
 * mirrors the customer's tone into its OWN composed reply anyway. `sanitizeMangmeePersonaText` is
 * the deterministic backstop wired into semantic-turn-v2.ts's compose step (see
 * semantic-turn-v2-compose-pipeline.spec.ts for the end-to-end wiring).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MANGMEE_PERSONA_LINES, MANGMEE_PERSONA_PROMPT, closesWithShopLine, sanitizeMangmeeComposedText, sanitizeMangmeePersonaText, shapeGeneralAnswer, steerBackLine,
  thaiForEnglishBusinessWords } from './mangmee-persona';

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
    const jargonLine = MANGMEE_PERSONA_LINES.find((line) => line.includes('In Thai replies'));
    assert.ok(jargonLine, 'expected the plain Thai control-name instruction');
    assert.match(jargonLine!, /everyday words/);
    assert.match(jargonLine!, /ใบเบิก/);
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

  it('batch5 A5: requires brevity — a direct first line for the customer-visible text', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('be brief'));
    assert.ok(line, 'expected a brevity persona line');
    assert.match(line!, /6 short lines/);
  });

  it('tuning-7 H5: caps total length, list bullets (with a link-to-full-list note), and knowledge-answer bullets tighter than before', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('be brief'));
    assert.ok(line, 'expected a brevity persona line');
    assert.match(line!, /80 Thai words/);
    assert.match(line!, /8 bullets/);
    assert.match(line!, /how many more/);
    assert.match(line!, /3 short bullets/);
    assert.doesNotMatch(line!, /4 short bullets/);
  });

  it('tuning-7 H5: still requires facts, limitations, scope, and questions to survive the brevity cut', () => {
    const line = MANGMEE_PERSONA_LINES.find((candidate) => candidate.includes('be brief'));
    assert.ok(line, 'expected a brevity persona line');
    assert.match(line!, /never drop a fact, limitation, scope line, or question/);
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

  it('round 10 real sample (NAT04 t1): names a web page in plain Thai instead of an app path with the company id', () => {
    const input = 'สองหมวดแรกรวมกันเกินครึ่งของเดือนนี้เลยนะคะ ดูรายละเอียดเพิ่มเติมได้ที่ /companies/w14-synthetic-company/expenses\n\n'
      + 'ลองส่งรูปใบเสร็จมาให้มั่งมีช่วยสร้างร่างให้ได้เลยนะคะ หรือเข้าไปยื่นเองที่ /companies/w14-synthetic-company/reimbursements ได้ค่ะ';
    const result = sanitizeMangmeeComposedText(input);
    assert.doesNotMatch(result, /\/companies\/|w14-synthetic-company/u);
    assert.equal(result, 'สองหมวดแรกรวมกันเกินครึ่งของเดือนนี้เลยนะคะ ดูรายละเอียดเพิ่มเติมได้ที่ หน้าค่าใช้จ่ายบนเว็บ\n\n'
      + 'ลองส่งรูปใบเสร็จมาให้มั่งมีช่วยสร้างร่างให้ได้เลยนะคะ หรือเข้าไปยื่นเองที่ หน้าใบเบิกบนเว็บ ได้ค่ะ');
    // A full app URL, a record path, a markdown link and any other app page get the same plain words; the full stop stays.
    assert.equal(sanitizeMangmeeComposedText('เปิดที่ https://app.example.test/companies/c-1/expenses/cmun9ll0j?openExternalBrowser=1 ได้เลยค่ะ'),
      'เปิดที่ หน้าค่าใช้จ่ายบนเว็บ ได้เลยค่ะ');
    assert.equal(sanitizeMangmeeComposedText('ดู[ที่นี่](/companies/c-1/reimbursements/draft-actions/a-1)นะคะ'), 'ดูที่นี่นะคะ');
    assert.equal(sanitizeMangmeeComposedText('ดูได้ที่ /companies/c-1/sales.'), 'ดูได้ที่ หน้าเว็บของบริษัท.');
    // Advisor S2a: the package tool's own page (billing.get_package_usage sourceRefs) has a name of its own.
    assert.equal(sanitizeMangmeeComposedText('ดูได้ที่ /companies/c-1/billing ค่ะ'), 'ดูได้ที่ หน้าแพ็กเกจบนเว็บ ค่ะ');
    // Advisor S2a real samples: a tool data field quoted in brackets is dropped; a web address or ordinary bracket stays.
    assert.equal(sanitizeMangmeeComposedText('คาดว่าจะไม่เกินโควต้า (projectedShortfall = 0) น่าจะพอค่ะ'), 'คาดว่าจะไม่เกินโควต้า น่าจะพอค่ะ');
    assert.equal(sanitizeMangmeeComposedText('และแพ็กเกจนี้ไม่มีการต่ออายุอัตโนมัติ (renewal: none) นะคะ'), 'และแพ็กเกจนี้ไม่มีการต่ออายุอัตโนมัติ นะคะ');
    for (const kept of ['ภาษีมูลค่าเพิ่ม (VAT 7%) รวมแล้ว', 'ดูประกาศได้ที่ (https://www.rd.go.th) นะคะ', 'แพ็กเกจ มืออาชีพ (PRO) ใช้ได้ถึง 21 ต.ค. 2569'])
      assert.equal(sanitizeMangmeeComposedText(kept), kept);
    // Anything that is not an app path is left alone.
    const plain = 'ค่าส่งของ/ค่าขนส่ง 350 บาท ดูได้ที่หน้าเว็บ';
    assert.equal(sanitizeMangmeeComposedText(plain), plain);
  });

  it('advisor S1: names the substitute-receipt and my-signature pages, never "หน้าค่าใช้จ่าย" for them', () => {
    assert.equal(sanitizeMangmeeComposedText('เซ็นได้ที่ /companies/c-1/expenses/substitute-receipts นะคะ'), 'เซ็นได้ที่ หน้าใบรับรองแทนใบเสร็จบนเว็บ นะคะ');
    assert.equal(sanitizeMangmeeComposedText('เปิด https://app.example.test/companies/c-1/expenses/substitute-receipts/cmx9a1b2?mode=view ได้เลยค่ะ'),
      'เปิด หน้าใบรับรองแทนใบเสร็จบนเว็บ ได้เลยค่ะ');
    assert.equal(sanitizeMangmeeComposedText('ดูได้ที่ /companies/c-1/expenses/substitute-receiptsค่ะ'), 'ดูได้ที่ หน้าใบรับรองแทนใบเสร็จบนเว็บค่ะ');
    assert.equal(sanitizeMangmeeComposedText('ตั้งลายเซ็นที่ /companies/c-1/expenses/signatures ค่ะ'), 'ตั้งลายเซ็นที่ หน้าลายเซ็นของฉันบนเว็บ ค่ะ');
  });

  it('advisor S1 eval sample: strips a parenthesized tool field name', () => {
    assert.equal(sanitizeMangmeeComposedText('• รายการรอตรวจสอบ (pendingReview) รวม 6 รายการ'), '• รายการรอตรวจสอบ รวม 6 รายการ');
    assert.equal(sanitizeMangmeeComposedText('ร้านเครื่องเขียน (สาขา 1) 350 บาท (Grab)'), 'ร้านเครื่องเขียน (สาขา 1) 350 บาท (Grab)');
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

// Advisor S0 (R1 integrated G run 2026-10-01): what the prompt alone did not hold for an answer that reads no company data.
describe('advisor S0: the shape of a general answer', () => {
  const STAFF = ['expense.read_own', 'expense.create', 'reimbursement.read_own'];
  const STEER = 'ถ้ามีเรื่องร้านหรือรายจ่ายให้ช่วย บอกได้เลยค่ะ';

  // G-06: a film list of five bullets; G-15: a recipe of eleven lines.
  it('cuts a non-business answer to two short lines with no list, then leads back to the shop', () => {
    const films = 'มั่งมีแนะนำหนังสนุกๆ ได้บ้างนะคะ 😊\n\n• Interstellar — ไซไฟอลังการ\n• Parasite — ระทึก พลิกโผ\n• Coco — อบอุ่นมากค่ะ\n\nถ้ามีเรื่องร้านหรือค่าใช้จ่ายให้ช่วย บอกได้เลยนะคะ';
    assert.equal(shapeGeneralAnswer(films, true, STAFF, false), `Interstellar — ไซไฟอลังการ\nParasite — ระทึก พลิกโผ\n\n${STEER}`);
    const recipe = 'ต้มยำกุ้งสูตรคลาสสิกค่ะ 😊\n\nวัตถุดิบหลัก\n• กุ้งสด, ตะไคร้หั่น, ใบมะกรูด\n• เห็ดฟาง, พริกขี้หนูสด\n\nวิธีทำ\n1. ต้มน้ำซุปจนหอม\n2. ใส่กุ้งและเห็ด';
    assert.equal(shapeGeneralAnswer(recipe, true, STAFF, false), `ต้มยำกุ้งสูตรคลาสสิกค่ะ 😊\nกุ้งสด, ตะไคร้หั่น, ใบมะกรูด\n\n${STEER}`);
  });

  it('leaves a non-business answer that already is two short lines alone, and bounds one long line', () => {
    const capital = 'โตเกียวคือเมืองหลวงของญี่ปุ่นค่ะ\nเป็นเมืองที่มีประชากรหนาแน่นมาก';
    const shaped = shapeGeneralAnswer(capital, true, STAFF, false);
    assert.equal(shaped, `${capital}\n\n${STEER}`);
    assert.equal(shapeGeneralAnswer(shaped, true, STAFF, false), shaped);
    // Smoke run 2026-10-01: one sentence of 185 characters naming three films is two short lines on a phone — kept whole.
    const films = 'แนะนำไม่กี่เรื่องที่สนุกมากนะคะ เช่น Inception (ความฝันซ้อนความฝัน), The Grand Budapest Hotel (ตลกดีมีสไตล์), หรือ Parasite (เกาหลีที่ได้ออสการ์) — แต่ละเรื่องดูได้หลายรอบเลยค่ะ 😊';
    assert.equal(shapeGeneralAnswer(films, true, STAFF, false), `${films}\n\n${STEER}`);
    // Longer than that is cut at a word, and never left hanging on a dash.
    const long = shapeGeneralAnswer(`${'คำตอบยาวมาก '.repeat(24)}— ${'x'.repeat(200)}`, true, STAFF, false).split('\n')[0]!;
    assert.ok(long.length <= 301 && long.endsWith('คำตอบยาวมาก…'), long);
  });

  // G-04, G-11, G-23: the line back to the shop closed business-knowledge answers too.
  it('takes the shop line off any other general answer and never shortens it', () => {
    const vat = 'เกณฑ์คือรายได้เกิน 1.8 ล้านบาทต่อปีค่ะ\n\n• ข้อหนึ่ง\n• ข้อสอง\n• ข้อสาม\n\nแนะนำให้ยืนยันกับนักบัญชีนะคะ';
    for (const line of ['ถ้ามีเรื่องร้านหรือค่าใช้จ่ายให้ช่วย บอกได้เลยค่ะ 😊', 'ถ้ามีเรื่องค่าใช้จ่ายหรือข้อมูลร้านให้ช่วย บอกได้เลยค่ะ 😊',
      'หากมีเรื่องร้านหรือรายจ่ายให้น้องมั่งมีช่วย บอกได้เลยนะคะ', STEER]) {
      assert.ok(closesWithShopLine(`${vat}\n\n${line}`), line);
      assert.equal(shapeGeneralAnswer(`${vat}\n\n${line}`, false, STAFF, false), vat);
    }
    assert.equal(closesWithShopLine(vat), false);
    assert.equal(shapeGeneralAnswer(vat, false, STAFF, false), vat);
    // A sentence about getting help from someone else is not her shop line.
    assert.equal(closesWithShopLine('ถ้ารายจ่ายของร้านสูงเกินไป ควรให้นักบัญชีช่วยตรวจนะคะ'), false);
  });

  // Six answers of the G run named an agency website from memory: rd.go.th, labour.go.th, tmd.go.th, www.sso.go.th.
  it('names the agency and drops a web address, leaving other dotted text alone', () => {
    assert.equal(shapeGeneralAnswer('แนะนำให้ปรึกษานักบัญชีหรือกรมสรรพากร (rd.go.th) เพื่อจดทะเบียนนะคะ', false, STAFF, false),
      'แนะนำให้ปรึกษานักบัญชีหรือกรมสรรพากร เพื่อจดทะเบียนนะคะ');
    assert.equal(shapeGeneralAnswer('ควรตรวจสอบกับสำนักงานประกันสังคมโดยตรงที่ www.sso.go.th ด้วยนะคะ', false, STAFF, false),
      'ควรตรวจสอบกับสำนักงานประกันสังคมโดยตรง ด้วยนะคะ');
    assert.equal(shapeGeneralAnswer('ดูประกาศได้ที่ https://www.mol.go.th/news นะคะ', false, STAFF, false), 'ดูประกาศได้ นะคะ');
    const kept = 'รายได้เกิน 1.8 ล้านบาท ยื่น ภ.พ.30 ตาม ม.33 ติดต่อ info@shop.com (อัตรา 7%)';
    assert.equal(shapeGeneralAnswer(kept, false, STAFF, false), kept);
  });

  it('leads back only to what this user can do here', () => {
    assert.equal(steerBackLine(STAFF, false), STEER);
    assert.equal(steerBackLine(['reimbursement.read_own'], false), 'ถ้ามีเรื่องร้านหรือใบเบิกให้ช่วย บอกได้เลยค่ะ');
    assert.equal(steerBackLine([], false), 'ถ้ามีเรื่องร้านให้ช่วย บอกได้เลยค่ะ');
    assert.equal(steerBackLine(STAFF, true), 'If there is anything about the shop or its expenses I can help with, just tell me.');
    assert.ok(closesWithShopLine(steerBackLine(STAFF, true)) && closesWithShopLine(steerBackLine([], false)));
  });
});

// Owner plain-Thai rule: "reset" and "margin" reached customers in Thai replies (advisor eval r10, final-assembly P-31).
describe('thaiForEnglishBusinessWords: two English business words in a Thai reply', () => {
  // A package read's own data: the field name "resetsOn" is not the word "reset".
  const usage = JSON.stringify(['เหลือกี่ใบ', { receipts: { resetsOn: '2026-11-01', remaining: 18 } }]);

  it('writes them in Thai, as whole words, with Thai spacing', () => {
    assert.equal(thaiForEnglishBusinessWords('รอบนี้เริ่มนับ 1 ต.ค. 2569 และจะ reset ใหม่ 1 พ.ย. 2569 นะคะ', usage), 'รอบนี้เริ่มนับ 1 ต.ค. 2569 และจะเริ่มนับใหม่ 1 พ.ย. 2569 นะคะ');
    assert.equal(thaiForEnglishBusinessWords('โควต้าจะ reset วันที่ 1 พ.ย. ค่ะ', usage), 'โควต้าจะเริ่มนับใหม่วันที่ 1 พ.ย. ค่ะ');
    assert.equal(thaiForEnglishBusinessWords('ต้นทุน AI ต่อใบเสร็จ กำไรต่อแพ็กเกจ หรือ margin ใดๆ เป็นข้อมูลภายในค่ะ', '["กำไรต่อแพ็กเกจเท่าไหร่"]'),
      'ต้นทุน AI ต่อใบเสร็จ กำไรต่อแพ็กเกจ หรือกำไรส่วนต่างใดๆ เป็นข้อมูลภายในค่ะ');
    assert.equal(thaiForEnglishBusinessWords('Reset ทุกต้นเดือนค่ะ ส่วน MARGIN 30% คือเป้าของร้าน', usage), 'เริ่มนับใหม่ทุกต้นเดือนค่ะ ส่วนกำไรส่วนต่าง 30% คือเป้าของร้าน');
    // r10 P-01: before a count of receipts "margin" is room to spare, never profit.
    assert.equal(thaiForEnglishBusinessWords('น่าจะพอค่ะ ยังเหลือ margin อีก 12 ใบ', usage), 'น่าจะพอค่ะ ยังเหลือเผื่ออีก 12 ใบ');
    assert.equal(thaiForEnglishBusinessWords('ร้านเหลือ margin 20% ค่ะ', usage), 'ร้านเหลือกำไรส่วนต่าง 20% ค่ะ');
  });

  it('never touches a quote, inline code, a web address, a longer word or an English reply', () => {
    for (const kept of [
      'คำว่า "margin" หมายถึงส่วนต่างกำไรค่ะ และ “reset” คือเริ่มใหม่',
      'ดูที่ https://example.com/reset หรือ www.margin.co.th ได้ค่ะ และ `reset` คือคำสั่ง',
      'กำไรขั้นต้น (gross margins) กับ resetting, pre-reset และ reset_at ไม่ใช่คำนี้ค่ะ',
      'The count will reset on Nov 1 and the margin is unknown.',
      'ใช้ไปแล้ว 12 ใบ เหลืออีก 18 ใบค่ะ',
    ]) assert.equal(thaiForEnglishBusinessWords(kept, usage), kept);
  });

  it('leaves a word the turn itself carries: it may be a name the user or a tool supplied', () => {
    const vendor = JSON.stringify(['จ่ายร้านไหนเยอะสุด', { byVendor: [{ name: 'Margin Cafe', amount: '300.00' }] }]);
    const text = 'ร้าน Margin Cafe จ่ายไป 300 บาทค่ะ margin ของร้านไม่ทราบค่ะ และจะ reset 1 พ.ย.';
    assert.equal(thaiForEnglishBusinessWords(text, vendor), 'ร้าน Margin Cafe จ่ายไป 300 บาทค่ะ margin ของร้านไม่ทราบค่ะ และจะเริ่มนับใหม่ 1 พ.ย.');
    const asked = 'ลูกค้าถามว่า reset รหัสผ่านยังไง ให้ reset ที่หน้าเว็บค่ะ';
    assert.equal(thaiForEnglishBusinessWords(asked, JSON.stringify(['reset รหัสผ่านยังไง'])), asked);
  });

  it('runs inside the composed-text backstop only when the turn\'s words are given', () => {
    assert.equal(sanitizeMangmeeComposedText('จะ reset ใหม่ 1 พ.ย. ครับ', true, usage), 'จะเริ่มนับใหม่ 1 พ.ย. ค่ะ');
    assert.equal(sanitizeMangmeeComposedText('จะ reset ใหม่ 1 พ.ย. ครับ'), 'จะ reset ใหม่ 1 พ.ย. ค่ะ');
  });
});


it('PWS-PLAIN-PERSONA uses everyday control names while retaining exact tax paper names', () => {
  const instruction = MANGMEE_PERSONA_LINES.find(line => line.startsWith('In Thai'))!;
  assert.ok(instruction.length <= 232, 'C72 must fit the 232-character develop instruction');
  assert.equal(instruction, 'In Thai replies, use plain control names ค่าใช้จ่าย and ใบเบิก and everyday words for accounting ideas. Use paper names หัก ณ ที่จ่าย, VAT, ภ.ง.ด.3, ภ.ง.ด.53 and หนังสือรับรอง 50 ทวิ only when the user needs the paper.');
});
