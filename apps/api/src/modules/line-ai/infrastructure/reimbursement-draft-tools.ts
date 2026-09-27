import { Injectable } from '@nestjs/common';
import type { ToolResult } from '@watchdog-bms/contracts';
import { LineReimbursementDraftAdapterService } from '../application/line-reimbursement-draft-adapter.service';
import type { ErpReadToolPort, ErpToolContext } from '../domain/ports/erp-read-tool.port';

@Injectable()
export class ReimbursementDraftGetOptionsTool implements ErpReadToolPort {
  readonly toolName = 'reimbursement.draft.get_options';
  constructor(private readonly adapter: LineReimbursementDraftAdapterService) {}
  execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    return this.adapter.getOptions(ctx, input);
  }
}

@Injectable()
export class ReimbursementDraftPreviewCreateTool implements ErpReadToolPort {
  readonly toolName = 'reimbursement.draft.preview_create';
  constructor(private readonly adapter: LineReimbursementDraftAdapterService) {}
  execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    return this.adapter.preview(ctx, input, 'CREATE');
  }
}

@Injectable()
export class ReimbursementDraftPreviewUpdateTool implements ErpReadToolPort {
  readonly toolName = 'reimbursement.draft.preview_update';
  constructor(private readonly adapter: LineReimbursementDraftAdapterService) {}
  execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    return this.adapter.preview(ctx, input, 'UPDATE');
  }
}
