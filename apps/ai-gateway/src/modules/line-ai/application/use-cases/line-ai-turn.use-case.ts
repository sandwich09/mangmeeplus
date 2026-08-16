/**
 * LINE AI Turn Use Case – AI Gateway orchestration.
 * Feature flag: LINE_AI_AGENT_ORCHESTRATION_ENABLED=false → item 07 deterministic path.
 * Feature flag: LINE_AI_AGENT_ORCHESTRATION_ENABLED=true  → item 10B orchestrator path.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LineAiTurnRequest, LineAiTurnResponse, ToolResult, SourceRef } from '@watchdog-bms/contracts';
import { classifyIntent, chooseAgent, selectTools, getRefusalReason, validateTurnRequest } from '../../domain/logic/line-ai-turn.logic';
import { ErpToolClient, type ErpToolContext } from '../../infrastructure/erp-tool.client';
import { OrchestratorAgent } from '../../agents/orchestrator.agent';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { AgentCoreRuntimeClient } from '../../infrastructure/runtime/agentcore-runtime.client';

// ---- Thai-first refusal messages ----
const MUTATION_REPLY = '⚠️ ขออภัยค่ะ น้องมั่งมีไม่สามารถดำเนินการนี้ผ่าน LINE ได้\nกรุณาเปิดเว็บแอปเพื่อดำเนินการต่อนะคะ';
const UNSUPPORTED_REPLY = '📋 ขออภัยค่ะ น้องมั่งมีตอบได้เฉพาะข้อมูลในระบบธุรกิจที่เชื่อมต่ออยู่เท่านั้น\nคำถามนี้อยู่นอกขอบเขตระบบ จึงไม่สามารถให้ข้อมูลที่น่าเชื่อถือได้ค่ะ';
const FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ';
// A switched-off module is not a permission problem and not an empty result. Without its own reply
// the user is told "📭 ไม่พบข้อมูลที่ตรงกันค่ะ", which reads as "your business has no data" when the
// truth is that the company never turned the feature on. Names no other company and no other feature.
const FEATURE_OFF_REPLY = '🚧 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานสำหรับบริษัทของคุณค่ะ\nหากต้องการเปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบของบริษัทนะคะ';
/** Matches the errorCode the ERP tool boundary returns when a company feature is off. */
const FEATURE_NOT_ENABLED_CODE = 'FEATURE_NOT_ENABLED';
const ERROR_REPLY = '⏳ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
const NO_DATA_REPLY = '📭 ไม่พบข้อมูลที่ตรงกันค่ะ กรุณาลองถามใหม่อีกครั้งนะคะ';
const CAPTURE_PENDING_REPLY = [
  '🧾 ได้รับบิล/สลิปแล้วค่ะ',
  'ระบบยังไม่สามารถบันทึกหรือยืนยันความถูกต้องให้อัตโนมัติได้ในตอนนี้',
  'กรุณาตรวจสอบเลขที่เอกสาร ผู้ขาย/ผู้รับเงิน เลขประจำตัวผู้เสียภาษี ที่อยู่ วันที่ ยอดรวม และ VAT ในเว็บแอปก่อนบันทึกนะคะ',
].join('\n');

