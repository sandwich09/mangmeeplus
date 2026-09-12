import type { Prisma } from '../../../generated/prisma/client';

/** All term/lifecycle writers lock Company before reading or locking its term. */
export async function lockPlanTermCompany(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
}
