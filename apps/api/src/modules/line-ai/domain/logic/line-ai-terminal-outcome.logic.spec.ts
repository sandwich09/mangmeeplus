import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_AI_TERMINAL_CLASSES,
  classifyLineAiTerminalOutcome,
  classifyLineAiGatewayFailure,
  emitLineAiTerminalOutcome,
  terminalStatusForLineTurn,
} from './line-ai-terminal-outcome.logic';

describe('LINE AI terminal outcome logic', () => {
  it('covers the complete bounded metric vocabulary', () => {
    assert.deepEqual(LINE_AI_TERMINAL_CLASSES, [
      'delivered', 'clarification', 'intentional_noop', 'permission_refusal',
      'feature_disabled', 'provider_unavailable', 'timeout', 'delivery_pending', 'failed_terminal',
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
    assert.equal(classifyLineAiTerminalOutcome('safety_crisis'), 'intentional_noop');
    assert.equal(classifyLineAiTerminalOutcome('forbidden'), 'permission_refusal');
    assert.equal(classifyLineAiTerminalOutcome('feature_disabled'), 'feature_disabled');
    // The P3 kill switch: a distinct status, but NOT a `failed_terminal` — closing the route on
    // purpose must not read as an AI outage on the alarm that watches that class.
    assert.equal(classifyLineAiTerminalOutcome('launch_route_closed'), 'feature_disabled');
    assert.equal(classifyLineAiTerminalOutcome('unavailable_delivered'), 'provider_unavailable');
    assert.equal(classifyLineAiTerminalOutcome('ai_error', 'LINE_AI_AI_TIMEOUT'), 'timeout');
    assert.equal(classifyLineAiTerminalOutcome('delivery_pending'), 'delivery_pending');
    assert.equal(classifyLineAiTerminalOutcome('new_unclassified_terminal'), 'failed_terminal');
  });

  it('preserves refusal detail in status while sharing bounded metric classes', () => {
    assert.equal(terminalStatusForLineTurn({ refused: false }), 'completed');
    assert.equal(terminalStatusForLineTurn({ refused: true }), 'refused_untyped');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'tool_unavailable' }), 'unavailable_delivered');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'feature_disabled' }), 'feature_disabled');
    assert.equal(terminalStatusForLineTurn({ refused: true, refusalReason: 'unsupported_module' }), 'unsupported_module');
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
    assert.deepEqual(classifyLineAiGatewayFailure({
      getStatus: () => 429,
      getResponse: () => ({ code: 'AI_BUDGET_UNAVAILABLE' }),
    }), {
      status: 'provider_unavailable', errorCode: 'LINE_AI_PROVIDER_UNAVAILABLE', replyKind: 'unavailable',
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
});
