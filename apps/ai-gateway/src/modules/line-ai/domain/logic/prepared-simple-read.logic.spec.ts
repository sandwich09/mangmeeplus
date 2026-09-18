import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
import type { LineAiPreparedPlan } from '@watchdog-bms/contracts';
import { preparedSimpleReadEligibility, type PreparedSimpleReadContext } from './prepared-simple-read.logic';

// A valid, already-bounded simple read wrapper: one intent, one call, tool == requiredTool, compiled
// single_metric family. Intake provenance is NOT in the wrapper — it is trusted request-level context.
function validPlan(overrides: Partial<Record<string, unknown>> = {}): LineAiPreparedPlan {
  const plan = parseLineAiPreparedPlan({
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
    intentPlan: {
      status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
      intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }],
    },
    proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } }],
    ...overrides,
  });
  if (!plan) throw new Error('fixture did not parse');
  return plan;
}

const SALES_FAMILY = 'sales.get_sales_summary::single_metric';
const baseCtx: PreparedSimpleReadContext = {
  intakeIntent: 'BUSINESS_READ_QUESTION', // trusted request-level provenance, not the wrapper
  permissions: ['crm.report.read'],
  entitledFeatures: undefined, // legacy fail-open
  hasAttachment: false,
  hasOpenClarification: false,
  enabledFamilies: new Set([SALES_FAMILY]),
};

describe('preparedSimpleReadEligibility – eligible', () => {
  it('accepts a fully valid, allow-listed simple read', () => {
    const result = preparedSimpleReadEligibility(validPlan(), baseCtx);
    assert.equal(result.eligible, true);
    if (result.eligible) {
      assert.equal(result.call.toolName, 'sales.get_sales_summary');
      assert.equal(result.tool.category, 'report');
      assert.equal(result.answerShape, 'single_metric');
    }
  });
});

describe('preparedSimpleReadEligibility – ineligible (falls back to full agentic)', () => {
  const reason = (r: ReturnType<typeof preparedSimpleReadEligibility>) => (r.eligible ? 'ELIGIBLE' : r.reason);

  it('requires the trusted REQUEST-level intake provenance to be BUSINESS_READ_QUESTION (never the wrapper)', () => {
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, intakeIntent: 'CLARIFY' })), 'intake_intent_not_business_read');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, intakeIntent: undefined })), 'intake_intent_not_business_read');
    // A wrapper that forges its own intakeIntent cannot help: it is ignored; only ctx.intakeIntent counts.
    assert.equal(reason(preparedSimpleReadEligibility(validPlan({ intakeIntent: 'BUSINESS_READ_QUESTION' }), { ...baseCtx, intakeIntent: undefined })), 'intake_intent_not_business_read');
  });

  it('rejects a complex plan', () => {
    assert.equal(reason(preparedSimpleReadEligibility(validPlan({ complexity: 'complex', responseMode: 'full_agentic' }), baseCtx)), 'not_simple');
  });

  it('vetoes below the confidence floor (confidence never grants authority)', () => {
    // parse floors simple confidence, so exercise the predicate directly with a lowered value.
    const low = { ...validPlan(), confidence: 0.5 } as LineAiPreparedPlan;
    assert.equal(reason(preparedSimpleReadEligibility(low, baseCtx)), 'confidence_below_floor');
  });

  it('rejects a plan that is not routable / requires review / carries a refusal / has >1 intent', () => {
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: { ...validPlan().intentPlan, status: 'PARTIAL' } }, baseCtx)), 'plan_not_routable');
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: { ...validPlan().intentPlan, requiresHumanReview: true } }, baseCtx)), 'human_review_required');
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: { ...validPlan().intentPlan, refusals: [{ request: 'x', reason: 'mutation_blocked' }] } }, baseCtx)), 'plan_has_refusal');
  });

  it('requires exactly one proposed call and exact tool==requiredTools equality', () => {
    const twoRequired = { ...validPlan().intentPlan, intents: [{ ...validPlan().intentPlan.intents[0], requiredTools: ['sales.get_sales_summary', 'expense.list_recent'] }] };
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: twoRequired }, baseCtx)), 'tool_not_equal_required');
    const mismatch = { ...validPlan(), proposedCalls: [{ toolName: 'expense.list_recent', input: {} }] } as LineAiPreparedPlan;
    assert.equal(reason(preparedSimpleReadEligibility(mismatch, baseCtx)), 'tool_not_equal_required');
  });

  it('rejects missing context, attachment, and open clarification', () => {
    const missing = { ...validPlan().intentPlan, intents: [{ ...validPlan().intentPlan.intents[0], missingContext: ['period'] }] };
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: missing }, baseCtx)), 'missing_context');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, hasAttachment: true })), 'attachment_present');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, hasOpenClarification: true })), 'open_clarification');
  });

  it('rejects a subject-incompatible tool and a non-read (evidence/mutation) tool', () => {
    const wrongSubject = { ...validPlan().intentPlan, intents: [{ ...validPlan().intentPlan.intents[0], subject: 'inventory' }] };
    assert.equal(reason(preparedSimpleReadEligibility({ ...validPlan(), intentPlan: wrongSubject } as LineAiPreparedPlan, baseCtx)), 'subject_incompatible');
    const capture = { ...validPlan(), intentPlan: { ...validPlan().intentPlan, intents: [{ ...validPlan().intentPlan.intents[0], subject: 'expense', requiredTools: ['accounting.capture_receipt_evidence'] }] }, proposedCalls: [{ toolName: 'accounting.capture_receipt_evidence', input: {} }] } as LineAiPreparedPlan;
    assert.equal(reason(preparedSimpleReadEligibility(capture, baseCtx)), 'tool_not_read_family');
  });

  it('re-checks live permission and entitlement', () => {
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, permissions: [] })), 'permission_denied');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, entitledFeatures: new Set(['unrelated_feature']) })), 'feature_disabled');
  });

  it('requires an ACTIVE compiled family key tool::shape (empty set ⇒ never eligible; env can only narrow)', () => {
    assert.equal(reason(preparedSimpleReadEligibility(validPlan(), { ...baseCtx, enabledFamilies: new Set() })), 'formatter_family_not_allowed');
    // A different tool with the same shape is a DIFFERENT family key — the sales key does not enable it.
    const otherTool = { ...validPlan(), intentPlan: { ...validPlan().intentPlan, intents: [{ ...validPlan().intentPlan.intents[0], subject: 'inventory', agent: 'inventory', requiredTools: ['inventory.list_low_stock'] }] }, proposedCalls: [{ toolName: 'inventory.list_low_stock', input: {} }] } as LineAiPreparedPlan;
    assert.equal(reason(preparedSimpleReadEligibility(otherTool, { ...baseCtx, permissions: ['inventory.product.read', 'inventory.report.read'] })), 'formatter_family_not_allowed');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan({ answerShape: undefined }), baseCtx)), 'no_simple_answer_shape');
    assert.equal(reason(preparedSimpleReadEligibility(validPlan({ answerShape: 'summary' }), { ...baseCtx, enabledFamilies: new Set(['sales.get_sales_summary::summary']) })), 'no_simple_answer_shape');
  });
});

