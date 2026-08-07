import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { assertConversationWriteInScope, conversationWriteActorScope } from '../crm-inbox-access';
import { PAYMENT_PROOF_LINK_PURPOSE, PAYMENT_PROOF_LINK_TARGET_TYPE, PAYMENT_PROOF_QUEUE_LIMIT } from '../../domain/crm-inbox.constants';

/**
 * A3 payment-proof capture. Staff flag an inbound image/file as a payment proof; that
 * links the attachment (feeding the finance queue AND exempting it from PDPA purge),
 * notifies inbox managers, and notes it in the thread. Verification of the payment
 * stays in items 08/09/13 — this only captures the evidence.
 */
@Injectable()
export class CrmPaymentProofUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly createNotification: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async flag(ctx: RequestContext, conversationId: string, messageId: string): Promise<{ ok: true; attachmentId: string; alreadyFlagged: boolean }> {
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);

    const message = await this.repo.findMessageInConversation(ctx.companyId, conversationId, messageId);
    if (!message) throw new NotFoundException('Message not found');
    if (message.direction !== 'INBOUND' || !message.attachmentId || !['IMAGE', 'FILE'].includes(message.messageType)) {
      throw new BadRequestException('not_a_payment_proof_candidate');
    }

    let created: boolean;
    try {
      ({ created } = await this.repo.linkPaymentProof({
        companyId: ctx.companyId,
        attachmentId: message.attachmentId,
        conversationId,
        purpose: PAYMENT_PROOF_LINK_PURPOSE,
        targetType: PAYMENT_PROOF_LINK_TARGET_TYPE,
        userId: ctx.userId,
        actorScope: conversationWriteActorScope(ctx, conversation),
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
      if (code === 'payment_proof_candidate_changed') throw new BadRequestException(code);
      if (code === 'conversation_assignment_changed' || code === 'conversation_out_of_scope') {
        throw new ForbiddenException('Conversation is out of scope');
      }
      throw error;
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.payment_proof.flag',
      targetType: 'crm_conversation', targetId: conversationId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { messageId, attachmentId: message.attachmentId, alreadyFlagged: !created },
    });

    if (created) {
      await this.repo.withLiveCustomerDataLock(
        { companyId: ctx.companyId, customerId: conversation.customerId, conversationId },
        async () => {
          const managers = await this.repo.findInboxManagerUserIds(ctx.companyId);
          const names = await this.repo.findCustomerDisplayNames(ctx.companyId, [conversation.customerId]);
          const customerName = names.get(conversation.customerId) ?? 'ลูกค้า LINE';
          const inboxHref = `/companies/${ctx.companyId}/inbox`;
          if (managers.length > 0) {
            await this.createNotification.execute({
              companyId: ctx.companyId,
              triggerKey: 'crm_payment_proof',
              sourceModule: 'crm_inbox',
              sourceType: 'crm_conversation',
              sourceId: conversationId,
              severity: 'action',
              title: `หลักฐานการโอนใหม่: ${customerName}`,
              body: 'พนักงานตั้งค่าภาพว่าเป็นหลักฐานการชำระเงิน รอฝ่ายการเงินตรวจสอบ',
              deepLinkHref: inboxHref,
              sourceRefs: [{ module: 'crm_inbox', sourceType: 'crm_conversation', sourceId: conversationId, label: customerName, href: inboxHref, permissionKey: 'crm.inbox.read' }],
              recipientUserIds: managers,
            });
          }
        },
      );
      // In-thread source ref so both staff and finance see the capture.
      try {
        await this.repo.appendOutboundMessage(
          { companyId: ctx.companyId, conversationId, direction: 'OUTBOUND', visibility: 'INTERNAL_NOTE', authorType: 'SYSTEM', authorUserId: ctx.userId, messageType: 'SYSTEM', contentText: '💰 ตั้งค่าเป็นหลักฐานการชำระเงิน (เข้าคิวการเงิน)', deliveryStatus: 'SENT', sentAt: new Date() },
          conversationId,
          { unreadCount: 0 },
          conversationWriteActorScope(ctx, conversation),
        );
      } catch (error) {
        const code = (error as Error).message;
        if (!['customer_personal_data_erased', 'conversation_assignment_changed', 'conversation_out_of_scope'].includes(code)) throw error;
      }
    }

    return { ok: true, attachmentId: message.attachmentId, alreadyFlagged: !created };
  }

  async list(ctx: RequestContext) {
    if (!ctx.permissions.includes('accounting.document.read')) throw new ForbiddenException('accounting.document.read required');
    const items = await this.repo.listPaymentProofs(ctx.companyId, PAYMENT_PROOF_LINK_PURPOSE, PAYMENT_PROOF_QUEUE_LIMIT);
    return { items };
  }

  async content(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    if (!ctx.permissions.includes('accounting.document.read')) throw new ForbiddenException('accounting.document.read required');
    const stored = await this.repo.findPaymentProofAttachmentBlob(
      ctx.companyId,
      conversationId,
      messageId,
      PAYMENT_PROOF_LINK_TARGET_TYPE,
      PAYMENT_PROOF_LINK_PURPOSE,
    );
    if (!stored) throw new NotFoundException('Payment proof content not found');
    return stored;
  }
}
