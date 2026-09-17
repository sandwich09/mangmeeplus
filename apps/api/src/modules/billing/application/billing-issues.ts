import type { BillingAccount, BillingIssue, Prisma } from '../../../generated/prisma/client';
import { billingError, validSupportSla } from '../domain/billing-policy';

type Identity=Pick<BillingIssue,'stripeAccountId'|'livemode'|'companyId'|'kind'|'referenceId'>;
export function effectiveIssueFollowUp(row:Pick<BillingIssue,'followUpAt'|'slaDueAt'>) {return row.followUpAt??row.slaDueAt;}
async function issueSlaPolicy(tx:Prisma.TransactionClient,identity:Identity,id:string) {
  const revision=await tx.billingPolicyRevision.findFirst({where:{id,stripeAccountId:identity.stripeAccountId,livemode:identity.livemode,state:'ACTIVE'}});
  const value=revision?.policyJson;
  const minutes=value&&typeof value==='object'&&!Array.isArray(value)?value.supportSlaMinutes:undefined;
  return validSupportSla(minutes)?minutes:null;
}
async function episodeSla(tx:Prisma.TransactionClient,identity:Identity,priority:string,now:Date) {
  const empty={slaPolicyRevisionId:null,slaStartedAt:null,slaDueAt:null};
  const settings=await tx.billingSettings.findUnique({where:{stripeAccountId_livemode:{stripeAccountId:identity.stripeAccountId,livemode:identity.livemode}}});
  if(!settings?.policyRevisionId||!['NORMAL','HIGH','CRITICAL'].includes(priority))return empty;
  const minutes=await issueSlaPolicy(tx,identity,settings.policyRevisionId);if(!minutes)return empty;
  return {slaPolicyRevisionId:settings.policyRevisionId,slaStartedAt:now,slaDueAt:new Date(now.getTime()+minutes[priority as keyof typeof minutes]*60000)};
}
export async function issuePriorityDeadline(tx:Prisma.TransactionClient,row:BillingIssue,priority:string,hasManualDeadline:boolean) {
  if(priority===row.priority||(!row.slaStartedAt&&!row.slaDueAt&&!row.slaPolicyRevisionId))return row.slaDueAt;
  const minutes=row.slaPolicyRevisionId?await issueSlaPolicy(tx,row,row.slaPolicyRevisionId):null;
  if(!minutes||!row.slaStartedAt) {
    if(hasManualDeadline)return row.slaDueAt;
    throw billingError('CONTROL_SLA_REVIEW','ไม่พบเกณฑ์เวลาเดิม กรุณาระบุเวลาติดตามก่อนเปลี่ยนระดับความสำคัญ');
  }
  return new Date(row.slaStartedAt.getTime()+minutes[priority as keyof typeof minutes]*60000);
}
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
  const priority=before?.priority??(['PAID_HELD','PAID_NOT_APPLIED','FINANCIAL_REVIEW','DUPLICATE_SUBSCRIPTION'].includes(identity.kind)?'HIGH':'NORMAL');
  const sla=!before||recurring?await episodeSla(tx,identity,priority,now):{};
  const row=before ? await tx.billingIssue.update({where:{id:before.id},data:{lastSeenAt:now,...(recurring?{
    state:'OPEN',resolvedAt:null,assigneeUserId:null,followUpAt:null,...sla,episode:{increment:1},version:{increment:1}}:{})}}) :
    await tx.billingIssue.create({data:{...identity,lastSeenAt:now,priority,...sla}});
  if(!before||recurring)await tx.auditLog.create({data:{companyId,actorType:'SERVICE',actorRefId:'billing-issue-detector',action:recurring?'billing.issue.reopened':'billing.issue.detected',
    targetType:'BillingIssue',targetId:row.id,requestId:`billing-issue:${row.id}:${row.episode}`,result:'SUCCESS',riskLevel:'MEDIUM',
    metadataJson:{episode:row.episode,previousState:before?.state??null,previousAssignee:before?.assigneeUserId??null,kind:row.kind,mode:row.livemode?'LIVE':'TEST',
      slaPolicyRevisionId:row.slaPolicyRevisionId,slaStartedAt:row.slaStartedAt?.toISOString()??null,slaDueAt:row.slaDueAt?.toISOString()??null}}});
  return row;
}

// Only an applied, verified original invoice can resolve a paid-application problem.
export async function resolveAppliedInvoiceIssues(tx:Prisma.TransactionClient,account:Pick<BillingAccount,'id'|'companyId'|'stripeAccountId'|'livemode'>,invoiceId:string) {
  if(!await tx.billingAccount.findFirst({where:{id:account.id,companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode},select:{id:true}}))return;
  const invoice=await tx.billingInvoice.findFirst({where:{id:invoiceId,billingAccountId:account.id,
    applyStatus:'APPLIED',appliedAt:{not:null},providerStatus:'paid'},select:{id:true,providerInvoiceId:true,evidenceHash:true,paidSatang:true,totalSatang:true}});
  if(!invoice?.evidenceHash||invoice.paidSatang<=0||invoice.paidSatang!==invoice.totalSatang)return;
  const issues=await tx.billingIssue.findMany({where:{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,
    kind:{in:['PAID_NOT_APPLIED','PAID_HELD']},referenceId:{in:[invoice.id,invoice.providerInvoiceId]},state:{not:'RESOLVED'}},
    orderBy:[{kind:'asc'},{referenceId:'asc'}]});
  for(const issue of issues)await resolveBillingIssue(tx,{companyId:issue.companyId,stripeAccountId:issue.stripeAccountId,livemode:issue.livemode,
    kind:issue.kind,referenceId:issue.referenceId},'ORIGINAL_INVOICE_APPLIED');
}
