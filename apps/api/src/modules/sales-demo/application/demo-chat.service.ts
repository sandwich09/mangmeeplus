import sharp from 'sharp';
import { BadRequestException, ForbiddenException, GoneException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { LineMessageBufferService } from '../../line-ai/application/line-message-buffer.service';
import { buildLineBufferEnvelope, type LineMessageEvent } from '../../line-ai/application/line-buffer-envelope';
import { readAiCreditBalance } from '../../line-ai/application/ai-credit-ledger';
import { hashMessagePreview } from '../../line-ai/domain/logic/line-ai-classifier.logic';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../data-model-core/domain/ports/attachment-storage.port';
import { AttachmentMalwareScanner } from '../../data-model-core/infrastructure/attachment-malware-scanner';
import { inspectAttachmentBytes, normalizeAttachmentMimeType, validateAttachmentFileName } from '../../data-model-core/domain/logic/attachment.logic';
import { assertDemoReadAvailable } from './demo-read-limit';

export const DEMO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export type DemoUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
export type DemoChatInput = { text: string } | { postbackData: string; displayText?: string };

export function validateDemoChatInput(body: unknown): DemoChatInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ส่งข้อความได้ครั้งละ 1 ถึง 1,000 ตัวอักษร ลองแก้ข้อความแล้วส่งอีกครั้ง');
  // The validated DTO instance carries every declared field, unset ones as undefined; drop those.
  const input = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Record<string, unknown>;
  const bounded = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (Object.keys(input).every(key => key === 'text') && bounded(input.text, 1000)) return input as DemoChatInput;
  if (Object.keys(input).every(key => key === 'postbackData' || key === 'displayText') && bounded(input.postbackData, 1000)
    && (input.displayText === undefined || bounded(input.displayText, 1000))) return input as DemoChatInput;
  throw new BadRequestException('ส่งข้อความได้ครั้งละ 1 ถึง 1,000 ตัวอักษร ลองแก้ข้อความแล้วส่งอีกครั้ง');
}

