import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { COMPANY_BUSINESS_CATEGORIES } from '@watchdog-bms/contracts';
import type { CompanySignupRequest } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService, signupStateGuard } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { SignupClaimEmailService } from './signup-claim-email.service';
import { ProvisionSignupUseCase, mapBusinessCategory, reviewedBusinessCategory } from './provision-signup.use-case';
import { LineSignupNotifyService } from './line-signup-notify.service';
import { daysSinceApproval } from '../domain/account-claim.logic';
import {
  OWNED_COMPANY_MEMBERSHIP,
  SIGNUP_SOURCE_LINE_OA,
  STALE_PROVISIONING_MS,
  isStaleProvisioning,
  type CompanySignupState,
} from '../domain/company-signup.logic';

/**
 * Everything an admin still has a decision or an action to take on (spec §4C, §4D).
 *
 * Review F2: `PROVISIONING_FAILED` is here for EVERY source now. A Flow B applicant who claimed
 * their link and then hit a failed provisioning was invisible — the row was listed for LINE only,
 * the token was spent, and resend and reissue both refuse from that state. The shop was never
 * built and nobody could see that it had not been.
 */
const QUEUE_STATES: readonly CompanySignupState[] = [
  'PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED', 'PROVISIONING_FAILED',
];

/**
 * Review MEDIUM-D: shown for the LINE source ONLY. There the fence releases precisely so an admin
 * can retry, and an unseen row also leaves the customer's LINE account fenced by the
 * open-application index with no way out. A web-form row in either state still has no action an
 * admin could take — its close-out is the applicant's own welcome page.
 */
const LINE_ONLY_QUEUE_STATES: readonly CompanySignupState[] = ['READY', 'PROVISIONING'];

/** Spec §4D ④: an approved request never dead-ends, so reissue has no age limit. */
const REISSUABLE_STATES: readonly CompanySignupState[] = ['EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED'];

/**
 * A LINE approval provisions inline, so a repeated tap lands on one of these, not on a conflict.
 * READY is deliberately NOT here: it looks settled and is not — the shop exists but the
 * application has not closed, and treating it as done left the customer's LINE account fenced by
 * the open-application index with no way for an admin to finish it.
 */
const SETTLED_STATES: readonly CompanySignupState[] = ['PROVISIONING', 'COMPLETED'];

/** States a LINE application can be approved out of: the first decision, and the two recoveries. */
const LINE_APPROVABLE_STATES: readonly CompanySignupState[] = ['PENDING_REVIEW', 'PROVISIONING_FAILED', 'READY'];

/**
 * R13: an application that has been decided against. Nothing here is actionable from the queue, but
 * "where did that application go" is a question an operator has every week and the answer used to
 * be nowhere — REJECTED and SUSPENDED rows appeared in no list at all. EXPIRED is in BOTH this and
 * the actionable queue on purpose: it is reissuable (spec §4D ④) and it is also what an operator
 * looking for a dropped application is most often looking for.
 */
const ARCHIVED_STATES: readonly CompanySignupState[] = ['REJECTED', 'SUSPENDED', 'EXPIRED'];

/** The bounced/expired/failed rows the "มีปัญหา" tab exists for, minus the time-based one. */
const PROBLEM_STATES: readonly CompanySignupState[] = ['EMAIL_FAILED', 'EXPIRED'];
const LINE_PROBLEM_STATES: readonly CompanySignupState[] = ['PROVISIONING_FAILED', 'READY'];

/**
 * R13. One page of the queue. Defaults chosen for the operator, not the database: 50 rows is more
 * than a phone screen and less than a scroll nobody finishes, and the ceiling exists because the
 * limit arrives from a query string.
 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type SignupQueueListOptions = {
  /** A `SignupQueueTab` the server understands. Absent = the whole actionable queue. */
  tab?: string;
  /** Id of the last row of the previous page. */
  cursor?: string;
  limit?: number;
};

