import { ForbiddenException } from '@nestjs/common';
import { DEMO_READ_LIMIT_TEXT } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';

/** The demo shop's read quota: the link's own, written to the shop's OCR limit (1–50). */
export async function demoReadLimit(db: Pick<Prisma.TransactionClient, 'companyAiConfiguration'>, companyId: string): Promise<number> {
  const config = await db.companyAiConfiguration.findUnique({ where: { companyId }, select: { ocrMonthlyLimit: true } });
  return Math.min(50, config?.ocrMonthlyLimit ?? 3);
}

/** Web preflight only; the atomic OCR admission remains the spend authority. Customers never query here. */
export async function assertDemoReadAvailable(db: Pick<Prisma.TransactionClient, 'companyOcrUsageEvent' | 'companyAiConfiguration'>, ctx: { companyId: string; isDemo?: boolean }): Promise<void> {
  if (ctx.isDemo && await db.companyOcrUsageEvent.count({ where: { companyId: ctx.companyId } }) >= await demoReadLimit(db, ctx.companyId)) {
    throw new ForbiddenException({ code: 'demo_read_limit_reached', message: DEMO_READ_LIMIT_TEXT });
  }
}
