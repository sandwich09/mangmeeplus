import { Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, UpsertWorkflowWebhookEndpointInput, WorkflowWebhookEndpointSummary } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { toWebhookEndpointSummary } from '../dto/workflow.mapper';
import { assertWebhookUrlPolicy, WebhookPolicyError } from '../../domain/logic/workflow-webhook-security.logic';

@Injectable()
export class ListWorkflowWebhookEndpointsUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext): Promise<WorkflowWebhookEndpointSummary[]> {
    if (!ctx.permissions.includes('workflow.webhook.manage')) throw new ForbiddenException('Missing permission: workflow.webhook.manage');
    const rows = await this.repo.listWebhookEndpoints(ctx.companyId);
    return rows.map(toWebhookEndpointSummary);
  }
}

@Injectable()
export class CreateWorkflowWebhookEndpointUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // New endpoints are always created DISABLED — admin must explicitly enable
  // (see SetWorkflowWebhookEndpointStatusUseCase) once the URL/allowlist is verified.
  async execute(ctx: RequestContext, input: UpsertWorkflowWebhookEndpointInput): Promise<WorkflowWebhookEndpointSummary> {
    if (!ctx.permissions.includes('workflow.webhook.manage')) throw new ForbiddenException('Missing permission: workflow.webhook.manage');
    if (!input.name || !input.url) throw new BadRequestException('name and url are required');
    try {
      assertWebhookUrlPolicy(input.url, this.config.workflowWebhookAllowedHosts);
    } catch (error) {
      if (error instanceof WebhookPolicyError) {
        // L-14: an SSRF/allowlist denial is an attack signal, not just a validation error.
        emitSecurityEvent(new Logger(CreateWorkflowWebhookEndpointUseCase.name), SECURITY_EVENT.workflowWebhookBlocked, 'HIGH', {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          requestId: ctx.requestId,
          reason: error.message,
        });
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (!input.secretRef) throw new BadRequestException('secretRef (signing secret) is required');
    if (!Array.isArray(input.allowedEventTypes) || input.allowedEventTypes.length === 0) {
      throw new BadRequestException('allowedEventTypes must be a non-empty array');
    }

    const encryptedSecret = encryptCredential(input.secretRef, this.config.credentialEncryptionKey);
    const created = await this.repo.createWebhookEndpoint({
      companyId: ctx.companyId,
      name: input.name,
      url: input.url,
      allowedEventTypes: input.allowedEventTypes,
      secretRef: encryptedSecret,
      createdByUserId: ctx.userId,
    });

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.webhook.create',
      targetType: 'workflow_webhook_endpoint', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { url: created.url, allowedEventTypes: created.allowedEventTypes },
    });
    return toWebhookEndpointSummary(created);
  }
}

@Injectable()
export class SetWorkflowWebhookEndpointStatusUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, enabled: boolean): Promise<WorkflowWebhookEndpointSummary> {
    if (!ctx.permissions.includes('workflow.webhook.manage')) throw new ForbiddenException('Missing permission: workflow.webhook.manage');
    const endpoint = await this.repo.findWebhookEndpointById(ctx.companyId, id);
    if (!endpoint) throw new NotFoundException('Workflow webhook endpoint not found');
    if (enabled && endpoint.allowedEventTypes.length === 0) {
      throw new UnprocessableEntityException('Cannot enable a webhook endpoint with no allowed event types');
    }

    const updated = await this.repo.updateWebhookEndpoint(ctx.companyId, id, { status: enabled ? 'ENABLED' : 'DISABLED' });
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: enabled ? 'workflow.webhook.enable' : 'workflow.webhook.disable',
      targetType: 'workflow_webhook_endpoint', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
    });
    return toWebhookEndpointSummary(updated);
  }
}
