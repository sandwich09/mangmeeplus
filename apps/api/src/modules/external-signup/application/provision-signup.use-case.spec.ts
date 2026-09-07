import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { ProvisionSignupUseCase, mapBusinessCategory } from './provision-signup.use-case';

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
  const lineContexts: any[] = [];

  const request = { ...REQUEST, ...(options.request ?? {}) };

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
        updateMany: async (args: any) => { aiConfigStamps.push(args); return { count: 1 }; },
      },
      lineCompanyContext: { upsert: async (args: any) => { lineContexts.push(args); return {}; } },
      companySignupRequest: { update: (args: any) => { requestUpdates.push(args); return Promise.resolve({}); } },
      auditLog: { create: (args: any) => { audits.push(args); return Promise.resolve({}); } },
      $transaction: async (ops: any[]) => Promise.all(ops),
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
    useCase: new ProvisionSignupUseCase(prisma, core, onboarding, config, adminDirectory, lineNotify, opsAlerts),
    onboardingCalls, companyUpdates, requestUpdates, audits, advances, completed, failures, planTermUpserts,
    planTermUpdates, planTermStamps, aiConfigUpserts, aiConfigStamps, lineContexts, linePushes, alerts,
  };
}

describe('provisioning applies the free-trial term (P29 T3; Owner 2026-09-05)', () => {
  it('names the free-trial 30-day term on the onboarding command, not by a second upsert', async () => {
    const h = harness();
    await h.useCase.execute(CMD);
    // Review B-01: onboarding is TOLD the tier rather than having one upserted over it afterwards,
    // because an upsert against an existing row cannot change a tier that is already wrong.
    // Review R02: one trial for both sources. The web form used to grant PRO_999 here.
    assert.equal(h.onboardingCalls[0].planTier, 'FREE_TRIAL_15');
    assert.equal(h.onboardingCalls[0].planDays, 30);
    // The single upsert that follows is the warm-up guard, and its `update` side touches nothing
    // but the warm-up — no tier, no dates, so it can never contradict what onboarding wrote.
    assert.equal(h.planTermUpserts.length, 1);
    // F9: the upsert writes nothing to a row that exists, so it can never contradict what
    // onboarding wrote; the warm-up arrives through its own conditional stamp.
    assert.deepEqual(h.planTermUpserts[0].update, {});
    assert.equal(h.planTermStamps[0].where.warmupUntil, null);
  });
});

/**
 * Owner 2026-09-05, second half: "the same free trial" means the same PRODUCT, not only the same
 * tier row. The AI budget cap and the first-week receipt ceiling were `line-oa`-only, so a web-form
 * shop on the identical trial tier still spent the PLATFORM default AI budget and read at its full
 * tier ceiling from day one.
 */
