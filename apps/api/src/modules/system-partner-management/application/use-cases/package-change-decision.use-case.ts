import { LineMessagingCredentialsService } from '../../../../common/config/line-messaging-credentials.service';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  PLAN_TIER_PRESETS,
  type AdminPackageChangeDecisionBody,
  type AdminPackageChangeDecisionDto,
  type AdminPackageChangeItemDto,
  type AdminPackageChangeQueueDto,
  type PackageChangeRequestStatus,
  type PlanTierKey,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { pushSystemLineMessage } from '../../../auth/infrastructure/system-line-push';
import { checkShopMessage, shopMessageAllowedHosts } from '../../domain/logic/partner-line-message.logic';
import { SetCompanyPlanTermUseCase, paidPlanReviewRequired } from './company-plan-term.use-cases';

export const PACKAGE_CHANGE_DECIDED_ACTION = 'signup.line.package_change_decided';

/** Owner copy (§7 register). No plus sign in customer text; write "และ". */
/** The operator's note is a SEPARATE line: run together, an internal-sounding remark reads as
 *  part of the platform's own sentence in the customer's chat. */
export function packageChangeApprovedMessageTh(tierKey: string, note?: string): string {
  const label = PLAN_TIER_PRESETS[tierKey as PlanTierKey]?.labelTh ?? tierKey;
  return `เปลี่ยนแพ็กเกจเป็น ${label} แล้วค่ะ${note ? `\n${note}` : ''}`;
}

export function packageChangeRejectedMessageTh(note?: string): string {
  return 'ตอนนี้ยังเปลี่ยนแพ็กเกจให้ไม่ได้ ต้องขออภัยด้วยนะคะ '
    + `ติดต่อทีมงานได้ที่ โทร 098-256-5628 (จันทร์–เสาร์ 9:00–18:00) ค่ะ${note ? `\n${note}` : ''}`;
}

/**
 * P10-L §8, the admin half of the package-change queue.
 *
 * APPROVE is deliberately not its own tier writer: it CLAIMS the row and then calls the very
 * use-case `PUT /system/partners/:id/plan-term` calls, so a customer's limits still move in exactly
 * one place (H-01) with the same CRITICAL before/after audit row. The claim is a CAS on `OPEN`, so
 * two operators tapping the same row produce one tier change, not two — and a failure inside the
 * tier write puts the row back where the next operator can find it.
 */
