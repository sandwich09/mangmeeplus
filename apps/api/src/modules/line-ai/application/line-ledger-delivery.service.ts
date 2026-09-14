import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { LINE_AI_CONTEXT_WINDOW_MINUTES } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma, type LineLedgerDelivery } from '../../../generated/prisma/client';
import type { LedgerEntry } from './line-ai-ledger.service';
import { parseOutcomeMessages, type LineReplyMessage } from '../infrastructure/line-reply.adapter';

const LEASE_MS = 3 * 60_000;
const TERMINAL = new Set(['ACCEPTED', 'REFUSED', 'PARKED']);
export type LineLedgerCompletion = { status: string; refused: boolean; errorCode: string | null; replyPreview: string; toolCount: number; outcome?: 'followed_up' | 'refused'; reason?: string };
export type LineLedgerClaim = { kind: 'prepare' | 'deliver' | 'terminal' | 'busy'; row: LineLedgerDelivery; token: string };

export const lineLedgerDeliveryId = (entry: Pick<LedgerEntry, 'key' | 'id'>) => createHash('sha256').update(JSON.stringify([entry.key, entry.id])).digest('hex');

@Injectable()
export class LineLedgerDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(entry: LedgerEntry, now = new Date()): Promise<LineLedgerClaim> {
    const id = lineLedgerDeliveryId(entry), token = randomUUID();
    const createdAt = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > now.getTime() + 30_000) throw new Error('LINE_LEDGER_INVALID_CREATED_AT');
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-ledger-delivery:${id}`}))`;
      let row = await tx.lineLedgerDelivery.findUnique({ where: { id } });
      if (!row) row = await tx.lineLedgerDelivery.create({ data: {
        id, companyId: entry.companyId, userId: entry.userId, webhookEventId: entry.webhookEventId, entryId: entry.id, entryKind: entry.kind,
        expiresAt: new Date(createdAt + LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000),
      } });
      if (row.companyId !== entry.companyId || row.userId !== entry.userId || row.webhookEventId !== entry.webhookEventId || row.entryKind !== entry.kind) throw new Error('LINE_LEDGER_DELIVERY_SCOPE_MISMATCH');
      if (TERMINAL.has(row.status)) return { kind: 'terminal', row, token };
      if (row.expiresAt <= now) {
        row = await tx.lineLedgerDelivery.update({ where: { id }, data: { status: 'PARKED', errorCode: 'LINE_LEDGER_CONTEXT_EXPIRED', leaseToken: null, leaseExpiresAt: null } });
        return { kind: 'terminal', row, token };
      }
      if (row.leaseExpiresAt && row.leaseExpiresAt > now) return { kind: 'busy', row, token };
      row = await tx.lineLedgerDelivery.update({ where: { id }, data: { leaseToken: token, leaseExpiresAt: new Date(Math.min(now.getTime() + LEASE_MS, row.expiresAt.getTime())) } });
      return { kind: row.status === 'PREPARING' ? 'prepare' : 'deliver', row, token };
    });
  }

  async save(claim: LineLedgerClaim, messages: LineReplyMessage[], authorization: Record<string, unknown>, completion: LineLedgerCompletion, now = new Date()): Promise<boolean> {
    if (!parseOutcomeMessages(messages) || Buffer.byteLength(JSON.stringify(messages), 'utf8') > 256 * 1024
      || completion.replyPreview.length > 240 || completion.status.length > 80 || completion.toolCount < 0 || completion.toolCount > 64) throw new Error('LINE_LEDGER_OUTCOME_INVALID');
    const saved = await this.prisma.client.lineLedgerDelivery.updateMany({
      where: { id: claim.row.id, leaseToken: claim.token, status: 'PREPARING', leaseExpiresAt: { gt: now }, expiresAt: { gt: now } },
      data: { status: 'READY', messagesJson: messages as unknown as Prisma.InputJsonValue,
        authorizationJson: authorization as Prisma.InputJsonValue, completionJson: completion as unknown as Prisma.InputJsonValue },
    });
    return saved.count === 1;
  }

  /** Stamp uncertainty before dispatch. A lost response can only retry this already saved payload. */
  async beginSend(claim: LineLedgerClaim, now = new Date()): Promise<boolean> {
    return this.prisma.client.$transaction(async tx => {
      const updated = await tx.lineLedgerDelivery.updateMany({
        where: { id: claim.row.id, leaseToken: claim.token, status: { in: ['READY', 'UNKNOWN'] }, leaseExpiresAt: { gt: now }, expiresAt: { gt: now } },
        data: { status: 'UNKNOWN', attempts: { increment: 1 }, errorCode: null },
      });
      if (updated.count !== 1) return false;
      if (claim.row.entryKind === 'turn' && claim.row.webhookEventId) {
        const owner = await tx.lineWebhookEventLog.updateMany({
          where: { webhookEventId: claim.row.webhookEventId, companyId: claim.row.companyId,
            OR: [{ deliveryOwnerId: `ledger:${claim.row.id}` }, { deliveryOwnerId: null, turnOutcome: { is: null } }] },
          data: { deliveryOwnerId: `ledger:${claim.row.id}` },
        });
        if (owner.count !== 1) {
          await tx.lineLedgerDelivery.update({ where: { id: claim.row.id }, data: { status: 'PARKED', errorCode: 'LINE_ORIGINAL_OUTCOME_OWNS_DELIVERY', leaseToken: null, leaseExpiresAt: null } });
          return false;
        }
      }
      return true;
    });
  }

  async finish(claim: LineLedgerClaim, status: 'ACCEPTED' | 'UNKNOWN' | 'REFUSED' | 'PARKED', errorCode: string | null = null): Promise<boolean> {
    const updated = await this.prisma.client.lineLedgerDelivery.updateMany({
      where: { id: claim.row.id, leaseToken: claim.token, status: status === 'ACCEPTED' ? 'UNKNOWN' : { in: ['PREPARING', 'READY', 'UNKNOWN'] } },
      data: { status, errorCode, ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}), leaseToken: null, leaseExpiresAt: null },
    });
    return updated.count === 1;
  }
}
