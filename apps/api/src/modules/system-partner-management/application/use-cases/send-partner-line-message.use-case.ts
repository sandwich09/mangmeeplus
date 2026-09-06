import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PartnerLineMessageResultDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { pushSystemLineMessage } from '../../../auth/infrastructure/system-line-push';
import { checkShopMessage, shopMessageAllowedHosts } from '../../domain/logic/partner-line-message.logic';
import { ownerLineUserIds } from './package-change-decision.use-case';

export const PARTNER_LINE_MESSAGE_ACTION = 'system.partner.line_message_sent';

/** §8: the shop must be able to tell a person from the bot, so the operator signs their own name. */
export function shopMessageBodyTh(senderName: string, text: string): string {
  return `📮 ข้อความจากทีมงานมั่งมีพลัส (${senderName})\n${text}`;
}

/**
 * P10-L §8 / SEC-05. The OA runs webhook-only (Chat is off in OA Manager), so an operator cannot
 * type a reply from the LINE OA app at all — this box is the whole answer path for "ติดต่อ
 * เจ้าหน้าที่". It is a push sent in the platform's name, so it is bounded, link-fenced, audited
 * with its own text, and addressed only to the shop's OWNERs.
 */
@Injectable()
export class SendPartnerLineMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: {
    companyId: string;
    text: string;
    requestingAdminUserId: string;
    requestId: string;
  }): Promise<PartnerLineMessageResultDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    const check = checkShopMessage(cmd.text, shopMessageAllowedHosts(this.config.sesWebBaseUrl));
    if (!check.ok) {
      // Spelled out rather than interpolated: the web's Thai-coverage spec scans for LITERAL codes,
      // and a code it cannot see is a code that reaches an operator as raw snake_case.
      if (check.reason === 'empty') throw new UnprocessableEntityException('partner_line_message_empty');
      if (check.reason === 'too_long') throw new UnprocessableEntityException('partner_line_message_too_long');
      throw new UnprocessableEntityException('partner_line_message_external_link');
    }

    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) throw new UnprocessableEntityException('line_messaging_channel_not_configured');

    const sender = await this.prisma.client.user.findUnique({
      where: { id: cmd.requestingAdminUserId },
      select: { displayName: true },
    });
    const body = shopMessageBodyTh(sender?.displayName ?? 'ทีมงาน', check.text);

    // "The shop" is its OWNERs — but the person waiting may be an employee, and until now the reply
    // to a request THEY raised went to a chat they cannot see (and, in a shop whose owner has no
    // LINE linked, to nobody at all). Their own LINE id is on the OPEN request this reply answers,
    // so no new recipient is reachable that the operator was not already answering.
    const requesters = await this.prisma.client.lineSupportRequest.findMany({
      where: { companyId: cmd.companyId, status: 'OPEN' },
      select: { lineUserId: true },
    });
    const recipients = [...new Set([
      ...await ownerLineUserIds(this.prisma, cmd.companyId),
      ...requesters.map((request) => request.lineUserId),
    ])];
    let delivered = 0;
    for (const providerUserId of recipients) {
      if (await pushSystemLineMessage(token, providerUserId, body)) delivered += 1;
    }

    // line-support-request-spec-th §2.3: answering the shop IS answering its request, so the
    // operator does not also have to remember to press a button. Only when something landed — a
    // message that reached nobody has not answered anybody. Bulk update because a shop may have
    // more than one person asking, and both are answered by the same message.
    if (delivered > 0) {
      await this.prisma.client.lineSupportRequest.updateMany({
        where: { companyId: cmd.companyId, status: 'OPEN' },
        data: { status: 'ANSWERED', answeredAt: new Date(), answeredByUserId: cmd.requestingAdminUserId },
      });
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