// ── Why `text-read-daily-closing` misses the lane although F3 is compiled (wave 2 H2, spec §6.2) ────
// The corpus message is `วันนี้ปิดร้านต้องเช็คอะไรบ้าง ยังค้างจ่ายอะไรไหม` — a closing CHECKLIST plus a
// second question about what is still unpaid. In the 2026-09-17 after-run it cost 6 calls
// (intake-route → plan-route → loop → loop → critic → loop) with a prepared plan PRESENT, i.e. the lane
// fell back BEFORE any call and the full path then covered both halves. These cases replay the
// eligibility chain over the plan shapes the intake prompt can produce for that message and pin the
// reason for each, so the finding is a test rather than an assertion: every one of them is the ROUTER's
// plan (two requests, or no simple answer shape), not a defect in the gate or in the F3 formatter — the
// last case proves the family still serves the moment the intake does emit one simple read.
const DAILY_TOOL = 'expense.get_daily_closing';
const DAILY_FAMILY = `${DAILY_TOOL}::single_metric`;
const dailyCtx: PreparedSimpleReadContext = {
  ...baseCtx,
  permissions: ['expense.read', 'procurement.ap.report'],
  enabledFamilies: new Set([DAILY_FAMILY, 'procurement.get_ap_outstanding::single_metric']),
};
const dailyIntent = (over: Record<string, unknown> = {}) => ({
  intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1,
  requiredTools: [DAILY_TOOL], missingContext: [], ...over,
});
function dailyPlan(over: Partial<Record<string, unknown>> = {}, intents: Array<Record<string, unknown>> = [dailyIntent()]): LineAiPreparedPlan {
  const plan = parseLineAiPreparedPlan({
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
    intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents },
    proposedCalls: [{ toolName: DAILY_TOOL, input: {} }],
    ...over,
  });
  if (!plan) throw new Error('fixture did not parse');
  return plan;
}

