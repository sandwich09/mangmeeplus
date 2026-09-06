import { ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LinkLineIdentityUseCase } from './link-line-identity.use-case';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { revokePendingLineHandoffTokens } from '../../domain/logic/line-handoff.logic';

function hashLineLinkToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class CompleteEmployeeLineLinkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkLineIdentity: LinkLineIdentityUseCase,
    private readonly lineVerifier: LineLoginVerifierAdapter,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { linkToken: string; idToken: string; requestId: string }): Promise<{ linked: true }> {
    const tokenHash = hashLineLinkToken(input.linkToken);
    const token = await this.prisma.client.employeeLineLinkToken.findUnique({ where: { tokenHash } });

    const fail = async (reason: string) => {
      void this.audit?.log({
        action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_FAILURE,
        targetType: 'EmployeeLineLinkToken',
        targetId: token?.id,
        companyId: token?.companyId,
        requestId: input.requestId,
        result: 'FAILED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason },
      });
      throw new ForbiddenException('LINE link token is invalid, expired, or already used.');
    };

    if (!token) return fail('token_not_found');
    // Re-scanning a consumed QR with the LINE account it already linked is success,
    // not a burned-token error — the identity is exactly in the state the QR promised.
    if (token.status === 'USED') {
      const linked = await this.tokenLinkedIdentity(token, input.idToken);
      if (linked) {
        // Self-heal: a crash between link and sever leaves the old identity ACTIVE;
        // the re-scan is the retry path for the sever, not just an idempotent success.
        await this.severOtherLineIdentities(token, linked.providerUserId, input.requestId).catch(() => undefined);
        return { linked: true };
      }
      return fail('token_not_pending');
    }
    if (token.status !== 'PENDING') return fail('token_not_pending');
    if (token.expiresAt.getTime() < Date.now()) return fail('token_expired');

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { id: token.membershipId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
    });
    if (!membership) return fail('membership_inactive');

    // H-09: claim the token atomically BEFORE any identity mutation. Two concurrent
    // LINE identities racing the same QR get exactly one winner; the loser fails here
    // with no side effect instead of linking first and losing the claim afterwards.
    const claimed = await this.prisma.client.employeeLineLinkToken.updateMany({
      where: { id: token.id, status: 'PENDING' },
      data: { status: 'USED', usedAt: new Date() },
    });
    if (claimed.count === 0) return fail('token_already_claimed');

    let linkedProviderUserId: string;
    try {
      const linked = await this.linkLineIdentity.execute({
        userId: token.userId,
        idToken: input.idToken,
        requestId: input.requestId,
        companyId: token.companyId,
        // Possession of this short-lived, single-use admin-issued token plus the
        // LINE login proves consent to move a previously linked LINE identity.
        allowReassign: true,
      });
      linkedProviderUserId = linked.providerUserId;
    } catch (err) {
      // Release the claim ONLY for failures that provably precede the identity write
      // inside the non-transactional link (Conflict = the unique slot was taken so our
      // create failed; Forbidden = disabled-identity/membership rules checked up front).
      // Anything else — verify failure, transient DB error after the identity persisted —
      // burns the token instead: restoring it would resurrect a bearer QR whose side
      // effects are unknown, and lets garbage idTokens hold a token alive across an
      // admin revoke (the revoke sweep only sees PENDING rows).
      if (err instanceof ConflictException || err instanceof ForbiddenException) {
        await this.releaseClaim(token.id, token.membershipId, token.createdAt);
      }
      // "Already linked to another user" is user-actionable and not sensitive —
      // masking it as a token error sends people hunting for a new QR that can never work.
      if (err instanceof ConflictException) {
        void this.audit?.log({
          action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_FAILURE,
          targetType: 'EmployeeLineLinkToken',
          targetId: token.id,
          companyId: token.companyId,
          requestId: input.requestId,
          result: 'FAILED',
          riskLevel: 'MEDIUM',
          metadataJson: { reason: 'line_identity_conflict' },
        });
        throw err;
      }
      return fail('line_verification_failed');
    }

    // Sever failure must not undo a committed link: report success with a flag and
    // rely on the re-scan self-heal above to finish the job.
    const severed = await this.severOtherLineIdentities(token, linkedProviderUserId, input.requestId).catch(() => null);

    void this.audit?.log({
      action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_SUCCESS,
      targetType: 'EmployeeLineLinkToken',
      targetId: token.id,
      companyId: token.companyId,
      actorUserId: token.userId,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      ...(severed === null
        ? { metadataJson: { lineIdentitySeverFailed: true } }
        : severed > 0
          ? { metadataJson: { unlinkedPreviousLineIdentities: severed } }
          : {}),
    });

    return { linked: true };
  }

  /** Best-effort claim release. If a newer token was issued while we held the claim,
   *  ours must stay dead — the reissue sweep only revokes PENDING rows and cannot see
   *  a transiently USED token, so we re-revoke ourselves after restoring. */
  private async releaseClaim(tokenId: string, membershipId: string, claimedTokenCreatedAt: Date): Promise<void> {
    try {
      const restored = await this.prisma.client.employeeLineLinkToken.updateMany({
        where: { id: tokenId, status: 'USED' },
        data: { status: 'PENDING', usedAt: null },
      });
      if (restored.count === 0) return;
      const newer = await this.prisma.client.employeeLineLinkToken.findFirst({
        where: { membershipId, id: { not: tokenId }, createdAt: { gt: claimedTokenCreatedAt } },
        select: { id: true },
      });
      if (newer) {
        await this.prisma.client.employeeLineLinkToken.updateMany({
          where: { id: tokenId, status: 'PENDING' },
          data: { status: 'REVOKED' },
        });
      }
    } catch {
      // Unrecoverable release failure leaves the token burned — fail closed; admin reissues.
    }
  }

  /** Identity cardinality: the admin-issued QR pins the user to exactly one LINE account.
   *  Leaving a previously linked account ACTIVE would let a lost or old phone keep
   *  logging in as this employee after a relink. Emits AUTH_IDENTITY_UNLINK per severed
   *  row so forensics can tell WHICH account was cut off, mirroring the unlink use case. */
  private async severOtherLineIdentities(
    token: { userId: string; companyId: string },
    keepProviderUserId: string,
    requestId: string,
  ): Promise<number> {
    const others = await this.prisma.client.externalIdentity.findMany({
      where: { userId: token.userId, provider: 'LINE', status: 'ACTIVE', providerUserId: { not: keepProviderUserId } },
      select: { id: true, providerUserId: true },
    });
    if (others.length === 0) return 0;
    for (const identity of others) {
      // One transaction per severed account, the same rule the two unlink use cases follow: an
      // identity flipped to UNLINKED whose deep links were NOT revoked is the worst of the three
      // outcomes, and it used to be unrecoverable — the self-heal re-scan above looks for ACTIVE
      // rows only, so the half-severed identity was already invisible to the retry and the bearer
      // link stayed alive for the rest of its TTL. Either all three writes land or the identity
      // stays ACTIVE and the next scan redoes it. Owner decision 2026-09-06.
      const handoffLinksRevoked = await this.prisma.client.$transaction(async (tx) => {
        await tx.externalIdentity.updateMany({
          where: { id: identity.id, status: 'ACTIVE' },
          data: { status: 'UNLINKED' },
        });
        // With no identity there is no selected company — the same one-liner the self-serve and
        // admin unlinks run, so all three sever paths now leave identical state.
        await tx.lineCompanyContext.deleteMany({ where: { lineUserId: identity.providerUserId } });
        // The old phone keeps whatever handoff deep links were sent to it, and each is a bearer
        // session for this employee until its TTL runs out.
        return revokePendingLineHandoffTokens(tx.lineWebHandoffToken, {
          lineUserId: identity.providerUserId,
          userId: token.userId,
        });
      });
      void this.audit?.log({
        actorUserId: token.userId,
        action: AuditAction.AUTH_IDENTITY_UNLINK,
        targetType: 'ExternalIdentity',
        targetId: identity.id,
        companyId: token.companyId,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: {
          reason: 'employee_line_relink',
          keptProviderUserId: keepProviderUserId,
          severedProviderUserId: identity.providerUserId,
          handoffLinksRevoked,
        },
      });
    }
    return others.length;
  }

  /** Returns the verified LINE account when it is the one THIS token linked, else null.
   *  An ACTIVE identity linked BEFORE the claim is the old phone — it must not be able
   *  to ride a leaked used QR into the grace path and sever the new account. */
  private async tokenLinkedIdentity(
    token: { userId: string; usedAt: Date | null },
    idToken: string,
  ): Promise<{ providerUserId: string } | null> {
    try {
      const { subject } = await this.lineVerifier.verify(idToken);
      const identity = await this.prisma.client.externalIdentity.findFirst({
        where: { provider: 'LINE', providerUserId: subject, userId: token.userId, status: 'ACTIVE' },
      });
      if (!identity) return null;
      if (token.usedAt && identity.linkedAt && identity.linkedAt.getTime() < token.usedAt.getTime()) return null;
      return { providerUserId: subject };
    } catch {
      return null;
    }
  }
}
