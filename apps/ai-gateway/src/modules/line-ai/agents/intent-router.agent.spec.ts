import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntentRouterAgent, isCrisisMessage, isSubjectCompatible, ROUTER_ENABLED_TOOLS } from './intent-router.agent';
import { DisabledProvider } from '../infrastructure/provider/disabled.provider';
import type { ProviderInput } from '../infrastructure/provider/provider.port';
import { CACHE_MIN_CHARS } from '../infrastructure/provider/bedrock.provider';

function makeRouter() {
  return new IntentRouterAgent(new DisabledProvider());
}

describe('IntentRouterAgent – model routing', () => {
  it('short-circuits direct and mixed self-harm signals before the model or ERP routing', async () => {
    let providerCalls = 0;
    const router = new IntentRouterAgent({ generateText: async () => {
      providerCalls += 1;
      throw new Error('crisis routing must not call the model');
    } });
    for (const message of [
      'ฉันไม่อยากอยู่แล้ว ทุกอย่างมันหนักไปหมด',
      'ฉันไม่อยากอยู่แล้ว แต่ก่อนอื่นช่วยบอกค่าใช้จ่ายเดือนนี้ที',
      'I want to die, but show me this month expenses first',
    ]) {
      const plan = await router.route(message);
      assert.equal(plan.status, 'UNROUTABLE');
      assert.equal(plan.refusals[0]?.reason, 'safety_crisis');
      assert.deepEqual(plan.intents, []);
    }
    assert.equal(providerCalls, 0);
    assert.equal(isCrisisMessage('งานเยอะจนไม่ไหวแล้ว ช่วยดูค่าใช้จ่ายที'), false, 'ordinary frustration is not a crisis override');
    assert.equal(isCrisisMessage('กำลังเขียนนโยบายป้องกันการฆ่าตัวตายในที่ทำงาน'), false, 'prevention discussion is not a personal crisis signal');
    assert.equal(isCrisisMessage('employee suicide prevention policy'), false, 'English prevention discussion is not a personal crisis signal');
  });

  it('normalizes model-written private-rumour refusals to a stable reason code', async () => {
    const router = new IntentRouterAgent({ generateText: async () => ({
      ok: true,
      text: JSON.stringify({
        status: 'PARTIAL', language: 'th',
        intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.get_breakdown'], missingContext: [] }],
        refusals: [{ request: 'เม้าท์ว่าพี่เอแอบคบใคร', reason: 'เป็นข่าวลือเกี่ยวกับชีวิตส่วนตัวและความสัมพันธ์ของพนักงาน' }],
        requiresHumanReview: false,
      }),
    }) });
    const plan = await router.route('เม้าท์ว่าพี่เอแอบคบใคร แล้วดูค่าใช้จ่ายเดือนนี้');
    assert.equal(plan.status, 'PARTIAL');
    assert.equal(plan.refusals[0]?.reason, 'privacy_rumor');
  });

  it('enables Phase 4 CRM tools only for their canonical business subjects', () => {
    const compatible: Array<[string, string]> = [
      ['crm_report', 'crm.get_report_summary'],
      ['opportunity', 'crm.get_pipeline_summary'],
      ['follow_up', 'crm.list_open_followups'],
      ['customer', 'crm.list_open_followups'],
      ['booking', 'crm.get_booking_summary'],
      ['booking', 'crm.list_bookings'],
      ['conversation', 'crm.get_inbox_summary'],
      ['conversation', 'crm.list_conversations'],
      ['conversation', 'crm.get_conversation_summary'],
    ];
    for (const [subject, tool] of compatible) {
      assert.equal(ROUTER_ENABLED_TOOLS.has(tool), true, `${tool} must be enabled`);
      assert.equal(isSubjectCompatible(subject as any, tool), true, `${tool} must support ${subject}`);
      assert.equal(isSubjectCompatible('employee', tool), false, `${tool} must never substitute employee`);
    }
  });

  it('routes booking and conversation requests to CRM tools without employee substitution', async () => {
    for (const [subject, tool, text] of [
      ['booking', 'crm.get_booking_summary', 'สัปดาห์นี้มีนัดกี่รายการ'],
      ['conversation', 'crm.get_inbox_summary', 'มีแชทลูกค้าค้างตอบกี่รายการ'],
    ] as const) {
      const router = new IntentRouterAgent({
        generateText: async () => ({
          ok: true as const,
          text: JSON.stringify({
            status: 'ROUTABLE', language: 'th',
            intents: [{ intent: 'read_summary', subject, agent: 'crm', priority: 1, requiredTools: [tool], missingContext: [] }],
            refusals: [], requiresHumanReview: false,
          }),
        }),
      });
      const plan = await router.route(text);
      assert.deepEqual(plan.intents[0]?.requiredTools, [tool]);
      assert.equal((plan.intents[0]?.requiredTools as string[]).includes('company.get_employee_summary'), false);
    }
  });
  it('rejects wrong-subject tools after one bounded correction attempt', async () => {
    for (const [subject, tool, agent] of [
      ['customer', 'company.get_employee_summary', 'general'],
      ['employee', 'crm.suggest_sales_followups', 'crm'],
      ['sale', 'ledger.get_financial_summary', 'accounting'],
      ['booking', 'company.get_employee_summary', 'general'],
    ] as const) {
      let calls = 0;
      const router = new IntentRouterAgent({
        generateText: async () => {
          calls += 1;
          return {
            ok: true as const,
            text: JSON.stringify({
              status: 'ROUTABLE', language: 'th',
              intents: [{ intent: 'read_summary', subject, agent, priority: 1, requiredTools: [tool], missingContext: [] }],
              refusals: [], requiresHumanReview: false,
            }),
          };
        },
      });

      const plan = await router.route('ขอดูข้อมูล', false);
      assert.equal(plan.status, 'UNROUTABLE');
      assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
      assert.equal(calls, 2);
    }
  });

  it('routes a customer request only to the wired customer subject tool', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true as const,
        text: JSON.stringify({
          status: 'ROUTABLE', language: 'th',
          intents: [{ intent: 'read_summary', subject: 'customer', agent: 'crm', priority: 1, requiredTools: ['crm.get_customer_summary'], missingContext: [] }],
          refusals: [], requiresHumanReview: false,
        }),
      }),
    });
    const plan = await router.route('ลูกค้าทั้งหมดมีกี่คน');
    assert.equal(plan.status, 'ROUTABLE');
    assert.equal(plan.intents[0]?.subject, 'customer');
    assert.deepEqual(plan.intents[0]?.requiredTools, ['crm.get_customer_summary']);
  });

  it('accepts each wired tranche-A tool only for its canonical subject', async () => {
    for (const [tool, subject, agent] of [
      ['inventory.get_product_detail', 'product', 'inventory'],
      ['accounting.get_document_detail', 'accounting_document', 'accounting'],
      ['accounting.get_receivable_summary', 'payment', 'accounting'],
      ['expense.get_detail', 'expense', 'accounting'],
      ['reimbursement.get_summary', 'reimbursement', 'accounting'],
      ['reimbursement.get_detail', 'reimbursement', 'accounting'],
    ] as const) {
      const router = new IntentRouterAgent({
        generateText: async () => ({ ok: true as const, text: JSON.stringify({
          status: 'ROUTABLE', language: 'th',
          intents: [{ intent: 'read_detail', subject, agent, priority: 1, requiredTools: [tool], missingContext: [] }],
          refusals: [], requiresHumanReview: false,
        }) }),
      });
      const plan = await router.route('ดูข้อมูล');
      assert.equal(plan.status, 'ROUTABLE', tool);
      assert.equal(plan.intents[0]?.subject, subject);
    }
  });

  it('accepts Phase 5 procurement and ledger tools only for their canonical subjects', async () => {
    for (const [tool, subject, agent] of [
      ['procurement.get_summary', 'procurement', 'accounting'],
      ['procurement.search_suppliers', 'supplier', 'accounting'],
      ['procurement.get_purchase_order_detail', 'procurement', 'general'],
      ['ledger.get_period_status', 'ledger', 'accounting'],
      ['ledger.get_report_summary', 'ledger', 'cfo'],
    ] as const) {
      assert.equal(ROUTER_ENABLED_TOOLS.has(tool), true, tool);
      assert.equal(isSubjectCompatible(subject, tool), true, tool);
      assert.equal(isSubjectCompatible('customer', tool), false, `${tool} must not substitute customer`);
      const router = new IntentRouterAgent({ generateText: async () => ({ ok: true as const, text: JSON.stringify({
        status: 'ROUTABLE', language: 'th',
        intents: [{ intent: 'read_summary', subject, agent, priority: 1, requiredTools: [tool], missingContext: [] }],
        refusals: [], requiresHumanReview: false,
      }) }) });
      assert.deepEqual((await router.route('ดูข้อมูล')).intents[0]?.requiredTools, [tool]);
    }
  });

  it('fails closed when provider is disabled', async () => {
    const plan = await makeRouter().route('ดูสต็อกสินค้า', false);
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
    assert.equal(plan.intents.length, 0);
  });

  it('disabled provider preserves Thai language for unavailable reply', async () => {
    const plan = await makeRouter().route('สวัสดี', false);
    assert.equal(plan.language, 'th');
  });

  it('uses provider JSON plan when available', async () => {
	    let systemPrompt = '';
	    let catalog: any = {};
    const router = new IntentRouterAgent({
      generateText: async (input) => {
        systemPrompt = input.systemPrompt ?? '';
        // The catalog reaches the model as the turn's leading cacheable block, not inside the payload.
        catalog = JSON.parse(input.cacheableContext ?? '{}');
        return {
          ok: true,
          text: JSON.stringify({
            status: 'ROUTABLE',
            language: 'en',
            intents: [{ intent: 'read_summary', subject: 'ledger', agent: 'accounting', priority: 1, requiredTools: ['ledger.get_financial_summary'], missingContext: [] }],
            refusals: [],
            requiresHumanReview: false,
          }),
        };
      },
    });

    const plan = await router.route('show accounting summary', false);
    assert.ok(systemPrompt.includes('Intent Router Agent'));
    assert.ok(systemPrompt.includes('capability_help'));
    assert.ok(systemPrompt.includes('business intent wins'));
    assert.ok(catalog.enabledFeatures.some((feature: any) => feature.toolName === 'ledger.get_financial_summary'));
    assert.ok(catalog.enabledFeatures.some((feature: any) => feature.toolName === 'sales.get_sales_summary'));
	    assert.ok(catalog.enabledFeatures.some((feature: any) => feature.toolName === 'crm.get_pipeline_summary'));
	    assert.ok(catalog.enabledFeatures.some((feature: any) => feature.toolName === 'crm.get_inbox_summary'));
	    const taxCodeFeature = catalog.enabledFeatures.find((feature: any) => feature.toolName === 'tax.get_tax_code_profile');
	    assert.ok(taxCodeFeature?.description.includes('legacy ERP'));
	    assert.equal(plan.language, 'en');
	    assert.equal(plan.intents[0]?.agent, 'accounting');
	  });

  it('accepts pure casual and capability-help plans without tools', async () => {
    for (const [messageText, intent] of [
      ['สวัสดี วันนี้เหนื่อยนิดหน่อย', 'casual_conversation'],
      ['หวยแตกมาก', 'casual_conversation'],
      ['ต่อยกันไหม', 'casual_conversation'],
      ['น้องมั่งมีทำอะไรได้บ้าง', 'capability_help'],
    ] as const) {
      const router = new IntentRouterAgent({
        generateText: async () => ({
          ok: true,
          text: JSON.stringify({
            status: 'ROUTABLE', language: 'th',
            intents: [{ intent, subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }],
            refusals: [], requiresHumanReview: false,
          }),
        }),
      });
      const plan = await router.route(messageText);
      assert.equal(plan.status, 'ROUTABLE');
      assert.equal(plan.intents[0]?.intent, intent);
      assert.deepEqual(plan.intents[0]?.requiredTools, []);
    }
  });

  it('rejects a zero-tool intent mixed with a business request', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE', language: 'th',
          intents: [
            { intent: 'casual_conversation', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] },
            { intent: 'report_request', subject: 'sale', agent: 'sales', priority: 2, requiredTools: ['sales.get_sales_summary'], missingContext: [] },
          ],
          refusals: [], requiresHumanReview: false,
        }),
      }),
    });
    const plan = await router.route('วันนี้เหนื่อยจัง ยอดขายตกไหม');
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
  });

	  it('passes bounded conversation context to model routing payloads', async () => {
	    const context = {
	      windowMinutes: 15,
	      maxTurns: 15,
	      lastTurnAt: '2026-07-05T10:00:00.000Z',
	      recentTurns: [{ at: '2026-07-05T10:00:00.000Z', userMessagePreview: 'ดูสินค้าใกล้หมด', assistantReplyPreview: 'มี 2 รายการ', intent: 'READ_DETAIL', agent: 'inventory', refused: false }],
	    };
	    const payloads: any[] = [];
	    const router = new IntentRouterAgent({
	      generateText: async (input) => {
	        payloads.push(JSON.parse(input.messages[0]?.text ?? '{}'));
	        return {
	          ok: true,
	          text: JSON.stringify({
	            status: 'ROUTABLE',
	            language: 'th',
	            intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }],
	            refusals: [],
	            requiresHumanReview: false,
	          }),
	        };
	      },
	    });

	    await router.route('อันที่สองล่ะ', false, context);
	    await router.routeIntake({
	      requestId: 'r1',
	      companyId: 'c1',
	      userId: 'u1',
	      locale: 'th-TH',
	      messageText: 'อันนี้',
	      permissions: ['line.ai.query'],
	      conversationContext: context,
	    });

	    assert.deepEqual(payloads[0]?.conversationContext, context);
	    assert.deepEqual(payloads[1]?.conversationContext, context);
	  });

  it('blocks provider plan that selects a disabled feature tool', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [{ intent: 'sales_suggestion', subject: 'follow_up', agent: 'crm', priority: 1, requiredTools: ['crm.suggest_sales_followups'], missingContext: [] }],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('แนะนำลูกค้าที่ควรติดตาม', false);
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'feature_disabled');
  });

  it('routes item-11B read contracts after backend wiring', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [{ intent: 'read_detail', subject: 'tax', agent: 'tax', priority: 1, requiredTools: ['tax.get_tax_code_profile'], missingContext: ['sourceProfileKey'] }],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('O1 ของบริษัทนี้หมายถึงอะไร', false);
    assert.equal(plan.status, 'ROUTABLE');
    assert.equal(plan.intents[0]?.agent, 'tax');
  });

  it('allows the Tax Agent to route existing read-only VAT tools', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [{ intent: 'read_summary', subject: 'tax', agent: 'tax', priority: 1, requiredTools: ['tax.get_vat_summary'], missingContext: [] }],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('สรุป VAT งวดนี้', false);
    assert.equal(plan.status, 'ROUTABLE');
    assert.equal(plan.intents[0]?.agent, 'tax');
  });

  it('keeps enabled intents when another part of the request uses a disabled tool', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [
            { intent: 'report_request', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] },
            { intent: 'sales_suggestion', subject: 'follow_up', agent: 'crm', priority: 2, requiredTools: ['crm.suggest_sales_followups'], missingContext: [] },
          ],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('ยอดขายวันนี้และควรตามลูกค้าคนไหน', false);
    assert.equal(plan.status, 'PARTIAL');
    assert.deepEqual(plan.intents.map((intent) => intent.requiredTools), [['sales.get_sales_summary']]);
    assert.equal(plan.refusals[0]?.reason, 'feature_disabled');
  });

  it('fails closed when provider returns invalid JSON', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({ ok: true, text: 'not json' }),
    });

    const plan = await router.route('ดูสต็อกสินค้า', false);
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
  });

  it('fails closed when routable provider plan omits requiredTools', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [{ intent: 'read_summary', subject: 'ledger', agent: 'accounting', priority: 1, requiredTools: [], missingContext: [] }],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('ดูรายได้', false);
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
  });

  it('fails closed when model plan uses tool not in enabled or disabled registry (schema mismatch / unknown tool)', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          status: 'ROUTABLE',
          language: 'th',
          intents: [{ intent: 'read_summary', agent: 'accounting', priority: 1, requiredTools: ['totally.unknown_tool'], missingContext: [] }],
          refusals: [],
          requiresHumanReview: false,
        }),
      }),
    });

    const plan = await router.route('ดูข้อมูล', false);
    assert.equal(plan.status, 'UNROUTABLE');
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
    assert.equal(plan.intents.length, 0);
  });
});

