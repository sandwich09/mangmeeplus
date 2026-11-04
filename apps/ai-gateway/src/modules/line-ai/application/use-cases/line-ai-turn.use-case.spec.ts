import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineAiTurnUseCase } from './line-ai-turn.use-case';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2, AI_BUDGET_STEP_BOUNDS, LINE_AI_EXPENSE_CRITERION_REPLIES,
  aiBudgetInvocationKey, createLineAiInputEvidence, extractValueCandidates, parseAiBudgetEnvelope, type LineAiTurnRequest,
} from '@watchdog-bms/contracts';
import { runWithUsageContext } from '../../../../common/usage/usage-context';

const validReq: LineAiTurnRequest = {
  requestId: 'req-spec',
  webhookEventId: 'evt-spec',
  messageText: 'ดูสต็อกสินค้า',
  messagePreviewHash: 'abc',
  userContext: {
    lineUserId: 'line-1',
    internalUserId: 'user-1',
    companyId: 'company-1',
    membershipId: 'mem-1',
    permissions: ['inventory.product.read', 'inventory.report.read'],
    roles: ['owner'],
    branchIds: ['branch-1'],
    locationIds: ['location-1'],
    locale: 'th-TH',
  },
};

function makeErpTools(status: string = 'ok', data: unknown = { count: 2 }) {
  return {
    invoke: async (tool: any) => ({
      toolName: tool.name, status, data, sourceRefs: [], asOf: new Date().toISOString(),
    }),
  } as any;
}

function makeOrchestrator(replyText: string = 'orchestrator reply') {
  return {
    run: async () => ({
      plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
      outputs: [],
      replyText,
      sourceRefs: [],
      webLinks: [],
      durationMs: 5,
    }),
  } as any;
}

function makeAgentcoreRuntime(
  result: Partial<{ replyText: string; refused: boolean; plan: any; durationMs: number; sourceRefs: any[]; webLinks: any[]; toolsInvoked: any[]; presentation: any; refusalReason: any; errorCode: string; runtimeIdentity: any; expectedRuntimeIdentity: any; runtimeBinding: any; stageDurationsMs: any; modelCallCount: number }> | Error = {},
) {
  return {
    invoke: async () => {
      if (result instanceof Error) throw result;
      return {
        turnId: 'turn-1',
        replyText: result.replyText ?? 'agentcore reply',
        plan: result.plan ?? { status: 'ROUTABLE', intents: [] },
        durationMs: result.durationMs ?? 10,
        refused: result.refused ?? false,
        sourceRefs: result.sourceRefs ?? [],
        webLinks: result.webLinks ?? [],
        toolsInvoked: result.toolsInvoked ?? [],
        ...(result.presentation ? { presentation: result.presentation } : {}),
        ...(result.refusalReason ? { refusalReason: result.refusalReason } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.runtimeIdentity ? { runtimeIdentity: result.runtimeIdentity } : {}),
        ...(result.expectedRuntimeIdentity ? { expectedRuntimeIdentity: result.expectedRuntimeIdentity } : {}),
        ...(result.runtimeBinding ? { runtimeBinding: result.runtimeBinding } : {}),
        ...(result.stageDurationsMs ? { stageDurationsMs: result.stageDurationsMs } : {}),
        ...(result.modelCallCount !== undefined ? { modelCallCount: result.modelCallCount } : {}),
      };
    },
  } as any;
}

