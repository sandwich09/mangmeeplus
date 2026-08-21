import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_PREPARED_PLAN_BOUNDS, parseLineAiPreparedPlan } from './line-ai-prepared-plan.js';
import {
  asIntakeClarificationFields, asIntakeFundingSource, asIntakeRouteIntent, asIntakeRouterCapabilities, asIntakeSemanticOutcome,
  LINE_INTAKE_FUNDING_SOURCES, LINE_INTAKE_ROUTE_INTENTS, LINE_INTAKE_SEMANTIC_OUTCOMES,
} from './line-ai.js';
import type { LineAiPreparedPlan } from './line-ai.js';

function validIntentPlan() {
  return {
    status: 'ROUTABLE',
    language: 'th',
    intents: [{
      intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1,
      requiredTools: ['sales.get_sales_summary'], missingContext: [],
    }],
    refusals: [],
    requiresHumanReview: false,
  };
}

function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    complexity: 'simple',
    confidence: 0.9,
    intentPlan: validIntentPlan(),
    proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } }],
    responseMode: 'simple_grounded',
    answerShape: 'single_metric',
    ...overrides,
  };
}

describe('parseLineAiPreparedPlan – legacy absence and non-objects', () => {
  it('returns undefined for a legacy artifact / older caller that sends nothing', () => {
    for (const legacy of [undefined, null, '', 'x', 3, true, [], () => {}]) {
      assert.equal(parseLineAiPreparedPlan(legacy as unknown), undefined);
    }
  });
});

describe('parseLineAiPreparedPlan – valid plans', () => {
  it('rebuilds a valid simple plan into a fresh object with only known keys', () => {
    const parsed = parseLineAiPreparedPlan(validPlan({ extraTopLevel: 'ignored', companyId: 'forged' }));
    assert.ok(parsed);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.complexity, 'simple');
    assert.equal(parsed.confidence, 0.9);
    assert.equal(parsed.responseMode, 'simple_grounded');
    assert.equal(parsed.answerShape, 'single_metric');
    assert.deepEqual(parsed.proposedCalls, [
      { toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } },
    ]);
    // Forged/unknown top-level keys are dropped by the rebuild, never retained.
    assert.deepEqual(Object.keys(parsed).sort(), [
      'answerShape', 'complexity', 'confidence', 'intentPlan', 'proposedCalls', 'responseMode', 'version',
    ]);
    assert.equal((parsed as Record<string, unknown>)['companyId'], undefined);
  });

  it('accepts a complex plan with no proposed calls and no answerShape', () => {
    const parsed = parseLineAiPreparedPlan(validPlan({ complexity: 'complex', responseMode: 'full_agentic', proposedCalls: [], answerShape: undefined }));
    assert.ok(parsed);
    assert.equal(parsed.complexity, 'complex');
    assert.equal(parsed.answerShape, undefined);
    assert.deepEqual(parsed.proposedCalls, []);
  });

  it('accepts confidence across [0,1] on a complex plan without recomputing it', () => {
    // Complex plans are not subject to the simple veto floor, so the full range round-trips verbatim.
    for (const confidence of [0, 0.5, 1]) {
      const parsed = parseLineAiPreparedPlan(validPlan({ complexity: 'complex', responseMode: 'full_agentic', confidence }));
      assert.equal(parsed?.confidence, confidence);
    }
    // A simple plan keeps its own (>= floor) confidence unchanged.
    assert.equal(parseLineAiPreparedPlan(validPlan({ confidence: LINE_AI_PREPARED_PLAN_BOUNDS.simpleConfidenceFloor }))?.confidence, 0.85);
  });
});

