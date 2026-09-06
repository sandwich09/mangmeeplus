import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { advisorDirectAnswerText, type AdvisorDirectAnswerContext } from './line-advisor-direct-answer.logic';

const clearCtx: AdvisorDirectAnswerContext = {
  advisorEnabled: true,
  routedAdvisor: true,
  hasAttachment: false,
  hasOpenClarifications: false,
  hasActiveExpenseDrafts: false,
  hasPendingMediaCapsule: false,
  hasSubstituteState: false,
  capabilityQuestion: false,
};

const socialAnswer = {
  version: 1,
  mode: 'SOCIAL_CHAT',
  confidence: 0.95,
  needsTools: false,
  answerText: 'สวัสดีค่ะ วันนี้เป็นยังไงบ้างคะ 😊',
};

describe('advisorDirectAnswerText (Slice A)', () => {
  it('delivers a confident social answer with a clear turn state', () => {
    assert.equal(advisorDirectAnswerText(socialAnswer, clearCtx), socialAnswer.answerText);
  });

  it('declines when advisor mode is off or the outer route is not ADVISOR_CONVERSATION', () => {
    assert.equal(advisorDirectAnswerText(socialAnswer, { ...clearCtx, advisorEnabled: false }), null);
    assert.equal(advisorDirectAnswerText(socialAnswer, { ...clearCtx, routedAdvisor: false }), null);
  });

  it('declines whenever ANY open turn state exists (§9.1 rows 1–6)', () => {
    for (const flag of ['hasAttachment', 'hasOpenClarifications', 'hasActiveExpenseDrafts', 'hasPendingMediaCapsule', 'hasSubstituteState', 'capabilityQuestion'] as const) {
      assert.equal(advisorDirectAnswerText(socialAnswer, { ...clearCtx, [flag]: true }), null, flag);
    }
  });

  it('Slice A gates: non-social mode, needsTools, cards, profile fields, family all decline', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, mode: 'BUSINESS_ADVISOR' }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, needsTools: true }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, knowledgeCardIds: ['card-1'] }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, companyProfileFieldsUsed: ['businessType'] }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, responseFamilyId: 'fam-1' }, clearCtx), null);
  });

  it('confidence is a veto-only floor at 0.80', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, confidence: 0.79 }, clearCtx), null);
    assert.ok(advisorDirectAnswerText({ ...socialAnswer, confidence: 0.8 }, clearCtx));
  });

  it('a refusal or clarification always takes the full path', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, refusalCode: 'mutation_blocked' }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, clarificationQuestion: 'หมายถึงเรื่องไหนคะ' }, clearCtx), null);
  });

  it('a baht amount vetoes (no grounding source in social); plain numbers pass', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: 'ค่าปรับประมาณ 200 บาท ค่ะ' }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: 'ราคา ๕๐๐ บาท ค่ะ' }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: 'อยู่ที่ ฿1,200 ค่ะ' }, clearCtx), null);
    assert.ok(advisorDirectAnswerText({ ...socialAnswer, answerText: 'ร้านส่วนใหญ่เปิด 8 โมงเช้าค่ะ 555' }, clearCtx));
  });

  it('malformed wire data (missing answerText, raw URL, unknown key) declines via the parser', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: undefined }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: 'ดูที่ https://example.com นะคะ' }, clearCtx), null);
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, offeredCards: [] }, clearCtx), null);
    assert.equal(advisorDirectAnswerText(undefined, clearCtx), null);
  });

  // UAT 2026-09-06 (build f2bd38ed): this exact draft reached the customer. The persona is enforced
  // here deterministically, not only in the prompt — fail-closed to the composer turn, never repaired.
  it('vetoes the UAT off-persona draft and every male particle / own ผม / wrong self-name (spec §9.2)', () => {
    const uat = 'สวัสดีครับ! หนูคือ AI Assistant ของ MangmeePlus 🤖 พร้อมช่วยคุณจัดการค่าใช้จ่าย ดูข้อมูลธุรกิจ และตอบคำถามต่างๆ มีอะไรให้ช่วยไหมครับ?';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: uat }, clearCtx), null);
    for (const off of [
      'สวัสดีครับ น้องมั่งมีเองค่ะ', // one stray ครับ is enough
      'ยินดีครับผม',
      'ได้เลยนะครับ',
      'ผมชื่อน้องมั่งมีค่ะ',
      'สวัสดีค่ะ ผมพร้อมช่วยเสมอค่ะ',
      'น้องมั่งมีคือผู้ช่วย AI ของ MangmeePlus ค่ะ',
      'I am the WatchDog assistant, nice to meet you.',
      'I am Mangmee Plus AI, happy to help!',
    ]) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: off }, clearCtx), null, off);
    }
  });

  // Owner 2026-09-06: no robot icon in any reply; a smiling/laughing emoticon is fine when it fits.
  it('vetoes the robot emoji 🤖; a smile, a laugh or 555 still passes', () => {
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: 'น้องมั่งมีเองค่ะ 🤖 ยินดีช่วยเหลือค่ะ' }, clearCtx), null);
    for (const fine of ['ยินดีค่ะ 😊', 'ฮ่า ๆ ขำจริงค่ะ 😄', 'ตัวหนังสือค่ะ 555']) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: fine }, clearCtx), fine, fine);
    }
  });

  // Owner 2026-09-06: she is น้องมั่งมี (or มั่งมี), never หนู — line-initial, or after a space with a
  // self-predicate; a user's quoted «หนู…» and a หนู that is not her own pronoun stay deliverable.
  it('vetoes หนู as her own pronoun; a quoted «หนู…» does not veto', () => {
    for (const off of ['หนูคือน้องมั่งมีค่ะ', 'สวัสดีค่ะ หนูชื่อน้องมั่งมีนะคะ', 'สวัสดีค่ะ หนูยินดีช่วยเสมอค่ะ', 'หนูเองค่ะ ถามได้เลยนะคะ']) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: off }, clearCtx), null, off);
    }
    const quoted = 'ที่คุณเล่าว่า «หนูเหนื่อยมาก» น้องมั่งมีเข้าใจค่ะ';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: quoted }, clearCtx), quoted);
  });

  it('delivers a proper น้องมั่งมี answer; a user-quoted «ผม…» and hair (ตัดผม) never veto', () => {
    const proper = 'สวัสดีค่ะ น้องมั่งมีเองค่ะ ผู้ช่วยประจำร้านที่คอยช่วยเรื่องค่าใช้จ่ายและงานในระบบนะคะ 😊';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: proper }, clearCtx), proper);
    const quoted = 'ที่คุณพิมพ์ว่า «ผมเหนื่อยมาก» น้องมั่งมีเข้าใจเลยค่ะ พักสักหน่อยนะคะ';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: quoted }, clearCtx), quoted);
    for (const hair of ['ร้านตัดผมแถวนี้ส่วนใหญ่เปิดสายค่ะ', 'ผมสั้นก็ดูสดใสดีนะคะ', 'ทรงผมสั้นเข้ากับหน้าร้อนค่ะ', 'ช่วง ผมร่วง ลองลดความเครียดดูนะคะ']) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: hair }, clearCtx), hair, hair);
    }
    const quotedFormal = 'ที่คุณเล่าว่า «ดิฉันเหนื่อย» น้องมั่งมีเข้าใจค่ะ';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: quotedFormal }, clearCtx), quotedFormal);
  });

  // Review 2026-09-06: Thai writes no word spaces, so "วันนี้ผม…" and "แต่ผม…" are her own ผม just as much
  // as a line-initial one; ดิฉัน is only ever a first-person pronoun; and a model that names its vendor
  // or calls itself a language model is off-persona whatever the particle.
  it('vetoes her own ผม/ดิฉัน anywhere outside a quote or a hair word, and vendor/model self-names', () => {
    for (const off of [
      'สวัสดีค่ะ ผมดีใจที่ได้คุยด้วยนะคะ',
      'วันนี้ผมไม่ค่อยแน่ใจค่ะ',
      'แต่ผมคิดว่าน่าจะไหวค่ะ',
      'สวัสดีค่ะ ดิฉันชื่อน้องมั่งมีค่ะ',
      'สวัสดีค่ะ ฉันคือ Claude ผู้ช่วย AI ที่สร้างโดย Anthropic ค่ะ',
      'ฉันเป็น AI ของ MangmeePlus ค่ะ ยินดีช่วยเหลือค่ะ',
      'I am a large language model trained by OpenAI.',
      'ฉันคือ ChatGPT ค่ะ',
    ]) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: off }, clearCtx), null, off);
    }
  });

  it('a list or numbered steps is a tutorial, which the walkthrough lane owns — never a social draft', () => {
    for (const tutorial of [
      'ง่ายมากค่ะ\n1) ถ่ายรูปใบเสร็จส่งมา\n2) ตรวจยอดแล้วกดยืนยัน\n3) พิมพ์ถามสรุปได้เลย',
      'ทำได้ 2 อย่างค่ะ • ดูค่าใช้จ่าย • ดูงานค้าง',
      'Step 1. send a receipt. Step 2. confirm the draft.',
    ]) {
      assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: tutorial }, clearCtx), null, tutorial);
    }
    // One line break for breathing room is still a chat-sized answer.
    const twoLines = 'เข้าใจเลยค่ะ\nพักสักหน่อยแล้วค่อยลุยต่อนะคะ';
    assert.equal(advisorDirectAnswerText({ ...socialAnswer, answerText: twoLines }, clearCtx), twoLines);
  });
});
