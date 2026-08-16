#!/usr/bin/env tsx
/**
 * Controlled local real-provider conversation. ERP results are fixed read-only facts, while the
 * configured provider performs real routing/language calls. This never writes API/DB/LINE state.
 */
import {
  LINE_AI_CONTEXT_MAX_TURNS,
  LINE_AI_CONTEXT_WINDOW_MINUTES,
  LINE_TOOL_REGISTRY,
  type LineAiConversationContextTurn,
  type LineAiTurnRequest,
  type ToolMeta,
  type ToolResult,
} from '../packages/contracts/src/index';
import { isDeliveredCapabilityFollowUp, capabilityFollowUpReply } from '../apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic';
import { OrchestratorAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent';
import type { ErpToolContext } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client';

const config = {
  modelProvider: process.env['MODEL_PROVIDER'] ?? 'bedrock',
  bedrockRegion: process.env['BEDROCK_REGION'],
  bedrockModelId: process.env['BEDROCK_MODEL_ID'],
  openAiApiKey: process.env['OPENAI_API_KEY'],
  openAiModel: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',
  aiToolTimeoutMs: Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '25000'),
  aiMaxToolCalls: Number(process.env['AI_MAX_TOOL_CALLS'] ?? '8'),
  lineAiTooluseLoopEnabled: process.env['LINE_AI_TOOLUSE_LOOP_ENABLED'] === 'true',
  lineAiCoverageCriticEnabled: process.env['LINE_AI_COVERAGE_CRITIC_ENABLED'] !== 'false',
} as any;

const DATA: Record<string, unknown> = {
  'expense.get_breakdown': { summary: { totalAmount: 11875, pendingAmount: 200, draftAmount: 200, confirmedAmount: 11675, paidAmount: 10000, unpaidAmount: 1675 }, groups: [] },
  'expense.list_recent': { summary: { totalAmount: 11875, pendingAmount: 200, draftAmount: 200, confirmedAmount: 11675, paidAmount: 10000, unpaidAmount: 1675 }, items: [] },
  'inventory.list_low_stock': { count: 5, items: [] },
  'sales.get_sales_summary': { totalSales: 25000, transactionCount: 12, period: '2026-08' },
  'notifications.list_open_alerts': { count: 2, items: [] },
  'crm.get_customer_summary': { total: 42, active: 40, archived: 2 },
  'ledger.get_financial_summary': { periodKey: '2026-08', netProfit: '120000', totalAssets: '2500000', trialBalanceDifference: '0' },
};
const READ_ONLY_TOOL_CATEGORIES = new Set(['read_summary', 'read_detail', 'report']);

const erpTools = {
  async invoke(tool: ToolMeta, _ctx: ErpToolContext): Promise<ToolResult> {
    if (!READ_ONLY_TOOL_CATEGORIES.has(tool.category)) {
      throw new Error(`CONTROLLED_REPLAY_NON_READ_TOOL_REACHED:${tool.name}`);
    }
    return {
      toolName: tool.name, status: 'ok', data: DATA[tool.name] ?? { count: 0, items: [] },
      sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'controlled_fixture', permissionChecked: true }],
      asOf: '2026-08-16T12:00:00.000Z',
    } as ToolResult;
  },
} as any;

const turns = [
  { text: 'ระบบเธอทำอะไรได้บ้าง', policy: 'zero_tool' },
  { text: 'อย่างไหร่', policy: 'capability_follow_up' },
  { text: 'หวยแตกมาก', policy: 'zero_tool' },
  { text: 'ต่อยกันไหม', policy: 'zero_tool' },
  { text: 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', policy: 'read_only' },
  { text: 'สินค้าอะไรใกล้หมด', policy: 'read_only' },
  { text: 'ยอดขายเดือนนี้เท่าไหร่', policy: 'read_only' },
  { text: 'โอเค เข้าใจแล้ว', policy: 'zero_tool' },
  { text: 'ลูกค้ามีกี่ราย', policy: 'read_only' },
  { text: 'ได้เลยค่ะ', policy: 'zero_tool' },
  { text: 'ขอบคุณนะ', policy: 'zero_tool' },
  { text: 'วันนี้เหนื่อยนิดหน่อย', policy: 'zero_tool' },
  { text: 'ดีใจมากเลย', policy: 'zero_tool' },
  { text: 'โอเคค่ะ', policy: 'zero_tool' },
  { text: 'ช่วยอะไรได้บ้าง', policy: 'zero_tool' },
] as const;
const INTER_TURN_CADENCE_MS = 5_000;

function request(text: string, index: number, recentTurns: LineAiConversationContextTurn[]): LineAiTurnRequest {
  return {
    requestId: `controlled-conversation-${index + 1}`,
    webhookEventId: `controlled-conversation-${index + 1}`,
    messageText: text,
    messagePreviewHash: `controlled-${index + 1}`,
    attachments: [],
    conversationContext: {
      windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
      maxTurns: LINE_AI_CONTEXT_MAX_TURNS,
      recentTurns: recentTurns.slice(-LINE_AI_CONTEXT_MAX_TURNS),
    },
    userContext: {
      lineUserId: 'controlled-line-user', internalUserId: 'controlled-user', companyId: 'controlled-company',
      membershipId: 'controlled-membership', roles: ['owner'], locale: 'th-TH',
      permissions: [...new Set(LINE_TOOL_REGISTRY.flatMap((tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])]))],
    },
  };
}

