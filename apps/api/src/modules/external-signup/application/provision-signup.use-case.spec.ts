import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';

const REQUEST = {
  id: 'signup-1',
  state: 'EMAIL_VERIFIED',
  companyName: 'ร้านมั่งมี',
  ownerDisplayName: 'สมชาย ใจดี',
  contactEmail: 'somchai@example.com',
  phoneNumber: '0982565628',
  businessType: 'ร้านค้าปลีก',
  vatRegistered: true,
  taxId: '0105555000012',
  pendingPasswordHash: 'scrypt$salt$hash',
  attachUserId: null as string | null,
  approvedByUserId: 'admin-1' as string | null,
  autoApproved: false,
  source: 'official-site',
  companyId: null as string | null,
  ownerUserId: null as string | null,
  reviewResolution: null as string | null,
  resolvedExistingCompanyId: null as string | null,
  repeatTrialGrantedAt: null as Date | null,
};

/** The no-package lock writes its own CRITICAL audit before this one, so the provisioning
 *  evidence row is found by its action rather than by position (J1). */
const provisionedAudit = (audits: any[]) =>
  audits.find((entry) => entry.data.action === 'signup.request.provisioned')!.data;

const CMD = {
  requestId: 'signup-1',
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

function harness(options: {
  request?: any;
  claimed?: boolean;
  existingOwnerEmail?: string | null;
  onboardingFails?: Error;
  /** Empty = an installation with no platform operator at all. */
  systemAdmins?: Array<{ companyId: string; userId: string }>;
  /** §15.6 (c): the core reports a fence taken from an abandoned attempt. */
  reclaimedStale?: boolean;
  priorCompanyCount?: number;
  /** S23: the term row the no-package lock reads back. `undefined` = the zero-day row provisioning
   *  just wrote; anything else is a shop that already had a term and must be left alone. */
  existingTerm?: { termStartAt: Date; termEndsAt: Date; renewCount: number } | null;
  /** What the lock finds the company at — DISABLED is a retry over an already-locked shop. */
  companyStatus?: 'ACTIVE' | 'DISABLED';
} = {}) {
  const onboardingCalls: any[] = [];
  const companyUpdates: any[] = [];
  const requestUpdates: any[] = [];
  const audits: any[] = [];
  const advances: any[] = [];
  const completed: any[] = [];
  const failures: any[] = [];
  const planTermUpserts: any[] = [];
  const planTermUpdates: any[] = [];
  /** F9: the conditional "stamp only if never stamped" writes, which a retry must not repeat. */
  const planTermStamps: any[] = [];
  const aiConfigUpserts: any[] = [];
  const aiConfigStamps: any[] = [];
  const aiConfigGuardProbes: any[] = [];
  const lineContexts: any[] = [];
  /** J1: what the no-package lock wrote — the company status flip and the term stamps. */
  const lifecycleWrites: any[] = [];
  const termLockWrites: any[] = [];

  const request = { ...REQUEST, ...(options.request ?? {}) };
  const provisionedAt = new Date();
  const lockedTerm = options.existingTerm === undefined
    ? { termStartAt: provisionedAt, termEndsAt: provisionedAt, renewCount: 0 }
    : options.existingTerm;
  const companyStatus = options.companyStatus ?? 'ACTIVE';
  // The transaction the lock opens: `lockPlanTermCompany` plus everything the real
  // `PartnerLifecycleTransitionUseCase` touches, so the spec drives the actual writer.
  const lockTx = {
    $queryRaw: async () => [],
    companyPlanTerm: {
      findUnique: async () => lockedTerm && { ...lockedTerm, company: { status: companyStatus } },
      update: async (args: any) => { termLockWrites.push(args); return {}; },
      updateMany: async (args: any) => { planTermStamps.push(args); return { count: 1 }; },
    },
    company: {
      findUnique: async () => ({ id: 'co-1', status: companyStatus, activatedAt: null, disabledAt: null, archivedAt: null }),
      update: async (args: any) => {
        lifecycleWrites.push(args);
        return { id: 'co-1', status: args.data.status, activatedAt: null, disabledAt: args.data.disabledAt ?? null, archivedAt: null };
      },
    },
    auditLog: { create: (args: any) => { audits.push(args); return Promise.resolve({}); } },
  } as any;

  const prisma = {
    client: {
      user: { findUnique: async () => (options.existingOwnerEmail === undefined ? null : { email: options.existingOwnerEmail }) },
      externalIdentity: {
        findFirst: async () => request.source === 'line-oa' && request.attachUserId
          ? { userId: request.attachUserId, status: 'ACTIVE', user: { status: 'ACTIVE' } }
          : null,
      },
      companyMembership: {
        count: async () => options.priorCompanyCount ?? 0,
        findFirst: async () => request.companyId && request.ownerUserId
          ? { id: 'membership-created-by-request' }
          : null,
      },
      company: { update: async (args: any) => { companyUpdates.push(args); return {}; } },
      companyPlanTerm: {
        upsert: async (args: any) => { planTermUpserts.push(args); return {}; },
        update: async (args: any) => { planTermUpdates.push(args); return {}; },
        updateMany: async (args: any) => { planTermStamps.push(args); return { count: 1 }; },
      },
      companyAiConfiguration: {
        upsert: async (args: any) => { aiConfigUpserts.push(args); return {}; },
        // Kept so a regression that starts writing an AI budget again is RECORDED, not thrown.
        updateMany: async (args: any) => { aiConfigStamps.push(args); return { count: 1 }; },
        count: async (args: any) => { aiConfigGuardProbes.push(args); return 0; },
      },
      lineCompanyContext: { upsert: async (args: any) => { lineContexts.push(args); return {}; } },
      companySignupRequest: { update: (args: any) => { requestUpdates.push(args); return Promise.resolve({}); } },
      auditLog: { create: (args: any) => { audits.push(args); return Promise.resolve({}); } },
      $transaction: async (work: any) => (typeof work === 'function' ? work(lockTx) : Promise.all(work)),
    },
  } as any;

  const core = {
    claimProvisioning: async () => ({
      request, claimed: options.claimed ?? true, attemptId: options.claimed === false ? null : 'attempt-1',
      // §15.6 (c): the core reports when the claim took the fence from an abandoned attempt.
      ...(options.reclaimedStale ? { reclaimedStale: true } : {}),
    }),
    completeProvisioning: async (input: any) => { completed.push(input); return {}; },
    failProvisioning: async (input: any) => { failures.push(input); return {}; },
    advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; },
  } as any;

  const onboarding = {
    execute: async (cmd: any) => {
      onboardingCalls.push(cmd);
      if (options.onboardingFails) throw options.onboardingFails;
      return {
        companyId: 'co-1',
        ownerId: 'user-1',
        attachedExistingOwner: cmd.claimedOwner?.attachUserId !== undefined,
      };
    },
  } as any;

  const config = { lineSignupWarmupSlips: 10, lineFreeAiBudgetSatang: 8000 } as any;
  const adminDirectory = {
    activeSystemAdmins: async () => (options.systemAdmins ?? [{ companyId: 'sys', userId: 'sysadmin-1' }]),
  } as any;

  // P10-L: the "your shop is ready" push is QUEUED here, so the spec records keys rather than sends.
  const linePushes: Array<{ id: string; kind: string }> = [];
  const lineNotify = { enqueue: async (id: string, kind: string) => { linePushes.push({ id, kind }); } } as any;

  // §15.6: an ops alert is raised on a failed or re-claimed provisioning; recorded, never sent.
  const alerts: string[] = [];
  const opsAlerts = { raise: async (kind: string) => { alerts.push(kind); } } as any;

  return {
    useCase: new ProvisionSignupUseCase(prisma, core, onboarding, config, adminDirectory, lineNotify, opsAlerts,
      new PartnerLifecycleTransitionUseCase(prisma)),
    onboardingCalls, companyUpdates, requestUpdates, audits, advances, completed, failures, planTermUpserts,
    planTermUpdates, planTermStamps, aiConfigUpserts, aiConfigStamps, aiConfigGuardProbes, lineContexts, linePushes, alerts,
    lifecycleWrites, termLockWrites,
  };
}

