import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT_ROUTER_SYSTEM_PROMPT, IntentRouterAgent, intakeRouterSystemPrompt, isCrisisMessage, isSubjectCompatible, LINE_INTAKE_ROUTER_SYSTEM_PROMPT, ROUTER_ENABLED_TOOLS } from './intent-router.agent';
import { MANGMEE_PERSONA_LINES } from './mangmee-persona';
import { RESPONSE_COMPOSER_SYSTEM_PROMPT } from './response-composer.agent';
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
    // S-3 (spec §5.5): the prompt must name the explain tool for a "why does MY record look like
    // this" question AND must forbid answering it with the period total. Without the second half
    // the router kept choosing expense.list_recent for the Owner's E4 sentence.
    assert.ok(systemPrompt.includes('use expense.explain_record with subject expense and agent accounting'),
      'router prompt must route the own-record explanation question to expense.explain_record');
    assert.ok(systemPrompt.includes('Never answer that question with expense.list_recent'),
      'router prompt must forbid answering it with a period total');
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

	  it('passes bounded conversation context to model routing payloads, spec §4 R-M3 recentReads included', async () => {
	    const context = {
	      windowMinutes: 15,
	      maxTurns: 15,
	      lastTurnAt: '2026-07-05T10:00:00.000Z',
	      recentTurns: [{ at: '2026-07-05T10:00:00.000Z', userMessagePreview: 'ดูสินค้าใกล้หมด', assistantReplyPreview: 'มี 2 รายการ', intent: 'READ_DETAIL', agent: 'inventory', refused: false }],
	      // Spec §4 R-M3: the model must see this to resolve "อันที่สองล่ะ" below — the whole point of
	      // this test is proving conversationContext reaches the payload byte-for-byte, unfiltered.
	      recentReads: [{ tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-08-25T09:00:00.000Z',
	        shownItems: [{ ordinal: 1, id: 'e1', label: 'ร้านหนึ่ง', date: '2026-08-01' }, { ordinal: 2, id: 'e2', label: 'ร้านสอง', date: '2026-08-02' }] }],
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

// Owner boundary (2026-07-05, amended by the draft-control spec 2026-09-05 §5.4): LINE AI is
// read-first, with ONE exception — the five `draft_update` tools, which only PREVIEW a change to
// the caller's own recent draft and write nothing. Drafts, evidence, approval and final mutation
// stay unreachable to the model.
describe('IntentRouterAgent – read-only tool boundary', () => {
  it('every router-enabled tool is read-only, or a draft_update preview tool', async () => {
    const { ROUTER_ENABLED_TOOLS } = await import('./intent-router.agent');
    const { LINE_TOOL_REGISTRY, LINE_DRAFT_UPDATE_TOOLS } = await import('@watchdog-bms/contracts');
    const readOnly = new Set(['read_summary', 'read_detail', 'report', 'suggestion']);
    for (const name of ROUTER_ENABLED_TOOLS) {
      const meta = LINE_TOOL_REGISTRY.find((t) => t.name === name);
      assert.ok(meta, `enabled tool ${name} must exist in registry`);
      const previewTool = meta!.category === 'draft_update'
        && ((LINE_DRAFT_UPDATE_TOOLS as readonly string[]).includes(name) || name === 'expense.action.preview' || name === 'counterparty.action.preview' || name === 'company.action.preview');
      assert.ok(readOnly.has(meta!.category) || previewTool,
        `enabled tool ${name} must be read-only or a draft_update preview, got ${meta!.category}`);
    }
  });

  it('the five draft_update tools require the SAME permission as the web draft PATCH', async () => {
    const { LINE_TOOL_REGISTRY, LINE_DRAFT_UPDATE_TOOLS } = await import('@watchdog-bms/contracts');
    for (const name of LINE_DRAFT_UPDATE_TOOLS) {
      const meta = LINE_TOOL_REGISTRY.find((t) => t.name === name)!;
      // `expense.controller.ts` `updateDraft` → `@RequirePermissions('expense.update')`. LINE must
      // never be a cheaper way to edit than the web form.
      assert.deepEqual(meta.requiredPermissions, ['expense.update']);
      assert.equal(meta.requiresErpPermissionCheck, true);
      assert.equal(meta.sensitiveAudit, true);
      assert.equal(meta.category, 'draft_update');
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

// S-4 (draft-control spec §5.4/§8). Two things are asserted here that nothing else can prove:
// the prompt actually TELLS the model to use these tools, and the catalog it is given contains
// them only when this deployment has switched the lane on.
describe('IntentRouterAgent – draft edit routing (S-4)', () => {
  it('the system prompt steers an own-record edit to the expense.draft.* tools', () => {
    const prompt = INTENT_ROUTER_SYSTEM_PROMPT;
    assert.match(prompt, /expense\.draft\.\* tool with subject expense and agent accounting/);
    assert.match(prompt, /only PREVIEW the change/);
    // The refusal half of the same sentence: another shop's document is not routable here.
    assert.match(prompt, /another shop's, another person's, or another company's document is not routable here/);
  });

  it('offers the five draft tools in the catalog only when the flag is on', async () => {
    const catalogFor = async (draftEditEnabled: boolean): Promise<string> => {
      let catalog = '';
      const router = new IntentRouterAgent({
        generateText: async (input: ProviderInput) => {
          // Everything model-visible this turn: the cacheable catalog block, the system prompt and
          // every message text. If the tool name is in none of them, the model was never offered it.
          catalog = [
            input.cacheableContext ?? '',
            input.systemPrompt ?? '',
            ...input.messages.map((message) => message.text),
          ].join('\n');
          return { ok: true as const, text: JSON.stringify({
            status: 'ROUTABLE', language: 'th',
            intents: [{ intent: 'read_detail', subject: 'expense', agent: 'accounting', priority: 1, requiredTools: ['expense.draft.add_charge'], missingContext: [] }],
            refusals: [], requiresHumanReview: false,
          }) };
        },
      }, draftEditEnabled);
      const plan = await router.route('บิลเมื่อกี้มีค่าบริการ 10% นะ');
      // The plan itself is accepted either way — the API executor is the authoritative gate — but
      // the model may only be OFFERED the tool when the lane exists.
      assert.equal(plan.status, 'ROUTABLE');
      return catalog;
    };
    assert.ok((await catalogFor(true)).includes('expense.draft.add_charge'), 'flag on: the tool is in the catalog');
    assert.ok(!(await catalogFor(false)).includes('expense.draft.add_charge'), 'flag off: the tool is absent, not merely refused');
  });
});

// Spec item 2(g): expense.get_breakdown now also groups byVendor, and both expense.list_recent and
// expense.get_breakdown accept a free-text categoryName/vendorName — the prompt must say both, or the
// model has no way to know either exists.
describe('IntentRouterAgent – expense breakdown/name-filter routing (item 2g)', () => {
  it('tells the model expense.get_breakdown also groups by vendor', () => {
    assert.match(INTENT_ROUTER_SYSTEM_PROMPT, /group the period by category, branch, or vendor/);
  });

  it('tells the model to pass a user-typed category/vendor name as categoryName/vendorName, never invented', () => {
    assert.match(INTENT_ROUTER_SYSTEM_PROMPT, /pass that exact text as categoryName\/vendorName on expense\.list_recent or expense\.get_breakdown/);
    assert.match(INTENT_ROUTER_SYSTEM_PROMPT, /never invent a category or vendor name the message does not contain/);
  });
});

describe('IntentRouterAgent – conversation read memory (spec §4 R-M3/R-M4)', () => {
  it('describes recentReads, its no-amount rule, and ordinal-to-shownItems resolution in the base intake prompt', () => {
    const prompt = intakeRouterSystemPrompt();
    assert.match(prompt, /conversationContext\.recentReads \(when present, spec §4 R-M2\/R-M3\)/);
    assert.match(prompt, /NO amount in it \(never state a number from here/);
    assert.match(prompt, /resolve that ONLY to the id at that ordinal in the newest matching entry's shownItems/);
  });

  it('tuning-6b (F1, T-014-b): a same-turn correction of the PREVIOUS READ stays BUSINESS_READ_QUESTION, never EXPENSE_CAPTURE_CORRECTION', () => {
    const prompt = intakeRouterSystemPrompt();
    assert.match(prompt, /a short "ไม่ใช่ X", "X ต่างหาก", or "หมายถึง X" reply right after a BUSINESS_READ_QUESTION answer \(conversationContext\.recentReads present, no pending capture draft\/task\) corrects that PREVIOUS QUESTION, not a captured record/);
    assert.match(prompt, /it stays BUSINESS_READ_QUESTION, repeating the same read with the corrected value/);
    assert.match(prompt, /"ไม่ใช่ ค่าออฟฟิศต่างหากค่ะ" repeats that same read for categoryName ค่าออฟฟิศ, never a correction/);
  });

  it('lets the fused prepared plan copy a non-branch filter from recentReads, current message still wins', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true });
    assert.match(prompt, /you may instead copy THAT entry's period and its non-branch filters/);
    assert.match(prompt, /a value the current message actually states always overrides the copied one/);
    assert.match(prompt, /a clear change of subject copies nothing/);
  });

  it('tuning-3 item 2 (T-004#2/T-013#2): naming only a new groupBy still copies the rest of the matching recentReads entry (fused prepared plan)', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true });
    assert.match(prompt, /a message that names ONLY a new groupBy .* still copies that SAME entry's other filters too/);
    assert.match(prompt, /grouping is a presentation change, never a scope change/);
  });

  it('tuning-3 item 2 (T-004#2/T-013#2): the same groupBy-carries-filters guidance is in the compact decisionV1 lane semantic-turn planning uses', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /a follow-up clause naming ONLY a new groupBy .* is a presentation change, never a scope change/);
    assert.match(prompt, /copy that SAME period and its other filters .* from the newest matching conversationContext\.recentReads entry/);
  });

  // Advisor S2a (spec §5.1): the shop's own package, an upgrade or a package change routes to the one
  // permission-checked package read, so the API — never the model — decides who hears figures or a link.
  it('routes a package question, an upgrade and a package change to billing.get_package_usage as a read', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /or about upgrading, changing or buying this shop's package \("อัปเกรด", "ขอเปลี่ยนแพ็กเกจ"\) is BUSINESS_READ_QUESTION with one kind "read" clause and tool billing\.get_package_usage/);
    assert.match(prompt, /never MUTATION_REQUEST_REFUSAL, write, help or general/);
    assert.ok(ROUTER_ENABLED_TOOLS.has('billing.get_package_usage'));
    assert.doesNotMatch(intakeRouterSystemPrompt(), /billing\.get_package_usage/, 'the legacy prompt stays byte-exact');
  });

  // Owner 2026-09-30 (~16:00, spec §5.1a): anyone may ask package prices and contents, answered from the catalog read only.
  it('routes a package price or contents question to billing.get_package_catalog as a read, whoever asks', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /is BUSINESS_READ_QUESTION with one kind "read" clause and tool billing\.get_package_catalog, whoever asks — never general or help/);
    assert.match(prompt, /"แพ็กเกจเริ่มต้นราคาเท่าไหร่"/);
    assert.ok(ROUTER_ENABLED_TOOLS.has('billing.get_package_catalog'));
    assert.doesNotMatch(intakeRouterSystemPrompt(), /billing\.get_package_catalog/, 'the legacy prompt stays byte-exact');
  });

  // Advisor R1 integrated eval (2026-10-01, S-09): next to S3's "these reads take no filter" rule the router sent
  // "มีใบรับรองรอฉันอนุมัติไหม" to the substitute-receipt queue with no role on 3 of 4 approval questions. S3's rule
  // keeps its own three tools; the queue tool's side filter is named right after it.
  it('keeps the substitute-receipt queue\'s side filter apart from the reimbursement reads\' no-filter rule', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /reimbursement\.get_summary, reimbursement\.list_pending_approvals and reimbursement\.get_approval_backlog take no status, payment or name filter — the states they report are built in — so a state or a person in the question \(อนุมัติแล้ว, ยังไม่จ่าย, รอจ่าย, ที่รอสมศรี\) is never a filter on them; their only filter is requester "me" on reimbursement\.get_approval_backlog, when the user asks about their OWN claims \(ของฉัน, ที่ฉันขอ, ที่ฉันยื่น\)\. That no-filter rule covers those three reimbursement tools only: expense\.list_substitute_receipts_to_sign keeps its own role filter — payer or approver when the question names just that one side/);
    assert.match(prompt, /"ใบรับรองรอฉันอนุมัติ", "มีใบรับรองให้ฉันอนุมัติไหม" are role approver; "ที่ฉันต้องเซ็นในฐานะผู้จ่ายเงิน" is role payer/);
    // People say เซ็น for approving too: in the same run the router sent role payer on 3 of 8 bare-เซ็น questions,
    // which hides the approver side from someone who only approves.
    assert.match(prompt, /is role payer\)\. A bare sign verb \(เซ็น, ลงนาม, ลงลายมือชื่อ, ลงชื่อ\) names no side — people say it for approving too — so it carries no role and neither is passed: role approver is passed only for อนุมัติ\/ตรวจรับ, role payer only for ผู้จ่าย\. A ทำไม\/อธิบาย question/);
    assert.doesNotMatch(intakeRouterSystemPrompt(), /keeps its own role filter|A bare sign verb/, 'the legacy prompt stays byte-exact');
  });

  // N2 (tuning-8, T-107-b): reverses B4h (tuning-5b) — dropping categoryName/vendorName left the
  // router's own call an unfiltered ranking and nothing else, so "ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ"
  // never looked inside ค่าเดินทาง. semantic-turn-v2.ts's H2 already adds the unfiltered ranking sibling
  // whenever a name-filtered expense.get_breakdown call exists, so the router keeping the name now lets
  // the answer cover both the drivers and the rank.
  it('tuning-8 (T-107-b): a why-question about one named category or vendor keeps that name in the compact decisionV1 lane', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /A ทำไม\/why question about one named category or vendor KEEPS that categoryName\/vendorName exactly as the user typed it/);
    assert.doesNotMatch(prompt, /never add that categoryId\/vendorName/);
  });

  // R1(a): a topic return/restart, or a self-contained list request naming no status of its own,
  // must never inherit an earlier status/payment/category/vendor/branch filter — only the period plus
  // whatever the new message itself states. The decoder-side backstop for the fast lane's own
  // recentReads carry lives in line-intake-compact-decision.ts (see its own spec).
  it('R1(a): an explicit topic restart drops every inherited status/payment/category/vendor/branch filter in the compact decisionV1 lane', () => {
    const prompt = intakeRouterSystemPrompt({}, false, true);
    assert.match(prompt, /An explicit topic return or restart — "กลับมาเรื่อง…", "กลับมาที่…", "เรื่องเดิม…อีกที", "ขอดูใหม่", "เริ่มใหม่"/);
    assert.match(prompt, /a self-contained list request naming no status of its own \("ขอดูรายการล่าสุด N รายการ", "ขอ list…"\)/);
    assert.match(prompt, /dropping every inherited status, payment, category, vendor and branch filter/);
    assert.match(prompt, /is NOT a restart and keeps carrying exactly as above/);
  });

  it('item 3 (spec §3 row 8): the compact simpleRead guidance covers an ordinal reference to expense.get_detail/reimbursement.get_detail', () => {
    const prompt = intakeRouterSystemPrompt({ fusedPlan: true }, false, true, false,
      new Set(['expense.get_detail::single_metric', 'reimbursement.get_detail::single_metric']));
    assert.match(prompt, /an ordinal reference to a record already shown this chat \("รายการที่ 3", "อันที่ 2"\) may instead use tool expense\.get_detail or reimbursement\.get_detail with answerShape "single_metric"/);
    assert.match(prompt, /putting its id in filters\.expenseId or filters\.reimbursementId copied ONLY from that ordinal's entry in the newest matching conversationContext\.recentReads shownItems/);
    // The same guidance is absent when the compact/simpleRead lane itself is off (no families offered).
    const off = intakeRouterSystemPrompt({ fusedPlan: true }, false, true, false, new Set());
    assert.doesNotMatch(off, /expense\.get_detail or reimbursement\.get_detail/);
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
    assert.match(P, /a day ONLY as a candidate isoDate/);
    // Period-resolution spec §3.2: a period is COPIED from valueCandidates.periods, never computed.
    assert.match(P, /a PERIOD only by copying one valueCandidates\.periods entry/);
    assert.match(P, /NEVER compute a date, a month end, a week boundary or an era yourself/);
    assert.match(P, /use input \{\} so the tool applies its default \(current month; daily closing: today\)/);
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

// UAT 2026-08-28: the router was taught to return documentText (the page transcribed) so receipt OCR
// would not read the same photo twice — but the response budget stayed at the plan-sized 1500. Every one
// of six real receipts stopped at exactly 1500 output tokens, which is not a shorter plan but unparseable
// JSON, so all six failed closed to UNAVAILABLE and the customer was asked "what is this picture?". The
// suite stayed green throughout: a hand-written mock answer is never truncated, and the one test that did
// assert the budget only checked the number passed IN. These pin the shape that failure needed.
describe('LINE intake router – a transcribed page needs its own output budget', () => {
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const plannedAnswer = JSON.stringify({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9, reason: 'x' });
  const capture = () => {
    let seen: ProviderInput | undefined;
    const router = new IntentRouterAgent({
      generateText: async (input: ProviderInput) => { seen = input; return { ok: true as const, text: plannedAnswer }; },
    } as any);
    return { router, seen: () => seen };
  };
  const withImage = (extra: Record<string, unknown> = {}) => ({
    requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: '', permissions: [],
    attachments: [{ id: 'a1', mimeType: 'image/png', purpose: 'expense_document', contentBase64: PNG_1X1 }],
    ...extra,
  } as any);

  it('an image asks for documentText, so it gets a budget a whole page can fit in', async () => {
    const c = capture();
    await c.router.routeIntake(withImage({ capabilities: { fusedPlan: true } }));
    const budget = c.seen()!.maxTokens!;
    assert.ok(budget >= 8000, `a transcribed page needs room; got ${budget}`);
    assert.notEqual(budget, 1500, 'the plan-sized budget cannot hold a plan AND a page');
  });

  it('the document budget does not depend on fusedPlan — the prompt asks for documentText either way', async () => {
    const c = capture();
    await c.router.routeIntake(withImage());
    assert.ok(c.seen()!.maxTokens! >= 8000, 'legacy-shaped plans still carry the transcription');
    assert.match(c.seen()!.systemPrompt!, /top-level receiptFields object/);
    assert.match(c.seen()!.systemPrompt!, /Omit receiptFields entirely for every full or abbreviated tax invoice/);
    assert.match(c.seen()!.systemPrompt!, /more than 20 printed item rows/);
    assert.match(c.seen()!.systemPrompt!, /a transfer slip, order\/check bill/);
  });

  it('keeps a bounded raw receipt candidate inside the gateway for controller validation', async () => {
    const receiptFields = { vendorName: 'ร้านกาแฟ', grandTotalAmount: '65.00', confidence: 0.95 };
    const answer = {
      intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95, reason: 'receipt',
      documentText: 'ใบเสร็จ\nร้านกาแฟ\nยอดรวม 65.00\nชำระแล้ว',
      documentClassification: {
        contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
        businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
        confidence: 0.95, evidenceSignals: ['ใบเสร็จ'], amountSignals: ['65.00'], settlementSignals: ['ชำระแล้ว'],
        missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
      },
      receiptFields,
    };
    const router = new IntentRouterAgent({
      generateText: async () => ({ ok: true as const, text: JSON.stringify(answer) }),
    } as any);
    const imagePlan = await router.routeIntake(withImage());
    assert.deepEqual(imagePlan.receiptCandidate, receiptFields);

    const textPlan = await router.routeIntake({
      requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'ค่ากาแฟ 65 บาท', permissions: [],
    } as any);
    assert.equal(textPlan.receiptCandidate, undefined, 'text turns never expose the image-only candidate');
  });

  it('text-only intake keeps the legacy budgets, so ordinary chat cost is untouched', async () => {
    const legacy = capture();
    await legacy.router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'สวัสดี', permissions: [] } as any);
    assert.equal(legacy.seen()!.maxTokens, 1000);
    const fused = capture();
    await fused.router.routeIntake({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'สวัสดี', permissions: [], capabilities: { fusedPlan: true } } as any);
    assert.equal(fused.seen()!.maxTokens, 1500);
  });

  it('an answer that ran out of room is reported as truncation, not as a bad answer', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({ ok: true as const, text: plannedAnswer.slice(0, 40), stopReason: 'max_tokens' as const }),
    } as any);
    const plan = await router.routeIntake(withImage());
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'ROUTER_OUTPUT_TRUNCATED', 'raise the budget is a different fix from fix the prompt');
  });

  it('an unparseable answer that finished normally keeps the parse-failure code', async () => {
    const router = new IntentRouterAgent({
      generateText: async () => ({ ok: true as const, text: 'not json at all', stopReason: 'end_turn' as const }),
    } as any);
    const plan = await router.routeIntake(withImage());
    assert.equal(plan.errorCode, 'ROUTER_JSON_PARSE_FAILED');
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

// ── Expense-vs-reimbursement semantic intake (spec: line-ai-uat-correctness-latency §7) ─────────

describe('LINE intake router – reimbursement semantic route (trusted capability)', () => {
  const P = intakeRouterSystemPrompt({ reimbursementSemantic: true });
  const CAP = { reimbursementSemantic: true };
  // UAT 2026-08-21 exact phrase that the legacy router sent to expense capture at 0.97.
  const UAT_CLAIM = 'ขอเบิกค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า';
  const CANDIDATES_60 = { amounts: [{ span: '60 บาท', value: '60', currencyToken: 'บาท' }], dates: [] };
  const intake = (extra: Record<string, unknown> = {}) => ({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: UAT_CLAIM, permissions: [], capabilities: CAP, ...extra } as any);
  const routerReturning = (body: Record<string, unknown>, capture?: (input: ProviderInput) => void) => new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture?.(input); return { ok: true as const, text: JSON.stringify(body) }; },
  } as any);

  it('default-off carries none of the reimbursement section; the capability adds ONLY its own bytes', () => {
    const base = intakeRouterSystemPrompt();
    for (const m of ['REIMBURSEMENT_REQUEST_START', 'semanticOutcome', 'fundingSource', 'reimbursementHints']) {
      assert.equal(base.includes(m), false, `default-off must not contain ${m}`);
      assert.ok(P.includes(m), `capability build must contain ${m}`);
    }
    assert.equal(P.includes('Fused prepared plan'), false, 'no fused cross-bleed');
    assert.equal(P.includes('SUBSTITUTE_RECEIPT_CONTINUATION'), false, 'no substitute cross-bleed');
    assert.ok(P.length > base.length, 'strictly additive');
    assert.equal(LINE_INTAKE_ROUTER_SYSTEM_PROMPT, base, 'legacy constant untouched');
  });

  it('teaches the three-way rules: strong claim, bare ambiguous เบิก, protected negatives, greeting+business where business wins', () => {
    assert.match(P, /"REIMBURSEMENT_REQUEST_START"/);
    assert.match(P, /ขอเบิกค่าวิน 60 บาท ไปพบลูกค้า/);
    assert.match(P, /เบิกค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า/);
    assert.match(P, /สำรองจ่ายค่าวินไป 60 บาท ขอเบิกคืน/);
    assert.match(P, /สวัสดีเบิกค่าโดยสารหน่อย/);
    assert.match(P, /business wins over the social phrase/);
    assert.match(P, /"ค่าวินไปพบลูกค้า 60 บาท" and "ช่วยบันทึกค่าวินไปพบลูกค้า 60 บาท" stay EXPENSE_DOCUMENT_CAPTURE/);
    for (const negative of ['ขอดูใบเบิกที่ค้าง', 'เบิกของจากสต็อก 2 กล่อง', 'ขอเบิกเงินล่วงหน้า', 'ใบสำคัญรับเงิน', 'ขอเบิกได้ไหม', 'ไม่ต้องเบิกค่าวินแล้ว']) {
      assert.ok(P.includes(negative), `protected negative ${negative} must be named`);
    }
    assert.match(P, /REIMBURSEMENT_CLAIM \+ EMPLOYEE_PAID/);
    assert.match(P, /never default it to expense capture/);
    assert.match(P, /is NEVER this route — see REIMBURSEMENT_REQUEST_START/, 'the capture meaning is qualified under the capability');
  });

  it('parses the UAT strong claim: new intent + semantic fields + membership-guarded reimbursementHints, legacy token budget', async () => {
    let seen: ProviderInput | undefined;
    const router = routerReturning({
      intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.93, reason: 'claim',
      semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID',
      reimbursementHints: { description: 'ค่ารถวินมอไซต์', businessPurpose: 'ไปพบลูกค้า', amount: '60', categoryKey: 'travel', confidence: 0.9, missingFields: ['incurredDate', 'bogus'] },
    }, (input) => { seen = input; });
    const plan = await router.routeIntake(intake({ valueCandidates: CANDIDATES_60 }));
    assert.equal(seen!.systemPrompt, P, 'the capability build is the prompt actually sent');
    assert.equal(seen!.maxTokens, 1000, 'no token budget bump for the semantic section');
    assert.equal(seen!.cacheableContext, undefined, 'no fused catalog');
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'REIMBURSEMENT_REQUEST_START');
    assert.equal(plan.semanticOutcome, 'REIMBURSEMENT_CLAIM');
    assert.equal(plan.fundingSource, 'EMPLOYEE_PAID');
    assert.deepEqual(plan.reimbursementHints, {
      description: 'ค่ารถวินมอไซต์', businessPurpose: 'ไปพบลูกค้า', amount: '60', confidence: 0.9,
      missingFields: ['incurredDate', 'categoryKey'],
    });
    assert.equal(plan.captureHints, undefined, 'a claim never carries expense capture hints');
  });

  it('a greeting-wrapped bare เบิก with no payer parses as the reimbursement room with AMBIGUOUS/UNKNOWN and no amount', async () => {
    const router = routerReturning({
      intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.8, reason: 'bare',
      semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN',
      reimbursementHints: { description: 'ค่าโดยสาร', missingFields: ['amount', 'fundingSource'] },
    });
    const plan = await router.routeIntake(intake({ messageText: 'สวัสดีเบิกค่าโดยสารหน่อย' }));
    assert.equal(plan.intent, 'REIMBURSEMENT_REQUEST_START');
    assert.equal(plan.semanticOutcome, 'AMBIGUOUS');
    assert.equal(plan.fundingSource, 'UNKNOWN');
    assert.deepEqual(plan.reimbursementHints, { description: 'ค่าโดยสาร', missingFields: ['amount', 'fundingSource'] });
  });

  it('fails closed: omitted/invalid semantic fields become AMBIGUOUS + UNKNOWN (so a capture asks instead of acting); a hint amount or date absent from valueCandidates is stripped', async () => {
    const note = routerReturning({
      intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97, reason: 'note',
      semanticOutcome: 'SOMETHING_ELSE', captureHints: { description: 'ค่าเดินทาง', businessPurpose: 'ไปพบลูกค้า', amount: '200' },
    });
    const plan = await note.routeIntake(intake({
      messageText: 'ค่าเดินทาง 200 บาท วัตถุประสงค์ไปพบลูกค้า',
      valueCandidates: { amounts: [{ span: '200 บาท', value: '200', currencyToken: 'บาท' }], dates: [] },
    }));
    assert.equal(plan.semanticOutcome, 'AMBIGUOUS');
    assert.equal(plan.fundingSource, 'UNKNOWN');
    assert.equal(plan.intent, 'CLARIFY', 'capture on fail-closed semantics is a contradiction: ask, never act');
    assert.equal(plan.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.captureHints, undefined);

    const claim = routerReturning({
      intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.9, semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID',
      reimbursementHints: { amount: '600', incurredDate: '2026-08-20' },
    });
    const guarded = await claim.routeIntake(intake({ valueCandidates: CANDIDATES_60 }));
    assert.deepEqual(guarded.reimbursementHints, { missingFields: ['amount', 'incurredDate'] });
    const noCandidates = await claim.routeIntake(intake({ messageText: 'ขอเบิกค่ารถวิน ไปพบลูกค้า' }));
    assert.deepEqual(noCandidates.reimbursementHints, { missingFields: ['amount', 'incurredDate'] }, 'no candidates ⇒ nothing is accepted');
  });

  it('keeps all 200 named expense items through the capture-hints parser', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ description: `รายการ${i + 1}`, sourceText: `รายการ${i + 1}` }));
    const router = routerReturning({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
      semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID', captureHints: { items } });
    const plan = await router.routeIntake(intake({ messageText: items.map(item => item.sourceText).join(' ') }));
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.captureHints?.items?.length, 200);
    assert.equal(plan.captureHints?.items?.[199]?.description, 'รายการ200');
  });

  it('an ordinary spend note keeps BUSINESS_EXPENSE + COMPANY_PAID and its capture hints through the parser', async () => {
    const router = routerReturning({
      intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97, semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID',
      captureHints: { description: 'ค่าวิน', businessPurpose: 'ไปพบลูกค้า', amount: '60' },
    });
    const plan = await router.routeIntake(intake({ messageText: 'ค่าวินไปพบลูกค้า 60 บาท', valueCandidates: CANDIDATES_60 }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.semanticOutcome, 'BUSINESS_EXPENSE');
    assert.equal(plan.fundingSource, 'COMPANY_PAID');
    assert.equal(plan.captureHints?.amount, '60');
    assert.equal(plan.reimbursementHints, undefined, 'reimbursement hints exist only on the claim route');
  });

  it('a low-confidence claim is downgraded to CLARIFY that inherits the reimbursement route (confidence is veto-only)', async () => {
    const router = routerReturning({
      intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.4, semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN',
      reimbursementHints: { description: 'ค่ารถ' },
    });
    const plan = await router.routeIntake(intake({ messageText: 'เบิกค่ารถ' }));
    assert.equal(plan.intent, 'CLARIFY');
    assert.equal(plan.clarifyForIntent, 'REIMBURSEMENT_REQUEST_START');
    assert.match(plan.clarifyQuestion ?? '', /สำรองจ่าย/);
    assert.equal(plan.reimbursementHints, undefined);
    assert.equal(plan.semanticOutcome, 'AMBIGUOUS');
    assert.equal(plan.fundingSource, 'UNKNOWN');
  });

  it('WITHOUT a literal-true capability the legacy prompt is sent, an un-offered claim fails closed to UNAVAILABLE, and semantic advice is dropped', async () => {
    let seen: ProviderInput | undefined;
    const claim = routerReturning({
      intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.95, semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID',
    }, (input) => { seen = input; });
    for (const capabilities of [undefined, {}, { reimbursementSemantic: 'true' }, { reimbursementSemantic: 1 }, { reimbursementSemantic: false }]) {
      const plan = await claim.routeIntake(intake({ capabilities }));
      assert.equal(seen!.systemPrompt, intakeRouterSystemPrompt(), 'legacy prompt byte-identical');
      assert.equal(plan.status, 'UNAVAILABLE');
      assert.equal(plan.errorCode, 'ROUTER_JSON_PARSE_FAILED');
      assert.equal(plan.semanticOutcome, undefined);
      assert.equal(plan.fundingSource, undefined);
    }
    const legacy = routerReturning({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97, semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID', captureHints: { description: 'ค่ากาแฟ', amount: '65' } });
    const plan = await legacy.routeIntake(intake({ messageText: 'ค่ากาแฟ 65 บาท', capabilities: {}, valueCandidates: { amounts: [{ span: '65 บาท', value: '65', currencyToken: 'บาท' }], dates: [] } }));
    assert.equal(plan.intent, 'EXPENSE_DOCUMENT_CAPTURE');
    assert.equal(plan.semanticOutcome, undefined, 'semantic advice never rides a default-off plan');
    assert.equal(plan.fundingSource, undefined);
    assert.equal(plan.captureHints?.amount, '65');
  });

  it('reimbursementHints.confidence is kept only when finite and within 0..1 inclusive; anything else is omitted', async () => {
    // Raw text, not JSON.stringify: 1e999/-1e999 are the only non-finite numbers JSON can carry (they parse to
    // ±Infinity). NaN is not JSON-representable — JSON.stringify turns NaN/Infinity into null, covered as 'null'.
    const hintsFor = async (confidence: string | number) => {
      const text = `{"intent":"REIMBURSEMENT_REQUEST_START","language":"th","confidence":0.9,"semanticOutcome":"REIMBURSEMENT_CLAIM","fundingSource":"EMPLOYEE_PAID","reimbursementHints":{"description":"ค่ารถวินมอไซต์","confidence":${confidence}}}`;
      const router = new IntentRouterAgent({ generateText: async () => ({ ok: true as const, text }) } as any);
      return (await router.routeIntake(intake())).reimbursementHints;
    };
    for (const kept of [0, 0.5, 1]) assert.deepEqual(await hintsFor(kept), { description: 'ค่ารถวินมอไซต์', confidence: kept }, `${kept} is kept`);
    for (const dropped of [-0.1, 1.1, '1e999', '-1e999', 'null', '"0.9"']) {
      assert.deepEqual(await hintsFor(dropped), { description: 'ค่ารถวินมอไซต์' }, `${dropped} is omitted`);
    }
    assert.equal(JSON.stringify({ confidence: NaN }), '{"confidence":null}', 'NaN/Infinity reach the parser as null through JSON.stringify');
  });

  it('fails closed on route↔semantic contradictions: CLARIFY inheriting the ORIGINAL route, hints stripped, semantic fields preserved', async () => {
    for (const semanticOutcome of ['BUSINESS_EXPENSE', 'REIMBURSEMENT_CLAIM', 'AMBIGUOUS'] as const) {
      for (const fundingSource of ['COMPANY_PAID', 'EMPLOYEE_PAID', 'UNKNOWN'] as const) {
        const label = `${semanticOutcome}+${fundingSource}`;
        const capture = await routerReturning({
          intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97, semanticOutcome, fundingSource,
          captureHints: { description: 'ค่าวิน', businessPurpose: 'ไปพบลูกค้า', amount: '60' },
        }).routeIntake(intake({ messageText: 'ค่าวินไปพบลูกค้า 60 บาท', valueCandidates: CANDIDATES_60 }));
        const claim = await routerReturning({
          intent: 'REIMBURSEMENT_REQUEST_START', language: 'th', confidence: 0.95, semanticOutcome, fundingSource,
          reimbursementHints: { description: 'ค่ารถวินมอไซต์', amount: '60' },
        }).routeIntake(intake({ valueCandidates: CANDIDATES_60 }));
        for (const plan of [capture, claim]) {
          assert.equal(plan.status, 'ROUTED', label);
          assert.equal(plan.semanticOutcome, semanticOutcome, `${label}: semantic fields are preserved`);
          assert.equal(plan.fundingSource, fundingSource, `${label}: semantic fields are preserved`);
        }
        if (semanticOutcome === 'BUSINESS_EXPENSE' && fundingSource === 'COMPANY_PAID') {
          assert.equal(capture.intent, 'EXPENSE_DOCUMENT_CAPTURE', `${label}: the only capture-compatible pair`);
          assert.equal(capture.captureHints?.amount, '60', label);
          assert.equal(capture.clarifyForIntent, undefined, label);
        } else {
          assert.equal(capture.intent, 'CLARIFY', `capture ${label} must fail closed`);
          assert.equal(capture.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE', label);
          assert.equal(capture.captureHints, undefined, label);
          assert.match(capture.clarifyQuestion ?? '', /สำรองจ่าย/, label);
        }
        if (semanticOutcome === 'BUSINESS_EXPENSE' || fundingSource === 'COMPANY_PAID') {
          assert.equal(claim.intent, 'CLARIFY', `claim ${label} must fail closed`);
          assert.equal(claim.clarifyForIntent, 'REIMBURSEMENT_REQUEST_START', label);
          assert.equal(claim.reimbursementHints, undefined, label);
          assert.match(claim.clarifyQuestion ?? '', /สำรองจ่าย/, label);
        } else {
          assert.equal(claim.intent, 'REIMBURSEMENT_REQUEST_START', `claim ${label} stays routed (AMBIGUOUS/UNKNOWN is the ask-who-paid room)`);
          assert.equal(claim.reimbursementHints?.amount, '60', label);
          assert.equal(claim.clarifyForIntent, undefined, label);
        }
      }
    }
  });

  it('the contradiction veto never touches read/refusal/unsupported routes, and default-off has nothing to veto', async () => {
    for (const intent of ['BUSINESS_READ_QUESTION', 'MUTATION_REQUEST_REFUSAL', 'UNSUPPORTED'] as const) {
      const plan = await routerReturning({ intent, language: 'th', confidence: 0.95, semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID' })
        .routeIntake(intake({ messageText: 'ขอดูใบเบิกที่ค้าง' }));
      assert.equal(plan.intent, intent);
      assert.equal(plan.clarifyForIntent, undefined);
      assert.equal(plan.semanticOutcome, 'REIMBURSEMENT_CLAIM');
    }
    const legacy = await routerReturning({ intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97, captureHints: { description: 'ค่ากาแฟ', amount: '65' } })
      .routeIntake(intake({ messageText: 'ค่ากาแฟ 65 บาท', capabilities: {}, valueCandidates: { amounts: [{ span: '65 บาท', value: '65', currencyToken: 'บาท' }], dates: [] } }));
    assert.equal(legacy.intent, 'EXPENSE_DOCUMENT_CAPTURE', 'no semantic fields under default-off ⇒ nothing to veto');
    assert.equal(legacy.captureHints?.amount, '65');
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

// ── Advisor conversation, Slice A scaffolding (spec: line-ai-mangmee-advisor-conversation §6/§9/§9.1) ──
// Everything here is reachable ONLY through the trusted `advisor` capability, which the API turns on
// solely from LINE_AI_ADVISOR_MODE (default 'off'). With it off the prompt, the payload, the token
// budget and the parser must be byte- and cost-identical to today.

describe('LINE intake router – advisor route is invisible while the capability is off', () => {
  const intake = (extra: Record<string, unknown> = {}) => ({
    requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'กินข้าวยัง', permissions: [], ...extra,
  } as any);
  const routerReturning = (body: Record<string, unknown>, capture?: (input: ProviderInput) => void) => new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture?.(input); return { ok: true as const, text: JSON.stringify(body) }; },
  } as any);
  const ADVISOR_MARKERS = ['ADVISOR_CONVERSATION', 'advisorAnswer', 'Advisor answer'];

  it('the default-off prompt carries NONE of the advisor markers', () => {
    const base = intakeRouterSystemPrompt();
    for (const marker of ADVISOR_MARKERS) {
      assert.equal(base.includes(marker), false, `default-off must not contain ${marker}`);
    }
    assert.equal(LINE_INTAKE_ROUTER_SYSTEM_PROMPT, base, 'legacy constant untouched');
  });

  it('advisor appends ONLY its own section, and never the fused or substitute ones', () => {
    const base = intakeRouterSystemPrompt();
    const advisor = intakeRouterSystemPrompt({ advisor: true });
    for (const marker of ADVISOR_MARKERS) assert.ok(advisor.includes(marker), `advisor must contain ${marker}`);
    for (const marker of ['Fused prepared plan', 'preparedPlan', 'SUBSTITUTE_RECEIPT_CONTINUATION', 'substituteContext']) {
      assert.equal(advisor.includes(marker), false, `advisor must not contain ${marker}`);
    }
    assert.ok(advisor.length > base.length, 'advisor only adds bytes');
    // Strictly additive: turning fused on beside advisor still yields both sections and nothing else.
    const both = intakeRouterSystemPrompt({ advisor: true, fusedPlan: true });
    assert.ok(both.includes('Advisor answer') && both.includes('Fused prepared plan'));
  });

  it('routeIntake with advisor off keeps the legacy seam: no catalog prefix, 1000 tokens, legacy prompt', async () => {
    let seen: ProviderInput | undefined;
    const router = routerReturning({ intent: 'UNSUPPORTED', language: 'th', confidence: 0.9, reason: 'x' }, (input) => { seen = input; });
    await router.routeIntake(intake());
    assert.equal(seen!.systemPrompt, intakeRouterSystemPrompt(), 'byte-exact legacy prompt');
    assert.equal(seen!.cacheableContext, undefined, 'no extra prefix, so no extra cost');
    assert.equal(seen!.maxTokens, 1000, 'legacy token budget unchanged');
  });

  it('a model that returns the unoffered ADVISOR_CONVERSATION route FAILS CLOSED to UNAVAILABLE', async () => {
    // The route was never in the enum the prompt offered, so it is invalid output — not a route to
    // hand to a dispatcher that has no branch for it.
    const plan = await routerReturning({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.95 }).routeIntake(intake());
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.intent, 'UNSUPPORTED');
    assert.equal(plan.errorCode, 'ROUTER_JSON_PARSE_FAILED');
  });

  it('an advisorAnswer sent while the capability is off is ignored entirely', async () => {
    const plan = await routerReturning({
      intent: 'UNSUPPORTED', language: 'th', confidence: 0.9,
      advisorAnswer: { version: 1, mode: 'SOCIAL_CHAT', confidence: 0.99, needsTools: false, answerText: 'สวัสดีค่ะ' },
    }).routeIntake(intake());
    assert.equal(plan.intent, 'UNSUPPORTED');
    assert.equal(plan.advisorAnswer, undefined);
  });

  it('a truthy NON-boolean advisor capability cannot coerce the section on', async () => {
    for (const truthy of [1, '1', 'true', {}, [], [true]] as unknown[]) {
      let seen: ProviderInput | undefined;
      const router = routerReturning({ intent: 'UNSUPPORTED', language: 'th', confidence: 0.9 }, (input) => { seen = input; });
      await router.routeIntake(intake({ capabilities: { advisor: truthy } }));
      assert.equal(seen!.systemPrompt, intakeRouterSystemPrompt(), String(truthy));
      assert.equal(seen!.maxTokens, 1000, String(truthy));
    }
  });
});

describe('LINE intake router – advisor route under the trusted capability', () => {
  const P = intakeRouterSystemPrompt({ advisor: true });
  const intake = (extra: Record<string, unknown> = {}) => ({
    requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: 'กินข้าวยัง',
    permissions: [], capabilities: { advisor: true }, ...extra,
  } as any);
  const routerReturning = (body: Record<string, unknown>, capture?: (input: ProviderInput) => void) => new IntentRouterAgent({
    generateText: async (input: ProviderInput) => { capture?.(input); return { ok: true as const, text: JSON.stringify(body) }; },
  } as any);
  const socialAnswer = (overrides: Record<string, unknown> = {}) => ({
    version: 1, mode: 'SOCIAL_CHAT', confidence: 0.93, needsTools: false, answerText: 'ทานแล้วค่ะ', ...overrides,
  });

  it('the prompt states the Slice A boundaries: business wins, no company data, no links', () => {
    assert.match(P, /ADVISOR_CONVERSATION: social talk/);
    assert.match(P, /Business ALWAYS wins over a social phrase/);
    assert.match(P, /"mode": "SOCIAL_CHAT"/, 'Slice A offers the social mode only');
    assert.match(P, /NEVER put a URL, a link, HTML or Flex\/JSON/);
    assert.match(P, /never claim a body, a personal life, or that you are human/i);
    assert.equal(P.includes('knowledgeCardIds'), false, 'no knowledge registry in Slice A');
    assert.equal(P.includes('companyProfileFieldsUsed'), false, 'no company profile in Slice A');
  });

  // tuning-7b (K2, T-123-a/T-129-a): run 6 showed the router writing a full advisorAnswer.answerText
  // (445-564 output tokens, 8-10s calls) for a knowledge/definition question that the semantic-v2 path
  // then discarded and re-composed anyway. The prompt now caps advisorAnswer to short social chat and
  // tells the model to omit it entirely for a knowledge/definition/how-to question.
  it('caps advisorAnswer to short social chat and omits it for a knowledge/definition/how-to question', () => {
    assert.match(P, /"answerText": "your reply in the user's language, at most 2 short sentences"/);
    assert.match(P, /"answerText" is short social chat ONLY/);
    assert.match(P, /A knowledge, definition, or how-to question is NEVER short social chat/);
    assert.match(P, /OMIT "advisorAnswer" entirely for it/);
    assert.match(P, /never a list, numbered steps, or a tutorial/);
    assert.equal(P.includes('1–3 short sentences'), false, 'the old, looser cap is gone');
  });

  // UAT 2026-09-06 (build f2bd38ed): the draft for "คุณเป็นใคร" was a male-voiced "AI Assistant ของ
  // MangmeePlus" — the section never said who she is. The persona lines are ONE constant shared with
  // the composer prompt, appended only here, so the default prompt stays byte-identical to legacy.
  it('carries the shared persona inside the advisor section only, and keeps teaching out of the route', () => {
    for (const line of MANGMEE_PERSONA_LINES) {
      assert.ok(P.includes(line), `advisor section carries: ${line.slice(0, 48)}`);
      assert.ok(RESPONSE_COMPOSER_SYSTEM_PROMPT.includes(line), `composer shares: ${line.slice(0, 48)}`);
      assert.equal(intakeRouterSystemPrompt().includes(line), false, 'default prompt stays legacy');
      assert.equal(intakeRouterSystemPrompt({ fusedPlan: true }).includes(line), false, 'fused-only prompt stays persona-free');
    }
    assert.match(P, /ค่ะ\/คะ\/นะคะ/);
    assert.match(P, /An identity question \("คุณเป็นใคร"/);
    assert.match(P, /is NEVER ADVISOR_CONVERSATION: return "intent": "UNSUPPORTED" with NO advisorAnswer/);
    assert.match(P, /never a list, numbered steps, or a tutorial/);
    // Owner 2026-09-06: no robot icon, ever; a smile or a laugh only when it fits.
    assert.match(P, /Never use the robot emoji 🤖/);
    // Owner 2026-09-06: she calls herself น้องมั่งมี (or มั่งมี) — never หนู, ผม, ดิฉัน, or "AI Assistant".
    assert.match(P, /never as หนู, ผม, or ดิฉัน/);
  });

  it('parses the route plus its bounded advisor draft from ONE model response', async () => {
    let calls = 0;
    const router = new IntentRouterAgent({
      generateText: async () => {
        calls += 1;
        return { ok: true as const, text: JSON.stringify({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.93, reason: 'คุยเล่น', advisorAnswer: socialAnswer() }) };
      },
    } as any);
    const plan = await router.routeIntake(intake());
    assert.equal(calls, 1, 'no second router/model call');
    assert.equal(plan.status, 'ROUTED');
    assert.equal(plan.intent, 'ADVISOR_CONVERSATION');
    assert.equal(plan.advisorAnswer?.mode, 'SOCIAL_CHAT');
    assert.equal(plan.advisorAnswer?.answerText, 'ทานแล้วค่ะ');
    assert.equal(plan.advisorAnswer?.needsTools, false);
    assert.equal(plan.preparedPlan, undefined, 'the social envelope carries no preparedPlan');
    assert.equal(plan.advisorContext, undefined, 'advisorContext is server-derived, never model output');
  });

  it('an invalid draft is discarded while the ROUTE survives (fallback, never a repair)', async () => {
    for (const bad of [
      socialAnswer({ version: 2 }),
      socialAnswer({ mode: 'SOCIAL' }),
      socialAnswer({ confidence: 2 }),
      socialAnswer({ needsTools: 'false' }),
      socialAnswer({ answerText: 'อ่านที่ https://example.com ค่ะ' }),
      { ...socialAnswer(), advisorContext: { offeredCards: [], profileLoaded: true } },
      'not-an-object',
    ]) {
      const plan = await routerReturning({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.93, advisorAnswer: bad }).routeIntake(intake());
      assert.equal(plan.intent, 'ADVISOR_CONVERSATION', JSON.stringify(bad));
      assert.equal(plan.advisorAnswer, undefined, JSON.stringify(bad));
    }
  });

  it('§9.1 mismatch discard: a draft attached to any NON-advisor route is dropped before any tool', async () => {
    for (const intent of ['BUSINESS_READ_QUESTION', 'MUTATION_REQUEST_REFUSAL', 'CLARIFY', 'UNSUPPORTED'] as const) {
      const plan = await routerReturning({
        intent, language: 'th', confidence: 0.95, clarifyQuestion: 'ถามอะไรนะคะ', advisorAnswer: socialAnswer({ needsTools: true }),
      }).routeIntake(intake({ messageText: 'ยอดขายวันนี้เท่าไร' }));
      assert.equal(plan.intent, intent);
      assert.equal(plan.advisorAnswer, undefined, `${intent} must discard the advisor draft`);
    }
  });

  it('§9.1 rank 3: an attachment turn is never OFFERED the advisor route, even with the capability on', async () => {
    let seen: ProviderInput | undefined;
    const attachments = [{ id: 'a1', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AAAA' }];
    const router = routerReturning({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.95, advisorAnswer: socialAnswer() }, (input) => { seen = input; });
    const plan = await router.routeIntake(intake({ attachments, messageText: 'นี่ค่ะ' }));
    // Cost benchmark R2/R3 (2026-09-17): an attachment turn now also loses the fused-plan capability
    // and gets the document capture-hint schema, so the expectation is the advisor-free, fused-free
    // IMAGE prompt. The property under test is unchanged — the advisor route is never offered.
    assert.equal(seen!.systemPrompt, intakeRouterSystemPrompt({}, true), 'attachment turn gets the advisor-free image prompt');
    // The route was therefore never offered, so the model claiming it is invalid output.
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.intent, 'UNSUPPORTED');
    assert.equal(plan.advisorAnswer, undefined);
  });

  it('advisor adds no catalog prefix and no token-budget bump of its own', async () => {
    let seen: ProviderInput | undefined;
    const router = routerReturning({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.93 }, (input) => { seen = input; });
    await router.routeIntake(intake());
    assert.equal(seen!.cacheableContext, undefined, 'no ~21KB catalog: advisor never needs the tool catalog');
    assert.equal(seen!.maxTokens, 1000, 'social stays on the legacy budget');
    const payload = JSON.parse(seen!.messages[0]!.text);
    assert.ok(Array.isArray(payload.businessGlossary), 'payload shape unchanged');
  });
});

// UAT 2026-09-06: "สอนฉันใช้งานเบื้องต้น…" made the router write a tutorial instead of JSON. The route
// failed closed correctly, but the log carried only the code — nothing said WHAT the model had written.
describe('LINE intake router – an unparseable answer logs metadata without model output', () => {
  const USER_TEXT = 'สอนฉันใช้งานเบื้องต้นแบบง่ายง่ายแบบมนุษย์แม่ป้าเข้าใจได้';
  const intake = () => ({ requestId: 'r', companyId: 'c', userId: 'u', locale: 'th-TH', messageText: USER_TEXT, permissions: [] } as any);
  const routerWriting = (text: string, stopReason: 'end_turn' | 'max_tokens') => {
    const router = new IntentRouterAgent({ generateText: async () => ({ ok: true as const, text, stopReason }) } as any);
    const warned: Array<Record<string, unknown>> = [];
    (router as any).logger = { log: () => undefined, warn: (entry: Record<string, unknown>) => warned.push(entry) };
    return { router, warned };
  };

  it('warns once with the defect, attempt, stop reason and size, without a model preview', async () => {
    const tutorial = `ได้เลยค่ะ สอนให้นะคะ\n1) ${'ถ่ายรูปใบเสร็จแล้วส่งมา '.repeat(30)}\n\t2) กดยืนยัน`;
    const { router, warned } = routerWriting(tutorial, 'end_turn');
    const plan = await router.routeIntake(intake());
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'ROUTER_JSON_PARSE_FAILED');
    assert.equal(warned.length, 1);
    const entry = warned[0]!;
    assert.equal(entry.msg, 'line.intake_route.unparseable');
    assert.equal(entry.errorCode, 'ROUTER_JSON_PARSE_FAILED');
    assert.equal(entry.stopReason, 'end_turn');
    assert.equal(entry.outputChars, tutorial.length);
    assert.equal(entry.outputPreview, undefined);
    assert.equal(entry.rejection, 'route_json_invalid');
    assert.equal(entry.attempt, 1);
    assert.equal(JSON.stringify(entry).includes(tutorial.slice(0, 10)), false);
    assert.equal(JSON.stringify(entry).includes(USER_TEXT), false, 'never the user message');
  });

  it('a truncated answer logs the truncation code with stopReason max_tokens, and a parsed one logs nothing', async () => {
    const truncated = routerWriting('{"intent":"UNSUPPORTED","language":"th","confidence":0.9,"reason":"', 'max_tokens');
    assert.equal((await truncated.router.routeIntake(intake())).errorCode, 'ROUTER_OUTPUT_TRUNCATED');
    assert.equal(truncated.warned[0]?.errorCode, 'ROUTER_OUTPUT_TRUNCATED');
    assert.equal(truncated.warned[0]?.stopReason, 'max_tokens');
    const fine = routerWriting('{"intent":"UNSUPPORTED","language":"th","confidence":0.9,"reason":"สอนใช้งาน"}', 'end_turn');
    assert.equal((await fine.router.routeIntake(intake())).status, 'ROUTED');
    assert.equal(fine.warned.length, 0);
  });
});

describe('approved knowledge selection in the existing semantic route', () => {
  const offered = [{ id: 'expense.status', version: 1, title: 'สถานะเอกสาร', questions: ['ยืนยันแล้วจ่ายหรือยัง'], summary: 'เอกสารกับการชำระเงิน' }];
  const readPlan = {
    status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
    intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }],
  };
  it('PWS-FOLLOW-OFFER intake carries remembered ids as per-turn DATA without selecting or changing cached bytes', async () => {
    const { activeProductHelpPack } = await import('./approved-product-help');
    const { eligibleKnowledgeCards, offeredKnowledgeMetadata, productKnowledgeAccess } = await import('./approved-knowledge');
    const pack = activeProductHelpPack();
    const request = { ...await creditRequest('ไม่เข้าใจ'),
      permissions: [...new Set(pack.cards.flatMap(card => [...card.permissionAnyOf, ...card.requiredPermissions]))],
      enabledFeatures: [...new Set(pack.cards.flatMap(card => card.featureKeys))], capabilities: { approvedKnowledge: true } };
    const access = productKnowledgeAccess(request.permissions, request.enabledFeatures, true, 'th');
    const ordinary = offeredKnowledgeMetadata(pack, access, request.messageText);
    const previous = eligibleKnowledgeCards(pack, access).find(card => !ordinary.some(row => row.id === card.id))!;
    assert.ok(previous);
    const inputs: ProviderInput[] = [];
    const router = new IntentRouterAgent({ generateText: async input => {
      inputs.push(input);
      return { ok: true, text: JSON.stringify({ status: 'ROUTED', intent: 'UNSUPPORTED', language: 'th', confidence: 0.9 }) };
    } }, true, { enabled: true });
    await router.routeIntake(request);
    await router.routeIntake({ ...request, conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [],
      lastKnowledgeCards: [{ id: previous.id, version: previous.version }] } });
    const baseline = inputs[0]!, withMemory = inputs[1]!;
    const data = JSON.parse(withMemory.messages[0]!.text);
    assert.ok(data.approvedKnowledge.some((row: { id: string }) => row.id === previous.id));
    assert.deepEqual(data.conversationContext.lastKnowledgeCards, [{ id: previous.id, version: previous.version }]);
    assert.equal(withMemory.systemPrompt, baseline.systemPrompt);
    assert.equal(withMemory.cacheableContext, baseline.cacheableContext);
    assert.equal((await router.routeIntake(request)).selectedKnowledgeCardIds, undefined);
    assert.equal(JSON.stringify(inputs[2]), JSON.stringify(baseline), 'a turn without stored cards is byte-identical');
  });
  it('selects help with the same model call while retaining the independent business read', async () => {
    let calls = 0; let input: ProviderInput | undefined;
    const router = new IntentRouterAgent({ generateText: async (value) => {
      calls++; input = value;
      return { ok: true, text: JSON.stringify({ ...readPlan, selectedKnowledgeCardIds: ['expense.status'] }) };
    } }, false, { enabled: true });
    const text = 'ยืนยนแล้วคือจ่ายยัง แล้วช่วยดูยอดขายวันนี้ด้วย';
    const result = await router.route(text, false, undefined, undefined, offered);
    assert.equal(calls, 1);
    assert.deepEqual(result.selectedKnowledgeCardIds, ['expense.status']);
    assert.deepEqual(result.intents, readPlan.intents);
    const payload = JSON.parse(input!.messages[0]!.text);
    assert.equal(payload.messageText, text);
    assert.deepEqual(payload.approvedKnowledge, offered);
    assert.match(input!.systemPrompt ?? '', /same JSON response/i);
  });
  it('does not leak unvalidated selections from spread model properties', async () => {
    for (const selected of [['invented'], ['expense.status', 'expense.status'], ['expense.status']]) {
      const enabled = selected[0] !== 'expense.status' || selected.length > 1;
      const router = new IntentRouterAgent({ generateText: async () => ({
        ok: true, text: JSON.stringify({ ...readPlan, selectedKnowledgeCardIds: selected }),
      }) }, false, { enabled });
      const result = await router.route('ช่วยดูยอดขาย', false, undefined, undefined, offered);
      assert.equal(result.selectedKnowledgeCardIds, undefined);
      assert.deepEqual(result.intents, readPlan.intents);
    }
  });
});


describe('receipt/slip association route contract', () => {
  it('offers a distinct evidence link route, preserves valid JSON, and clarifies low confidence', async () => {
    for (const confidence of [0.98, 0.2]) {
      const inputs: ProviderInput[] = [];
      const router = new IntentRouterAgent({ generateText: async (input) => {
        inputs.push(input);
        return { ok: true, text: JSON.stringify({ intent: 'EXPENSE_PAYMENT_EVIDENCE_LINK', language: 'th', confidence }) };
      } });
      const plan = await router.routeIntake({ requestId: 'evidence-link', companyId: 'company', userId: 'user', locale: 'th-TH',
        messageText: 'สลิปโอนเงินเป็นหลักฐานของค่าใช้จ่ายเมื่อกี้', permissions: ['expense.receipt.upload'],
        recentCapturedExpenses: [{ id: 'receipt', label: 'รายการล่าสุด' }] } as any);
      assert.equal(plan.status, 'ROUTED');
      assert.equal(plan.intent, confidence > 0.5 ? 'EXPENSE_PAYMENT_EVIDENCE_LINK' : 'CLARIFY');
      const prompt = inputs[0]!.systemPrompt ?? '';
      assert.match(prompt, /"intent": "EXPENSE_PAYMENT_EVIDENCE_LINK"/);
      assert.match(prompt, /NEVER route this to a new EXPENSE_DOCUMENT_CAPTURE/);
      assert.match(INTENT_ROUTER_SYSTEM_PROMPT, /conversationContext.recentCapturedExpenses/);
    }
  });
});

import { createLineAiInputEvidence, LINE_CHAT_ACTIONS } from '@watchdog-bms/contracts';
it('Fix-up 15: the metered intake selects a catalog action by meaning and ignores invented navigation', async () => {
  const text = 'สร้างใบเบิกยังไง';
  const evidence = (await createLineAiInputEvidence({ turnKey: 'fx15-router', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
  for (const actionId of ['reimbursement_claim', 'invented_action']) {
    const calls: ProviderInput[] = [];
    const router = new IntentRouterAgent({ generateText: async input => {
      calls.push(input);
      return { ok: true, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1, howToActionId: actionId,
        decisionV1: { subrequests: [{ kind: 'help', goal: 'สร้างใบเบิก', sources: [{ part: 0, whole: true }], filters: {} }] } }) };
    } });
    const plan = await router.routeIntake({ requestId: 'fx15', companyId: 'company', userId: 'user', locale: 'th-TH', messageText: text,
      permissions: ['reimbursement.create'], enabledFeatures: [], inputEvidence: evidence, offeredToolNames: [] } as any);
    assert.equal(calls.length, 1, 'uses the existing intake call');
    assert.match(calls[0]!.systemPrompt!, /For ANY product action how-to/);
    assert.ok(calls[0]!.systemPrompt!.includes(JSON.stringify(LINE_CHAT_ACTIONS_CONTEXT.chatActions)));
    assert.equal(plan.howToActionId, actionId === 'reimbursement_claim' ? actionId : undefined);
    assert.equal(plan.semanticSubrequests?.[0]?.kind, 'help');
  }
});

it('Fix-up 17B: personal payout setup and its bank-detail continuation select the web entry without a purpose question', async () => {
  for (const text of ['เพิ่มบัญชีรับเงินคืนของฉันทำยังไง', 'ทำให้หน่อย ธนาคารกสิกรไทย เลขบัญชี 123-4-56789-0 ชื่อบัญชีเป็นชื่อฉันเอง']) {
    const evidence = (await createLineAiInputEvidence({ turnKey: 'fx17b-payout', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
    const router = new IntentRouterAgent({ generateText: async input => {
      assert.match(input.systemPrompt!, /payout_account with kind help/);
      assert.match(input.systemPrompt!, /never write bank details or ask their purpose first/);
      return { ok: true, text: JSON.stringify({ intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1, howToActionId: 'payout_account',
        decisionV1: { subrequests: [{ kind: 'help', goal: 'ตั้งบัญชีรับเงินคืนส่วนตัวบนเว็บ', sources: [{ part: 0, whole: true }], filters: {} }] } }) };
    } });
    const plan = await router.routeIntake({ requestId: 'fx17b-payout', companyId: 'company', userId: 'user', messageText: text, locale: 'th-TH', inputEvidence: evidence,
      contractCapabilities: ['input-evidence-v2'], permissions: ['reimbursement.create'] } as any);
    assert.equal(plan.howToActionId, 'payout_account'); assert.equal(plan.semanticSubrequests?.[0]?.kind, 'help');
    assert.equal(plan.clarifyQuestion, undefined);
  }
});

// Owner-approved credit levers: exercise the real payload builder, not a parallel serializer.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LINE_TOOL_REGISTRY, TIER_FEATURE_PRESETS, extractValueCandidatesV2,
  type LineIntakeRouteRequest, type LineAiConversationContext } from '@watchdog-bms/contracts';
import { v2RenderedInput } from '../../../common/usage/ai-budget-provider';
import { INTAKE_CONSTANT_CALIBRATIONS, intakeConstantParts, scaleIntakeCalibration, REVIEWED_CATALOGUE_TOKEN_BOUND } from '../../../common/usage/intake-token-calibration';
import { ROLE_GRANTS } from '../../../../../api/src/modules/auth/permission-registry';
import { APPROVED_PREPARED_FAMILY_KEYS } from './prepared-simple-read-formatter';
import { LINE_INTAKE_CHAT_ACTIONS_CONTEXT as LINE_CHAT_ACTIONS_CONTEXT, modelConversationContext } from './line-model-context';

const creditRoot = resolve(__dirname, '../../../../../..');
const creditModel = 'global.anthropic.claude-sonnet-4-6';
async function creditRequest(text = 'ค่าอาหาร'): Promise<LineIntakeRouteRequest> {
  const built = await createLineAiInputEvidence({ turnKey: 'credit-test', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1792397640000, rawText: text }] });
  assert.ok(built);
  return { requestId: 'credit-test', companyId: 'company-1', userId: 'user-1', locale: 'th', messageText: text,
    inputEvidence: built.inputEvidence, valueCandidates: await extractValueCandidatesV2(built.inputEvidence, '2026-10-19'),
    permissions: [...new Set(LINE_TOOL_REGISTRY.flatMap(t => [...(t.requiredPermissions ?? []), ...(t.anyOfPermissions ?? [])]))],
    enabledFeatures: [...TIER_FEATURE_PRESETS.STARTER_249], offeredToolNames: LINE_TOOL_REGISTRY.map(t => t.name),
    capabilities: { fusedPlan: true, substituteSemantic: true, reimbursementSemantic: true, advisor: true, responsePreference: true }, attachments: [] };
}
async function creditCapture(request: LineIntakeRouteRequest): Promise<ProviderInput> {
  let captured: ProviderInput | undefined;
  await new IntentRouterAgent({ generateText: async input => { captured = input;
    return { ok: false, error: { code: 'PROVIDER_DISABLED', message: 'offline', retryable: false } }; } }, true, {}, false, []).routeIntake(request);
  assert.ok(captured);
  return captured;
}

describe('owner-approved credit payload and estimator', () => {
  it('keeps the bounded intake voucher offer while the downstream action catalogue accepts 30 bills', async () => {
    const input = await creditCapture(await creditRequest());
    const offer = JSON.parse(input.cacheableContext!).enabledFeatures.find((feature: any) => feature.toolName === 'expense.action.preview');
    assert.match(offer.description, /expenseIds, at most 20/);
    assert.match(LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.action.preview')!.description, /expenseIds, at most 30/);
  });

  it('shares only byte-identical static catalogue across tenants and keeps authority fresh per turn', async () => {
    const a = await creditRequest();
    const first = await creditCapture(a);
    const second = await creditCapture({ ...await creditRequest('another turn'), companyId: 'other-company', userId: 'other-user', messageText: 'another turn',
      activeCategories: [{ id: 'private-category', name: 'ชื่อเฉพาะร้าน' }] });
    assert.equal(first.cacheableContext, second.cacheableContext);
    const prefix = JSON.parse(first.cacheableContext!);
    assert.deepEqual(prefix.chatActions, LINE_CHAT_ACTIONS_CONTEXT.chatActions);
    for (const key of ['companyId', 'userId', 'permissions', 'activeCategories', 'taskProjection', 'inputEvidenceParts', 'messageText']) {
      assert.equal(prefix[key], undefined, key);
    }
    assert.equal(first.cacheableContext!.includes('private-category'), false);
    const payload = JSON.parse(second.messages[0]!.text);
    assert.equal(payload.chatActions, undefined);
    assert.deepEqual(payload.permissions, a.permissions);
    assert.equal(payload.activeCategories[0].id, 'private-category');
    const restricted = await creditCapture({ ...a, permissions: [], offeredToolNames: [] });
    assert.notEqual(first.cacheableContext, restricted.cacheableContext, 'permission-filtered tool catalogue has its own content identity');
    assert.deepEqual(JSON.parse(restricted.cacheableContext!).chatActions, prefix.chatActions);
  });

  it('bounds unknown ASCII/hex/Thai/Unicode and native results by bytes, retains media adders, pins the model/prefix', async () => {
    const input = await creditCapture(await creditRequest());
    const bound = v2RenderedInput(input, creditModel).inputTokenBound;
    const audit = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence/line-ai-credit-levers-20261019-estimator-evidence.json'), 'utf8'));
    const recorded = audit.usageSummary.find((row: any) => row.model === creditModel && row.tag === 'line.intake-route');
    assert.equal(recorded.calls, 2059);
    assert.ok(audit.systemTokenBound >= audit.maxIsolatedSystemTokens);
    assert.ok(REVIEWED_CATALOGUE_TOKEN_BOUND >= audit.maxCatalogueTokens * (1 + audit.minimumCoreMarginPercent / 100));
    assert.ok(bound >= recorded.maxTotalInput, 'greater than every recorded eval intake, including cached tokens');
    assert.ok(bound <= 51_200, 'typical hold stays within eight baht at FX33 and unchanged output4096');
    const fallback = v2RenderedInput(input, 'apac.anthropic.claude-3-haiku-20240307-v1:0').inputTokenBound;
    assert.ok(fallback > bound, 'no tokenizer assumption transfers to another model');
    assert.ok(v2RenderedInput({ ...input, systemPrompt: input.systemPrompt + ' ' }, creditModel).inputTokenBound > bound);
    for (const text of ['a'.repeat(4000), '0123456789abcdef'.repeat(300), 'ก฿\u0e3a'.repeat(2000), '🙂漢字\u0301'.repeat(1000), JSON.stringify({ id: 'f'.repeat(64), text: '\\"\n' })]) {
      const testInput = { messages: [{ role: 'user' as const, text }] };
      assert.ok(v2RenderedInput(testInput, creditModel).inputTokenBound >= Buffer.byteLength(text) + 4096);
    }
    const image = v2RenderedInput({ ...input, images: [{ mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' }] }, creditModel).inputTokenBound;
    assert.ok(image >= bound + 1024);
    const unknownPdf = v2RenderedInput({ ...input, documents: [{ mimeType: 'application/pdf', contentBase64: 'bm90LXBkZg==' }] }, creditModel).inputTokenBound;
    assert.ok(unknownPdf > 160000);
    const toolsInput = { systemPrompt: 'schema', tools: [{ name: 'test', description: 'schema', inputSchema: { type: 'object' } }],
      messages: [{ role: 'tool_results' as const, results: [{ toolUseId: 'x', content: '🙂'.repeat(2000), isError: false }] }] };
    assert.ok(v2RenderedInput(toolsInput, creditModel).inputTokenBound >= 8000 + 4096);
  });

  it('trims ordinary history to four turns and three reads, retaining task/question history without verified retained evidence', () => {
    const context: LineAiConversationContext = { windowMinutes: 15, maxTurns: 15,
      recentTurns: Array.from({ length: 15 }, (_, n) => ({ at: `2026-10-19T08:${String(n).padStart(2, '0')}:00Z`, userMessagePreview: `ข้อความ ${n}`, userMessagePreviewComplete: true })),
      recentReads: Array.from({ length: 4 }, () => ({ tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-10-19T08:00:00Z' })) };
    assert.deepEqual(modelConversationContext(context)?.recentTurns, context.recentTurns.slice(-4));
    assert.equal(modelConversationContext(context)?.recentReads?.length, 3);
    const replays = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence/advisor-exam-d-router-replays.json'), 'utf8'));
    const j7 = replays.find((r: any) => r.id === 'J7#4');
    assert.deepEqual(modelConversationContext(context, j7.taskProjection)?.recentTurns, context.recentTurns);
    assert.deepEqual(modelConversationContext(context, undefined, false, true)?.recentTurns, context.recentTurns);
    assert.deepEqual(modelConversationContext(context, j7.taskProjection, true)?.recentTurns, context.recentTurns.slice(-4));
    assert.deepEqual(modelConversationContext(context, { ...j7.taskProjection, tasks: [...j7.taskProjection.tasks, ...j7.taskProjection.tasks] }, true)?.recentTurns, context.recentTurns, 'one retained source cannot cover another open task');
    assert.equal(context.recentTurns.length, 15, 'never mutates the source request');
  });

  it('renders every recorded router replay with its current text/evidence/task intact and bound above recorded real intake maximum', async () => {
    let count = 0;
    for (const file of readdirSync(resolve(creditRoot, 'docs/evidence')).filter(file => file.endsWith('router-replays.json'))) {
      const recorded = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence', file), 'utf8'));
      const rows: any[] = [];
      const collect = (value: any): void => {
        if (Array.isArray(value)) return value.forEach(collect);
        if (!value || typeof value !== 'object') return;
        const text = value.messageText ?? value.body?.events?.[0]?.message?.text;
        if (typeof text === 'string') rows.push({ ...value, messageText: text });
        else Object.values(value).forEach(collect);
      };
      collect(recorded);
      for (const replay of rows as any[]) {
        if (!replay.messageText) continue;
        const req = { ...await creditRequest(replay.messageText), ...(replay.taskProjection ? { taskProjection: replay.taskProjection } : {}),
          ...(replay.conversationContext ? { conversationContext: replay.conversationContext } : {}),
          ...(replay.openClarifications ? { openClarifications: replay.openClarifications } : {}) };
        const input = await creditCapture(req);
        const payload = JSON.parse(input.messages[0]!.text);
        assert.equal(payload.messageText, replay.messageText, `${file}:${replay.id}`);
        assert.equal(payload.inputEvidenceParts[0].rawText, replay.messageText);
        assert.deepEqual(payload.taskProjection, replay.taskProjection);
        assert.deepEqual(payload.openClarifications, replay.openClarifications);
        if (replay.taskProjection?.tasks.some((task: any) => !['completed', 'canceled', 'invalidated'].includes(task.state))) {
          assert.deepEqual(payload.conversationContext?.recentTurns, replay.conversationContext?.recentTurns);
        }
        assert.ok(v2RenderedInput(input, creditModel).inputTokenBound >= 33559);
        assert.equal(input.maxTokens, 4096, 'output ceiling is retained, including repair');
        count++;
      }
    }
    assert.ok(count > 100, `covered ${count} recorded payload shapes`);
  });
});

it('credit X2 J7: the claim amount/date, continuing question, current evidence and exact task reference survive old-history trimming', async () => {
  const journey = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence/mangmee-advisor-fx24-router-replays.json'), 'utf8')).J7.turns;
  const exam = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence/advisor-exam-d-router-replays.json'), 'utf8')).find((r: any) => r.id === 'J7#4');
  const priorText = journey.slice(0, -1).flatMap((r: any) => typeof r.body.events[0].message?.text === 'string' ? [r.body.events[0].message.text] : []);
  const history = [...Array.from({ length: 12 }, () => 'คำถามเก่าที่ไม่เกี่ยวข้อง'), ...priorText].map((userMessagePreview, n) => ({
    at: new Date(1792397000000 + n * 1000).toISOString(), userMessagePreview, userMessagePreviewComplete: true as const }));
  const input = await creditCapture({ ...await creditRequest(exam.messageText), taskProjection: exam.taskProjection,
    conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: history } });
  const payload = JSON.parse(input.messages[0]!.text);
  assert.ok(payload.conversationContext.recentTurns.some((r: any) => r.userMessagePreview === 'เบิกค่าน้ำมัน 350 บาท เมื่อวาน ให้หน่อย'));
  assert.equal(payload.taskProjection.tasks[0].userGoal, exam.taskProjection.tasks[0].userGoal);
  assert.deepEqual(payload.taskProjection.tasks[0].deliveredQuestionRefs, exam.taskProjection.tasks[0].deliveredQuestionRefs);
  assert.equal(payload.inputEvidenceParts[0].rawText, exam.messageText);
  assert.deepEqual(payload.resumableTaskRefs[0], exam.route.semanticSubrequests[0].taskRef);
  const ordinary = await creditCapture({ ...await creditRequest(exam.messageText),
    conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: history } });
  const trimmed = JSON.parse(ordinary.messages[0]!.text);
  assert.equal(trimmed.conversationContext.recentTurns.length, 4);
  assert.ok(trimmed.conversationContext.recentTurns.some((r: any) => r.userMessagePreview === priorText.at(-1)));
  assert.equal(trimmed.inputEvidenceParts[0].rawText, exam.messageText);
});


it('credit P1/P2: approved-v6 offers stay bounded with the calibrated constant digest for every deployed role/package', async () => {
  const expected = JSON.parse(readFileSync(resolve(creditRoot, 'docs/evidence/line-ai-credit-levers-20261019-role-reach.json'), 'utf8'));
  for (const row of expected.rows) {
    const req = { ...await creditRequest(), permissions: ROLE_GRANTS[row.role as keyof typeof ROLE_GRANTS],
      enabledFeatures: [...TIER_FEATURE_PRESETS[row.tier as keyof typeof TIER_FEATURE_PRESETS]],
      capabilities: { fusedPlan: true, substituteSemantic: true, reimbursementSemantic: true, advisor: true, responsePreference: true, approvedKnowledge: true } };
    let input: ProviderInput | undefined;
    await new IntentRouterAgent({ generateText: async captured => { input = captured; return { ok: false,
      error: { code: 'PROVIDER_DISABLED', message: 'offline', retryable: false } }; } }, true, { enabled: true }, false,
      [...APPROVED_PREPARED_FAMILY_KEYS]).routeIntake(req);
    assert.ok(input);
    const parts = intakeConstantParts(input);
    const entry = INTAKE_CONSTANT_CALIBRATIONS.find(entry => entry.digest === parts?.digest);
    assert.ok(entry, `Uncalibrated current intake constant digest ${parts?.digest}. Recalibrate: pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ../../scripts/recalibrate-line-intake.cjs ${INTAKE_CONSTANT_CALIBRATIONS[0].digest}; review character mix/semantic changes, update table and contract pins. Large changes or different models require paired live measurement.`);
    assert.equal(entry.bytes, parts!.bytes);
    // Historical role-reach evidence keeps its measured reservation; C72 has this reviewed constant digest.
    assert.equal(parts!.digest, '10a36aeb41e500cbac41dc6e4237b95ced82879366d6c2622e9fcbeab308f691');
    assert.equal(v2RenderedInput(input, creditModel).inputTokenBound, row.boundAfter);
    const offered = JSON.parse(input.messages[0]!.text).approvedKnowledge;
    assert.ok(offered.length <= 12 && Buffer.byteLength(JSON.stringify(offered)) <= 12 * 1024);
    assert.ok(row.boundAfter <= row.approvedV4BoundAfter, 'the ordinary intake sample stays below its prior v4 reservation');
    assert.ok(row.boundAfter < row.unboundedV6Bound, 'the full approved v6 catalogue never rides on this turn');
    assert.ok(row.holdAfterThb <= 9.13, `${row.tier}/${row.role}`);
    const changed = { ...input, systemPrompt: input.systemPrompt + ' ' };
    assert.equal(INTAKE_CONSTANT_CALIBRATIONS.some(entry => entry.digest === intakeConstantParts(changed)?.digest), false);
    assert.ok(v2RenderedInput(changed, creditModel).inputTokenBound > row.boundAfter, 'unreviewed constants safely retain bytes');
    const catalogue = JSON.parse(input.cacheableContext!);
    catalogue.enabledFeatures.push({ toolName: 'unknown', description: 'f'.repeat(5000) });
    assert.ok(v2RenderedInput({ ...input, cacheableContext: JSON.stringify(catalogue) }, creditModel).inputTokenBound >= row.boundAfter + 4096, 'unfamiliar catalogue text retains bytes');
  }
});

it('credit P2 recalibration scales upward, preserves the existing margin, and rejects large growth', () => {
  const old = INTAKE_CONSTANT_CALIBRATIONS[0];
  assert.equal(scaleIntakeCalibration(old, old.bytes - 100), old.tokenBound);
  const grown = old.bytes + 100;
  assert.ok(scaleIntakeCalibration(old, grown) / grown >= old.tokenBound / old.bytes);
  assert.throws(() => scaleIntakeCalibration(old, Math.ceil(old.bytes * 1.11)), /Live measurement required/);
});

it('Z2 claim submit uses reimbursement.submit without treating receipt or reason uploads as submission', async () => {
  const { lineActionRuleFor, lineActionBoundaryReplyText } = await import('../domain/logic/line-ai-scope-policy.logic');
  for (const text of ['ส่งใบเบิกนี้', 'ส่งอนุมัติใบเบิกนี้', 'ขอส่งอนุมัติใบเบิกที่เพิ่งบันทึก', 'ยื่นใบเบิกนี้']) {
    assert.equal(lineActionRuleFor(text)?.permission, 'reimbursement.submit');
    assert.equal(lineActionBoundaryReplyText(text, ['reimbursement.submit'], 'th'), undefined);
    assert.match(lineActionBoundaryReplyText(text, ['reimbursement.read_own'], 'th') ?? '', /สิทธิ์|ผู้ดูแล|เจ้าของ/);
  }
  for (const text of ['ส่งรูปใบเสร็จสำหรับใบเบิกนี้', 'ส่งเหตุผลใบเบิก', 'ใบเบิกส่งอนุมัติหรือยัง']) assert.equal(lineActionRuleFor(text), undefined);
});


it('R6 invalid router and QA outputs preserve repair', async () => {
  const accepted: boolean[] = [];
  const request = await creditRequest('สวัสดี');
  const valid = JSON.stringify({ intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.95,
    decisionV1: { subrequests: [] } });
  const router = new IntentRouterAgent({ generateText: async input => {
    const output = { ok: true as const, text: valid, completion: 'complete' as const };
    assert.equal(typeof input.acceptOutput, 'function');
    accepted.push(input.acceptOutput!({ ok: true, text: '{bad' }));
    accepted.push(input.acceptOutput!(output));
    return output;
  } }, true, {}, false, []);
  const result = await router.routeIntake(request);
  assert.deepEqual(accepted, [false, true]);
  assert.equal(result.status, 'ROUTED');
});

import { runSemanticTurnV2 } from './semantic-turn-v2';
import { extractValueCandidates, type LineAiTurnRequest, type ToolResult } from '@watchdog-bms/contracts';
const r6MESSAGE_TEXT = 'ขอดู confirmed เดือนนี้หน่อยค่ะ';
const r6TODAY = '2026-09-28';

const r6SOURCE_REF = {
  label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary',
  asOf: '2026-09-27T18:20:29.656Z', permissionChecked: true as const,
  webPath: '/companies/company/expenses',
};

/** The real tool result: `facts` carries ONLY the grand total (erp-tools.use-case.ts's own
 *  behavior) — everything else (count, per-item amounts/dates, the paid/unpaid split) lives only
 *  in `data`, which is exactly the gap C1(a)/(b) closes. */
function r6listRecentConfirmedResult(): ToolResult {
  return {
    toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T18:20:29.656Z',
    sourceRefs: [r6SOURCE_REF],
    queryApplied: {
      timezone: 'Asia/Bangkok', period: { startDate: '2026-09-01', endDate: '2026-09-28', timezone: 'Asia/Bangkok', defaulted: false },
      dateBasis: 'expense_incurred_date', statusBasis: 'CONFIRMED', dataset: 'operational_expense_records',
    },
    facts: [{
      id: 'expense.total.THB', metric: 'expense_total', value: '8703', unit: 'money', currency: 'THB',
      period: { startDate: '2026-09-01', endDate: '2026-09-28', timezone: 'Asia/Bangkok' },
      dateBasis: 'expense_incurred_date', statusBasis: 'CONFIRMED',
      sourceRefIds: ['expenses:expense_summary:summary'], asOf: '2026-09-27T18:20:29.656Z', state: 'known',
    }],
    data: {
      total: 8,
      period: { fromDate: '2026-09-01', toDate: '2026-09-28', defaultedToCurrentMonth: false },
      summary: {
        countedItems: 8, cancelledCount: 0, totalAmount: '8703', pendingAmount: '0', draftAmount: '0',
        confirmedAmount: '8703', paidAmount: '5255.5', unpaidAmount: '3447.5',
      },
      totalsByCurrency: [{ currency: 'THB', count: 8, totalAmount: '8703', paidAmount: '5255.5', outstandingAmount: '3447.5' }],
      items: [
        { id: 'e1', expenseDate: '2026-09-01T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '300.5' },
        { id: 'e2', expenseDate: '2026-09-02T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจการค้า', status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '437' },
        { id: 'e3', expenseDate: '2026-09-03T00:00:00.000Z', vendorNameSnapshot: 'ปั๊มน้ำมัน ปตท.', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotalAmount: '574' },
        { id: 'e4', expenseDate: '2026-09-06T00:00:00.000Z', vendorNameSnapshot: 'Grab', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotalAmount: '985' },
        { id: 'e5', expenseDate: '2026-09-07T00:00:00.000Z', vendorNameSnapshot: null, status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '1122' },
        { id: 'e6', expenseDate: '2026-09-08T00:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '1259' },
        { id: 'e7', expenseDate: '2026-09-13T00:00:00.000Z', vendorNameSnapshot: 'Grab', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotalAmount: '1944.5' },
        { id: 'e8', expenseDate: '2026-09-14T00:00:00.000Z', vendorNameSnapshot: null, status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', grandTotalAmount: '2081' },
      ],
    },
  };
}

function r6request(): LineAiTurnRequest {
  const valueCandidates = extractValueCandidates(r6MESSAGE_TEXT, r6TODAY);
  return {
    requestId: 'r6request-1', webhookEventId: 'event-1', messageText: r6MESSAGE_TEXT,
    messagePreviewHash: 'd'.repeat(16), valueCandidates,
    semanticSubrequests: [{
      index: 0, kind: 'read', goal: 'รายการค่าใช้จ่ายที่ยืนยันแล้วเดือนนี้', requiredEvidence: [], dependsOn: [], evidenceRefs: [],
      requestedFilters: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'CONFIRMED' },
    }],
    userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'membership',
      permissions: ['expense.read'], roles: ['owner'], branchIds: [], locationIds: [], locale: 'th-TH' },
  };
}

const r6CONTROL_CALL = JSON.stringify({
  calls: [{ index: 0, toolName: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-28', documentStatus: 'CONFIRMED' } }],
  // deliberately no "questions" key — see C2 test below
});

function r6answerEnvelope(text: string, opts: { status?: string; sourceRefIds?: string[] } = {}) {
  return JSON.stringify({ answers: [{ index: 0, status: opts.status ?? 'handled', text, sourceRefIds: opts.sourceRefIds ?? ['expenses:expense_summary:summary'] }] });
}


it('R6 planner and compose acceptance reuses shape, source and number grounding including prose', async () => {
  for (const [text, expected] of [
    [r6answerEnvelope('ยอดรวม 8,703 บาท'), true],
    [r6answerEnvelope('ยอดรวม 999,999 บาท'), false],
    [r6answerEnvelope('ยอดรวม 8,703 บาท', { sourceRefIds: ['invented'] }), false],
    ['ยอดรวม 8,703 บาท', true], ['ยอดรวม 999,999 บาท', false], ['{"answers":[]}', false],
  ] as const) {
    const checks: Array<[string | undefined, boolean]> = [];
    await runSemanticTurnV2({ req: r6request(), draftEditEnabled: false, reimbursementDraftEnabled: false,
      publicLookupEnabled: false, approvedKnowledgeEnabled: false,
      provider: { generateText: async input => {
        const output = { ok: true as const, text: input.usageTag === 'line.loop' ? r6CONTROL_CALL : text };
        assert.equal(typeof input.acceptOutput, 'function');
        checks.push([input.usageTag, input.acceptOutput!(output)]);
        return output;
      } }, invoke: async () => r6listRecentConfirmedResult() });
    assert.deepEqual(checks, [['line.loop', true], ['line.compose', expected]], text);
  }
});
