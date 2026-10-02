import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { maskedPayoutAccount } from '@watchdog-bms/contracts';
import type {
  MemberPayoutAccountResponse,
  MemberPayoutAccountSummary,
  PayoutAccountReveal,
  PayoutDestinationInput,
  ReimbursementPayoutInput,
  RequestContext,
  SetMemberPayoutAccountInput,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import {
  isBlankPayoutDestination,
  mayTypePayoutAccountFor,
  openPayoutAccountNumber,
  payoutAccountEditRefusal,
  sealPayoutDestination,
  type SealedPayoutDestination,
} from '../../domain/logic/payout-destination.logic';
import { PrismaReimbursementRepository, type DraftPayoutChange } from '../../infrastructure/prisma-reimbursement.repository';
import type { MemberPayoutAccountRecord } from '../../infrastructure/reimbursement-payout';

/** The notification an account owner gets when someone else sets their account. */
export const PAYOUT_ACCOUNT_SET_TRIGGER_KEY = 'reimbursement.payout_account_set_by_other';

const UNNAMED_MEMBER = 'สมาชิกบริษัท';

/** What a draft's audit row says about its receiving choice: the mode, and who typed an account. Never the account. */
export type DraftPayoutAudit = { mode: 'DEFAULT' | 'CASH' | 'SPECIFIED'; source?: 'REQUESTER' | 'PREPARER'; savedAsDefault?: true };

/** What an audit row may say about an account: kind, bank and the last 4 digits. Never the number. */
function auditFacts(account: MemberPayoutAccountRecord | null) {
  return account
    ? { payoutMethod: account.payoutMethod, payoutKind: account.payoutKind ?? null, bankName: account.bankName ?? null, accountLast4: account.accountLast4 ?? null, version: account.version }
    : null;
}

/**
 * A member's default payout account (payout spec §8): their own, or — for whoever may edit employee
 * data — an employee's. Every answer carries the last 4 digits only; the full number leaves through
 * `revealOwn`, for the account owner alone.
 */
@Injectable()
export class MemberPayoutAccountUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async getOwn(ctx: RequestContext): Promise<MemberPayoutAccountResponse> {
    this.assertOwn(ctx);
    return { ...await this.respond(ctx.companyId, await this.repo.findMemberPayoutAccount(ctx.companyId, ctx.userId)), canEdit: true };
  }

  async setOwn(ctx: RequestContext, input: SetMemberPayoutAccountInput): Promise<MemberPayoutAccountResponse> {
    this.assertOwn(ctx);
    const destination = this.sealFor(input);
    return this.respond(ctx.companyId, await this.write(ctx, ctx.userId, input.payoutMethod, destination));
  }

  /** Removing the default never touches a claim that was already sent: each keeps its own copy. */
  async deleteOwn(ctx: RequestContext): Promise<MemberPayoutAccountResponse> {
    this.assertOwn(ctx);
    await this.repo.removeMemberPayoutAccount(ctx.companyId, ctx.userId, (tx, before) => this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_account.delete',
      targetType: 'member_payout_account', targetId: ctx.userId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { accountUserId: ctx.userId, before: auditFacts(before) },
    }, tx));
    return { account: null };
  }

  /** The owner's own full number. The audit row is written first: no row, no number. */
  async revealOwn(ctx: RequestContext): Promise<PayoutAccountReveal> {
    this.assertOwn(ctx);
    const [account, secret] = await Promise.all([
      this.repo.findMemberPayoutAccount(ctx.companyId, ctx.userId),
      this.repo.findMemberPayoutSecret(ctx.companyId, ctx.userId),
    ]);
    if (!account || !secret) throw new NotFoundException('payout_account_not_set');
    await this.audit.logOrThrow({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_account.reveal',
      targetType: 'member_payout_account', targetId: ctx.userId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { accountUserId: ctx.userId, ...auditFacts(account) },
    });
    return { accountNumber: openPayoutAccountNumber(secret, this.config.credentialEncryptionKey) };
  }

  /** An employee's account as an employee-data reader sees it: set or not, bank, name, last 4. */
  async getForMember(ctx: RequestContext, userId: string): Promise<MemberPayoutAccountResponse> {
    if (!ctx.permissions.some((permission) => permission === 'access.employee.read' || permission === 'access.employee.update')) {
      throw new ForbiddenException('Missing permission: access.employee.read');
    }
    const member = await this.repo.findPayoutMember(ctx.companyId, userId);
    if (!member?.hasEmployeeProfile) throw new NotFoundException('payout_member_not_found');
    return {
      ...await this.respond(ctx.companyId, await this.repo.findMemberPayoutAccount(ctx.companyId, userId)),
      // The edit button is offered exactly when the write below would go through.
      canEdit: userId === ctx.userId ? ctx.permissions.includes('reimbursement.create') : await this.editRefusal(ctx, member) === null,
    };
  }

  /**
   * Owner decision 2026-10-01: an employee's account may be set by someone who edits employee data —
   * an owner or admin for anyone, a manager or HR only for their own people (see
   * `payoutAccountEditRefusal`). They type the full number once and from then on see the last 4 digits
   * like everyone else, and the account owner is told every time.
   */
  async setForMember(ctx: RequestContext, userId: string, input: SetMemberPayoutAccountInput): Promise<MemberPayoutAccountResponse> {
    // Their own account is theirs to set by their own right, whichever screen they came from.
    if (userId === ctx.userId) return this.setOwn(ctx, input);
    await this.assertMayEditMember(ctx, userId);
    const destination = this.sealFor(input);
    return { ...await this.respond(ctx.companyId, await this.write(ctx, userId, input.payoutMethod, destination)), canEdit: true };
  }

  /**
   * A draft's receiving choice, ready for the repository to commit with the draft. `saveAsDefault`
   * makes the typed account the REQUESTER's default (never the preparer's) and leaves the claim
   * following that default, in the same transaction as the draft.
   */
  async draftPayoutChange(ctx: RequestContext, requesterUserId: string, input: ReimbursementPayoutInput): Promise<DraftPayoutChange & { audit: DraftPayoutAudit }> {
    if (input.mode !== 'SPECIFIED') return { write: { mode: input.mode === 'CASH' ? 'CASH' : 'DEFAULT' }, audit: { mode: input.mode === 'CASH' ? 'CASH' : 'DEFAULT' } };
    const destination = this.seal(input);
    const byRequester = requesterUserId === ctx.userId;
    const source = byRequester ? 'REQUESTER' as const : 'PREPARER' as const;
    if (input.saveAsDefault) {
      if (byRequester) this.assertOwn(ctx);
      else await this.assertMayEditMember(ctx, requesterUserId);
      return {
        write: { mode: 'DEFAULT' }, audit: { mode: 'SPECIFIED', source, savedAsDefault: true },
        onPersisted: async (tx) => { await this.write(ctx, requesterUserId, 'BANK_TRANSFER', destination, tx); },
      };
    }
    const write = { mode: 'SPECIFIED' as const, destination, source, actorUserId: ctx.userId };
    if (byRequester) return { write, audit: { mode: 'SPECIFIED', source } };
    // Someone else types where the requester's money goes, on a claim filed for them. Same condition
    // as for a default account: the requester is told, in the transaction that saves the draft, so
    // the account cannot be on the claim without its notice — and only a member a notice can reach
    // (an active one) may have an account typed for them at all.
    if (!mayTypePayoutAccountFor(await this.repo.findPayoutMember(ctx.companyId, requesterUserId))) {
      throw new ConflictException('payout_account_member_not_active');
    }
    const editorName = (await this.repo.getUserDisplayNames(ctx.companyId, [ctx.userId]))[ctx.userId] ?? UNNAMED_MEMBER;
    return {
      write, audit: { mode: 'SPECIFIED', source },
      onPersisted: async (tx, requestId) => {
        const at = new Date();
        const when = at.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
        // To the requester alone, never to the shop owner or anyone else. One notice per change: the
        // period is this save and nothing else (two saves in one millisecond are still two notices).
        // The last 4 digits only, and a link to the claim itself.
        await this.notifications.executeInTransaction({
          companyId: ctx.companyId, triggerKey: PAYOUT_ACCOUNT_SET_TRIGGER_KEY, sourceModule: 'reimbursements',
          sourceType: 'reimbursement_request', sourceId: requestId, periodKey: `${at.toISOString()}:${randomUUID()}`, severity: 'critical',
          title: `${editorName} ระบุบัญชีรับเงินในใบเบิกของคุณ`,
          body: `${maskedPayoutAccount(destination)} ระบุเมื่อ ${when} ถ้าไม่ใช่บัญชีของคุณ เปิดใบเบิกแล้วแก้ได้ทันที`,
          deepLinkHref: `/companies/${ctx.companyId}/reimbursements/${requestId}`,
          recipientUserIds: [requesterUserId],
        }, tx as never);
      },
    };
  }

  private assertOwn(ctx: RequestContext): void {
    if (!ctx.permissions.includes('reimbursement.create')) throw new ForbiddenException('Missing permission: reimbursement.create');
  }

  /** Why this editor may not set this member's account, or null: the right itself, then the rule about whose. */
  private async editRefusal(
    ctx: RequestContext,
    member: { membershipStatus: string; managesPeople: boolean; allBranches: boolean; branchIds: string[] },
  ): Promise<string | null> {
    // A company without reimbursements has no payout accounts to manage.
    if (!ctx.permissions.includes('access.employee.update') || ctx.entitlementDeniedPermissions?.['reimbursement.create']) return 'no_employee_edit_right';
    // The session carries role KEYS, and a company role named "Admin" has the key ADMIN too. The key
    // only says the question is worth asking; the answer is whether the role is the system's own.
    const editorIsOwnerOrAdmin = ctx.roles.some((role) => role === 'OWNER' || role === 'ADMIN')
      && await this.repo.holdsSystemOwnerOrAdminRole(ctx.companyId, ctx.userId);
    return payoutAccountEditRefusal({ editorIsOwnerOrAdmin, editorBranchIds: (ctx.scopes ?? {}).branchIds, target: member });
  }

  private async assertMayEditMember(ctx: RequestContext, userId: string): Promise<void> {
    if (!ctx.permissions.includes('access.employee.update') || ctx.entitlementDeniedPermissions?.['reimbursement.create']) {
      throw new ForbiddenException('payout_account_edit_denied');
    }
    const member = await this.repo.findPayoutMember(ctx.companyId, userId);
    // Another company's user is simply not here; a business owner has no employee record to edit.
    if (!member?.hasEmployeeProfile) throw new NotFoundException('payout_member_not_found');
    const reason = await this.editRefusal(ctx, member);
    if (reason) {
      // An attempt to set where someone else's money goes is recorded, refused or not.
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_account.set',
        targetType: 'member_payout_account', targetId: userId, requestId: ctx.requestId,
        result: 'DENIED', riskLevel: 'HIGH', metadataJson: { accountUserId: userId, reason },
      });
      // A member who is not active is nobody's to set, the owner's included: the notice below would
      // reach no one. Said as its own refusal, so the screen can tell the editor what to do instead.
      if (reason === 'target_not_active') throw new ConflictException('payout_account_member_not_active');
      throw new ForbiddenException('payout_account_edit_denied');
    }
  }

  private sealFor(input: SetMemberPayoutAccountInput): SealedPayoutDestination | undefined {
    if (input?.payoutMethod === 'CASH') return undefined;
    if (input?.payoutMethod !== 'BANK_TRANSFER') throw new BadRequestException('payout_method_required');
    return this.seal(input);
  }

  private seal(input: Partial<PayoutDestinationInput>): SealedPayoutDestination {
    if (isBlankPayoutDestination(input)) throw new BadRequestException('payout_destination_required');
    const destination = sealPayoutDestination(input, this.config.credentialEncryptionKey);
    if (!destination) throw new BadRequestException('payout_destination_invalid');
    return destination;
  }

  /** One write path: the row, its audit entry and (when someone else did it) the owner's notification commit together. */
  private async write(
    ctx: RequestContext,
    userId: string,
    payoutMethod: 'BANK_TRANSFER' | 'CASH',
    destination: SealedPayoutDestination | undefined,
    tx?: unknown,
  ): Promise<MemberPayoutAccountRecord> {
    const byOwner = userId === ctx.userId;
    const editorName = byOwner ? '' : (await this.repo.getUserDisplayNames(ctx.companyId, [ctx.userId]))[ctx.userId] ?? UNNAMED_MEMBER;
    return this.repo.setMemberPayoutAccount(
      { companyId: ctx.companyId, userId, actorUserId: ctx.userId, payoutMethod, destination },
      async (client, change) => {
        await this.audit.log({
          companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_account.set',
          targetType: 'member_payout_account', targetId: userId, requestId: ctx.requestId,
          result: 'SUCCESS', riskLevel: byOwner ? 'MEDIUM' : 'HIGH',
          metadataJson: { accountUserId: userId, byOwner, before: auditFacts(change.before), after: auditFacts(change.after) },
        }, client);
        // The owner's condition for letting anyone else set an account: the account owner is told, in
        // the same transaction as the change, so the change cannot exist without its notice. Their own
        // edit tells nobody. Web and LINE both carry this text, so it has who, when and the last 4
        // digits — never the number.
        //  - critical: where a person's money goes is not held back by quiet hours, and a push that
        //    fails is recorded (notification_delivery.critical_failed) instead of vanishing;
        //  - the period is the moment of this change, so every change is its own notice. The version
        //    would repeat after the member deletes the account and someone sets it again.
        if (byOwner) return;
        const when = change.after.updatedAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
        await this.notifications.executeInTransaction({
          companyId: ctx.companyId, triggerKey: PAYOUT_ACCOUNT_SET_TRIGGER_KEY, sourceModule: 'reimbursements',
          sourceType: 'member_payout_account', sourceId: userId, periodKey: `v${change.after.version}:${change.after.updatedAt.toISOString()}`, severity: 'critical',
          title: `${editorName} ตั้งบัญชีรับเงินคืนของคุณ`,
          body: change.after.payoutMethod === 'CASH'
            ? `ตั้งให้คุณรับเงินคืนเป็นเงินสด เมื่อ ${when} ถ้าไม่ถูกต้อง เปิดดูแล้วแก้ได้ทันที`
            : `${maskedPayoutAccount(change.after)} ตั้งเมื่อ ${when} ถ้าไม่ใช่บัญชีของคุณ เปิดดูแล้วแก้ได้ทันที`,
          deepLinkHref: `/companies/${ctx.companyId}/reimbursements/payout-account`,
          recipientUserIds: [userId],
        }, client);
      },
      tx,
    );
  }

  private async respond(companyId: string, account: MemberPayoutAccountRecord | null): Promise<MemberPayoutAccountResponse> {
    if (!account) return { account: null };
    const setByOther = account.updatedByUserId !== account.userId;
    const names = setByOther ? await this.repo.getUserDisplayNames(companyId, [account.updatedByUserId]) : {};
    return { account: toMemberPayoutAccountSummary(account, setByOther ? names[account.updatedByUserId] ?? UNNAMED_MEMBER : undefined) };
  }
}

export function toMemberPayoutAccountSummary(account: MemberPayoutAccountRecord, setByOtherName?: string): MemberPayoutAccountSummary {
  return {
    userId: account.userId,
    payoutMethod: account.payoutMethod,
    ...(account.payoutKind && { payoutKind: account.payoutKind }),
    ...(account.bankName && { bankName: account.bankName }),
    ...(account.accountName && { accountName: account.accountName }),
    ...(account.accountLast4 && { accountLast4: account.accountLast4 }),
    updatedAt: account.updatedAt.toISOString(),
    ...(setByOtherName && { setByOtherName }),
  };
}