describe('provisioning opens the shop LOCKED (R1/J1, Owner 2026-09-20)', () => {
  it('names a zero-day term on the onboarding command, not a 30-day trial', async () => {
    const h = harness();
    await h.useCase.execute(CMD);
    // Review B-01: onboarding is TOLD the tier rather than having one upserted over it afterwards,
    // because an upsert against an existing row cannot change a tier that is already wrong.
    assert.equal(h.onboardingCalls[0].planTier, 'FREE_TRIAL_15');
    assert.equal(h.onboardingCalls[0].planDays, 0, 'R1: no free days for a new shop');
    // The repair upsert that follows opens the same zero-day term, so a recovered shop and a
    // happy-path shop are locked for the same reason.
    assert.equal(h.planTermUpserts.length, 1);
    assert.equal(h.planTermUpserts[0].create.tierKey, 'FREE_TRIAL_15');
    assert.equal(
      h.planTermUpserts[0].create.termEndsAt.getTime(),
      h.planTermUpserts[0].create.termStartAt.getTime(),
    );
    // S23/F9: the upsert writes NOTHING to a row that exists, so it can neither shorten a term nor
    // contradict what onboarding wrote.
    assert.deepEqual(h.planTermUpserts[0].update, {});
  });

  it('disables the company as no_package and stamps the expiry notice as already sent', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    // S02: DISABLED now, not in up to five minutes when the sweep next runs \u2014 that window is long
    // enough for the LINE assistant to answer a shop that has never paid.
    assert.equal(h.lifecycleWrites.length, 1);
    assert.equal(h.lifecycleWrites[0].data.status, 'DISABLED');
    assert.ok(h.lifecycleWrites[0].data.disabledAt instanceof Date);

    const transition = h.audits.find((entry: any) => entry.data.action === 'system.partner_company.lifecycle.transition');
    assert.ok(transition, 'the lifecycle writer owns the audit');
    assert.equal(transition.data.metadataJson.reason, 'no_package');
    assert.equal(transition.data.actorUserId, null, 'no human pulled this lever');
    assert.equal(transition.data.metadataJson.toStatus, 'DISABLED');

    assert.equal(h.termLockWrites.length, 1);
    assert.ok(h.termLockWrites[0].data.termDisabledAt instanceof Date, 'what makes a purchase re-enable the shop');
    // The "\u0e04\u0e23\u0e1a\u0e01\u0e33\u0e2b\u0e19\u0e14" notice is for a term that RAN OUT. Stamping it here is what keeps
    // the sweep from telling a brand-new shop it lost something it never had.
    assert.ok(h.termLockWrites[0].data.expiredNotifiedAt instanceof Date);
  });

  it('sets up nothing a trial used to need: no warm-up stamp, no AI budget row', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    // A shop that cannot talk to the assistant until it has a package spends nothing, so there is
    // no cap to pre-set and no first-week receipt ceiling to write.
    assert.deepEqual(h.planTermStamps, []);
    assert.deepEqual(h.aiConfigUpserts, []);
    assert.deepEqual(h.aiConfigStamps, []);
  });

  /**
   * S23, the one thing this change must not break: a shop that is ALREADY running a term \u2014 the old
   * 30-day trial, or a package it paid for \u2014 must come out of a provisioning retry untouched.
   */
  it('never locks or shortens a shop that already has a running term (S23)', async () => {
    const running = new Date(Date.now() + 20 * 24 * 3600_000);
    const h = harness({ existingTerm: { termStartAt: new Date(Date.now() - 10 * 24 * 3600_000), termEndsAt: running, renewCount: 0 } });
    await h.useCase.execute(CMD);

    assert.deepEqual(h.planTermUpserts[0].update, {}, 'the upsert leaves the existing row alone');
    assert.deepEqual(h.lifecycleWrites, [], 'a running trial is not a no-package shop');
    assert.deepEqual(h.termLockWrites, []);
  });

  it('is idempotent: a retry over an already-locked shop writes nothing', async () => {
    const h = harness({ companyStatus: 'DISABLED' });
    await h.useCase.execute(CMD);

    assert.deepEqual(h.lifecycleWrites, []);
    assert.deepEqual(h.termLockWrites, []);
  });

  it('a renewed term is never re-locked even though the row is the one provisioning wrote', async () => {
    // `renewCount > 0` is what separates a shop that came back from one that never started, even
    // when an admin's renew left `termEndsAt` in the past.
    const past = new Date(Date.now() - 1000);
    const h = harness({ existingTerm: { termStartAt: past, termEndsAt: past, renewCount: 2 } });
    await h.useCase.execute(CMD);

    assert.deepEqual(h.lifecycleWrites, []);
  });

  it('keeps the genuinely LINE-only guard off a web-form shop', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    // LineCompanyContext points a LINE conversation at a shop. A web-form applicant has no LINE
    // account yet \u2014 the welcome page's link step is where that arrives.
    assert.deepEqual(h.lineContexts, []);
    assert.deepEqual(h.linePushes, []);
  });

  it('opens the same locked shop whichever form it came in through', async () => {
    const web = harness();
    await web.useCase.execute(CMD);
    const line = harness({ request: LINE_REQUEST });
    await line.useCase.execute(CMD);

    const shape = (upsert: any) => ({ ...upsert.create, termStartAt: undefined, termEndsAt: undefined, update: upsert.update });
    assert.deepEqual(shape(web.planTermUpserts[0]), shape(line.planTermUpserts[0]));
    assert.equal(web.lifecycleWrites[0].data.status, line.lifecycleWrites[0].data.status);
  });
});