describe('LineAiTurnUseCase – feature flag routing', () => {
  it('rejects a valid v2 input when the receiver has no matching v2 budget state', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn-v2',
      parts: [{ partId: 'part-v2', eventIdHash: 'a'.repeat(64), acceptedAtMs: 100, rawText: 'ดูสต็อกสินค้า' }],
    });
    assert.ok(built);
    let orchestratorCalled = false;
    let runtimeCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const runtime = { invoke: async () => { runtimeCalled = true; return {} as any; } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, {
      lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local',
    } as any, runtime);
    const response = await useCase.execute({
      ...validReq,
      messageText: built.messageText,
      inputEvidence: built.inputEvidence,
      contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
      budgetGrantV2: {
        version: 2, turnKey: 'turn-v2', authorityKind: 'webhook_event', authorityId: 'event-v2',
        channelOwnerDigest: 'b'.repeat(64), attemptKey: 'attempt-v2', monthKey: '2026-09', payerCompanyId: 'company-1',
        model: { provider: 'bedrock', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', region: 'ap-southeast-1' },
        allowedProfileIds: ['line-intake-text/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
        maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: 100, workDeadlineAtMs: 10_000, finalDeadlineAtMs: 20_000,
        nonce: 'nonce-v2', issuerVersion: 'api-1', signature: 'c'.repeat(64),
      },
    });

    assert.equal(response.errorCode, 'AI_BUDGET_UNAVAILABLE');
    assert.equal(orchestratorCalled, false);
    assert.equal(runtimeCalled, false);
  });

  it('reports edit capability only when the serving S-4 catalog is enabled across both runtimes', async () => {
    let remoteCalls = 0;
    const runtime = {
      invoke: async () => ({}),
      lineDraftEditCapabilityEnabled: async () => { remoteCalls += 1; return true; },
    } as any;
    const capability = (config: Record<string, unknown>) => new LineAiTurnUseCase(
      makeErpTools(), makeOrchestrator(), config as any, runtime,
    ).lineDraftEditCapabilityEnabled();

    assert.equal(await capability({ lineAiDraftEditEnabled: true, lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' }), false,
      'deterministic mode has no S-4 tool catalog');
    assert.equal(await capability({ lineAiDraftEditEnabled: true, lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' }), true);
    // Owner 2026-09-29: draft edit is always on — a stale `false` no longer hides the S-4 catalog.
    assert.equal(await capability({ lineAiDraftEditEnabled: false, lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' }), true);
    assert.equal(await capability({ lineAiDraftEditEnabled: true, lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' }), true);
    assert.equal(remoteCalls, 1, 'only the separately served AgentCore mode is probed');
  });

  it('feature disabled uses item 07 deterministic path (not orchestrator)', async () => {
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(orchestratorCalled, false, 'orchestrator must not be called when flag is off');
    assert.equal(resp.requestId, validReq.requestId);
    assert.equal(resp.presentation?.kind, 'answer_cards');
    assert.ok((resp.presentation?.cards.length ?? 0) > 0);
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.3. The deterministic path classifies by keyword, and
  // its Thai list (บัญชี, ภาษี, เงินเดือน, งบดุล) is all in-system subjects — so "out of scope" was
  // the wrong sentence there before any router was involved.
  describe('deterministic path splits "not on LINE yet" from "out of scope"', () => {
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const ask = (intakeIntent?: any) => new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, makeAgentcoreRuntime())
      .execute({ ...validReq, messageText: 'ขอดูงบดุลหน่อย', ...(intakeIntent ? { intakeIntent } : {}) });

    it('says it is in the system and links to the web app when intake called it business', async () => {
      const resp = await ask('BUSINESS_READ_QUESTION');
      assert.equal(resp.refusalReason, 'unsupported_yet');
      assert.match(resp.replyText, /เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้/);
      assert.deepEqual(resp.webLinks, [{ label: 'เปิดรายการในเว็บ', path: '/companies/company-1/expenses' }]);
    });

    it('keeps the out-of-scope copy when no trusted intake provenance says business', async () => {
      for (const intake of [undefined, 'UNSUPPORTED']) {
        const resp = await ask(intake);
        assert.equal(resp.refusalReason, 'unsupported_module', String(intake));
        assert.match(resp.replyText, /นอกขอบเขตระบบ/, String(intake));
      }
    });
  });

  // Design lock context 2 on the direct tool read (the path that builds `answer_cards` itself).
  it('direct tool read: one successful open-work read carries its layout; a refused read is never "nothing found"', async () => {
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const req = { ...validReq, messageText: 'มีแจ้งเตือนอะไรบ้าง', userContext: { ...validReq.userContext, permissions: ['notification.read'] } };
    const asOf = '2026-09-17T10:00:00.000Z';
    const listRef = { label: 'รายการแจ้งเตือน', module: 'dashboard-notifications', entityType: 'notification_list', asOf, permissionChecked: true, webPath: '/companies/company-1/notifications' };
    const ask = (result: Record<string, unknown>) => new LineAiTurnUseCase(
      { invoke: async (tool: any) => ({ toolName: tool.name, asOf, ...result }) } as any, makeOrchestrator(), config, makeAgentcoreRuntime()).execute(req);

    const empty = await ask({ status: 'ok', data: { count: 0, hasMore: false, opens: 'list', items: [] }, sourceRefs: [listRef] });
    assert.deepEqual(empty.toolsInvoked, ['notifications.list_open_alerts']);
    assert.equal(empty.presentation?.cards[0]?.text, empty.replyText);
    assert.deepEqual(empty.presentation?.cards[0]?.layout, {
      context: 'open_work', header: ['การแจ้งเตือน', 'ไม่พบรายการ'], rows: [{ label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }],
      notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'ดูแจ้งเตือนในเว็บ',
    });
    assert.deepEqual(empty.presentation?.cards[0]?.webLink, { label: 'รายการแจ้งเตือน', path: '/companies/company-1/notifications' });

    const claim = await ask({ status: 'ok', sourceRefs: [{ ...listRef, label: 'อนุมัติเบิกจ่าย: RB-202608-00002', entityType: 'notification_event', entityId: 'n1', webPath: '/companies/company-1/reimbursements/rb-1' }],
      data: { count: 1, hasMore: false, opens: 'claim', items: [{ id: 'n1', title: 'อนุมัติเบิกจ่าย: RB-202608-00002', kind: 'claim_approval', documentNo: 'RB-202608-00002' }] } });
    assert.deepEqual(claim.presentation?.cards[0]?.layout?.header, ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ']);
    assert.equal(claim.presentation?.cards[0]?.layout?.linkLabel, 'เปิดใบเบิกเพื่ออนุมัติ');
    assert.equal(claim.presentation?.cards[0]?.webLink?.path, '/companies/company-1/reimbursements/rb-1');

    // Refused or failed: no card, no rows, and never the words of an empty result.
    for (const failed of [{ status: 'forbidden', sourceRefs: [] }, { status: 'unavailable', sourceRefs: [] }, { status: 'error', sourceRefs: [] }]) {
      const response = await ask(failed);
      assert.equal(response.presentation, undefined, String(failed.status));
      assert.doesNotMatch(response.replyText, /ไม่พบรายการ|0 รายการ/, String(failed.status));
    }
    // A successful read this card cannot verify stays a sentence card.
    const malformed = await ask({ status: 'ok', data: { items: [] }, sourceRefs: [listRef] });
    assert.equal(malformed.presentation?.cards[0]?.layout, undefined);
  });

  it('deterministic fallback preserves scalar zero as a successful answer card', async () => {
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools('ok', 0), makeOrchestrator(), config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.equal(resp.presentation?.kind, 'answer_cards');
    assert.ok(resp.presentation?.cards.some((card) => /0/.test(card.text)));
  });

  it('deterministic path confirms the fixed expense basis without an ERP read, with or without delivered proof', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => {
      calls.push(tool.name);
      return { toolName: tool.name, status: 'ok', data: { total: 123 }, sourceRefs: [], asOf: new Date().toISOString() };
    } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const messageText = 'ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกใช่ไหม';
    const userContext = { ...validReq.userContext, permissions: [...validReq.userContext.permissions, 'expense.read'] };
    const general = await useCase.execute({ ...validReq, messageText, userContext });
    const delivered = await useCase.execute({ ...validReq, messageText: 'เอาแบบไม่รวมยอดยกเลิกและปฏิเสธ', userContext,
      conversationContext: { windowMinutes: 15, maxTurns: 5, recentTurns: [], deliveredExpenseSummary: {
        version: 1, deliveredAt: new Date().toISOString(), statusBasis: 'exclude_rejected_voided',
        ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: null }],
      } } });

    assert.deepEqual(calls, []);
    assert.equal(general.replyText, LINE_AI_EXPENSE_CRITERION_REPLIES.generalTh);
    assert.equal(general.deterministicExpenseCriterionConfirmation, true);
    assert.equal(delivered.replyText, LINE_AI_EXPENSE_CRITERION_REPLIES.deliveredTh);
    assert.equal(delivered.deterministicExpenseCriterionConfirmation, true);
    assert.deepEqual(general.toolsInvoked, []);
    assert.equal(general.presentation, undefined);
  });

  it('deterministic path does not issue a read-free expense answer without expense permission', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => { calls.push(tool.name); return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [] }; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const response = await useCase.execute({ ...validReq, messageText: 'ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกและปฏิเสธใช่ไหม' });
    assert.deepEqual(calls, []);
    assert.equal(response.refused, true);
    assert.equal(response.refusalReason, 'forbidden');
    assert.equal(response.deterministicExpenseCriterionConfirmation, undefined);
  });

  it('deterministic path clarifies a misspelled expense status instead of reading the default total', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => { calls.push(tool.name); return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [] }; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const req = { ...validReq, messageText: 'ค่าใช้จ่ายไม่รวมปฎิเสธ', userContext: {
      ...validReq.userContext, permissions: [...validReq.userContext.permissions, 'expense.read'],
    } };
    const response = await useCase.execute(req);
    assert.deepEqual(calls, []);
    assert.match(response.replyText, /ยังระบุเงื่อนไขรายการค่าใช้จ่าย/);
    assert.equal(response.deterministicExpenseSummary, undefined);
  });

  it('deterministic path fails closed on expense periods and inherited branch follow-ups without calling defaults', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => { calls.push(tool.name); return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [] }; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const userContext = { ...validReq.userContext, permissions: [...validReq.userContext.permissions, 'expense.read'] };
    const explicitPeriod = await useCase.execute({ ...validReq, messageText: 'ค่าใช้จ่ายเดือนกรกฎาคม 2569 เท่าไร', userContext });
    const inheritedBranch = await useCase.execute({ ...validReq, messageText: 'ดูเฉพาะสาขา A', userContext,
      conversationContext: { windowMinutes: 15, maxTurns: 5, recentTurns: [], deliveredExpenseSummary: {
        version: 1, deliveredAt: new Date().toISOString(), statusBasis: 'exclude_rejected_voided',
        ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'branch-a' }],
      } } });
    assert.deepEqual(calls, []);
    assert.equal(explicitPeriod.refusalReason, 'unsupported_yet');
    assert.equal(inheritedBranch.refusalReason, 'unsupported_yet');
    assert.match(inheritedBranch.replyText, /ช่วงค่าใช้จ่ายที่ติดตามไว้/);
  });

  it('deterministic path keeps the safe current-month expense summary on its permission-checked tool', async (t) => {
    // Mid-month "now": on the 1st the current-month range is a single day and prints as one date.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T05:00:00.000Z') });
    const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const month = Number(today.slice(5, 7));
    const fromDate = `${today.slice(0, 7)}-01`;
    const toDate = today;
    const erpTools = { invoke: async (tool: any, _ctx: unknown, input: Record<string, unknown> = {}) => {
      calls.push({ tool: tool.name, input });
      return { toolName: tool.name, status: 'ok', data: {
        total: 1, period: { fromDate, toDate, defaultedToCurrentMonth: true },
        summary: { totalAmount: '123.00', countedItems: 1, cancelledCount: 0 }, items: [],
      }, sourceRefs: [{ label: 'ค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true }], asOf: new Date().toISOString() };
    } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const req = { ...validReq, messageText: 'ดูค่าใช้จ่าย', userContext: {
      ...validReq.userContext, permissions: [...validReq.userContext.permissions, 'expense.read'],
    } };
    const response = await useCase.execute(req);
    assert.deepEqual(calls, [{ tool: 'expense.list_recent', input: {} }]);
    assert.equal(response.deterministicExpenseSummary, true);
    assert.match(response.replyText, /123\.00/);
    assert.match(response.replyText, /ช่วง: 1 /);
    assert.match(response.replyText, new RegExp(`– ${Number(today.slice(-2))} `));
    // Design lock context 1 on the direct tool read: the card of the very sentence that is sent.
    assert.equal(response.presentation?.cards[0]?.text, response.replyText);
    assert.deepEqual(response.presentation?.cards[0]?.layout?.header, ['สรุปค่าใช้จ่าย', 'กันยายน 2569']);
    assert.deepEqual(response.presentation?.cards[0]?.layout?.rows.slice(0, 2),
      [{ label: 'ยอดรวม', value: '123.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '1 รายการ' }]);

    const explicitCurrent = await useCase.execute({ ...req, messageText: 'ค่าใช้จ่ายเดือนนี้เท่าไร',
      valueCandidates: { amounts: [], dates: [], periods: [{ span: 'Current month', kind: 'month', fromDate, toDate,
        monthKey: today.slice(0, 7), source: 'explicit', label: 'เดือนนี้', assumptions: [] }] } as any,
    });
    assert.equal(calls.length, 2);
    assert.equal(explicitCurrent.deterministicExpenseSummary, true);

    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const currentMonthIndex = month! - 1;
    const previousMonthIndex = (currentMonthIndex + 11) % 12;
    const incompleteMultiMonth = await useCase.execute({ ...req,
      messageText: `ดูค่าใช้จ่ายเดือน${thaiMonths[previousMonthIndex]}และ${thaiMonths[currentMonthIndex]} 2569`,
      valueCandidates: { amounts: [], dates: [], periods: [{ span: 'Current month', kind: 'month', fromDate, toDate,
        monthKey: today.slice(0, 7), source: 'explicit', label: thaiMonths[currentMonthIndex]!, assumptions: [] }] } as any,
    });
    assert.equal(calls.length, 2, 'a model/extractor omission must not turn a two-month ask into a one-month read');
    assert.equal(incompleteMultiMonth.deterministicExpenseSummary, undefined);
    assert.equal(incompleteMultiMonth.refusalReason, 'unsupported_yet');
  });

  it('deterministic path never turns an expense record status question into a current-month total', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => { calls.push(tool.name); return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [] }; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    const response = await useCase.execute({ ...validReq, messageText: 'ค่าใช้จ่ายเลขที่ EXP-123 สถานะอะไร', userContext: {
      ...validReq.userContext, permissions: [...validReq.userContext.permissions, 'expense.read'],
    } });
    assert.deepEqual(calls, []);
    assert.equal(response.refusalReason, 'unsupported_yet');
    assert.equal(response.deterministicExpenseSummary, undefined);
    assert.match(response.replyText, /รายละเอียดค่าใช้จ่าย/);
  });

  it('deterministic path does not hijack mixed sales or tax questions into an expense-only summary', async () => {
    const calls: string[] = [];
    const erpTools = { invoke: async (tool: any) => { calls.push(tool.name); return { toolName: tool.name, status: 'ok', data: {}, sourceRefs: [] }; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());
    for (const messageText of ['สรุปค่าใช้จ่ายและยอดขาย', 'ภาษีค่าใช้จ่ายเดือนนี้เท่าไร',
      'ยอดขายไม่รวมยกเลิกใช่ไหม', 'ยอดขายและค่าใช้จ่ายไม่รวมยกเลิกใช่ไหม']) {
      const response = await useCase.execute({ ...validReq, messageText });
      assert.equal(response.deterministicExpenseSummary, undefined, messageText);
      assert.equal(response.deterministicExpenseCriterionConfirmation, undefined, messageText);
    }
    assert.equal(calls.includes('expense.list_recent'), false);
  });

  it('feature enabled routes to local orchestrator (strands-local) and uses its reply', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator('สวัสดีจาก orchestrator'), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.replyText, 'สวัสดีจาก orchestrator');
  });

  it('passes local orchestrator presentation through unchanged', async () => {
    const presentation = { kind: 'answer_cards', cards: [{ text: 'สวัสดีจาก card' }] };
    const orchestrator = makeOrchestrator('สวัสดีจาก orchestrator');
    orchestrator.run = async () => ({ ...(await makeOrchestrator().run()), presentation });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    assert.deepEqual((await useCase.execute(validReq)).presentation, presentation);
  });

  it('feature enabled – UNROUTABLE plan sets refused=true', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = {
      run: async () => ({
        plan: { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: 'ชำระเงิน', reason: 'mutation_blocked' }], requiresHumanReview: false },
        outputs: [], replyText: '⚠️ ไม่สามารถดำเนินการ', sourceRefs: [], webLinks: [], durationMs: 1,
      }),
    } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const resp = await useCase.execute({ ...validReq, messageText: 'ชำระเงิน' });
    assert.equal(resp.refused, true);
    assert.equal(resp.refusalReason, 'mutation_blocked');
  });

  it('validation failure returns forbidden before reaching orchestrator', async () => {
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute({ ...validReq, requestId: '' });
    assert.equal(orchestratorCalled, false, 'orchestrator must not run on invalid request');
    assert.equal(resp.refused, true);
  });

  it('orchestrator error produces safe error reply (no stack traces)', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw new Error('Bedrock error details'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.ok(!resp.replyText.includes('Bedrock'), 'provider error details must not appear in LINE reply');
  });
});

describe('LineAiTurnUseCase – agentcore runtime routing', () => {
  it('forwards validated month candidates to AgentCore without changing the user text', async () => {
    const text = 'สรุปค่าใช้จ่ายเดือนกรกฏาคม และ สิงหาคม';
    const candidates = extractValueCandidates(text, '2026-09-25');
    let invoked: any;
    const runtime = {
      invoke: async (input: any) => {
        invoked = input;
        return { turnId: 't', replyText: 'ok', plan: { status: 'ROUTABLE', intents: [] },
          durationMs: 1, refused: false, sourceRefs: [], webLinks: [], toolsInvoked: [] };
      },
    } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(),
      { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any, runtime);
    await useCase.execute({ ...validReq, messageText: text, valueCandidates: candidates });
    assert.equal(invoked.messageText, text);
    assert.deepEqual(invoked.valueCandidates, candidates);
  });
  it('routes to AgentCore adapter when LINE_AI_AGENT_RUNTIME=agentcore', async () => {
    let agentcoreCalled = false;
    let invokeInput: any;
    const agentcoreRuntime = {
      invoke: async (input: any) => {
        agentcoreCalled = true;
        invokeInput = input;
        return {
          turnId: 'turn-1',
          replyText: 'reply from agentcore',
          plan: { status: 'ROUTABLE', intents: [] },
          durationMs: 20,
          refused: false,
          sourceRefs: [],
          webLinks: [],
          toolsInvoked: [],
        };
      },
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, agentcoreRuntime);

    const resp = await useCase.execute({
      ...validReq,
      userContext: {
        ...validReq.userContext,
        entitlementDeniedPermissions: { 'inventory.report.read': 'inventory' },
        entitledFeatureKeys: ['product_catalog'],
      },
    });
    assert.equal(agentcoreCalled, true, 'AgentCore adapter must be called');
    assert.equal(orchestratorCalled, false, 'local orchestrator must not be called');
    assert.equal(resp.replyText, 'reply from agentcore');
    assert.equal(resp.refused, false);
    assert.deepEqual(
      {
        membershipId: invokeInput.membershipId,
        branchIds: invokeInput.branchIds,
        locationIds: invokeInput.locationIds,
        roles: invokeInput.roles,
      },
      { membershipId: 'mem-1', branchIds: ['branch-1'], locationIds: ['location-1'], roles: ['owner'] },
    );
    assert.deepEqual(resp.toolsInvoked, []);
    assert.deepEqual(invokeInput.entitlementDeniedPermissions, { 'inventory.report.read': 'inventory' });
    assert.deepEqual(invokeInput.entitledFeatureKeys, ['product_catalog']);
  });

  it('forwards company feature entitlements to the AgentCore runtime', async () => {
    let invokeInput: any;
    const agentcoreRuntime = {
      invoke: async (input: any) => {
        invokeInput = input;
        return { turnId: 't-1', replyText: 'ok', plan: { status: 'ROUTABLE', intents: [] }, durationMs: 1, refused: false, sourceRefs: [], webLinks: [], toolsInvoked: [] };
      },
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    await useCase.execute({ ...validReq, entitledFeatureKeys: ['crm', 'expenses'] });
    assert.deepEqual(invokeInput.entitledFeatureKeys, ['crm', 'expenses']);

    await useCase.execute(validReq);
    assert.equal(invokeInput.entitledFeatureKeys, undefined, 'absent stays absent — legacy fail-open');
  });

  it('maps runtime tool and source lineage onto the turn response', async () => {
    const sourceRef = { label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'product', permissionChecked: true as const };
    const webLink = { label: 'สินค้าใกล้หมด', path: '/inventory/low-stock' };
    const agentcoreRuntime = makeAgentcoreRuntime({
      sourceRefs: [sourceRef],
      webLinks: [webLink],
      toolsInvoked: [{ name: 'inventory.list_low_stock', status: 'ok', durationMs: 4 }],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolsInvoked, ['inventory.list_low_stock']);
    assert.deepEqual(resp.sourceRefs, [sourceRef]);
    assert.deepEqual(resp.sourceLabels, ['สินค้าใกล้หมด']);
    assert.deepEqual(resp.webLinks, [webLink]);
  });

  it('passes AgentCore presentation through unchanged', async () => {
    const presentation = { kind: 'answer_cards', cards: [{ text: 'สต็อก 2 รายการ' }] };
    const agentcoreRuntime = makeAgentcoreRuntime({ presentation });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);
    assert.deepEqual((await useCase.execute(validReq)).presentation, presentation);
  });

  it('AgentCore UNROUTABLE result sets refused=true', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({ refused: true, refusalReason: 'mutation_blocked', plan: { status: 'UNROUTABLE', intents: [] }, replyText: '⚠️ ไม่รองรับ' });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.equal(resp.refusalReason, 'mutation_blocked');
  });

  it('passes hosted runtime identity, binding, stage timings, and model-call count to the API', async () => {
    const evidence = {
      runtimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), serviceVersion: 'candidate-a', contractVersion: 1 },
      expectedRuntimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), contractVersion: 1 },
      runtimeBinding: { runtimeArnHash: 'c'.repeat(16), qualifier: 'candidate-1' },
      stageDurationsMs: { orchestrationMs: 10, runtimeTotalMs: 12, agentcoreHttpMs: 20 },
      modelCallCount: 1,
    };
    const useCase = new LineAiTurnUseCase(
      makeErpTools(), makeOrchestrator(),
      { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any,
      makeAgentcoreRuntime(evidence),
    );
    const response = await useCase.execute(validReq);
    assert.deepEqual(response.runtimeIdentity, evidence.runtimeIdentity);
    assert.deepEqual(response.expectedRuntimeIdentity, evidence.expectedRuntimeIdentity);
    assert.deepEqual(response.runtimeBinding, evidence.runtimeBinding);
    assert.deepEqual(response.stageDurationsMs, evidence.stageDurationsMs);
    assert.equal(response.modelCallCount, 1);
  });

  it('AgentCore invoke error produces safe reply without leaking error details', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(Object.assign(new Error('runtime ARN 403 forbidden'), { code: 'INVOKE_ERROR' }));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.ok(!resp.replyText.includes('403'), 'error details must not appear in LINE reply');
    assert.ok(!resp.replyText.includes('forbidden'), 'error details must not appear in LINE reply');
  });
});

// ── M-02: real per-tool records + provider-failure trace ─────────────────────

/** Capture what the use case sends to its Nest logger (wired to pino in main.ts). */
function captureLogs(useCase: LineAiTurnUseCase): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const push = (entry: unknown) => { events.push(entry as Record<string, unknown>); };
  (useCase as unknown as { logger: unknown }).logger = { log: push, warn: push, error: push };
  return events;
}

describe('LineAiTurnUseCase – per-tool records (M-02)', () => {
  it('deterministic path builds toolCalls from the measured ToolResults', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'ok', data: { count: 2 }, sourceRefs: [], asOf: new Date().toISOString(), durationMs: 7,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.ok((resp.toolCalls?.length ?? 0) > 0, 'deterministic path must report per-tool calls');
    assert.deepEqual(resp.toolCalls?.map((t) => t.name), resp.toolsInvoked, 'toolCalls must match toolsInvoked names');
    assert.ok(resp.toolCalls?.every((t) => t.status === 'ok' && t.durationMs === 7), 'measured per-tool duration must be used, not the turn duration');
  });

  it('deterministic path carries the per-tool errorCode and falls back to 0 when unmeasured', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'TOOL_TIMEOUT',
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.ok(resp.toolCalls?.every((t) => t.status === 'error' && t.errorCode === 'TOOL_TIMEOUT' && t.durationMs === 0));
  });

  it('local orchestrator path flattens specialist toolCalls onto the response', async () => {
    const toolCalls = [
      { name: 'inventory.list_low_stock', status: 'ok' as const, durationMs: 11 },
      { name: 'ledger.get_financial_summary', status: 'forbidden' as const, durationMs: 3 },
    ];
    const orchestrator = {
      run: async () => ({
        plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
        outputs: [{ toolCalls: [toolCalls[0]] }, { toolCalls: [toolCalls[1]] }],
        replyText: 'ok', sourceRefs: [], webLinks: [], durationMs: 5,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, toolCalls);
    assert.deepEqual(resp.toolsInvoked, toolCalls.map((t) => t.name));
  });

  it('AgentCore path passes real per-tool outcomes through, bounded to contract fields', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({
      toolsInvoked: [
        { name: 'inventory.list_low_stock', status: 'ok', durationMs: 4, sourceRefs: [{ label: 'leak', module: 'inventory', entityType: 'x', permissionChecked: true }] },
        { name: 'ledger.get_financial_summary', status: 'error', durationMs: 9, errorCode: 'HTTP_503' },
      ],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, [
      { name: 'inventory.list_low_stock', status: 'ok', durationMs: 4 },
      { name: 'ledger.get_financial_summary', status: 'error', durationMs: 9, errorCode: 'HTTP_503' },
    ]);
  });

  it('AgentCore version skew cannot poison the per-tool rows the API persists', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({
      toolsInvoked: [
        // A skewed artifact can send anything; durationMs feeds an Int column and errorCode a String one.
        { name: 'inventory.list_low_stock', status: 'ok', durationMs: '4ms', errorCode: { code: 503 } },
        { name: 'ledger.get_financial_summary', status: 'error', durationMs: Number.NaN },
        { name: 42, status: 'ok', durationMs: 5 },
        null,
      ],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, [
      { name: 'inventory.list_low_stock', status: 'ok', durationMs: 0 },
      { name: 'ledger.get_financial_summary', status: 'error', durationMs: 0 },
    ], 'unusable durations become 0 and non-string errorCodes are dropped');
    assert.deepEqual(resp.toolsInvoked, ['inventory.list_low_stock', 'ledger.get_financial_summary'],
      'entries without a string name are dropped from both fields');
  });
});

describe('LineAiTurnUseCase – provider failure trace (M-02)', () => {
  it('AgentCore failure sets the provider error code on the refused response and emits ai.provider.failure', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(Object.assign(new Error('bedrock throttled'), { code: 'PROVIDER_THROTTLED' }));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);
    const events = captureLogs(useCase);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.equal(resp.errorCode, 'PROVIDER_THROTTLED');
    const failure = events.find((e) => e['msg'] === 'ai.provider.failure');
    assert.ok(failure, 'ai.provider.failure must be emitted');
    assert.equal(failure['requestId'], validReq.requestId);
    assert.equal(failure['code'], 'PROVIDER_THROTTLED');
    assert.equal(failure['path'], 'agentcore');
  });

  it('AgentCore failure without a typed code falls back to AGENTCORE_INVOKE_FAILED', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(new Error('socket hang up'));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'AGENTCORE_INVOKE_FAILED');
  });

  it('AgentCore timeout retains the signed expected identity without claiming an actual artifact', async () => {
    const expectedRuntimeIdentity = {
      sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), contractVersion: 1,
    };
    const error = Object.assign(new Error('timeout'), {
      code: 'TIMEOUT', expectedRuntimeIdentity,
      runtimeBinding: { runtimeArnHash: 'c'.repeat(16), qualifier: 'candidate-1' },
      stageDurationsMs: { agentcoreHttpMs: 20000 },
    });
    const useCase = new LineAiTurnUseCase(
      makeErpTools(), makeOrchestrator(),
      { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any,
      makeAgentcoreRuntime(error),
    );
    const response = await useCase.execute(validReq);
    assert.equal(response.errorCode, 'TIMEOUT');
    assert.deepEqual(response.expectedRuntimeIdentity, expectedRuntimeIdentity);
    assert.equal(response.runtimeIdentity, undefined);
  });

  it('orchestrator failure sets ORCHESTRATOR_FAILED and emits ai.provider.failure with path=orchestrator', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw new Error('Bedrock error details'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const events = captureLogs(useCase);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'ORCHESTRATOR_FAILED');
    const failure = events.find((e) => e['msg'] === 'ai.provider.failure');
    assert.ok(failure);
    assert.equal(failure['requestId'], validReq.requestId);
    assert.equal(failure['path'], 'orchestrator');
    assert.ok(!('messageText' in failure), 'provider failure events must not carry message text');
  });

  it('orchestrator ProviderError code is preserved on the refused response', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' }); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'PROVIDER_TIMEOUT');
  });
});

