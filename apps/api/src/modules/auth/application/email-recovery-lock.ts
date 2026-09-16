import { lockAccountEmail } from './account-email-state';
import type { Prisma } from '../../../generated/prisma/client';

/** Company/membership before user/credential, consistent with administrative lifecycle mutations. */
export async function lockEmailRecoveryAccount(tx:Prisma.TransactionClient,userId:string){
  const candidate=await tx.companyMembership.findFirst({where:{userId,status:'ACTIVE',company:{OR:[{status:'ACTIVE'},{status:'DISABLED',planTerm:{termDisabledAt:{not:null}}}]}},orderBy:{id:'asc'},select:{id:true,companyId:true}});
  if(!candidate)return null;
  await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id"=${candidate.companyId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "CompanyMembership" WHERE "id"=${candidate.id} FOR SHARE`;
  await lockAccountEmail(tx, userId);
  const member=await tx.companyMembership.findFirst({where:{id:candidate.id,userId,status:'ACTIVE',company:{OR:[{status:'ACTIVE'},{status:'DISABLED',planTerm:{termDisabledAt:{not:null}}}]}},select:{id:true,companyId:true}});
  const user=await tx.user.findUnique({where:{id:userId},include:{credential:true}});
  if(!member||!user||user.status!=='ACTIVE'||!user.email||!user.emailVerifiedAt||!user.credential||user.credential.status==='DISABLED')return null;
  return {member,user};
}
