import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PayoutAccountReveal, RequestContext } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { openPayoutAccountNumber } from '../../domain/logic/payout-destination.logic';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { claimPayoutRevealGroup, legacyPayoutPayer } from './reimbursement-request.use-case';

/**
 * "แสดงเลขบัญชี": the one place a claim's full account number leaves the system (owner decision D2).
 * It answers from the claim's own frozen snapshot, only to the requester, that claim's approver and
 * whoever may record its payment, and only after the audit row is written. Everyone else is refused
 * and that refusal is recorded too.
 *
 * One exception, spec §15: a legacy claim froze no account. Whoever may record its payment is shown
 * the requester's current default account instead, and this call answers that payer with that
 * account's number, recorded as such (`source: MEMBER_DEFAULT`). Nobody else, and no other claim.
 */
@Injectable()
export class RevealClaimPayoutUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async execute(ctx: RequestContext, requestId: string): Promise<PayoutAccountReveal> {
    const request = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!request) throw new NotFoundException('Reimbursement request not found');
    const group = await claimPayoutRevealGroup(ctx, request, this.repo);
    const secret = group
      ? await this.repo.findClaimPayoutSecret(ctx.companyId, requestId, request.payoutDestinationVersion!)
      : await legacyPayoutPayer(ctx, request, this.repo) ? await this.legacyDefaultSecret(request) : null;
    const entry = {
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout.reveal',
      targetType: 'reimbursement_request', targetId: requestId, requestId: ctx.requestId, riskLevel: 'HIGH' as const,
    };
    if (!secret) {
      void this.audit.log({ ...entry, result: 'DENIED' });
      throw new ForbiddenException('payout_reveal_denied');
    }
    // No row, no number: the write is fail-closed and comes before the decrypt.
    const { accountNumberEncrypted, ...facts } = secret;
    await this.audit.logOrThrow({
      ...entry, result: 'SUCCESS',
      metadataJson: group ? { group, ...facts } : { group: 'PAYER', source: 'MEMBER_DEFAULT', accountUserId: request.requesterUserId, ...facts },
    });
    return { accountNumber: openPayoutAccountNumber(accountNumberEncrypted, this.config.credentialEncryptionKey) };
  }

  /** The requester's default account as it is now: its ciphertext, and what the audit row says of it. */
  private async legacyDefaultSecret(request: { companyId: string; requesterUserId: string }) {
    const [account, accountNumberEncrypted] = await Promise.all([
      this.repo.findMemberPayoutAccount(request.companyId, request.requesterUserId),
      this.repo.findMemberPayoutSecret(request.companyId, request.requesterUserId),
    ]);
    if (account?.payoutMethod !== 'BANK_TRANSFER' || !accountNumberEncrypted) return null;
    return {
      accountNumberEncrypted, version: account.version, payoutKind: account.payoutKind ?? null,
      bankName: account.bankName ?? null, accountLast4: account.accountLast4 ?? null,
    };
  }
}
