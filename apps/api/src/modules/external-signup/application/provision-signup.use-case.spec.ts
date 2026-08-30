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
  approvedByUserId: 'admin-1',
  companyId: null as string | null,
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
} = {}) {
  const onboardingCalls: any[] = [];
  const companyUpdates: any[] = [];
  const requestUpdates: any[] = [];
  const audits: any[] = [];
  const advances: any[] = [];
  const completed: any[] = [];
  const failures: any[] = [];

  const request = { ...REQUEST, ...(options.request ?? {}) };

  const prisma = {
    client: {
      user: { findUnique: async () => (options.existingOwnerEmail === undefined ? null : { email: options.existingOwnerEmail }) },
      company: { update: async (args: any) => { companyUpdates.push(args); return {}; } },
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

  return {
    useCase: new ProvisionSignupUseCase(prisma, core, onboarding),
    onboardingCalls, companyUpdates, requestUpdates, audits, advances, completed, failures,
  };
}

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