describe('ProvisionSignupUseCase — new-user path', () => {
  it('provisions through the onboarding service with the self-chosen password', async () => {
    const h = harness();
    const result = await h.useCase.execute({ ...CMD, username: 'somchai' });

    assert.deepEqual(result, { companyId: 'co-1', companyName: 'ร้านมั่งมี', attachedToExistingUser: false });
    const cmd = h.onboardingCalls[0];
    assert.equal(cmd.ownerUsername, 'somchai');
    assert.equal('businessCategory' in cmd, false);
    assert.equal(cmd.claimedOwner.email, 'somchai@example.com');
    assert.equal(cmd.claimedOwner.passwordHash, 'scrypt$salt$hash');
    assert.equal(cmd.claimedOwner.attachUserId, undefined);
    assert.equal(cmd.claimedOwner.phoneNumber, '0982565628');
    // Spec §4C: duplicate shop names are legal on this path.
    assert.equal(cmd.allowDuplicateCompanyName, true);
    // Spec §3: the VAT answer is state only — no effectiveFrom means no VatFact.
    assert.equal(cmd.vatRegistration, undefined);
    assert.equal(h.companyUpdates[0].data.vatRegistered, true);
  });

  it('falls back to the email local part when no username survives a retry', async () => {
    const h = harness();
    await h.useCase.execute(CMD);
    assert.equal(h.onboardingCalls[0].ownerUsername, 'somchai');
  });

  it('completes the fence, wipes the hash, and parks at the LINE step', async () => {
    const h = harness();
    await h.useCase.execute({ ...CMD, username: 'somchai' });

    assert.deepEqual(h.completed[0], {
      requestId: 'signup-1', attemptId: 'attempt-1', companyId: 'co-1',
      ownerUserId: 'user-1', correlationRequestId: 'req-1',
    });
    assert.equal(h.requestUpdates.at(-1)!.data.pendingPasswordHash, null);
    // Spec §4F: the LINE step is on the success page and skippable, so it parks here.
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'LINE_LINK_PENDING' }]);
  });

  it('records HIGH evidence with no applicant PII', async () => {
    const h = harness();
    await h.useCase.execute({ ...CMD, username: 'somchai' });

    const audit = provisionedAudit(h.audits);
    assert.equal(audit.action, 'signup.request.provisioned');
    assert.equal(audit.riskLevel, 'HIGH');
    assert.deepEqual(audit.metadataJson, {
      companyId: 'co-1', ownerUserId: 'user-1', attachedToExistingUser: false, emailKeptExisting: false,
      // Review MEDIUM-B: still ids and booleans only, now including what decided this.
      source: 'official-site', autoApproved: false, operatorResolvedFromDirectory: false,
    });
    const evidence = JSON.stringify(h.audits);
    for (const pii of ['somchai@example.com', 'ร้านมั่งมี', '0105555000012', 'scrypt$']) {
      assert.equal(evidence.includes(pii), false, `audit leaked ${pii}`);
    }
  });
});