void (async () => {
  if (LINE_AI_CONTEXT_MAX_TURNS !== 15 || LINE_AI_CONTEXT_WINDOW_MINUTES !== 15 || turns.length !== 15) {
    throw new Error('CONTROLLED_REPLAY_CONTEXT_CONTRACT_DRIFT');
  }
  const orchestrator = new OrchestratorAgent(erpTools, config);
  const recentTurns: LineAiConversationContextTurn[] = [];
  const report = [];
  let successfulReadTurns = 0;
  let successfulZeroToolTurns = 0;
  let temporaryUnavailableTurns = 0;
  for (const [index, turn] of turns.entries()) {
    const req = request(turn.text, index, recentTurns);
    let replyText: string;
    let toolsInvoked: string[] = [];
    let planStatus = 'DETERMINISTIC';
    let intents: string[] = [];
    let durationMs = 0;
    if (turn.policy === 'capability_follow_up') {
      if (!isDeliveredCapabilityFollowUp(turn.text, req.conversationContext)) {
        throw new Error('CONTROLLED_REPLAY_CAPABILITY_CONTEXT_LOST');
      }
      replyText = capabilityFollowUpReply(turn.text);
    } else {
      const startedAt = Date.now();
      const result = await orchestrator.run(req);
      durationMs = Date.now() - startedAt;
      replyText = result.replyText;
      toolsInvoked = result.outputs.flatMap((output) => output.toolCalls.map(({ name }) => name));
      planStatus = result.plan.status;
      intents = result.plan.intents.map(({ intent }) => intent);
      const temporaryUnavailable = result.plan.refusals.some(({ reason }) => reason === 'tool_unavailable');
      if (turn.policy === 'zero_tool' && toolsInvoked.length !== 0) throw new Error(`CONTROLLED_REPLAY_UNEXPECTED_TOOL:${index + 1}`);
      if (turn.policy === 'read_only' && toolsInvoked.length === 0 && !temporaryUnavailable) {
        throw new Error(`CONTROLLED_REPLAY_MISSING_READ_TOOL:${index + 1}`);
      }
      if (temporaryUnavailable) temporaryUnavailableTurns += 1;
      else if (turn.policy === 'read_only') successfulReadTurns += 1;
      else if (turn.policy === 'zero_tool') successfulZeroToolTurns += 1;
      for (const name of toolsInvoked) {
        const meta = LINE_TOOL_REGISTRY.find((tool) => tool.name === name);
        if (!meta || !READ_ONLY_TOOL_CATEGORIES.has(meta.category)) {
          throw new Error(`CONTROLLED_REPLAY_NON_READ_TOOL:${index + 1}`);
        }
      }
      if (index < turns.length - 1) await new Promise((resolve) => setTimeout(resolve, INTER_TURN_CADENCE_MS));
    }
    if (!replyText.trim()) throw new Error(`CONTROLLED_REPLAY_EMPTY_REPLY:${index + 1}`);
    recentTurns.push({
      at: new Date().toISOString(),
      userMessagePreview: turn.text, assistantReplyPreview: replyText.slice(0, 500), refused: planStatus === 'UNROUTABLE',
    });
    report.push({ turn: index + 1, policy: turn.policy, planStatus, intents, toolsInvoked, durationMs, replyChars: replyText.length });
  }
  if (successfulReadTurns < 3) throw new Error('CONTROLLED_REPLAY_INSUFFICIENT_SUCCESSFUL_READS');
  if (successfulZeroToolTurns < 3) throw new Error('CONTROLLED_REPLAY_INSUFFICIENT_SUCCESSFUL_ZERO_TOOL_TURNS');
  if (temporaryUnavailableTurns > 0) throw new Error('CONTROLLED_REPLAY_PROVIDER_DEGRADED');
  console.log(JSON.stringify({
    event: 'line_ai_controlled_conversation_complete',
    provider: config.modelProvider,
    contextPolicy: { windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES, maxTurns: LINE_AI_CONTEXT_MAX_TURNS },
    turnCount: report.length,
    nonReadToolCount: 0,
    finalMutationToolCount: 0,
    successfulReadTurns,
    successfulZeroToolTurns,
    temporaryUnavailableTurns,
    report,
  }, null, 2));
})().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'line_ai_controlled_conversation_failed', errorCode: error instanceof Error ? error.message.split(':')[0] : 'UNKNOWN' }));
  process.exitCode = 1;
});
