import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  const aiConfigUpserts: any[] = [];
  const lineContexts: any[] = [];

  const request = { ...REQUEST, ...(options.request ?? {}) };

  const prisma = {
    client: {
      user: { findUnique: async () => (options.existingOwnerEmail === undefined ? null : { email: options.existingOwnerEmail }) },
      company: { update: async (args: any) => { companyUpdates.push(args); return {}; } },
      companyPlanTerm: {
        upsert: async (args: any) => { planTermUpserts.push(args); return {}; },
        update: async (args: any) => { planTermUpdates.push(args); return {}; },
      },
      companyAiConfiguration: { upsert: async (args: any) => { aiConfigUpserts.push(args); return {}; } },
      lineCompanyContext: { upsert: async (args: any) => { lineContexts.push(args); return {}; } },
      companySignupRequest: { update: (args: any) => { requestUpdates.push(args); return Promise.resolve({}); } },
      auditLog: { create: (args: any) => { audits.push(args); return Promise.resolve({}); } },
      $transaction: async (ops: any[]) => Promise.all(ops),
    },
  } as any;

  const core = {
    claimProvisioning: async () => ({
      request, claimed: options.claimed ?? true, attemptId: options.claimed === false ? null : 'attempt-1',
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
    planTermUpdates, aiConfigUpserts, lineContexts, linePushes, alerts,
  };
}

describe('provisioning applies the PRO trial term (P29 T3)', () => {
  it('names the PRO_999 30-day term on the onboarding command, not by a second upsert', async () => {
    const h = harness();
    await h.useCase.execute(CMD);
    // Review B-01: onboarding writes the term row, so this use-case must NOT upsert its own —
    // `applyPlanTermPreset` leaves an existing row alone and the intended tier would be lost.
    assert.equal(h.planTermUpserts.length, 0);
    assert.equal(h.onboardingCalls[0].planTier, 'PRO_999');
    assert.equal(h.onboardingCalls[0].planDays, 30);
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
  it('hands onboarding the LINE owner shape and the free trial preset', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.execute(CMD);

    const cmd = h.onboardingCalls[0];
    assert.deepEqual(cmd.ownerAuth, {
      kind: 'line', providerUserId: 'Uline-1', channelId: 'channel-1', displayName: 'นิด',
    });
    assert.equal(cmd.ownerUsername, undefined, 'no username exists for a LINE-first owner');
    assert.equal(cmd.claimedOwner, undefined, 'and therefore no email-owner shape');
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
    assert.equal(term.update.warmupSlipLimit, 10);
    assert.ok(term.update.warmupUntil.getTime() - Date.now() > 6.5 * 24 * 3600_000);
    // The create side is the full free-trial term, so a missing row is repaired, not half-written.
    assert.equal(term.create.tierKey, 'FREE_TRIAL_15');
    assert.equal(term.create.monthlySlipLimit, 15);
    assert.equal(term.create.termEndsAt.getTime() - term.create.termStartAt.getTime(), 30 * 24 * 3600_000);
    // Review G-06: without this the trial shop would spend the platform default budget.
    assert.equal(h.aiConfigUpserts[0].create.monthlyBudgetSatang, 8000);
    assert.equal(h.aiConfigUpserts[0].update.monthlyBudgetSatang, 8000);
    // Review B-06: the first receipt must land in the shop just opened, not in a company picker.
    assert.equal(h.lineContexts[0].where.lineUserId, 'Uline-1');
    assert.equal(h.lineContexts[0].create.companyId, 'co-1');
    assert.equal(h.lineContexts[0].update.companyId, 'co-1');
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
    assert.equal(h.planTermUpserts.length, 1);
    assert.equal(h.planTermUpserts[0].create.tierKey, 'PRO_999');
    // Idempotent: a term the admin already set is never shortened by a retry.
    assert.deepEqual(h.planTermUpserts[0].update, {});
  });

  it('leaves a recovered LINE shop to its own trial guards', async () => {
    const h = harness({ request: { ...LINE_REQUEST, companyId: 'co-1', ownerUserId: 'user-1' } });
    await h.useCase.execute(CMD);

    // The trial guards upsert FREE_TRIAL_15 themselves; a PRO_999 preset here would race them.
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
  });
});
