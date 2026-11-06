import { ForbiddenException } from '@nestjs/common';
import { DEMO_READ_LIMIT_TEXT } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';

/** Web preflight only; the atomic OCR admission remains the spend authority. Customers never query here. */
export async function assertDemoReadAvailable(db: Pick<Prisma.TransactionClient, 'companyOcrUsageEvent'>, ctx: { companyId: string; isDemo?: boolean }): Promise<void> {
  if (ctx.isDemo && await db.companyOcrUsageEvent.count({ where: { companyId: ctx.companyId } }) >= 3) {
    throw new ForbiddenException({ code: 'demo_read_limit_reached', message: DEMO_READ_LIMIT_TEXT });
  }
}
