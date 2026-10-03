/**
 * Idempotent workflow-template sync for any environment (safe on production).
 * Upserts the code-defined global WorkflowTemplate catalog, then gives every ACTIVE company
 * an ENABLED rule for each `autoEnable` template it has NO rule for in any status — so the
 * reimbursement notification chain works with zero admin setup.
 *
 * Never modifies an admin's rule: an explicit disable/archive survives every run, and a second
 * run creates nothing. Fresh companies get the same rules at onboarding
 * (autoEnableWorkflowTemplatesForCompany is the shared seam), so this script only ever has to
 * catch up companies that predate a template.
 *
 * It also re-pins the rules IT created to the current catalog trigger/condition/action/cooldown
 * (resyncWorkflowTemplateRulesForCompany) — otherwise a template fix only ever reaches companies
 * created after it. Rules an admin created or edited are skipped there too.
 *
 * A rule still named its template's former default (English before 2026-10-03) gets the template's
 * current name (renameDefaultNamedTemplateRulesForCompany); a name the company chose is never touched.
 *
 * Last, it closes approval tasks whose claim no longer waits for approval (closeSettledClaimTasks).
 *
 * Runs on production boot after migrate deploy + sync-permissions.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { WORKFLOW_TEMPLATE_CATALOG } from '../src/modules/workflow/domain/workflow-template-catalog';
import { PrismaWorkflowRepository } from '../src/modules/workflow/infrastructure/prisma-workflow.repository';
import {
  autoEnableWorkflowTemplatesForCompany,
  closeSettledClaimTasksAtRelease,
  renameDefaultNamedTemplateRulesForCompany,
  resyncWorkflowTemplateRulesForCompany,
} from '../src/modules/workflow/application/use-cases/workflow-template.use-case';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const t of WORKFLOW_TEMPLATE_CATALOG) {
    const fields = {
      name: t.name,
      description: t.description,
      category: t.category,
      sourceModule: t.sourceModule,
      triggerType: t.triggerType as any,
      defaultConditionJson: t.defaultConditionJson as any,
      defaultActionJson: t.defaultActionJson as any,
      requiredPermissions: t.requiredPermissions as any,
      requiredSourceModules: t.requiredSourceModules as any,
      defaultEnabled: t.defaultEnabled,
      status: t.status as any,
      unavailableReason: t.unavailableReason ?? null,
    };
    await prisma.workflowTemplate.upsert({
      where: { key: t.key },
      update: fields,
      create: { key: t.key, ...fields },
    });
  }

  const repo = new PrismaWorkflowRepository({ client: prisma } as any);
  const companies = await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  let rulesCreated = 0;
  let companiesTouched = 0;
  let rulesResynced = 0;
  let rulesRenamed = 0;
  for (const company of companies) {
    const enabledKeys = await autoEnableWorkflowTemplatesForCompany(repo, company.id);
    if (enabledKeys.length > 0) companiesTouched += 1;
    rulesCreated += enabledKeys.length;
    rulesResynced += (await resyncWorkflowTemplateRulesForCompany(repo, company.id)).length;
    rulesRenamed += (await renameDefaultNamedTemplateRulesForCompany(repo, company.id)).length;
  }

  // Audit B8: approval tasks left open for claims already approved, rejected or paid. Idempotent,
  // so it runs every release: once to clear the backlog, then as the net under the event handler.
  // Housekeeping only: a failure here is logged and never fails the release step.
  const staleTasksClosed = await closeSettledClaimTasksAtRelease(repo);

  const autoEnableCount = WORKFLOW_TEMPLATE_CATALOG.filter((t) => t.autoEnable).length;
  console.log(
    `Workflow template sync complete: ${WORKFLOW_TEMPLATE_CATALOG.length} templates upserted, `
    + `${autoEnableCount} auto-enable templates checked against ${companies.length} active companies, `
    + `${rulesCreated} rules created across ${companiesTouched} companies (admin-owned rules untouched), `
    + `${rulesResynced} sync-owned rules re-pinned to their catalog definition, `
    + `${rulesRenamed} rules still named a former template default renamed, `
    + (staleTasksClosed === null
      ? 'closing stale approval tasks FAILED (see the error above).'
      : `${staleTasksClosed} approval tasks closed for claims no longer waiting for approval.`),
  );
}

main()
  .catch((err) => {
    console.error('Workflow template sync failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
