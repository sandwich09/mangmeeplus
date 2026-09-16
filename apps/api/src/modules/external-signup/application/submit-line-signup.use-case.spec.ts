import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { currentLegalRelease } from '../../auth/application/legal-acceptance.service';
import { SubmitLineSignupUseCase } from './submit-line-signup.use-case';

const RELEASE = currentLegalRelease('th');
const LEGAL = { ...RELEASE, locale: 'th' };

const CMD = {
  idToken: 'aaaa.bbbb.cccc',
  submissionId: '11111111-1111-4111-8111-111111111111',
  intent: 'FIRST_SHOP' as const,
  companyName: 'ร้านมั่งมี',
  phoneNumber: '0812345678',
  contactEmail: 'shop@example.test',
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
  emailPreviouslyUsed?: boolean;
  priorRejected?: boolean;
  recordLineSignupFailures?: number;
  provisionFailures?: number;
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
  const emailReads: Array<{ sql: string; values: unknown[] }> = [];
  const quotaRecords: Array<{ lineUserId: string; requestId: string }> = [];
  let recordFailures = options.recordLineSignupFailures ?? 0;
  let provisionFailures = options.provisionFailures ?? 0;
  let request: any = null;
  const client: any = {
    externalIdentity: {
      findFirst: async (args: any) => {
        identityReads.push(args);
        if (!options.identity) return null;
        const identity = { status: 'ACTIVE', user: { status: 'ACTIVE' }, ...options.identity };
        if (args.where.status && args.where.status !== identity.status) return null;
        if (args.where.user?.status && args.where.user.status !== identity.user.status) return null;
        return identity;
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
      findMany: async () => [],
    },
    companySignupRequest: {
      count: async (args: any) => { capCounts.push(args); return options.approvedToday ?? 0; },
      findUnique: async (args: any) => {
        if (!request) return null;
        const key = args.where.id ?? args.where.externalSignupId;
        return key === request.id || key === request.externalSignupId ? request : null;
      },
      findFirst: async (args: any) => {
        if (args.where.state === 'REJECTED') {
          assert.equal(args.where.source, 'line-oa');
          assert.equal(args.where.lineProviderUserId, request.lineProviderUserId);
          assert.equal(args.where.lineChannelId, request.lineChannelId);
          assert.deepEqual(args.where.id, { not: request.id });
          assert.equal(args.where.contactEmail, undefined, 'history follows verified LINE, not unverified email');
          return options.priorRejected ? { id: 'rejected-old' } : null;
        }
        if (!request) return null;
        if (args.where.id && args.where.id !== request.id) return null;
        if (args.where.externalSignupId && args.where.externalSignupId !== request.externalSignupId) return null;
        if (args.where.source && args.where.source !== request.source) return null;
        if (args.where.lineProviderUserId && args.where.lineProviderUserId !== request.lineProviderUserId) return null;
        if (args.where.lineChannelId && args.where.lineChannelId !== request.lineChannelId) return null;
        const states = args.where.state?.in as string[] | undefined;
        return !states || states.includes(request.state) ? request : null;
      },
      update: async (args: any) => {
        updates.push(args);
        const data = args.data;
        request = {
          ...request,
          ...data,
          version: data.version?.increment ? request.version + data.version.increment : request.version,
        };
        return request;
      },
    },
    auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
    // The cap is claimed inside a transaction holding an advisory lock; the fake records both so a
    // spec can prove the serialisation exists rather than trusting the comment above it.
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(values); return 0; },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      emailReads.push({ sql: strings.join('?'), values });
      return options.emailPreviouslyUsed ? [{ id: 'prior-email-evidence' }] : [];
    },
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
      request = {
        id: 'signup-1', state: 'RECEIVED', version: 0, createdAt: NOW,
        companyId: null, ownerUserId: null, provisioningAttemptId: null,
        resolvedExistingCompanyId: null, reviewResolution: null, resolutionNote: null,
        contactEmailConflict: null, autoApproved: false, approvedAt: null,
        repeatTrialGrantedAt: null, sharedContactReviewedAt: null,
        ...data,
      };
      return { request, replayed: false };
    },
    advance: async (id: string, state: string, _correlationId: string, _failure?: string, expect?: any) => {
      if (expect && !expect(request)) throw new ConflictException(expect.rejectionCode);
      advances.push({ id, state });
      request = { ...request, state, version: request.version + 1 };
      return { request, replayed: false };
    },
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
    recordLineSignupUser: async (lineUserId: string, requestId: string) => {
      userQuotas.push(`consume:${lineUserId}`);
      quotaRecords.push({ lineUserId, requestId });
      if (recordFailures > 0) {
        recordFailures -= 1;
        throw new Error('signup_creation_quota_store_unavailable');
      }
    },
  } as any;
  const adminNotify = {
    activeSystemAdmins: async () => (options.systemAdmins ?? ['sysadmin-1']).map((userId) => ({ companyId: 'sys', userId })),
    enqueue: async (id: string) => { notified.push(id); },
  } as any;
  const provision = {
    execute: async (cmd: any) => {
      provisioned.push(cmd);
      if (provisionFailures > 0) {
        provisionFailures -= 1;
        throw new Error('injected_before_provision');
      }
      request = { ...request, state: 'COMPLETED', companyId: 'company-1', version: request.version + 1 };
      return {};
    },
  } as any;

  // §15.6: the daily-cap alert is raised, not sent — recorded so the trigger can be asserted.
  const alerts: string[] = [];
  const opsAlerts = { raise: async (kind: string) => { alerts.push(kind); } } as any;

  return {
    useCase: new SubmitLineSignupUseCase(prisma, config, core, lineIdToken, rateLimit, adminNotify, provision, opsAlerts),
    created, advances, audits, updates, notified, provisioned, userQuotas, capCounts, locks, alerts,
    identityReads, emailReads, quotaRecords,
    current: () => request,
    patchRequest: (data: Record<string, unknown>) => { request = { ...request, ...data }; },
  };
}

