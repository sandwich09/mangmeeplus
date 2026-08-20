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