// Owner boundary (2026-07-05): LINE AI is read-first. Router-enabled tools must be read/report
// only; drafts and evidence stay in the intake flow, and approval/final mutation categories are
// never model-reachable.
describe('IntentRouterAgent – read-only tool boundary', () => {
  it('every router-enabled tool is a read/report/suggestion category tool', async () => {
    const { ROUTER_ENABLED_TOOLS } = await import('./intent-router.agent');
    const { LINE_TOOL_REGISTRY } = await import('@watchdog-bms/contracts');
    const readOnly = new Set(['read_summary', 'read_detail', 'report', 'suggestion']);
    for (const name of ROUTER_ENABLED_TOOLS) {
      const meta = LINE_TOOL_REGISTRY.find((t) => t.name === name);
      assert.ok(meta, `enabled tool ${name} must exist in registry`);
      assert.ok(readOnly.has(meta!.category), `enabled tool ${name} must be read-only, got ${meta!.category}`);
    }
  });

  it('no draft/evidence/approval/final-mutation tool is router-enabled', async () => {
    const { ROUTER_ENABLED_TOOLS } = await import('./intent-router.agent');
    const { LINE_TOOL_REGISTRY } = await import('@watchdog-bms/contracts');
    const writeLike = LINE_TOOL_REGISTRY.filter((t) =>
      ['evidence_capture', 'draft_create', 'approval_request', 'final_mutation'].includes(t.category));
    for (const tool of writeLike) {
      assert.ok(!ROUTER_ENABLED_TOOLS.has(tool.name), `${tool.name} (${tool.category}) must not be model-callable`);
    }
  });
});

