import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntentRouterAgent, intakeRouterSystemPrompt, isCrisisMessage, isSubjectCompatible, LINE_INTAKE_ROUTER_SYSTEM_PROMPT, ROUTER_ENABLED_TOOLS } from './intent-router.agent';
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
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
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
    assert.equal(plan.refusals[0]?.reason, 'tool_unavailable');
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
    const intakeInput = inputs.find((input) => input.usageTag === 'line.intake-route')!;
    const intakePayload = JSON.parse(intakeInput.messages[0]!.text);
    assert.equal(planPayload.messageText, messageText);
    assert.equal(intakePayload.messageText, messageText);
    assert.deepEqual(catalog.businessGlossary.map((entry: { forms: string[] }) => entry.forms), [['ผปก', 'ผปก.'], ['คชจ', 'คชจ.'], ['ลค', 'ลค.']]);
    // DEFAULT (no capabilities): the intake router keeps the LEGACY shape — the glossary rides in the DATA
    // payload and there is NO cacheable catalog (that ~21KB block is a fused-only cost).
    assert.deepEqual(intakePayload.businessGlossary, catalog.businessGlossary);
    assert.equal(intakeInput.cacheableContext, undefined);
  });
});

// ── Phase 3 fused producer: routeIntake may return an optional bounded prepared plan ──────────────

describe('IntentRouterAgent – fused prepared plan producer (Phase 3)', () => {
  const READ_PLAN = {
    version: 1, complexity: 'simple', confidence: 0.95, responseMode: 'simple_grounded', answerShape: 'single_metric',
    intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }] },
    proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } }],
  };
  const CASUAL_PLAN = {
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'casual_composer',
    intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [{ intent: 'casual_conversation', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }] },
    proposedCalls: [],
  };
  // The exact bounded zero-tool refusal shape the prompt instructs (one 'unknown'/'general' intent + one refusal).
  const REFUSAL_PLAN = {
    version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'deterministic',
    intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [{ request: 'อนุมัติบิลนี้ให้หน่อย', reason: 'mutation_blocked' }], intents: [{ intent: 'unknown', subject: 'unknown', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }] },
    proposedCalls: [],
  };
  const routerReturning = (body: Record<string, unknown>) => new IntentRouterAgent({
    generateText: async () => ({ ok: true as const, text: JSON.stringify(body) }),
  } as any);
  const intake = (extra: Record<string, unknown> = {}) => ({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: ['crm.report.read'], capabilities: { fusedPlan: true }, ...extra } as any);

  it('attaches ONLY the bounded prepared plan for a business read (no provenance in the wrapper)', async () => {
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'อ่านยอดขาย', preparedPlan: READ_PLAN });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.intent, 'BUSINESS_READ_QUESTION');
    assert.ok(plan.preparedPlan, 'prepared plan attached');
    assert.equal(plan.preparedPlan!.proposedCalls[0]?.toolName, 'sales.get_sales_summary');
    // Intake provenance is bound LATER by the API onto LineAiTurnRequest, never carried in the wrapper.
    assert.equal((plan.preparedPlan as Record<string, unknown>)['intakeIntent'], undefined);
  });

  it('never lets the wrapper carry a model-claimed intakeIntent (it is dropped at parse)', async () => {
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'x', preparedPlan: { ...READ_PLAN, intakeIntent: 'BUSINESS_DOCUMENT_REFERENCE' } });
    const plan = await router.routeIntake(intake());
    assert.ok(plan.preparedPlan, 'the rest of the wrapper still parses');
    assert.equal((plan.preparedPlan as Record<string, unknown>)['intakeIntent'], undefined);
  });

  it('discards an invalid prepared plan (forged version) and preserves the outer route', async () => {
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'x', preparedPlan: { ...READ_PLAN, version: 2 } });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.intent, 'BUSINESS_READ_QUESTION', 'route preserved');
    assert.equal(plan.preparedPlan, undefined, 'invalid wrapper discarded');
  });

  it('discards a prepared plan carrying a scope-injection input key, route preserved', async () => {
    const forged = { ...READ_PLAN, proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { companyId: 'other' } }] };
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'x', preparedPlan: forged });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.preparedPlan, undefined);
  });

  it('discards a model plan that ignores the one-call gate (two proposed calls), route preserved', async () => {
    // Even if the model disobeys the prompt's "exactly one call" instruction, the parser rebuild drops it.
    const twoCalls = { ...READ_PLAN, proposedCalls: [{ toolName: 'sales.get_sales_summary', input: {} }, { toolName: 'expense.list_recent', input: {} }] };
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'x', preparedPlan: twoCalls });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.intent, 'BUSINESS_READ_QUESTION', 'route preserved');
    assert.equal(plan.preparedPlan, undefined, 'a plan violating the one-call gate is discarded');
  });

  it('casual/capability: outer intake stays UNSUPPORTED while the inner plan carries the zero-tool intent', async () => {
    const router = routerReturning({ intent: 'UNSUPPORTED', language: 'th', confidence: 0.9, reason: 'คุยเล่น', preparedPlan: CASUAL_PLAN });
    const plan = await router.routeIntake(intake({ messageText: 'สวัสดีจ้า' }));
    assert.equal(plan.intent, 'UNSUPPORTED', 'outer intake remains UNSUPPORTED');
    assert.equal(plan.preparedPlan!.intentPlan.intents[0]?.intent, 'casual_conversation');
    assert.equal(plan.preparedPlan!.proposedCalls.length, 0);
  });

  it('attaches the exact bounded zero-tool refusal plan (one intent + one refusal parses)', async () => {
    const router = routerReturning({ intent: 'MUTATION_REQUEST_REFUSAL', language: 'th', confidence: 0.95, reason: 'ขอทำรายการเงิน', preparedPlan: REFUSAL_PLAN });
    const plan = await router.routeIntake(intake({ messageText: 'อนุมัติบิลนี้ให้หน่อย' }));
    assert.ok(plan.preparedPlan, 'the bounded refusal plan parses and attaches');
    assert.equal(plan.preparedPlan!.intentPlan.intents.length, 1);
    assert.equal(plan.preparedPlan!.intentPlan.intents[0]?.intent, 'unknown');
    assert.equal(plan.preparedPlan!.intentPlan.refusals[0]?.reason, 'mutation_blocked');
    assert.equal(plan.preparedPlan!.proposedCalls.length, 0);
  });

  it('does not attach a prepared plan to a low-confidence capture rewritten to CLARIFY', async () => {
    // The capture branch rewrites to CLARIFY before the fused attach, so no prepared plan rides along.
    const router = routerReturning({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.2, reason: 'บิล', preparedPlan: READ_PLAN });
    const plan = await router.routeIntake(intake({ messageText: 'บิลนี้' }));
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.preparedPlan, undefined);
  });

  it('returns no prepared plan when the model omits one (route unchanged)', async () => {
    const router = routerReturning({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98, reason: 'x' });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.intent, 'BUSINESS_READ_QUESTION');
    assert.equal(plan.preparedPlan, undefined);
  });
});