function buildReplyFromToolResults(results: ToolResult[]): string {
  const ok = results.filter((r) => r.status === 'ok' && r.data !== undefined && r.data !== null);
  if (ok.length === 0) return NO_DATA_REPLY;

  const lines: string[] = [];
  for (const r of ok) {
    const data = r.data as Record<string, unknown>;
    if (r.toolName === 'company.get_current_context') {
      lines.push(`🏢 บริษัท: ${data['name'] ?? '-'}`);
    } else if (r.toolName === 'dashboard.get_business_health_summary') {
      const widgets = (data['widgets'] as any[]) ?? [];
      lines.push(`📊 แดชบอร์ด (${widgets.length} ตัวชี้วัด) – ข้อมูล ณ ${r.asOf}`);
    } else if (r.toolName === 'notifications.list_open_alerts') {
      const count = (data['count'] as number) ?? 0;
      lines.push(`🔔 การแจ้งเตือน: ${count} รายการ`);
    } else if (r.toolName === 'notifications.get_daily_summary') {
      const total = (data as Record<string, unknown>)['total'] ?? 0;
      lines.push(`📋 สรุปประจำวัน: ${total} การแจ้งเตือน`);
    } else if (r.toolName === 'inventory.list_low_stock') {
      const count = (data['count'] as number) ?? 0;
      lines.push(`⚠️ สินค้าใกล้หมด: ${count} รายการ`);
    } else if (r.toolName === 'inventory.search_products') {
      const total = (data['total'] as number) ?? 0;
      lines.push(`🔍 พบสินค้า: ${total} รายการ`);
    } else if (r.toolName === 'inventory.get_stock_balance') {
      const items = Array.isArray(data) ? data : [];
      lines.push(`📦 สต็อก: ${items.length} รายการ`);
    } else if (r.toolName === 'inventory.summarize_stock_movements') {
      const inQty = (data['inQty'] as number) ?? 0;
      const outQty = (data['outQty'] as number) ?? 0;
      lines.push(`📈 รับเข้า: ${inQty} | ส่งออก: ${outQty}`);
    } else if (r.toolName === 'ledger.get_financial_summary') {
      lines.push(`📘 บัญชีงวด ${data['periodKey'] ?? '-'}: กำไรสุทธิ ${data['netProfit'] ?? '0'}, สินทรัพย์ ${data['totalAssets'] ?? '0'}, ส่วนต่างงบทดลอง ${data['trialBalanceDifference'] ?? '0'}`);
    } else if (r.toolName === 'sales.get_sales_summary') {
      const period = data['period'];
      const periodLabel = typeof period === 'string'
        ? period
        : period && typeof period === 'object'
          ? `${String((period as Record<string, unknown>)['fromDate'] ?? '-')}–${String((period as Record<string, unknown>)['toDate'] ?? '-')}`
          : 'ช่วงเวลาปัจจุบัน';
      lines.push(`💰 ยอดรับเงินจริง: ${data['totalSales'] ?? '-'} (${periodLabel})`);
    } else if (r.toolName === 'crm.suggest_sales_followups') {
      const count = (data['count'] as number) ?? 0;
      lines.push(`🤝 ลูกค้าที่ควรติดตาม: ${count} รายการ`);
    } else if (r.toolName === 'accounting.capture_receipt_evidence') {
      lines.push(formatCaptureEvidence(data));
    }
  }

  return lines.length > 0 ? lines.join('\n') : NO_DATA_REPLY;
}

function buildCaptureReplyFromToolResults(results: ToolResult[]): string | null {
  const capture = results.find((r) => r.toolName === 'accounting.capture_receipt_evidence');
  if (!capture) return null;
  if (capture.status !== 'ok' || !capture.data) return CAPTURE_PENDING_REPLY;
  return formatCaptureEvidence(capture.data as Record<string, unknown>);
}

function formatCaptureEvidence(data: Record<string, unknown>): string {
  const lines = ['🧾 ตรวจบิล/ใบเสร็จเบื้องต้น'];
  lines.push(`สถานะ: ${data['status'] ?? 'รอตรวจสอบ'}`);
  if (data['documentType']) lines.push(`ประเภทเอกสาร: ${data['documentType']}`);
  if (data['vendorName']) lines.push(`ผู้ขาย/ผู้รับเงิน: ${data['vendorName']}`);
  if (data['taxId']) lines.push(`เลขประจำตัวผู้เสียภาษี: ${data['taxId']}`);
  if (data['totalAmount']) lines.push(`ยอดรวม: ${data['totalAmount']}`);
  if (data['confidence']) lines.push(`ความมั่นใจ OCR: ${data['confidence']}`);
  if (data['taxInvoicePresent'] !== undefined) lines.push(`ใบกำกับภาษี: ${data['taxInvoicePresent'] ? 'พบ' : 'ไม่พบ/ไม่ชัดเจน'}`);
  if (data['addressPresent'] !== undefined) lines.push(`ที่อยู่บนเอกสาร: ${data['addressPresent'] ? 'พบ' : 'ไม่พบ/ไม่ชัดเจน'}`);
  lines.push(data['saved'] ? 'ผลลัพธ์: บันทึกหลักฐานแล้ว' : 'ผลลัพธ์: ยังไม่บันทึก ต้องตรวจสอบในเว็บแอปก่อน');
  return lines.join('\n');
}

@Injectable()
export class LineAiTurnUseCase {
  private readonly logger = new Logger(LineAiTurnUseCase.name);