describe('ProvisionSignupUseCase — attach path', () => {
  it('attaches by id and sends no password hash', async () => {
    const h = harness({
      request: { attachUserId: 'user-9', pendingPasswordHash: null },
      existingOwnerEmail: null,
    });
    const result = await h.useCase.execute(CMD);

    const cmd = h.onboardingCalls[0];
    assert.equal(cmd.claimedOwner.attachUserId, 'user-9');
    assert.equal(cmd.claimedOwner.passwordHash, undefined, 'attach never sets a password');
    assert.equal(result.attachedToExistingUser, true);
    assert.equal(provisionedAudit(h.audits).metadataJson.emailKeptExisting, false);
  });

  it('records that an existing different address was kept', async () => {
    const h = harness({
      request: { attachUserId: 'user-9', pendingPasswordHash: null },
      existingOwnerEmail: 'other@example.com',
    });
    await h.useCase.execute(CMD);
    assert.equal(provisionedAudit(h.audits).metadataJson.emailKeptExisting, true);
  });

  it('does not flag a keep when the existing address is the same one', async () => {
    const h = harness({
      request: { attachUserId: 'user-9', pendingPasswordHash: null },
      existingOwnerEmail: 'somchai@example.com',
    });
    await h.useCase.execute(CMD);
    assert.equal(provisionedAudit(h.audits).metadataJson.emailKeptExisting, false);
  });
});