describe('LineAiTurnUseCase – coverage passthrough (item 10F)', () => {
  it('maps orchestrator coverage verdicts onto the turn response', async () => {
    const coverage = [
      { request: 'ยอดขายวันนี้', verdict: 'covered' as const },
      { request: 'ของใกล้หมด', verdict: 'uncovered' as const, reason: 'budget' },
    ];
    const orchestrator = {
      run: async () => ({
        plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
        outputs: [], replyText: 'ok', sourceRefs: [], webLinks: [], durationMs: 5, coverage,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.coverage, coverage);
  });

  it('omits coverage when the orchestrator has none (10B paths unchanged)', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator('x'), config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.equal(resp.coverage, undefined);
  });
});

// UAT 2026-08-15: the ERP tool boundary now refuses a tool whose owning company feature is off.
// Without a reply of its own, that refusal fell through to "📭 ไม่พบข้อมูลที่ตรงกันค่ะ", which tells
// the user their business has no data when the truth is the feature was never switched on.
describe('LineAiTurnUseCase – company feature switched off', () => {
  const useCaseReturning = (result: Record<string, unknown>) => new LineAiTurnUseCase(
    { invoke: async (tool: any) => ({ toolName: tool.name, sourceRefs: [], asOf: new Date().toISOString(), ...result }) } as any,
    makeOrchestrator(),
    { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any,
    makeAgentcoreRuntime(),
  );

  it('offers the main menu for unavailable work without blaming permissions', async () => {
    const resp = await useCaseReturning({ status: 'unsupported_module', errorCode: 'FEATURE_NOT_ENABLED' }).execute(validReq);

    assert.equal(resp.refused, true);
    assert.match(resp.replyText, /งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ/);
    assert.equal(resp.replyText.includes('ไม่พบข้อมูล'), false, 'a disabled feature is not an empty result');
    assert.equal(resp.replyText.includes('ไม่มีสิทธิ์'), false, 'a disabled feature is not a permission problem');
    // The refusal must not disclose anything beyond what this user asked about.
    assert.equal(/[a-z_]+_documents|crm|thai_tax/.test(resp.replyText), false, 'no internal feature key leaks');
  });

  it('still reports a genuine permission denial as a permission denial', async () => {
    const resp = await useCaseReturning({ status: 'forbidden', errorCode: 'ERP_PERMISSION_DENIED' }).execute(validReq);
    assert.equal(resp.refused, true);
    assert.match(resp.replyText, /ไม่มีสิทธิ์/);
  });
});

/**
 * Spec §12.6 / ADR 0013 §6: a runtime that cannot honour an invocation envelope must REFUSE SPLIT
 * traffic. The AgentCore artifact runs the model in its own process — it cannot budget-step before
 * a call, and its usage arrives only after every call is already paid for.
 */
describe('LineAiTurnUseCase – a runtime that cannot honour the envelope refuses SPLIT traffic', () => {
  const envelope = parseAiBudgetEnvelope({
    attemptKey: 'line-text:def',
    stepKind: 'line-turn',
    invocationKey: aiBudgetInvocationKey('company-1', 'line-text:def', 'line-turn', 0),
    bucket: 'CHAT',
    monthKey: '2026-09',
    modelId: 'test-model',
    bounds: { ...AI_BUDGET_STEP_BOUNDS['line-turn'] },
    maxCalls: AI_BUDGET_STEP_BOUNDS['line-turn'].maxCalls,
  }, 'company-1')!;

  const agentcoreConfig = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;

  it('never invokes AgentCore under an envelope, and says the budget could not be checked', async () => {
    let invoked = false;
    const runtime = { invoke: async () => { invoked = true; throw new Error('must not run'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), agentcoreConfig, runtime);

    const result = await runWithUsageContext(
      { companyId: 'company-1', budget: { status: 'active', envelope, sourceRoute: 'line-turn', calls: 0 } },
      () => useCase.execute(validReq),
    );

    assert.equal(invoked, false, 'a SPLIT turn must never reach an unreserved runtime');
    assert.equal(result.refused, true);
    assert.equal(result.errorCode, 'AI_BUDGET_UNAVAILABLE');
    // Honest copy: the meter could not be READ — never "full", never "something broke" (§9.1).
    assert.match(result.replyText, /ยังตรวจสอบเครดิต AI ของร้านไม่ได้/);
    assert.doesNotMatch(result.replyText, /เกิดข้อผิดพลาดชั่วคราว/);
  });

  it('refuses an envelope that did not validate for the same reason', async () => {
    let invoked = false;
    const runtime = { invoke: async () => { invoked = true; throw new Error('must not run'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), agentcoreConfig, runtime);

    const result = await runWithUsageContext(
      { companyId: 'company-1', budget: { status: 'invalid' } },
      () => useCase.execute(validReq),
    );

    assert.equal(invoked, false);
    assert.equal(result.errorCode, 'AI_BUDGET_UNAVAILABLE');
  });

  it('still routes to AgentCore for a request with no envelope — every company today', async () => {
    let invoked = false;
    const runtime = makeAgentcoreRuntime({ replyText: 'reply from agentcore' });
    const wrapped = { invoke: async (...args: unknown[]) => { invoked = true; return (runtime as any).invoke(...args); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), agentcoreConfig, wrapped);

    const result = await runWithUsageContext({ companyId: 'company-1' }, () => useCase.execute(validReq));

    assert.equal(invoked, true);
    assert.equal(result.replyText, 'reply from agentcore');
    assert.equal(result.errorCode, undefined);
  });
});


it('both old and new customer menu names still read the dashboard and answer หน้าแรก', async () => {
  for (const name of ['แดชบอร์ด', 'หน้าแรก']) {
    const calls: string[] = [];
    const tools = { invoke: async (tool: any) => {
      calls.push(tool.name);
      return { toolName: tool.name, status: 'ok', data: { widgets: [] }, sourceRefs: [], asOf: '2026-10-13' };
    } } as any;
    const useCase = new LineAiTurnUseCase(tools, makeOrchestrator(),
      { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any, makeAgentcoreRuntime());
    const response = await useCase.execute({ ...validReq, messageText: `ดู${name}หน่อย`,
      userContext: { ...validReq.userContext, permissions: ['dashboard.read'] } });
    assert.equal(response.refused, false);
    assert.ok(calls.includes('dashboard.get_business_health_summary'));
    assert.match(response.replyText, /📊 หน้าแรก \(0 ตัวชี้วัด\)/);
    assert.doesNotMatch(response.replyText, /แดชบอร์ด/);
  }
});
