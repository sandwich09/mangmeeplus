import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { currentLegalRelease } from '../../auth/application/legal-acceptance.service';
import { SubmitLineSignupUseCase } from './submit-line-signup.use-case';

const RELEASE = currentLegalRelease('th');
const LEGAL = { ...RELEASE, locale: 'th' };

const CMD = {
  idToken: 'aaaa.bbbb.cccc',
  companyName: 'ร้านมั่งมี',
  legal: LEGAL,
  userAgent: 'LINE/14 iOS',
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

/** Thursday 10:00 Bangkok — inside the MON-SAT 09:00-18:00 window. */
const NOW = new Date('2026-09-03T10:00:00+07:00');

function harness(options: {
  approvalMode?: 'MANUAL' | 'AUTO_FREE';
  autoDailyCap?: number;
  approvedToday?: number;
  /**
   * The row that owns the unique `(LINE, channel, providerUserId)` slot, in WHATEVER status — which
   * is the whole point of this fix. Defaults keep it the ACTIVE identity of an ACTIVE user, so
   * every pre-existing test describes the same account it always did.
   */
  identity?: { userId: string; status?: string; user?: { status: string } } | null;
  /**
   * What the account behind that identity already belongs to. Only an OWNER membership makes this a
   * repeat trial — an employee whose LINE was linked by the staff QR is opening their FIRST shop.
   */
  memberships?: Array<{ owner: boolean; status?: string }>;
  verifyThrows?: Error;
  createThrows?: unknown;
  /** null = a verified token that carries no profile name, which LINE permits. */
  displayName?: string | null;
  systemAdmins?: string[];
  attemptBucketFull?: boolean;
} = {}) {
  const created: any[] = [];
  const advances: any[] = [];
  const audits: any[] = [];
  const updates: any[] = [];
  const notified: string[] = [];
  const provisioned: any[] = [];
  const userQuotas: string[] = [];

  const capCounts: any[] = [];
  const locks: unknown[][] = [];
  const identityReads: any[] = [];
  const client: any = {
    externalIdentity: {
      findFirst: async (args: any) => {
        identityReads.push(args);
        return options.identity
          ? { status: 'ACTIVE', user: { status: 'ACTIVE' }, ...options.identity }
          : null;
      },
    },
    // Both filters are HONOURED. Dropping the OWNER role turns an employee's first shop into a
    // "repeat trial"; dropping the DRAFT exclusion turns a half-filled employee draft into one.
    // A fake that ignored the where-clause would report green for either regression.
    companyMembership: {
      count: async (args: any) => (options.memberships ?? []).filter((m) => {
        if (args?.where?.roles?.some?.role?.key === 'OWNER' && !m.owner) return false;
        if (args?.where?.status?.not && (m.status ?? 'ACTIVE') === args.where.status.not) return false;
        return true;
      }).length,
    },
    companySignupRequest: {
      count: async (args: any) => { capCounts.push(args); return options.approvedToday ?? 0; },
      update: async (args: any) => { updates.push(args); return {}; },
    },
    auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
    // The cap is claimed inside a transaction holding an advisory lock; the fake records both so a
    // spec can prove the serialisation exists rather than trusting the comment above it.
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(values); return 0; },
    $transaction: async (fn: any) => fn(client),
  };
  const prisma = { client } as any;

  const config = {
    lineSignupApprovalMode: options.approvalMode ?? 'MANUAL',
    lineSignupAutoDailyCap: options.autoDailyCap ?? 20,
    lineSignupBusinessDays: 'MON-SAT',
    lineSignupBusinessHours: '09:00-18:00',
  } as any;

  const core = {
    receiveNormalized: async (data: any) => {
      if (options.createThrows) throw options.createThrows;
      created.push(data);
      return { id: 'signup-1', ...data };
    },
    advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; },
  } as any;

  const lineIdToken = {
    verify: async () => {
      if (options.verifyThrows) throw options.verifyThrows;
      const displayName = options.displayName === undefined ? 'นิด' : options.displayName;
      return { providerUserId: 'Uline-1', channelId: 'channel-1', ...(displayName ? { displayName } : {}) };
    },
  } as any;

  // Inspect and consume are separate calls, exactly as they are for the login buckets. The attempt
  // bucket is charged on every try; the creation bucket only on one that produced an application.
  const rateLimit = {
    assertLineSignupAttemptAllowed: async (key: string) => {
      userQuotas.push(`attempt:${key}`);
      if (options.attemptBucketFull) throw new Error('Too many requests');
    },
    assertLineSignupUserAllowed: async (key: string) => { userQuotas.push(`inspect:${key}`); },
    recordLineSignupUser: async (key: string) => { userQuotas.push(`consume:${key}`); },
  } as any;
  const adminNotify = {
    activeSystemAdmins: async () => (options.systemAdmins ?? ['sysadmin-1']).map((userId) => ({ companyId: 'sys', userId })),
    enqueue: async (id: string) => { notified.push(id); },
  } as any;
  const provision = { execute: async (cmd: any) => { provisioned.push(cmd); return {}; } } as any;

  // §15.6: the daily-cap alert is raised, not sent — recorded so the trigger can be asserted.
  const alerts: string[] = [];
  const opsAlerts = { raise: async (kind: string) => { alerts.push(kind); } } as any;

  return {
    useCase: new SubmitLineSignupUseCase(prisma, config, core, lineIdToken, rateLimit, adminNotify, provision, opsAlerts),
    created, advances, audits, updates, notified, provisioned, userQuotas, capCounts, locks, alerts,
    identityReads,
  };
}

