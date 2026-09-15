import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PartnerPlanAdjustmentField, PartnerPlanAdjustmentHistory } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { PLAN_TERM_ADJUSTMENT_ACTIONS } from './plan-term-adjustment';

const fields: PartnerPlanAdjustmentField[] = ['tierKey', 'branchLimit', 'employeeLimit', 'monthlySlipLimit', 'warningDays', 'termStartAt', 'termEndsAt'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scalar = (value: unknown): string | number | null => typeof value === 'string' && value.length <= 100 ? value
  : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Historic metadata is allowlisted; credentials, raw payloads and unrelated audit fields never leave. */
export function planAdjustmentDetails(value: unknown): Pick<PartnerPlanAdjustmentHistory['items'][number], 'source' | 'reason' | 'requestId' | 'changes'> {
  const metadata = object(value), before = object(metadata.from), after = object(metadata.to);
  if (!Object.keys(before).length && typeof metadata.fromTermEndsAt === 'string') before.termEndsAt = metadata.fromTermEndsAt;
  if (!Object.keys(after).length && typeof metadata.toTermEndsAt === 'string') after.termEndsAt = metadata.toTermEndsAt;
  return { source: metadata.entryPoint === 'LINE_PACKAGE_REQUEST' ? 'LINE_PACKAGE_REQUEST'
    : metadata.entryPoint === 'SYSTEM_PARTNER_ADMIN' ? 'SYSTEM_PARTNER_ADMIN' : 'LEGACY_ADMIN',
    reason: typeof metadata.reason === 'string' && metadata.reason.trim() && metadata.reason.length <= 500 ? metadata.reason : null,
    requestId: typeof metadata.packageChangeRequestId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(metadata.packageChangeRequestId) ? metadata.packageChangeRequestId : null,
    changes: fields.map(field => ({field, before: scalar(before[field]), after: scalar(after[field])})).filter(change => change.before !== change.after) };
}

export async function partnerPlanAdjustmentHistory(db: Prisma.TransactionClient, companyId: string, cursor?: string): Promise<PartnerPlanAdjustmentHistory> {
  if (cursor !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor)) throw new BadRequestException('Invalid cursor');
  if (!await db.company.findUnique({where:{id:companyId},select:{id:true}})) throw new NotFoundException();
  const where: Prisma.AuditLogWhereInput = {targetType:'company_plan_term',targetId:companyId,companyId,
    action:{in:PLAN_TERM_ADJUSTMENT_ACTIONS},result:'SUCCESS'};
  const anchor = cursor ? await db.auditLog.findFirst({where:{...where,id:cursor},select:{id:true,createdAt:true}}) : null;
  if (cursor && !anchor) throw new NotFoundException();
  const rows = await db.auditLog.findMany({where:{AND:[where,...anchor ? [{OR:[{createdAt:{lt:anchor.createdAt}},
    {createdAt:anchor.createdAt,id:{lt:anchor.id}}]}] : []]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26,
    select:{id:true,createdAt:true,action:true,actorUserId:true,actor:{select:{displayName:true}},metadataJson:true}});
  return {items:rows.slice(0,25).map(row=>({id:row.id,recordedAt:row.createdAt.toISOString(),actorId:row.actorUserId,
    actorName:row.actor?.displayName ?? null,kind:row.action === PLAN_TERM_ADJUSTMENT_ACTIONS[0] ? 'SET' : 'RENEW',
    ...planAdjustmentDetails(row.metadataJson)})),nextCursor:rows.length > 25 ? rows[24]!.id : null};
}
