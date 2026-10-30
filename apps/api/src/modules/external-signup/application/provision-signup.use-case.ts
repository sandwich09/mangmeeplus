import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PLAN_TIER_PRESETS, SIGNUP_TRIAL_TIER_KEY } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { planTermLockReason } from '../../system-partner-management/domain/logic/plan-term.logic';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SignupAdminNotifyService } from './signup-admin-notify.service';
import { LineSignupNotifyService } from './line-signup-notify.service';
import { SignupOpsAlertService } from './signup-ops-alert.service';
import { suggestedUsernameFromEmail } from '../domain/account-claim.logic';
import { SIGNUP_SOURCE_EMAIL_OTP, SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';

export type ProvisionSignupCommand = {
  requestId: string;
  /** Chosen at the claim page. Absent on an admin retry, where the email local part is the default. */
  username?: string;
  /**
   * Who onboarding records as the operator of everything it creates. Required when the request has
   * no `approvedByUserId` — an AUTO_FREE application, by design (spec §5) — because that id lands
   * in `CompanyOnboardingRun.createdBySystemAdminUserId` and `AuditLog.actorUserId`, both of which
   * are foreign keys to User. Passing anything that is not a real user id fails with P2003.
   */
  actorUserId?: string;
  /**
   * Whether `actorUserId` was found in the operator directory rather than named by a decision.
   * Only the caller knows: AUTO_FREE looks one up before calling, an admin decision names itself.
   * Absent means "this use-case decides", which is what the claim path wants.
   */
  operatorFromDirectory?: boolean;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type ProvisionSignupResult = {
  companyId: string;
  companyName: string;
  attachedToExistingUser: boolean;
};

/**
 * Turns a claimed signup into a real company through the one onboarding service that owns company
 * creation (spec §2 rule 5). It never writes a Company, User or Membership itself — it only decides
 * which of the two owner shapes applies and hands that to `CreateCompanyOnboardingUseCase`.
 */
@Injectable()
export class ProvisionSignupUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly onboarding: CreateCompanyOnboardingUseCase,
    private readonly config: AppConfigService,
    /** The same active-SYSTEM_ADMIN lookup AUTO_FREE uses to name an operator of record. */
    private readonly adminDirectory: SignupAdminNotifyService,
    private readonly lineNotify: LineSignupNotifyService,
    private readonly opsAlerts: SignupOpsAlertService,
    /** J1: the one writer allowed to move a company's lifecycle status, audit included. */
    private readonly lifecycle: PartnerLifecycleTransitionUseCase,
  ) {}

  async execute(cmd: ProvisionSignupCommand): Promise<ProvisionSignupResult> {
    // The P10-0 fence decides the single winner. A second caller for the same request gets
    // claimed=false and simply reads back what the winner already created.
    const claim = await this.core.claimProvisioning(cmd.requestId, cmd.correlationRequestId);
    const request = claim.request;
    // P10-L §6: which owner shape applies is decided by the row's source, once, here.
    const lineOa = request.source === SIGNUP_SOURCE_LINE_OA;
    const emailOtp = request.source === SIGNUP_SOURCE_EMAIL_OTP;
    if (lineOa && request.resolvedExistingCompanyId) {
      throw new ConflictException('line_signup_existing_resolution_not_provisionable');
    }

    if (!claim.claimed) {
      if (!request.companyId) throw new ConflictException('signup_provisioning_in_progress');
      // Review HIGH-C: a LINE row stranded at READY has a finished company and one missing hop —
      // a failure between `completeProvisioning` and this advance used to park it there forever,
      // where the open-application fence also kept its LINE account locked out.
      if ((lineOa || emailOtp) && request.state === 'READY') {
        await this.core.advance(request.id, 'COMPLETED', cmd.correlationRequestId);
        if (lineOa) await this.announceReady(request);
      }
      return {
        companyId: request.companyId,
        companyName: request.companyName,
        attachedToExistingUser: request.attachUserId !== null,
      };
    }

    // §15.6 (c): taking the fence from an abandoned attempt means a shop sat half-open long enough
    // for the clock to give up on it. Worth an operator's attention even though this call recovers.
    if (claim.reclaimedStale) await this.opsAlerts.raise('provisioning_failed');

    const attachUserId = request.attachUserId;
    const existingOwner = attachUserId
      ? await this.prisma.client.user.findUnique({ where: { id: attachUserId }, select: { email: true } })
      : null;
    // Spec §4B: an attached account that already carries a different address keeps it. Recorded as
    // a boolean so an admin can see the decision happened without the addresses entering evidence.
    const emailKeptExisting = Boolean(existingOwner?.email && existingOwner.email !== request.contactEmail);

    try {
      if (lineOa) await this.assertLineProvisionAuthorized(request);
      if (emailOtp && (!request.emailProofVerifiedAt || request.intakePolicyVersion !== 'EMAIL_SIGNUP_V1' || request.attachUserId)) {
        throw new ConflictException('email_signup_proof_required');
      }
      // Review MEDIUM-A: this id lands in two foreign keys to User, so an operator that cannot be
      // resolved has to fail here, by name, rather than at the constraint with a Prisma code.
      const operator = await this.resolveOperator(request, cmd);
      // Review HIGH-A: a previous attempt may have committed the company and died before the fence
      // caught up. `companyId` is stamped inside the onboarding transaction, so its presence here
      // means exactly that — re-running onboarding would try to create the owner's ExternalIdentity
      // a second time and fail on the unique constraint for as long as anyone kept retrying.
      const result = request.companyId
        ? await this.adoptExistingCompany(request.companyId, request)
        : await this.createCompany(request, cmd, lineOa, operator);

      // Owner 2026-09-05: one trial, one set of guards, whichever form the shop came in through.
      // This also repairs the term for a recovered shop, which is why adopting no longer writes
      // its own — there is exactly one writer of the trial's shape now.
      await this.applyTrialGuards(result.companyId, request, cmd.correlationRequestId);

      // Spec §3: the form's VAT answer is stored as company state only. No `VatFact` is written,
      // because the form never asked for an effectiveFrom and the fact would be a guess.
      if (request.vatRegistered !== null) {
        await this.prisma.client.company.update({
          where: { id: result.companyId },
          data: { vatRegistered: request.vatRegistered },
        });
      }

      await this.core.completeProvisioning({
        requestId: request.id,
        attemptId: claim.attemptId!,
        companyId: result.companyId,
        ownerUserId: result.ownerId,
        correlationRequestId: cmd.correlationRequestId,
      });

      await this.prisma.client.$transaction([
        // The hash has moved into UserCredential; the copy on the request is now a liability (§4B).
        this.prisma.client.companySignupRequest.update({
          where: { id: request.id },
          data: { pendingPasswordHash: null },
        }),
        this.prisma.client.auditLog.create({
          data: {
            // The operator of record, which for an AUTO_FREE close-out is the directory-resolved
            // one — `approvedByUserId` is null there by design, and left this row with no actor.
            actorUserId: operator.userId,
            companyId: result.companyId,
            action: 'signup.request.provisioned',
            targetType: 'company_signup_request',
            targetId: request.id,
            requestId: cmd.correlationRequestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            // Booleans and ids only — no email, company name or tax id in evidence.
            metadataJson: {
              companyId: result.companyId,
              ownerUserId: result.ownerId,
              attachedToExistingUser: result.attachedExistingOwner,
              emailKeptExisting,
              // Review MEDIUM-B: `actorUserId` above names a human. These three say whether that
              // human actually decided anything, or was named by the directory for a machine.
              source: request.source,
              autoApproved: request.autoApproved,
              operatorResolvedFromDirectory: operator.fromDirectory,
            },
          },
        }),
      ]);

      // Spec §4F: the LINE step lives on the success page and may be skipped, so the web-form
      // request parks at LINE_LINK_PENDING. A LINE application has nothing left to link — the
      // identity was created inside the company transaction — so it finishes (§5).
      await this.core.advance(request.id, lineOa || emailOtp ? 'COMPLETED' : 'LINE_LINK_PENDING', cmd.correlationRequestId);
      if (lineOa) await this.announceReady({ ...request, attachUserId: result.attachedExistingOwner ? request.attachUserId : null });

      return {
        companyId: result.companyId,
        companyName: request.companyName,
        attachedToExistingUser: result.attachedExistingOwner,
      };
    } catch (error) {
      // Release the fence so an admin retry can claim it again, then surface the original failure.
      // Review HIGH-C: `failProvisioning` asserts the attempt still holds the fence, and a failure
      // that happened AFTER the row moved on throws `provisioning_attempt_mismatch` from in here —
      // replacing the reason anyone is looking. The release is best-effort; the cause is not.
      try {
        await this.core.failProvisioning({
          requestId: request.id,
          attemptId: claim.attemptId!,
          failureCode: failureCodeOf(error),
          correlationRequestId: cmd.correlationRequestId,
        });
      } catch (releaseError) {
        new Logger(ProvisionSignupUseCase.name).error(
          `Fence release failed for signup ${request.id}: ${messageOf(releaseError)}`,
        );
      }
      // §15.6 (c): a shop that was told "we will open it" and was not. The customer is waiting and
      // the row needs a human, so this is the one failure class that must not stay in the logs.
      await this.opsAlerts.raise('provisioning_failed');
      throw error;
    }
  }

  /**
   * Review MEDIUM-A: explicit caller → the admin who approved → any active platform operator, and
   * an outright failure if none of the three answers. There is deliberately no fallback to the
   * request id: it is not a user id, and the columns it would land in are foreign keys to User.
   */
  private async resolveOperator(
    request: SignupRow,
    cmd: ProvisionSignupCommand,
  ): Promise<{ userId: string; fromDirectory: boolean }> {
    // Review LOW-1: asking "did I look it up?" here answered false on every real AUTO_FREE run,
    // because submit looks the operator up before calling. Only the caller knows where its actor
    // came from, so it says; a row approved by an admin named itself and is never from a directory.
    if (cmd.actorUserId) {
      return { userId: cmd.actorUserId, fromDirectory: cmd.operatorFromDirectory === true };
    }
    if (request.approvedByUserId) return { userId: request.approvedByUserId, fromDirectory: false };
    const [operator] = await this.adminDirectory.activeSystemAdmins();
    if (operator) return { userId: operator.userId, fromDirectory: true };
    throw new ConflictException('signup_operator_unresolved');
  }

  /** The last fence before a trial/company side effect: review intent and any repeat grant are durable. */
  private async assertLineProvisionAuthorized(request: SignupRow): Promise<void> {
    if (request.reviewResolution !== 'NEW_SHOP') {
      throw new ConflictException('line_signup_resolution_required');
    }
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: {
        provider: 'LINE',
        providerUserId: request.lineProviderUserId ?? '',
        providerChannelId: request.lineChannelId ?? '',
      },
      select: { userId: true, status: true, user: { select: { status: true } } },
    });
    if (identity?.status === 'DISABLED') throw new ConflictException('line_signup_identity_disabled');
    if (identity && identity.user.status !== 'ACTIVE') throw new ConflictException('line_signup_account_blocked');
    if (request.attachUserId && (!identity || identity.status !== 'ACTIVE' || identity.userId !== request.attachUserId)) {
      throw new ConflictException('line_signup_existing_account_proof_changed');
    }
    if (!request.attachUserId && identity?.status === 'ACTIVE') {
      const ownsCompanyCreatedByRequest = request.companyId
        ? await this.prisma.client.companyMembership.findFirst({
            where: {
              companyId: request.companyId,
              userId: identity.userId,
              status: 'ACTIVE',
              roles: { some: { role: { key: 'OWNER', status: 'ACTIVE' } } },
            },
            select: { id: true },
          })
        : null;
      if (request.ownerUserId !== identity.userId && !ownsCompanyCreatedByRequest) {
        throw new ConflictException('line_signup_existing_account_proof_changed');
      }
    }
    // Owner 2026-09-20 (R1): the repeat-trial fence used to stand here, refusing to provision an
    // applicant who already owns a shop unless an admin had granted a second free trial. Nothing
    // free is granted on approval any more — a second shop opens LOCKED like the first — so there
    // is no grant to require. An AUTO_FREE repeat applicant still routes to MANUAL review, which
    // is where a human looks at the pattern.
  }

  private createCompany(
    request: SignupRow,
    cmd: ProvisionSignupCommand,
    lineOa: boolean,
    operator: { userId: string; fromDirectory: boolean },
  ) {
    return this.onboarding.execute({
      companyName: request.companyName,
      // Legacy queued applications may have none. Adopting a committed company never rewrites
      // a later contact/account edit; the initial transaction adopts only an available address.
      ...(lineOa && request.contactEmail ? { companyContactEmail: request.contactEmail, unverifiedOwnerEmail: request.contactEmail } : {}),
      ...(request.taxId ? { taxId: request.taxId } : {}),
      ownerDisplayName: request.ownerDisplayName,
      ...(lineOa ? this.lineOwnerShape(request) : this.emailOwnerShape(request, cmd.username)),
      // Spec §4C: two shops may legitimately share a name; only the admin console keeps the guard.
      allowDuplicateCompanyName: true,
      // Owner decision (UAT round 1): a self-signed-up trial shop starts on the "เริ่มต้น" menu
      // preset; the admin can widen it later from the partner console.
      modulePackage: 'starter',
      // Review B-01: named HERE rather than upserted afterwards — onboarding creates the term
      // row, and a second `applyPlanTermPreset` against an existing row is a no-op.
      // Owner 2026-09-05 (review R02): ONE tier for both sources. The web form used to grant
      // PRO_999 while its own page advertised a free trial, so a self-signed-up shop opened with
      // 5 branches and 100 slips nobody had decided to give away.
      // Owner 2026-09-20 (R1): and ZERO days of it. The shop is opened locked and buys a package
      // before it can be used; `applyPlanTermPreset` takes 0 and writes `termEndsAt = termStartAt`.
      planTier: SIGNUP_TRIAL_TIER,
      planDays: SIGNUP_TERM_DAYS,
      requestingAdminUserId: operator.userId,
      // Closes the "company exists, nothing records which" window (review HIGH-A).
      linkSignupRequestId: request.id,
      provisioningContext: {
        source: request.source,
        autoApproved: request.autoApproved,
        operatorResolvedFromDirectory: operator.fromDirectory,
        // Committed with the new company; adopting a pre-existing shop never adds this marker.
        ...(lineOa ? { newShopWelcomeVersion: 1 as const } : {}),
      },
      requestId: cmd.correlationRequestId,
      webBaseUrl: cmd.webBaseUrl,
      apiBaseUrl: cmd.apiBaseUrl,
    });
  }

  /**
   * The recovery half of review HIGH-A. The company committed on an earlier attempt, so the only
   * thing left is to walk the fence forward over it. The owner is read back from the membership
   * onboarding created rather than re-derived, because that row IS what onboarding decided.
   */
  private async adoptExistingCompany(companyId: string, request: SignupRow) {
    const ownerUserId = request.ownerUserId ?? (await this.prisma.client.companyMembership.findFirst({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    }))?.userId;
    if (!ownerUserId) {
      // A company with no owner is not something to finish provisioning over.
      throw new ConflictException('signup_provisioned_company_has_no_owner');
    }
    // Review LOW-3 used to be answered here with a second plan-term writer for the web path only.
    // `applyTrialGuards` now runs on BOTH paths and its upsert creates the full trial term when the
    // row is missing, so a recovered shop is repaired by the one writer instead of two.
    return {
      companyId,
      ownerId: ownerUserId,
      attachedExistingOwner: request.attachUserId !== null,
    };
  }

  /**
   * P10-L §3.4/§7. The one push a new shop is owed, queued the moment the application reaches
   * COMPLETED — from EITHER path: the normal finish, and the close-out of a row a dead process
   * left stranded at READY. Both write the same outbox key, so a retry, a double-tapped approval
   * and a re-claimed fence between them still produce exactly one message.
   *
   * Queued, never sent here: this runs after the company exists, and a LINE outage must not fail a
   * provisioning that already succeeded.
   */
  private async announceReady(request: { id: string; attachUserId: string | null }): Promise<void> {
    await this.lineNotify.enqueue(request.id, request.attachUserId ? 'attached' : 'approved');
  }

  /**
   * Flow B. Review B-03: `contactEmail` is nullable now that a source without a mailbox exists, and
   * everything in this shape reads the address, so it is asserted once rather than defended per
   * field. An addressless row reaching here is a mis-routed source, not a customer problem.
   */
  private emailOwnerShape(request: SignupRow, username: string | undefined) {
    const contactEmail = request.contactEmail;
    if (!contactEmail) throw new ConflictException('signup_contact_email_missing');
    const attachUserId = request.attachUserId;
    return {
      ...(request.source === SIGNUP_SOURCE_EMAIL_OTP
        ? { ownerAuth: { kind: 'email' as const, verifiedAt: request.emailProofVerifiedAt! } }
        : { ownerUsername: username ?? suggestedUsernameFromEmail(contactEmail) ?? contactEmail }),
      claimedOwner: {
        email: contactEmail,
        ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
        ...(attachUserId ? { attachUserId } : {}),
        ...(!attachUserId && request.pendingPasswordHash ? { passwordHash: request.pendingPasswordHash } : {}),
      },
    };
  }

  /**
   * P10-L §6: no username or password. Email is adopted separately without claiming verification.
   * The verified LINE identity opens the account, and the LIFF clickwrap travels into the same transaction.
   */
  private lineOwnerShape(request: SignupRow) {
    if (!request.lineProviderUserId || !request.lineChannelId || !request.legalAcceptedAt) {
      // Submit writes identity and evidence together, so a row missing either is corrupt, not a
      // customer with a partial application — fail the fence rather than create half an account.
      throw new ConflictException('line_signup_evidence_missing');
    }
    const attachUserId = request.attachUserId;
    return {
      ownerAuth: {
        kind: 'line' as const,
        providerUserId: request.lineProviderUserId,
        channelId: request.lineChannelId,
        ...(request.lineDisplayName ? { displayName: request.lineDisplayName } : {}),
      },
      // Spec §5: this LINE account already owns a shop, so the new one joins that account.
      //
      // The phone travels on BOTH branches. It used to travel only on the attach one, so a
      // LINE-first owner's number lived on the application row and nowhere else: the profile page
      // and `GET /auth/account/security` read `User.phoneNumber` and saw nothing, the day-7 nudge
      // asked for a number the customer had already given, and the queue's duplicate hint (which
      // reads the same column) could never fire for a shop this flow opened.
      ...(attachUserId || request.phoneNumber
        ? {
            claimedOwner: {
              ...(request.phoneNumber ? { phoneNumber: request.phoneNumber } : {}),
              ...(attachUserId ? { attachUserId } : {}),
            },
          }
        : {}),
      legalAcceptance: {
        documentVersion: request.legalDocumentVersion ?? '',
        statementSha256: request.legalStatementSha256 ?? '',
        releaseFingerprintSha256: request.legalReleaseFingerprintSha256 ?? '',
        displayChallenge: request.legalDisplayChallenge ?? '',
        locale: request.legalLocale ?? 'th',
        userAgent: request.legalUserAgent,
        legalAcceptedAt: request.legalAcceptedAt,
      },
    };
  }

  /**
   * What a freshly provisioned shop needs beyond the company itself (spec §6, J1; review B-06).
   * All idempotent, so a provisioning retry re-applies the same values.
   *
   * Owner 2026-09-20 (R1): there is no free trial to set up any more. What is left is the zero-day
   * term, the lock that makes it real before anyone can use the shop, and `LineCompanyContext` —
   * which points a LINE conversation at a shop and is the one step that stays source-specific: a
   * web-form applicant has no LINE account yet, and its own `lineProviderUserId` says so.
   *
   * Every one of them runs AFTER the company transaction has committed, and each is guarded
   * separately: onboarding writes the plan term post-commit best-effort by its own design, so this
   * may legitimately arrive with no term row at all, and one write failing must neither roll back a
   * finished shop nor skip the others — the lock in particular is the money stop.
   */
  private async applyTrialGuards(companyId: string, request: SignupRow, requestId: string): Promise<void> {
    const now = new Date();

    // D6 (§17.1): attribution is copied here, at the one moment the shop comes into existence, so
    // `referredAt` is the shop's opening time — the anchor the 14-day counting window uses in
    // Phase 4. Best-effort like every other guard in this method: a shop must never fail to open
    // because an attribution row could not be written.
    if (request.referralSalesUserId) {
      const referralSalesUserId = request.referralSalesUserId;
      await this.bestEffort(companyId, requestId, 'sales_referral', request.source, () =>
        this.prisma.client.company.update({
          where: { id: companyId },
          data: { referralSalesUserId, referredAt: now, referralSource: 'SIGNUP_CODE' },
        }));
    }
    const preset = PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER];

    await this.bestEffort(companyId, requestId, 'plan_term_warmup', request.source, async () => {
      // Upsert, not update: the term row is written by onboarding after ITS transaction commits and
      // is explicitly allowed to be missing (a company with no term is unlimited, not broken), so
      // an update here would raise P2025 on a provisioning that has already created the shop.
      await this.prisma.client.companyPlanTerm.upsert({
        where: { companyId },
        create: {
          companyId,
          tierKey: SIGNUP_TRIAL_TIER,
          branchLimit: preset.branchLimit,
          employeeLimit: preset.employeeLimit,
          monthlySlipLimit: preset.monthlySlipLimit,
          termStartAt: now,
          // R1: same zero-day term onboarding was asked for, so the repair path and the happy path
          // open the same locked shop.
          termEndsAt: now,
        },
        // S23/review F9: writes NOTHING to a row that exists. Dates, tier and warm-up are all left
        // as whoever wrote them left them, so this can neither shorten a term nor re-cap a shop —
        // which is what keeps a shop already running the old 30-day trial untouched by a retry.
        update: {},
      });
    });

    await this.bestEffort(companyId, requestId, 'no_package_lock', request.source, () =>
      this.lockUntilPackageBought(companyId, requestId, now));

    // Owner 2026-09-20 (R1): the trial AI budget upsert used to sit here. A shop that cannot talk
    // to the assistant until it has a package spends nothing, so there is no cap to pre-set; the
    // governed writer (`set-partner-ai-model`) stays the one way a budget comes into being.

    // Review B-06: an owner with a second shop otherwise meets a company picker instead of the shop
    // they just opened. Same upsert the LINE link use-case does when it resolves a company.
    if (request.lineProviderUserId) {
      const lineUserId = request.lineProviderUserId;
      await this.bestEffort(companyId, requestId, 'line_company_context', request.source, () =>
        this.prisma.client.lineCompanyContext.upsert({
          where: { lineUserId },
          create: { lineUserId, companyId, selectedAt: now },
          // `aiPausedUntil` is cleared, never carried (review N4). It is the §8 "ติดต่อเจ้าหน้าที่"
          // hold on ONE conversation about ONE shop; a re-pointed LINE account opening a new shop
          // would otherwise start it with the previous owner's assistant switched off, silently,
          // until a timestamp nobody can see expires.
          update: { companyId, selectedAt: now, aiPausedUntil: null },
        }),
      );
    }
  }

  /**
   * J1/S02: a shop with no package is DISABLED the moment it opens, not in up to five minutes when
   * the sweep next runs. That window is long enough for the LINE assistant to answer a shop that
   * has never paid, and the sweep would then also send it the "ครบกำหนด" notice it never earned —
   * which is why `expiredNotifiedAt` is stamped here with the disable rather than left for it.
   *
   * Everything is re-read inside the company lock rather than trusted from the upsert above: S23
   * says a shop already running a term (the old 30-day trial, or a package it bought) must be left
   * exactly alone, and `planTermLockReason` — the same rule the notice, billing status and the LINE
   * card read — is what tells the two apart. Idempotent: a retry finds a DISABLED company and
   * writes nothing.
   */
  private async lockUntilPackageBought(companyId: string, requestId: string, now: Date): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await lockPlanTermCompany(tx, companyId);
      const term = await tx.companyPlanTerm.findUnique({
        where: { companyId },
        select: { termStartAt: true, termEndsAt: true, renewCount: true, company: { select: { status: true } } },
      });
      if (!term || term.company.status !== 'ACTIVE' || planTermLockReason(term) !== 'no_package') return;
      await this.lifecycle.execute({
        companyId,
        targetStatus: 'DISABLED',
        reason: 'no_package',
        // No human pulled this lever, same as the term-expiry sweep — and a null actor is also what
        // keeps the lifecycle writer from clearing `termDisabledAt` as an admin disable would.
        requestingAdminUserId: null,
        requestId,
      }, tx);
      await tx.companyPlanTerm.update({
        where: { companyId },
        data: { termDisabledAt: now, expiredNotifiedAt: now },
      });
    });
  }

  /**
   * The company exists by the time these run, so nothing here may turn a finished shop into a 500.
   * A failure is recorded as evidence an operator can act on and then swallowed — the same posture
   * onboarding takes for its own post-commit term write.
   */
  private async bestEffort(
    companyId: string,
    requestId: string,
    step: string,
    /** Which form the shop came in through, now that these guards serve both (Owner 2026-09-05). */
    source: string,
    write: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            companyId,
            // The name predates these guards serving both sources. Left alone because it is a
            // searchable audit fact in live logs; `source` in the metadata says which flow it was.
            action: 'signup.line.trial_guards_failed',
            targetType: 'company_signup_request',
            targetId: requestId,
            requestId,
            result: 'FAILED',
            riskLevel: 'HIGH',
            metadataJson: { step, source, error: error instanceof Error ? error.message : String(error) },
          },
        });
      } catch {
        new Logger(ProvisionSignupUseCase.name).error(
          `Trial guard "${step}" not applied for company ${companyId}; check the plan term and AI budget by hand.`,
        );
      }
    }
  }
}