describe('parseLineAiPreparedPlan – Phase-2 simple/zero-tool structural invariants', () => {
  it('vetoes a simple plan below the confidence floor', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({ confidence: 0.84 })), undefined);
    assert.ok(parseLineAiPreparedPlan(validPlan({ confidence: 0.85 })));
  });

  it('requires exactly one intent and at most one proposed call for a simple plan', () => {
    const twoIntents = { ...validIntentPlan(), intents: [validIntentPlan().intents[0], { intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 2, requiredTools: [], missingContext: [] }] };
    assert.equal(parseLineAiPreparedPlan(validPlan({ intentPlan: twoIntents })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [
      { toolName: 'sales.get_sales_summary', input: {} },
      { toolName: 'expense.list_recent', input: {} },
    ] })), undefined);
  });

  it('requires exact tool == requiredTools equality and a registered read tool for a simple call', () => {
    // Proposed tool not equal to the single required tool.
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [{ toolName: 'expense.list_recent', input: {} }] })), undefined);
    // requiredTools has a different single entry.
    assert.equal(parseLineAiPreparedPlan(validPlan({
      intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], requiredTools: ['expense.list_recent'] }] },
    })), undefined);
    // A registered but non-read (evidence-capture) tool cannot be a simple read.
    assert.equal(parseLineAiPreparedPlan(validPlan({
      intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], requiredTools: ['accounting.capture_receipt_evidence'] }] },
      proposedCalls: [{ toolName: 'accounting.capture_receipt_evidence', input: {} }],
    })), undefined);
  });

  it('accepts a zero-call simple plan only for casual/capability intents or an explicit refusal', () => {
    const casual = { ...validIntentPlan(), intents: [{ intent: 'casual_conversation', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }] };
    assert.ok(parseLineAiPreparedPlan(validPlan({ complexity: 'simple', responseMode: 'casual_composer', intentPlan: casual, proposedCalls: [] })));
    const capability = { ...validIntentPlan(), intents: [{ intent: 'capability_help', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }] };
    assert.ok(parseLineAiPreparedPlan(validPlan({ complexity: 'simple', responseMode: 'casual_composer', intentPlan: capability, proposedCalls: [] })));
    // Zero-call with an explicit refusal is a refusal turn → allowed.
    const refusing = { ...validIntentPlan(), intents: [{ intent: 'mutation_request', subject: 'expense', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [{ request: 'อนุมัติบิล', reason: 'mutation_blocked' }] };
    assert.ok(parseLineAiPreparedPlan(validPlan({ complexity: 'simple', responseMode: 'deterministic', intentPlan: refusing, proposedCalls: [] })));

    // Zero proposed calls but the intent still names a required tool → contradictory → drop.
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [] })), undefined);
    // Forged actionable read with zero required tools and no refusal → drop (must not pass as simple).
    const forgedRead = { ...validIntentPlan(), intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: [], missingContext: [] }] };
    assert.equal(parseLineAiPreparedPlan(validPlan({ complexity: 'simple', intentPlan: forgedRead, proposedCalls: [] })), undefined);
  });

  it('leaves complex plans free of the simple structural constraints', () => {
    const parsed = parseLineAiPreparedPlan(validPlan({
      complexity: 'complex', responseMode: 'full_agentic', confidence: 0.2,
      intentPlan: { ...validIntentPlan(), intents: [
        { intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] },
        { intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 2, requiredTools: ['expense.list_recent'], missingContext: [] },
      ] },
      proposedCalls: [
        { toolName: 'sales.get_sales_summary', input: {} },
        { toolName: 'expense.list_recent', input: {} },
      ],
    }));
    assert.ok(parsed);
    assert.equal(parsed.proposedCalls.length, 2);
  });
});

describe('parseLineAiPreparedPlan – enum allowed-set validation (no raw casts)', () => {
  it('rejects an intent/subject/agent/reason outside the allowed set', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({
      intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], intent: 'exfiltrate' }] },
    })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({
      intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], subject: 'nasdaq' }] },
    })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({
      intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], agent: 'root' }] },
    })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({
      complexity: 'complex', responseMode: 'full_agentic',
      intentPlan: { ...validIntentPlan(), refusals: [{ request: 'x', reason: 'because' }] },
    })), undefined);
  });
});

describe('parseLineAiPreparedPlan – invalid version / shape / enums', () => {
  it('rejects any version other than the exact allowlist', () => {
    for (const version of [0, 2, '1', 1.0001, null, undefined]) {
      assert.equal(parseLineAiPreparedPlan(validPlan({ version })), undefined, `version=${String(version)}`);
    }
  });

  it('rejects unknown complexity / responseMode / answerShape', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({ complexity: 'medium' })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ responseMode: 'stream' })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ answerShape: 'chart' })), undefined);
  });

  it('rejects a malformed wrapped intent plan rather than casting it', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({ intentPlan: { status: 'MAYBE' } })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ intentPlan: 'not-an-object' })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ intentPlan: { ...validIntentPlan(), intents: 'nope' } })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ intentPlan: { ...validIntentPlan(), requiresHumanReview: 'yes' } })), undefined);
  });
});