@Injectable()
export class SignupAdminQueueUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly tokens: AccountClaimTokenService,
    private readonly claimEmail: SignupClaimEmailService,
    private readonly provision: ProvisionSignupUseCase,
    private readonly lineNotify: LineSignupNotifyService,
  ) {}

  /**
   * R13: the tab is decided HERE, and the page is a page. The first version read 200 rows with no
   * cursor and let the browser filter and count them, so a backlog past 200 was invisible, a tab
   * could report "no applications in this group" over rows the database was holding, and every
   * count was a count of the truncation rather than of the queue.
   */
  async list(now = new Date(), options: SignupQueueListOptions = {}): Promise<AdminSignupQueueDto> {
    const pageSize = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const tabWhere = queueWhere(options.tab, now);
    // F10: the cursor is the ordering VALUES of the last row, not that row's id. Prisma's `cursor`
    // resolves an id against the same filtered query, so a row that left the tab between pages —
    // an admin approved it, a sweep parked it — answered with an empty page and stranded the tab
    // until someone reloaded. Values cannot go stale; the row they came from need not exist.
    const after = decodeQueueCursor(options.cursor);
    // One more than the page, purely as a probe: its presence is what says another page exists.
    const rows = await this.prisma.client.companySignupRequest.findMany({
      where: after ? { AND: [tabWhere, keysetAfter(after)] } : tabWhere,
      // Oldest first — this is a work queue — with the id as tiebreaker, because a cursor over a
      // non-deterministic order skips and repeats rows between pages.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
    });
    const requests = rows.slice(0, pageSize);
    const last = requests[requests.length - 1];
    const nextCursor = rows.length > pageSize && last ? encodeQueueCursor(last.createdAt, last.id) : null;
    const counts = await this.tabCounts(now);
    if (requests.length === 0) return { items: [], nextCursor: null, counts };

    // Two batched lookups rather than per-row queries: the hints are the whole point of the queue,
    // and an admin opening it should not pay N round-trips for N applications.
    // P10-L: a `line-oa` row has no address, and `in: [null]` is not a query Prisma will accept.
    const emails = [...new Set(requests.map((r) => r.contactEmail).filter((email): email is string => !!email))];
    const taxIds = [...new Set(requests.map((r) => r.taxId).filter((id): id is string => !!id))];
    const phones = [...new Set(requests.map((r) => r.phoneNumber).filter((phone): phone is string => !!phone))];
    const [users, companies, phoneMatches, priorCompanies] = await Promise.all([
      this.prisma.client.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      taxIds.length
        ? this.prisma.client.company.findMany({ where: { taxId: { in: taxIds } }, select: { taxId: true, name: true } })
        : Promise.resolve([]),
      this.companiesReachableByPhone(phones),
      // Its own two reads are sequential (identity, then membership), but they run alongside the
      // others rather than after them: an admin opening the queue pays one round trip, not two.
      this.shopsTheseApplicantsAlreadyHad(requests),
    ]);
    const knownEmails = new Set(users.map((u) => u.email));
    const companyByTaxId = new Map(companies.map((c) => [c.taxId, c.name]));

    return {
      items: requests.map((request) =>
        toQueueItem(request, knownEmails, companyByTaxId, phoneMatches, priorCompanies, now)),
      nextCursor,
      counts,
    };
  }

  /**
   * R13: what each tab holds IN THE DATABASE, so the page never reports a count of the page it
   * happens to have. Two reads: one grouping by state and source, and one for abandoned
   * provisioning runs — which no state count can see, because the clock decides that one.
   */
  private async tabCounts(now: Date): Promise<Record<string, number>> {
    const [grouped, staleProvisioning] = await Promise.all([
      this.prisma.client.companySignupRequest.groupBy({
        by: ['state', 'source'],
        where: {
          state: {
            in: [...new Set([...QUEUE_STATES, ...LINE_ONLY_QUEUE_STATES, ...ARCHIVED_STATES])] as CompanySignupState[],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.client.companySignupRequest.count({ where: staleProvisioningWhere(now) }),
    ]);

    const total = (state: CompanySignupState, lineOnly = false) => grouped
      .filter((row) => row.state === state && (!lineOnly || row.source === SIGNUP_SOURCE_LINE_OA))
      .reduce((sum, row) => sum + row._count._all, 0);

    const pendingReview = total('PENDING_REVIEW');
    // The web filter reads EMAIL_PENDING without a bounce flag; a bounce IS the EMAIL_FAILED state.
    const awaitingClaim = total('EMAIL_PENDING');
    const problem = total('EMAIL_FAILED') + total('EXPIRED')
      + total('PROVISIONING_FAILED', true) + total('READY', true)
      + staleProvisioning;
    return {
      // Everything actionable: the same set `queueWhere(undefined)` returns, counted whole. A live
      // PROVISIONING run is listed there but is not a problem, so it is added separately.
      ALL: pendingReview + awaitingClaim + problem + (total('PROVISIONING', true) - staleProvisioning),
      PENDING_REVIEW: pendingReview,
      AWAITING_CLAIM: awaitingClaim,
      PROBLEM: problem,
      ARCHIVED: ARCHIVED_STATES.reduce((sum, state) => sum + total(state), 0),
    };
  }

  /**
   * Owner 2026-09-05: a repeat trial has to be visible before the approve button is pressed. The
   * applicant is found through the identity that owns their LINE slot IN ANY STATUS — an owner who
   * unlinked, or whose shop was closed, is exactly the case this hint exists for and the one an
   * ACTIVE-only read cannot see. Batched like the other hints: one identity read and one membership
   * read for the whole page, never per row.
   */
  private async shopsTheseApplicantsAlreadyHad(
    requests: CompanySignupRequest[],
  ): Promise<Map<string, PriorCompany>> {
    const lineRows = requests.filter((r) => r.lineProviderUserId && r.lineChannelId);
    const providerUserIds = [...new Set(lineRows.map((r) => r.lineProviderUserId!))];
    const identities = providerUserIds.length
      ? await this.prisma.client.externalIdentity.findMany({
          where: { provider: 'LINE', providerUserId: { in: providerUserIds } },
          select: { providerUserId: true, providerChannelId: true, userId: true },
        })
      : [];
    const userIdByIdentity = new Map(identities.map((i) => [identityKey(i.providerChannelId, i.providerUserId), i.userId]));
    const applicantUserIds = [...new Set([
      ...identities.map((i) => i.userId),
      ...requests.map((r) => r.attachUserId).filter((id): id is string => !!id),
    ])];
    if (applicantUserIds.length === 0) return new Map();

    const memberships = await this.prisma.client.companyMembership.findMany({
      // The same predicate submit's AUTO_FREE guard uses, from one definition: the chip must name
      // exactly the shops that made the machine step aside, never a different set.
      where: { userId: { in: applicantUserIds }, ...OWNED_COMPANY_MEMBERSHIP },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        company: { select: { name: true, status: true, planTerm: { select: { termDisabledAt: true } } } },
      },
    });
    // Oldest membership wins: it is the shop this person is coming back FROM.
    const byUserId = new Map<string, PriorCompany>();
    for (const row of memberships) {
      if (byUserId.has(row.userId)) continue;
      byUserId.set(row.userId, {
        name: row.company.name,
        // EXACTLY the pair `ownsTermExpiredCompany` uses in the LINE assistant: DISABLED *and* a
        // `termDisabledAt` stamp. Testing the stamp alone read a SUSPENDED shop as "หมดอายุ" while
        // the chat called the same shop something else — one shop, two stories, and the operator
        // would offer a renewal for a suspension only an admin can lift.
        state: row.company.status === 'DISABLED' && row.company.planTerm?.termDisabledAt
          ? 'EXPIRED'
          : row.company.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED',
      });
    }

    // Keyed by REQUEST id, so `toQueueItem` stays a pure mapping with nothing left to look up.
    const byRequest = new Map<string, PriorCompany>();
    for (const request of requests) {
      const userId = request.attachUserId
        ?? (request.lineProviderUserId && request.lineChannelId
          ? userIdByIdentity.get(identityKey(request.lineChannelId, request.lineProviderUserId))
          : undefined);
      const prior = userId ? byUserId.get(userId) : undefined;
      if (prior) byRequest.set(request.id, prior);
    }
    return byRequest;
  }

  /**
   * Review A-01: the number on the form already reaches a shop we opened. The commonest shape is a
   * customer an admin set up by hand who then applies from LINE as if they were new — approving
   * that opens a SECOND shop for one person, and nobody notices until they call.
   *
   * Two rails, because a phone lives in two places: on the company profile, and on the member's own
   * user record. A hint only: the operator calls the number, the system decides nothing.
   */
  private async companiesReachableByPhone(phones: string[]): Promise<Map<string, string>> {
    if (phones.length === 0) return new Map();
    const [byCompany, byMember] = await Promise.all([
      this.prisma.client.company.findMany({
        where: { phone: { in: phones } },
        select: { phone: true, name: true },
      }),
      this.prisma.client.companyMembership.findMany({
        where: { status: 'ACTIVE', user: { phoneNumber: { in: phones } } },
        select: { user: { select: { phoneNumber: true } }, company: { select: { name: true } } },
      }),
    ]);
    const matches = new Map<string, string>();
    // Company profile first: it names the shop directly, and a member row only implies it.
    for (const row of byMember) {
      if (row.user.phoneNumber) matches.set(row.user.phoneNumber, row.company.name);
    }
    for (const row of byCompany) {
      if (row.phone) matches.set(row.phone, row.name);
    }
    return matches;
  }

  /**
   * P10-L §8 / review B-09: an auto-approved application never enters the queue, so an admin needs
   * a way to look at what the machine let through. Read-only and time-boxed.
   */
  async listAutoApproved(days = 14, now = new Date()): Promise<AdminSignupQueueDto> {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const requests = await this.prisma.client.companySignupRequest.findMany({
      where: { autoApproved: true, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // These rows are all COMPLETED, so none of the queue's dedupe hints apply to them.
    return {
      items: requests.map((request) =>
        toQueueItem(request, new Set<string | null>(), new Map(), new Map(), new Map(), now)),
    };
  }

  /**
   * Approve, reject or suspend. Idempotent by contract: repeating the same decision returns the
   * current state and queues no second email, because the approve path's outbox key is the request
   * id. What "approve" MEANS depends on the source: a web application still has a mailbox to prove,
   * a LINE application proved its human at submit and goes straight to provisioning (spec §5).
   */
  async decide(
    requestId: string,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
    urls?: { webBaseUrl: string; apiBaseUrl: string },
    now = new Date(),
  ): Promise<AdminSignupDecisionDto> {
    const request = await this.findOrThrow(requestId);
    const lineOa = request.source === SIGNUP_SOURCE_LINE_OA;

    if (body.action === 'SUSPEND') return this.suspend(request, adminUserId, correlationRequestId, now);

    if (body.action === 'APPROVE') {
      // A LINE application may also be approved out of PROVISIONING_FAILED or READY: those ARE the
      // retry and the finish, and the P10-0 fence makes both idempotent — a second attempt either
      // completes the shop the first one started or fails again, never creating a second one.
      // An abandoned PROVISIONING row is approvable too: the fence will re-claim it, and the queue
      // has to agree with the fence about what abandoned means or it offers a recovery the fence
      // refuses (or, as first shipped, refuses one the fence would have allowed).
      // Review F2: retrying a failed provisioning is the same action on both sources — the fence
      // released precisely so somebody could try again, and adopt-on-retry makes it idempotent.
      const retryingProvisioning = request.state === 'PROVISIONING_FAILED';
      const approvable = lineOa
        ? LINE_APPROVABLE_STATES.includes(request.state as CompanySignupState)
          || isStaleProvisioning(request, now)
        : request.state === 'PENDING_REVIEW' || retryingProvisioning;
      if (!approvable) {
        if (request.state === 'EMAIL_PENDING') {
          // Review R08: NOT a no-op. A retry lands here when the first approve moved the state and
          // then failed — and returning success over a letter nobody queued is the whole defect.
          // The append is keyed on the request id alone, so repairing costs nothing when the event
          // is already there and is the only thing that helps when it is not.
          await this.claimEmail.enqueue(requestId, 'approve', request.approvedAt ?? now);
          // Review F8: a repair is an action an operator took, so it leaves a record of its own —
          // otherwise the only evidence a second approve happened is the absence of a second email.
          await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.claim_email_repaired', {
            source: request.source,
            fromState: request.state,
          });
          return { requestId, state: request.state };
        }
        // Anything else is a real conflict the admin should see.
        if (lineOa && SETTLED_STATES.includes(request.state as CompanySignupState)) {
          return { requestId, state: request.state };
        }
        throw new ConflictException(`invalid_signup_decision:${request.state}`);
      }
      const approvedAt = new Date();
      // R10: the enum the reviewer picked, stored with the approval it belongs to. Re-checked here
      // rather than trusted: the PDPA tripwire may only be armed by a value the enum knows.
      const chosenCategory = (COMPANY_BUSINESS_CATEGORIES as readonly string[])
        .includes(body.businessCategory ?? '')
        ? (body.businessCategory as string)
        : null;
      // Absent means "review did not decide", which must leave the column alone rather than write
      // a null over a choice an earlier decision made.
      const reviewedCategory = chosenCategory ? { businessCategory: chosenCategory } : {};
      // A LINE approval IS provisioning; so is a retry from PROVISIONING_FAILED on either source.
      // A web retry must never take the branch below it: that row claimed its link long ago, and
      // sending it back to EMAIL_PENDING would ask for a mailbox proof it has already given.
      if (lineOa || retryingProvisioning) {
        // No claim email exists for this source, so approval IS provisioning.
        // Review LOW-3: the approval stamp records WHEN this application was decided, so only a
        // first decision writes it. Closing a row that is already past the decision — a retry or a
        // stranded one — must not rewrite that history; the audit says what this call actually did.
        const firstDecision = request.state === 'PENDING_REVIEW';
        if (firstDecision) {
          await this.prisma.client.companySignupRequest.update({
            where: { id: requestId },
            data: { approvedAt, approvedByUserId: adminUserId, ...reviewedCategory },
          });
        }
        // Review F16: a retry is not a decision. Filing it as a second `signup.request.approved`
        // made the trail read as two approvals of one application — and on the web form, where the
        // real approval happened days earlier, that is simply untrue. Its own action keeps
        // "how many applications were approved" answerable by counting.
        await this.audit(
          requestId, adminUserId, correlationRequestId,
          retryingProvisioning ? 'signup.request.provisioning_retried' : 'signup.request.approved',
          {
            source: request.source,
            hadPhoneNumber: request.phoneNumber !== null,
            fromState: request.state,
            retryOfFailedProvisioning: retryingProvisioning,
            finishedStrandedRow: !firstDecision && !retryingProvisioning,
            // R10: which category armed (or did not arm) the PDPA tripwire is part of what this
            // operator decided, on a retry as much as on the first decision.
            businessCategory: chosenCategory,
          },
        );
        if (!urls) throw new ConflictException('signup_provisioning_urls_required');
        await this.provision.execute({
          requestId,
          actorUserId: adminUserId,
          operatorFromDirectory: false,
          correlationRequestId,
          ...urls,
        });
        // A LINE application finishes; a web one parks at the LINE step on its own welcome page,
        // so a retry must report where the row actually is rather than claiming it is done (F2).
        return { requestId, state: lineOa ? 'COMPLETED' : 'LINE_LINK_PENDING' };
      }
      // Review R08: state, the approval facts and the letter commit together or not at all. As
      // three separate writes, a failure between any two left the applicant in EMAIL_PENDING
      // waiting on an email nobody would send — and the retry read the state and reported success.
      // R09: `claimWindowStartedAt` is the clock the 30-day sweep and the self-serve resend read.
      // It starts here and RESTARTS on a reissue; `approvedAt` stays the audit fact it always was.
      // R10: the reviewer's category is one of those approval facts, so it rides the SAME
      // transaction rather than a second update that a failure could leave behind.
      await this.core.advance(requestId, 'EMAIL_PENDING', correlationRequestId, undefined, undefined, {
        data: {
          approvedAt, approvedByUserId: adminUserId, claimWindowStartedAt: approvedAt,
          ...reviewedCategory,
        },
        // Review F8: the letter AND the record of the decision ride the transaction that makes it.
        // The audit goes FIRST so a failure in the letter proves the audit rolls back with it
        // (review F15) — an audit written outside the transaction would survive and claim a
        // decision that never committed.
        alsoInTransaction: async (tx) => {
          await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.approved', {
            hadTaxId: request.taxId !== null,
            mxValid: request.mxValid ?? false,
            businessCategory: chosenCategory,
          }, tx);
          await this.claimEmail.enqueue(requestId, 'approve', approvedAt, tx);
        },
      });
      return { requestId, state: 'EMAIL_PENDING' };
    }

    if (request.state === 'REJECTED') return { requestId, state: request.state };
    if (request.state !== 'PENDING_REVIEW') throw new ConflictException(`invalid_signup_decision:${request.state}`);

    await this.core.advance(requestId, 'REJECTED', correlationRequestId);
    // No orphaned credential material may survive a rejection (spec §4B).
    await this.prisma.client.companySignupRequest.update({
      where: { id: requestId },
      data: { pendingPasswordHash: null },
    });
    await this.tokens.revokeAll(requestId);
    // Spec §4D: silent by default — the address is unverified, so an unsolicited notice would make
    // the platform a spam cannon aimed at whoever the applicant typed. A LINE application has no
    // address at all: its rejection travels as a LINE push (spec §7), which L-B sends.
    if (body.notifyApplicant) {
      // P10-L §7: a LINE application has no address, so its rejection travels as the one push §7
      // specifies. Same toggle, same default, one branch for which rail carries it.
      if (lineOa) await this.lineNotify.enqueue(requestId, 'rejected');
      else if (request.contactEmail) await this.claimEmail.enqueueRejectionNotice(requestId, body.rejectionReason);
    }
    await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.rejected', {
      notifyApplicant: body.notifyApplicant === true,
      // The paragraph itself stays out of evidence — it is copy for one inbox, not an audit fact.
      hadRejectionReason: Boolean(body.rejectionReason?.trim()),
    });
    return { requestId, state: 'REJECTED' };
  }

  /**
   * Spec §4D ④: "he already applied, and one day may already have paid" — an admin can always put a
   * fresh link in front of an approved applicant, at any age, without a second application.
   */
  async reissue(
    requestId: string,
    adminUserId: string,
    correlationRequestId: string,
    now = new Date(),
  ): Promise<AdminSignupReissueDto> {
    const request = await this.findOrThrow(requestId);
    if (!REISSUABLE_STATES.includes(request.state as CompanySignupState)) {
      throw new ConflictException(`invalid_signup_reissue:${request.state}`);
    }

    const revoked = await this.tokens.revokeAll(requestId);
    // From EMAIL_PENDING this is a no-op replay in the core; from EMAIL_FAILED/EXPIRED it is the
    // documented way back. Either way the state after this call is EMAIL_PENDING.
    await this.core.advance(requestId, 'EMAIL_PENDING', correlationRequestId);
    // Review R09: a reissue restarts the reminder clock AND the activation window. Without the
    // second one the 30-day sweep still measured from the original `approvedAt`, so an admin who
    // reissued an old approval watched the next sweep expire the link they had just sent — and the
    // token peek then refused it, because peek requires EMAIL_PENDING. `approvedAt` is untouched:
    // it records when this application was decided, which no later action may rewrite.
    await this.prisma.client.companySignupRequest.update({
      where: { id: requestId },
      data: { claimReminderSentAt: null, claimWindowStartedAt: now },
    });
    await this.claimEmail.enqueue(requestId, 'reissue');
    await this.audit(requestId, adminUserId, correlationRequestId, 'signup.request.claim_reissued', {
      fromState: request.state,
      revokedTokenCount: revoked,
    });
    return { requestId, state: 'EMAIL_PENDING', claimEmailQueued: true };
  }

  /**
   * P10-L §3.7: stopping an application an admin does not want to keep — most often one AUTO_FREE
   * let through. Reachable from more states than approve or reject, because the reason to stop can
   * arrive at any point, including after the shop exists.
   *
   * Scope note: this settles the APPLICATION. Disabling the company itself stays with the partner
   * lifecycle control an admin already has; the free-trial AI budget is what bounds spend meanwhile.
   */
  private async suspend(
    request: CompanySignupRequest,
    adminUserId: string,
    correlationRequestId: string,
    now: Date,
  ): Promise<AdminSignupDecisionDto> {
    if (request.state === 'SUSPENDED') return { requestId: request.id, state: request.state };
    // Never mid-provisioning while anything could still exist behind it. SUSPENDED is terminal, so
    // suspending a row whose company may already exist but whose trial guards have not run leaves
    // an UNLIMITED shop with its application shut behind it — and against a live attempt it races
    // work still in flight.
    //
    // The one safe exception (plan note, L-A review rounds 5–6): an ABANDONED attempt that never
    // stamped a `companyId`. The stamp happens inside the company transaction, so no company id
    // means no company — there is nothing to strand, and the row is otherwise a dead end an
    // operator can only clear by opening a shop they have already decided not to want.
    //
    // The predicate goes to the CORE rather than being decided here, because `request` above was
    // read outside the lock: a run that finished, or one that started, between that read and the
    // write would otherwise be suspended anyway — the transition table permits the edge and cannot
    // know that this particular row has since acquired a company. Re-checked under the lock, the
    // race collapses into a 409 the operator can act on.
    // READY is in the refused set for the same reason PROVISIONING is: the shop EXISTS and the
    // application has not closed, so suspending strands an ACTIVE company whose trial guards may
    // never have run — and frees the LINE account to apply again, because SUSPENDED leaves the
    // open-application index. The action a READY row wants is the close-out, not the stop.
    const inFlight = signupStateGuard(
      'suspend_not_allowed_in_flight',
      (current) => (current.state !== 'PROVISIONING' && current.state !== 'READY')
        || (current.state === 'PROVISIONING'
          && isStaleProvisioning(current, now)
          && current.companyId === null),
    );
    if (!inFlight(request)) throw new ConflictException(inFlight.rejectionCode);
    await this.core.advance(request.id, 'SUSPENDED', correlationRequestId, 'admin_suspended', inFlight);
    await this.tokens.revokeAll(request.id);
    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      data: { pendingPasswordHash: null },
    });
    await this.audit(request.id, adminUserId, correlationRequestId, 'signup.line.suspended', {
      source: request.source,
      fromState: request.state,
      wasAutoApproved: request.autoApproved,
    });
    return { requestId: request.id, state: 'SUSPENDED' };
  }

  private async findOrThrow(requestId: string): Promise<CompanySignupRequest> {
    const request = await this.prisma.client.companySignupRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('company_signup_request_not_found');
    return request;
  }

  /** Every admin action on an application is HIGH, with booleans, ids and states only. */
  private async audit(
    requestId: string,
    adminUserId: string,
    correlationRequestId: string,
    action: string,
    // Scalars only, by type: an object here would be a place for PII to hide.
    metadata: Record<string, string | number | boolean | null>,
    /**
     * Review F8: the approve transaction. An audit written afterwards can be lost on its own, which
     * leaves a decision that happened with no record that it did — the one thing an audit trail
     * exists to prevent.
     */
    tx?: { auditLog: { create(args: unknown): Promise<unknown> } },
  ): Promise<void> {
    await (tx ?? this.prisma.client).auditLog.create({
      data: {
        actorUserId: adminUserId,
        action,
        targetType: 'company_signup_request',
        targetId: requestId,
        requestId: correlationRequestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: metadata,
      },
    });
  }
}

