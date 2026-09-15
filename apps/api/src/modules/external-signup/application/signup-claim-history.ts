import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AdminSignupClaimHistoryDto } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';

export async function signupClaimHistory(db: Prisma.TransactionClient, context: RequestContext, requestId: string, cursor?: string): Promise<AdminSignupClaimHistoryDto> {
  const permission='system.company_onboarding.read';
  const member=await db.companyMembership.findFirst({where:{id:context.membershipId,userId:context.userId,companyId:context.companyId,status:'ACTIVE'},
    include:{user:{select:{status:true}},company:{select:{status:true}},roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
  const roles=member?.roles.map(link=>link.role).filter(role=>role.status==='ACTIVE'&&role.isSystem&&role.scopeKey==='system'&&role.companyId===null)??[];
  if(member?.user.status!=='ACTIVE'||member.company.status!=='ACTIVE'||!context.permissions.includes(permission)||
    !roles.some(role=>role.key==='SYSTEM_ADMIN')||!roles.some(role=>role.permissions.some(link=>link.permission.key===permission)))throw new ForbiddenException();
  if(!/^[A-Za-z0-9_-]{20,40}$/.test(requestId)||cursor!==undefined&&(typeof cursor!=='string'||!/^[a-f0-9-]{36}$/i.test(cursor)))throw new BadRequestException();
  const request=await db.companySignupRequest.findUnique({where:{id:requestId}});
  if(!request)throw new NotFoundException();
  const where={signupRequestId:requestId,purpose:'account_claim'};
  const after=cursor?await db.emailSendAttempt.findFirst({where:{...where,id:cursor}}):null;
  if(cursor&&!after)throw new NotFoundException();
  const rows=await db.emailSendAttempt.findMany({where:{...where,...after?{OR:[{createdAt:{lt:after.createdAt}},{createdAt:after.createdAt,id:{lt:after.id}}]}:{}},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
  return {requestId,state:request.state,version:request.version,latestAttemptId:request.latestClaimEmailAttemptId,
    lastClaimSentAt:request.claimEmailLastSentAt?.toISOString()??null,hasLegacySesReference:Boolean(request.claimEmailSesMessageId),
    items:rows.slice(0,25).map(row=>({id:row.id,provider:row.provider,generation:row.generation,state:row.status,latest:row.id===request.latestClaimEmailAttemptId,
      possibleDuplicate:row.possibleDuplicate,createdAt:row.createdAt.toISOString(),submittedAt:row.submittedAt?.toISOString()??null,
      deliveredAt:row.deliveredAt?.toISOString()??null,suppressedAt:row.suppressedAt?.toISOString()??null,deadlineAt:row.deadlineAt?.toISOString()??null,
      nextRecoveryAt:row.nextRecoveryAt?.toISOString()??null,needsReview:Boolean(row.suppressedAt)||['CONFIG','PERMANENT','SUPPRESSED','UNKNOWN'].includes(row.status)})),
    nextCursor:rows.length>25?rows[24]!.id:null};
}
