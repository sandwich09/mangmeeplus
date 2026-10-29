import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_AI_TERMINAL_CLASSES,
  classifyLineAiTerminalOutcome,
  classifyLineAiGatewayFailure,
  emitLineAiTerminalOutcome,
  knownAiBudgetRefusal,
  terminalStatusForLineTurn,
} from './line-ai-terminal-outcome.logic';

describe('LINE AI terminal outcome logic', () => {
  it('covers the complete bounded metric vocabulary', () => {
    assert.deepEqual(LINE_AI_TERMINAL_CLASSES, [
      'delivered', 'clarification', 'intentional_noop', 'permission_refusal',
      'feature_disabled', 'provider_unavailable', 'timeout', 'budget_refusal', 'delivery_pending', 'failed_terminal',
    ]);
  });

  it('keeps in-flight states nonterminal and classifies every known terminal family', () => {
    assert.equal(classifyLineAiTerminalOutcome('received'), null);
    assert.equal(classifyLineAiTerminalOutcome('response_ready'), null);
    assert.equal(classifyLineAiTerminalOutcome('completed'), 'delivered');
    assert.equal(classifyLineAiTerminalOutcome('clarification_required'), 'clarification');
    assert.equal(classifyLineAiTerminalOutcome('rate_limited'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('batched'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('duplicate_media_pending'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('expense_action_duplicate'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('safety_crisis'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('forbidden'), 'permission_refusal');
    // P29: an expired plan answered with the renewal invitation is a refusal, not an outage.
    assert.equal(classifyLineAiTerminalOutcome('plan_term_expired'), 'permission_refusal');
    assert.equal(classifyLineAiTerminalOutcome('feature_disabled'), 'feature_disabled');
    // The P3 kill switch: a distinct status, but NOT a `failed_terminal` — closing the route on
    // purpose must not read as an AI outage on the alarm that watches that class.
    assert.equal(classifyLineAiTerminalOutcome('launch_route_closed'), 'feature_disabled');
    assert.equal(classifyLineAiTerminalOutcome('unavailable_delivered'), 'provider_unavailable');
    assert.equal(classifyLineAiTerminalOutcome('ai_error', 'LINE_AI_AI_TIMEOUT'), 'timeout');
    assert.equal(classifyLineAiTerminalOutcome('delivery_pending'), 'delivery_pending');
    assert.equal(classifyLineAiTerminalOutcome('new_unclassified_terminal'), 'failed_terminal');
  });

  // ── Remediation spec §9.3 (B-06) ──────────────────────────────────────────
  it('gives a delivered money refusal its own class, behind delivery truth', () => {
    // A refusal that was answered correctly is not an AI outage…
    assert.equal(classifyLineAiTerminalOutcome('ai_budget_exceeded'), 'budget_refusal');
    assert.equal(classifyLineAiTerminalOutcome('ai_budget_insufficient'), 'budget_refusal');
    // …and neither is an intentional support pause.
    assert.equal(classifyLineAiTerminalOutcome('support_follow_up'), 'intentional_noop');

    // …but delivery truth still outranks the semantics: a refusal nobody received, or a turn that
    // failed outright, must keep looking broken even while carrying the money code.
    assert.equal(classifyLineAiTerminalOutcome('delivery_pending', 'AI_MONTHLY_BUDGET_EXCEEDED'), 'delivery_pending');
    assert.equal(classifyLineAiTerminalOutcome('failed_terminal', 'AI_MONTHLY_BUDGET_EXCEEDED'), 'failed_terminal');
    assert.equal(classifyLineAiTerminalOutcome('orphan_no_outcome', 'AI_MONTHLY_BUDGET_EXCEEDED'), 'failed_terminal');

    // The image lane KEPT the picture and asked the numbered question, so the workflow class stays
    // `clarification` and the money reason rides on the errorCode (spec §9.3).
    assert.equal(classifyLineAiTerminalOutcome('clarification_required', 'AI_MONTHLY_BUDGET_EXCEEDED'), 'clarification');
    assert.equal(classifyLineAiTerminalOutcome('duplicate_media_pending', 'AI_BUDGET_INSUFFICIENT'), 'intentional_noop');

    // A delivered refusal on an otherwise unknown status is rescued from the outage bucket by its
    // durable money code — but only for the PERMANENT codes.
    assert.equal(classifyLineAiTerminalOutcome('some_new_refusal', 'AI_MONTHLY_BUDGET_EXCEEDED'), 'budget_refusal');
    assert.equal(classifyLineAiTerminalOutcome('some_new_refusal', 'AI_BUDGET_INSUFFICIENT'), 'budget_refusal');
    assert.equal(classifyLineAiTerminalOutcome('some_new_refusal', 'AI_BUDGET_BUSY'), 'failed_terminal');
    assert.equal(classifyLineAiTerminalOutcome('some_new_refusal', 'AI_BUDGET_UNAVAILABLE'), 'failed_terminal');
    // No catch-all: an unknown status with no money reason is still visible as a failure.
    assert.equal(classifyLineAiTerminalOutcome('some_new_refusal'), 'failed_terminal');
  });

  it('trusts only our own 429 body as a budget refusal', () => {
    const our = (code: string, budgetScope?: string) => ({ getStatus: () => 429, getResponse: () => ({ code, ...(budgetScope ? { budgetScope } : {}) }) });
    assert.deepEqual(knownAiBudgetRefusal(our('AI_MONTHLY_BUDGET_EXCEEDED', 'TOTAL')), { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' });
    assert.deepEqual(knownAiBudgetRefusal(our('AI_BUDGET_INSUFFICIENT')), { code: 'AI_BUDGET_INSUFFICIENT' });
    assert.deepEqual(knownAiBudgetRefusal(our('AI_BUDGET_BUSY')), { code: 'AI_BUDGET_BUSY' });
    // A scope we do not recognise is dropped rather than carried forward as data.
    assert.deepEqual(knownAiBudgetRefusal(our('AI_BUDGET_UNAVAILABLE', 'SOMETHING')), { code: 'AI_BUDGET_UNAVAILABLE' });
    // Lookalikes: a provider 429, a non-429 carrying the code, and a bare message all stay unknown.
    assert.equal(knownAiBudgetRefusal(our('AI_LLM_RATE_LIMITED')), null);
    assert.equal(knownAiBudgetRefusal({ getStatus: () => 503, getResponse: () => ({ code: 'AI_MONTHLY_BUDGET_EXCEEDED' }) }), null);
    assert.equal(knownAiBudgetRefusal(new Error('AI_MONTHLY_BUDGET_EXCEEDED')), null);
    assert.equal(knownAiBudgetRefusal({ code: 'AI_MONTHLY_BUDGET_EXCEEDED' }), null);
  });

  it('stores the real money code in the durable result, never RATE_LIMITED', () => {
    const exceeded = classifyLineAiGatewayFailure({ getStatus: () => 429, getResponse: () => ({ code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' }) });
    assert.deepEqual(exceeded, {
      status: 'ai_budget_exceeded', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED',
      replyKind: 'budget_exceeded', budgetCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL',
    });
    assert.equal(classifyLineAiTerminalOutcome(exceeded.status, exceeded.errorCode), 'budget_refusal');

    const insufficient = classifyLineAiGatewayFailure({ getStatus: () => 429, getResponse: () => ({ code: 'AI_BUDGET_INSUFFICIENT' }) });
    assert.equal(insufficient.status, 'ai_budget_insufficient');
    assert.equal(insufficient.errorCode, 'AI_BUDGET_INSUFFICIENT');

    // Contention is NOT exhaustion and keeps the congestion lane it has always had.
    const busy = classifyLineAiGatewayFailure({ getStatus: () => 429, getResponse: () => ({ code: 'AI_BUDGET_BUSY' }) });
    assert.deepEqual(busy, { status: 'rate_limited', errorCode: 'LINE_AI_RATE_LIMITED', replyKind: 'rate_limited' });
  });

  it('preserves refusal detail in status while sharing bounded metric classes', () => {
    assert.equal(terminalStatusForLineTurn({ refused: false }), 'completed');
    assert.equal(terminalStatusForLineTurn({ refused: true }), 'refused_untyped');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'tool_unavailable' }), 'unavailable_delivered');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'feature_disabled' }), 'feature_disabled');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'unsupported_module' }), 'unsupported_module');
    // Spec §5.3: its own status, so the durable row can tell "we do not cover that" from "not on
    // LINE yet" — and so it never falls to `refused_untyped`, which reads as an AI outage below.
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'unsupported_yet' }), 'unsupported_yet');
    assert.equal(classifyLineAiTerminalOutcome('unsupported_yet'), 'feature_disabled');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'mutation_blocked' }), 'forbidden');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'ambiguous_company' }), 'needs_company_selection');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'safety_crisis' }), 'safety_crisis');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'privacy_rumor' }), 'privacy_rumor');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'line_delivery_failure' }), 'line_delivery_failure');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'tool_unavailable', errorCode: 'TIMEOUT' }), 'ai_timeout');
  });

  it('separates timeout, admission no-op, and provider unavailability', () => {
    assert.deepEqual(classifyLineAiGatewayFailure({ code: 'AI_GATEWAY_TIMEOUT' }), {
      status: 'ai_error', errorCode: 'LINE_AI_AI_TIMEOUT', replyKind: 'timeout',
    });
    assert.deepEqual(classifyLineAiGatewayFailure({ getStatus: () => 429 }), {
      status: 'rate_limited', errorCode: 'LINE_AI_RATE_LIMITED', replyKind: 'rate_limited',
    });
    // Spec §9.1: an unreadable meter keeps the provider_unavailable STATUS but stores its own code
    // (the durable row used to say "provider unavailable" for a budget the API never managed to read).
    assert.deepEqual(classifyLineAiGatewayFailure({
      getStatus: () => 429,
      getResponse: () => ({ code: 'AI_BUDGET_UNAVAILABLE' }),
    }), {
      status: 'provider_unavailable', errorCode: 'AI_BUDGET_UNAVAILABLE', replyKind: 'budget_unavailable',
      budgetCode: 'AI_BUDGET_UNAVAILABLE',
    });
    assert.deepEqual(classifyLineAiGatewayFailure(new Error('connection refused')), {
      status: 'provider_unavailable', errorCode: 'LINE_AI_PROVIDER_UNAVAILABLE', replyKind: 'unavailable',
    });
  });

  it('emits one bounded record without message content or raw LINE identity', () => {
    const rows: Record<string, unknown>[] = [];
    emitLineAiTerminalOutcome({ log: (row) => rows.push(row) }, {
      webhookEventId: 'evt-1', companyId: 'company-1', status: 'completed', errorCode: null,
    });
    assert.deepEqual(rows, [{
      msg: 'line.ai.terminal', surface: 'employee_oa', webhookEventId: 'evt-1',
      companyId: 'company-1', status: 'completed', terminalClass: 'delivered', errorCode: null,
    }]);
    assert.equal(JSON.stringify(rows).includes('messageText'), false);
    assert.equal(JSON.stringify(rows).includes('lineUserId'), false);
  });

  it('carries budget scope and media state only when the turn really had them (§9.3)', () => {
    const rows: Record<string, unknown>[] = [];
    emitLineAiTerminalOutcome({ log: (row) => rows.push(row) }, {
      webhookEventId: 'evt-2', companyId: 'company-1', status: 'clarification_required',
      errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL', mediaState: 'retained',
    });
    assert.deepEqual(rows, [{
      msg: 'line.ai.terminal', surface: 'employee_oa', webhookEventId: 'evt-2',
      companyId: 'company-1', status: 'clarification_required', terminalClass: 'clarification',
      errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL', mediaState: 'retained',
    }]);
    // No money amount ever reaches this record.
    assert.equal(/satang|budgetSatang|spend/i.test(JSON.stringify(rows)), false);
  });
});
