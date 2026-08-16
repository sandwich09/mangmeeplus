import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_TOOL_REGISTRY, type AgentIntentItem, type AgentIntentPlan } from '@watchdog-bms/contracts';
import { IntentRouterAgent } from './intent-router.agent';
import { AccountingSummaryAgent } from './accounting-summary.agent';
import { ResponseComposerAgent } from './response-composer.agent';
import { enforceSourceHonesty } from '../infrastructure/erp-tool.client';
import { CUSTOMER_CLARIFICATION_REGRESSION, LINE_AI_BUSINESS_QUERY_REGRESSION_CORPUS } from './line-ai-business-query-regression.corpus';

function plan(
  tool: string,
  language: string,
  subject: AgentIntentItem['subject'] = 'customer',
  agent: AgentIntentItem['agent'] = 'crm',
): AgentIntentPlan {
  return {
    status: 'ROUTABLE' as const, language,
    intents: [{ intent: 'read_summary' as const, subject, agent, priority: 1, requiredTools: [tool], missingContext: [] }],
    refusals: [], requiresHumanReview: false,
  };
}

describe('LINE AI mandatory business-query regression corpus', () => {
  for (const testCase of LINE_AI_BUSINESS_QUERY_REGRESSION_CORPUS) {
    it(`${testCase.id}: routes and invokes the expected business source`, async () => {
      const router = new IntentRouterAgent({ generateText: async () => ({ ok: true as const, text: JSON.stringify(plan(testCase.tool, testCase.language, testCase.subject, testCase.agent)) }) });
      const routed = await router.route(testCase.message);
      assert.equal(routed.intents[0]?.subject, testCase.subject);
      assert.ok(!routed.intents[0]?.requiredTools.includes(testCase.forbiddenTool));
      assert.deepEqual(routed.intents[0]?.requiredTools, [testCase.tool]);

      const invoked: string[] = [];
      const specialist = new AccountingSummaryAgent({ invoke: async (tool: { name: string; sourceModule: string }) => {
        invoked.push(tool.name);
        return {
          toolName: tool.name, status: 'ok' as const, data: testCase.data,
          sourceRefs: [{ ...testCase.sourceRef, module: tool.sourceModule, permissionChecked: true as const }],
          asOf: '2026-07-15T00:00:00Z',
        };
      } } as any);
      const output = await specialist.run(
        { companyId: 'c1', userId: 'u1', permissions: [...testCase.permissions], locale: testCase.language === 'th' ? 'th-TH' : 'en-US' },
        routed.intents[0]!, 1,
      );
      assert.ok(!invoked.includes(testCase.forbiddenTool));
      assert.deepEqual(invoked, [testCase.tool]);

      const composed = new ResponseComposerAgent().compose(routed, [output], testCase.message, testCase.language === 'th' ? 'th-TH' : 'en-US');
      assert.match(composed.replyText, new RegExp(testCase.expectedData));
      if ('expectedReply' in testCase) {
        for (const expected of testCase.expectedReply) assert.ok(composed.replyText.includes(expected), expected);
      }
      assert.equal(composed.webLinks[0]?.path, testCase.sourceRef.webPath);
      assert.ok(!composed.replyText.includes('/companies/'), 'data answer is primary; link remains secondary metadata');
    });
  }

  it("customer clarification then 'ทั้งหมด' retains the customer subject", async () => {
    let payload: any;
    const router = new IntentRouterAgent({ generateText: async (input) => {
      payload = JSON.parse(input.messages[0]?.text ?? '{}');
      return { ok: true as const, text: JSON.stringify(plan('crm.get_customer_summary', 'th')) };
    } });
    const open = [{
      id: 'clarify-1', text: CUSTOMER_CLARIFICATION_REGRESSION.originalText,
      question: CUSTOMER_CLARIFICATION_REGRESSION.question, subject: CUSTOMER_CLARIFICATION_REGRESSION.subject,
      askedAt: '2026-07-15T00:00:00Z',
    }];
    const routed = await router.route(CUSTOMER_CLARIFICATION_REGRESSION.answer, false, undefined, open);
    assert.equal(payload.openClarifications[0].subject, 'customer');
    assert.equal(routed.intents[0]?.subject, 'customer');
    assert.deepEqual(routed.intents[0]?.requiredTools, ['crm.get_customer_summary']);
  });

  it('forbidden, no-source, and source-mismatch results never become grounded facts', async () => {
    const meta = LINE_TOOL_REGISTRY.find((tool) => tool.name === 'crm.get_customer_summary')!;
    for (const result of [
      enforceSourceHonesty(meta, { toolName: meta.name, status: 'forbidden', data: { total: 999 }, sourceRefs: [], asOf: '2026-07-15T00:00:00Z' }),
      enforceSourceHonesty(meta, { toolName: meta.name, status: 'ok', data: { total: 999 }, sourceRefs: [], asOf: '2026-07-15T00:00:00Z' }),
      enforceSourceHonesty(meta, { toolName: meta.name, status: 'ok', data: { total: 999 }, sourceRefs: [{ label: 'พนักงาน', module: 'employee-access', entityType: 'employee_summary', permissionChecked: true }], asOf: '2026-07-15T00:00:00Z' }),
    ]) {
      if (result.status === 'error') assert.equal(result.data, undefined);
      const specialist = new AccountingSummaryAgent({ invoke: async () => result } as any);
      const output = await specialist.run(
        { companyId: 'c1', userId: 'u1', permissions: ['crm.customer.read'], locale: 'th-TH' },
        plan(meta.name, 'th').intents[0], 1,
      );
      assert.equal(output.facts.length, 0);
      assert.ok(['PERMISSION_DENIED', 'UNSUPPORTED', 'FAILED'].includes(output.status));
      const reply = new ResponseComposerAgent().compose(plan(meta.name, 'th'), [output], 'ลูกค้ามีกี่คน', 'th-TH');
      assert.ok(!reply.replyText.includes('999'));
      assert.equal(reply.sourceRefs.length, 0);
    }
  });
});