/**
 * F10: one page boundary, as the two values the ordering is made of. Base64url so it survives a
 * query string, and opaque so nobody starts building one by hand.
 */
export function encodeQueueCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeQueueCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  // A cursor that cannot be read is the FIRST page, never an error and never an empty tab: it
  // arrives from a query string, and the worst an operator should get from a mangled one is
  // starting over.
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = rest.join('|');
  const createdAt = at ? new Date(at) : new Date(NaN);
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** Everything strictly after that boundary, in the same order the page is read in. */
function keysetAfter(after: { createdAt: Date; id: string }) {
  return {
    OR: [
      { createdAt: { gt: after.createdAt } },
      { createdAt: after.createdAt, id: { gt: after.id } },
    ],
  };
}

/**
 * R13: an abandoned provisioning run, as a query. The fence decides this with `isStaleProvisioning`
 * against the same clock; the two MUST agree, so the threshold comes from that module's constant
 * and never from a number typed here.
 */
function staleProvisioningWhere(now: Date) {
  return {
    state: 'PROVISIONING' as CompanySignupState,
    source: SIGNUP_SOURCE_LINE_OA,
    provisioningStartedAt: { lt: new Date(now.getTime() - STALE_PROVISIONING_MS) },
  };
}

/**
 * R13: what one tab holds. The page used to decide this over whatever 200 rows it had been given,
 * which is why a tab could show nothing while the database held a backlog. One definition, on the
 * server, used for both the page and its count.
 *
 * No tab (the default) is the whole actionable queue, byte-identical to what this asked for before
 * paging existed — a web-form row in a LINE-only state still has no retry an admin could reach.
 */