describe('ProvisionSignupUseCase — contactEmail is nullable now (review B-03)', () => {
  it('refuses the email-owner shape rather than provisioning a company with a null address', async () => {
    const h = harness({ request: { contactEmail: null } });
    await assert.rejects(() => h.useCase.execute(CMD), /signup_contact_email_missing/);
    assert.equal(h.onboardingCalls.length, 0);
    // The fence is released, so an admin who fixes the row can retry the same application.
    assert.equal(h.failures.length, 1);
  });
});

// P10-L §6. A LINE application creates a shop with NO username, NO email and NO credential; the
// verified LINE identity is the account, and the clickwrap the owner gave on LIFF rides along.
const LINE_REQUEST = {
  source: 'line-oa',
  reviewResolution: 'NEW_SHOP',
  contactEmail: null,
  pendingPasswordHash: null,
  taxId: null,
  vatRegistered: null,
  lineProviderUserId: 'Uline-1',
  lineChannelId: 'channel-1',
  lineDisplayName: 'นิด',
  legalDocumentVersion: 'v3',
  legalStatementSha256: 'a'.repeat(64),
  legalReleaseFingerprintSha256: 'b'.repeat(64),
  legalDisplayChallenge: 'c'.repeat(64),
  legalLocale: 'th',
  legalUserAgent: 'LINE/14 iOS',
  legalAcceptedAt: new Date('2026-09-04T03:21:00.000Z'),
};

