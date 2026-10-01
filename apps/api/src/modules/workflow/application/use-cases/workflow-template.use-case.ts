import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, WorkflowTemplateSummary, WorkflowRuleSummary, EnableWorkflowTemplateInput } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import type { WorkflowRuleRecord } from '../../domain/models/workflow.model';
import { AuditService } from '../../../audit/application/audit.service';
import { toTemplateSummary, toRuleSummary } from '../dto/workflow.mapper';
import { createRuleVersionAndEnable } from './workflow-rule.use-case';
import { WORKFLOW_DEFAULT_COOLDOWN_SECONDS, WORKFLOW_DEFAULT_TIMEZONE } from '../../domain/workflow.constants';
import {
  WORKFLOW_TEMPLATE_CATALOG,
  WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS,
  WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG,
  WORKFLOW_TEMPLATE_FOLLOWS_SIBLING,
} from '../../domain/workflow-template-catalog';

/** Catalog cooldown for a template key, falling back to the global default. */
export function templateCooldownSeconds(templateKey: string): number {
  return WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS[templateKey] ?? WORKFLOW_DEFAULT_COOLDOWN_SECONDS;
}

/** Recorded as createdBy/enabledBy on rules nobody clicked "enable" on. Not an FK. */
export const WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID = 'system:workflow-template-sync';

/**
 * Zero-admin-setup enablement for `autoEnable` catalog templates, shared by
 * prisma/sync-workflow-templates.ts (existing companies, once per release) and company
 * onboarding (fresh companies, no release run needed).
 *
 * Creates a rule ONLY when the company has no rule for that template in ANY status, so an
 * admin who disabled or archived one keeps that decision. Never updates an existing rule,
 * which also makes a second run a no-op. Uses the same createRule + createRuleVersionAndEnable
 * primitives as EnableWorkflowTemplateUseCase, so an auto-enabled rule is indistinguishable
 * from an admin-enabled one (version snapshot, default trigger config, ENABLED status).
 *
 * `repo` may be built over a transaction client — the caller owns the transaction.
 */
export async function autoEnableWorkflowTemplatesForCompany(
  repo: PrismaWorkflowRepository,
  companyId: string,
  actorUserId: string = WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
): Promise<string[]> {
  const enabledKeys: string[] = [];
  for (const seed of WORKFLOW_TEMPLATE_CATALOG) {
    if (!seed.autoEnable) continue;
    const template = await repo.findTemplateByKey(seed.key);
    if (!template || template.status !== 'AVAILABLE') continue;
    const existing = await repo.listRules({ companyId, templateId: template.id });
    if (existing.length > 0) continue;

    const rule = await repo.createRule({
      companyId,
      templateId: template.id,
      name: template.name,
      description: template.description,
      triggerType: template.triggerType,
      triggerConfigJson: WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[template.key] ?? {},
      conditionJson: template.defaultConditionJson,
      actionJson: template.defaultActionJson,
      recipientConfigJson: {},
      cooldownSeconds: templateCooldownSeconds(template.key),
      timezone: WORKFLOW_DEFAULT_TIMEZONE,
      createdByUserId: actorUserId,
    });
    if (await siblingRuleSwitchedOff(repo, companyId, seed.key)) {
      // Created, so a later run does not create it again, but left for the admin to switch on.
      await repo.updateRule(companyId, rule.id, { status: 'DISABLED', disabledByUserId: actorUserId, disabledAt: new Date(), updatedByUserId: actorUserId });
      continue;
    }
    await createRuleVersionAndEnable(repo, rule, actorUserId);
    enabledKeys.push(template.key);
  }
  return enabledKeys;
}

/** The company has the sibling notice of this template, and none of its rules is switched on. */
async function siblingRuleSwitchedOff(repo: PrismaWorkflowRepository, companyId: string, templateKey: string): Promise<boolean> {
  const siblingKey = WORKFLOW_TEMPLATE_FOLLOWS_SIBLING[templateKey];
  const sibling = siblingKey ? await repo.findTemplateByKey(siblingKey) : null;
  if (!sibling) return false;
  const rules = await repo.listRules({ companyId, templateId: sibling.id });
  return rules.length > 0 && !rules.some((rule) => rule.status === 'ENABLED');
}

/**
 * The release-time sweep of approval tasks whose claim has moved on. It is housekeeping: a failure
 * is reported and swallowed, because the release step it rides on (template sync) must not fail for
 * it. The event handler closes the same tasks as claims move, and the next release sweeps again.
 */
