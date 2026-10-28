import { isFreeExpenseDraftCompany } from '../../../system-partner-management/application/free-expense-access';
import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { hashLineHandoffToken, isLineGroupChatKey, resolveLineHandoffTarget, LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN } from '../../domain/logic/line-handoff.logic';
import { LegalAcceptanceService } from '../legal-acceptance.service';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';

/** Every reason a refusal can carry. It reaches audit only — never the caller (spec §10). */
export type LineHandoffRefusalReason =
  | 'token_not_found'
  | 'token_expired'
  | 'token_not_pending'
  | 'user_inactive'
  | 'membership_inactive'
  | 'company_inactive'
  | 'line_identity_severed';

export type ExchangeLineHandoffTokenResult = AuthTokensResult & {
  companyId: string;
  targetPath: string;
  mustChangePassword: boolean;
  legalAcceptanceRequired: boolean;
};

const GENERIC_REFUSAL = 'This link is expired or has already been used.';

/**
 * P12-3b step 2 (spec §11): a token in a URL becomes a first-party session for the user the LINE
 * message was addressed to.
 *
 * The ORDER of the checks below is the security property, not a style choice:
 *   1. look up by hash — an unknown token is indistinguishable from an expired one to the caller;
 *   2. status and TTL;
 *   3. re-resolve LINE identity / user / membership / company, so access revoked between send and
 *      tap — including the LINE link itself being severed — is refused;
 *   4. claim PENDING → USED atomically, BEFORE any session exists, so two taps mint one session;
 *   5. only then issue.
 *
 * The exchange never widens access: it can only produce a session for the user the token names, and
 * the destination comes from the row, never from the request.
 */
