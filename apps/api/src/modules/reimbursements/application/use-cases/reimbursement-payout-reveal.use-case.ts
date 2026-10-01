import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PayoutAccountReveal, RequestContext } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { openPayoutAccountNumber } from '../../domain/logic/payout-destination.logic';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { claimPayoutRevealGroup } from './reimbursement-request.use-case';

/**
 * "แสดงเลขบัญชี": the one place a claim's full account number leaves the system (owner decision D2).
 * It answers from the claim's own frozen snapshot — never from the member's current default — only to
 * the requester, that claim's approver and whoever may record its payment, and only after the audit
 * row is written. Everyone else is refused and that refusal is recorded too.
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
    const secret = group ? await this.repo.findClaimPayoutSecret(ctx.companyId, requestId, request.payoutDestinationVersion!) : null;
    const entry = {
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout.reveal',
      targetType: 'reimbursement_request', targetId: requestId, requestId: ctx.requestId, riskLevel: 'HIGH' as const,
    };
    if (!group || !secret) {
      void this.audit.log({ ...entry, result: 'DENIED' });
      throw new ForbiddenException('payout_reveal_denied');
    }
    // No row, no number: the write is fail-closed and comes before the decrypt.
    await this.audit.logOrThrow({
      ...entry, result: 'SUCCESS',
      metadataJson: { group, version: secret.version, payoutKind: secret.payoutKind, bankName: secret.bankName, accountLast4: secret.accountLast4 },
    });
    return { accountNumber: openPayoutAccountNumber(secret.accountNumberEncrypted, this.config.credentialEncryptionKey) };
  }
}