describe('SubmitLineSignupUseCase — identity and clickwrap', () => {
  it('never touches the database when the token does not verify', async () => {
    const h = harness({ verifyThrows: new UnauthorizedException('bad token') });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), UnauthorizedException);
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.userQuotas, [], 'and no quota is spent on a request that proved nothing');
  });

  it('refuses evidence for a release that is no longer current', async () => {
    const h = harness();
    const stale = { ...CMD, legal: { ...LEGAL, statementSha256: 'f'.repeat(64) } };
    await assert.rejects(() => h.useCase.execute(stale, NOW), /legal_release_changed/);
    assert.deepEqual(h.created, [], 'consent to text nobody saw is not consent');
  });

  it('stores every evidence field and stamps the SERVER clock as the acceptance time', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);

    const row = h.created[0];
    assert.equal(row.legalDocumentVersion, RELEASE.documentVersion);
    assert.equal(row.legalStatementSha256, RELEASE.statementSha256);
    assert.equal(row.legalReleaseFingerprintSha256, RELEASE.releaseFingerprintSha256);
    assert.equal(row.legalDisplayChallenge, RELEASE.displayChallenge);
    assert.equal(row.legalLocale, 'th');
    assert.equal(row.legalUserAgent, 'LINE/14 iOS');
    assert.equal(row.legalAcceptedAt.getTime(), NOW.getTime());
    assert.equal(row.consentVersion, RELEASE.documentVersion);
  });

  it('mints the idempotency key from the identity it verified, and keeps no address', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);

    const row = h.created[0];
    assert.match(row.externalSignupId, /^line:channel-1:Uline-1:[0-9a-f-]{36}$/);
    assert.equal(row.source, 'line-oa');
    assert.equal(row.contactEmail, undefined, 'this flow never asks for an address');
    assert.equal(row.lineDisplayName, 'นิด');
    // DATA-MIN-01: display name and typed fields only, never a picture.
    assert.equal(JSON.stringify(row).toLowerCase().includes('picture'), false);
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1', 'inspect:Uline-1', 'consume:Uline-1']);
  });

  // Review MEDIUM-1: the bucket is three shops a DAY. Consuming it on a rejected submit turns
  // three typos into a 24-hour lockout for a customer who has not opened anything yet.
  it('spends the daily bucket only once an application actually exists', async () => {
    const h = harness();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(() => h.useCase.execute({ ...CMD, phoneNumber: '12345' }, NOW));
    }
    assert.deepEqual(h.userQuotas.filter((q: string) => q.startsWith('inspect')).length, 3);
    assert.equal(h.userQuotas.filter((q: string) => q.startsWith('consume')).length, 0);

    // The fourth attempt is the one that gets it right, and it must still go through.
    const result = await h.useCase.execute(CMD, NOW);
    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.userQuotas.at(-1), 'consume:Uline-1');
  });

  // Review L-4: with the creation bucket no longer charging failures, one account could otherwise
  // drive unbounded ID-token verifications. The attempt bucket is what bounds that.
  it('stops an account that never succeeds, without touching its creation quota', async () => {
    const h = harness({ attemptBucketFull: true });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /Too many requests/);
    // Charged before the creation bucket is even consulted, and nothing was created.
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1']);
    assert.deepEqual(h.created, []);
  });

  it('refuses a re-submit while a previous provisioning is still recoverable', async () => {
    // The partial unique index counts PROVISIONING_FAILED as open (review HIGH-2): re-submitting
    // there would take the attach path off the half-committed identity and open a SECOND company.
    const h = harness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_already_pending/);
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1', 'inspect:Uline-1'], 'no creation quota spent');
  });

  it('labels an owner whose LINE token carries no profile name', async () => {
    const h = harness({ displayName: null });
    await h.useCase.execute(CMD, NOW);
    // A neutral label, never an empty string that would render as a blank row in the admin queue.
    assert.equal(h.created[0].ownerDisplayName, 'เจ้าของร้าน');
    assert.equal(h.created[0].lineDisplayName, undefined);
  });

  it('maps the open-application index violation to a conflict the shop owner can act on', async () => {
    const h = harness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_already_pending/);
  });

  it('rejects a phone number that is not a Thai mobile, and accepts a blank one', async () => {
    const h = harness();
    await assert.rejects(
      () => h.useCase.execute({ ...CMD, phoneNumber: '12345' }, NOW),
      UnprocessableEntityException,
    );
    await h.useCase.execute({ ...CMD, phoneNumber: '081-234-5678' }, NOW);
    assert.equal(h.created[0].phoneNumber, '0812345678');
    await h.useCase.execute(CMD, NOW);
    assert.equal(h.created[1].phoneNumber, undefined, 'the field is optional by design');
  });
});