@Injectable()
export class ExchangeLineHandoffTokenUseCase {
  private readonly logger = new Logger(ExchangeLineHandoffTokenUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    private readonly legalAcceptance: LegalAcceptanceService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { token: string }): Promise<ExchangeLineHandoffTokenResult> {
    const now = new Date();

    // 1. Lookup by hash. The raw token never reaches the query, the row, or a log line.
    const record = await this.prisma.client.lineWebHandoffToken.findUnique({
      where: { tokenHash: hashLineHandoffToken(input.token) },
    });
    if (!record) throw this.refuse('token_not_found');

    // 2. Status and TTL. From here the token is known, so the refusal may carry the destination the
    //    user was trying to reach — see `refuse`.
    if (record.status !== 'PENDING') throw this.refuse('token_not_pending', record);
    if (record.expiresAt <= now) throw this.refuse('token_expired', record);

    // 3. Re-resolve identity at exchange time. "Removing or inactivating a user from a company
    //    immediately blocks LINE AI, alerts, deep links" — line-ai-channel-auth-spec.md §4.
    const [lineIdentity, user, membership, company] = await Promise.all([
      // The LINE link itself. Severing a link revokes the tokens already sent to that chat, but
      // that revoke is one UPDATE that can fail — the employee relink sever proved it — so this is
      // the second wall. Channel-agnostic because the token row carries no channel, matching the
      // fallback branch `resolveLineIdentity` already uses; served by `[userId, provider, status]`,
      // one indexed read in either mode.
      //
      // Two modes, because `record.lineUserId` is the CHAT the message went to, not always a
      // person (`isLineGroupChatKey`):
      //  - 1:1 — matched exactly as `resolveLineIdentity` does (provider + providerUserId + ACTIVE)
      //    plus the token's own `userId`, which is what covers the re-point case where the identity
      //    is ACTIVE but now somebody else's;
      //  - group/room — the chat key is a group id, and no identity can hold one as
      //    `providerUserId`, so requiring it would refuse EVERY link sent into a group. There the
      //    wall is the part that still means something: this user has a live LINE link at all.
      this.prisma.client.externalIdentity.findFirst({
        where: {
          userId: record.userId,
          provider: 'LINE',
          ...(isLineGroupChatKey(record.lineUserId) ? {} : { providerUserId: record.lineUserId }),
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      this.prisma.client.user.findUnique({
        where: { id: record.userId },
        select: { status: true, credential: { select: { mustChangePassword: true } } },
      }),
      this.prisma.client.companyMembership.findFirst({
        where: { userId: record.userId, companyId: record.companyId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.client.company.findUnique({ where: { id: record.companyId }, select: { status: true, archivedAt: true, planTerm: { select: { termEndsAt: true, termDisabledAt: true, tierKey: true } } } }),
    ]);
    if (!lineIdentity) throw this.refuse('line_identity_severed', record);
    if (!user || user.status !== 'ACTIVE') throw this.refuse('user_inactive', record);
    if (!membership) throw this.refuse('membership_inactive', record);
    const freeExpenseDrafts = company?.planTerm?.tierKey === 'FREE_TRIAL_15'
      && await isFreeExpenseDraftCompany(this.prisma.client, record.companyId, now);
    const targetPath = company && resolveLineHandoffTarget(record.companyId, record.targetPath, company, now, freeExpenseDrafts);
    if (!targetPath) throw this.refuse('company_inactive', record);

    // 4. Claim before issuing, exactly as complete-employee-line-link does. The loser of a race
    //    matches zero rows and falls through to normal login rather than getting a second session.
    const claimed = await this.prisma.client.lineWebHandoffToken.updateMany({
      where: { id: record.id, status: 'PENDING' },
      data: { status: 'USED', usedAt: now },
    });
    if (claimed.count === 0) throw this.refuse('token_not_pending', record);

    // 4b. The บริษัทของฉัน picker's "เปิดเว็บบริษัทนี้" button is ONE tap that has to do two things
    //     (Owner 2026-09-06). LINE cannot call back on a `uri` tap, so the LINE half happens here,
    //     after the single-use claim — a link that lost the race, expired, or was refused above
    //     must not be able to move the chat. Surface-scoped: every other handoff link opens the web
    //     without touching which shop the conversation is about.
    if (record.surface === LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN) {
      await this.switchLineCompanyContext(record);
    }

    // 5. `'line'` is the true origin of this session and the owner-locked rule in
    //    password-reset-line-flow-spec.md; owner decision 2026-08-29 (spec §17 Q1) keeps it. The
    //    web layout still gates the temporary password because /auth/me reports the credential
    //    truthfully — the exemption widened here is the API one, re-opened in a dedicated pass.
    const tokens = await this.issueToken.execute(record.userId, 'line');

    // Same derivation password login uses: `mustChangePassword` off the UserCredential row, and
    // `legalAcceptanceRequired` off LegalAcceptanceService for this exact membership.
    const legal = await this.legalAcceptance.getStatus({
      userId: record.userId,
      companyId: record.companyId,
      membershipId: membership.id,
    });

    void this.audit?.log({
      action: AuditAction.AUTH_LINE_HANDOFF_EXCHANGE,
      actorUserId: record.userId,
      companyId: record.companyId,
      targetType: 'line_web_handoff_token',
      targetId: record.id,
      requestId: randomUUID(),
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { surface: record.surface },
    });

    return {
      ...tokens,
      companyId: record.companyId,
      targetPath,
      mustChangePassword: user.credential?.mustChangePassword ?? false,
      legalAcceptanceRequired: legal.required,
    };
  }

  /**
   * The same write the in-LINE switch makes (`process-line-webhook.use-case.ts` handleCompanyCommand),
   * so the two entrances leave identical state: same row key, same kept `aiPausedUntil` — a support
   * hold means a human has this thread, and opening the web is not a request to hand it back — and
   * the same `ai.line.company_context.switch` audit action, distinguished only by its surface.
   *
   * Best-effort on purpose. The web half of this tap is already paid for by the time we get here
   * (the token is spent); failing the whole exchange because the LINE side could not be written
   * would cost the customer the page they asked for and leave them nothing.
   */
  private async switchLineCompanyContext(record: { userId: string; companyId: string; lineUserId: string; surface: string }): Promise<void> {
    try {
      const selectedAt = new Date();
      await this.prisma.client.lineCompanyContext.upsert({
        where: { lineUserId: record.lineUserId },
        create: { lineUserId: record.lineUserId, companyId: record.companyId, selectedAt },
        update: { companyId: record.companyId, selectedAt },
      });
      void this.audit?.log({
        companyId: record.companyId,
        actorUserId: record.userId,
        action: 'ai.line.company_context.switch',
        targetType: 'LineCompanyContext',
        requestId: randomUUID(),
        result: 'SUCCESS',
        riskLevel: 'LOW',
        metadataJson: { lineUserId: '[REDACTED]', surface: record.surface },
      });
    } catch (error) {
      this.logger.warn({ msg: 'line_handoff_company_switch_failed', surface: record.surface, error: (error as Error).message });
    }
  }

  /**
   * One generic 403 for every refusal; the reason goes to audit, not to the caller.
   *
   * Deviation from spec §12's fully-generic body, and deliberate: when the token was FOUND we
   * return its `targetPath` so the web route can send the user to `/login?next=<target>`, which
   * spec §15 acceptance 3 requires ("the second tap lands on /login?next=<target>, never a blank
   * error"). An unknown token carries nothing — there is no destination to preserve and echoing
   * anything would be an enumeration oracle.
   */
  private refuse(
    reason: LineHandoffRefusalReason,
    record?: { id: string; userId: string; companyId: string; surface: string; targetPath: string },
  ): ForbiddenException {
    void this.audit?.log({
      action: AuditAction.AUTH_LINE_HANDOFF_EXCHANGE,
      ...(record ? { actorUserId: record.userId, companyId: record.companyId, targetId: record.id } : {}),
      targetType: 'line_web_handoff_token',
      requestId: randomUUID(),
      result: 'FAILED',
      riskLevel: 'MEDIUM',
      metadataJson: { reason, ...(record ? { surface: record.surface } : {}) },
    });
    // L-14: a burst of invalid handoff tokens is what guessing looks like, so it gets an
    // alarm-shaped line. The name is the contract; the reason stays in audit.
    emitSecurityEvent(this.logger, SECURITY_EVENT.authLineHandoffDenied, 'HIGH', { reason });
    return new ForbiddenException({
      code: 'line_handoff_unavailable',
      message: GENERIC_REFUSAL,
      ...(record ? { targetPath: record.targetPath } : {}),
    });
  }
}