describe('the trial guards are the same for both sources (Owner 2026-09-05)', () => {
  it('caps a web-form trial shop the way a LINE trial shop is capped', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    const term = h.planTermUpserts[0];
    assert.ok(term, 'a web-form trial shop must get the warm-up guard too');
    assert.equal(term.where.companyId, 'co-1');
    assert.equal(h.planTermStamps[0].data.warmupSlipLimit, 10);
    assert.ok(h.planTermStamps[0].data.warmupUntil.getTime() - Date.now() > 6.5 * 24 * 3600_000);
    assert.equal(term.create.tierKey, 'FREE_TRIAL_15');
    assert.equal(term.create.monthlySlipLimit, 15);
    assert.equal(term.create.termEndsAt.getTime() - term.create.termStartAt.getTime(), 30 * 24 * 3600_000);
    assert.equal(h.aiConfigUpserts[0]?.create.monthlyBudgetSatang, 8000);
    assert.equal(h.aiConfigStamps[0]?.data.monthlyBudgetSatang, 8000);
  });

  it('writes identical guard rows whichever form the shop came in through', async () => {
    const web = harness();
    await web.useCase.execute(CMD);
    const line = harness({ request: LINE_REQUEST });
    await line.useCase.execute(CMD);

    const shape = (upsert: any) => ({
      ...upsert.create,
      termStartAt: undefined, termEndsAt: undefined, warmupUntil: undefined,
      update: upsert.update,
    });
    assert.deepEqual(shape(web.planTermUpserts[0]), shape(line.planTermUpserts[0]));
    assert.deepEqual(web.aiConfigUpserts[0], line.aiConfigUpserts[0]);
    assert.equal(web.planTermStamps[0].data.warmupSlipLimit, line.planTermStamps[0].data.warmupSlipLimit);
    assert.deepEqual(web.aiConfigStamps[0], line.aiConfigStamps[0]);
  });

  /**
   * F9. These guards run on EVERY provisioning, including an admin retry weeks later. Stamping the
   * warm-up unconditionally would re-cap a shop whose first week is long past, and stamping the
   * budget unconditionally would silently undo an admin who raised it. Both must be written once
   * and only once: on the row that has never had one.
   */
  it('never re-stamps the warm-up or the budget over a shop that already has them', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    // The upsert only fills a MISSING row — its update side writes nothing at all.
    assert.deepEqual(h.planTermUpserts[0].update, {});
    assert.deepEqual(h.aiConfigUpserts[0].update, {});
    // The warm-up and the cap are then stamped conditionally, so a retry matches no row.
    assert.equal(h.planTermStamps.length, 1);
    assert.equal(h.planTermStamps[0].where.companyId, 'co-1');
    assert.equal(h.planTermStamps[0].where.warmupUntil, null, 'only a term that never had a warm-up');
    assert.equal(h.planTermStamps[0].data.warmupSlipLimit, 10);
    assert.equal(h.aiConfigStamps.length, 1);
    assert.equal(h.aiConfigStamps[0].where.monthlyBudgetSatang, null, 'only a budget nobody has set');
    assert.equal(h.aiConfigStamps[0].data.monthlyBudgetSatang, 8000);
  });

  it('keeps the genuinely LINE-only guard off a web-form shop', async () => {
    const h = harness();
    await h.useCase.execute(CMD);

    // LineCompanyContext points a LINE conversation at a shop. A web-form applicant has no LINE
    // account yet — the welcome page's link step is where that arrives.
    assert.deepEqual(h.lineContexts, []);
    assert.deepEqual(h.linePushes, []);
  });
});

describe('mapBusinessCategory', () => {
  it('honours an exact enum match and never guesses free text', () => {
    assert.equal(mapBusinessCategory('RETAIL'), 'RETAIL');
    assert.equal(mapBusinessCategory('wellness spa'), 'WELLNESS_SPA');
    // Thai free text is not machine-mappable, and a wrong guess would mis-set the PDPA tripwire.
    assert.equal(mapBusinessCategory('ร้านค้าปลีก'), 'OTHER');
    assert.equal(mapBusinessCategory('คลินิก'), 'OTHER');
    assert.equal(mapBusinessCategory(null), 'OTHER');
    assert.equal(mapBusinessCategory('  '), 'OTHER');
  });
});

/**
 * R10. The mapping above is right to refuse a guess, but it left the PDPA health tripwire dead for
 * every Thai applicant: someone who types "คลินิก" becomes OTHER, and the onboarding safeguard that
 * exists for clinics never fires — while the admin approving the row is looking straight at the
 * word. So the admin picks the enum at review, and THAT is what provisioning uses.
 */
describe('the business category chosen at review', () => {
  it('reaches onboarding instead of the free-text mapping', async () => {
    const h = harness({ request: { businessType: 'คลินิก', businessCategory: 'CLINIC' } });
    await h.useCase.execute(CMD);
    assert.equal(h.onboardingCalls[0].businessCategory, 'CLINIC');
  });

  it('falls back to the mapping when review left it alone', async () => {
    const h = harness({ request: { businessType: 'ร้านค้าปลีก', businessCategory: null } });
    await h.useCase.execute(CMD);
    assert.equal(h.onboardingCalls[0].businessCategory, 'OTHER');
    const exact = harness({ request: { businessType: 'RETAIL', businessCategory: null } });
    await exact.useCase.execute(CMD);
    assert.equal(exact.onboardingCalls[0].businessCategory, 'RETAIL');
  });

  // A stored value the enum does not know is not a licence to invent one — the tripwire must never
  // be armed or disarmed by a string nobody validated.
  it('ignores a stored value that is not in the enum', async () => {
    const h = harness({ request: { businessType: 'คลินิก', businessCategory: 'HOSPITAL' } });
    await h.useCase.execute(CMD);
    assert.equal(h.onboardingCalls[0].businessCategory, 'OTHER');
  });
});