// ── Phase 3 producer PROMPT CONTRACT: the live provider is actually instructed to emit the bounded
// prepared plan and its omission gates (not merely parsed from invented output) ──────────────────

describe('LINE intake router prompt contract – instructs the bounded preparedPlan', () => {
  const P = intakeRouterSystemPrompt({ fusedPlan: true });

  it('lists preparedPlan in the output schema and names the exact bounded fields', () => {
    assert.match(P, /"preparedPlan"/);
    assert.match(P, /Fused prepared plan/);
    for (const field of ['"version": 1', '"complexity": "simple"', '"responseMode"', '"answerShape"', '"intentPlan"', '"proposedCalls"', '"requiredTools"']) {
      assert.ok(P.includes(field), `prompt must specify ${field}`);
    }
    assert.match(P, /"single_metric" \| "list"/);
    assert.match(P, /"simple_grounded" \| "casual_composer" \| "deterministic"/);
  });

  it('instructs exact tool==requiredTools equality and one intent/one call for a business read', () => {
    assert.match(P, /EXACTLY one intent .* and one proposedCall/);
    assert.match(P, /requiredTools equal to \[that one tool\]/);
    assert.match(P, /proposedCalls\[0\]\.toolName equal to that same tool/);
    assert.match(P, /category read_summary, read_detail, or report/);
  });

  it('makes the cacheable catalog the naming AND input-field authority, and forbids invention/scope keys', () => {
    assert.match(P, /copied VERBATIM from the enabledFeatures catalog/);
    assert.match(P, /never invent a tool, subject, agent, date, id, scope, or permission/);
    assert.match(P, /field NAMES listed in that tool's catalog requiredInputFields\/optionalInputFields/);
    assert.match(P, /NEVER include a branch, company, tenant, location, scope, or permission field/);
    assert.match(P, /a date ONLY as a candidate isoDate/);
    assert.match(P, /use input \{\} so the tool applies its default period/);
  });

  it('keeps casual/capability outer UNSUPPORTED with a zero-tool inner plan, and gives an exact parser-valid refusal intent', () => {
    assert.match(P, /keep the outer "intent" UNSUPPORTED/);
    assert.match(P, /"casual_conversation" or "capability_help"/);
    assert.match(P, /requiredTools \[\] and proposedCalls \[\]/);
    // The refusal plan names EXACTLY one bounded zero-tool intent so the simple parser (one intent) accepts it.
    assert.match(P, /EXACTLY one intent \{"intent":"unknown","subject":"unknown","agent":"general","priority":1,"requiredTools":\[\],"missingContext":\[\]\}/);
    assert.match(P, /ONE refusals entry \{"request","reason"\}/);
  });

  it('spells out every omission gate so an uncertain turn carries no preparedPlan', () => {
    for (const gate of ['missing or ambiguous context', 'an attachment', 'an open clarification', 'low confidence', 'more than one intent or tool', 'comparison/analysis/summary-across-many/mixed', 'a mutation to perform', 'document/capture/correction/signature route', 'human review needed', 'When in doubt, omit it']) {
      assert.ok(P.includes(gate), `prompt must gate on: ${gate}`);
    }
  });

  it('states the wrapper grants no authority and is server re-validated', () => {
    assert.match(P, /grants NO authority/);
    assert.match(P, /server RE-VALIDATES/);
  });

  it('ships the catalog authority the prompt references in the STABLE cacheable prefix (names the model must copy)', async () => {
    let cacheable = '';
    const router = new IntentRouterAgent({
      generateText: async (input: ProviderInput) => { cacheable = input.cacheableContext ?? ''; return { ok: true as const, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, reason: 'x' }) }; },
    } as any);
    await router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: [], capabilities: { fusedPlan: true } } as any);
    const catalog = JSON.parse(cacheable);
    const sales = catalog.enabledFeatures.find((f: any) => f.toolName === 'sales.get_sales_summary');
    assert.ok(sales, 'the catalog names the read tool the model must copy verbatim');
    assert.ok(Array.isArray(sales.businessSubjects) && sales.businessSubjects.includes('sale'));
    assert.ok(Array.isArray(sales.agentHints) && sales.agentHints.length > 0);
    assert.equal(sales.category, 'report');
    // The declared input field names must be in the catalog too, or "fields that tool declares" is
    // ungrounded and the model would have to invent input keys.
    assert.deepEqual(sales.requiredInputFields, []);
    assert.ok(sales.optionalInputFields.includes('fromDate') && sales.optionalInputFields.includes('toDate'),
      'sales input fields (fromDate/toDate) are exposed for the model to copy');
  });
});

