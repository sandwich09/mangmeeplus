import { ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

@Injectable()
export class LinkLineIdentityUseCase {
  constructor(
    private readonly lineVerifier: LineLoginVerifierAdapter,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; idToken: string; requestId: string; companyId?: string; allowReassign?: boolean }): Promise<{ linked: true; providerUserId: string }> {
    const { userId, idToken, requestId, companyId, allowReassign = false } = input;
    const { subject: lineUserId } = await this.lineVerifier.verify(idToken);
    // Messaging user ids are channel-scoped; LINE Login channel only verifies identity.
    const providerChannelId = this.config.lineMessagingChannelId ?? this.config.lineLoginChannelId ?? 'unknown';
    const resolvedCompanyId = await this.resolveCompanyId(userId, companyId);

    // Match regardless of status: an UNLINKED row still owns the unique
    // (provider, channel, providerUserId) slot, so it must be reactivated in
    // place — a create here would blow up on the unique constraint.
    const existing = await this.prisma.client.externalIdentity.findFirst({
      where: { provider: 'LINE', providerUserId: lineUserId },
    });

    if (existing?.status === 'ACTIVE') {
      if (existing.userId !== userId) {
        if (!allowReassign) throw new ConflictException('LINE account already linked to another user.');
        await this.prisma.client.externalIdentity.update({
          where: { id: existing.id },
          data: { userId, linkedAt: new Date() },
        });
      }
      // Same user re-links, or an admin-issued one-time QR moves the identity:
      // refresh LineCompanyContext and return success.
      await this.upsertCompanyContext(lineUserId, resolvedCompanyId);
      return { linked: true, providerUserId: lineUserId };
    }
    if (existing?.status === 'DISABLED') {
      // Admin kill-switch: relinking must not silently resurrect it.
      throw new ForbiddenException('LINE identity is disabled.');
    }

    if (existing) {
      // UNLINKED: reactivate for the current user (covers relink after unlink and
      // moving a severed LINE account to a different user).
      await this.prisma.client.externalIdentity.update({
        where: { id: existing.id },
        data: { userId, status: 'ACTIVE', linkedAt: new Date() },
      });
    } else {
      try {
        await this.prisma.client.externalIdentity.create({
          data: {
            userId,
            provider: 'LINE',
            providerUserId: lineUserId,
            providerChannelId,
            status: 'ACTIVE',
            linkedAt: new Date(),
          },
        });
      } catch (err) {
        // Concurrent link of the same LINE account through two flows: the unique
        // (provider, channel, providerUserId) slot was taken between our read and this
        // create. Surface the same conflict as the read path. Safe to catch here —
        // this create runs outside any transaction.
        if ((err as { code?: string }).code === 'P2002') {
          throw new ConflictException('LINE account already linked to another user.');
        }
        throw err;
      }
    }

    await this.upsertCompanyContext(lineUserId, resolvedCompanyId);

    void this.audit?.log({
      actorUserId: userId,
      action: AuditAction.AUTH_IDENTITY_LINK,
      targetType: 'ExternalIdentity',
      targetId: lineUserId,
      requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
    });

    return { linked: true, providerUserId: lineUserId };
  }

  /** Resolve selected company before mutating identity state.
   *  - explicit companyId: validate active membership; multi-company selection requires OWNER.
   *  - no companyId, single membership: auto-resolve.
   *  - no companyId, multiple memberships: skip context; webhook prompts selection. */
  private async resolveCompanyId(userId: string, companyId: string | undefined): Promise<string | undefined> {
    const activeMemberships = await this.prisma.client.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        companyId: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });

    if (companyId) {
      const membership = activeMemberships.find((m) => m.companyId === companyId);
      if (!membership) {
        throw new ForbiddenException('User is not an active member of the specified company.');
      }

      const isOwner = membership.roles.some((mr) => mr.role.key === 'OWNER');
      if (activeMemberships.length > 1 && !isOwner) {
        throw new ForbiddenException('Only OWNER users can select among multiple companies.');
      }

      return companyId;
    }

    if (activeMemberships.length === 0) {
      throw new ForbiddenException('User has no active company membership.');
    }
    if (activeMemberships.length === 1) {
      return activeMemberships[0]?.companyId;
    }

    // ponytail: 2+ memberships without explicit context: skip write; webhook will prompt selection
    return undefined;
  }

  private async upsertCompanyContext(lineUserId: string, companyId: string | undefined): Promise<void> {
    if (!companyId) return;

    await this.prisma.client.lineCompanyContext.upsert({
      where: { lineUserId },
      create: { lineUserId, companyId, selectedAt: new Date() },
      update: { companyId, selectedAt: new Date() },
    });
  }
}