describe('ProvisionSignupUseCase — new-user path', () => {
  it('provisions through the onboarding service with the self-chosen password', async () => {
    const h = harness();
    const result = await h.useCase.execute({ ...CMD, username: 'somchai' });

    assert.deepEqual(result, { companyId: 'co-1', companyName: 'ร้านมั่งมี', attachedToExistingUser: false });
    const cmd = h.onboardingCalls[0];
    assert.equal(cmd.ownerUsername, 'somchai');
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

    const audit = h.audits[0].data;
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
    assert.equal(h.audits[0].data.metadataJson.emailKeptExisting, false);
  });

  it('records that an existing different address was kept', async () => {
    const h = harness({
      request: { attachUserId: 'user-9', pendingPasswordHash: null },
      existingOwnerEmail: 'other@example.com',
    });
    await h.useCase.execute(CMD);
    assert.equal(h.audits[0].data.metadataJson.emailKeptExisting, true);
  });

  it('does not flag a keep when the existing address is the same one', async () => {
    const h = harness({
      request: { attachUserId: 'user-9', pendingPasswordHash: null },
      existingOwnerEmail: 'somchai@example.com',
    });
    await h.useCase.execute(CMD);
    assert.equal(h.audits[0].data.metadataJson.emailKeptExisting, false);
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

  it('hands onboarding the LINE owner shape and the free trial preset', async () => {
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
    assert.equal(cmd.planDays, 30);
    // Spec §6: the acceptance time is the one from the application, not the provisioning clock.
    assert.equal(cmd.legalAcceptance.legalAcceptedAt.toISOString(), '2026-09-04T03:21:00.000Z');
    assert.equal(cmd.legalAcceptance.displayChallenge, 'c'.repeat(64));
  });

  it('caps the first week, the AI spend and the LINE company context', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.execute(CMD);

    // §9 warm-up: seven days, and the slip ceiling comes from config, not a literal. Upserted
    // rather than updated (review HIGH-3): onboarding writes the term post-commit best-effort, so
    // it may not be there, and a bare update would raise P2025 on a shop that already exists.
    const term = h.planTermUpserts[0];
    assert.equal(term.where.companyId, 'co-1');
    assert.equal(h.planTermStamps[0].data.warmupSlipLimit, 10);
    assert.ok(h.planTermStamps[0].data.warmupUntil.getTime() - Date.now() > 6.5 * 24 * 3600_000);
    // The create side is the full free-trial term, so a missing row is repaired, not half-written.
    assert.equal(term.create.tierKey, 'FREE_TRIAL_15');
    assert.equal(term.create.monthlySlipLimit, 15);
    assert.equal(term.create.termEndsAt.getTime() - term.create.termStartAt.getTime(), 30 * 24 * 3600_000);
    // Review G-06: without this the trial shop would spend the platform default budget.
    assert.equal(h.aiConfigUpserts[0].create.monthlyBudgetSatang, 8000);
    assert.equal(h.aiConfigStamps[0].data.monthlyBudgetSatang, 8000);
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

    const metadata = h.audits[0].data.metadataJson;
    assert.equal(metadata.source, 'line-oa');
    assert.equal(metadata.autoApproved, true);
    assert.equal(metadata.operatorResolvedFromDirectory, true);
    // Onboarding's own audit carries the same three, so the company-side trail is not blind.
    assert.deepEqual(h.onboardingCalls[0].provisioningContext, {
      source: 'line-oa', autoApproved: true, operatorResolvedFromDirectory: true,
    });
  });
});

// Review LOW-3: the adopt path skips onboarding, and onboarding is where the plan term is written.
// A recovered web shop with no CompanyPlanTerm reads as unlimited, not as a trial.
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
    // And the recovered shop is capped like every other trial shop — once, if it has no cap yet.
    assert.equal(h.aiConfigStamps[0]?.data.monthlyBudgetSatang, 8000);
  });

  it('leaves a recovered LINE shop to its own trial guards', async () => {
    const h = harness({ request: { ...LINE_REQUEST, companyId: 'co-1', ownerUserId: 'user-1' } });
    await h.useCase.execute(CMD);

    // The trial guards upsert FREE_TRIAL_15 themselves; a second preset here would race them.
    assert.equal(h.planTermUpserts.length, 1);
    assert.equal(h.planTermUpserts[0].create.tierKey, 'FREE_TRIAL_15');
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