describe('SubmitLineSignupUseCase — where the application goes', () => {
  it('MANUAL queues it for an admin and says so', async () => {
    const h = harness();
    const result = await h.useCase.execute(CMD, NOW);

    assert.deepEqual(result, {
      requestId: 'signup-1', state: 'PENDING_REVIEW', existingAccount: false, businessHours: true,
    });
    assert.deepEqual(h.advances, [
      { id: 'signup-1', state: 'VALIDATED' },
      { id: 'signup-1', state: 'PENDING_REVIEW' },
    ]);
    assert.deepEqual(h.notified, ['signup-1']);
    assert.deepEqual(h.provisioned, []);
  });

  it('AUTO_FREE provisions inline and never enters the queue', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE' });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'VALIDATED' }], 'no PENDING_REVIEW hop');
    assert.deepEqual(h.notified, [], 'and no admin is woken up');
    assert.equal(h.updates[0].data.autoApproved, true);
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // Review HIGH-1: onboarding writes this id into two foreign keys, so it has to be a real user.
    assert.equal(h.provisioned[0].actorUserId, 'sysadmin-1');
    assert.equal(h.audits.at(-1).data.actorRefId, 'line-signup-auto-approve');
  });

  // Review MEDIUM-2: count-then-write lets N concurrent submits all read `cap - 1` and all pass,
  // which is the day the free AI budget is spent N times over.
  it('claims the daily slot under an advisory lock, counting only today Bangkok rows', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE' });
    await h.useCase.execute(CMD, NOW);

    assert.deepEqual(h.locks, [['line-signup-auto-cap:2026-09-03']], 'count and mark are serialised');
    const where = h.capCounts[0].where;
    assert.equal(where.source, 'line-oa');
    assert.equal(where.autoApproved, true);
    // Bangkok midnight of 2026-09-03 is 2026-09-02T17:00Z.
    assert.equal(where.createdAt.gte.toISOString(), '2026-09-02T17:00:00.000Z');
  });

  it('sends the application to the queue when no SYSTEM_ADMIN can act as operator', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', systemAdmins: [] });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, []);
    assert.deepEqual(h.updates, [], 'and no cap slot is burned discovering that');
    assert.equal(h.audits.at(-1).data.action, 'signup.line.auto_approve_no_actor');
  });

  it('falls back to the queue once the daily cap is spent (spec §9 item 3)', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', autoDailyCap: 20, approvedToday: 20 });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, [], 'the cap is a stop, not a suggestion');
    assert.deepEqual(h.notified, ['signup-1']);
    const capped = h.audits.find((entry: any) => entry.data.action === 'signup.line.auto_approve_capped');
    assert.equal(capped.data.metadataJson.dailyCap, 20);
    // §15.6 (a): the rest of the day is manual work somebody has to know is coming. The audit row
    // above is evidence; this is the only thing that TELLS anyone.
    assert.deepEqual(h.alerts, ['auto_cap_reached']);
  });

  // Owner 2026-09-05. A LINE account whose old shop was closed is asking for a SECOND free trial.
  // AUTO_FREE opening that unseen is how one person collects trials; a person decides it instead.
  it('sends a repeat trial to the queue instead of auto-approving it', async () => {
    const h = harness({
      approvalMode: 'AUTO_FREE',
      identity: { userId: 'user-old', status: 'UNLINKED' },
      memberships: [{ owner: true }],
    });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, [], 'no shop is opened by the machine for a repeat trial');
    assert.deepEqual(h.updates, [], 'and no daily cap slot is burned on it either');
    assert.deepEqual(h.notified, ['signup-1'], 'it lands in the admin queue like any manual row');
    const flagged = h.audits.find((entry: any) => entry.data.action === 'signup.line.auto_approve_repeat_trial');
    assert.equal(flagged.data.metadataJson.reason, 'repeat_trial_manual_review');
    assert.equal(h.audits[0].data.metadataJson.repeatTrial, true, 'the submit row says so too');
  });

  /**
   * Review B1. An employee's LINE is linked by the staff QR, so their identity points at an account
   * that already holds a membership — in their EMPLOYER's shop. Counting any membership made their
   * OWN first shop a "repeat trial" and sent it to manual review naming a company never theirs.
   */
  it('does not count an employee membership as a trial this person has had', async () => {
    const h = harness({
      approvalMode: 'AUTO_FREE',
      identity: { userId: 'user-staff', status: 'UNLINKED' },
      memberships: [{ owner: false }],
    });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED', 'their first shop is a first shop');
    assert.equal(h.audits[0].data.metadataJson.repeatTrial, false);
  });

  /**
   * An employee draft an admin started and abandoned is a half-filled form, not a shop. Onboarding
   * writes the owner's membership ACTIVE inside the company transaction, so a shop that was really
   * opened never sits in DRAFT — counting DRAFT could only ever produce a false repeat trial.
   */
  it('does not count an abandoned DRAFT membership as a shop this person had', async () => {
    const h = harness({
      approvalMode: 'AUTO_FREE',
      identity: { userId: 'user-old', status: 'UNLINKED' },
      memberships: [{ owner: true, status: 'DRAFT' }],
    });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED');
    assert.equal(h.audits[0].data.metadataJson.repeatTrial, false);
  });

  it('still counts a shop that was closed, suspended or disabled', async () => {
    for (const status of ['SUSPENDED', 'DISABLED', 'INVITED']) {
      const h = harness({
        approvalMode: 'AUTO_FREE',
        identity: { userId: 'user-old', status: 'UNLINKED' },
        memberships: [{ owner: true, status }],
      });
      const result = await h.useCase.execute(CMD, NOW);
      assert.equal(result.state, 'PENDING_REVIEW', `${status} membership is still a shop they had`);
    }
  });

  it('still auto-approves a LINE account that has never had a shop', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', identity: { userId: 'user-old', status: 'UNLINKED' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED', 'an unlinked identity alone is not a repeat trial');
    assert.equal(h.audits[0].data.metadataJson.repeatTrial, false);
  });

  it('treats a second shop for an ACTIVE account as a repeat trial too', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', identity: { userId: 'user-9' }, memberships: [{ owner: true }] });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.equal(h.created[0].attachUserId, 'user-9', 'still an attach — just not an automatic one');
  });

  it('raises no cap alert on the ordinary path, or when no operator exists to name', async () => {
    const under = harness({ approvalMode: 'AUTO_FREE', autoDailyCap: 20, approvedToday: 0 });
    await under.useCase.execute(CMD, NOW);
    assert.deepEqual(under.alerts, [], 'a shop approved inside the cap is not an ops event');

    // No SYSTEM_ADMIN at all: the application falls back to MANUAL for a different reason, and
    // "the cap is full" would be a false statement about why.
    const noActor = harness({ approvalMode: 'AUTO_FREE', autoDailyCap: 20, systemAdmins: [] });
    await noActor.useCase.execute(CMD, NOW);
    assert.deepEqual(noActor.alerts, []);
  });

  it('opens a second shop on the account this LINE user already owns', async () => {
    const h = harness({ identity: { userId: 'user-9' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.existingAccount, true);
    assert.equal(h.created[0].attachUserId, 'user-9');
  });

  it('reads the identity slot without a status filter', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);
    // UAT cmto4xtrx002r4o5tf7o38dls: with `status: 'ACTIVE'` in this where-clause an UNLINKED row
    // was invisible here and fatal in onboarding, because the unique slot belongs to it regardless.
    assert.deepEqual(h.identityReads[0].where, {
      provider: 'LINE', providerUserId: 'Uline-1', providerChannelId: 'channel-1',
    });
  });

  it('opens a NEW account when the LINE account was unlinked earlier', async () => {
    // The UAT shape: linked once, unlinked, applying again. Before the fix this reached onboarding
    // as "brand new", whose `externalIdentity.create` then died on the unique slot the stale row
    // still owns — 409 twice, PROVISIONING_FAILED, and every admin retry the same.
    const h = harness({ identity: { userId: 'user-old', status: 'UNLINKED' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.existingAccount, false, 'the old account is not where this shop belongs');
    assert.equal(h.created[0].attachUserId, undefined);
    assert.equal(result.state, 'PENDING_REVIEW', 'and the application is a real one, not a refusal');
  });

  it('refuses at submit when the account behind the LINE identity is suspended', async () => {
    const h = harness({ identity: { userId: 'user-9', user: { status: 'SUSPENDED' } } });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_account_blocked/);
    assert.deepEqual(h.created, [], 'no application row exists for a refusal');
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1', 'inspect:Uline-1'], 'no creation quota spent');
  });

  it('refuses at submit when an admin disabled the LINE identity', async () => {
    // Same rule LinkLineIdentityUseCase keeps: signing up must not be the one route that quietly
    // resurrects a disabled identity.
    const h = harness({ identity: { userId: 'user-9', status: 'DISABLED' } });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_identity_disabled/);
    assert.deepEqual(h.created, []);
  });

  it('refuses a status it does not recognise rather than guessing', async () => {
    const h = harness({ identity: { userId: 'user-9', status: 'SOMETHING_NEW' } });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_account_blocked/);
  });

  // Review B2. Unlinking must not be the way around a suspension: the user-status guard has to run
  // for an UNLINKED identity too, or a suspended owner severs the link, applies again, and walks
  // away with a brand-new ACTIVE account on the very same LINE.
  it('refuses a suspended account that unlinked first', async () => {
    const h = harness({ identity: { userId: 'user-old', status: 'UNLINKED', user: { status: 'SUSPENDED' } } });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_account_blocked/);
    assert.deepEqual(h.created, [], 'and no application row is left behind for an admin to approve');
  });

  it('still lets an UNLINKED identity of an ACTIVE account open a new shop', async () => {
    const h = harness({ identity: { userId: 'user-old', status: 'UNLINKED', user: { status: 'ACTIVE' } } });
    const result = await h.useCase.execute(CMD, NOW);
    assert.equal(result.state, 'PENDING_REVIEW', 'the ordinary "I closed my old shop" case is untouched');
  });

  it('tells the LIFF page which waiting message to show', async () => {
    const inHours = await harness().useCase.execute(CMD, NOW);
    assert.equal(inHours.businessHours, true);
    // Sunday: the office is shut, so the page promises the next business day instead.
    const sunday = await harness().useCase.execute(CMD, new Date('2026-09-06T10:00:00+07:00'));
    assert.equal(sunday.businessHours, false);
  });

  it('keeps applicant text out of the audit trail', async () => {
    const h = harness({ identity: { userId: 'user-9' } });
    await h.useCase.execute({ ...CMD, phoneNumber: '0812345678' }, NOW);

    const evidence = JSON.stringify(h.audits);
    for (const pii of ['ร้านมั่งมี', '0812345678', 'Uline-1', 'นิด']) {
      assert.equal(evidence.includes(pii), false, `audit leaked ${pii}`);
    }
    assert.equal(h.audits[0].data.action, 'signup.line.submitted');
    assert.equal(h.audits[0].data.metadataJson.existingAccount, true);
  });
});

describe('SubmitLineSignupUseCase — conflicts are exceptions, not silent successes', () => {
  it('surfaces a non-unique database error unchanged', async () => {
    const h = harness({ createThrows: new Error('connection reset') });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /connection reset/);
  });

  it('never returns a ConflictException as a state', async () => {
    const h = harness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), ConflictException);
  });
});
