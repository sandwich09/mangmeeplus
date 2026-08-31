import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';
import { hashToken } from '../../domain/logic/secure-token.logic';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';

/** Long enough to read the dialog on a phone, short enough that a stale cookie is not an authority. */
export const ACCOUNT_MERGE_TICKET_TTL_MS = 15 * 60_000;

export type AccountMergeResult = { merged: true } & AuthTokensResult;

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
      // Claim first, move second. Two concurrent confirms match this one row between them, so the
      // loser gets count 0 and answers "already merging" instead of running the move a second time.
      const claimed = await tx.accountMergeTicket.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: 'merge_in_progress', message: 'This merge is already running.' });
      }

      const memberships = await tx.companyMembership.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      });
      const alreadyMember = new Set(
        (await tx.companyMembership.findMany({
          where: { userId: row.existingUserId, companyId: { in: memberships.map((m) => m.companyId) } },
          select: { companyId: true },
        })).map((m) => m.companyId),
      );

      const movedCompanyIds: string[] = [];
      const skippedCompanyIds: string[] = [];
      const movedMembershipIds: string[] = [];
      for (const membership of memberships) {
        if (alreadyMember.has(membership.companyId)) {
          // @@unique([companyId, userId]) forbids a second row for the same pair, and the existing
          // account's own membership is the one that keeps its roles and history. The duplicate is
          // deactivated rather than moved or deleted, so the audit still shows it existed.
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
