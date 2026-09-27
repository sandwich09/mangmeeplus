import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE,
  LINE_AI_ADVISOR_ANSWER_BOUNDS,
  parseLineAiPreparedAdvisorAnswer,
} from './line-ai-advisor-answer.js';
import {
  ADVISOR_REFUSAL_CODES, ADVISOR_TONE_PREFACES, asIntakeRouteIntent, asIntakeRouterCapabilities,
  isBusinessIntakeIntent, LINE_INTAKE_ROUTE_INTENTS, MANGMEE_CONVERSATION_MODES,
} from './line-ai.js';
import type { AdvisorRefusalCode, AdvisorTonePreface, MangmeeConversationMode, PreparedAdvisorAnswer } from './line-ai.js';
import { createLineAiInputEvidence } from './line-ai-input-evidence.js';

/** The minimal SOCIAL_CHAT envelope Slice A emits: route fields plus a short answer, nothing else. */
function socialAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    mode: 'SOCIAL_CHAT',
    confidence: 0.92,
    needsTools: false,
    answerText: 'สบายดีค่ะ วันนี้มีอะไรให้ช่วยไหมคะ',
    ...overrides,
  };
}

describe('parseLineAiPreparedAdvisorAnswer – legacy absence and non-objects', () => {
  it('returns undefined for an older gateway/artifact that sends nothing', () => {
    for (const legacy of [undefined, null, '', 'x', 3, true, [], () => {}]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(legacy as unknown), undefined);
    }
  });

  it('a route plan without the optional field stays valid and carries no advisor data', () => {
    // Old/new artifact compatibility: absence is the safe default, never an error.
    const legacyPlan = { status: 'ROUTED' as const, intent: 'UNSUPPORTED' as const, language: 'th', confidence: 0.4 };
    assert.equal((legacyPlan as { advisorAnswer?: PreparedAdvisorAnswer }).advisorAnswer, undefined);
    assert.equal(parseLineAiPreparedAdvisorAnswer((legacyPlan as Record<string, unknown>)['advisorAnswer']), undefined);
  });
});

describe('parseLineAiPreparedAdvisorAnswer v2 input binding', () => {
  it('requires and preserves the digest of the complete raw input', async () => {
    const input = await createLineAiInputEvidence({ turnKey: 'advisor-1', parts: [
      { partId: 'p1', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: 'สวัสดีค่ะ' },
    ] });
    assert.ok(input);
    const answer = { ...socialAnswer(), version: 2, inputDigest: input.inputEvidence.joinedSha256 };
    assert.equal(parseLineAiPreparedAdvisorAnswer(answer, input.inputEvidence)?.version, 2);
    assert.equal(parseLineAiPreparedAdvisorAnswer(answer), undefined, 'v2 answer cannot be detached from its source input');
    assert.equal(parseLineAiPreparedAdvisorAnswer({ ...answer, inputDigest: 'b'.repeat(64) }, input.inputEvidence), undefined);
  });
});

describe('parseLineAiPreparedAdvisorAnswer – valid social envelope', () => {
  it('rebuilds the minimal SOCIAL_CHAT envelope with the empty-citation defaults', () => {
    const parsed = parseLineAiPreparedAdvisorAnswer(socialAnswer());
    assert.ok(parsed);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.mode, 'SOCIAL_CHAT');
    assert.equal(parsed.confidence, 0.92);
    assert.equal(parsed.needsTools, false);
    assert.equal(parsed.answerText, 'สบายดีค่ะ วันนี้มีอะไรให้ช่วยไหมคะ');
    // Omitting both id arrays claims nothing — the narrowest possible claim, so the minimal envelope
    // never pays output tokens for two empty lists.
    assert.deepEqual(parsed.knowledgeCardIds, []);
    assert.deepEqual(parsed.companyProfileFieldsUsed, []);
    assert.deepEqual(Object.keys(parsed).sort(), [
      'answerText', 'companyProfileFieldsUsed', 'confidence', 'knowledgeCardIds', 'mode', 'needsTools', 'version',
    ]);
  });

  it('accepts every optional field by explicit membership and trims bounded prose', () => {
    const parsed = parseLineAiPreparedAdvisorAnswer(socialAnswer({
      answerText: '  เข้าใจเลยค่ะ  ',
      tonePreface: 'acknowledge_stress',
      clarificationQuestion: '  อยากให้ช่วยดูเรื่องไหนก่อนคะ  ',
      refusalCode: 'safety_crisis',
      responseFamilyId: 'family.social.v1',
      knowledgeCardIds: [' card-a '],
      companyProfileFieldsUsed: ['vatRegistered'],
    }));
    assert.ok(parsed);
    assert.equal(parsed.answerText, 'เข้าใจเลยค่ะ');
    assert.equal(parsed.clarificationQuestion, 'อยากให้ช่วยดูเรื่องไหนก่อนคะ');
    assert.equal(parsed.tonePreface, 'acknowledge_stress');
    assert.equal(parsed.refusalCode, 'safety_crisis');
    assert.equal(parsed.responseFamilyId, 'family.social.v1');
    assert.deepEqual(parsed.knowledgeCardIds, ['card-a']);
    assert.deepEqual(parsed.companyProfileFieldsUsed, ['vatRegistered']);
  });

  it('every spec mode, tone preface and refusal code round-trips', () => {
    for (const mode of MANGMEE_CONVERSATION_MODES) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ mode }))?.mode, mode);
    }
    for (const tone of ADVISOR_TONE_PREFACES) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ tonePreface: tone }))?.tonePreface, tone);
    }
    for (const code of ADVISOR_REFUSAL_CODES) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ refusalCode: code }))?.refusalCode, code);
    }
  });

  it('rebuilds fresh arrays: mutating the wire value after parse cannot reach the contract', () => {
    const cards = ['card-a'];
    const wire = socialAnswer({ knowledgeCardIds: cards });
    const parsed = parseLineAiPreparedAdvisorAnswer(wire);
    cards.push('card-forged');
    assert.deepEqual(parsed?.knowledgeCardIds, ['card-a']);
  });
});

