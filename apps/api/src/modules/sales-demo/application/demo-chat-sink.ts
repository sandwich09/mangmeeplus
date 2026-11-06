import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';

/** Tokens resolve through an inbound row, never through client-supplied company coordinates. */
export async function storeDemoReply(db: Pick<Prisma.TransactionClient, 'demoChatMessage' | 'company'>,
  target: string, messages: Prisma.InputJsonValue, operationId?: string): Promise<void> {
  const inbound = target.startsWith('vreply:')
    ? await db.demoChatMessage.findUnique({ where: { replyToken: target }, select: { companyId: true, chatId: true, webhookEventId: true } })
    : null;
  const companyId = inbound?.companyId ?? (target.startsWith('Vdemo') ? target.slice(5) : undefined);
  if (!companyId) throw new Error('DEMO_CHAT_TARGET_UNKNOWN');
  const company = await db.company.findUnique({ where: { id: companyId }, select: { reportClassification: true } });
  if (company?.reportClassification !== 'DEMO') throw new Error('DEMO_CHAT_TARGET_INVALID');
  const chatId = `Vdemo${companyId}`;
  if (inbound && inbound.chatId !== chatId) throw new Error('DEMO_CHAT_TARGET_INVALID');
  const deliveryKey = createHash('sha256').update(JSON.stringify([companyId, operationId ?? target, messages])).digest('hex');
  await db.demoChatMessage.upsert({ where: { deliveryKey }, update: {}, create: {
    companyId, chatId, direction: 'out', messagesJson: messages,
    webhookEventId: inbound?.webhookEventId, deliveryKey,
  } });
}
