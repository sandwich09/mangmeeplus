import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';

/**
 * H-14: internal worker routes carry a caller-supplied companyId. Refuse to act
 * on any company that does not exist or is not ACTIVE, so a leaked worker token
 * cannot probe or drive jobs against arbitrary tenant ids. Callers must run the
 * worker-token check first so this never becomes an existence oracle.
 */
export async function assertActiveCompany(prisma: PrismaService, companyId: string): Promise<void> {
  const company = await prisma.client.company.findFirst({
    where: { id: companyId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!company) throw new NotFoundException('Company not found');
}