describe('parseLineAiPreparedPlan – confidence is veto-only, never authority', () => {
  it('rejects out-of-range or non-numeric confidence', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN, '0.9', null, undefined]) {
      assert.equal(parseLineAiPreparedPlan(validPlan({ confidence })), undefined, `confidence=${String(confidence)}`);
    }
  });
});

describe('parseLineAiPreparedPlan – oversize wrapper', () => {
  it('rejects an encoded wrapper over 32 KiB even when every field is individually in bounds', () => {
    const bigString = 'x'.repeat(LINE_AI_PREPARED_PLAN_BOUNDS.maxStringBytes);
    const wideInput: Record<string, string> = {};
    for (let i = 0; i < LINE_AI_PREPARED_PLAN_BOUNDS.maxKeysPerObject; i += 1) wideInput[`k${i}`] = bigString;
    const manyCalls = Array.from({ length: LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems }, () => ({
      toolName: 'sales.get_sales_summary', input: { ...wideInput },
    }));
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: manyCalls })), undefined);
  });
});

describe('parseLineAiPreparedPlan – proposed call / tool bounds', () => {
  it('rejects an unregistered tool name', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.delete_everything', input: {} }],
    })), undefined);
  });

  it('rejects a non-object proposed call or missing input', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: ['nope'] })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [{ toolName: 'sales.get_sales_summary' }] })), undefined);
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: [] }] })), undefined);
  });

  it('rejects more proposed calls than the array cap', () => {
    const overCap = Array.from({ length: LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems + 1 }, () => ({
      toolName: 'sales.get_sales_summary', input: {},
    }));
    assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: overCap })), undefined);
  });
});

describe('parseLineAiPreparedPlan – forged scope/credential input', () => {
  it('rejects scope, permission, entitlement, delegation, and credential keys in tool input', () => {
    for (const key of [
      'companyId', 'company', 'tenantId', 'branchId', 'branchIds', 'locationId',
      'userId', 'permissions', 'entitledFeatureKeys', 'actorDelegation', 'delegationToken',
      'credential', 'accessToken', 'membershipId', 'roles',
    ]) {
      assert.equal(
        parseLineAiPreparedPlan(validPlan({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { [key]: 'x' } }] })),
        undefined,
        `input key ${key} must be rejected`,
      );
    }
  });

  it('rejects a forged scope key nested inside the tool input', () => {
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { filter: { companyId: 'other-tenant' } } }],
    })), undefined);
  });
});

describe('parseLineAiPreparedPlan – prototype pollution', () => {
  it('rejects __proto__, prototype, and constructor keys parsed from wire JSON', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const wire = JSON.parse(`{"toolName":"sales.get_sales_summary","input":{${JSON.stringify(key)}:{"a":1}}}`) as unknown;
      assert.equal(parseLineAiPreparedPlan(validPlan({ proposedCalls: [wire] })), undefined, `key ${key}`);
    }
  });
});

describe('parseLineAiPreparedPlan – input depth / width / string bounds', () => {
  it('accepts exactly maxInputDepth nested objects and rejects one deeper', () => {
    assert.ok(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { a: { b: { c: { d: 1 } } } } }],
    })));
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { a: { b: { c: { d: { e: 1 } } } } } }],
    })), undefined);
  });

  it('rejects an oversized UTF-8 string, too many keys, and too many array items', () => {
    const overString = 'x'.repeat(LINE_AI_PREPARED_PLAN_BOUNDS.maxStringBytes + 1);
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { note: overString } }],
    })), undefined);

    const wide: Record<string, number> = {};
    for (let i = 0; i <= LINE_AI_PREPARED_PLAN_BOUNDS.maxKeysPerObject; i += 1) wide[`k${i}`] = i;
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: wide }],
    })), undefined);

    const longArray = Array.from({ length: LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems + 1 }, (_, i) => i);
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { ids: longArray } }],
    })), undefined);
  });

  it('accepts a multibyte string within the byte cap and rejects it just over', () => {
    // 3-byte characters: 170 chars = 510 bytes (ok), 171 chars = 513 bytes (over 512).
    const ok = '้'.repeat(170);
    const over = '้'.repeat(171);
    assert.ok(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { note: ok } }],
    })));
    assert.equal(parseLineAiPreparedPlan(validPlan({
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { note: over } }],
    })), undefined);
  });
});