// ── Default-off cost/prompt guard (P1-1): capabilities gate every added byte ──────────────────────

describe('LINE intake router – default-off is byte- and cost-equivalent to legacy', () => {
  const FUSED_MARKERS = ['Fused prepared plan', 'preparedPlan'];
  const SUBSTITUTE_MARKERS = ['SUBSTITUTE_RECEIPT_CONTINUATION', 'substituteContext'];

  it('the exported constant IS the default-off build (no capabilities)', () => {
    assert.equal(LINE_INTAKE_ROUTER_SYSTEM_PROMPT, intakeRouterSystemPrompt());
    assert.equal(LINE_INTAKE_ROUTER_SYSTEM_PROMPT, intakeRouterSystemPrompt({}));
  });

  it('default-off carries NONE of the fused or substitute sections', () => {
    const base = intakeRouterSystemPrompt();
    for (const m of [...FUSED_MARKERS, ...SUBSTITUTE_MARKERS]) {
      assert.equal(base.includes(m), false, `default-off must not contain ${m}`);
    }
  });

  it('each capability appends ONLY its own section — no cross-bleed, base is a strict prefix budget', () => {
    const base = intakeRouterSystemPrompt();
    const fused = intakeRouterSystemPrompt({ fusedPlan: true });
    const substitute = intakeRouterSystemPrompt({ substituteSemantic: true });
    // fused adds fused markers, never substitute markers.
    for (const m of FUSED_MARKERS) assert.ok(fused.includes(m), `fused must contain ${m}`);
    for (const m of SUBSTITUTE_MARKERS) assert.equal(fused.includes(m), false, `fused must not contain ${m}`);
    // substitute adds substitute markers, never fused markers.
    for (const m of SUBSTITUTE_MARKERS) assert.ok(substitute.includes(m), `substitute must contain ${m}`);
    for (const m of FUSED_MARKERS) assert.equal(substitute.includes(m), false, `substitute must not contain ${m}`);
    // Every capability is strictly additive: the default-off prompt is the shortest build.
    assert.ok(fused.length > base.length, 'fused only adds bytes');
    assert.ok(substitute.length > base.length, 'substitute only adds bytes');
  });

  it('routeIntake with no capabilities keeps the LEGACY runtime seam (no catalog prefix, glossary in DATA, maxTokens 1000)', async () => {
    let seen: ProviderInput | undefined;
    const router = new IntentRouterAgent({
      generateText: async (input: ProviderInput) => { seen = input; return { ok: true as const, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, reason: 'x' }) }; },
    } as any);
    await router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: [] } as any);
    assert.ok(seen, 'model was called');
    assert.equal(seen!.usageTag, 'line.intake-route');
    assert.equal(seen!.cacheableContext, undefined, 'no ~21KB catalog prefix by default');
    assert.equal(seen!.maxTokens, 1000, 'legacy token budget unchanged');
    assert.equal(seen!.systemPrompt, intakeRouterSystemPrompt(), 'default-off system prompt is the legacy build');
    const payload = JSON.parse(seen!.messages[0]!.text);
    assert.ok(Array.isArray(payload.businessGlossary), 'glossary rides in the DATA payload, as before');
  });

  it('routeIntake with fusedPlan on adds the catalog prefix and a larger bounded budget ONLY then', async () => {
    let seen: ProviderInput | undefined;
    const router = new IntentRouterAgent({
      generateText: async (input: ProviderInput) => { seen = input; return { ok: true as const, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, reason: 'x' }) }; },
    } as any);
    await router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: [], capabilities: { fusedPlan: true } } as any);
    assert.ok(seen!.cacheableContext && seen!.cacheableContext.length > 0, 'catalog prefix present when fused');
    assert.equal(seen!.maxTokens, 1500, 'larger budget only when fused output is enabled');
    const payload = JSON.parse(seen!.messages[0]!.text);
    assert.equal(payload.businessGlossary, undefined, 'glossary moves to the stable cacheable prefix when fused');
  });
});