describe('preparedSimpleReadEligibility – text-read-daily-closing (the corpus miss)', () => {
  const reason = (r: ReturnType<typeof preparedSimpleReadEligibility>) => (r.eligible ? 'ELIGIBLE' : r.reason);

  it('two requests in one message: the plan is complex / multi-tool, so the lane defers (not the gate\'s doing)', () => {
    // The parser enforces its one-intent/one-call invariants only for a plan that CLAIMS `simple`, so a
    // two-request plan does reach the gate — and is refused there for being what it is.
    const twoRequests = dailyPlan(
      {
        complexity: 'complex', responseMode: 'full_agentic', confidence: 0.7,
        proposedCalls: [{ toolName: DAILY_TOOL, input: {} }, { toolName: 'procurement.get_ap_outstanding', input: {} }],
      },
      [dailyIntent(), { intent: 'read_summary', subject: 'procurement', agent: 'accounting', priority: 2, requiredTools: ['procurement.get_ap_outstanding'], missingContext: [] }],
    );
    assert.equal(reason(preparedSimpleReadEligibility(twoRequests, dailyCtx)), 'not_simple');
    // Same message, same two requests, but the model still called it simple: the plan then has two
    // intents / two calls and the parser refuses the wrapper outright (no plan reaches the gate at all).
    assert.equal(parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [dailyIntent(), dailyIntent()] },
      proposedCalls: [{ toolName: DAILY_TOOL, input: {} }],
    }), undefined);
  });

  it('a checklist has no simple answer shape: an omitted or summary shape defers before any call', () => {
    assert.equal(reason(preparedSimpleReadEligibility(dailyPlan({ answerShape: undefined }), dailyCtx)), 'no_simple_answer_shape');
    assert.equal(reason(preparedSimpleReadEligibility(dailyPlan({ answerShape: 'summary' }), dailyCtx)), 'no_simple_answer_shape');
    assert.equal(reason(preparedSimpleReadEligibility(dailyPlan({ answerShape: 'comparison' }), dailyCtx)), 'no_simple_answer_shape');
  });

  it('a plan that answers only one half with the other half\'s tool never parses, let alone runs', () => {
    // requiredTools says daily closing, the proposed call says AP: the wrapper is refused outright, so a
    // mixed-up two-request plan cannot reach the gate — or answer half the message as if it were all of it.
    assert.equal(parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [dailyIntent()] },
      proposedCalls: [{ toolName: 'procurement.get_ap_outstanding', input: {} }],
    }), undefined);
  });

  it('ONE simple daily-closing read IS eligible — the compiled family works once the intake emits one', () => {
    const result = preparedSimpleReadEligibility(dailyPlan(), dailyCtx);
    assert.equal(result.eligible, true);
    if (result.eligible) {
      assert.equal(result.call.toolName, DAILY_TOOL);
      assert.equal(result.answerShape, 'single_metric');
      assert.equal(result.tool.category, 'read_summary');
    }
    // `anyOfPermissions` is what gates this tool: none of them held ⇒ no lane, whatever the plan says.
    assert.equal(reason(preparedSimpleReadEligibility(dailyPlan(), { ...dailyCtx, permissions: ['procurement.ap.report'] })), 'permission_denied');
    // And the family must be allow-listed by the operator, exactly as for the original four.
    assert.equal(reason(preparedSimpleReadEligibility(dailyPlan(), { ...dailyCtx, enabledFamilies: new Set() })), 'formatter_family_not_allowed');
  });
});

// ── The four wave-2 R5 families are reachable through the same gate (spec §6.2) ─────────────────────
describe('preparedSimpleReadEligibility – wave 2 R5 families', () => {
  const reason = (r: ReturnType<typeof preparedSimpleReadEligibility>) => (r.eligible ? 'ELIGIBLE' : r.reason);
  const cases: Array<{ tool: string; shape: 'single_metric' | 'list'; subject: string; agent: string; permissions: string[] }> = [
    { tool: 'tax.get_vat_summary', shape: 'single_metric', subject: 'tax', agent: 'tax', permissions: ['tax.period.read', 'tax.event.read'] },
    { tool: 'inventory.list_low_stock', shape: 'list', subject: 'inventory', agent: 'inventory', permissions: ['inventory.product.read', 'inventory.report.read'] },
    { tool: 'procurement.get_ap_outstanding', shape: 'single_metric', subject: 'procurement', agent: 'accounting', permissions: ['procurement.ap.report'] },
    { tool: 'crm.get_customer_summary', shape: 'list', subject: 'customer', agent: 'crm', permissions: ['crm.customer.read'] },
  ];

  for (const { tool, shape, subject, agent, permissions } of cases) {
    it(`${tool}::${shape} is eligible with its own permissions, and refused without them`, () => {
      const plan = parseLineAiPreparedPlan({
        version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: shape,
        intentPlan: {
          status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
          intents: [{ intent: 'read_summary', subject, agent, priority: 1, requiredTools: [tool], missingContext: [] }],
        },
        proposedCalls: [{ toolName: tool, input: {} }],
      });
      assert.ok(plan, `${tool} fixture did not parse`);
      const ctx: PreparedSimpleReadContext = { ...baseCtx, permissions, enabledFamilies: new Set([`${tool}::${shape}`]) };
      assert.equal(reason(preparedSimpleReadEligibility(plan, ctx)), 'ELIGIBLE');
      assert.equal(reason(preparedSimpleReadEligibility(plan, { ...ctx, permissions: [] })), 'permission_denied');
      // Compiled ≠ active: an empty operator allowlist still refuses every one of them.
      assert.equal(reason(preparedSimpleReadEligibility(plan, { ...ctx, enabledFamilies: new Set() })), 'formatter_family_not_allowed');
    });
  }
});
