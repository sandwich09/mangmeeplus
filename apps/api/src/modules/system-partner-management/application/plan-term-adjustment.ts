import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { partnerAdjustmentReason } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import type { PlanTermRow } from '../domain/logic/plan-term.logic';

export const PLAN_TERM_ADJUSTMENT_ACTIONS = ['system.company_plan_term.set', 'system.company_plan_term.renew'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const planTermChanged = () => new ConflictException({ code: 'partner_plan_term_changed', message: 'partner_plan_term_changed' });

/** A source token includes the stored term, never the passage of time or derived warning state. */
export function planTermSourceVersion(companyId: string, row: (PlanTermRow & { updatedAt?: Date }) | null): string {
  return hash([companyId, row ? [row.tierKey, row.branchLimit, row.employeeLimit, row.monthlySlipLimit,
    row.termStartAt, row.termEndsAt, row.warningDays, row.renewCount, row.lastRenewedAt,
    row.termDisabledAt, row.warmupUntil, row.warmupSlipLimit, row.billingReceiptAccountId,
    row.capacityOverride, row.updatedAt] : null]);
}

export type PlanTermAdjustmentCommand = {
  companyId: string; requestingAdminUserId: string; commandId: string; expectedVersion: string; reason: string;
  /** Internal provenance only; the public plan-term DTO does not accept this field. */
  packageChangeRequestId?: string;
};

/** Company lock must already be held. Transport requestId remains correlation, never identity. */
export async function checkPlanTermAdjustment(tx: Prisma.TransactionClient, cmd: PlanTermAdjustmentCommand,
  action: string, body: unknown, current: (PlanTermRow & { updatedAt?: Date }) | null) {
  await assertPlanTermAdjustmentActor(tx,cmd.requestingAdminUserId);
  const reason = partnerAdjustmentReason(cmd.reason);
  if (!reason) throw new UnprocessableEntityException('partner_adjustment_reason_required');
  if (typeof cmd.commandId !== 'string' || !/^[a-zA-Z0-9_-]{16,120}$/.test(cmd.commandId)
    || typeof cmd.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(cmd.expectedVersion)) {
    throw new UnprocessableEntityException('partner_plan_term_command_required');
  }
  const source = cmd.packageChangeRequestId ? 'LINE_PACKAGE_REQUEST' : 'SYSTEM_PARTNER_ADMIN';
  const fingerprint = hash([action, cmd.companyId, cmd.requestingAdminUserId, cmd.expectedVersion,
    reason, source, cmd.packageChangeRequestId ?? null, body]);
  const prior = await tx.auditLog.findFirst({ where: {
    companyId: cmd.companyId, targetType: 'company_plan_term', targetId: cmd.companyId,
    action: { in: PLAN_TERM_ADJUSTMENT_ACTIONS }, result: 'SUCCESS',
    metadataJson: { path: ['commandId'], equals: cmd.commandId },
  }, select: { actorUserId: true, metadataJson: true } });
  const metadata = prior?.metadataJson as { fingerprint?: string } | null;
  if (prior && (prior.actorUserId !== cmd.requestingAdminUserId || metadata?.fingerprint !== fingerprint)) {
    throw new ConflictException({ code: 'partner_plan_term_command_conflict', message: 'partner_plan_term_command_conflict' });
  }
  if (!prior && planTermSourceVersion(cmd.companyId, current) !== cmd.expectedVersion) throw planTermChanged();
  return { replayed: Boolean(prior), audit: { commandId: cmd.commandId, fingerprint, expectedVersion: cmd.expectedVersion,
    source: 'ADMIN_ADJUSTMENT', entryPoint: source, reason, packageChangeRequestId: cmd.packageChangeRequestId ?? null } };
}

export async function assertPlanTermAdjustmentActor(tx: Prisma.TransactionClient,userId: string) {
  const globalRole = {isSystem:true,scopeKey:'system',companyId:null,status:'ACTIVE' as const};
  const actor = await tx.companyMembership.findFirst({where:{userId:userId,status:'ACTIVE',
    user:{status:'ACTIVE'},company:{status:'ACTIVE'},AND:[
      {roles:{some:{role:{...globalRole,key:'SYSTEM_ADMIN'}}}},
      {roles:{some:{role:{...globalRole,permissions:{some:{permission:{key:'system.partner_company.update'}}}}}}},
    ]},select:{id:true}});
  if(!actor)throw new ForbiddenException();
}
