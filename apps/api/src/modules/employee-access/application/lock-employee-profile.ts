import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

/** Serialize draft removal with provisioning before reading the state used for a write. */
export async function lockEmployeeProfile(tx: Prisma.TransactionClient, companyId: string, employeeId: string) {
  await tx.$queryRaw`SELECT "id" FROM "EmployeeAccessProfile" WHERE "id" = ${employeeId} AND "companyId" = ${companyId} FOR UPDATE`;
  const profile = await tx.employeeAccessProfile.findFirst({ where: { id: employeeId, companyId } });
  if (!profile) throw new NotFoundException({ code: 'employee_draft_not_found', message: 'Employee no longer exists. Refresh the employee list.' });
  return profile;
}
