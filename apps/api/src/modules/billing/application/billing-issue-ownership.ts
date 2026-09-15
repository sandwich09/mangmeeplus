import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

export async function issueOperators(tx:Prisma.TransactionClient,scope:{companyId:string|null;stripeAccountId:string;livemode:boolean},
  input:{search?:string;cursor?:string;ids?:string[]}={}) {
  if(input.ids?.length===0)return {items:[],nextCursor:null};
  const query=Prisma.sql`SELECT u.id,u."displayName" AS name FROM "User" u WHERE u.status='ACTIVE'
    AND EXISTS(SELECT m.id FROM "CompanyMembership" m JOIN "Company" c ON c.id=m."companyId" AND c.status='ACTIVE'
      JOIN "MembershipRole" mr ON mr."membershipId"=m.id JOIN "Role" r ON r.id=mr."roleId" AND r.status='ACTIVE' AND r."isSystem"=true AND r."scopeKey"='system' AND r."companyId" IS NULL
      LEFT JOIN "RolePermission" rp ON rp."roleId"=r.id LEFT JOIN "Permission" p ON p.id=rp."permissionId"
      WHERE m."userId"=u.id AND m.status='ACTIVE' GROUP BY m.id
      HAVING bool_or(p.key='system.billing.read') AND bool_or(p.key='system.billing.issue.manage') AND
        (bool_or(r.key='SYSTEM_ADMIN') OR (${scope.companyId}::text IS NOT NULL AND EXISTS(
          SELECT 1 FROM "BillingOperatorScope" s WHERE s."userId"=u.id AND s."companyId"=${scope.companyId}
            AND s."stripeAccountId"=${scope.stripeAccountId} AND s.livemode=${scope.livemode} AND s."revokedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt">now())))))
    ${input.search?Prisma.sql`AND (u.id ILIKE ${`%${input.search}%`} OR u."displayName" ILIKE ${`%${input.search}%`})`:Prisma.empty}
    ${input.ids?Prisma.sql`AND u.id IN (${Prisma.join(input.ids)})`:Prisma.empty}`;
  if(input.cursor&&!(await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`${query} AND u.id=${input.cursor}`)).length)throw new NotFoundException();
  const limit=input.ids?.length??25;
  const rows=await tx.$queryRaw<Array<{id:string;name:string}>>(Prisma.sql`${query}
    ${input.cursor?Prisma.sql`AND u.id COLLATE "C">${input.cursor} COLLATE "C"`:Prisma.empty} ORDER BY u.id COLLATE "C" LIMIT ${limit+1}`);
  return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
}
