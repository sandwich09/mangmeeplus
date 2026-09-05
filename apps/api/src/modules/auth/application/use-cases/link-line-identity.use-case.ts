import { ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { lineIdentityLockKey } from '../../../../common/database/line-identity-lock';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

@Injectable()
export class LinkLineIdentityUseCase {
  constructor(
    private readonly lineVerifier: LineLoginVerifierAdapter,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; idToken: string; requestId: string; companyId?: string; allowReassign?: boolean; expectedNonce?: string }): Promise<{ linked: true; providerUserId: string }> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'line-link', requestId: input.requestId, targetType: 'external_identity',
        actorUserId: input.userId, ...(input.companyId ? { companyId: input.companyId } : {}),
      },
      () => this.link(input),
      () => ({ outcome: 'linked' }),
    );
  }

  private async link(input: { userId: string; idToken: string; requestId: string; companyId?: string; allowReassign?: boolean; expectedNonce?: string }): Promise<{ linked: true; providerUserId: string }> {
    const { userId, idToken, requestId, companyId, allowReassign = false, expectedNonce } = input;
    // The web OAuth lane (P12-2) supplies the nonce it minted, so the ID token must prove it came
    // from that round trip; the LIFF/link surfaces pass none and stay byte-exact.
    const { subject: lineUserId } = await this.lineVerifier.verify(
      idToken,
      expectedNonce ? { nonce: expectedNonce } : undefined,
    );
    // Messaging user ids are channel-scoped; LINE Login channel only verifies identity.
    const canonicalChannelId = this.config.lineMessagingChannelId ?? this.config.lineLoginChannelId;
    if (!canonicalChannelId && this.config.isProduction) {
      // P12.1: production must not create or resolve 'unknown'-channel identities.
      throw new ServiceUnavailableException('LINE channel configuration is missing.');
    }
    // ponytail: 'unknown' survives for local/dev only; production fails closed above
    const providerChannelId = canonicalChannelId ?? 'unknown';
    const resolvedCompanyId = await this.resolveCompanyId(userId, companyId);

    /**
     * Review MED-1. Signup provisioning re-points this SAME row inside its own company
     * transaction, and an owner can trigger a link at any moment. Both sides used to read and then
     * update with nothing between them: the second UPDATE waited on the row lock, then overwrote
     * the first — so a link landing beside a fresh provisioning silently took the LINE credential
     * off the owner of the shop that had just been built, and that credential is their only way in.
     *
     * One transaction, one shared advisory key, and the read happens INSIDE the lock so it is the
     * decision rather than a guess that was already stale. Keyed on the canonical channel: it is
     * the only channel either writer ever creates rows on, so a legacy-channel row picked up by the
     * fallback below cannot be one provisioning is touching.
     */
    const alreadyActive = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lineIdentityLockKey(providerChannelId, lineUserId)}, 0))`;

      // Match regardless of status: an UNLINKED row still owns the unique
      // (provider, channel, providerUserId) slot, so it must be reactivated in
      // place — a create here would blow up on the unique constraint. Prefer the
      // canonical-channel row (P12.1); fall back to legacy-channel rows with a
      // warn until the migration backfill lands.
      const matchAnyStatus = { provider: 'LINE' as const, providerUserId: lineUserId };
      const existing =
        (await tx.externalIdentity.findFirst({ where: { ...matchAnyStatus, providerChannelId } })) ??
        (await tx.externalIdentity.findFirst({ where: matchAnyStatus }));
      if (existing && existing.providerChannelId !== providerChannelId) {
        console.warn(`[line-link] line_identity_legacy_channel_row identityId=${existing.id}`);
      }

      if (existing?.status === 'ACTIVE') {
        if (existing.userId !== userId) {
          if (!allowReassign) throw new ConflictException({ code: 'line_linked_elsewhere', message: 'LINE account already linked to another user.' });
          await tx.externalIdentity.update({
            where: { id: existing.id },
            data: { userId, linkedAt: new Date() },
          });
        }
        // Same user re-links, or an admin-issued one-time QR moves the identity.
        return true;
      }
      if (existing?.status === 'DISABLED') {
        // Admin kill-switch: relinking must not silently resurrect it.
        throw new ForbiddenException('LINE identity is disabled.');
      }

      if (existing) {
        // UNLINKED: reactivate for the current user (covers relink after unlink and
        // moving a severed LINE account to a different user).
        await tx.externalIdentity.update({
          where: { id: existing.id },
          data: { userId, status: 'ACTIVE', linkedAt: new Date() },
        });
      } else {
        try {
          await tx.externalIdentity.create({
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
          // The lock above makes this unreachable for the canonical channel, so it stands as the
          // fail-closed answer for anything that writes the slot without taking the key. Throwing
          // rolls this transaction back, which is what makes catching it here safe.
          if ((err as { code?: string }).code === 'P2002') {
            throw new ConflictException({ code: 'line_linked_elsewhere', message: 'LINE account already linked to another user.' });
          }
          throw err;
        }
      }
      return false;
    });

    // Outside the lock on purpose: neither the company context nor the audit decides the slot, and
    // holding an advisory key across them would serialise unrelated work.
    await this.upsertCompanyContext(lineUserId, resolvedCompanyId);
    if (alreadyActive) return { linked: true, providerUserId: lineUserId };

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
   *  - explicit companyId: validate active membership — any role (Owner decision 2026-08-29:
   *    linking and company selection are login-level; per-company authorization stays with the
   *    permission resolver and branch ABAC downstream).
   *  - no companyId, single membership: auto-resolve.
   *  - no companyId, multiple memberships: skip context; webhook prompts selection. */
  private async resolveCompanyId(userId: string, companyId: string | undefined): Promise<string | undefined> {
    const activeMemberships = await this.prisma.client.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: { companyId: true },
    });

    if (companyId) {
      if (!activeMemberships.some((m) => m.companyId === companyId)) {
        throw new ForbiddenException('User is not an active member of the specified company.');
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
      // Review MED-2: `aiPausedUntil` is the §8 "ติดต่อเจ้าหน้าที่" hold on one conversation about
      // one shop. This path can move a severed LINE account to a DIFFERENT user, so carrying the
      // hold over would open somebody else's shop with the assistant silently switched off until a
      // timestamp nobody can see expires. Cleared on every link, including a re-link by the same
      // person: deliberately re-attaching an account is a fresh start, not a paused thread.
      update: { companyId, selectedAt: new Date(), aiPausedUntil: null },
    });
  }
}