describe('parseLineAiPreparedPlan – deep rebuild / mutation isolation', () => {
  it('deep-rebuilds nested input so a post-parse mutation of the wire value cannot reach the contract', () => {
    const wireInput: Record<string, unknown> = { filter: { ids: ['a', 'b'] }, tags: ['x'] };
    const wire = validPlan({ proposedCalls: [{ toolName: 'sales.get_sales_summary', input: wireInput }] });
    const parsed = parseLineAiPreparedPlan(wire);
    assert.ok(parsed);
    const parsedInput = parsed.proposedCalls[0].input as Record<string, any>;
    // Nested identity differs from the wire (fresh objects/arrays at every level).
    assert.notEqual(parsedInput, wireInput);
    assert.notEqual(parsedInput['filter'], wireInput['filter']);
    assert.notEqual(parsedInput['filter'].ids, (wireInput['filter'] as any).ids);
    assert.notEqual(parsedInput['tags'], wireInput['tags']);
    // Mutating the wire value after parse leaves the parsed contract unchanged.
    (wireInput['filter'] as any).ids.push('c');
    (wireInput['filter'] as any).injected = { companyId: 'other' };
    (wireInput['tags'] as any).length = 0;
    wireInput['extra'] = 'late';
    assert.deepEqual(parsed.proposedCalls[0].input, { filter: { ids: ['a', 'b'] }, tags: ['x'] });
  });

  it('rebuilds intent arrays so mutating wire requiredTools does not change the parsed plan', () => {
    const tools = ['sales.get_sales_summary'];
    const plan = validPlan({ intentPlan: { ...validIntentPlan(), intents: [{ ...validIntentPlan().intents[0], requiredTools: tools }] } });
    const parsed = parseLineAiPreparedPlan(plan);
    assert.ok(parsed);
    assert.notEqual(parsed.intentPlan.intents[0].requiredTools, tools);
    tools.push('expense.list_recent');
    assert.deepEqual(parsed.intentPlan.intents[0].requiredTools, ['sales.get_sales_summary']);
  });
});

describe('parseLineAiPreparedPlan – type is not widened', () => {
  it('narrows to LineAiPreparedPlan', () => {
    const parsed = parseLineAiPreparedPlan(validPlan());
    if (parsed) {
      const typed: LineAiPreparedPlan = parsed;
      assert.equal(typed.version, 1);
    }
  });
});

describe('parseLineAiPreparedPlan – wrapper carries NO intake provenance (it is untrusted)', () => {
  it('never surfaces an intakeIntent from the untrusted wrapper, even if the model injects one', () => {
    // Intake provenance is a trusted API-bound field on LineAiTurnRequest, not the wrapper. A wrapper
    // that claims an intakeIntent still parses (other fields valid) but the field is dropped entirely.
    const plan = parseLineAiPreparedPlan(validPlan({ intakeIntent: 'BUSINESS_READ_QUESTION' })) as Record<string, unknown> | undefined;
    assert.ok(plan, 'the rest of the wrapper still parses');
    assert.equal(plan!['intakeIntent'], undefined, 'the wrapper never carries provenance');
  });
});