@Injectable()
export class PackageChangeDecisionUseCase {
  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly prisma: PrismaService,
    private readonly setPlanTerm: SetCompanyPlanTermUseCase,
    private readonly config: AppConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  async list(status: PackageChangeRequestStatus = 'OPEN'): Promise<AdminPackageChangeQueueDto> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        company: { select: { name: true, planTerm: { select: { tierKey: true, billingReceiptAccountId: true } } } },
      },
    });
    if (rows.length === 0) return { items: [] };

    // One batched read rather than one per row: the requester's name is the only thing the row
    // itself cannot answer, and `requestedByUserId` is not a relation.
    const requesters = await this.prisma.client.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.requestedByUserId))] } },
      select: { id: true, displayName: true },
    });
    const nameByUserId = new Map(requesters.map((user) => [user.id, user.displayName]));

    return {
      items: rows.map((row): AdminPackageChangeItemDto => ({
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        requestedTierKey: row.requestedTierKey,
        ...(row.company.planTerm?.billingReceiptAccountId ? {billingReviewPath:`/system/billing/companies/${encodeURIComponent(row.companyId)}/plan-adjustments`} : {}),
        ...(row.company.planTerm?.tierKey ? { currentTierKey: row.company.planTerm.tierKey } : {}),
        ...(nameByUserId.get(row.requestedByUserId)
          ? { requestedByDisplayName: nameByUserId.get(row.requestedByUserId)! }
          : {}),
        status: row.status as PackageChangeRequestStatus,
        ...(row.note ? { note: row.note } : {}),
        createdAt: row.createdAt.toISOString(),
        ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
      })),
    };
  }

  async decide(
    id: string,
    body: AdminPackageChangeDecisionBody,
    adminUserId: string,
    requestId: string,
  ): Promise<AdminPackageChangeDecisionDto> {
    const row = await this.prisma.client.packageChangeRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('package_change_request_not_found');
    // Idempotent by contract: a decided row answers with the decision it already carries. Repeating
    // APPROVE must never buy a second tier change.
    if (row.status !== 'OPEN') return { id, status: row.status as PackageChangeRequestStatus };

    const target: PackageChangeRequestStatus = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (body.action === 'APPROVE' && !Object.hasOwn(PLAN_TIER_PRESETS, row.requestedTierKey)) {
      throw new UnprocessableEntityException(`tierKey "${row.requestedTierKey}" is not a known plan tier.`);
    }
    // MEDIUM-3: this note is PUSHED into the shop's LINE chat, so it is the same trust boundary the
    // message box is — and it was crossing it unchecked. Same fence, same codes, and checked BEFORE
    // the CAS claim so a refused note leaves the row exactly where the operator found it.
    const note = this.checkedNote(body.note);

    if (body.action === 'APPROVE') {
      const term = await this.prisma.client.companyPlanTerm.findUnique({where:{companyId:row.companyId},select:{billingReceiptAccountId:true}});
      if (term?.billingReceiptAccountId) throw paidPlanReviewRequired();
    }

    // Claim first. The loser of a race sees a decided row above on its next read and changes nothing.
    const claimed = await this.prisma.client.packageChangeRequest.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: target, decidedByUserId: adminUserId, decidedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.client.packageChangeRequest.findUnique({ where: { id } });
      return { id, status: (current?.status ?? 'OPEN') as PackageChangeRequestStatus };
    }

    if (body.action === 'APPROVE') {
      const preset = PLAN_TIER_PRESETS[row.requestedTierKey as PlanTierKey];
      try {
        await this.setPlanTerm.execute({
          companyId: row.companyId,
          tierKey: row.requestedTierKey as PlanTierKey,
          branchLimit: preset.branchLimit,
          employeeLimit: preset.employeeLimit,
          monthlySlipLimit: preset.monthlySlipLimit,
          requestingAdminUserId: adminUserId,
          requestId,
        });
      } catch (error) {
        // The tier did not move, so the row must not claim it did — put it back in the queue.
        await this.prisma.client.packageChangeRequest.updateMany({
          where: { id, status: 'APPROVED' },
          data: { status: 'OPEN', decidedByUserId: null, decidedAt: null },
        });
        throw error;
      }
    }

    await this.prisma.client.auditLog.create({
      data: {
        companyId: row.companyId,
        actorUserId: adminUserId,
        action: PACKAGE_CHANGE_DECIDED_ACTION,
        targetType: 'package_change_request',
        targetId: id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          // The paragraph IS the evidence, exactly as it is for the message box: an operator
          // speaking to a customer as the platform leaves behind what they actually said.
          action: body.action,
          requestedTierKey: row.requestedTierKey,
          ...(note ? { note } : {}),
        },
      },
    });

    await this.notifyShop(row.companyId, body, row.requestedTierKey, note);
    return { id, status: target };
  }

  /**
   * The operator's own paragraph, held to the SEC-05 rule the message box is held to: a link in a
   * push our Verified OA sends inherits that account's trust, wherever in the product it was typed.
   */
  private checkedNote(raw: string | undefined): string | undefined {
    if (!raw?.trim()) return undefined;
    const check = checkShopMessage(raw, shopMessageAllowedHosts(this.config.sesWebBaseUrl));
    if (check.ok) return check.text;
    // Same literal codes the message box throws, so one Thai sentence covers both routes.
    if (check.reason === 'too_long') throw new UnprocessableEntityException('partner_line_message_too_long');
    throw new UnprocessableEntityException('partner_line_message_external_link');
  }

  /**
   * Best-effort by contract: the tier has already moved, and a dead LINE OA must not undo it. The
   * notice goes to the shop's OWNERs, which is who asked — never to every member.
   */
  private async notifyShop(
    companyId: string,
    body: AdminPackageChangeDecisionBody,
    requestedTierKey: string,
    note: string | undefined,
  ): Promise<void> {
    const credentials = await this.lineCredentials.get().catch(() => null);
    const token = credentials?.accessToken;
    if (!token || !credentials?.channelId) return;
    const text = body.action === 'APPROVE'
      ? packageChangeApprovedMessageTh(requestedTierKey, note)
      : packageChangeRejectedMessageTh(note);
    for (const providerUserId of await ownerLineUserIds(this.prisma, companyId, credentials.channelId)) {
      if (!await pushSystemLineMessage(token, providerUserId, text)) {
        this.logger.warn(
          { event: 'signup.line.package_change_notice_failed', riskLevel: 'LOW' },
          'signup.line.package_change_notice_failed',
        );
      }
    }
  }
}

/**
 * The LINE identities of a shop's active OWNERs. Shared with the admin message box (SEC-05): both
 * answer "who speaks for this shop", and one definition keeps them from drifting apart.
 */
export async function ownerLineUserIds(prisma: PrismaService, companyId: string, channelId: string): Promise<string[]> {
  const owners = await prisma.client.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
    select: { userId: true },
  });
  if (owners.length === 0) return [];
  const identities = await prisma.client.externalIdentity.findMany({
    where: { userId: { in: owners.map((owner) => owner.userId) }, provider: 'LINE', providerChannelId: channelId, status: 'ACTIVE' },
    select: { providerUserId: true },
  });
  // One owner may hold more than one identity row; the shop wants one message, not two.
  return [...new Set(identities.map((identity) => identity.providerUserId))];
}
