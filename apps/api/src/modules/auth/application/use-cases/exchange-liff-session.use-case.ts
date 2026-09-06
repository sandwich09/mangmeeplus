import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { requiredWebAppBase } from '../../../../common/http/public-api-base';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { AuthRateLimitService } from '../auth-rate-limit.service';
import { LineIdTokenService } from '../line-id-token.service';
import { lineHandoffUrl } from '../../domain/logic/line-handoff.logic';
import { MintLineHandoffTokenUseCase } from './mint-line-handoff-token.use-case';

/**
 * Spec §15.2 B-07. Owner decision 2026-09-06: the shop's own overview, not the upload form —
 * the same landing `/l/<token>` already falls back to when a row carries no target path.
 */
export const LIFF_START_TARGET_PATH = 'dashboard';

/** Why the tap cannot open the app. Each maps to one plain-Thai sentence on the LIFF page. */
export type LiffSessionBlockedReason = 'suspended' | 'expired' | 'no_membership';

export type ExchangeLiffSessionResult =
  | { handoffUrl: string }
  /** This LINE account has no active user — the page offers the signup form instead. */
  | { needsSignup: true }
  | { needsSelection: true; companies: Array<{ id: string; name: string }> }
  | { reason: LiffSessionBlockedReason };

export type ExchangeLiffSessionCommand = {
  idToken: string;
  /** Echoed back from the picker on the second call. Validated against live memberships, never trusted. */
  companyId?: string;
};

/**
 * P10-L §3.5. "เริ่มใช้งาน" with no login screen: the LIFF page proves who is tapping, the server
 * decides which shop that means, and the answer is a 15-minute handoff URL minted AT THE TAP —
 * never a token that sat in a chat log (LINE-ONBOARD-01).
 *
 * Every decision here is re-derived from live rows. The only thing the client contributes besides
 * the token is a company id, and that is accepted solely because it is checked against the
 * memberships this token's user actually holds.
 */
@Injectable()
export class ExchangeLiffSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly mint: MintLineHandoffTokenUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(cmd: ExchangeLiffSessionCommand): Promise<ExchangeLiffSessionResult> {
    // The handoff route is what this endpoint hands out. With it off there is no destination to
    // send anyone to, so it refuses rather than minting a token nothing will accept.
    if (!this.config.lineWebHandoffEnabled) throw new ForbiddenException('line_web_handoff_disabled');
    // Read before the token is verified: unset means the URL we would build points nowhere.
    const webBaseUrl = requiredWebAppBase(this.config.sesWebBaseUrl);

    const verified = await this.lineIdToken.verify(cmd.idToken);
    // Charged on every exchange by this verified account (spec §9): the picker's second call is a
    // second exchange, which is exactly the cost this bucket is sized for.
    await this.rateLimit.assertLineLiffSessionAllowed(verified.providerUserId);

    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: {
        provider: 'LINE',
        providerChannelId: verified.channelId,
        providerUserId: verified.providerUserId,
        status: 'ACTIVE',
      },
      select: { userId: true, user: { select: { status: true } } },
    });
    // No identity, or one pointing at a disabled account: from the page's side both mean "you do
    // not have a shop here yet", and the honest next step is the signup form.
    if (!identity || identity.user.status !== 'ACTIVE') return { needsSignup: true };

    const decision = await this.resolveCompany(identity.userId, verified.providerUserId, cmd.companyId);
    if ('companyId' in decision) {
      const targetPath = `/companies/${decision.companyId}/${LIFF_START_TARGET_PATH}`;
      const { rawToken } = await this.mint.execute({
        userId: identity.userId,
        companyId: decision.companyId,
        lineUserId: verified.providerUserId,
        surface: 'liff_start',
        targetPath,
      });
      void this.audit.log({
        action: AuditAction.AUTH_LINE_LIFF_SESSION,
        actorUserId: identity.userId,
        companyId: decision.companyId,
        targetType: 'line_liff_session',
        requestId: randomUUID(),
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: { targetPath, companyChosenByUser: cmd.companyId !== undefined },
      });
      return { handoffUrl: lineHandoffUrl(webBaseUrl, rawToken) };
    }
    return decision;
  }

  /**
   * Membership first, context second. A `LineCompanyContext` row is a preference, not a grant: it
   * only ever narrows the live membership list, so a stale row pointing at a shop this user has
   * left resolves as if it were absent.
   */
  private async resolveCompany(
    userId: string,
    lineUserId: string,
    requestedCompanyId: string | undefined,
  ): Promise<{ companyId: string } | Exclude<ExchangeLiffSessionResult, { handoffUrl: string }>> {
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true, company: { select: { name: true } } },
    });

    if (requestedCompanyId) {
      const chosen = memberships.find((membership) => membership.companyId === requestedCompanyId);
      // A company id that is not on this token's own list is not a bad request to explain — it is
      // an answer to a question the server did not ask.
      if (!chosen) return { reason: 'no_membership' };
      return { companyId: chosen.companyId };
    }

    if (memberships.length === 0) return { reason: await this.blockedReason(userId) };
    if (memberships.length === 1) return { companyId: memberships[0]!.companyId };

    const context = await this.prisma.client.lineCompanyContext.findUnique({ where: { lineUserId } });
    const current = context && memberships.find((membership) => membership.companyId === context.companyId);
    if (current) return { companyId: current.companyId };
    return {
      needsSelection: true,
      companies: memberships.map((membership) => ({ id: membership.companyId, name: membership.company.name })),
    };
  }

  /**
   * The user has an account but no ACTIVE shop. `termDisabledAt` is what separates a trial that ran
   * out — which the customer can fix by asking for a package — from a shop an admin switched off,
   * where the honest answer is "talk to us" (same predicate the LINE assistant's expired-owner
   * reply uses, so the two surfaces cannot disagree).
   */
  private async blockedReason(userId: string): Promise<LiffSessionBlockedReason> {
    const inactive = await this.prisma.client.companyMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        company: { status: { in: ['DISABLED', 'SUSPENDED'] } },
      },
      orderBy: { createdAt: 'asc' },
      select: { company: { select: { status: true, planTerm: { select: { termDisabledAt: true } } } } },
    });
    if (!inactive) return 'no_membership';
    return inactive.company.status === 'DISABLED' && inactive.company.planTerm?.termDisabledAt
      ? 'expired'
      : 'suspended';
  }
}