// The intake receiver boundary bounds the TRUSTED capability flags at runtime (not only the TS shape): a
// malformed/hostile `capabilities` object can NEVER coerce a section on. routeIntake self-defends via
// asIntakeRouterCapabilities, so these hold no matter how the request was built.
describe('LINE intake router – receiver-boundary capability hardening (malformed input cannot activate)', () => {
  const capture = () => {
    let seen: ProviderInput | undefined;
    const router = new IntentRouterAgent({
      generateText: async (input: ProviderInput) => { seen = input; return { ok: true as const, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, reason: 'x' }) }; },
    } as any);
    return { router, get: () => seen! };
  };
  const base = { requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: [] };
  const assertLegacyOff = (seen: ProviderInput) => {
    assert.equal(seen.cacheableContext, undefined, 'no fused catalog');
    assert.equal(seen.maxTokens, 1000, 'legacy token budget (no cost bump)');
    assert.equal(seen.systemPrompt, intakeRouterSystemPrompt(), 'default-off prompt (no fused/substitute sections)');
    const payload = JSON.parse(seen.messages[0]!.text);
    assert.ok(Array.isArray(payload.businessGlossary), 'glossary in DATA (legacy)');
    assert.equal(payload.substituteContext, undefined, 'no substitute context in the payload');
  };

  it('a truthy NON-boolean fusedPlan/substituteSemantic does NOT activate fused or substitute (no coercion)', async () => {
    for (const truthy of [1, '1', 'true', {}, [], [true]] as unknown[]) {
      const c = capture();
      await c.router.routeIntake({ ...base, capabilities: { fusedPlan: truthy, substituteSemantic: truthy }, substituteContext: { workflowState: 'open', hasPendingQuestion: true, preparedState: 'none', recentCandidateCount: 1 } } as any);
      assertLegacyOff(c.get());
    }
  });

  it('unknown / nested-extra capability keys are ignored — the request stays default-off', async () => {
    const c = capture();
    await c.router.routeIntake({ ...base, capabilities: { evil: true, nested: { fusedPlan: true }, FUSEDPLAN: true } as any } as any);
    assertLegacyOff(c.get());
  });

  it('capabilities as a non-object (array / string / null) cannot activate a section', async () => {
    for (const bad of [[{ fusedPlan: true }], 'fusedPlan', null, 42] as unknown[]) {
      const c = capture();
      await c.router.routeIntake({ ...base, capabilities: bad } as any);
      assertLegacyOff(c.get());
    }
  });

  it('a substituteContext injected WITHOUT a literal-true substituteSemantic never rides the payload', async () => {
    const c = capture();
    await c.router.routeIntake({ ...base, capabilities: { substituteSemantic: 1 } as any, substituteContext: { workflowState: 'open', hasPendingQuestion: true, preparedState: 'none', recentCandidateCount: 2 } } as any);
    const payload = JSON.parse(c.get().messages[0]!.text);
    assert.equal(payload.substituteContext, undefined, 'substitute context is gated on the VALIDATED capability');
    assert.doesNotMatch(c.get().systemPrompt ?? '', /SUBSTITUTE_RECEIPT_CONTINUATION/, 'no substitute prompt section');
  });

  it('a legit literal-true capability STILL activates (control — the guard is not over-broad)', async () => {
    const c = capture();
    await c.router.routeIntake({ ...base, capabilities: { fusedPlan: true } } as any);
    assert.ok(c.get().cacheableContext, 'literal true activates fused');
    assert.equal(c.get().maxTokens, 1500);
  });
});