/**
 * Owner 2026-09-20 (spec R1/J1): there is no free trial for a new shop any more. A zero-day term
 * is what `planTermLockReason` reads as `no_package`, and what `lockUntilPackageBought` below
 * turns into a real DISABLED company before the first LINE message can arrive.
 */
const SIGNUP_TERM_DAYS = 0;
/**
 * Owner 2026-09-05 (review R02): ONE trial preset for every shop this flow opens, whichever form
 * it came in through. The definition lives in contracts (review F1) so the page that advertises
 * the trial and the code that grants it read the same key.
 */
const SIGNUP_TRIAL_TIER = SIGNUP_TRIAL_TIER_KEY;

/** The subset of `CompanySignupRequest` provisioning reads. */
type SignupRow = {
  emailProofVerifiedAt?: Date | null;
  id: string;
  state: string;
  source: string;
  autoApproved: boolean;
  approvedByUserId: string | null;
  reviewResolution: string | null;
  resolvedExistingCompanyId: string | null;
  repeatTrialGrantedAt: Date | null;
  companyId: string | null;
  ownerUserId: string | null;
  companyName: string;
  ownerDisplayName: string;
  businessType: string | null;
  taxId: string | null;
  contactEmail: string | null;
  phoneNumber: string | null;
  attachUserId: string | null;
  pendingPasswordHash: string | null;
  lineProviderUserId: string | null;
  lineChannelId: string | null;
  lineDisplayName: string | null;
  legalDocumentVersion: string | null;
  legalStatementSha256: string | null;
  legalReleaseFingerprintSha256: string | null;
  legalDisplayChallenge: string | null;
  legalLocale: string | null;
  legalUserAgent: string | null;
  legalAcceptedAt: Date | null;
  /** D6: resolved at submit; copied onto the Company the moment the shop exists. */
  referralSalesUserId?: string | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureCodeOf(error: unknown): string {
  return messageOf(error).toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 64) || 'provisioning_failed';
}
