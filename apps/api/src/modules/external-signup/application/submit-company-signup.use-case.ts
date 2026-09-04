import { Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { resolveMx } from 'node:dns/promises';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SignupAdminNotifyService } from './signup-admin-notify.service';
import type { CompanySignupInput } from '../domain/company-signup.logic';

/** Spec §3: MX is looked up with a timeout, and a slow resolver must not hold the form open. */
const MX_LOOKUP_TIMEOUT_MS = 3_000;

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
    const { request, replayed } = await this.core.receive(input, correlationRequestId);

    // A replay of an already-queued request returns the same id without re-running validation or
    // re-appending evidence — the core has already decided this is the same submission (§3).
    if (replayed && request.state !== 'RECEIVED') return { requestId: request.id };

    // MX only proves the domain accepts mail. Mailbox ownership is proven at the claim link, never
    // here — so this check exists to catch typos at the form, not to authorise anything (§3).
    // The address is guaranteed by `normalizeCompanySignupInput`; this path is Flow B only, and the
    // LINE source has its own submit use-case that never enters here (spec §5).
    const mxValid = await this.hasMailExchanger(request.contactEmail ?? '');
    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      data: { mxValid },
    });
    if (!mxValid) {
      // Left in RECEIVED deliberately: the applicant fixes the address and submits again with a new
      // externalSignupId. Nothing reaches the admin queue, and no email was ever sent.
      throw new UnprocessableEntityException('email_domain_has_no_mx');
    }

    await this.core.advance(request.id, 'VALIDATED', correlationRequestId);
    await this.core.advance(request.id, 'PENDING_REVIEW', correlationRequestId);
    // Spec §4C: the queue is now the only thing standing between this application and a company, so
    // the operators are told. One outbox row in the same database — the dashboard row and the LINE
    // push happen in the drain, where an outage can only delay them, never fail this submit.
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