describe('SubmitLineSignupUseCase — identity and clickwrap', () => {
  it('queues reapplication after rejection for manual review even with an unused changed email and no prior shop', async () => {
    for (const contactEmail of ['shop@example.test', 'changed@example.test']) {
      const h = harness({ approvalMode: 'AUTO_FREE', priorRejected: true });
      const result = await h.useCase.execute({ ...CMD, contactEmail }, NOW);
      assert.equal(result.progress?.state, 'PENDING_REVIEW');
      assert.equal(h.provisioned.length, 0);
      assert.equal(h.notified.length, 1);
      const evidence = h.audits.find((entry) => entry.data.action === 'signup.line.reapplication_review');
      assert.equal(evidence.data.metadataJson.priorRequestId, 'rejected-old');
      assert.equal(evidence.data.metadataJson.reason, 'prior_rejection_manual_review');
      assert.equal(h.created.length, 1);
    }
  });

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

  it('mints the idempotency key from LINE identity and stores unverified shop contact', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);

    const row = h.created[0];
    assert.match(row.externalSignupId, /^line:channel-1:Uline-1:[0-9a-f-]{36}$/);
    assert.equal(row.source, 'line-oa');
    assert.equal(row.contactEmail, 'shop@example.test');
    assert.equal(row.mxValid, undefined, 'no mailbox or DNS proof is claimed');
    assert.equal(row.lineDisplayName, 'นิด');
    // DATA-MIN-01: display name and typed fields only, never a picture.
    assert.equal(JSON.stringify(row).toLowerCase().includes('picture'), false);
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1', 'inspect:Uline-1', 'consume:Uline-1']);
  });

  it('normalizes contact before hashing and never chooses an owner by email', async () => {
    const h = harness({ identity: { userId: 'line-owner' } });
    await h.useCase.execute({ ...CMD, contactEmail: ' Shop@Example.TEST ' }, NOW);
    await h.useCase.execute({ ...CMD, contactEmail: 'shop@example.test' }, NOW);
    await assert.rejects(
      () => h.useCase.execute({ ...CMD, contactEmail: 'different@example.test' }, NOW),
      /line_signup_submission_conflict/,
    );
    assert.equal(h.created.length, 1, 'normalized exact replay does not create another request');
    assert.ok(h.created.every((row) => row.attachUserId === 'line-owner'));
    assert.ok(h.identityReads.every((read) => read.where.providerUserId === 'Uline-1' && !('email' in read.where)));
  });

  it('creates LINE applications without an email using an explicit policy version', async () => {
    for (const contactEmail of [undefined, null, '', ' ']) {
      const h = harness(); await h.useCase.execute({ ...CMD, contactEmail } as any, NOW);
      assert.equal(h.created.length, 1);
      assert.equal(h.created[0].contactEmail, null);
      assert.equal(h.created[0].intakePolicyVersion, 'LINE_CONTACT_OPTIONAL_V1');
    }
  });

  it('rejects invalid contact before creating an application or spending a shop creation', async () => {
    const h = harness();
    for (const contactEmail of [123, 'broken', 'a@@example.com', `${'a'.repeat(245)}@example.com`]) {
      await assert.rejects(() => h.useCase.execute({ ...CMD, contactEmail } as any, NOW), BadRequestException);
    }
    assert.deepEqual(h.created, []);
    assert.ok(!h.userQuotas.some((entry) => entry.startsWith('consume:')));
  });

  // Review MEDIUM-1: the bucket is three shops a DAY. Consuming it on a rejected submit turns
  // three typos into a 24-hour lockout for a customer who has not opened anything yet.
  it('spends the daily bucket only once an application actually exists', async () => {
    const h = harness();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(() => h.useCase.execute({ ...CMD, phoneNumber: '12345' }, NOW));
    }
    assert.deepEqual(h.userQuotas.filter((q: string) => q.startsWith('inspect')).length, 0);
    assert.equal(h.userQuotas.filter((q: string) => q.startsWith('consume')).length, 0);

    // The fourth attempt is the one that gets it right, and it must still go through.
    const result = await h.useCase.execute(CMD, NOW);
    assert.equal(result.progress!.state, 'PENDING_REVIEW');
    assert.deepEqual(h.userQuotas.at(-1), 'consume:Uline-1');
  });

  it('recovers the same committed RECEIVED request after the creation-counter store fails', async () => {
    const h = harness({ recordLineSignupFailures: 1 });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /signup_creation_quota_store_unavailable/);
    assert.equal(h.current().state, 'RECEIVED');
    assert.equal(h.created.length, 1, 'the durable intake exists before the external counter call');

    const recovered = await h.useCase.execute({ ...CMD, correlationRequestId: 'req-replay' }, NOW);
    assert.equal(recovered.progress?.state, 'PENDING_REVIEW');
    assert.equal(h.created.length, 1, 'the exact client key never creates a second request');
    assert.deepEqual(h.quotaRecords, [
      { lineUserId: 'Uline-1', requestId: 'signup-1' },
      { lineUserId: 'Uline-1', requestId: 'signup-1' },
    ], 'both attempts use the same consume-once key');
  });

  it('retries persisted intake by proof and version after local form state is gone', async () => {
    const h = harness({ recordLineSignupFailures: 1 });
    await assert.rejects(() => h.useCase.execute(CMD, NOW));
    await assert.rejects(
      () => h.useCase.retryOwnedIntake({
        requestId: 'signup-1', idToken: CMD.idToken, version: 99,
        correlationRequestId: 'req-stale', webBaseUrl: CMD.webBaseUrl, apiBaseUrl: CMD.apiBaseUrl,
      }, NOW),
      /line_signup_version_conflict/,
    );
    const recovered = await h.useCase.retryOwnedIntake({
      requestId: 'signup-1', idToken: CMD.idToken, version: 0,
      correlationRequestId: 'req-retry', webBaseUrl: CMD.webBaseUrl, apiBaseUrl: CMD.apiBaseUrl,
    }, NOW);
    assert.equal(recovered.progress?.state, 'PENDING_REVIEW');
    assert.equal(recovered.progress?.requestId, 'signup-1');
  });

  it('corrects contact under the request version and invalidates the earlier review before resuming', async () => {
    const h = harness();
    const initial = await h.useCase.execute(CMD, NOW);
    h.patchRequest({
      reviewResolution: 'REQUEST_INFO', resolutionNote: 'อีเมลไม่ถูกต้อง',
      resolvedAt: NOW, resolvedByUserId: 'admin-1',
      repeatTrialGrantedAt: NOW, repeatTrialGrantedByUserId: 'admin-1', repeatTrialGrantNote: 'old',
      sharedContactReviewedAt: NOW, sharedContactReviewedByUserId: 'admin-1', sharedContactReviewNote: 'old',
    });
    const corrected = await h.useCase.correctContactEmail({
      requestId: initial.progress!.requestId,
      idToken: CMD.idToken,
      version: initial.progress!.version,
      contactEmail: ' Corrected@Example.TEST ',
      correlationRequestId: 'req-correct',
      webBaseUrl: CMD.webBaseUrl,
      apiBaseUrl: CMD.apiBaseUrl,
    }, NOW);

    assert.equal(corrected.progress?.contactEmail, 'corrected@example.test');
    assert.equal(corrected.progress?.state, 'PENDING_REVIEW');
    const mutation = h.updates.find((update: any) => update.data.contactEmail === 'corrected@example.test');
    assert.equal(mutation.data.reviewResolution, null);
    assert.equal(mutation.data.repeatTrialGrantedAt, null);
    assert.equal(mutation.data.sharedContactReviewedAt, null);
    assert.ok(h.audits.some((entry: any) => entry.data.action === 'signup.line.contact_email_corrected'));
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

  /**
   * Owner 2026-09-05: the phone became required. Two codes, both 400, because the LIFF page turns
   * them into the one sentence beside the field — and 400 rather than 422 so the page can tell a
   * fixable field apart from a shape it did not send.
   */
  it('refuses a missing or non-Thai-mobile phone with a coded 400', async () => {
    const h = harness();
    for (const [phoneNumber, code] of [
      [undefined, 'line_signup_phone_required'],
      ['', 'line_signup_phone_required'],
      ['  -  ', 'line_signup_phone_required'],
      ['12345', 'line_signup_phone_invalid'],
      ['08123456789', 'line_signup_phone_invalid'],
    ] as const) {
      await assert.rejects(
        () => h.useCase.execute({ ...CMD, phoneNumber: phoneNumber as string }, NOW),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException, `${phoneNumber} → 400`);
          assert.match(JSON.stringify(error.getResponse()), new RegExp(code));
          return true;
        },
      );
    }
    assert.deepEqual(h.created, [], 'nothing is created without a reachable number');

    // A bad company name still answers 422: it is not the field the page can point at.
    await assert.rejects(() => h.useCase.execute({ ...CMD, companyName: '   ' }, NOW), UnprocessableEntityException);
  });

  it('stores the phone as digits, however the shop owner spaced it', async () => {
    const h = harness();
    await h.useCase.execute({ ...CMD, phoneNumber: '081-234-5678' }, NOW);
    assert.equal(h.created[0].phoneNumber, '0812345678');
  });
});

