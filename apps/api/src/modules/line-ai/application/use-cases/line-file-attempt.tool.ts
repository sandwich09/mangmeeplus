import { Injectable } from '@nestjs/common';
import type { SourceRef, ToolResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { absoluteWebLink } from '../../../../common/http/web-link';
import { ExpenseCaptureLineUseCase } from '../../../expenses/application/use-cases/expense-capture-line.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_LIMIT = 5;

/**
 * Appendix §10.1 — `line.explain_file_attempt`.
 *
 * The read behind "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" when the turn goes through the model instead of the
 * deterministic §17.5 handler. It returns STRUCTURE only: stage, reason code, the capability that
 * applied at the time, the current state of whatever the file became, and the one recovery action
 * that is real. Every confirming sentence still comes from the API's own templates — the model may
 * phrase the explanation, never invent the cause (§17.5 "ข้อความยืนยันสาเหตุมาจาก template ของ API
 * เท่านั้น").
 *
 * No mutation, no OCR, no quota: asking why something failed must never cost a read.
 */
@Injectable()
export class LineExplainFileAttemptTool implements ErpReadToolPort<{ attemptRef?: string }> {
  toolName = 'line.explain_file_attempt';

  constructor(
    private readonly captureLine: ExpenseCaptureLineUseCase,
    private readonly config: AppConfigService,
  ) {}

  async execute(ctx: ErpToolContext, input: { attemptRef?: string } = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const listRef: SourceRef = {
      label: 'ไฟล์ที่ส่งเข้ามาทาง LINE', module: 'line-ai', entityType: 'line_intake_attempt',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses`,
    };
    // Without chat provenance there is no chat to scope to, and a company-wide read of who sent
    // which file is not something a chat answer may see.
    if (!ctx.chatKeyHash) {
      return { toolName: this.toolName, status: 'ok', data: { attempts: [] }, sourceRefs: [listRef], asOf, errorCode: 'LINE_CHAT_CONTEXT_MISSING' };
    }
    const rows = await this.captureLine.listChatIntakeAttempts({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: ctx.chatKeyHash,
      since: new Date(Date.now() - ATTEMPT_WINDOW_MS), take: ATTEMPT_LIMIT,
    });
    const wanted = input.attemptRef ? rows.filter((row) => row.id === input.attemptRef) : rows;
    const attempts = await Promise.all(wanted
      // ROUTE rows are this lane's own bookkeeping (the A45 question, an ambiguity list) — they are
      // not files anyone sent, so they are never reported as one.
      .filter((row) => row.stage !== 'ROUTE')
      .map(async (row) => {
        const currentStatus = row.targetType === 'capture_group' && row.targetId
          ? await this.currentGroupStatus(ctx.companyId, row.targetId)
          : null;
        return {
          ref: row.id,
          messageType: row.messageType,
          fileNameSanitized: row.fileNameSanitized,
          stage: row.stage,
          reasonCode: row.reasonCode,
          capability: row.capabilityJson,
          declaredFileSize: row.declaredFileSize,
          measuredByteSize: row.measuredByteSize,
          outcome: row.outcome,
          occurredAt: row.createdAt.toISOString(),
          currentStatus,
          recoveryAction: this.recoveryAction(ctx.companyId, row.outcome, row.targetType, row.targetId),
        };
      }));
    return { toolName: this.toolName, status: 'ok', data: { attempts }, sourceRefs: [listRef], asOf };
  }

  private async currentGroupStatus(companyId: string, groupId: string): Promise<string | null> {
    const snapshot = await this.captureLine.readFinishedSnapshot(companyId, groupId).catch(() => null);
    if (!snapshot) return null;
    const statuses = snapshot.jobs.map((job) => job.status);
    if (statuses.includes('FAILED')) return 'READ_FAILED';
    if (statuses.includes('PAUSED') || statuses.includes('PARTIAL')) return 'READ_PARTIAL';
    if (statuses.length > 0 && statuses.every((status) => status === 'DONE')) return 'READ_DONE';
    return statuses.length > 0 ? 'READING' : snapshot.group.status;
  }

  /** ONE action, and only one that exists: a rejected file is resent, a stored one is opened. */
  private recoveryAction(
    companyId: string,
    outcome: string,
    targetType: string | null,
    targetId: string | null,
  ): { kind: string; url?: string } {
    if (outcome === 'REJECTED') return { kind: 'resend' };
    if (targetType === 'capture_group' && targetId) {
      return { kind: 'open_web', url: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/capture/${targetId}`) };
    }
    if (targetType === 'expense' && targetId) {
      return { kind: 'open_web', url: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${targetId}`) };
    }
    return { kind: 'wait' };
  }
}
