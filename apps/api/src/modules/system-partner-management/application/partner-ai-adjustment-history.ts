import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PartnerAiAdjustmentField, PartnerAiAdjustmentHistory } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';

const ACTIONS = ['system.partner_ai_model.update', 'system.partner_ocr_config.update'];
const FIELDS: Array<[PartnerAiAdjustmentField, string, string, 'number'|'string'|'boolean']> = [
  ['modelId','fromModelId','toModelId','string'], ['monthlyBudgetSatang','fromMonthlyBudgetSatang','toMonthlyBudgetSatang','number'],
  ['enabled','fromEnabled','toEnabled','boolean'], ['monthlyLimit','fromMonthlyLimit','toMonthlyLimit','number'],
  ['receiptQuotaEnforced','fromReceiptQuotaEnforced','toReceiptQuotaEnforced','boolean'],
];

/** Only known scalar fields cross the Admin read boundary; historic raw metadata never does. */
export function aiAdjustmentDetails(value: unknown): Pick<PartnerAiAdjustmentHistory['items'][number], 'source'|'reason'|'changes'> {
  const metadata = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const changes: PartnerAiAdjustmentHistory['items'][number]['changes'] = [];
  for (const [field, from, to, kind] of FIELDS) {
    const valid = (v:unknown) => v === null || (kind === 'number' ? typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
      : typeof v === kind && (typeof v !== 'string' || v.length <= 200));
    const before = metadata[from], after = metadata[to];
    if (valid(before) && valid(after) && before !== after) changes.push({field, before:before as string|number|boolean|null,after:after as string|number|boolean|null});
  }
  return { source:metadata.source === 'ADMIN_ADJUSTMENT' ? 'ADMIN_ADJUSTMENT' : 'LEGACY_ADMIN',
    reason:typeof metadata.reason === 'string' && metadata.reason.trim().length > 0 && metadata.reason.length <= 500 ? metadata.reason : null, changes };
}

export async function partnerAiAdjustmentHistory(db: Prisma.TransactionClient, companyId:string, cursor?:string): Promise<PartnerAiAdjustmentHistory> {
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor))) throw new BadRequestException('Invalid cursor');
  if (!await db.company.findUnique({where:{id:companyId},select:{id:true}})) throw new NotFoundException();
  const where:Prisma.AuditLogWhereInput = {targetType:'company',targetId:companyId,action:{in:ACTIONS},result:'SUCCESS',
    OR:[{companyId},{companyId:null}]};
  const position = cursor ? await db.auditLog.findFirst({where:{...where,id:cursor},select:{id:true,createdAt:true}}) : null;
  if (cursor && !position) throw new NotFoundException();
  const rows = await db.auditLog.findMany({where:{AND:[where,...position ? [{OR:[{createdAt:{lt:position.createdAt}},
    {createdAt:position.createdAt,id:{lt:position.id}}]}] : []]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26,
    select:{id:true,createdAt:true,actorUserId:true,actor:{select:{displayName:true}},metadataJson:true}});
  return {items:rows.slice(0,25).map(row=>({id:row.id,recordedAt:row.createdAt.toISOString(),actorId:row.actorUserId,
    actorName:row.actor?.displayName ?? null,...aiAdjustmentDetails(row.metadataJson)})),nextCursor:rows.length>25 ? rows[24]!.id : null};
}
