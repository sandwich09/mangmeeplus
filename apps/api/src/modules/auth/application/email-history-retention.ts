import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';

export const emailHistoryScope = (server: number | undefined | null, stream: string) =>
  Number.isSafeInteger(server) && server! > 0 && /^[a-zA-Z0-9_-]{1,100}$/.test(stream)
    ? { id: `postmark:${server}:${stream}`, providerServerId: server!, stream } : null;

/** Keep uncertain intents, active proofs, suppressions and unfinished business work visible. */
export function emailHistoryCandidates(scope: { providerServerId: number; stream: string }, days: number, now: Date) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  return Prisma.sql`a.provider = 'postmark' AND a."providerServerId" = ${scope.providerServerId} AND a.stream = ${scope.stream}
    AND a."historyArchivedAt" IS NULL AND a.status = 'ACCEPTED' AND a."deliveredAt" < ${cutoff}
    AND a."createdAt" < ${cutoff} AND a."updatedAt" < ${cutoff} AND a."suppressedAt" IS NULL
    AND NOT a."possibleDuplicate" AND a."nextRecoveryAt" IS NULL AND (a."deadlineAt" IS NULL OR a."deadlineAt" < ${now})
    AND NOT EXISTS (SELECT 1 FROM "EmailSendAttempt" other WHERE other."intentKey" = a."intentKey"
      AND (other.status <> 'ACCEPTED' OR other."suppressedAt" IS NOT NULL OR other."possibleDuplicate" OR other."nextRecoveryAt" IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM "EmailSuppression" s WHERE s."providerServerId" = a."providerServerId" AND s.stream = a.stream AND s.recipient = a.recipient)
    AND (a."signupRequestId" IS NULL OR EXISTS (SELECT 1 FROM "CompanySignupRequest" r WHERE r.id = a."signupRequestId" AND r.state = 'COMPLETED'))
    AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" o WHERE o.status <> 'PUBLISHED' AND (
      (o."eventType" = 'email.postmark.event.received' AND (o."aggregateId" IN (a.id, a."providerMessageId") OR
        (o."payloadJson"->>'messageId' = a."providerMessageId" AND o."payloadJson"->'serverId' = to_jsonb(a."providerServerId"))))
      OR (a.purpose = 'billing_status' AND a."intentKey" = 'billing-notice:' || o.id)))`;
}

/** One bounded batch in the existing drain; never delete the transport/idempotency ledger. */
export async function maintainEmailHistory(prisma: PrismaService, server: number | undefined | null, stream: string) {
  const scope = emailHistoryScope(server, stream);
  if (!scope) return 0;
  return prisma.client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope.id}, 0))`;
    const policy = await tx.emailHistoryPolicy.findUnique({ where: { id: scope.id } });
    const now = new Date();
    if (!policy?.enabled || (policy.lastCleanupAt && now.getTime() - policy.lastCleanupAt.getTime() < 3600000)) return 0;
    const rows = await tx.$queryRaw<Array<{ id: string; providerMessageId: string | null }>>(Prisma.sql`
      SELECT a.id, a."providerMessageId" FROM "EmailSendAttempt" a WHERE ${emailHistoryCandidates(scope, policy.retentionDays, now)}
      ORDER BY a."createdAt", a.id LIMIT 100 FOR UPDATE OF a SKIP LOCKED`);
    const ids = rows.map(row => row.id);
    if (ids.length) {
      await tx.emailSendAttempt.updateMany({ where: { id: { in: ids } }, data: { historyArchivedAt: now, errorCode: null } });
      // Retain event identity; only remove redundant recipient/time diagnostics from completed Delivery callbacks.
      await tx.$executeRaw(Prisma.sql`UPDATE "OutboxEvent" o SET "payloadJson" = jsonb_build_object(
        'historyCompactedAt', ${now.toISOString()}::text, 'attemptId', a.id, 'serverId', a."providerServerId", 'stream', a.stream),
        "headersJson" = NULL, "lastError" = NULL
        FROM "EmailSendAttempt" a WHERE a.id IN (${Prisma.join(ids)}) AND o.status = 'PUBLISHED'
        AND o."eventType" = 'email.postmark.event.received' AND o."payloadJson"->>'kind' = 'Delivery'
        AND o."payloadJson"->>'messageId' = a."providerMessageId" AND o."payloadJson"->'serverId' = to_jsonb(a."providerServerId")
        AND o."payloadJson"->>'stream' = a.stream AND o."payloadJson"->>'recipient' = a.recipient
        AND o."publishedAt" < ${new Date(now.getTime() - policy.retentionDays * 86400000)}`);
      await tx.auditLog.create({ data: { action: 'email.history.cleaned', actorType: 'SYSTEM', targetType: 'EmailHistoryPolicy',
        targetId: scope.id, requestId: randomUUID(), result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { policyVersion: policy.version, retentionDays: policy.retentionDays, attemptIds: ids } } });
    }
    await tx.emailHistoryPolicy.update({ where: { id: scope.id }, data: { lastCleanupAt: now, lastArchivedCount: ids.length } });
    return ids.length;
  });
}
