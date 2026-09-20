import { LineMessagingCredentialsService } from '../../../../common/config/line-messaging-credentials.service';
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PartnerLineMessageResultDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { pushSystemLineMessage } from '../../../auth/infrastructure/system-line-push';
import { checkShopMessage, shopMessageAllowedHosts, shopMessageBodyTh } from '../../domain/logic/partner-line-message.logic';
import { ownerLineUserIds } from './package-change-decision.use-case';
// From the shared constants file, not from the inbox use case: two spellings of the action would
// split the audit trail the /system page reads, and neither module should import the other's
// `@Injectable()` files to avoid that.
import { SUPPORT_REQUEST_ANSWERED_ACTION } from '../../../external-signup/domain/support-request.constants';

export const PARTNER_LINE_MESSAGE_ACTION = 'system.partner.line_message_sent';

/**
 * P10-L §8 / SEC-05. The OA runs webhook-only (Chat is off in OA Manager), so an operator cannot
 * type a reply from the LINE OA app at all — this box is the whole answer path for "ติดต่อ
 * เจ้าหน้าที่". It is a push sent in the platform's name, so it is bounded, link-fenced and audited
 * with its own text.
 *
 * Addressed to the shop's OWNERs, plus ONE named requester when the caller says which request it is
 * answering (the "เปิดหน้าร้าน" link from the inbox carries the id). Never every open requester of
 * the shop: that handed one customer's answer to every other customer waiting on it.
 */
@Injectable()
export class SendPartnerLineMessageUseCase {
  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: {
    companyId: string;
    text: string;
    /** The support request this reply answers, when the operator arrived from the inbox link. */
    supportRequestId?: string;
    requestingAdminUserId: string;
    requestId: string;
  }): Promise<PartnerLineMessageResultDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    // Read before anything is said. A request belonging to another shop, or one nobody is waiting
    // on, is "not found" rather than a distinct error: whether an id exists is not a fact this
    // endpoint owes a caller who cannot act on it.
    const target = cmd.supportRequestId
      ? await this.prisma.client.lineSupportRequest.findUnique({
        where: { id: cmd.supportRequestId },
        select: {
          id: true, companyId: true, status: true, lineUserId: true,
          lastMessageAt: true, answeredAt: true,
        },
      })
      : null;
    if (cmd.supportRequestId
      && (!target || target.companyId !== cmd.companyId || target.status === 'CLOSED')) {
      throw new NotFoundException(`Support request "${cmd.supportRequestId}" not found.`);
    }

    const check = checkShopMessage(cmd.text, shopMessageAllowedHosts(this.config.sesWebBaseUrl));
    if (!check.ok) {
      // Spelled out rather than interpolated: the web's Thai-coverage spec scans for LITERAL codes,
      // and a code it cannot see is a code that reaches an operator as raw snake_case.
      if (check.reason === 'empty') throw new UnprocessableEntityException('partner_line_message_empty');
      if (check.reason === 'too_long') throw new UnprocessableEntityException('partner_line_message_too_long');
      throw new UnprocessableEntityException('partner_line_message_external_link');
    }

    const credentials = await this.lineCredentials.get();
    const token = credentials.accessToken;
    if (!token || !credentials.channelId) throw new UnprocessableEntityException('line_messaging_channel_not_configured');

    const sender = await this.prisma.client.user.findUnique({
      where: { id: cmd.requestingAdminUserId },
      select: { displayName: true },
    });
    const body = shopMessageBodyTh(sender?.displayName ?? 'ทีมงาน', check.text);

    // "The shop" is its OWNERs — but the person waiting may be an employee, and the reply to a
    // request THEY raised went to a chat they cannot see (and, in a shop whose owner has no LINE
    // linked, to nobody at all). Exactly the one the operator named, never the others: two
    // strangers must not read each other's support conversation.
    const recipients = [...new Set([
      ...await ownerLineUserIds(this.prisma, cmd.companyId, credentials.channelId),
      ...(target ? [target.lineUserId] : []),
    ])];
    let delivered = 0;
    for (const providerUserId of recipients) {
      if (await pushSystemLineMessage(token, providerUserId, body)) delivered += 1;
    }

    // Only a named request can become answered here. A generic company notice has no proof that it
    // answered any particular person's question, and must never hide all of the shop's open cases.
    // The message stamp also prevents a customer reply that arrives during the push from being
    // overwritten by this older answer.
    if (delivered > 0 && target) {
      await this.prisma.client.$transaction(async (tx) => {
        const answered = await tx.lineSupportRequest.updateMany({
          where: {
            id: target.id,
            status: target.status,
            lastMessageAt: target.lastMessageAt,
            answeredAt: target.answeredAt,
          },
          data: { status: 'ANSWERED', answeredAt: new Date(), answeredByUserId: cmd.requestingAdminUserId },
        });
        if (answered.count > 0) {
          await tx.auditLog.create({
            data: {
              companyId: cmd.companyId,
              actorUserId: cmd.requestingAdminUserId,
              action: SUPPORT_REQUEST_ANSWERED_ACTION,
              targetType: 'line_support_request',
              targetId: target.id,
              requestId: cmd.requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: { previousStatus: target.status, via: 'partner_line_message' },
            },
          });
        }
      });
      // สัญญา v3 ข้อ 9: the same words land on the case's chat, so an operator who opens the thread
      // sees this answer beside the customer's messages. After the transaction and best effort: the
      // answer is delivered and audited already, and a thread hiccup must not roll that back.
      try {
        await this.prisma.client.lineSupportMessage.create({
          data: {
            requestId: target.id, direction: 'STAFF', kind: 'TEXT', text: check.text,
            senderName: sender?.displayName ?? 'ทีมงาน', senderUserId: cmd.requestingAdminUserId,
            deliveryStatus: 'SENT',
          },
        });
      } catch {
        // The audit row below still carries the text; only the chat view misses this bubble.
      }
    }

    // The paragraph IS the evidence here (SEC-05): an operator speaking as the platform must leave
    // behind exactly what they said. Bounded above, and no recipient id is recorded with it.
    await this.prisma.client.auditLog.create({
      data: {
        companyId: cmd.companyId,
        actorUserId: cmd.requestingAdminUserId,
        action: PARTNER_LINE_MESSAGE_ACTION,
        targetType: 'company',
        targetId: cmd.companyId,
        requestId: cmd.requestId,
        // FAILED when nothing landed: an operator who thinks they answered a customer and did not
        // is the exact support failure this box exists to prevent.
        result: delivered > 0 ? 'SUCCESS' : 'FAILED',
        riskLevel: 'HIGH',
        metadataJson: { text: check.text, recipients: recipients.length, delivered },
      },
    });

    return { delivered };
  }
}