  constructor(
    @Inject(ErpToolClient) private readonly erpTools: ErpToolClient,
    @Inject(OrchestratorAgent) private readonly orchestrator: OrchestratorAgent,
    @Inject(AiGatewayConfigService) private readonly config: AiGatewayConfigService,
    @Inject(AgentCoreRuntimeClient) private readonly agentcoreRuntime: AgentCoreRuntimeClient,
  ) {}

  async execute(req: LineAiTurnRequest): Promise<LineAiTurnResponse> {
    const startMs = Date.now();
    const response = await this.executeInner(req, startMs);
    const enriched = {
      ...response,
      modelLineage: response.modelLineage ?? [this.lineage(req.modelPolicy?.modelId, 'employee_line_assistant')],
    };
    this.logger.log({
      msg: 'ai.turn.complete',
      requestId: enriched.requestId,
      companyId: req.userContext.companyId,
      intent: enriched.intent,
      agent: enriched.agent,
      refused: enriched.refused,
      refusalReason: enriched.refusalReason ?? null,
      toolCount: enriched.toolsInvoked.length,
      durationMs: enriched.durationMs,
      modelLineage: enriched.modelLineage,
      runtimeIdentity: enriched.runtimeIdentity ?? null,
      expectedRuntimeIdentity: enriched.expectedRuntimeIdentity ?? null,
      runtimeBinding: enriched.runtimeBinding ?? null,
      stageDurationsMs: enriched.stageDurationsMs ?? null,
      modelCallCount: enriched.modelCallCount ?? null,
      errorCode: enriched.errorCode ?? null,
    });
    return enriched;
  }

  private async executeInner(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    const validationError = validateTurnRequest(req);
    if (validationError) {
      return this.buildRefusedResponse(req, 'forbidden', '🔒 คำขอไม่ถูกต้อง', startMs);
    }
    if (this.config.lineAiAgentOrchestrationEnabled) {
      return this.runOrchestratorPath(req, startMs);
    }
    return this.runDeterministicPath(req, startMs);
  }

  // ── Item 10B path ──────────────────────────────────────────────────────────

