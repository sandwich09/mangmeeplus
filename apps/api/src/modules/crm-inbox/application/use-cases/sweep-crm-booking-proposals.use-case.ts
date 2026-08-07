import { Injectable, Logger } from '@nestjs/common';
import { PrismaCrmBookingProposalRepository } from '../../../crm/infrastructure/prisma-crm-booking-proposal.repository';

// A CONFIRMED or COMMITTING proposal older than this crashed mid-finalize — between
// the AWAITING→CONFIRMED and CONFIRMED→COMMITTING CAS hops, or before the finalization
// transaction committed — so no booking exists, and it is recovered to HANDED_TO_STAFF.
// Comfortably above the booking $transaction's lifetime.
const STUCK_COMMITTING_MS = 10 * 60_000;

/**
 * CUST-02 expiry + crash-recovery sweep. Worker-triggered, cross-company: expires
 * past-due pre-confirmation proposals (wires the previously dead expireStale) and
 * recovers proposals stranded at CONFIRMED or COMMITTING after a crash. Iterates only
 * companies with sweepable rows, mirroring the other worker sweeps; a per-company
 * failure is logged and never aborts the rest.
 */
@Injectable()
export class SweepCrmBookingProposalsUseCase {
  private readonly logger = new Logger(SweepCrmBookingProposalsUseCase.name);

  constructor(private readonly proposals: PrismaCrmBookingProposalRepository) {}

  async execute(): Promise<{ companiesScanned: number; expired: number; recovered: number }> {
    const now = new Date();
    const committingBefore = new Date(now.getTime() - STUCK_COMMITTING_MS);
    const companyIds = await this.proposals.findCompanyIdsWithSweepableProposals(now, committingBefore);
    let expired = 0;
    let recovered = 0;
    for (const companyId of companyIds) {
      try {
        expired += await this.proposals.expireStale(companyId, now);
        recovered += await this.proposals.sweepStuckCommitting(companyId, committingBefore);
      } catch (error) {
        this.logger.warn({ msg: 'CRM booking proposal sweep failed', companyId, error: (error as Error).message });
      }
    }
    return { companiesScanned: companyIds.length, expired, recovered };
  }
}
