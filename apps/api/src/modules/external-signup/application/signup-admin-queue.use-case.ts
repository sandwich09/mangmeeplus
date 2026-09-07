import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
  LineSignupEligibleCompanyDto,
} from '@watchdog-bms/contracts';
import { COMPANY_BUSINESS_CATEGORIES, SIGNUP_RESOLUTION_NOTE_MAX_LENGTH } from '@watchdog-bms/contracts';
import type { CompanySignupRequest, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService, signupStateGuard } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { SignupClaimEmailService } from './signup-claim-email.service';
import { ProvisionSignupUseCase, mapBusinessCategory, reviewedBusinessCategory } from './provision-signup.use-case';
import { LineSignupNotifyService } from './line-signup-notify.service';
import { shortLineIdHash } from './signup-admin-notify.service';
import { lineSignupContactEmailConflict, SubmitLineSignupUseCase } from './submit-line-signup.use-case';
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
/** Committed LINE intake that needs the explicit RETRY_INTAKE action, never APPROVE. */
const LINE_INTAKE_QUEUE_STATES: readonly CompanySignupState[] = ['RECEIVED', 'VALIDATED'];

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

/**
 * The bounced/expired/failed rows the "มีปัญหา" tab exists for, minus the time-based one.
 *
 * `PROBLEM_STATES` follows `QUEUE_STATES`: review F2 made `PROVISIONING_FAILED` an every-source
 * row, so leaving it on the LINE-only list here would have listed a Flow B failure in the ALL tab
 * and hidden it from the one tab an operator opens to find exactly that — while the tab's own
 * count included it. `READY` stays LINE-only: a web row's close-out is the applicant's own
 * welcome page, not an admin action.
 */