function queueWhere(tab: string | undefined, now: Date) {
  if (tab === 'PENDING_REVIEW') return { state: 'PENDING_REVIEW' as CompanySignupState };
  // A bounce IS the EMAIL_FAILED state, so "waiting to set a password" is EMAIL_PENDING exactly.
  if (tab === 'AWAITING_CLAIM') return { state: 'EMAIL_PENDING' as CompanySignupState };
  if (tab === 'ARCHIVED') return { state: { in: ARCHIVED_STATES as CompanySignupState[] } };
  if (tab === 'PROBLEM') {
    return {
      OR: [
        { state: { in: PROBLEM_STATES as CompanySignupState[] } },
        { state: { in: LINE_PROBLEM_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
        staleProvisioningWhere(now),
      ],
    };
  }
  return {
    OR: [
      { state: { in: QUEUE_STATES as CompanySignupState[] } },
      { state: { in: LINE_ONLY_QUEUE_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
    ],
  };
}

/** The one shop a repeat applicant already had, and how it stands today. */
type PriorCompany = { name: string; state: 'ACTIVE' | 'EXPIRED' | 'CLOSED' };

const identityKey = (channelId: string, providerUserId: string) => `${channelId}:${providerUserId}`;

function toQueueItem(
  request: CompanySignupRequest,
  knownEmails: Set<string | null>,
  companyByTaxId: Map<string | null, string>,
  companyByPhone: Map<string, string>,
  priorCompanies: Map<string, PriorCompany>,
  now: Date,
): AdminSignupQueueItemDto {
  const priorCompany = priorCompanies.get(request.id);
  const taxIdMatch = request.taxId ? companyByTaxId.get(request.taxId) : undefined;
  const phoneMatch = request.phoneNumber ? companyByPhone.get(request.phoneNumber) : undefined;
  const approvalAge = daysSinceApproval(request.approvedAt, now);
  return {
    requestId: request.id,
    state: request.state,
    companyName: request.companyName,
    ownerDisplayName: request.ownerDisplayName,
    // Omitted rather than blanked when the application came from LINE: the queue shows "—" and no
    // reader can mistake an empty string for a real address (review B-03).
    ...(request.contactEmail ? { contactEmail: request.contactEmail } : {}),
    ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
    ...(request.businessType ? { businessType: request.businessType } : {}),
    ...(request.vatRegistered !== null ? { vatRegistered: request.vatRegistered } : {}),
    ...(request.taxId ? { taxId: request.taxId } : {}),
    ...(request.requestedOfferKey ? { requestedOfferKey: request.requestedOfferKey } : {}),
    // R10: the server owns the mapping, so the approve dialog can default to it — and can see that
    // a row with free text answering OTHER is one where the reviewer has to make the call.
    businessCategory: reviewedBusinessCategory(request.businessCategory)
      ?? mapBusinessCategory(request.businessType),
    ...(request.mxValid !== null ? { mxValid: request.mxValid } : {}),
    // P10-L §8: the operator has to be able to tell the two sources apart at a glance, and a LINE
    // row shows a LINE name and an acceptance time where a web row shows an address and MX.
    source: request.source,
    ...(request.lineDisplayName ? { lineDisplayName: request.lineDisplayName } : {}),
    ...(request.autoApproved ? { autoApproved: true } : {}),
    // Decided at submit from the verified ID token, so by the time an operator reads it this is a
    // fact about what approving WILL do, not something they are being asked to choose (spec §5).
    ...(request.attachUserId ? { attachesToExistingAccount: true } : {}),
    // Whether a PROVISIONING row is still being worked on or was abandoned. The server owns this
    // judgement because it owns the clock the fence uses; the page must not guess it.
    ...(isStaleProvisioning(request, now) ? { staleProvisioning: true } : {}),
    // Whether this application built a shop yet. The page needs it to know that a targeted suspend
    // strands nothing, and the operator needs it to know which link to open.
    ...(request.companyId ? { companyId: request.companyId } : {}),
    ...(request.legalAcceptedAt ? { legalAcceptedAt: request.legalAcceptedAt.toISOString() } : {}),
    createdAt: request.createdAt.toISOString(),
    ...(request.approvedAt ? { approvedAt: request.approvedAt.toISOString() } : {}),
    ...(request.claimEmailLastSentAt ? { claimEmailLastSentAt: request.claimEmailLastSentAt.toISOString() } : {}),
    // Hint only. Spec §4C is explicit that the attach decision is made by the applicant at the
    // claim page, never by the admin from this flag.
    emailMatchesExistingUser: knownEmails.has(request.contactEmail),
    ...(taxIdMatch ? { taxIdMatchesCompanyName: taxIdMatch } : {}),
    ...(phoneMatch ? { phoneMatchesCompanyName: phoneMatch } : {}),
    ...(approvalAge !== undefined ? { daysSinceApproval: approvalAge } : {}),
    emailDeliveryFailed: request.state === 'EMAIL_FAILED',
    // Owner 2026-09-05: the repeat-trial hint. Nothing is blocked — the operator is simply told
    // which shop this LINE account had before, and whether it is closed, expired or still running.
    ...(priorCompany ? { priorCompanyName: priorCompany.name, priorCompanyState: priorCompany.state } : {}),
    // Why the last provisioning stopped, so "เปิดร้านไม่สำเร็จ" can name a cause an admin can act on.
    ...(request.failureCode ? { failureCode: request.failureCode } : {}),
  };
}
