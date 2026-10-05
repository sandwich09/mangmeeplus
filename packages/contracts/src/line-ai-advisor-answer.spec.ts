import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE,
  LINE_AI_ADVISOR_ANSWER_BOUNDS,
  parseLineAiPreparedAdvisorAnswer,
} from './line-ai-advisor-answer.js';
import {
  ADVISOR_REFUSAL_CODES, ADVISOR_TONE_PREFACES, asIntakeRouteIntent, asIntakeRouterCapabilities,
  isBusinessIntakeIntent, LINE_AI_ANSWER_CARD_CONTEXTS, LINE_DRAFT_UPDATE_CARD_CONTEXT, LINE_DRAFT_UPDATE_CARD_STATES, LINE_INTAKE_ROUTE_INTENTS,
  lineDraftUpdateBlockedState, MANGMEE_CONVERSATION_MODES, parseLineAiAnswerCardLayout, parseLineAiResponsePreferenceCommand,
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

// NAT11 (2026-09-30): the router's answer-preference request is re-validated at every receiver, like the advisor draft.
describe('parseLineAiResponsePreferenceCommand', () => {
  it('keeps exact allowlisted list/set/delete requests and nothing else', () => {
    assert.deepEqual(parseLineAiResponsePreferenceCommand({ kind: 'list' }), { kind: 'list' });
    assert.deepEqual(parseLineAiResponsePreferenceCommand({ kind: 'set', values: { detail: 'short', presentation: 'bullets' } }),
      { kind: 'set', values: { detail: 'short', presentation: 'bullets' } });
    assert.deepEqual(parseLineAiResponsePreferenceCommand({ kind: 'delete', keys: ['detail'] }), { kind: 'delete', keys: ['detail'] });
    assert.deepEqual(parseLineAiResponsePreferenceCommand({ kind: 'delete', keys: 'all' }), { kind: 'delete', keys: 'all' });
    for (const invalid of [undefined, null, 'list', [], { kind: 'list', keys: 'all' }, { kind: 'set', values: {} }, { kind: 'set', values: { detail: 'tiny' } },
      { kind: 'set', values: { memo: 'รายได้ 1,000,000' } }, { kind: 'set', values: { detail: 'short' }, keys: 'all' }, { kind: 'delete', keys: [] },
      { kind: 'delete', keys: ['detail', 'detail'] }, { kind: 'delete', keys: ['balance'] }, { kind: 'delete', keys: 'everything' }, { kind: 'remember' },
      JSON.parse('{"kind":"set","values":{"__proto__":{"detail":"short"}}}')]) {
      assert.equal(parseLineAiResponsePreferenceCommand(invalid), undefined, JSON.stringify(invalid));
    }
  });

  it('is a trusted router capability only as a literal true', () => {
    assert.deepEqual(asIntakeRouterCapabilities({ responsePreference: true }), { responsePreference: true });
    assert.deepEqual(asIntakeRouterCapabilities({ responsePreference: 'true' }), {});
  });
});

// ── The card layout an answer may carry (design lock 2026-10-04) ──────────────────────────────────
// Optional presentation metadata on `LineAiAnswerCard`, written by the trusted gateway from tool
// results. Every receiver re-parses it; what does not parse is dropped and the card is its `text`.
describe('parseLineAiAnswerCardLayout — bounded presentation metadata, never Flex', () => {
  const layout = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    context: 'payment',
    header: ['การชำระเงิน', 'ชำระแล้ว'],
    rows: [
      { label: 'ยอดสุทธิที่ต้องจ่าย', value: '1,284.00 บาท', emphasis: 'total' },
      { label: 'สถานะชำระเงิน', value: 'ชำระแล้ว', tone: 'ok' },
    ],
    banner: { tone: 'ok', text: 'ชำระแล้ว · ยอดคงค้าง 0.00 บาท' },
    notes: ['แสดงเฉพาะรายการของคุณ'],
    linkLabel: 'เปิดดูรายการในเว็บ',
    ...over,
  });

  it('returns exactly the fields it knows, for every context', () => {
    assert.deepEqual(parseLineAiAnswerCardLayout(layout()), layout());
    for (const context of LINE_AI_ANSWER_CARD_CONTEXTS) {
      const rows = context === 'edit_command' ? [] : [{ label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }];
      assert.deepEqual(parseLineAiAnswerCardLayout({ context, header: ['ก', 'ข'], rows }), { context, header: ['ก', 'ข'], rows }, context);
    }
  });

  it('returns undefined for an older gateway that sends nothing and for anything that is not a layout', () => {
    for (const legacy of [undefined, null, '', 'bubble', 3, true, [], () => {}]) assert.equal(parseLineAiAnswerCardLayout(legacy as unknown), undefined);
  });

  it('refuses Flex JSON and any key it does not know — a model can add nothing through this field', () => {
    for (const bad of [
      { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } },
      layout({ contents: { type: 'bubble' } }), layout({ type: 'flex' }), layout({ action: { type: 'uri', uri: 'https://evil.example' } }),
      layout({ rows: [{ label: 'ก', value: 'ข', action: { type: 'postback', data: 'x' } }] }),
      layout({ banner: { tone: 'ok', text: 'ก', color: '#ff0000' } }),
    ]) assert.equal(parseLineAiAnswerCardLayout(bad), undefined, JSON.stringify(bad));
  });

  it('refuses a context, tone or emphasis outside its list', () => {
    for (const bad of [
      layout({ context: 'marketing' }), layout({ context: undefined }), layout({ rows: [{ label: 'ก', value: 'ข', tone: 'danger' }] }),
      layout({ rows: [{ label: 'ก', value: 'ข', emphasis: 'bold' }] }), layout({ banner: { tone: 'closed', text: 'ก' } }), layout({ banner: { tone: 'scanning', text: 'ก' } }),
    ]) assert.equal(parseLineAiAnswerCardLayout(bad), undefined, JSON.stringify(bad));
  });

  it('holds the header to exactly two lines', () => {
    for (const header of [[], ['หัวเดียว'], ['ก', 'ข', 'ค'], ['ก', ''], ['ก', '   '], ['ก', 7], 'ก ข', ['ก'.repeat(41), 'ข']]) {
      assert.equal(parseLineAiAnswerCardLayout(layout({ header })), undefined, JSON.stringify(header));
    }
  });

  it('bounds every string, and never lets a link or a control character onto a card', () => {
    const rowOf = (label: string, value: string) => layout({ rows: [{ label, value }] });
    assert.ok(parseLineAiAnswerCardLayout(rowOf('ก'.repeat(40), 'ข'.repeat(200))));
    for (const bad of [
      rowOf('ก'.repeat(41), 'ข'), rowOf('ก', 'ข'.repeat(201)), rowOf('', 'ข'), rowOf('ก', ' '),
      rowOf('ลิงก์', 'ดู https://evil.example/x'), rowOf('ลิงก์', 'HTTP://evil.example'), rowOf('ก', 'บรรทัดแรก\nบรรทัดสอง'), rowOf('ก\u0000', 'ข'),
      layout({ notes: ['ก'.repeat(301)] }), layout({ notes: ['1', '2', '3', '4', '5'] }), layout({ notes: 'หมายเหตุ' }), layout({ notes: ['ดู http://evil.example'] }),
      layout({ banner: { tone: 'ok', text: 'ก'.repeat(121) } }), layout({ linkLabel: 'ก'.repeat(41) }), layout({ linkLabel: 'https://evil.example' }),
      layout({ rows: Array.from({ length: 17 }, () => ({ label: 'ก', value: 'ข' })) }), layout({ rows: 'ก' }), layout({ rows: [null] }),
    ]) assert.equal(parseLineAiAnswerCardLayout(bad), undefined, JSON.stringify(bad).slice(0, 120));
  });

  it('keeps rows for the cards that have them and none for the edit-command card, whose body is the answer text', () => {
    assert.equal(parseLineAiAnswerCardLayout(layout({ rows: [] })), undefined);
    assert.equal(parseLineAiAnswerCardLayout({ context: 'edit_command', header: ['แก้ไขค่าใช้จ่าย', 'รอยืนยัน'], rows: [{ label: 'ก', value: 'ข' }] }), undefined);
  });

  it('copies what it accepts: the result shares nothing with the untrusted input', () => {
    const input = layout();
    const parsed = parseLineAiAnswerCardLayout(input)!;
    (input['rows'] as Array<Record<string, unknown>>)[0]!['value'] = 'แก้ทีหลัง';
    (input['notes'] as string[]).push('เพิ่มทีหลัง');
    assert.equal(parsed.rows[0]!.value, '1,284.00 บาท');
    assert.deepEqual(parsed.notes, ['แสดงเฉพาะรายการของคุณ']);
  });
});

describe('edit-command card states — one set of words for the API and the gateway', () => {
  it('names the four locked states and the one for a record left as it was', () => {
    assert.equal(LINE_DRAFT_UPDATE_CARD_CONTEXT, 'แก้ไขค่าใช้จ่าย');
    assert.deepEqual(LINE_DRAFT_UPDATE_CARD_STATES, {
      preview: 'รอยืนยัน', applied: 'แก้ไขแล้ว', cancelled: 'ยกเลิกแล้ว', needs_input: 'ขอข้อมูลเพิ่ม', unchanged: 'ยังไม่ได้แก้ไข',
    });
  });

  it('calls a refusal a question only when the user can answer it', () => {
    for (const reason of ['ambiguous_line', 'ambiguous_record', 'ungrounded_value', 'invalid_patch']) assert.equal(lineDraftUpdateBlockedState(reason), 'needs_input', reason);
    for (const reason of ['mutation_blocked', 'no_recent_record', 'rate_limited', 'forbidden', '', 'anything_new']) assert.equal(lineDraftUpdateBlockedState(reason), 'unchanged', reason);
  });
});
