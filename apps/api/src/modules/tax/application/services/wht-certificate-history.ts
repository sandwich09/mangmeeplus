import type { Prisma, WhtCertificateHandoff } from '../../../../generated/prisma/client.js';
import type { WhtCertificateHistoryEventType } from '@watchdog-bms/contracts';

/** Append inside the caller's transaction so history and certificate state commit together. */
export function appendWhtCertificateHistory(
  tx: Prisma.TransactionClient,
  handoff: Pick<WhtCertificateHandoff, 'id' | 'companyId' | 'sourcePaymentType' | 'sourcePaymentId'>,
  event: {
    eventType: WhtCertificateHistoryEventType;
    actorUserId: string;
    isExternal: boolean;
    certificateId?: string | null;
    certificateNumber?: string | null;
    certificateDate?: Date | null;
    relatedCertificateId?: string | null;
    relatedCertificateNumber?: string | null;
    reason?: string | null;
    detailsJson?: Prisma.InputJsonObject;
    taxFilingAttested?: boolean;
  },
) {
  return tx.whtCertificateHistory.create({
    data: {
      ...event,
      companyId: handoff.companyId,
      expenseId: handoff.sourcePaymentType === 'expense.record' ? handoff.sourcePaymentId ?? null : null,
      handoffId: handoff.id,
    },
  });
}
