import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { WHT_EXTERNAL_FILE, type RequestContext } from '@watchdog-bms/contracts';

/** Files stay linked after replacement/removal so the append-only history can still open them. */
export async function retainExternalWhtFile(db: Pick<Prisma.TransactionClient, 'attachmentObject' | 'attachmentLink'>, ctx: RequestContext, handoffId: string, attachmentId: string | null, uploadHandoffId = handoffId) {
  if (!ctx.permissions.includes('wht.external_certificate.link')) throw new ForbiddenException();
  if (attachmentId === null) return;
  const file = typeof attachmentId === 'string' && attachmentId.length > 0 && attachmentId.length <= 200
    ? await db.attachmentObject.findFirst({ where: { id: attachmentId, companyId: ctx.companyId }, include: { links: true } }) : null;
  if (!file || file.status !== 'ACTIVE' || file.uploadedByUserId !== ctx.userId && !file.links.some(link => link.targetType === WHT_EXTERNAL_FILE.target && link.targetId === handoffId)
    || file.byteSize <= 0 || file.byteSize > WHT_EXTERNAL_FILE.maxBytes || !['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimeType)
    || (file.metadataJson as Record<string, unknown> | null)?.generatedFor !== WHT_EXTERNAL_FILE.target
    || (file.metadataJson as Record<string, unknown> | null)?.handoffId !== uploadHandoffId && !file.links.some(link => link.targetType === WHT_EXTERNAL_FILE.target && link.targetId === handoffId)
    || file.links.some(link => link.targetType !== WHT_EXTERNAL_FILE.target || link.targetId !== handoffId)) {
    throw new BadRequestException({ code: 'wht_external_file_invalid', message: WHT_EXTERNAL_FILE.invalid });
  }
  await db.attachmentLink.upsert({
    where: { attachmentId_targetType_targetId_purpose: { attachmentId, targetType: WHT_EXTERNAL_FILE.target, targetId: handoffId, purpose: WHT_EXTERNAL_FILE.purpose } },
    create: { companyId: ctx.companyId, attachmentId, targetType: WHT_EXTERNAL_FILE.target, targetId: handoffId, purpose: WHT_EXTERNAL_FILE.purpose, linkedByUserId: ctx.userId }, update: {},
  });
}

/** History is read newest first; an explicit null records removing the optional file. */
export function externalWhtFiles(history: { handoffId: string; eventType: string; detailsJson: unknown }[]) {
  const files = new Map<string, string | null>();
  for (const event of history) if (['EXTERNAL_RECORDED', 'EXTERNAL_RECORD_CHANGED', 'EXTERNAL_RECORD_REMOVED'].includes(event.eventType) && !files.has(event.handoffId)) {
    const id = (event.detailsJson as Record<string, unknown> | null)?.externalAttachmentId;
    files.set(event.handoffId, typeof id === 'string' ? id : null);
  }
  return files;
}