describe('semantic intake contract – explicit membership validators (uat-correctness-latency §7)', () => {
  it('LINE_INTAKE_ROUTE_INTENTS carries REIMBURSEMENT_REQUEST_START and the validator accepts it', () => {
    assert.ok((LINE_INTAKE_ROUTE_INTENTS as readonly string[]).includes('REIMBURSEMENT_REQUEST_START'));
    assert.equal(asIntakeRouteIntent('REIMBURSEMENT_REQUEST_START'), 'REIMBURSEMENT_REQUEST_START');
  });

  it('semantic outcome / funding source accept only their own members (no cast, no cross-enum bleed)', () => {
    for (const value of LINE_INTAKE_SEMANTIC_OUTCOMES) assert.equal(asIntakeSemanticOutcome(value), value);
    for (const value of LINE_INTAKE_FUNDING_SOURCES) assert.equal(asIntakeFundingSource(value), value);
    for (const bad of ['business_expense', 'COMPANY_PAID', '', null, undefined, 1, {}, ['AMBIGUOUS']]) {
      assert.equal(asIntakeSemanticOutcome(bad), undefined, `outcome must reject ${JSON.stringify(bad)}`);
    }
    for (const bad of ['company_paid', 'AMBIGUOUS', '', null, undefined, 0, {}, ['UNKNOWN']]) {
      assert.equal(asIntakeFundingSource(bad), undefined, `funding must reject ${JSON.stringify(bad)}`);
    }
  });

  it('clarification fields are enum-filtered, deduplicated and bounded — raw text never survives', () => {
    assert.deepEqual(
      asIntakeClarificationFields(['amount', 'purpose', 'amount', 'เบิกค่าวิน 60 บาท', 7, 'fundingSource']),
      ['amount', 'purpose', 'fundingSource'],
    );
    assert.deepEqual(asIntakeClarificationFields('amount'), []);
    assert.deepEqual(asIntakeClarificationFields(undefined), []);
  });

  it('reimbursementSemantic capability activates on an own literal true only', () => {
    assert.deepEqual(asIntakeRouterCapabilities({ reimbursementSemantic: true }), { reimbursementSemantic: true });
    for (const bad of [1, 'true', {}, [], false, null]) {
      assert.deepEqual(asIntakeRouterCapabilities({ reimbursementSemantic: bad }), {});
    }
    assert.deepEqual(
      asIntakeRouterCapabilities({ fusedPlan: true, reimbursementSemantic: true, substituteSemantic: 'true' }),
      { fusedPlan: true, reimbursementSemantic: true },
    );
  });
});

describe('asIntakeRouteIntent – receiver-boundary provenance validator', () => {
  it('accepts every known intake-route intent by explicit membership', () => {
    for (const intent of LINE_INTAKE_ROUTE_INTENTS) assert.equal(asIntakeRouteIntent(intent), intent);
  });
  it('rejects unknown strings and non-strings (no unsafe cast)', () => {
    for (const bad of ['business_read_question', 'FORGED', '', 42, null, undefined, {}]) {
      assert.equal(asIntakeRouteIntent(bad), undefined);
    }
  });
});

describe('asIntakeRouterCapabilities – receiver-boundary capability validator (only literal true activates)', () => {
  it('accepts ONLY a literal boolean true per known key', () => {
    assert.deepEqual(asIntakeRouterCapabilities({ fusedPlan: true }), { fusedPlan: true });
    assert.deepEqual(asIntakeRouterCapabilities({ substituteSemantic: true }), { substituteSemantic: true });
    assert.deepEqual(asIntakeRouterCapabilities({ fusedPlan: true, substituteSemantic: true }), { fusedPlan: true, substituteSemantic: true });
  });

  it('discards truthy NON-boolean values — no coercion can activate a section', () => {
    for (const truthy of [1, -1, '1', 'true', 'yes', {}, [], [true], { valueOf: () => true }, Infinity]) {
      assert.deepEqual(asIntakeRouterCapabilities({ fusedPlan: truthy, substituteSemantic: truthy }), {},
        `truthy non-boolean ${JSON.stringify(truthy)} must NOT activate`);
    }
  });

  it('discards false / null / undefined / missing (absent stays absent)', () => {
    assert.deepEqual(asIntakeRouterCapabilities({ fusedPlan: false, substituteSemantic: false }), {});
    assert.deepEqual(asIntakeRouterCapabilities({ fusedPlan: null, substituteSemantic: undefined }), {});
    assert.deepEqual(asIntakeRouterCapabilities({}), {});
  });

  it('returns {} for a non-object / array / null / primitive body', () => {
    for (const bad of [null, undefined, 42, 'x', true, [], [ { fusedPlan: true } ]]) {
      assert.deepEqual(asIntakeRouterCapabilities(bad), {});
    }
  });

  it('ignores unknown and nested-extra keys entirely (only the two known keys survive)', () => {
    assert.deepEqual(
      asIntakeRouterCapabilities({ fusedPlan: true, evil: true, __proto__: { substituteSemantic: true }, nested: { substituteSemantic: true } }),
      { fusedPlan: true },
      'unknown/nested keys are never read; only own literal-true known keys survive',
    );
    // A nested object whose ONLY true flags are buried must not activate anything.
    assert.deepEqual(asIntakeRouterCapabilities({ capabilities: { fusedPlan: true } }), {});
  });
});
