import { lineReplyLanguage } from '@watchdog-bms/contracts';
/**
 * LINE AI Turn Use Case – AI Gateway orchestration.
 * Feature flag: LINE_AI_AGENT_ORCHESTRATION_ENABLED=false → item 07 deterministic path.
 * Feature flag: LINE_AI_AGENT_ORCHESTRATION_ENABLED=true  → item 10B orchestrator path.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LineAiAnswerCardLayout, LineAiTurnRequest, LineAiTurnResponse, ToolResult, SourceRef } from '@watchdog-bms/contracts';
import { AI_BUDGET_REFUSAL_CODES, LINE_AI_EXPENSE_CRITERION_REPLIES, LINE_TOOL_REGISTRY, asIntakeRouteIntent, extractValueCandidates, isBusinessIntakeIntent, lineAiRetainedTaskSourceMatchesProjection, parseAiBudgetGrantV2, parseLineAiPreparedPlan, parseLineAiTurnValueCandidates, parseLineAiResponsePreferences, parseLineAiTaskProjection, parseLineAiSemanticSubrequests, lineAiReplyClarifications, parseLineAiSemanticCoverage, verifyLineAiInputEvidence, verifyLineAiRetainedTaskSource, verifyLineAiValueCandidatesV2 } from '@watchdog-bms/contracts';
import { currentBudgetState } from '../../../../common/usage/usage-context';
import { AI_BUDGET_V2_SUPPORTED } from '../../../../common/usage/ai-budget-provider';
import { classifyIntent, chooseAgent, selectTools, getRefusalReason, validateTurnRequest } from '../../domain/logic/line-ai-turn.logic';
import { ErpToolClient, type ErpToolContext } from '../../infrastructure/erp-tool.client';
import { OrchestratorAgent } from '../../agents/orchestrator.agent';
import { allExpenseBranchesRequested, expenseBranchScopeRequested, expenseCriterionOnlyMessage, thaiExpenseMonthMentions, uncertainExpenseFilter, unsupportedExpenseFilter } from '../../agents/orchestrator.agent';
import { OPEN_WORK_TOOLS, formatExpenseSummary, openWorkCardLayout } from '../../agents/prepared-simple-read-formatter';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { AgentCoreRuntimeClient } from '../../infrastructure/runtime/agentcore-runtime.client';
import { toolAccessOutcome } from '../../agents/tool-availability';
import { featureDisabledReply } from '../../agents/response-composer.agent';

// ---- Thai-first refusal messages ----
const MUTATION_REPLY = '⚠️ ขออภัยค่ะ น้องมั่งมีไม่สามารถดำเนินการนี้ผ่าน LINE ได้\nกรุณาเปิดเว็บแอปเพื่อดำเนินการต่อนะคะ';
const UNSUPPORTED_REPLY = '📋 ขออภัยค่ะ น้องมั่งมีตอบได้เฉพาะข้อมูลในระบบธุรกิจที่เชื่อมต่ออยู่เท่านั้น\nคำถามนี้อยู่นอกขอบเขตระบบ จึงไม่สามารถให้ข้อมูลที่น่าเชื่อถือได้ค่ะ';
/** Spec §5.3: the sibling of `UNSUPPORTED_REPLY` for a turn the API's own intake already placed
 *  inside the business. The web link rides on `webLinks`, which the API renders with its own base
 *  URL and rewrites into a one-time auto-login handoff. */
const UNSUPPORTED_YET_REPLY = '📋 เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้ค่ะ\nทำได้ในเว็บนะคะ';
const FORBIDDEN_REPLY = '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ';
/** Matches the errorCode the ERP tool boundary returns when a company feature is off. */
const FEATURE_NOT_ENABLED_CODE = 'FEATURE_NOT_ENABLED';
const ERROR_REPLY = '⏳ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
/** Spec §9.1: say the budget could not be CHECKED, never that it is full and never "something
 *  broke". Same wording the API uses for its own `AI_BUDGET_UNAVAILABLE`, so one situation reads
 *  the same to the shop whichever hop refused it. */
const AI_BUDGET_UNAVAILABLE_REPLY = '⏳ ตอนนี้ยังตรวจสอบเครดิต AI ของร้านไม่ได้ค่ะ น้องมั่งมีเลยยังไม่เริ่มงานให้ '
  + 'รบกวนลองใหม่อีกครั้งในอีกสักครู่นะคะ ระหว่างนี้ใช้งานผ่านเว็บแอปได้ตามปกติค่ะ';
const NO_DATA_REPLY = '📭 ไม่พบข้อมูลที่ตรงกันค่ะ กรุณาลองถามใหม่อีกครั้งนะคะ';
const CAPTURE_PENDING_REPLY = [
  '🧾 ได้รับบิล/สลิปแล้วค่ะ',
  'ระบบยังไม่สามารถบันทึกหรือยืนยันความถูกต้องให้อัตโนมัติได้ในตอนนี้',
  'กรุณาตรวจสอบเลขที่เอกสาร ผู้ขาย/ผู้รับเงิน เลขประจำตัวผู้เสียภาษี ที่อยู่ วันที่ ยอดรวม และ VAT ในเว็บแอปก่อนบันทึกนะคะ',
].join('\n');

