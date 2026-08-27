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
    for (const flag of ['hasAttachment', 'hasOpenClarifications', 'hasActiveExpenseDrafts', 'hasPendingMediaCapsule', 'hasSubstituteState'] as const) {
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
});