describe('IntentRouterAgent – intake clarifyQuestion (discovery)', () => {
  it('extracts a bounded clarifying question on the CLARIFY route', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          intent: 'CLARIFY', language: 'th', confidence: 0.5, reason: 'ambiguous',
          clarifyQuestion: `ต้องการบันทึกค่าใช้จ่าย หรือขอดูยอดสรุปครับ? ${'ก'.repeat(300)}`,
        }),
      }),
    } as any);
    const plan = await router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'อันนี้', permissions: [] } as any);
    assert.equal(plan.intent, 'CLARIFY');
    assert.ok(plan.clarifyQuestion!.startsWith('ต้องการบันทึกค่าใช้จ่าย'));
    assert.ok(plan.clarifyQuestion!.length <= 200, 'clarifying question is bounded');
  });

  it('ignores clarifyQuestion on non-CLARIFY routes', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, clarifyQuestion: 'x?' }),
      }),
    } as any);
    const plan = await router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขาย', permissions: [] } as any);
    assert.equal(plan.clarifyQuestion, undefined);
  });
});

// ── Prompt caching: deterministic catalog leaves the varying message text ─────

describe('IntentRouterAgent – cacheable feature catalog', () => {
  it('sends the catalog as cacheableContext and keeps it out of the message text', async () => {
    let captured: ProviderInput | undefined;
    const router = new IntentRouterAgent({
      generateText: async (input) => {
        captured = input;
        return {
          ok: true as const,
          text: JSON.stringify({
            status: 'ROUTABLE', language: 'th',
            intents: [{ intent: 'read_summary', subject: 'booking', agent: 'crm', priority: 1, requiredTools: ['crm.get_booking_summary'], missingContext: [] }],
            refusals: [], requiresHumanReview: false,
          }),
        };
      },
    });

    const plan = await router.route('สัปดาห์นี้มีนัดกี่รายการ', true);
    assert.equal(plan.status, 'ROUTABLE', 'router plans still parse with the catalog moved');
    assert.equal(captured!.usageTag, 'line.plan-route');
    assert.match(captured!.cacheableContext!, /"enabledFeatures"/);
    assert.match(captured!.cacheableContext!, /crm\.get_booking_summary/);
    // The catalog must not also sit inside the varying payload, or no stable prefix can form.
    assert.deepEqual(JSON.parse(captured!.messages[0]!.text), { messageText: 'สัปดาห์นี้มีนัดกี่รายการ', hasAttachment: true });
  });

  it('serializes the catalog byte-identically across calls and clears the cache threshold', async () => {
    const contexts: string[] = [];
    const router = new IntentRouterAgent({
      generateText: async (input) => {
        contexts.push(input.cacheableContext ?? '');
        return { ok: false as const, error: { code: 'PROVIDER_UNKNOWN' as const, message: 'stub', retryable: false } };
      },
    });

    await router.route('ยอดขายวันนี้');
    await router.route('ของใกล้หมดมีอะไร');
    assert.equal(contexts.length, 2);
    assert.equal(contexts[0], contexts[1], 'a byte-unstable catalog can never produce a cache hit');
    assert.ok(contexts[0]!.length >= CACHE_MIN_CHARS, 'catalog must clear CACHE_MIN_CHARS to earn a checkpoint');
  });

  it('passes bounded Thai business abbreviations to both semantic routers without rewriting the user message', async () => {
    const inputs: ProviderInput[] = [];
    const messageText = 'ผปก. ขอสรุป คชจ. และจำนวน ลค.';
    const router = new IntentRouterAgent({
      generateText: async (input) => {
        inputs.push(input);
        return input.usageTag === 'line.intake-route'
          ? { ok: true as const, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.99, reason: 'คำถามข้อมูลธุรกิจ' }) }
          : { ok: true as const, text: JSON.stringify({
            status: 'ROUTABLE', language: 'th',
            intents: [{ intent: 'read_summary', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.list_recent'], missingContext: [] }],
            refusals: [], requiresHumanReview: false,
          }) };
      },
    });

    await router.route(messageText);
    await router.routeIntake({ requestId: 'r1', companyId: 'c1', userId: 'u1', locale: 'th-TH', messageText, permissions: [] } as any);

    const planPayload = JSON.parse(inputs.find((input) => input.usageTag === 'line.plan-route')!.messages[0]!.text);
    const catalog = JSON.parse(inputs.find((input) => input.usageTag === 'line.plan-route')!.cacheableContext!);
    const intakePayload = JSON.parse(inputs.find((input) => input.usageTag === 'line.intake-route')!.messages[0]!.text);
    assert.equal(planPayload.messageText, messageText);
    assert.equal(intakePayload.messageText, messageText);
    assert.deepEqual(catalog.businessGlossary.map((entry: { forms: string[] }) => entry.forms), [['ผปก', 'ผปก.'], ['คชจ', 'คชจ.'], ['ลค', 'ลค.']]);
    assert.deepEqual(intakePayload.businessGlossary, catalog.businessGlossary);
  });
});
