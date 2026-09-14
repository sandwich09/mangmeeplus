import type { BillingIssue, Prisma } from '../../../generated/prisma/client';

type Identity=Pick<BillingIssue,'stripeAccountId'|'livemode'|'companyId'|'kind'|'referenceId'>;
async function lockIssue(tx:Prisma.TransactionClient,identity:Identity) {
  const {companyId,...unique}=identity;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([identity.stripeAccountId,identity.livemode,identity.kind,identity.referenceId])},0))`;
  await tx.$queryRaw`SELECT id FROM "BillingIssue" WHERE "stripeAccountId"=${identity.stripeAccountId} AND livemode=${identity.livemode}
    AND kind=${identity.kind} AND "referenceId"=${identity.referenceId} FOR UPDATE`;
  const before=await tx.billingIssue.findUnique({where:{stripeAccountId_livemode_kind_referenceId:unique}});
  if(before&&before.companyId!==companyId)throw new Error('billing.issue_company_mismatch');
  return before;
}
export async function resolveBillingIssue(tx:Prisma.TransactionClient,identity:Identity,evidenceCode:string) {
  const before=await lockIssue(tx,identity);
  if(!before||before.state==='RESOLVED')return;
  const row=await tx.billingIssue.update({where:{id:before.id},data:{state:'RESOLVED',resolvedAt:new Date(),version:{increment:1}}});
  await tx.auditLog.create({data:{companyId:identity.companyId,actorType:'SERVICE',actorRefId:'billing-issue-detector',action:'billing.issue.resolved',targetType:'BillingIssue',
    targetId:row.id,requestId:`billing-issue:${row.id}:${row.episode}:resolved`,result:'SUCCESS',riskLevel:'MEDIUM',metadataJson:{episode:row.episode,beforeState:before.state,version:row.version,evidenceCode,mode:row.livemode?'LIVE':'TEST'}}});
}
export async function detectBillingIssue(tx:Prisma.TransactionClient,identity:Identity,reopen=true) {
  const before=await lockIssue(tx,identity),now=new Date(),companyId=identity.companyId;
  const recurring=before?.state==='RESOLVED'&&reopen;
  const row=before ? await tx.billingIssue.update({where:{id:before.id},data:{lastSeenAt:now,...(recurring?{
    state:'OPEN',resolvedAt:null,assigneeUserId:null,followUpAt:null,episode:{increment:1},version:{increment:1}}:{})}}) :
    await tx.billingIssue.create({data:{...identity,lastSeenAt:now,priority:['PAID_HELD','PAID_NOT_APPLIED','FINANCIAL_REVIEW','DUPLICATE_SUBSCRIPTION'].includes(identity.kind)?'HIGH':'NORMAL'}});
  if(!before||recurring)await tx.auditLog.create({data:{companyId,actorType:'SERVICE',actorRefId:'billing-issue-detector',action:recurring?'billing.issue.reopened':'billing.issue.detected',
    targetType:'BillingIssue',targetId:row.id,requestId:`billing-issue:${row.id}:${row.episode}`,result:'SUCCESS',riskLevel:'MEDIUM',
    metadataJson:{episode:row.episode,previousState:before?.state??null,previousAssignee:before?.assigneeUserId??null,kind:row.kind,mode:row.livemode?'LIVE':'TEST'}}});
  return row;
}