describe('ProvisionSignupUseCase — LINE-first source', () => {
  it('carries shop contact separately for both new and attached LINE owners, while allowing legacy null', async () => {
    for (const attachUserId of [null, 'user-9']) {
      const h = harness({ request: { ...LINE_REQUEST, attachUserId, contactEmail: 'shop@example.test' }, existingOwnerEmail: 'login@example.test' });
      await h.useCase.execute(CMD);
      const cmd = h.onboardingCalls[0];
      assert.equal(cmd.companyContactEmail, 'shop@example.test');
      assert.equal(cmd.unverifiedOwnerEmail, 'shop@example.test');
      assert.equal(cmd.claimedOwner?.email, undefined);
      assert.equal(cmd.claimedOwner?.attachUserId ?? null, attachUserId);
      assert.equal(cmd.ownerAuth.kind, 'line');
    }
    const legacy = harness({ request: LINE_REQUEST });
    await legacy.useCase.execute(CMD);
    assert.equal(legacy.onboardingCalls[0].companyContactEmail, undefined);
  });

  it('hands onboarding the LINE owner shape and the zero-day preset', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.execute(CMD);

    const cmd = h.onboardingCalls[0];
    assert.deepEqual(cmd.ownerAuth, {
      kind: 'line', providerUserId: 'Uline-1', channelId: 'channel-1', displayName: 'นิด',
    });
    assert.equal(cmd.ownerUsername, undefined, 'no username exists for a LINE-first owner');
    // The owner payload carries the phone and NOTHING else: no address, no password, no attach —
    // those are the email-owner shape, and this owner has none of them.
    assert.deepEqual(cmd.claimedOwner, { phoneNumber: '0982565628' });
    assert.equal(cmd.planTier, 'FREE_TRIAL_15');
    assert.equal(cmd.planDays, 0);
    // Spec §6: the acceptance time is the one from the application, not the provisioning clock.
    assert.equal(cmd.legalAcceptance.legalAcceptedAt.toISOString(), '2026-09-04T03:21:00.000Z');
    assert.equal(cmd.legalAcceptance.displayChallenge, 'c'.repeat(64));
  });

  it('locks the shop and points the LINE conversation at it', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.execute(CMD);

    // Upserted rather than updated (review HIGH-3): onboarding writes the term post-commit
    // best-effort, so it may not be there, and a bare update would raise P2025 on a shop that
    // already exists. The create side repairs the same zero-day term onboarding was asked for.
    const term = h.planTermUpserts[0];
    assert.equal(term.where.companyId, 'co-1');
    assert.equal(term.create.tierKey, 'FREE_TRIAL_15');
    assert.equal(term.create.monthlySlipLimit, 15);
    assert.equal(term.create.termEndsAt.getTime(), term.create.termStartAt.getTime());
    // J1: and the shop is LOCKED before the LINE conversation is pointed at it.
    assert.equal(h.lifecycleWrites[0].data.status, 'DISABLED');
    // Review B-06: the first receipt must land in the shop just opened, not in a company picker.
    assert.equal(h.lineContexts[0].where.lineUserId, 'Uline-1');
    assert.equal(h.lineContexts[0].create.companyId, 'co-1');
    assert.equal(h.lineContexts[0].update.companyId, 'co-1');
    // Review N4: the row survives a re-pointed LINE account, and `aiPausedUntil` on it is the §8
    // "ติดต่อเจ้าหน้าที่" hold on the PREVIOUS owner's conversation. Inheriting it would open the
    // new shop with the assistant silently switched off until a timestamp nobody can see expires.
    assert.equal(h.lineContexts[0].update.aiPausedUntil, null);
  });

  it('finishes at COMPLETED instead of parking at the LINE link step', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.execute(CMD);
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'COMPLETED' }]);
  });

  it('opens a second shop on the same account when the LINE user already owns one', async () => {
    const h = harness({ request: { ...LINE_REQUEST, attachUserId: 'user-9' }, existingOwnerEmail: null });
    const result = await h.useCase.execute(CMD);

    assert.equal(h.onboardingCalls[0].claimedOwner.attachUserId, 'user-9');
    assert.equal(h.onboardingCalls[0].claimedOwner.email, undefined, 'attach by identity, not address');
    assert.equal(result.attachedToExistingUser, true);
  });

  it('fails the fence rather than creating half an account from a corrupt row', async () => {
    for (const missing of [{ lineProviderUserId: null }, { lineChannelId: null }, { legalAcceptedAt: null }]) {
      const h = harness({ request: { ...LINE_REQUEST, ...missing } });
      await assert.rejects(() => h.useCase.execute(CMD), /line_signup_evidence_missing/);
      assert.equal(h.onboardingCalls.length, 0);
    }
  });
});