describe('parseLineAiPreparedAdvisorAnswer – invalid version, enum and confidence fall back', () => {
  it('rejects any version other than 1', () => {
    for (const version of [undefined, null, 0, 2, '1', 1.5, true]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ version })), undefined, String(version));
    }
  });

  it('rejects an unknown mode, tone preface or refusal code (no blind cast of a wire string)', () => {
    for (const mode of [undefined, null, 'SOCIAL', 'social_chat', 'ANYTHING', 1, {}]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ mode })), undefined, String(mode));
    }
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ tonePreface: 'acknowledge_anything' })), undefined);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ refusalCode: 'because_i_said_so' })), undefined);
  });

  it('rejects a confidence outside [0,1] or non-finite', () => {
    for (const confidence of [undefined, null, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.9']) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ confidence })), undefined, String(confidence));
    }
  });

  it('requires a boolean needsTools — an omitted value is invalid output, not a guess to repair', () => {
    for (const needsTools of [undefined, null, 'false', 0, 1]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ needsTools })), undefined, String(needsTools));
    }
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ needsTools: true }))?.needsTools, true);
  });

  it('confidence is VETO-only at delivery: the parser keeps a low-confidence draft intact', () => {
    // The 0.80 floor is a delivery-time veto (spec §9.1), not a parse rule — parsing a low value must
    // not silently drop the draft, or the veto could never be observed and logged.
    const low = parseLineAiPreparedAdvisorAnswer(socialAnswer({ confidence: 0.1 }));
    assert.equal(low?.confidence, 0.1);
    assert.equal(ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE, 0.8);
  });
});

describe('parseLineAiPreparedAdvisorAnswer – bounds', () => {
  it('rejects an oversize wrapper and oversize prose/labels', () => {
    const big = 'ก'.repeat(LINE_AI_ADVISOR_ANSWER_BOUNDS.maxEncodedBytes);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ answerText: big })), undefined);
    // answerText one byte over its own cap (ASCII keeps the byte count exact).
    const overText = 'a'.repeat(LINE_AI_ADVISOR_ANSWER_BOUNDS.maxAnswerTextBytes + 1);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ answerText: overText })), undefined);
    assert.ok(parseLineAiPreparedAdvisorAnswer(socialAnswer({ answerText: 'a'.repeat(LINE_AI_ADVISOR_ANSWER_BOUNDS.maxAnswerTextBytes) })));
    const overQuestion = 'a'.repeat(LINE_AI_ADVISOR_ANSWER_BOUNDS.maxQuestionBytes + 1);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ clarificationQuestion: overQuestion })), undefined);
    const overLabel = 'a'.repeat(LINE_AI_ADVISOR_ANSWER_BOUNDS.maxLabelBytes + 1);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ responseFamilyId: overLabel })), undefined);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ knowledgeCardIds: [overLabel] })), undefined);
  });

  it('rejects too many card ids or profile fields, and any non-string / empty member', () => {
    const many = Array.from({ length: LINE_AI_ADVISOR_ANSWER_BOUNDS.maxArrayItems + 1 }, (_, i) => `card-${i}`);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ knowledgeCardIds: many })), undefined);
    assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ companyProfileFieldsUsed: many })), undefined);
    for (const bad of ['card-a', { id: 'x' }, [['card-a']], [1], ['  '], [null]]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ knowledgeCardIds: bad })), undefined, JSON.stringify(bad));
    }
  });

  it('rejects empty or non-string prose rather than delivering a blank reply', () => {
    for (const text of ['', '   ', 5, {}, ['hi']]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ answerText: text })), undefined, JSON.stringify(text));
    }
  });
});

