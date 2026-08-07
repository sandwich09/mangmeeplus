import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, CreateCrmFollowUpInput } from '@watchdog-bms/contracts';
import { CreateCrmFollowUpUseCase } from '../../../crm/application/use-cases/crm-follow-up.use-case';
import type { AiCandidateActionRecord } from '../../domain/models/ai-draft.model';
import { AI_SOURCE_DRAFT_UNAVAILABLE_ERROR, isSelfOwnedAction } from '../../domain/logic/ai-draft-safety.logic';

export type SourceDraftResult = {
  createdSourceModule: string;
  createdSourceRecordType: string;
  createdSourceRecordId: string;
  deepLink?: string;
};

// Creates a source-module draft record from a validated candidate action, calling the
// source module's own use-case (which re-checks source permission and validates the
// payload). Self-owned actions (review checklists) create no cross-module record.
@Injectable()
export class SourceDraftAdapterService {
  constructor(private readonly createCrmFollowUp: CreateCrmFollowUpUseCase) {}

  async createDraft(
    ctx: RequestContext,
    action: AiCandidateActionRecord,
    editedPayload?: Record<string, unknown>,
  ): Promise<SourceDraftResult> {
    const payload = { ...action.draftPayloadJson, ...(editedPayload ?? {}) };
    switch (action.actionType) {
      case 'CREATE_CRM_FOLLOW_UP_DRAFT':
        return this.crmFollowUp(ctx, payload);
      case 'CREATE_REVIEW_CHECKLIST':
      case 'CREATE_WORKFLOW_TASK':
        // Self-owned: recorded as an AI review checklist; no source-module mutation.
        return {
          createdSourceModule: 'ai-draft',
          createdSourceRecordType: 'review_checklist',
          createdSourceRecordId: action.id,
        };
      case 'NO_SOURCE_DRAFT_AVAILABLE':
        throw new UnprocessableEntityException(AI_SOURCE_DRAFT_UNAVAILABLE_ERROR);
      default:
        // Source module lacks a wired safe draft API in first pass — fall back to a
        // self-owned review checklist rather than performing a final mutation.
        throw new UnprocessableEntityException(`No source-draft adapter is wired for action ${action.actionType}`);
    }
  }

  supports(action: AiCandidateActionRecord): boolean {
    return action.actionType === 'CREATE_CRM_FOLLOW_UP_DRAFT' || isSelfOwnedAction(action.actionType);
  }

  private async crmFollowUp(ctx: RequestContext, payload: Record<string, unknown>): Promise<SourceDraftResult> {
    const customerId = typeof payload['customerId'] === 'string' ? (payload['customerId'] as string) : undefined;
    const title = typeof payload['title'] === 'string' ? (payload['title'] as string) : undefined;
    const dueAt = typeof payload['dueAt'] === 'string' ? (payload['dueAt'] as string) : new Date().toISOString();
    if (!customerId || !title) throw new UnprocessableEntityException('CRM follow-up draft requires customerId and title');
    const input: CreateCrmFollowUpInput = {
      customerId,
      title,
      dueAt,
      channel: (payload['channel'] as CreateCrmFollowUpInput['channel']) ?? 'PHONE',
      priority: (payload['priority'] as CreateCrmFollowUpInput['priority']) ?? 'NORMAL',
    };
    const created = await this.createCrmFollowUp.execute(ctx, input);
    return {
      createdSourceModule: 'crm',
      createdSourceRecordType: 'crm_follow_up',
      createdSourceRecordId: created.id,
      deepLink: `/companies/${ctx.companyId}/crm/customers/${customerId}`,
    };
  }
}