export async function closeSettledClaimTasksAtRelease(
  repo: PrismaWorkflowRepository,
  report: (message: string, error: unknown) => void = console.error,
): Promise<number | null> {
  try {
    return await repo.closeSettledClaimTasks();
  } catch (error) {
    report('Workflow template sync: closing stale approval tasks failed; the release continues.', error);
    return null;
  }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Catch-up for companies whose rules were materialized before the catalog changed — autoEnable
 * only ever CREATES, so without this a template fix reaches new companies and nobody else. Two
 * shipped bugs needed it: the EVENT reimbursement rules carried the 1h default cooldown (one
 * claim's notification silenced the rest of the hour) and their notify actions carried the old
 * recipients/body. Runs from prisma/sync-workflow-templates.ts.
 *
 * Only rules this same seam created AND nobody has edited since are re-pinned, so an
 * admin-created rule or any admin edit (cooldown, recipients, condition) always wins. "Edited" is
 * decided by content, not by who touched the rule last (see `stillAsPinned`). ARCHIVED
 * rules are left alone (UpdateWorkflowRuleUseCase refuses to edit them). An ENABLED rule also
 * gets a new ENABLED version because the runner reads the version snapshot, not the mutable row;
 * a DISABLED/DRAFT rule only needs the row, which its next enable snapshots.
 */
export async function resyncWorkflowTemplateRulesForCompany(
  repo: PrismaWorkflowRepository,
  companyId: string,
  actorUserId: string = WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
): Promise<string[]> {
  const resyncedKeys: string[] = [];
  for (const seed of WORKFLOW_TEMPLATE_CATALOG) {
    if (!seed.autoEnable) continue;
    const template = await repo.findTemplateByKey(seed.key);
    if (!template) continue;
    // Exactly what autoEnable would create today, minus the identity fields an admin may rename.
    const desired = {
      triggerConfigJson: WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[template.key] ?? {},
      conditionJson: template.defaultConditionJson,
      actionJson: template.defaultActionJson,
      cooldownSeconds: templateCooldownSeconds(template.key),
    };
    for (const rule of await repo.listRules({ companyId, templateId: template.id })) {
      if (rule.status === 'ARCHIVED') continue;
      if (rule.createdBy !== WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID) continue;
      if (rule.updatedBy && rule.updatedBy !== WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID && !(await stillAsPinned(repo, rule))) continue;

      const version = rule.status === 'ENABLED' ? await repo.findLatestRuleVersion(rule.id) : null;
      const rowCurrent = rule.cooldownSeconds === desired.cooldownSeconds
        && sameJson(rule.triggerConfigJson, desired.triggerConfigJson)
        && sameJson(rule.conditionJson, desired.conditionJson)
        && sameJson(rule.actionJson, desired.actionJson);
      const versionCurrent = version == null
        || (version.cooldownSeconds === desired.cooldownSeconds
          && sameJson(version.triggerSnapshotJson, desired.triggerConfigJson)
          && sameJson(version.conditionSnapshotJson, desired.conditionJson)
          && sameJson(version.actionSnapshotJson, desired.actionJson));
      if (rowCurrent && versionCurrent) continue;

      const updated = await repo.updateRule(companyId, rule.id, { ...desired, updatedByUserId: actorUserId });
      if (rule.status === 'ENABLED') await createRuleVersionAndEnable(repo, updated, actorUserId);
      resyncedKeys.push(seed.key);
    }
  }
  return resyncedKeys;
}

/**
 * Whether a rule the sync created still holds exactly what the sync pinned on it. Switching a rule
 * off and on stamps the admin's id on it without changing a thing, and reading that stamp as an
 * edit left such a company on the old definition for good. An edit is a difference in content: the
 * rule's trigger, condition, action or cooldown no longer equal any version the sync itself wrote
 * on this rule, which are the defaults this rule was ever shipped.
 */
async function stillAsPinned(repo: PrismaWorkflowRepository, rule: WorkflowRuleRecord): Promise<boolean> {
  const versions = await repo.listRuleVersions(rule.id);
  return versions.some((version) => version.createdBy === WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID
    && version.cooldownSeconds === rule.cooldownSeconds
    && sameJson(version.triggerSnapshotJson, rule.triggerConfigJson)
    && sameJson(version.conditionSnapshotJson, rule.conditionJson)
    && sameJson(version.actionSnapshotJson, rule.actionJson));
}

@Injectable()
export class ListWorkflowTemplatesUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext): Promise<WorkflowTemplateSummary[]> {
    if (!ctx.permissions.includes('workflow.template.read')) throw new ForbiddenException('Missing permission: workflow.template.read');
    const rows = await this.repo.listTemplates();
    return rows.map(toTemplateSummary);
  }
}

@Injectable()
export class EnableWorkflowTemplateUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, templateKey: string, input: EnableWorkflowTemplateInput): Promise<WorkflowRuleSummary> {
    if (!ctx.permissions.includes('workflow.rule.manage') || !ctx.permissions.includes('workflow.rule.enable')) {
      throw new ForbiddenException('Missing permission: workflow.rule.manage and workflow.rule.enable');
    }
    const template = await this.repo.findTemplateByKey(templateKey);
    if (!template) throw new NotFoundException('Workflow template not found');
    if (template.status !== 'AVAILABLE') {
      throw new UnprocessableEntityException(`Template is not available: ${template.unavailableReason ?? 'unknown reason'}`);
    }
    for (const perm of template.requiredPermissions) {
      if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing required permission for template: ${perm}`);
    }

    const created = await this.repo.createRule({
      companyId: ctx.companyId,
      templateId: template.id,
      name: input.name ?? template.name,
      description: input.description ?? template.description,
      triggerType: template.triggerType,
      triggerConfigJson: input.triggerConfigJson ?? WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[templateKey] ?? {},
      conditionJson: input.conditionJson ?? template.defaultConditionJson,
      actionJson: input.actionJson ?? template.defaultActionJson,
      recipientConfigJson: input.recipientConfigJson ?? {},
      cooldownSeconds: input.cooldownSeconds ?? templateCooldownSeconds(templateKey),
      timezone: input.timezone ?? WORKFLOW_DEFAULT_TIMEZONE,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.template.enable',
      targetType: 'workflow_rule', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { templateKey },
    });

    if (!input.activate) return toRuleSummary(created);

    const enabled = await createRuleVersionAndEnable(this.repo, created, ctx.userId);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.rule.enable',
      targetType: 'workflow_rule', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { templateKey, version: enabled.currentVersion },
    });
    return toRuleSummary(enabled);
  }
}
