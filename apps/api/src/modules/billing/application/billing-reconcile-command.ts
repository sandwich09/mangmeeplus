import {BadRequestException} from '@nestjs/common';
import type {BillingAccount,Prisma} from '../../../generated/prisma/client';
import type {RequestContext} from '../../auth/domain/models/request-context.model';
import {assertKeys,hashBilling} from '../domain/billing-policy';
import {lockPlanTermCompany} from '../../system-partner-management/application/lock-plan-term-company';

export const billingRepairTypes=['RECONCILE','IMPORT_INVOICE','RETRY_APPLY','RETRY_NOTIFICATION','RECONCILE_NOTIFICATION','RETRY_PROVIDER_EVENT'];

export async function lockReconcileAuthority(tx:Prisma.TransactionClient,context:RequestContext,companyIds:string[]){
  for(const id of [...new Set([context.companyId,...companyIds])].sort())await lockPlanTermCompany(tx,id);
  await tx.$queryRaw`SELECT m.id FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId" JOIN "MembershipRole" mr ON mr."membershipId"=m.id
    JOIN "Role" r ON r.id=mr."roleId" JOIN "RolePermission" rp ON rp."roleId"=r.id WHERE m.id=${context.membershipId} AND u.id=${context.userId}
    ORDER BY r.id,rp."permissionId" FOR SHARE OF m,u,mr,r,rp`;
  await tx.$queryRaw`SELECT id FROM "BillingOperatorScope" WHERE "userId"=${context.userId} ORDER BY id FOR SHARE`;
}

/** Same original company command data for individual and bounded-batch admission. */
export function reconcileCommandData(context:RequestContext,account:BillingAccount,reason:string):Prisma.BillingOperationUncheckedCreateInput{
  const proposed={accountId:account.id,membershipId:context.membershipId,actorCompanyId:context.companyId},trimmed=reason.trim();
  return {companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,type:'RECONCILE',state:'PREVIEW',proposedJson:proposed,sourceVersion:account.version,
    reason:trimmed,initiatorUserId:context.userId,requestHash:hashBilling(['RECONCILE',account.id,account.version,trimmed,proposed,null]),expiresAt:new Date(Date.now()+600000)};
}
export type ReconcileBatchInput={companies:{companyId:string;expectedVersion:number}[];reason:string};
export function reconcileBatchInput(value:unknown):ReconcileBatchInput{
  assertKeys(value,['companies','reason']);const input=value as ReconcileBatchInput;
  if(!Array.isArray(input.companies)||input.companies.length<1||input.companies.length>25||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw new BadRequestException();
  for(const item of input.companies){assertKeys(item,['companyId','expectedVersion']);if(typeof item.companyId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(item.companyId)||!Number.isSafeInteger(item.expectedVersion)||item.expectedVersion<0)throw new BadRequestException();}
  if(new Set(input.companies.map(i=>i.companyId)).size!==input.companies.length)throw new BadRequestException();
  return {companies:input.companies.map(i=>({...i})).sort((a,b)=>a.companyId<b.companyId?-1:1),reason:input.reason.trim()};
}