  private async runOrchestratorPath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    if (this.config.lineAiAgentRuntime === 'agentcore') {
      return this.runAgentCorePath(req, startMs);
    }
    return this.runLocalOrchestratorPath(req, startMs);
  }

  private async runAgentCorePath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    try {
      const result = await this.agentcoreRuntime.invoke({
        turnId: req.requestId,
        companyId: req.userContext.companyId,
        userId: req.userContext.internalUserId,
        membershipId: req.userContext.membershipId,
        branchIds: req.userContext.branchIds,
        locationIds: req.userContext.locationIds,
        roles: req.userContext.roles,
        messageText: req.messageText,
        locale: req.userContext.locale,
        permissions: req.userContext.permissions,
        actorDelegations: req.actorDelegations,
        modelPolicy: req.modelPolicy,
        attachments: req.attachments?.map((a) => ({
          attachmentId: a.id,
          mimeType: a.mimeType,
          kind: a.purpose,
          sha256: '',
        })),
        conversationContext: req.conversationContext,
      });
      const sourceRefs = result.sourceRefs;
      // Bounded passthrough: the AgentCore artifact is deployed separately, so its payload is
      // untrusted JSON. Only contract fields cross, and each value is coerced — a non-numeric
      // durationMs would otherwise reach the API and break AiToolInvocation persistence.
      const toolCalls = result.toolsInvoked
        .filter((tool) => tool && typeof tool.name === 'string')
        .map((tool) => ({
          name: tool.name,
          status: tool.status,
          durationMs: typeof tool.durationMs === 'number' && Number.isFinite(tool.durationMs) ? tool.durationMs : 0,
          ...(typeof tool.errorCode === 'string' ? { errorCode: tool.errorCode } : {}),
        }));
      return {
        requestId: req.requestId,
        replyText: result.replyText,
        sourceRefs,
        sourceLabels: [...new Set(sourceRefs.map((source) => source.label))],
        webLinks: result.webLinks,
        ...(result.presentation ? { presentation: result.presentation } : {}),
        intent: (result.plan.intents[0] as any)?.intent ?? 'unknown',
        agent: (result.plan.intents[0] as any)?.agent ?? 'general',
        refused: result.refused || result.plan.status === 'UNROUTABLE',
        ...(result.refusalReason ? { refusalReason: result.refusalReason } : {}),
        toolsInvoked: toolCalls.map((tool) => tool.name),
        toolCalls,
        durationMs: result.durationMs,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.runtimeIdentity ? { runtimeIdentity: result.runtimeIdentity } : {}),
        ...(result.expectedRuntimeIdentity ? { expectedRuntimeIdentity: result.expectedRuntimeIdentity } : {}),
        ...(result.runtimeBinding ? { runtimeBinding: result.runtimeBinding } : {}),
        ...(result.stageDurationsMs ? { stageDurationsMs: result.stageDurationsMs } : {}),
        ...(result.modelCallCount !== undefined ? { modelCallCount: result.modelCallCount } : {}),
        // The model calls happened in the artifact's process, so the request-scoped collector saw
        // nothing: the artifact's own (coerced) rows are the only usage this path can report.
        ...(result.usage ? { usage: result.usage } : {}),
      };
    } catch (err) {
      const rawCode = (err as Record<string, unknown>)?.['code'];
      const code = typeof rawCode === 'string' ? rawCode : 'AGENTCORE_INVOKE_FAILED';
      const runtimeBinding = (err as Record<string, unknown>)?.['runtimeBinding'];
      const runtimeIdentity = (err as Record<string, unknown>)?.['runtimeIdentity'];
      const expectedRuntimeIdentity = (err as Record<string, unknown>)?.['expectedRuntimeIdentity'];
      const stageDurationsMs = (err as Record<string, unknown>)?.['stageDurationsMs'];
      this.logger.error({ msg: 'ai.provider.failure', requestId: req.requestId, code, path: 'agentcore', error: (err as Error).message });
      return {
        ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs),
        errorCode: code,
        ...(runtimeBinding ? { runtimeBinding: runtimeBinding as any } : {}),
        ...(runtimeIdentity ? { runtimeIdentity: runtimeIdentity as any } : {}),
        ...(expectedRuntimeIdentity ? { expectedRuntimeIdentity: expectedRuntimeIdentity as any } : {}),
        ...(stageDurationsMs ? { stageDurationsMs: stageDurationsMs as any } : {}),
      };
    }
  }

  private async runLocalOrchestratorPath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    try {
      const result = await this.orchestrator.run(req);
      return {
        requestId: req.requestId,
        replyText: result.replyText,
        sourceRefs: result.sourceRefs,
        sourceLabels: [...new Set(result.sourceRefs.map((s) => s.label))],
        webLinks: result.webLinks,
        ...(result.presentation ? { presentation: result.presentation } : {}),
        intent: result.plan.intents[0]?.intent ?? 'unknown',
        agent: result.plan.intents[0]?.agent ?? 'general',
        refused: result.plan.status === 'UNROUTABLE',
        refusalReason: result.plan.refusals[0]?.reason,
        toolsInvoked: result.outputs.flatMap((o) => o.toolCalls.map((t) => t.name)),
        toolCalls: result.outputs.flatMap((o) => o.toolCalls),
        durationMs: result.durationMs,
        ...(result.coverage ? { coverage: result.coverage } : {}),
      };
    } catch (err) {
      // Safe provider error – no stack traces to LINE
      const rawCode = (err as Record<string, unknown>)?.['code'];
      const code = typeof rawCode === 'string' ? rawCode : 'ORCHESTRATOR_FAILED';
      this.logger.error({ msg: 'ai.provider.failure', requestId: req.requestId, code, path: 'orchestrator', error: (err as Error).message });
      return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: code };
    }
  }

  // ── Item 07 deterministic path (unchanged) ─────────────────────────────────

  private async runDeterministicPath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    const text = req.messageText.toLowerCase().trim();
    const intent = classifyIntent(text, (req.attachments?.length ?? 0) > 0);
    const agent = chooseAgent(intent, text);
    const refusalReason = getRefusalReason(intent);

    if (refusalReason) {
      const replyText = intent === 'mutation_request' ? MUTATION_REPLY : (intent === 'unsupported_module' || intent === 'unknown') ? UNSUPPORTED_REPLY : FORBIDDEN_REPLY;
      return this.buildRefusedResponse(req, refusalReason, replyText, startMs, intent, agent);
    }

    const tools = selectTools(agent, intent, text);
    if (tools.length === 0) {
      return { ...this.baseResponse(req, intent, agent, startMs), replyText: ERROR_REPLY, refused: false };
    }

    const erpCtx: ErpToolContext = {
      requestId: req.requestId,
      companyId: req.userContext.companyId,
      userId: req.userContext.internalUserId,
      membershipId: req.userContext.membershipId,
      permissions: req.userContext.permissions,
      branchIds: req.userContext.branchIds,
      locationIds: req.userContext.locationIds,
      locale: req.userContext.locale,
      actorDelegations: req.actorDelegations,
    };

    const topTools = tools.slice(0, 3);
    const toolInput = intent === 'capture_accounting_evidence' ? { attachments: req.attachments ?? [], messageText: req.messageText } : {};
    const results = await Promise.all(topTools.map((t) => this.erpTools.invoke(t, erpCtx, toolInput)));

    // Checked before the forbidden branch so a turn blocked purely by the company's feature switch
    // is never reported as a missing permission or as an empty business.
    if (results.length > 0 && results.every((r) => r.errorCode === FEATURE_NOT_ENABLED_CODE)) {
      return this.buildRefusedResponse(req, 'unsupported_module', FEATURE_OFF_REPLY, startMs, intent, agent);
    }

    if (results.every((r) => r.status === 'forbidden')) {
      return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs, intent, agent);
    }

    const replyText = buildCaptureReplyFromToolResults(results) ?? buildReplyFromToolResults(results);
    const allSourceRefs = results.flatMap((r) => r.sourceRefs ?? []);
    const sourceLabels = [...new Set(allSourceRefs.map((s: SourceRef) => s.label))];
    const webLinks = allSourceRefs.filter((s: SourceRef) => !!s.webPath).map((s: SourceRef) => ({ label: s.label, path: s.webPath! }));
    const readResults = results.filter((result, index) => result.status === 'ok'
      && result.data !== undefined
      && result.data !== null
      && ['read_summary', 'read_detail', 'report'].includes(topTools[index]?.category ?? ''));
    const presentation = readResults.length > 0 ? {
      kind: 'answer_cards' as const,
      cards: readResults.slice(0, 12).map((result) => {
        const refs = result.sourceRefs ?? [];
        const labels = [...new Set(refs.map((source) => source.label))];
        const link = refs.find((source) => source.webPath);
        return {
          text: readResults.length === 1 ? replyText : buildReplyFromToolResults([result]),
          ...(labels.length > 0 ? { sourceLabels: labels } : {}),
          ...(link?.webPath ? { webLink: { label: link.label, path: link.webPath } } : {}),
        };
      }),
    } : undefined;

    return {
      requestId: req.requestId,
      replyText,
      sourceRefs: allSourceRefs,
      sourceLabels,
      webLinks,
      intent,
      agent,
      refused: false,
      toolsInvoked: topTools.map((t) => t.name),
      // ErpToolClient guarantees toolName === tool.name and attaches the measured durationMs.
      toolCalls: results.map((r) => ({
        name: r.toolName,
        status: r.status,
        durationMs: r.durationMs ?? 0,
        ...(r.errorCode ? { errorCode: r.errorCode } : {}),
      })),
      durationMs: Date.now() - startMs,
      ...(presentation ? { presentation } : {}),
    };
  }

  private buildRefusedResponse(req: LineAiTurnRequest, refusalReason: any, replyText: string, startMs: number, intent: any = 'unknown', agent: any = 'general'): LineAiTurnResponse {
    return { ...this.baseResponse(req, intent, agent, startMs), replyText, refused: true, refusalReason, toolsInvoked: [] };
  }

  private baseResponse(req: LineAiTurnRequest, intent: any, agent: any, startMs: number): LineAiTurnResponse {
    return { requestId: req.requestId, replyText: '', sourceRefs: [], sourceLabels: [], webLinks: [], intent, agent, refused: false, toolsInvoked: [], durationMs: Date.now() - startMs };
  }

  private lineage(modelOverride: string | undefined, purpose: string) {
    if (this.config.modelProvider === 'bedrock') {
      return {
        provider: 'bedrock',
        modelId: modelOverride ?? this.config.bedrockModelId ?? 'not-configured',
        region: this.config.bedrockRegion ?? 'not-configured',
        purpose,
      };
    }
    if (this.config.modelProvider === 'openai') {
      return {
        provider: 'openai',
        modelId: modelOverride ?? this.config.openAiModel,
        region: this.config.openAiProcessingRegion ?? 'not-configured',
        purpose,
      };
    }
    return { provider: 'deterministic', modelId: 'watchdog-line-rules-v1', region: 'local', purpose };
  }
}