// Review MEDIUM-A: this id lands in two foreign keys to User. The request id was never a valid
// answer, and the claim path (which passes no actor) is how a Flow B row reaches here without one.
describe('ProvisionSignupUseCase — who counts as the operator', () => {
  it('prefers an explicit caller, then the approving admin, then any platform operator', async () => {
    const explicit = harness({ request: { approvedByUserId: 'admin-1' } });
    await explicit.useCase.execute({ ...CMD, actorUserId: 'caller-1' });
    assert.equal(explicit.onboardingCalls[0].requestingAdminUserId, 'caller-1');

    const approved = harness({ request: { approvedByUserId: 'admin-1' } });
    await approved.useCase.execute(CMD);
    assert.equal(approved.onboardingCalls[0].requestingAdminUserId, 'admin-1');

    // The claim path passes no actor, and a row whose approval stamp never landed has none either.
    const directory = harness({ request: { approvedByUserId: null } });
    await directory.useCase.execute(CMD);
    assert.equal(directory.onboardingCalls[0].requestingAdminUserId, 'sysadmin-1');
    assert.equal(directory.onboardingCalls[0].provisioningContext.operatorResolvedFromDirectory, true);
  });

  it('refuses by name instead of letting a foreign key reject the request id', async () => {
    const h = harness({ request: { approvedByUserId: null }, systemAdmins: [] });
    await assert.rejects(() => h.useCase.execute(CMD), /signup_operator_unresolved/);
    assert.equal(h.onboardingCalls.length, 0);
    // Never the request id: it is not a user id and the columns it lands in are FKs to User.
    assert.equal(JSON.stringify(h.onboardingCalls).includes('signup-1'), false);
  });

  // Review MEDIUM-B: `actorUserId` on the audit names a human. Without these three, the company's
  // own trail says that human created an auto-approved shop and nothing points at the machine.
  it('records what actually decided the shop should exist', async () => {
    const h = harness({ request: { ...LINE_REQUEST, approvedByUserId: null, autoApproved: true } });
    await h.useCase.execute(CMD);

    const metadata = provisionedAudit(h.audits).metadataJson;
    assert.equal(metadata.source, 'line-oa');
    assert.equal(metadata.autoApproved, true);
    assert.equal(metadata.operatorResolvedFromDirectory, true);
    // Onboarding's own audit carries the same three, so the company-side trail is not blind.
    assert.deepEqual(h.onboardingCalls[0].provisioningContext, {
      source: 'line-oa', autoApproved: true, operatorResolvedFromDirectory: true, newShopWelcomeVersion: 1,
    });
  });
});

// Review LOW-3: the adopt path skips onboarding, and onboarding is where the plan term is written.
// A recovered web shop with no CompanyPlanTerm reads as unlimited, not as a locked shop.
describe('ProvisionSignupUseCase — recovering an already-created company', () => {
  it('gives a recovered web shop the term onboarding would have written', async () => {
    const h = harness({ request: { companyId: 'co-1', ownerUserId: 'user-1' } });
    await h.useCase.execute(CMD);

    assert.equal(h.onboardingCalls.length, 0, 'the company already exists');
    // Owner 2026-09-05: one writer for the trial's shape, so the recovered shop is repaired by the
    // same guard upsert both sources use rather than by a second web-only preset call.
    assert.equal(h.planTermUpserts.length, 1);
    assert.equal(h.planTermUpserts[0].create.tierKey, 'FREE_TRIAL_15');
    assert.equal(h.planTermUpserts[0].create.monthlySlipLimit, 15);
    // Idempotent: a term the admin already set keeps its tier and its dates through a retry.
    assert.deepEqual(h.planTermUpserts[0].update, {});
    // And the recovered shop is locked like every other new shop.
    assert.equal(h.lifecycleWrites[0].data.status, 'DISABLED');
  });

  it('leaves a recovered LINE shop to its own post-commit guards', async () => {
    const h = harness({ request: { ...LINE_REQUEST, companyId: 'co-1', ownerUserId: 'user-1' } });
    await h.useCase.execute(CMD);

    // The post-commit guards upsert FREE_TRIAL_15 themselves; a second preset here would race them.
    assert.equal(h.planTermUpserts.length, 1);
    assert.equal(h.planTermUpserts[0].create.tierKey, 'FREE_TRIAL_15');
    assert.equal(h.onboardingCalls.length, 0, 'adoption cannot add the welcome creation marker');
  });
});

describe('P10-L: the one push a new shop is owed (§3.4/§7)', () => {
  it('queues it on the normal finish, and names the attach case correctly', async () => {
    const fresh = harness({ request: LINE_REQUEST });
    await fresh.useCase.execute(CMD);
    assert.deepEqual(fresh.linePushes, [{ id: 'signup-1', kind: 'approved' }]);

    const second = harness({ request: { ...LINE_REQUEST, attachUserId: 'user-9' } });
    await second.useCase.execute(CMD);
    assert.deepEqual(second.linePushes, [{ id: 'signup-1', kind: 'attached' }]);
  });

  it('queues it from the stranded-row close-out too, so a dead process costs nobody their message', async () => {
    // The fence lost its holder between completeProvisioning and the final advance. Closing the row
    // finishes the hop AND owes the same message — under the same outbox key, so the two paths
    // together still deliver exactly one.
    const h = harness({ claimed: false, request: { ...LINE_REQUEST, companyId: 'co-1', state: 'READY' } });
    await h.useCase.execute(CMD);

    assert.equal(h.onboardingCalls.length, 0, 'no second company');
    assert.deepEqual(h.advances.at(-1), { id: 'signup-1', state: 'COMPLETED' });
    assert.deepEqual(h.linePushes, [{ id: 'signup-1', kind: 'approved' }]);
  });

  it('stays silent for a web application, which has an email rail of its own', async () => {
    const h = harness();
    await h.useCase.execute(CMD);
    assert.deepEqual(h.linePushes, []);
    assert.equal(h.onboardingCalls[0].provisioningContext.newShopWelcomeVersion, undefined);
  });
});

