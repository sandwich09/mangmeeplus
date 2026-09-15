import { lockAccountEmail } from '../account-email-state';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { AccountMergeAccountSummaryDto, AccountMergePreviewDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { planAccountMerge, type MergeCompanyPlan, type MergeMembershipView } from '../../domain/logic/account-merge.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';
import { hashToken } from '../../domain/logic/secure-token.logic';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';

/** Long enough to read the dialog on a phone, short enough that a stale cookie is not an authority. */
export const ACCOUNT_MERGE_TICKET_TTL_MS = 15 * 60_000;

export type AccountMergeResult = { merged: true } & AuthTokensResult;

/** Everything the R05 plan needs from a membership, and nothing that would put a role id in a DTO. */
const MEMBERSHIP_SELECT = {
  id: true,
  companyId: true,
  status: true,
  company: { select: { name: true } },
  roles: { select: { role: { select: { key: true } } } },
} as const;

type MembershipRow = {
  companyId: string;
  status: string;
  company: { name: string } | null;
  roles: Array<{ role: { key: string } }>;
};

const toView = (membership: MembershipRow): MergeMembershipView => ({
  companyId: membership.companyId,
  companyName: membership.company?.name ?? '',
  status: membership.status,
  roleKeys: membership.roles.map((entry) => entry.role.key),
});

/**
 * Spec §4F: "รวมเข้าบัญชีเดิม". The company memberships of the account the caller is signed in as
 * move to the account that already owns the LINE identity they just proved control of, the email
 * follows if the target has none, and the emptied account is DISABLED — never deleted, so its audit
 * trail stays readable. The caller ends the call signed in as the existing account.
 *
 * The ticket is the only new authority here and it is deliberately weak: it names two users and
 * expires in minutes. Everything that decides whether the merge may happen — session ownership,
 * target status, which memberships exist — is re-read at spend time.
 */
@Injectable()
export class AccountMergeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; ticket: string; requestId: string }): Promise<AccountMergeResult> {
    return observeCustomerJourney(
      this.audit,
      { key: 'account-merge', requestId: input.requestId, targetType: 'user', actorUserId: input.userId },
      () => this.merge(input),
      () => ({ outcome: 'merged' }),
    );
  }

  /**
   * Review R05: what this merge would do, answered before anything is written. The dialog needs it
   * to name the shops that move, the shops that block, and — because the merge closes an account —
   * which way of signing in still works afterwards. Read-only: no ticket is spent, nothing changes,
   * and a caller holding someone else's ticket learns exactly what `merge` would tell them.
   */
  async preview(input: { userId: string; ticket: string }): Promise<AccountMergePreviewDto> {
    const row = await this.prisma.client.accountMergeTicket.findUnique({
      where: { tokenHash: hashToken(input.ticket) },
    });
    if (!row) throw new NotFoundException({ code: 'merge_ticket_invalid', message: 'Merge ticket is unknown.' });
    if (row.newUserId !== input.userId) {
      throw new ForbiddenException({ code: 'merge_ticket_not_yours', message: 'Merge ticket belongs to another session.' });
    }

    const [memberships, keeps, closes] = await Promise.all([
      this.prisma.client.companyMembership.findMany({
        where: { userId: input.userId, status: 'ACTIVE' },
        select: MEMBERSHIP_SELECT,
      }),
      this.accountSummary(row.existingUserId),
      this.accountSummary(input.userId),
    ]);
    const counterparts = await this.prisma.client.companyMembership.findMany({
      where: { userId: row.existingUserId, companyId: { in: memberships.map((m) => m.companyId) } },
      select: MEMBERSHIP_SELECT,
    });

    const plan = planAccountMerge(memberships.map(toView), counterparts.map(toView));
    return {
      canMerge: plan.every((entry) => entry.outcome !== 'blocked'),
      keeps,
      closes,
      companies: plan.map(({ companyName, outcome, reason }) => ({
        companyName, outcome, ...(reason ? { reason } : {}),
      })),
    };
  }

  /** Display name, username and the ways in — never the address, on either side. */
  private async accountSummary(userId: string): Promise<AccountMergeAccountSummaryDto> {
    const [user, credential, line] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } }),
      this.prisma.client.userCredential.findUnique({ where: { userId }, select: { status: true } }),
      this.prisma.client.externalIdentity.findFirst({
        where: { userId, provider: 'LINE', status: 'ACTIVE' },
        select: { userId: true },
      }),
    ]);
    return {
      displayName: user?.displayName ?? '',
      ...(user?.username ? { username: user.username } : {}),
      signInWith: [
        ...(line ? ['line' as const] : []),
        ...(credential && credential.status === 'ACTIVE' ? ['password' as const] : []),
      ],
    };
  }

  private async merge(input: { userId: string; ticket: string; requestId: string }): Promise<AccountMergeResult> {
    const { userId, ticket, requestId } = input;
    const row = await this.prisma.client.accountMergeTicket.findUnique({
      where: { tokenHash: hashToken(ticket) },
    });
    if (!row) throw new NotFoundException({ code: 'merge_ticket_invalid', message: 'Merge ticket is unknown.' });
    // Ownership before every other verdict: a caller holding someone else's ticket learns only
    // that it is not theirs, never whether it is live, spent or expired.
    if (row.newUserId !== userId) {
      throw new ForbiddenException({ code: 'merge_ticket_not_yours', message: 'Merge ticket belongs to another session.' });
    }
    // Defensive: the conflict that mints a ticket is by definition between two different users.
    if (row.newUserId === row.existingUserId) {
      throw new ConflictException({ code: 'merge_not_needed', message: 'Both accounts are the same user.' });
    }
    // Checked before the replay branch too: a session is issued for this user below, and a target
    // that has since been suspended or disabled must never receive one.
    const existingUser = await this.prisma.client.user.findUnique({
      where: { id: row.existingUserId },
      select: { status: true },
    });
    if (!existingUser || existingUser.status !== 'ACTIVE') {
      throw new ConflictException({ code: 'merge_target_unavailable', message: 'The existing account cannot receive a merge.' });
    }
    // Consumed is read before expiry on purpose: the merge already committed (the CAS below runs
    // inside the transaction, so a rolled-back merge leaves consumedAt null), and the confirm button
    // that was double-clicked must see success, not a ticket-expired error a minute later.
    if (row.consumedAt) return this.issueMergedSession(row.existingUserId);
    if (row.expiresAt <= new Date()) {
      throw new ConflictException({ code: 'merge_ticket_expired', message: 'Merge ticket has expired.' });
    }

    const now = new Date();
    const moved = await this.prisma.client.$transaction(async (tx) => {
      // Billing locks membership before account; keep this order when moving memberships.
      await tx.$queryRaw`SELECT id FROM "CompanyMembership" WHERE "userId" IN (${userId}, ${row.existingUserId}) ORDER BY id FOR UPDATE`;
      for (const id of [userId, row.existingUserId].sort()) await lockAccountEmail(tx, id);
      await tx.emailVerificationToken.updateMany({ where: { userId: { in: [userId, row.existingUserId] }, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.user.updateMany({ where: { id: { in: [userId, row.existingUserId] } }, data: { emailRevision: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: { in: [userId, row.existingUserId] } },
        data: { emailReauthenticatedAt: null, emailReauthBindingHash: null, emailReauthNonceHash: null } });
      const memberships = await tx.companyMembership.findMany({
        where: { userId, status: 'ACTIVE' },
        select: MEMBERSHIP_SELECT,
      });
      const counterparts = await tx.companyMembership.findMany({
        where: { userId: row.existingUserId, companyId: { in: memberships.map((m) => m.companyId) } },
        select: MEMBERSHIP_SELECT,
      });
      // Review R05: decided BEFORE the first write, and re-decided here inside the transaction
      // rather than trusted from the preview — a role or a status may have changed while the
      // person read the dialog.
      const plan = planAccountMerge(memberships.map(toView), counterparts.map(toView));
      const blocked = plan.filter((entry) => entry.outcome === 'blocked');
      if (blocked.length > 0) {
        throw new ConflictException({
          code: 'account_merge_role_conflict',
          message: 'These accounts hold different access to the same shop; a merge would decide that on its own.',
          // Names the shops, so the dialog can say which one to sort out first. No ids, no roles.
          companies: blocked.map(({ companyName, reason }) => ({ companyName, reason })),
        });
      }

      // Decide, THEN claim, then move. The refusal above spends no ticket, so the person can sort
      // the shop out and press the same button again; the CAS still picks the single winner between
      // two concurrent confirms, and the loser answers "already merging" rather than moving twice.
      const claimed = await tx.accountMergeTicket.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: 'merge_in_progress', message: 'This merge is already running.' });
      }

      const movedCompanyIds: string[] = [];
      const skippedCompanyIds: string[] = [];
      const movedMembershipIds: string[] = [];
      const byCompany = new Map(plan.map((entry) => [entry.companyId, entry]));
      for (const membership of memberships) {
        if (byCompany.get(membership.companyId)?.outcome === 'close_duplicate') {
          // @@unique([companyId, userId]) forbids a second row for the same pair, and the existing
          // account's own membership is the one that keeps its roles and history. The duplicate is
          // deactivated rather than moved or deleted, so the audit still shows it existed. Reached
          // only when that row is ACTIVE and carries the SAME roles, so the shop loses nothing.
          skippedCompanyIds.push(membership.companyId);
          await tx.companyMembership.update({ where: { id: membership.id }, data: { status: 'DISABLED' } });
          continue;
        }
        // MembershipRole and MembershipBranchScope key off membershipId (schema.prisma), so roles
        // and branch scopes ride along with this update and need no rewrite of their own.
        movedCompanyIds.push(membership.companyId);
        movedMembershipIds.push(membership.id);
        await tx.companyMembership.update({ where: { id: membership.id }, data: { userId: row.existingUserId } });
      }
      // EmployeeAccessProfile carries its own userId beside membershipId, so it is the one child
      // that does not ride along; leaving it behind would point an ACTIVE membership's profile at a
      // DISABLED user.
      if (movedMembershipIds.length > 0) {
        await tx.employeeAccessProfile.updateMany({
          where: { membershipId: { in: movedMembershipIds } },
          data: { userId: row.existingUserId },
        });
      }

      // Spec §4F "ย้าย email". Both addresses are re-read inside the transaction so a concurrent
      // email change cannot make this decision on a stale value. User.email is unique, so the
      // address must leave the emptied account before it lands on the target; an address already on
      // the target is kept (same rule as provision-signup.use-case.ts) — a login that works today
      // must not change under the user.
      const target = await tx.user.findUnique({ where: { id: row.existingUserId }, select: { email: true } });
      const source = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
      const emailMoved = Boolean(source?.email) && !target?.email;
      if (emailMoved) {
        // Read out before the first write: the address is what moves, so it cannot be re-read
        // from a row the very next statement clears.
        const { email, emailVerifiedAt } = source!;
        await tx.user.update({ where: { id: userId }, data: { email: null, emailVerifiedAt: null } });
        await tx.user.update({ where: { id: row.existingUserId }, data: { email, emailVerifiedAt } });
      }

      await tx.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
      // The emptied account's sessions are now orphaned. The guard already refuses a DISABLED user
      // (resolve-request-context.use-case.ts), but refresh only checks the session row — revoking
      // here ends both without touching the pinned guard or refresh use case.
      await revokeActiveSessions(tx.authSession, { userId, now });

      return { movedCompanyIds, skippedCompanyIds, emailMoved, emailKeptExisting: Boolean(target?.email) };
    });

    // L-10: awaited post-commit; AuditService.log never throws, so a committed merge cannot 500.
    await this.audit?.log({
      action: AuditAction.AUTH_ACCOUNT_MERGE,
      // Actor is the authenticated caller, same as the journey rows, even though that account is
      // DISABLED a moment later; the target is the account it merged into.
      actorUserId: userId,
      targetType: 'User',
      targetId: row.existingUserId,
      requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      // Ids and booleans only — no email address enters evidence.
      metadataJson: { newUserId: userId, existingUserId: row.existingUserId, ...moved },
    });

    return this.issueMergedSession(row.existingUserId);
  }

  /** The caller proved LINE control, not the existing account's password, so the session is a LINE
   *  one — same provider claim the LINE login callback issues through this same service. */
  private async issueMergedSession(existingUserId: string): Promise<AccountMergeResult> {
    return { merged: true, ...(await this.issueToken.execute(existingUserId, 'line')) };
  }
}