describe('parseLineAiPreparedAdvisorAnswer – model may not author links, markup or provenance', () => {
  it('rejects a raw URL, HTML or Flex/JSON inside model prose', () => {
    for (const text of [
      'ดูที่ https://example.com ค่ะ',
      'www.example.com',
      '<b>hi</b>',
      '{"type":"bubble"}',
      '[{"type":"text"}]',
    ]) {
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ answerText: text })), undefined, text);
      assert.equal(parseLineAiPreparedAdvisorAnswer(socialAnswer({ clarificationQuestion: text })), undefined, text);
    }
  });

  it('REJECTS (never strips) any key outside the closed set — prototype and forged provenance alike', () => {
    for (const forged of [
      { constructor: 'x' },
      { prototype: 'x' },
      { advisorContext: { offeredCards: [], profileLoaded: true } },
      { offeredCards: [{ id: 'c', version: 1 }] },
      { profileLoaded: true },
      { intent: 'BUSINESS_READ_QUESTION' },
      { intakeIntent: 'ADVISOR_CONVERSATION' },
      { companyId: 'other-tenant' },
      { permissions: ['company.advisory.read'] },
      { extra: 'ignored' },
    ] as Record<string, unknown>[]) {
      const wire = { ...socialAnswer(), ...forged };
      assert.equal(parseLineAiPreparedAdvisorAnswer(wire), undefined, JSON.stringify(forged));
    }
    // `__proto__` in an object literal sets the prototype instead of an own key, so the only way an
    // own one reaches the parser is through JSON — which is exactly how model output arrives.
    const ownProtoKey = JSON.parse('{"version":1,"mode":"SOCIAL_CHAT","confidence":0.9,"needsTools":false,"__proto__":{"polluted":true}}') as unknown;
    assert.equal(parseLineAiPreparedAdvisorAnswer(ownProtoKey), undefined);
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined, 'Object.prototype untouched');
  });

  it('rejects a prototype-swapped wrapper (not a plain object)', () => {
    const hostile = Object.create({ version: 1 }) as Record<string, unknown>;
    hostile['mode'] = 'SOCIAL_CHAT';
    assert.equal(parseLineAiPreparedAdvisorAnswer(hostile), undefined);
  });
});

describe('advisor route contract – membership at every receiver boundary', () => {
  it('ADVISOR_CONVERSATION is a member of the shared intake-intent registry', () => {
    assert.ok((LINE_INTAKE_ROUTE_INTENTS as readonly string[]).includes('ADVISOR_CONVERSATION'));
    assert.equal(asIntakeRouteIntent('ADVISOR_CONVERSATION'), 'ADVISOR_CONVERSATION');
    for (const intent of LINE_INTAKE_ROUTE_INTENTS) assert.equal(asIntakeRouteIntent(intent), intent);
    assert.equal(asIntakeRouteIntent('ADVISOR'), undefined);
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.3: which intake outcomes mean "this turn is about
  // the company's own records", so a refusal on one reads "not on LINE yet" and not "out of scope".
  it('treats every intake outcome except CLARIFY and UNSUPPORTED as business', () => {
    for (const intent of LINE_INTAKE_ROUTE_INTENTS) {
      assert.equal(isBusinessIntakeIntent(intent), intent !== 'CLARIFY' && intent !== 'UNSUPPORTED', intent);
    }
    assert.equal(isBusinessIntakeIntent(undefined), false, 'no provenance is not a business claim');
    assert.equal(isBusinessIntakeIntent('BUSINESS'), false, 'and neither is an unknown string');
  });

  it('the runtime mode/tone/refusal mirrors match their types exactly', () => {
    const modes: readonly MangmeeConversationMode[] = MANGMEE_CONVERSATION_MODES;
    const tones: readonly AdvisorTonePreface[] = ADVISOR_TONE_PREFACES;
    const codes: readonly AdvisorRefusalCode[] = ADVISOR_REFUSAL_CODES;
    assert.deepEqual([...modes], ['SOCIAL_CHAT', 'BUSINESS_ADVISOR', 'COMPANY_INSIGHT', 'LIVE_QUERY', 'ACTION_OR_HANDOFF', 'SAFETY_OR_PRIVACY']);
    assert.deepEqual([...tones], ['none', 'acknowledge_stress', 'acknowledge_good_news']);
    assert.deepEqual([...codes], ['mutation_blocked', 'safety_crisis', 'privacy_rumor', 'unsupported_module', 'unsupported_yet', 'insufficient_current_data']);
  });

  it('ONLY a literal boolean true activates the trusted advisor capability', () => {
    assert.equal(asIntakeRouterCapabilities({ advisor: true }).advisor, true);
    for (const truthy of [1, '1', 'true', {}, [], [true], 'yes']) {
      assert.equal(asIntakeRouterCapabilities({ advisor: truthy }).advisor, undefined, String(truthy));
    }
    assert.equal(asIntakeRouterCapabilities({ advisor: false }).advisor, undefined);
    assert.equal(asIntakeRouterCapabilities({}).advisor, undefined);
    // A polluted prototype cannot supply the flag: only own literal-true counts.
    const viaProto = Object.create({ advisor: true }) as Record<string, unknown>;
    assert.equal(asIntakeRouterCapabilities(viaProto).advisor, undefined);
  });
});
