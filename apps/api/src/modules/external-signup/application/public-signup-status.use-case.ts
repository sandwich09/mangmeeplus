import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PublicSignupStatusDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SignupClaimEmailService } from './signup-claim-email.service';
import { canResendClaim, publicSignupStatusKey } from '../domain/account-claim.logic';
import type { CompanySignupState } from '../domain/company-signup.logic';

@Injectable()
export class PublicSignupStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly claimEmail: SignupClaimEmailService,
  ) {}

  /**
   * Spec §3: coarse state from an allowlist, nothing else. No reason, no admin note, no address —
   * the request id is an unguessable cuid, but it is still an unauthenticated read.
   */
  async status(requestId: string, now = new Date()): Promise<PublicSignupStatusDto> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: requestId },
      select: { id: true, state: true, approvedAt: true, claimWindowStartedAt: true },
    });
    if (!request) throw new NotFoundException('company_signup_request_not_found');
    const state = request.state as CompanySignupState;
    return {
      requestId: request.id,
      status: publicSignupStatusKey(state),
      // R09: the reissue-restarted window, falling back to the approval for rows written before it.
      canResendClaim: canResendClaim(state, request.claimWindowStartedAt ?? request.approvedAt, now),
    };
  }

  /**
   * Applicant-triggered resend (spec §4D ②). Allowed while the approval is live, including after
   * the link expired — the approval survives, so nobody has to apply twice. Past the self-serve
   * window it is an admin reissue instead, which has no age limit at all.
   */
  async resendClaim(requestId: string, correlationRequestId: string, now = new Date()): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: requestId },
      select: { id: true, state: true, approvedAt: true, claimWindowStartedAt: true },
    });
    if (!request) throw new NotFoundException('company_signup_request_not_found');

    const state = request.state as CompanySignupState;
    if (!canResendClaim(state, request.claimWindowStartedAt ?? request.approvedAt, now)) {
      throw new ConflictException('claim_resend_not_available');
    }
    // From EMAIL_FAILED or EXPIRED this is the documented way back to a live link; from
    // EMAIL_PENDING the core treats it as a replay and changes nothing.
    if (state !== 'EMAIL_PENDING') await this.core.advance(requestId, 'EMAIL_PENDING', correlationRequestId);
    // A fresh link earns a fresh reminder.
    await this.prisma.client.companySignupRequest.update({
      where: { id: requestId },
      data: { claimReminderSentAt: null },
    });
    await this.claimEmail.enqueue(requestId, 'resend', now);
  }
}