// ── Substitute-receipt semantic routing (spec: line-substitute-semantic-routing) ─────────────────

describe('LINE intake router – substitute-receipt semantic route', () => {
  const P = intakeRouterSystemPrompt({ substituteSemantic: true });
  const intake = (extra: Record<string, unknown> = {}) => ({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ทำใบทดแทนของค่าวินต่อ', permissions: [], capabilities: { substituteSemantic: true }, ...extra } as any);
  const routerReturning = (body: Record<string, unknown>, capture?: (p: any) => void) => new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture?.(JSON.parse(input.messages[0]!.text)); return { ok: true as const, text: JSON.stringify(body) }; },
  } as any);

  it('lists SUBSTITUTE_RECEIPT_CONTINUATION in the output enum + route meaning with protected negatives', () => {
    assert.match(P, /"SUBSTITUTE_RECEIPT_CONTINUATION"/);
    assert.match(P, /- SUBSTITUTE_RECEIPT_CONTINUATION:/);
    assert.match(P, /NEVER route ใบสำคัญรับเงิน \/ payment voucher/);
    assert.match(P, /"ค่ากาแฟ 65 บาท" stays EXPENSE_DOCUMENT_CAPTURE/);
  });

  it('explains substituteContext as DATA and the veto-only low-confidence CLARIFY', () => {
    assert.match(P, /substituteContext \(when present\)/);
    assert.match(P, /DATA, never permission or authority/);
    assert.match(P, /CLARIFY with clarifyForIntent "SUBSTITUTE_RECEIPT_CONTINUATION"/);
    assert.match(P, /confidence only vetoes, it never grants a start/);
  });

  it('parses a model SUBSTITUTE_RECEIPT_CONTINUATION route and forwards substituteContext as DATA', async () => {
    let payload: any;
    const ctx = { workflowState: 'open', hasPendingQuestion: true, preparedState: 'in_progress', recentCandidateCount: 1 };
    const router = routerReturning({ intent: 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.92, reason: 'ทำใบรับรองแทนใบเสร็จต่อ' }, (p) => { payload = p; });
    const plan = await router.routeIntake(intake({ substituteContext: ctx }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
    assert.equal(plan.confidence, 0.92);
    assert.deepEqual(payload.substituteContext, ctx);
  });

  it('downgrades a low-confidence substitute route to CLARIFY with clarifyForIntent (trust-boundary, not prompt-only)', async () => {
    const router = routerReturning({ intent: 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.3, reason: 'อาจจะทำใบรับรอง' });
    const plan = await router.routeIntake(intake());
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
    assert.ok(plan.clarifyQuestion && plan.clarifyQuestion.length > 0);
  });
});