describe('SubmitLineSignupUseCase — where the application goes', () => {
  it('MANUAL queues it for an admin and says so', async () => {
    const h = harness();
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress?.requestId, 'signup-1');
    assert.equal(result.progress?.state, 'PENDING_REVIEW');
    assert.equal(result.progress?.existingAccount, false);
    assert.equal(result.progress?.businessHours, true);
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

    assert.equal(result.progress!.state, 'COMPLETED');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'VALIDATED' }], 'no PENDING_REVIEW hop');
    assert.deepEqual(h.notified, [], 'and no admin is woken up');
    assert.equal(h.updates.find((update: any) => update.data.autoApproved)?.data.autoApproved, true);
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // Review HIGH-1: onboarding writes this id into two foreign keys, so it has to be a real user.
    assert.equal(h.provisioned[0].actorUserId, 'sysadmin-1');
    assert.equal(h.audits.at(-1).data.actorRefId, 'line-signup-auto-approve');
    assert.equal(h.audits[0].data.metadataJson.emailPreviouslyUsed, false);
  });

  it('reuses an already-claimed AUTO_FREE slot when the process dies before provisioning', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', provisionFailures: 1 });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /injected_before_provision/);
    assert.equal(h.current().state, 'VALIDATED');
    assert.equal(h.current().autoApproved, true);
    assert.equal(h.current().reviewResolution, 'NEW_SHOP');

    const recovered = await h.useCase.execute({ ...CMD, correlationRequestId: 'req-auto-replay' }, NOW);
    assert.equal(recovered.progress?.state, 'COMPLETED');
    assert.equal(h.capCounts.length, 1, 'replay does not claim or count another daily slot');
    assert.equal(h.provisioned.length, 2, 'the same request retries the failed external work');
    assert.equal(h.created.length, 1);
  });

  it('accepts reused owner email for manual review without an AUTO_FREE slot or provisioning', async () => {
    for (const approvalMode of ['AUTO_FREE', 'MANUAL'] as const) {
      const h = harness({ approvalMode, emailPreviouslyUsed: true, identity: { userId: 'staff-owner' }, memberships: [{ owner: false }] });
      const result = await h.useCase.execute({ ...CMD, contactEmail: ' Shop@Example.TEST ' }, NOW);
      assert.equal(result.progress!.state, 'PENDING_REVIEW');
      assert.deepEqual(h.notified, ['signup-1']);
      assert.deepEqual(h.provisioned, []);
      assert.ok(h.updates.every((update: any) => update.data.autoApproved === undefined));
      assert.deepEqual(h.capCounts, []);
      assert.deepEqual(h.alerts, []);
      assert.equal(h.audits[0].data.metadataJson.emailPreviouslyUsed, true);
      assert.equal(h.audits[0].data.metadataJson.manualReviewReason, 'email_previously_used');
      assert.equal(JSON.stringify(h.audits).includes('shop@example.test'), false);
      const read = h.emailReads[0]!;
      assert.deepEqual(read.values, [
        'staff-owner', 'staff-owner',
        'shop@example.test', 'shop@example.test', 'shop@example.test',
        'staff-owner', 'signup-1', 'shop@example.test', 'staff-owner',
      ]);
      for (const table of ['User', 'Company', 'CompanySignupRequest']) assert.ok(read.sql.includes(`FROM "${table}"`));
      assert.match(read.sql, /"id" <>/); assert.match(read.sql, /lower\(btrim\(csr\."contactEmail"\)\)/);
      assert.match(read.sql, /lower\(btrim\(u\."username"\)\)/);
      assert.match(read.sql, /"state"/);
      assert.doesNotMatch(read.sql, /ILIKE/);
    }
  });

  // Review MEDIUM-2: count-then-write lets N concurrent submits all read `cap - 1` and all pass,
  // which is the day the free AI budget is spent N times over.
  it('claims the daily slot under an advisory lock, counting only today Bangkok rows', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE' });
    await h.useCase.execute(CMD, NOW);

    assert.ok(h.locks.some((values) => values[0] === 'line-signup-auto-cap:2026-09-03'));
    const where = h.capCounts[0].where;
    assert.deepEqual(where.source, { in: ['line-oa', 'email-otp'] });
    assert.equal(where.autoApproved, true);
    // Bangkok midnight of 2026-09-03 is 2026-09-02T17:00Z.
    assert.equal(where.OR[0].approvedAt.gte.toISOString(), '2026-09-02T17:00:00.000Z');
    assert.equal(where.OR[1].approvedAt, null);
    assert.equal(where.OR[1].createdAt.gte.toISOString(), '2026-09-02T17:00:00.000Z');
  });

  it('sends the application to the queue when no SYSTEM_ADMIN can act as operator', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', systemAdmins: [] });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress!.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, []);
    assert.ok(h.updates.every((update: any) => update.data.autoApproved === undefined), 'no cap slot is burned');
    assert.equal(h.audits.at(-1).data.action, 'signup.line.auto_approve_no_actor');
  });

  it('falls back to the queue once the daily cap is spent (spec §9 item 3)', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', autoDailyCap: 20, approvedToday: 20 });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress!.state, 'PENDING_REVIEW');
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

    assert.equal(result.progress!.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, [], 'no shop is opened by the machine for a repeat trial');
    assert.ok(h.updates.every((update: any) => update.data.autoApproved === undefined), 'no daily cap slot is burned');
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

    assert.equal(result.progress!.state, 'COMPLETED', 'their first shop is a first shop');
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

    assert.equal(result.progress!.state, 'COMPLETED');
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
      assert.equal(result.progress!.state, 'PENDING_REVIEW', `${status} membership is still a shop they had`);
    }
  });

  it('still auto-approves a LINE account that has never had a shop', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', identity: { userId: 'user-old', status: 'UNLINKED' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress!.state, 'COMPLETED', 'an unlinked identity alone is not a repeat trial');
    assert.equal(h.audits[0].data.metadataJson.repeatTrial, false);
  });

  it('treats a second shop for an ACTIVE account as a repeat trial too', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', identity: { userId: 'user-9' }, memberships: [{ owner: true }] });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress!.state, 'PENDING_REVIEW');
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

    assert.equal(result.progress!.existingAccount, true);
    assert.equal(h.created[0].attachUserId, 'user-9');
  });

  it('reads the identity slot without a status filter', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);
    // UAT cmto4xtrx002r4o5tf7o38dls: with `status: 'ACTIVE'` in this where-clause an UNLINKED row
    // was invisible here and fatal in onboarding, because the unique slot belongs to it regardless.
    const unfiltered = h.identityReads.find((read) => read.where.status === undefined)!;
    assert.deepEqual(unfiltered.where, {
      provider: 'LINE', providerUserId: 'Uline-1', providerChannelId: 'channel-1',
    });
  });

  it('opens a NEW account when the LINE account was unlinked earlier', async () => {
    // The UAT shape: linked once, unlinked, applying again. Before the fix this reached onboarding
    // as "brand new", whose `externalIdentity.create` then died on the unique slot the stale row
    // still owns — 409 twice, PROVISIONING_FAILED, and every admin retry the same.
    const h = harness({ identity: { userId: 'user-old', status: 'UNLINKED' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.progress!.existingAccount, false, 'the old account is not where this shop belongs');
    assert.equal(h.created[0].attachUserId, undefined);
    assert.equal(result.progress!.state, 'PENDING_REVIEW', 'and the application is a real one, not a refusal');
  });

  it('refuses at submit when the account behind the LINE identity is suspended', async () => {
    const h = harness({ identity: { userId: 'user-9', user: { status: 'SUSPENDED' } } });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_account_blocked/);
    assert.deepEqual(h.created, [], 'no application row exists for a refusal');
    assert.deepEqual(h.userQuotas, ['attempt:Uline-1'], 'no creation quota spent');
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
    assert.equal(result.progress!.state, 'PENDING_REVIEW', 'the ordinary "I closed my old shop" case is untouched');
  });

  it('tells the LIFF page which waiting message to show', async () => {
    const inHours = await harness().useCase.execute(CMD, NOW);
    assert.equal(inHours.progress!.businessHours, true);
    // Sunday: the office is shut, so the page promises the next business day instead.
    const sunday = await harness().useCase.execute(CMD, new Date('2026-09-06T10:00:00+07:00'));
    assert.equal(sunday.progress!.businessHours, false);
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