describe('ProvisionSignupUseCase — fencing', () => {
  it('reads back the winner instead of provisioning twice', async () => {
    const h = harness({ claimed: false, request: { companyId: 'co-1', state: 'READY' } });
    const result = await h.useCase.execute(CMD);

    assert.equal(result.companyId, 'co-1');
    assert.equal(h.onboardingCalls.length, 0, 'a second caller must not create a second company');
    assert.equal(h.completed.length, 0);
  });

  it('releases the fence with a bounded code when onboarding fails', async () => {
    const h = harness({ onboardingFails: new Error('OWNER role not found. Run seed first.') });
    await assert.rejects(() => h.useCase.execute({ ...CMD, username: 'somchai' }), /OWNER role not found/);

    assert.equal(h.failures[0].attemptId, 'attempt-1');
    assert.match(h.failures[0].failureCode, /^[a-z0-9_.:-]{1,64}$/);
    assert.equal(h.completed.length, 0);
    // The hash stays put so an admin retry still has something to provision with.
    assert.equal(h.requestUpdates.length, 0);
    // §15.6 (c): a shop was told "we will open it" and was not. Nothing else says so out loud.
    assert.deepEqual(h.alerts, ['provisioning_failed']);
  });

  // The queue chip and the admin toast both key off `failureCode`. A P2002 escaping onboarding
  // sanitised down to "invalid_prisma_externalidentity_create_invocation_in_" — a machine string an
  // operator can do nothing with. The named conflicts arrive as themselves.
  for (const code of ['line_identity_already_linked', 'line_identity_disabled']) {
    it(`carries ${code} into failureCode unchanged`, async () => {
      const h = harness({ onboardingFails: new ConflictException(code) });
      await assert.rejects(() => h.useCase.execute({ ...CMD, username: 'somchai' }), new RegExp(code));
      assert.equal(h.failures[0].failureCode, code);
    });
  }

  it('raises the ops alert when the fence is taken from an abandoned attempt', async () => {
    // The claim itself recovers, so nothing here fails — but a run that sat half-open long enough
    // for the clock to give up on it is exactly what an operator needs to hear about.
    const h = harness({ reclaimedStale: true });
    await h.useCase.execute({ ...CMD, username: 'somchai' });

    assert.deepEqual(h.alerts, ['provisioning_failed']);
  });

  /**
   * Confirmed on a real stack: after a LINE-first signup carrying 0812345678, the owner's
   * `User.phoneNumber` was null and the number existed only on the application row — so the profile
   * page asked for it again, the day-7 nudge fired at somebody who had already given it, and the
   * queue's duplicate hint could never match a shop this flow opened.
   */
  it('gives the new LINE owner the phone number they typed at signup', async () => {
    const h = harness({ request: { ...LINE_REQUEST, phoneNumber: '0812345678' } });
    await h.useCase.execute(CMD);

    assert.equal(h.onboardingCalls[0].claimedOwner?.phoneNumber, '0812345678');
    // Still a brand-new owner: a phone must not be mistaken for "attach to this account".
    assert.equal(h.onboardingCalls[0].claimedOwner?.attachUserId, undefined);
    assert.equal(h.onboardingCalls[0].ownerAuth.kind, 'line');
  });

  it('sends no owner payload at all when the optional phone was left blank', async () => {
    const h = harness({ request: { ...LINE_REQUEST, phoneNumber: null } });
    await h.useCase.execute(CMD);
    assert.equal(h.onboardingCalls[0].claimedOwner, undefined, 'byte-identical to before');
  });

  it('raises nothing on a provisioning that simply works', async () => {
    const h = harness();
    await h.useCase.execute({ ...CMD, username: 'somchai' });
    assert.deepEqual(h.alerts, []);
  });
});