const PROBLEM_STATES: readonly CompanySignupState[] = ['EMAIL_FAILED', 'EXPIRED', 'PROVISIONING_FAILED'];
const LINE_PROBLEM_STATES: readonly CompanySignupState[] = ['READY'];

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
    @Optional() private readonly lineSubmit?: SubmitLineSignupUseCase,
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
    const lineRequestIds = requests.filter((request) => request.source === SIGNUP_SOURCE_LINE_OA).map((request) => request.id);
    const [users, companies, phoneMatches, priorCompanies, emailReviewEvidence, eligibleCompanies] = await Promise.all([
      this.prisma.client.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      taxIds.length
        ? this.prisma.client.company.findMany({ where: { taxId: { in: taxIds } }, select: { taxId: true, name: true } })
        : Promise.resolve([]),
      this.companiesReachableByPhone(phones),
      // Its own two reads are sequential (identity, then membership), but they run alongside the
      // others rather than after them: an admin opening the queue pays one round trip, not two.
      this.shopsTheseApplicantsAlreadyHad(requests),
      lineRequestIds.length ? this.prisma.client.auditLog.findMany({
        where: { action: 'signup.line.submitted', targetType: 'company_signup_request', targetId: { in: lineRequestIds },
          metadataJson: { path: ['emailPreviouslyUsed'], equals: true } },
        select: { targetId: true },
      }) : Promise.resolve([]),
      this.eligibleCompaniesForRequests(requests),
    ]);
    const knownEmails = new Set(users.map((u) => u.email));
    const companyByTaxId = new Map(companies.map((c) => [c.taxId, c.name]));
    const reusedEmailRequests = new Set(emailReviewEvidence.map((evidence) => evidence.targetId));

    return {
      items: requests.map((request) =>
        ({ ...toQueueItem(request, knownEmails, companyByTaxId, phoneMatches, priorCompanies, eligibleCompanies, now),
          ...(reusedEmailRequests.has(request.id) ? { emailPreviouslyUsed: true } : {}) })),
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
            in: [...new Set([
              ...QUEUE_STATES, ...LINE_ONLY_QUEUE_STATES, ...LINE_INTAKE_QUEUE_STATES, ...ARCHIVED_STATES,
            ])] as CompanySignupState[],
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
    // Counted exactly the way `queueWhere('PROBLEM')` asks for them, or the tab promises rows the
    // list cannot show: F2 made PROVISIONING_FAILED every-source, READY is still LINE-only.
    const problem = total('EMAIL_FAILED') + total('EXPIRED')
      + total('PROVISIONING_FAILED') + total('READY', true)
      + total('RECEIVED', true) + total('VALIDATED', true)
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

  /** Current proof targets only: ACTIVE identity/user/membership/role and an ACTIVE company. */
  private async eligibleCompaniesForRequests(
    requests: CompanySignupRequest[],
  ): Promise<Map<string, LineSignupEligibleCompanyDto[]>> {
    const lineRows = requests.filter((request) => request.lineProviderUserId && request.lineChannelId);
    if (lineRows.length === 0) return new Map();
    const identities = await this.prisma.client.externalIdentity.findMany({
      where: {
        provider: 'LINE',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        providerUserId: { in: [...new Set(lineRows.map((request) => request.lineProviderUserId!))] },
      },
      select: { providerUserId: true, providerChannelId: true, userId: true },
    });
    const requestIdsByUser = new Map<string, string[]>();
    for (const request of lineRows) {
      const identity = identities.find((candidate) => candidate.providerUserId === request.lineProviderUserId
        && candidate.providerChannelId === request.lineChannelId);
      if (!identity) continue;
      requestIdsByUser.set(identity.userId, [...(requestIdsByUser.get(identity.userId) ?? []), request.id]);
    }
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: {
        userId: { in: [...requestIdsByUser.keys()] },
        status: 'ACTIVE',
        company: { status: 'ACTIVE' },
        roles: { some: { role: { status: 'ACTIVE' } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, companyId: true, company: { select: { name: true } } },
    });
    const result = new Map<string, LineSignupEligibleCompanyDto[]>();
    for (const membership of memberships) {
      const target = {
        companyId: membership.companyId,
        companyName: membership.company.name,
        status: 'ACTIVE' as const,
        canEnter: true,
      };
      for (const requestId of requestIdsByUser.get(membership.userId) ?? []) {
        result.set(requestId, [...(result.get(requestId) ?? []), target]);
      }
    }
    return result;
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
        toQueueItem(request, new Set<string | null>(), new Map(), new Map(), new Map(), new Map(), now)),
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

    if (lineOa) {
      if (body.version === undefined) throw new ConflictException('line_signup_version_required');
      if (request.version !== body.version) throw new ConflictException('line_signup_version_conflict');
      if (body.action === 'APPROVE') throw new ConflictException('line_signup_resolution_required');
      if (body.action === 'RETRY_INTAKE') {
        if (!urls) throw new ConflictException('signup_provisioning_urls_required');
        if (!LINE_INTAKE_QUEUE_STATES.includes(request.state as CompanySignupState)) {
          throw new ConflictException(`invalid_signup_retry:${request.state}`);
        }
        if (!this.lineSubmit) throw new ConflictException('line_signup_retry_unavailable');
        const current = await this.lineSubmit.retryIntake(request.id, body.version, correlationRequestId, urls, now);
        return this.lineDecisionResult(current);
      }
      if (body.action === 'REQUEST_INFO') {
        return this.requestLineInformation(request, body, adminUserId, correlationRequestId, now);
      }
      if (body.action === 'RETURN_EXISTING') {
        return this.returnToExistingCompany(request, body, adminUserId, correlationRequestId, now);
      }
      if (body.action === 'CREATE_NEW_SHOP') {
        if (!urls) throw new ConflictException('signup_provisioning_urls_required');
        return this.createNewLineShop(request, body, adminUserId, correlationRequestId, urls, now);
      }
    } else if (['CREATE_NEW_SHOP', 'RETURN_EXISTING', 'REQUEST_INFO', 'RETRY_INTAKE'].includes(body.action)) {
      throw new ConflictException('line_signup_action_not_available');
    }

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

  private async requestLineInformation(
    request: CompanySignupRequest,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
    now: Date,
  ): Promise<AdminSignupDecisionDto> {
    const note = requiredNote(body.resolutionNote, 'line_signup_resolution_note_required');
    const result = await this.prisma.client.$transaction(async (tx) => {
      await lockSignupRequest(tx, request.id);
      const current = await tx.companySignupRequest.findUnique({ where: { id: request.id } });
      if (!current) throw new NotFoundException('company_signup_request_not_found');
      this.assertLineVersion(current, body.version);
      if (!current.lineProviderUserId) throw new ConflictException('line_signup_identity_missing');
      if (!['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'].includes(current.state)
        || current.companyId || current.resolvedExistingCompanyId || current.provisioningAttemptId
        || current.autoApproved || current.reviewResolution === 'NEW_SHOP') {
        throw new ConflictException(`invalid_signup_request_info:${current.state}`);
      }
      const nextVersion = current.version + 1;
      const changed = await tx.companySignupRequest.update({
        where: { id: current.id },
        data: {
          reviewResolution: 'REQUEST_INFO',
          resolutionNote: note,
          resolvedAt: now,
          resolvedByUserId: adminUserId,
          version: { increment: 1 },
        },
      });
      await this.audit(current.id, adminUserId, correlationRequestId, 'signup.line.information_requested', {
        fromState: current.state,
        reviewVersion: nextVersion,
      }, tx);
      const existingCase = await tx.lineSupportRequest.findFirst({
        where: { lineUserId: current.lineProviderUserId, status: { in: ['OPEN', 'ANSWERED'] } },
        orderBy: { requestedAt: 'desc' },
        select: { id: true, assignedToUserId: true },
      });
      const supportRequest = existingCase
        ? await tx.lineSupportRequest.update({
            where: { id: existingCase.id },
            data: {
              signupRequestId: current.id,
              ...(existingCase.assignedToUserId ? {} : { assignedToUserId: adminUserId, assignedAt: now }),
            },
            select: { id: true },
          })
        : await tx.lineSupportRequest.create({
            data: {
              companyId: null,
              signupRequestId: current.id,
              lineUserId: current.lineProviderUserId,
              lineUserIdHash: shortLineIdHash(current.lineProviderUserId),
              assignedToUserId: adminUserId,
              assignedAt: now,
            },
            select: { id: true },
          });
      await this.lineNotify.enqueue(current.id, 'requested_info', now, { reviewVersion: nextVersion, tx });
      return { request: changed, supportRequestId: supportRequest.id };
    });
    return {
      ...this.lineDecisionResult(result.request),
      customerNotification: 'QUEUED',
      supportRequestId: result.supportRequestId,
    };
  }

  private async returnToExistingCompany(
    request: CompanySignupRequest,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
    now: Date,
  ): Promise<AdminSignupDecisionDto> {
    const targetCompanyId = body.targetCompanyId?.trim();
    if (!targetCompanyId) throw new ConflictException('line_signup_existing_shop_target_required');
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await lockSignupRequest(tx, request.id);
      const current = await tx.companySignupRequest.findUnique({ where: { id: request.id } });
      if (!current) throw new NotFoundException('company_signup_request_not_found');
      this.assertLineVersion(current, body.version);
      if (current.state === 'COMPLETED' && current.reviewResolution === 'RETURN_EXISTING'
        && current.resolvedExistingCompanyId === targetCompanyId) return current;
      if (current.state !== 'PENDING_REVIEW' || current.companyId || current.provisioningAttemptId) {
        throw new ConflictException(`invalid_signup_return_existing:${current.state}`);
      }
      const proof = await tx.externalIdentity.findFirst({
        where: {
          provider: 'LINE',
          providerUserId: current.lineProviderUserId ?? '',
          providerChannelId: current.lineChannelId ?? '',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
        select: { userId: true },
      });
      const membership = proof ? await tx.companyMembership.findFirst({
        where: {
          userId: proof.userId,
          companyId: targetCompanyId,
          status: 'ACTIVE',
          company: { status: 'ACTIVE' },
          roles: { some: { role: { status: 'ACTIVE' } } },
        },
        select: { id: true },
      }) : null;
      if (!proof || !membership) throw new ConflictException('line_signup_existing_shop_proof_required');
      const changed = await tx.companySignupRequest.update({
        where: { id: current.id },
        data: {
          state: 'COMPLETED',
          reviewResolution: 'RETURN_EXISTING',
          resolutionNote: body.resolutionNote?.trim() || null,
          resolvedExistingCompanyId: targetCompanyId,
          resolvedAt: now,
          resolvedByUserId: adminUserId,
          approvedAt: now,
          approvedByUserId: adminUserId,
          version: { increment: 1 },
        },
      });
      await tx.lineCompanyContext.upsert({
        where: { lineUserId: current.lineProviderUserId! },
        create: { lineUserId: current.lineProviderUserId!, companyId: targetCompanyId, selectedAt: now },
        update: { companyId: targetCompanyId, selectedAt: now },
      });
      await this.audit(current.id, adminUserId, correlationRequestId, 'signup.line.returned_existing', {
        companyId: targetCompanyId,
        fromState: current.state,
      }, tx);
      return changed;
    });
    return this.lineDecisionResult(updated);
  }

  private async createNewLineShop(
    request: CompanySignupRequest,
    body: AdminSignupDecisionBody,
    adminUserId: string,
    correlationRequestId: string,
    urls: { webBaseUrl: string; apiBaseUrl: string },
    now: Date,
  ): Promise<AdminSignupDecisionDto> {
    const decision = await this.prisma.client.$transaction(async (tx) => {
      await lockSignupRequest(tx, request.id);
      const current = await tx.companySignupRequest.findUnique({ where: { id: request.id } });
      if (!current) throw new NotFoundException('company_signup_request_not_found');
      this.assertLineVersion(current, body.version);
      const recoverable = current.state === 'PROVISIONING_FAILED' || current.state === 'READY'
        || isStaleProvisioning(current, now);
      if (recoverable && current.reviewResolution === 'NEW_SHOP') {
        await this.assertLineAccountNotBlocked(tx, current);
        return { request: current, provision: true };
      }
      if (current.state !== 'PENDING_REVIEW' && !recoverable) {
        if (current.state === 'COMPLETED' && current.reviewResolution === 'NEW_SHOP') {
          return { request: current, provision: false };
        }
        throw new ConflictException(`invalid_signup_create_new_shop:${current.state}`);
      }

      const identity = await this.assertLineAccountNotBlocked(tx, current);
      const repeatTrial = identity.userId !== null && await this.hasPriorOwnedCompany(
        tx,
        identity.userId,
        current.companyId,
      );
      const contactEmailConflict = await lineSignupContactEmailConflict(
        tx,
        current.id,
        current.contactEmail ?? '',
        identity.attachUserId,
      );
      const newSharedNote = body.acknowledgeSharedContact
        ? requiredNote(body.sharedContactNote, 'line_signup_shared_contact_note_required')
        : null;
      const sharedContactReviewed = current.sharedContactReviewedAt !== null || newSharedNote !== null;
      if (contactEmailConflict && !sharedContactReviewed) {
        throw new ConflictException('line_signup_shared_contact_review_required');
      }
      const newTrialNote = body.grantRepeatTrial
        ? requiredNote(body.trialGrantNote, 'line_signup_trial_grant_note_required')
        : null;
      const repeatTrialGranted = current.repeatTrialGrantedAt !== null || newTrialNote !== null;
      const chosenCategory = (COMPANY_BUSINESS_CATEGORIES as readonly string[])
        .includes(body.businessCategory ?? '') ? body.businessCategory! : null;

      if (repeatTrial && !repeatTrialGranted) {
        const changed = await tx.companySignupRequest.update({
          where: { id: current.id },
          data: {
            contactEmailConflict,
            reviewResolution: 'PLAN_REVIEW',
            resolutionNote: body.resolutionNote?.trim() || null,
            resolvedAt: now,
            resolvedByUserId: adminUserId,
            ...(newSharedNote ? {
              sharedContactReviewedAt: now,
              sharedContactReviewedByUserId: adminUserId,
              sharedContactReviewNote: newSharedNote,
            } : {}),
            version: { increment: 1 },
          },
        });
        await this.audit(current.id, adminUserId, correlationRequestId, 'signup.line.plan_review_required', {
          repeatTrial: true,
          contactEmailConflict,
        }, tx);
        return { request: changed, provision: false };
      }

      const changed = await tx.companySignupRequest.update({
        where: { id: current.id },
        data: {
          contactEmailConflict,
          reviewResolution: 'NEW_SHOP',
          resolutionNote: body.resolutionNote?.trim() || null,
          resolvedExistingCompanyId: null,
          resolvedAt: now,
          resolvedByUserId: adminUserId,
          approvedAt: current.approvedAt ?? now,
          approvedByUserId: current.approvedByUserId ?? adminUserId,
          ...(chosenCategory ? { businessCategory: chosenCategory } : {}),
          ...(repeatTrial && newTrialNote ? {
            repeatTrialGrantedAt: now,
            repeatTrialGrantedByUserId: adminUserId,
            repeatTrialGrantNote: newTrialNote,
          } : {}),
          ...(contactEmailConflict && newSharedNote ? {
            sharedContactReviewedAt: now,
            sharedContactReviewedByUserId: adminUserId,
            sharedContactReviewNote: newSharedNote,
          } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit(current.id, adminUserId, correlationRequestId, 'signup.request.approved', {
        source: current.source,
        resolution: 'NEW_SHOP',
        repeatTrial,
        repeatTrialGranted,
        contactEmailConflict,
        sharedContactReviewed,
      }, tx);
      return { request: changed, provision: true };
    });

    if (!decision.provision) return this.lineDecisionResult(decision.request);
    await this.provision.execute({
      requestId: request.id,
      actorUserId: adminUserId,
      operatorFromDirectory: false,
      correlationRequestId,
      ...urls,
    });
    return this.lineDecisionResult(await this.findOrThrow(request.id));
  }

  private async assertLineAccountNotBlocked(
    tx: Prisma.TransactionClient,
    request: CompanySignupRequest,
  ): Promise<{ userId: string | null; attachUserId: string | null }> {
    const identity = await tx.externalIdentity.findFirst({
      where: {
        provider: 'LINE',
        providerUserId: request.lineProviderUserId ?? '',
        providerChannelId: request.lineChannelId ?? '',
      },
      select: { userId: true, status: true, user: { select: { status: true } } },
    });
    if (!identity) return { userId: null, attachUserId: null };
    if (identity.status === 'DISABLED') throw new ConflictException('line_signup_identity_disabled');
    if (identity.user.status !== 'ACTIVE') throw new ConflictException('line_signup_account_blocked');
    if (request.attachUserId && (identity.status !== 'ACTIVE' || identity.userId !== request.attachUserId)) {
      throw new ConflictException('line_signup_existing_account_proof_changed');
    }
    return {
      userId: identity.userId,
      attachUserId: identity.status === 'ACTIVE' ? identity.userId : null,
    };
  }

  private async hasPriorOwnedCompany(
    tx: Prisma.TransactionClient,
    userId: string,
    excludeCompanyId: string | null,
  ): Promise<boolean> {
    return (await tx.companyMembership.count({
      where: {
        userId,
        ...OWNED_COMPANY_MEMBERSHIP,
        ...(excludeCompanyId ? { companyId: { not: excludeCompanyId } } : {}),
      },
    })) > 0;
  }

  private assertLineVersion(request: CompanySignupRequest, version: number | undefined): void {
    if (version === undefined) throw new ConflictException('line_signup_version_required');
    if (request.version !== version) throw new ConflictException('line_signup_version_conflict');
  }

  private lineDecisionResult(request: CompanySignupRequest): AdminSignupDecisionDto {
    const entryCompanyId = request.reviewResolution === 'RETURN_EXISTING'
      ? request.resolvedExistingCompanyId
      : request.companyId;
    return {
      requestId: request.id,
      state: request.state,
      version: request.version,
      ...(request.reviewResolution ? { resolution: request.reviewResolution as any } : {}),
      ...(entryCompanyId ? { entryCompanyId } : {}),
    };
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
    if (request.resolvedExistingCompanyId) {
      throw new ConflictException('line_signup_resolved_existing_suspend_not_allowed');
    }
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

function requiredNote(value: string | undefined, missingCode: string): string {
  const note = value?.trim() ?? '';
  if (!note) throw new ConflictException(missingCode);
  if (note.length > SIGNUP_RESOLUTION_NOTE_MAX_LENGTH) {
    throw new ConflictException('line_signup_resolution_note_too_long');
  }
  return note;
}

async function lockSignupRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
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
        { state: { in: LINE_INTAKE_QUEUE_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
        staleProvisioningWhere(now),
      ],
    };
  }
  return {
    OR: [
      { state: { in: QUEUE_STATES as CompanySignupState[] } },
      { state: { in: LINE_ONLY_QUEUE_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
      { state: { in: LINE_INTAKE_QUEUE_STATES as CompanySignupState[] }, source: SIGNUP_SOURCE_LINE_OA },
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
  eligibleCompanies: Map<string, LineSignupEligibleCompanyDto[]>,
  now: Date,
): AdminSignupQueueItemDto {
  const priorCompany = priorCompanies.get(request.id);
  const taxIdMatch = request.taxId ? companyByTaxId.get(request.taxId) : undefined;
  const phoneMatch = request.phoneNumber ? companyByPhone.get(request.phoneNumber) : undefined;
  const approvalAge = daysSinceApproval(request.approvedAt, now);
  return {
    requestId: request.id,
    version: request.version,
    state: request.state,
    companyName: request.companyName,
    ownerDisplayName: request.ownerDisplayName,
    // Omitted rather than blanked when the application came from LINE: the queue shows "—" and no
    // reader can mistake an empty string for a real address (review B-03).
    ...(request.contactEmail ? { contactEmail: request.contactEmail } : {}),
    ...(request.source === SIGNUP_SOURCE_LINE_OA
      ? { contactEmailConflict: request.contactEmailConflict === true }
      : {}),
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
    ...(request.reviewResolution ? { reviewResolution: request.reviewResolution as any } : {}),
    ...(request.resolvedExistingCompanyId ? { resolvedExistingCompanyId: request.resolvedExistingCompanyId } : {}),
    ...(eligibleCompanies.get(request.id)?.length
      ? { eligibleExistingCompanies: eligibleCompanies.get(request.id) }
      : {}),
    ...(request.source === SIGNUP_SOURCE_LINE_OA ? {
      requiresRepeatTrialGrant: priorCompany !== undefined,
      repeatTrialGranted: request.repeatTrialGrantedAt !== null,
    } : {}),
    // Why the last provisioning stopped, so "เปิดร้านไม่สำเร็จ" can name a cause an admin can act on.
    ...(request.failureCode ? { failureCode: request.failureCode } : {}),
  };
}
