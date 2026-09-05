import { Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { resolveMx } from 'node:dns/promises';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SignupAdminNotifyService } from './signup-admin-notify.service';
import type { CompanySignupInput } from '../domain/company-signup.logic';

/** Spec §3: MX is looked up with a timeout, and a slow resolver must not hold the form open. */
const MX_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * The states this use-case still owns work for. Anything past them was decided by an admin or by
 * the applicant, and a resubmitted form must not reopen it (review R08).
 */
const INTAKE_STATES: readonly string[] = ['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'];

export type MxResolver = (domain: string) => Promise<unknown[]>;

@Injectable()
export class SubmitCompanySignupUseCase {
  private readonly mxResolver: MxResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly adminNotify: SignupAdminNotifyService,
    /**
     * Test seam. `@Optional()` is required, not decorative: a plain default parameter still leaves
     * a third entry in the constructor metadata and Nest fails to resolve it at boot.
     */
    @Optional() mxResolver?: MxResolver,
  ) {
    this.mxResolver = mxResolver ?? resolveMx;
  }

  async execute(input: CompanySignupInput, correlationRequestId: string): Promise<{ requestId: string }> {
    const { request } = await this.core.receive(input, correlationRequestId);

    // Review R08: a replay RESUMES from where the first attempt stopped. Short-circuiting on every
    // non-RECEIVED state answered "received" to an applicant whose request was stranded at
    // VALIDATED (never queued, no admin will ever see it) and never repaired an announcement whose
    // outbox append failed after the state had already moved. Only a row that has left the intake
    // states is genuinely finished with this path.
    if (!INTAKE_STATES.includes(request.state)) return { requestId: request.id };

    if (request.state === 'RECEIVED') {
      // MX only proves the domain accepts mail. Mailbox ownership is proven at the claim link,
      // never here — so this check exists to catch typos at the form, not to authorise anything
      // (§3). The address is guaranteed by `normalizeCompanySignupInput`; this path is Flow B only,
      // and the LINE source has its own submit use-case that never enters here (spec §5).
      const mxValid = await this.hasMailExchanger(request.contactEmail ?? '');
      await this.prisma.client.companySignupRequest.update({
        where: { id: request.id },
        data: { mxValid },
      });
      if (!mxValid) {
        // Left in RECEIVED deliberately: the applicant fixes the address and submits again with a
        // new externalSignupId. Nothing reaches the admin queue, and no email was ever sent.
        throw new UnprocessableEntityException('email_domain_has_no_mx');
      }
      await this.core.advance(request.id, 'VALIDATED', correlationRequestId);
    }

    // A replay already in PENDING_REVIEW takes the core's replay branch and writes nothing.
    await this.core.advance(request.id, 'PENDING_REVIEW', correlationRequestId);
    // Spec §4C: the queue is now the only thing standing between this application and a company, so
    // the operators are told. One outbox row in the same database — the dashboard row and the LINE
    // push happen in the drain, where an outage can only delay them, never fail this submit.
    // Keyed on the request id alone, so this repairs a lost announcement and can never make two.
    await this.adminNotify.enqueue(request.id);
    return { requestId: request.id };
  }

  private async hasMailExchanger(email: string): Promise<boolean> {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!domain) return false;
    try {
      const records = await withTimeout(this.mxResolver(domain), MX_LOOKUP_TIMEOUT_MS);
      return Array.isArray(records) && records.length > 0;
    } catch {
      // NXDOMAIN, no records, and a timed-out resolver all land here. Treating them alike keeps the
      // applicant's message honest ("we cannot reach this domain") without exposing DNS internals.
      return false;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('mx_lookup_timeout')), ms);
    }),
    // Cleared on settle, so a fast lookup leaves no timer behind. Deliberately not unref'd: the
    // timeout is what guarantees the request ends, and an unref'd one can be skipped entirely.
  ]).finally(() => clearTimeout(timer));
}
