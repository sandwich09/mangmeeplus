import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateWorkflowRuleInput,
  UpdateWorkflowRuleInput,
  ListWorkflowRulesFilter,
  WorkflowRuleSummary,
  WorkflowRuleDetail,
  WorkflowRuleTestResult,
} from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { validateConditionTree, evaluateCondition } from '../../domain/logic/workflow-condition.logic';
import { validateActionDefinitions } from '../../domain/logic/workflow-action.logic';
import { buildRuleVersionSnapshot } from '../../domain/logic/workflow-idempotency.logic';
import { hasSourceModuleAccess } from '../../domain/logic/workflow-permission.logic';
import { WORKFLOW_DEFAULT_COOLDOWN_SECONDS, WORKFLOW_DEFAULT_TIMEZONE } from '../../domain/workflow.constants';
import { toRuleSummary, toRuleDetail } from '../dto/workflow.mapper';
import type { WorkflowRuleRecord } from '../../domain/models/workflow.model';

function assertValidRuleShape(conditionJson: unknown, actionJson: unknown): void {
  const conditionErrors = validateConditionTree(conditionJson as any);
  if (conditionErrors.length > 0) throw new BadRequestException(`Invalid conditionJson: ${conditionErrors.join('; ')}`);
  const actionErrors = validateActionDefinitions(actionJson as any);
  if (actionErrors.length > 0) throw new BadRequestException(`Invalid actionJson: ${actionErrors.join('; ')}`);
}

function assertSourceModuleAccess(ctx: RequestContext, sourceModule?: string): void {
  if (!hasSourceModuleAccess(ctx.permissions, sourceModule)) {
    throw new ForbiddenException(`Missing source-module permission to manage/read rules for module: ${sourceModule}`);
  }
}

@Injectable()
export class CreateWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: CreateWorkflowRuleInput): Promise<WorkflowRuleSummary> {
    if (!ctx.permissions.includes('workflow.rule.manage')) throw new ForbiddenException('Missing permission: workflow.rule.manage');