@Injectable()
export class DemoChatService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly limits: RedisRateLimitService, private readonly buffer: LineMessageBufferService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly scanner: AttachmentMalwareScanner) {}

  async assertAccess(ctx: RequestContext, companyId: string) {
    if (!ctx?.isDemo || ctx.companyId !== companyId) throw new NotFoundException();
    if (!ctx.sessionId || !ctx.roles.includes('OWNER')) throw new ForbiddenException();
    const link = await this.prisma.client.salesDemoLink.findUnique({ where: { companyId }, include: {
      company: { select: { reportClassification: true, status: true, planTerm: { select: { termEndsAt: true, termDisabledAt: true } } } },
    } });
    if (!link || link.company?.reportClassification !== 'DEMO') throw new NotFoundException();
    if (link.revokedAt || link.expiresAt <= new Date() || link.company.status !== 'ACTIVE'
      || !link.company.planTerm || link.company.planTerm.termDisabledAt || link.company.planTerm.termEndsAt <= new Date()) {
      throw new GoneException({ code: 'demo_link_expired' });
    }
    return link;
  }

  async message(ctx: RequestContext, companyId: string, body: unknown) {
    await this.assertAccess(ctx, companyId);
    const input = validateDemoChatInput(body);
    await this.rate(companyId, 'messages', 30, 600);
    return this.enqueue(companyId, 'text' in input ? { type: 'message', message: { type: 'text', text: input.text } }
      : { type: 'postback', postback: { data: input.postbackData } },
    [{ type: 'text', text: 'text' in input ? input.text : input.displayText ?? 'เลือกจากการ์ด' }]);
  }

  async file(ctx: RequestContext, companyId: string, file: DemoUpload | undefined) {
    await this.assertAccess(ctx, companyId);
    await this.rate(companyId, 'files', 10, 3600);
    await assertDemoReadAvailable(this.prisma.client, { companyId, isDemo: true });
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0 || file.buffer.length > Math.min(DEMO_UPLOAD_MAX_BYTES, this.config.uploadMaxBytes)
      || file.size !== file.buffer.length || !FILE_TYPES.has(file.mimetype)) throw new BadRequestException('ไฟล์นี้ยังใช้ไม่ได้ เลือกรูปหรือ PDF ขนาดไม่เกิน 10 เมกะไบต์แล้วส่งอีกครั้ง');
    let bytes = file.buffer, mimeType = normalizeAttachmentMimeType(file.mimetype, bytes);
    let fileName = file.originalname.replace(/^.*[\\/]/, '').slice(0, 200);
    await this.scanner.assertClean(bytes);
    // Existing receipt readers accept JPEG/PNG/PDF. Decode other allowed images once at intake.
    if (mimeType === 'image/webp' || mimeType === 'image/heic') {
      try {
        const decoder = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
        const metadata = await decoder.metadata();
        if (metadata.format !== (mimeType === 'image/webp' ? 'webp' : 'heif')) throw new Error('IMAGE_MIME_MISMATCH');
        bytes = await decoder.rotate().jpeg({ quality: 95 }).toBuffer();
        mimeType = 'image/jpeg'; fileName = fileName.replace(/\.[^.]*$/, '') + '.jpg';
      } catch { throw new BadRequestException('ยังเปิดรูปนี้ไม่ได้ บันทึกเป็น JPG หรือ PNG แล้วส่งอีกครั้ง'); }
    }
    if (bytes.length > Math.min(DEMO_UPLOAD_MAX_BYTES, this.config.uploadMaxBytes)) throw new BadRequestException('ไฟล์นี้ยังใช้ไม่ได้ เลือกรูปหรือ PDF ขนาดไม่เกิน 10 เมกะไบต์แล้วส่งอีกครั้ง');
    if (!FILE_TYPES.has(mimeType) || validateAttachmentFileName(fileName, mimeType) || inspectAttachmentBytes(mimeType, bytes, 'RECEIPT')) {
      throw new BadRequestException('ไฟล์นี้ยังใช้ไม่ได้ เลือกรูปหรือ PDF ขนาดไม่เกิน 10 เมกะไบต์แล้วส่งอีกครั้ง');
    }
    const stored = await this.storage.putObject({ objectKey: `${companyId}/demo-chat/${randomUUID()}`, mimeType, bytes });
    let attachment;
    try {
      attachment = await this.prisma.client.attachmentObject.create({ data: { ...stored, companyId, originalFileName: fileName, mimeType,
        status: 'ACTIVE', uploadedByUserId: ctx.userId, uploadedAt: new Date(), metadataJson: { demoChat: true } } });
    } catch (error) {
      await this.storage.deleteObject(stored).catch(() => undefined);
      throw error;
    }
    const messageType = mimeType === 'application/pdf' ? 'file' : 'image';
    return this.enqueue(companyId, { type: 'message', message: { type: messageType, id: `demo-att:${attachment.id}`, fileName, fileSize: bytes.length } },
      [{ type: messageType, fileName: file.originalname.replace(/^.*[\\/]/, '').slice(0, 200) }]);
  }

  private async enqueue(companyId: string, event: LineMessageEvent, messages: Prisma.InputJsonValue) {
    const chatId = `Vdemo${companyId}`, webhookEventId = randomUUID(), replyToken = `vreply:${randomUUID()}`;
    const envelope = buildLineBufferEnvelope({ ...event, source: { type: 'user', userId: chatId }, webhookEventId, replyToken, timestamp: Date.now() }, 'demo-web', this.config.lineAiDraftEditEnabled);
    if (!envelope) throw new BadRequestException('ปุ่มนี้ใช้ต่อไม่ได้ พิมพ์ข้อความที่ต้องการแล้วส่งอีกครั้ง');
    const row = await this.prisma.client.demoChatMessage.create({ data: { companyId, chatId, direction: 'in', messagesJson: messages, webhookEventId, replyToken } });
    await this.buffer.enqueue(envelope);
    return { id: row.id };
  }

  async messages(ctx: RequestContext, companyId: string, after?: string) {
    const link = await this.assertAccess(ctx, companyId);
    if (after !== undefined && (typeof after !== 'string' || after.length > 200)) throw new BadRequestException('ยังโหลดแชทต่อไม่ได้ เปิดแชทอีกครั้งเพื่อลองใหม่');
    const cursor = after ? await this.prisma.client.demoChatMessage.findFirst({ where: { id: after, companyId }, select: { createdAt: true, id: true } }) : null;
    if (after && !cursor) throw new BadRequestException('ยังโหลดแชทต่อไม่ได้ เปิดแชทอีกครั้งเพื่อลองใหม่');
    const [rows, balance, used, turn, capture, qa] = await Promise.all([
      this.prisma.client.demoChatMessage.findMany({ where: { companyId, ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 }),
      readAiCreditBalance(this.prisma.client, { companyId, at: new Date(), allowance: () => ({ units: 0, source: 'DEFAULT' }) }),
      this.prisma.client.companyOcrUsageEvent.count({ where: { companyId } }),
      this.prisma.client.lineWebhookEventLog.findFirst({ where: { lineUserIdHash: hashMessagePreview(`Vdemo${companyId}`), status: { in: ['received', 'processing', 'response_ready', 'delivery_pending'] } }, select: { id: true } }),
      this.waitingCapture(companyId),
      this.prisma.client.lineDocumentQaJob.findFirst({ where: { companyId, messagingChannelId: 'demo-web', userId: ctx.userId, status: { in: ['QUEUED', 'READING'] } }, select: { id: true } }),
    ]);
    return { items: rows.map(row => ({ id: row.id, direction: row.direction, createdAt: row.createdAt.toISOString(), messages: row.messagesJson })),
      cursor: rows.at(-1)?.id ?? after ?? '', waiting: !!(turn || capture || qa),
      credit: { remaining: Math.floor(balance.totalRemainingUnits / 100), total: link.aiCreditUnits }, reads: { used, limit: link.readLimit } };
  }

  private async waitingCapture(companyId: string): Promise<boolean> {
    const jobs = await this.prisma.client.expenseCaptureReadJob.findMany({ where: { companyId, status: { in: ['QUEUED', 'PREPARING', 'READING'] } }, select: { expenseId: true, groupId: true } });
    if (!jobs.length) return false;
    const [expense, group] = await Promise.all([
      this.prisma.client.expenseRecord.findFirst({ where: { companyId, id: { in: jobs.flatMap(job => job.expenseId ? [job.expenseId] : []) },
        captureSource: 'LINE_UPLOAD', sourceChannelMetadataJson: { path: ['chatKeyHash'], equals: hashMessagePreview(`Vdemo${companyId}`) } }, select: { id: true } }),
      this.prisma.client.expenseCaptureGroup.findFirst({ where: { companyId, id: { in: jobs.flatMap(job => job.groupId ? [job.groupId] : []) },
        intakeChannel: 'LINE', linePushTargetId: `Vdemo${companyId}` }, select: { id: true } }),
    ]);
    return !!(expense || group);
  }

  private async rate(companyId: string, kind: string, max: number, seconds: number) {
    const result = await this.limits.consume(`demo-chat-${kind}`, companyId, max, seconds);
    if (!result.allowed) throw new HttpException({ code: 'demo_rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
  }
}