function currentBangkokMonthRange(now = new Date()): { fromDate: string; toDate: string } {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return { fromDate: `${today.slice(0, 7)}-01`, toDate: today };
}

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
      lines.push(`📊 หน้าแรก (${widgets.length} ตัวชี้วัด) – ข้อมูล ณ ${r.asOf}`);
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

  /** Effective S-4 capability across the Gateway and an optionally separate AgentCore artifact. */
  async lineDraftEditCapabilityEnabled(): Promise<boolean> {
    // The deterministic path has no S-4 tool catalog. Never report full LINE edit capability
    // unless the serving orchestration is enabled.
    if (!this.config.lineAiAgentOrchestrationEnabled) return false;
    if (this.config.lineAiAgentRuntime !== 'agentcore') return true;
    return this.agentcoreRuntime.lineDraftEditCapabilityEnabled();
  }

  /** Budget capability requires the serving runtime and its usage wrapper to agree on v2. */
  async lineBudgetV2CapabilityEnabled(): Promise<boolean> {
    if (!AI_BUDGET_V2_SUPPORTED || !this.config.lineAiAgentOrchestrationEnabled) return false;
    if (this.config.lineAiAgentRuntime === 'agentcore') return this.agentcoreRuntime.lineBudgetV2CapabilityEnabled();
    return true;
  }

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
    const hasV2ContractField = req.inputEvidence !== undefined || req.budgetGrantV2 !== undefined
      || req.contractCapabilities !== undefined || req.retainedTaskSource !== undefined;
    let verifiedInputEvidence: LineAiTurnRequest['inputEvidence'];
    if (hasV2ContractField) {
      const inputEvidence = await verifyLineAiInputEvidence(req.inputEvidence, req.messageText);
      const grant = parseAiBudgetGrantV2(req.budgetGrantV2);
      const capabilities = req.contractCapabilities;
      const contractValid = Boolean(inputEvidence && grant && inputEvidence.turnKey === grant.turnKey
        && Array.isArray(capabilities) && capabilities.length === 2
        && capabilities.includes('input-evidence-v2') && capabilities.includes('budget-envelope-v2'));
      if (!contractValid) {
        this.logger.warn({ msg: 'line_ai_contract_v2_rejected', requestId: req.requestId, reason: 'evidence_or_grant_invalid' });
        return {
          ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs),
          errorCode: 'AI_CONTRACT_UNSUPPORTED',
        };
      }
      verifiedInputEvidence = inputEvidence!;
      // A v2 grant is executable only when the HTTP receiver opened the matching v2 budget state.
      // Direct callers and malformed/missing interceptor state fail closed; no v1 downgrade.
      const budget = currentBudgetState();
      if (budget?.status !== 'active-v2' || budget.grant.turnKey !== grant!.turnKey
        || budget.inputDigest !== inputEvidence!.joinedSha256) {
        this.logger.warn({ msg: 'line_ai_contract_v2_rejected', requestId: req.requestId, reason: 'v2_budget_state_missing' });
        return {
          ...this.buildRefusedResponse(req, 'tool_unavailable', AI_BUDGET_UNAVAILABLE_REPLY, startMs),
          errorCode: AI_BUDGET_REFUSAL_CODES.unavailable,
        };
      }
    }
    const parsedValueCandidates = req.valueCandidates === undefined ? undefined : parseLineAiTurnValueCandidates(req.valueCandidates, req.messageText);
    const versionedValueCandidates = !!req.valueCandidates && 'version' in req.valueCandidates && req.valueCandidates.version === 2;
    const verifiedValueCandidates = versionedValueCandidates && verifiedInputEvidence
      ? await verifyLineAiValueCandidatesV2(req.valueCandidates, verifiedInputEvidence)
      : undefined;
    if (versionedValueCandidates && (!parsedValueCandidates || !verifiedValueCandidates)) {
      this.logger.warn({ msg: 'line_ai_value_candidates_rejected', requestId: req.requestId, reason: 'invalid_v2' });
      return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: 'AI_CONTRACT_UNSUPPORTED' };
    }
    if (hasV2ContractField && req.valueCandidates !== undefined && !versionedValueCandidates) {
      this.logger.warn({ msg: 'line_ai_value_candidates_rejected', requestId: req.requestId, reason: 'version_missing' });
      return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: 'AI_CONTRACT_UNSUPPORTED' };
    }
    // Gateway ingress is a trust boundary: re-parse and re-bound the optional prepared plan AND
    // re-validate the trusted outer intake provenance here (explicit membership, no unsafe cast), so
    // every downstream path (agentcore, local orchestrator, deterministic) sees a validated plan/intent
    // or `undefined`, never raw wire JSON. An invalid/forged wrapper or provenance is discarded.
    const taskProjection = req.taskProjection === undefined ? undefined : parseLineAiTaskProjection(req.taskProjection);
    const retainedTaskSource = req.retainedTaskSource === undefined ? undefined
      : await verifyLineAiRetainedTaskSource(req.retainedTaskSource);
    const bounded: LineAiTurnRequest = {
      ...req,
      language: req.language === 'en' || req.language === 'th' ? req.language : lineReplyLanguage(req.messageText),
      preparedPlan: parseLineAiPreparedPlan(req.preparedPlan, req.inputEvidence ? { inputEvidence: req.inputEvidence } : undefined),
      intakeIntent: asIntakeRouteIntent(req.intakeIntent),
      taskProjection,
      retainedTaskSource,
      responsePreferences: req.responsePreferences === undefined ? undefined : parseLineAiResponsePreferences(req.responsePreferences),
      semanticSubrequests: req.semanticSubrequests === undefined ? undefined
        : parseLineAiSemanticSubrequests(req.semanticSubrequests, req.messageText, req.inputEvidence,
          lineAiReplyClarifications(req.openClarifications, req.resolvedClarificationIds)),
      valueCandidates: req.valueCandidates
        ? versionedValueCandidates ? verifiedValueCandidates : parsedValueCandidates
          ?? extractValueCandidates(req.messageText, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))
        : undefined,
    };
    if (req.taskProjection !== undefined && !bounded.taskProjection
      || req.retainedTaskSource !== undefined && (!retainedTaskSource || !lineAiRetainedTaskSourceMatchesProjection(retainedTaskSource, taskProjection, 'turn'))
      || req.responsePreferences !== undefined && !bounded.responsePreferences
      || req.semanticSubrequests !== undefined && !bounded.semanticSubrequests) {
      this.logger.warn({ msg: 'line_ai_contract_v2_rejected', requestId: req.requestId, reason: 'semantic_or_preference_contract_invalid' });
      return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: 'AI_CONTRACT_UNSUPPORTED' };
    }
    if (this.config.lineAiAgentOrchestrationEnabled) {
      return this.runOrchestratorPath(bounded, startMs);
    }
    return this.runDeterministicPath(bounded, startMs);
  }

  // ── Item 10B path ──────────────────────────────────────────────────────────

  private async runOrchestratorPath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    if (this.config.lineAiAgentRuntime === 'agentcore') {
      // Spec §12.6 / ADR 0013 §6: the AgentCore artifact runs the model in its OWN process, so it
      // honours no invocation envelope — it cannot budget-step before its calls, and the rows it
      // reports back arrive after every one of them is already paid for. A SPLIT company's traffic
      // must therefore be REFUSED here rather than fall back to an unreserved runtime; anything
      // else is the "silently fallback ไป runtime ที่ไม่มี reservation" this clause forbids.
      if (currentBudgetState()?.status === 'active' || currentBudgetState()?.status === 'invalid') {
        this.logger.warn({ msg: 'ai.budget.runtime_unsupported', requestId: req.requestId, runtime: 'agentcore' });
        return {
          ...this.buildRefusedResponse(req, 'tool_unavailable', AI_BUDGET_UNAVAILABLE_REPLY, startMs),
          errorCode: AI_BUDGET_REFUSAL_CODES.unavailable,
        };
      }
      return this.runAgentCorePath(req, startMs);
    }
    return this.runLocalOrchestratorPath(req, startMs);
  }

  private async runAgentCorePath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    // Already bounded at executeInner ingress; forward the validated plan (or nothing) to the artifact.
    const preparedPlan = req.preparedPlan;
    try {
      const result = await this.agentcoreRuntime.invoke({
        turnId: req.requestId,
        companyId: req.userContext.companyId,
        userId: req.userContext.internalUserId,
        membershipId: req.userContext.membershipId,
        chatKeyHash: req.userContext.chatKeyHash,
        branchIds: req.userContext.branchIds,
        locationIds: req.userContext.locationIds,
        roles: req.userContext.roles,
        messageText: req.messageText,
        locale: req.userContext.locale,
        permissions: req.userContext.permissions,
        entitlementDeniedPermissions: req.userContext.entitlementDeniedPermissions,
        // One field on the wire feeds both destinations the artifact rebuilds (userContext for tool
        // gating, request level for the capability answer). userContext is the richer source; the
        // request-level copy is the fallback for callers that only populate that one.
        entitledFeatureKeys: req.userContext.entitledFeatureKeys ?? req.entitledFeatureKeys,
        packageOffers: req.packageOffers,
        actorDelegations: req.actorDelegations,
        modelPolicy: req.modelPolicy,
        attachments: req.attachments?.map((a) => ({
          attachmentId: a.id,
          mimeType: a.mimeType,
          kind: a.purpose,
          sha256: '',
        })),
        conversationContext: req.conversationContext,
        openClarifications: req.openClarifications,
        resolvedClarificationIds: req.resolvedClarificationIds,
        ...(req.inputEvidence ? { inputEvidence: req.inputEvidence } : {}),
        ...(req.contractCapabilities ? { contractCapabilities: req.contractCapabilities } : {}),
        ...(req.budgetGrantV2 ? { budgetGrantV2: req.budgetGrantV2 } : {}),
        ...(req.approvedKnowledge ? { approvedKnowledge: true } : {}),
        language: req.language ?? lineReplyLanguage(req.messageText),
        ...(req.howToActionId ? { howToActionId: req.howToActionId } : {}),
        ...(req.selectedKnowledgeCardIds ? { selectedKnowledgeCardIds: req.selectedKnowledgeCardIds } : {}),
        ...(req.taskProjection ? { taskProjection: req.taskProjection } : {}),
        ...(req.responsePreferences ? { responsePreferences: req.responsePreferences } : {}),
        ...(req.semanticSubrequests ? { semanticSubrequests: req.semanticSubrequests } : {}),
        ...(req.retainedTaskSource ? { retainedTaskSource: req.retainedTaskSource } : {}),
        valueCandidates: req.valueCandidates,
        ...(preparedPlan ? { preparedPlan } : {}),
        ...(req.intakeIntent ? { intakeIntent: req.intakeIntent } : {}),
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
      const semanticCoverage = req.semanticSubrequests
        ? parseLineAiSemanticCoverage(result.semanticCoverage, req.semanticSubrequests)
        : undefined;
      if (req.semanticSubrequests && !semanticCoverage) {
        return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: 'AI_CONTRACT_UNSUPPORTED' };
      }
      return {
        requestId: req.requestId,
        replyText: result.replyText,
        sourceRefs,
        sourceLabels: [...new Set(sourceRefs.map((source) => source.label))],
        webLinks: result.webLinks,
        ...(result.presentation ? { presentation: result.presentation } : {}),
        ...(semanticCoverage ? { semanticCoverage } : {}),
       ...(result.deterministicExpenseSummary ? { deterministicExpenseSummary: true } : {}),
        ...(result.deterministicExpenseCriterionConfirmation ? { deterministicExpenseCriterionConfirmation: true } : {}),
        intent: (result.plan.intents[0] as any)?.intent ?? 'unknown',
        agent: (result.plan.intents[0] as any)?.agent ?? 'general',
        refused: result.refused || result.plan.status === 'UNROUTABLE' || !!semanticCoverage?.length && semanticCoverage.every(item => item.reasonCode === 'PACKAGE_FEATURE_NOT_ENABLED'),
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
      const semanticCoverage = req.semanticSubrequests
        ? parseLineAiSemanticCoverage(result.semanticCoverage, req.semanticSubrequests)
        : undefined;
      if (req.semanticSubrequests && !semanticCoverage) {
        return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: 'AI_CONTRACT_UNSUPPORTED' };
      }
      return {
        requestId: req.requestId,
        replyText: result.replyText,
        sourceRefs: result.sourceRefs,
        sourceLabels: [...new Set(result.sourceRefs.map((s) => s.label))],
        webLinks: result.webLinks,
        ...(result.presentation ? { presentation: result.presentation } : {}),
       ...(result.deterministicExpenseSummary ? { deterministicExpenseSummary: true } : {}),
        ...(result.deterministicExpenseCriterionConfirmation ? { deterministicExpenseCriterionConfirmation: true } : {}),
        intent: result.plan.intents[0]?.intent ?? 'unknown',
        agent: result.plan.intents[0]?.agent ?? 'general',
        refused: result.plan.status === 'UNROUTABLE' || !!semanticCoverage?.length && semanticCoverage.every(item => item.reasonCode === 'PACKAGE_FEATURE_NOT_ENABLED'),
        refusalReason: result.plan.refusals[0]?.reason,
        toolsInvoked: result.outputs.flatMap((o) => o.toolCalls.map((t) => t.name)),
        toolCalls: result.outputs.flatMap((o) => o.toolCalls),
        durationMs: result.durationMs,
        ...(result.coverage ? { coverage: result.coverage } : {}),
        ...(semanticCoverage ? { semanticCoverage } : {}),
      };
    } catch (err) {
      // Safe provider error – no stack traces to LINE
      const rawCode = (err as Record<string, unknown>)?.['code'];
      const code = typeof rawCode === 'string' ? rawCode : 'ORCHESTRATOR_FAILED';
      this.logger.error({ msg: 'ai.provider.failure', requestId: req.requestId, code, path: 'orchestrator', error: (err as Error).message });
      return { ...this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs), errorCode: code };
    }
  }

  // ── Legacy deterministic fallback ─────────────────────────────────────────

  private async runDeterministicPath(req: LineAiTurnRequest, startMs: number): Promise<LineAiTurnResponse> {
    // This exact, fixed answer carries no business figures and requires no ERP read. Check the
    // expense tool's live permission/entitlement first; API delivery then stamps its own current
    // access proof and rejects any changed, embellished, or sourced response.
    const hasPriorExpenseContext = req.conversationContext?.deliveredExpenseSummary?.statusBasis === 'exclude_rejected_voided'
      && req.conversationContext.deliveredExpenseSummary.ranges.length > 0;
    if ((req.attachments?.length ?? 0) === 0 && expenseCriterionOnlyMessage(req.messageText, hasPriorExpenseContext)) {
      const expenseTool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.list_recent');
      const access = expenseTool ? toolAccessOutcome(expenseTool, req.userContext) : 'forbidden';
      if (access === 'feature_disabled') {
        return this.buildRefusedResponse(req, 'feature_disabled', featureDisabledReply(['expense.list_recent'], req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions), startMs);
      }
      if (access !== 'allowed') return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs);
      const summary = req.conversationContext?.deliveredExpenseSummary;
      const hasDeliveredProof = summary?.version === 1 && summary.statusBasis === 'exclude_rejected_voided'
        && Number.isFinite(Date.parse(summary.deliveredAt)) && summary.ranges.length > 0 && summary.ranges.length <= 24;
      const language = /[\u0E00-\u0E7F]/u.test(req.messageText) ? 'th' : 'en';
      return {
        ...this.baseResponse(req, 'read_summary', 'accounting', startMs),
        replyText: language === 'en'
          ? hasDeliveredProof ? LINE_AI_EXPENSE_CRITERION_REPLIES.deliveredEn : LINE_AI_EXPENSE_CRITERION_REPLIES.generalEn
          : hasDeliveredProof ? LINE_AI_EXPENSE_CRITERION_REPLIES.deliveredTh : LINE_AI_EXPENSE_CRITERION_REPLIES.generalTh,
        deterministicExpenseCriterionConfirmation: true,
      };
    }
    const noAttachments = (req.attachments?.length ?? 0) === 0;
    const mentionsExpense = /(?:ค่าใช้จ่าย|รายจ่าย|\bexpenses?\b|\bspend\b)/iu.test(req.messageText);
    const mentionsOtherBusinessTopic = /(?:ภาษี|\bvat\b|ภ\.?พ\.?\s*\d*|ยอดขาย|การขาย|ขาย|\bsales?\b|สต็อก|สินค้า|\bstock\b|รายได้|\bincome\b|ลูกค้า|\bcrm\b|จัดซื้อ|\bprocurement\b)/iu.test(req.messageText);
    const asksExpenseDetail = /(?:เลขที่|สถานะ|รายละเอียด|ใบเสร็จ|บิล|เอกสาร|ผู้ขาย|ผู้รับเงิน|ขอรายการ|ดูรายการ|แสดงรายการ|รายการอะไร|รายการไหน|อะไรบ้าง|ไหนบ้าง|receipt|invoice|vendor|status|detail|\bexp[-\s]?\d{2,}\b)/iu.test(req.messageText);
    if (noAttachments && mentionsExpense && !mentionsOtherBusinessTopic && uncertainExpenseFilter(req.messageText, hasPriorExpenseContext)) {
      const expenseTool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.list_recent');
      const access = expenseTool ? toolAccessOutcome(expenseTool, req.userContext) : 'forbidden';
      if (access === 'feature_disabled') return this.buildRefusedResponse(req, 'feature_disabled', featureDisabledReply(['expense.list_recent'], req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions), startMs);
      if (access !== 'allowed') return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs);
      return {
        ...this.baseResponse(req, 'read_summary', 'accounting', startMs),
        replyText: ((req.language ?? lineReplyLanguage(req.messageText)) === 'en' ? 'Which expenses should I include or exclude from this summary?' : 'ยังระบุเงื่อนไขรายการค่าใช้จ่ายที่ต้องการรวมออกไม่ได้ค่ะ ต้องการรวมหรือตัดรายการแบบใดออกคะ'),
      };
    }
    if (noAttachments && mentionsExpense && !mentionsOtherBusinessTopic && asksExpenseDetail) {
      const expenseDetailTool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.get_detail');
      const access = expenseDetailTool ? toolAccessOutcome(expenseDetailTool, req.userContext) : 'forbidden';
      if (access === 'feature_disabled') {
        return this.buildRefusedResponse(req, 'feature_disabled', featureDisabledReply(['expense.get_detail'], req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions), startMs);
      }
      if (access !== 'allowed') return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs);
      return {
        ...this.buildRefusedResponse(req, 'unsupported_yet', 'LINE เวอร์ชันนี้ยังแสดงรายละเอียดค่าใช้จ่ายตามเลขที่หรือสถานะไม่ได้ค่ะ กรุณาเปิดเว็บเพื่อตรวจสอบค่ะ', startMs, 'read_detail', 'accounting'),
        webLinks: [{ label: 'เปิดรายการค่าใช้จ่ายในเว็บ', path: `/companies/${req.userContext.companyId}/expenses` }],
      };
    }
    const hasExpenseSummaryIntent = noAttachments && mentionsExpense && !mentionsOtherBusinessTopic && !asksExpenseDetail;
    const expenseTool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.list_recent');
    const hasExpenseFollowupContext = noAttachments && !mentionsOtherBusinessTopic && !asksExpenseDetail
      && (req.conversationContext?.deliveredExpenseSummary?.ranges.length ?? 0) > 0
      && (expenseBranchScopeRequested(req.messageText) || allExpenseBranchesRequested(req.messageText)
        || unsupportedExpenseFilter(req.messageText, hasPriorExpenseContext)
        || uncertainExpenseFilter(req.messageText, hasPriorExpenseContext)
        || /(?:เดือนก่อนหน้า|เดือนก่อนหน้านั้น|เดือนที่แล้ว|เดือนนี้|ยอดล่าสุด|ช่วงเดิม|อันนี้|อันนั้น|previous month|month before|latest|same period)/iu.test(req.messageText));
    let expenseToolForPath: (typeof LINE_TOOL_REGISTRY)[number] | undefined;
    let currentExpenseRequestValidated = false;
    if (hasExpenseSummaryIntent || hasExpenseFollowupContext) {
      const access = expenseTool ? toolAccessOutcome(expenseTool, req.userContext) : 'forbidden';
      if (access === 'feature_disabled') {
        return this.buildRefusedResponse(req, 'feature_disabled', featureDisabledReply(['expense.list_recent'], req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions), startMs);
      }
      if (access !== 'allowed') return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs);
      const periods = req.valueCandidates?.periods ?? [];
      const dates = req.valueCandidates?.dates ?? [];
      const inherited = req.conversationContext?.deliveredExpenseSummary?.ranges ?? [];
      const monthsMentioned = thaiExpenseMonthMentions(req.messageText);
      const currentRange = currentBangkokMonthRange();
      const explicitCurrentRange = periods.length === 1 && dates.length === 0
        && periods[0]?.fromDate === currentRange.fromDate && periods[0]?.toDate === currentRange.toDate;
      const explicitCurrentCue = /(?:เดือนนี้|เดือนปัจจุบัน|this month|current month)/iu.test(req.messageText)
        && periods.length === 0 && dates.length === 0 && monthsMentioned.length === 0;
      const latestCue = /(?:ยอดล่าสุด|ล่าสุด|ปัจจุบัน|ตอนนี้|latest|recent|current)/iu.test(req.messageText)
        && periods.length === 0 && dates.length === 0 && monthsMentioned.length === 0;
      const priorRelative = /(?:เดือนก่อนหน้า|เดือนก่อนหน้านั้น|เดือนที่แล้ว|previous month|month before)/iu.test(req.messageText);
      const explicitDateText = /\b\d{4}[-/]\d{1,2}[-/]?\d{0,2}\b/u.test(req.messageText);
      const hasUnsafeScope = unsupportedExpenseFilter(req.messageText, hasPriorExpenseContext)
        || uncertainExpenseFilter(req.messageText, hasPriorExpenseContext)
        || expenseBranchScopeRequested(req.messageText) || allExpenseBranchesRequested(req.messageText)
        || priorRelative || explicitDateText
        || (periods.length > 0 && !explicitCurrentRange)
        || dates.length > 0
        || (monthsMentioned.length > 0 && !(monthsMentioned.length === 1 && explicitCurrentRange));
      const hasUsableCurrentPeriod = !hasUnsafeScope
        && (periods.length === 0 || explicitCurrentRange)
        && (inherited.length === 0 || explicitCurrentRange || explicitCurrentCue || latestCue);
      if (!hasUsableCurrentPeriod) {
        const followupReply = hasExpenseFollowupContext || inherited.length > 0
          ? 'LINE เวอร์ชันนี้ยังตรวจช่วงค่าใช้จ่ายที่ติดตามไว้ไม่ได้ค่ะ กรุณาระบุช่วงวันที่ครบทั้งวันเริ่มต้นและวันสิ้นสุด หรือเปิดเว็บเพื่อตรวจสอบค่ะ'
          : 'LINE เวอร์ชันนี้ยังตรวจช่วงค่าใช้จ่ายที่ระบุไม่ได้ค่ะ กรุณาถามยอดของเดือนปัจจุบัน หรือเปิดเว็บเพื่อตรวจสอบค่ะ';
        return {
          ...this.buildRefusedResponse(req, 'unsupported_yet', followupReply, startMs, 'read_summary', 'accounting'),
          webLinks: [{ label: 'เปิดรายการค่าใช้จ่ายในเว็บ', path: `/companies/${req.userContext.companyId}/expenses` }],
        };
      }
      if (!expenseTool) return this.buildRefusedResponse(req, 'tool_unavailable', ERROR_REPLY, startMs, 'read_summary', 'accounting');
      expenseToolForPath = expenseTool;
      currentExpenseRequestValidated = true;
    }
    const text = req.messageText.toLowerCase().trim();
    const intent = classifyIntent(text, (req.attachments?.length ?? 0) > 0);
    const agent = chooseAgent(intent, text);
    const refusalReason = getRefusalReason(intent);

    if (refusalReason) {
      // Spec §5.3: this path classifies by keyword alone, and its Thai list is all in-system
      // subjects (บัญชี, ภาษี, เงินเดือน, งบดุล). The trusted intake intent, not the keyword, decides
      // whether the honest answer is "outside the system" or "not on LINE yet".
      const businessIntake = isBusinessIntakeIntent(req.intakeIntent);
      const outOfScope = intent === 'unsupported_module' || intent === 'unknown';
      if (outOfScope && businessIntake) {
        return {
          ...this.buildRefusedResponse(req, 'unsupported_yet', UNSUPPORTED_YET_REPLY, startMs, intent, agent),
          webLinks: [{ label: 'เปิดรายการในเว็บ', path: `/companies/${req.userContext.companyId}/expenses` }],
        };
      }
      const replyText = intent === 'mutation_request' ? MUTATION_REPLY : outOfScope ? UNSUPPORTED_REPLY : FORBIDDEN_REPLY;
      return this.buildRefusedResponse(req, refusalReason, replyText, startMs, intent, agent);
    }

    const tools = expenseToolForPath ? [expenseToolForPath] : selectTools(agent, intent, text);
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
      chatKeyHash: req.userContext.chatKeyHash,
      actorDelegations: req.actorDelegations,
    };

    const plannedTools = tools.slice(0, 3);
    const featureDisabledTools = plannedTools.filter((tool) => toolAccessOutcome(tool, req.userContext) === 'feature_disabled');
    const forbiddenTools = plannedTools.filter((tool) => toolAccessOutcome(tool, req.userContext) === 'forbidden');
    const topTools = plannedTools.filter((tool) => toolAccessOutcome(tool, req.userContext) === 'allowed');
    if (topTools.length === 0 && featureDisabledTools.length > 0 && forbiddenTools.length === 0) {
      return this.buildRefusedResponse(
        req,
        'feature_disabled',
        featureDisabledReply(featureDisabledTools.map((tool) => tool.name), req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions),
        startMs,
        intent,
        agent,
      );
    }
    if (topTools.length === 0 && forbiddenTools.length > 0) {
      return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs, intent, agent);
    }
    if (topTools.some(tool => tool.name === 'expense.list_recent') && !currentExpenseRequestValidated) {
      if (unsupportedExpenseFilter(req.messageText, hasPriorExpenseContext)) {
        return { ...this.baseResponse(req, intent, agent, startMs), refused: false,
          replyText: ((req.language ?? lineReplyLanguage(req.messageText)) === 'en' ? 'I cannot verify the expense total for these filters in LINE; please check the matching total on the web.' : 'ตอนนี้ LINE ยังยืนยันยอดค่าใช้จ่ายตามเงื่อนไขนี้ไม่ได้ค่ะ กรุณาตรวจสอบในเว็บเพื่อดูยอดตามเกณฑ์ที่ต้องการ') };
      }
      const inherited = req.conversationContext?.deliveredExpenseSummary?.ranges ?? [];
      const explicitPeriod = (req.valueCandidates?.periods?.length ?? 0) > 0 || (req.valueCandidates?.dates?.length ?? 0) > 0;
      const priorRelative = /(?:เดือนก่อนหน้า|เดือนก่อนหน้านั้น|previous month|month before)/iu.test(req.messageText);
      const branchScopeRequested = expenseBranchScopeRequested(req.messageText);
      const allBranchesRequested = allExpenseBranchesRequested(req.messageText);
      // This legacy path invokes read tools with `{}`. Any inherited result scope, including an
      // all-branch range, therefore needs a clarification instead of silently becoming current
      // month/all branches. The orchestrator path owns validated follow-up selection.
      if (explicitPeriod || branchScopeRequested || allBranchesRequested || priorRelative || inherited.length > 0) {
        return { ...this.baseResponse(req, intent, agent, startMs), refused: false,
          replyText: priorRelative && inherited.length === 0
            ? 'ขอทราบเดือนและปีที่ต้องการตรวจอีกครั้งได้ไหมคะ'
            : branchScopeRequested || allBranchesRequested || inherited.some(range => range.branchId !== null)
              ? 'LINE เวอร์ชันนี้ยังตรวจสาขาหรือช่วงติดตามเดิมไม่ได้ค่ะ กรุณาระบุช่วงวันที่ครบทั้งวันเริ่มต้นและวันสิ้นสุด หรือเปิดเว็บเพื่อตรวจสอบค่ะ'
              : inherited.length > 0
                ? 'LINE เวอร์ชันนี้ยังใช้ช่วงติดตามเดิมไม่ได้ค่ะ กรุณาระบุเดือนและปีที่ต้องการตรวจอีกครั้งนะคะ'
              : 'LINE เวอร์ชันนี้ยังตรวจช่วงที่ระบุไม่ได้ค่ะ กรุณาเปิดเว็บเพื่อตรวจสอบ หรือถามยอดของเดือนปัจจุบันค่ะ' };
      }
    }
    const toolInput = intent === 'capture_accounting_evidence' ? { attachments: req.attachments ?? [], messageText: req.messageText } : {};
    const results = await Promise.all(topTools.map((t) => this.erpTools.invoke(t, erpCtx, toolInput)));

    // Checked before the forbidden branch so a turn blocked purely by the company's feature switch
    // is never reported as a missing permission or as an empty business.
    if (results.length > 0 && results.every((r) => r.errorCode === FEATURE_NOT_ENABLED_CODE)) {
      return this.buildRefusedResponse(
        req,
        'feature_disabled',
        featureDisabledReply(topTools.map((tool) => tool.name), req.userContext.locale, req.packageOffers, req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys, req.userContext.permissions),
        startMs,
        intent,
        agent,
      );
    }

    if (results.every((r) => r.status === 'forbidden')) {
      return this.buildRefusedResponse(req, 'forbidden', FORBIDDEN_REPLY, startMs, intent, agent);
    }

    let replyText = buildCaptureReplyFromToolResults(results) ?? buildReplyFromToolResults(results);
    let deterministicExpenseSummary = false;
    // The locked card of a turn that is ONE successful read: the summary's rows from the formatter that
    // wrote the sentence, the open-work rows from that tool's own result. Several reads stay sentences.
    let layout: LineAiAnswerCardLayout | undefined;
    const expenseResult = results.find(result => result.toolName === 'expense.list_recent');
    if (expenseResult) {
      const formatted = expenseResult.status === 'ok'
        ? formatExpenseSummary(expenseResult.data && typeof expenseResult.data === 'object' && !Array.isArray(expenseResult.data)
          ? expenseResult.data as Record<string, unknown> : undefined,
        { language: /[\u0E00-\u0E7F]/u.test(req.messageText) ? 'th' : 'en', locale: req.userContext.locale },
        expenseResult.sourceRefs?.find(source => source.module === 'expenses' && source.entityType === 'expense_summary'), expenseResult.asOf)
        : { kind: 'unverified' as const };
      if (formatted.kind === 'answer') {
        replyText = formatted.replyText;
        if (results.length === 1) layout = formatted.layout;
        const data = expenseResult.data as Record<string, unknown>;
        const period = data['period'] as Record<string, unknown> | undefined;
        deterministicExpenseSummary = topTools.length === 1 && results.length === 1 && data['truncated'] !== true
          && period?.['defaultedToCurrentMonth'] === true
          && (!req.conversationContext?.deliveredExpenseSummary || currentExpenseRequestValidated);
      } else {
        replyText = ((req.language ?? lineReplyLanguage(req.messageText)) === 'en' ? 'I could not verify this expense summary; please try again or check it on the web.' : 'ยังไม่สามารถยืนยันสรุปค่าใช้จ่ายช่วงนี้ได้ค่ะ กรุณาลองใหม่อีกครั้งหรือเปิดเว็บเพื่อตรวจสอบ');
      }
    }
    const allSourceRefs = results.flatMap((r) => r.sourceRefs ?? []);
    const sourceLabels = [...new Set(allSourceRefs.map((s: SourceRef) => s.label))];
    const webLinks = allSourceRefs.filter((s: SourceRef) => !!s.webPath).map((s: SourceRef) => ({ label: s.label, path: s.webPath! }));
    const readResults = results.filter((result, index) => result.status === 'ok'
      && result.data !== undefined
      && result.data !== null
      && ['read_summary', 'read_detail', 'report'].includes(topTools[index]?.category ?? ''));
    if (results.length === 1 && readResults.length === 1 && OPEN_WORK_TOOLS.has(readResults[0]!.toolName)) {
      layout = openWorkCardLayout(readResults[0]!.toolName, readResults[0]!.data, readResults[0]!.asOf);
    }
    const presentation = readResults.length > 0 ? {
      kind: 'answer_cards' as const,
      cards: readResults.slice(0, 12).map((result) => {
        const refs = result.sourceRefs ?? [];
        const labels = [...new Set(refs.map((source) => source.label))];
        const link = refs.find((source) => source.webPath);
        return {
          text: readResults.length === 1 ? replyText : buildReplyFromToolResults([result]),
          ...(layout && readResults.length === 1 ? { layout } : {}),
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
      ...(deterministicExpenseSummary ? { deterministicExpenseSummary: true } : {}),
      ...(presentation ? { presentation } : {}),
    };
  }

  private buildRefusedResponse(req: LineAiTurnRequest, refusalReason: any, replyText: string, startMs: number, intent: any = 'unknown', agent: any = 'general'): LineAiTurnResponse {
    if ((req.language ?? lineReplyLanguage(req.messageText)) === 'en') {
      const copy: Record<string, string> = { forbidden: 'You do not have access; ask the shop owner or an authorized administrator.',
        mutation_blocked: 'Please complete this action in the web app.', unsupported_module: 'This feature is unavailable in LINE; please use the web app.',
        unsupported_yet: 'This task is available in the web app.', feature_disabled: 'This feature is not enabled for your shop.',
        tool_unavailable: 'The information is temporarily unavailable; please try again shortly.', ai_timeout: 'This request timed out; please send your question again.' };
      // Only the built-in refusal copy is selected here; already-English specific explanations remain intact.
      if (/[\u0E00-\u0E7F]/u.test(replyText)) replyText = copy[refusalReason] ?? 'This request is unavailable; please try again or use the web app.';
    }
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