    let sourceModule: string | undefined;
    if (input.templateId) {
      const template = await this.repo.findTemplateById(input.templateId);
      if (!template) throw new NotFoundException('Workflow template not found');
      sourceModule = template.sourceModule;
      assertSourceModuleAccess(ctx, sourceModule);
      for (const perm of template.requiredPermissions) {
        if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing required permission for template: ${perm}`);
      }
    }

    assertValidRuleShape(input.conditionJson, input.actionJson);

    const created = await this.repo.createRule({
      companyId: ctx.companyId,
      templateId: input.templateId,
      name: input.name,
      description: input.description,
      triggerType: input.triggerType,
      triggerConfigJson: input.triggerConfigJson ?? {},
      conditionJson: input.conditionJson,
      actionJson: input.actionJson,
      recipientConfigJson: input.recipientConfigJson ?? {},
      cooldownSeconds: input.cooldownSeconds ?? WORKFLOW_DEFAULT_COOLDOWN_SECONDS,
      timezone: input.timezone ?? WORKFLOW_DEFAULT_TIMEZONE,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.rule.create',
      targetType: 'workflow_rule', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { triggerType: created.triggerType, templateId: created.templateId },
    });
    return toRuleSummary(created);
  }
}

@Injectable()
export class ListWorkflowRulesUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, filter: ListWorkflowRulesFilter): Promise<{ items: WorkflowRuleSummary[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('workflow.rule.read')) throw new ForbiddenException('Missing permission: workflow.rule.read');

    const rows = (await this.repo.listRules({
      companyId: ctx.companyId,
      status: filter.status,
      triggerType: filter.triggerType,
      sourceModule: filter.sourceModule,
      templateId: filter.templateId,
      search: filter.search,
    })).filter((r) => hasSourceModuleAccess(ctx.permissions, r.template?.sourceModule));

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize).map(toRuleSummary), total: rows.length, page, pageSize };
  }
}

@Injectable()
export class GetWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<WorkflowRuleDetail> {
    if (!ctx.permissions.includes('workflow.rule.read')) throw new ForbiddenException('Missing permission: workflow.rule.read');
    const rule = await this.repo.findRuleById(ctx.companyId, id);
    if (!rule) throw new NotFoundException('Workflow rule not found');
    assertSourceModuleAccess(ctx, rule.template?.sourceModule);
    return toRuleDetail(rule);
  }
}

@Injectable()
export class UpdateWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, input: UpdateWorkflowRuleInput): Promise<WorkflowRuleSummary> {
    if (!ctx.permissions.includes('workflow.rule.manage')) throw new ForbiddenException('Missing permission: workflow.rule.manage');
    const rule = await this.repo.findRuleById(ctx.companyId, id);
    if (!rule) throw new NotFoundException('Workflow rule not found');
    assertSourceModuleAccess(ctx, rule.template?.sourceModule);
    if (rule.status === 'ARCHIVED') throw new UnprocessableEntityException('Cannot edit an archived rule');

    const nextCondition = input.conditionJson ?? rule.conditionJson;
    const nextAction = input.actionJson ?? rule.actionJson;
    assertValidRuleShape(nextCondition, nextAction);

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.triggerConfigJson !== undefined) data.triggerConfigJson = input.triggerConfigJson;
    if (input.conditionJson !== undefined) data.conditionJson = input.conditionJson;
    if (input.actionJson !== undefined) data.actionJson = input.actionJson;
    if (input.recipientConfigJson !== undefined) data.recipientConfigJson = input.recipientConfigJson;
    if (input.cooldownSeconds !== undefined) data.cooldownSeconds = input.cooldownSeconds;
    if (input.timezone !== undefined) data.timezone = input.timezone;

    // Editing an enabled rule's behavior takes effect only on next enable (new version).
    // The mutable row is updated immediately, but historical runs keep prior version snapshots.
    const updated = await this.repo.updateRule(ctx.companyId, id, data);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.rule.update',
      targetType: 'workflow_rule', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
    });
    return toRuleSummary(updated);
  }
}

export async function createRuleVersionAndEnable(
  repo: PrismaWorkflowRepository,
  rule: WorkflowRuleRecord,
  userId: string,
): Promise<WorkflowRuleRecord> {
  const snapshot = buildRuleVersionSnapshot(rule);
  const nextVersion = rule.currentVersion + 1;
  await repo.createRuleVersion({
    ruleId: rule.id,
    companyId: rule.companyId,
    version: nextVersion,
    status: 'ENABLED',
    ...snapshot,
    createdByUserId: userId,
  });
  return repo.updateRule(rule.companyId, rule.id, {
    status: 'ENABLED',
    currentVersion: nextVersion,
    enabledByUserId: userId,
    enabledAt: new Date(),
    disabledByUserId: null,
    disabledAt: null,
    updatedByUserId: userId,
  });
}

@Injectable()
export class EnableWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string): Promise<WorkflowRuleSummary> {
    if (!ctx.permissions.includes('workflow.rule.enable')) throw new ForbiddenException('Missing permission: workflow.rule.enable');
    const rule = await this.repo.findRuleById(ctx.companyId, id);
    if (!rule) throw new NotFoundException('Workflow rule not found');
    assertSourceModuleAccess(ctx, rule.template?.sourceModule);
    if (rule.status === 'ARCHIVED') throw new UnprocessableEntityException('Cannot enable an archived rule');
    assertValidRuleShape(rule.conditionJson, rule.actionJson);

    if (rule.templateId) {
      const template = await this.repo.findTemplateById(rule.templateId);
      if (template?.status !== 'AVAILABLE') {
        throw new UnprocessableEntityException(`Template is not available: ${template?.unavailableReason ?? 'unknown reason'}`);
      }
      for (const perm of template.requiredPermissions) {
        if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing required permission to enable: ${perm}`);
      }
    }

    const updated = await createRuleVersionAndEnable(this.repo, rule, ctx.userId);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.rule.enable',
      targetType: 'workflow_rule', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { version: updated.currentVersion },
    });
    return toRuleSummary(updated);
  }
}

@Injectable()
export class DisableWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string): Promise<WorkflowRuleSummary> {
    if (!ctx.permissions.includes('workflow.rule.manage')) throw new ForbiddenException('Missing permission: workflow.rule.manage');
    const rule = await this.repo.findRuleById(ctx.companyId, id);
    if (!rule) throw new NotFoundException('Workflow rule not found');
    assertSourceModuleAccess(ctx, rule.template?.sourceModule);
    if (rule.status !== 'ENABLED') throw new UnprocessableEntityException(`Cannot disable a rule with status ${rule.status}`);

    const updated = await this.repo.updateRule(ctx.companyId, id, {
      status: 'DISABLED', disabledByUserId: ctx.userId, disabledAt: new Date(), updatedByUserId: ctx.userId,
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.rule.disable',
      targetType: 'workflow_rule', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
    });
    return toRuleSummary(updated);
  }
}

@Injectable()
export class TestWorkflowRuleUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  // Side-effect-free: evaluates condition/action plan against a sample payload and
  // performs no writes, no notifications, no tasks, no webhook calls.
  async execute(ctx: RequestContext, id: string, samplePayload: Record<string, unknown>): Promise<WorkflowRuleTestResult> {
    if (!ctx.permissions.includes('workflow.rule.manage')) throw new ForbiddenException('Missing permission: workflow.rule.manage');
    const rule = await this.repo.findRuleById(ctx.companyId, id);
    if (!rule) throw new NotFoundException('Workflow rule not found');
    assertSourceModuleAccess(ctx, rule.template?.sourceModule);

    const conditionResult = evaluateCondition(rule.conditionJson, samplePayload, new Date());
    return {
      conditionResult,
      actionPlan: conditionResult.matched ? rule.actionJson : [],
      sampleUsed: samplePayload,
    };
  }
}
