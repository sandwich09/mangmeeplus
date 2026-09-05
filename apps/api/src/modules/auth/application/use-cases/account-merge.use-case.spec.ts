import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountMergeUseCase } from './account-merge.use-case';
import { hashToken } from '../../domain/logic/secure-token.logic';

const RAW_TICKET = 'raw-merge-ticket-value';

type MembershipRow = {
  id: string; companyId: string; userId: string; status: string;
  /** Review R05: the merge's verdict now depends on these, so the fixtures have to carry them. */
  roleKeys?: string[]; companyName?: string;
};
type UserRow = {
  id: string; email: string | null; emailVerifiedAt: Date | null; status: string;
  displayName?: string; username?: string | null;
};

type HarnessOptions = {
  ticket?: Record<string, unknown>;
  newUser?: Partial<UserRow>;
  existingUser?: Partial<UserRow> | null;
  memberships?: MembershipRow[];
  profiles?: Array<{ membershipId: string; userId: string }>;
  /** Simulates the CAS losing to a concurrent confirm. */
  ticketAlreadyClaimed?: boolean;
  /** Which accounts have a username/password credential; default: the one being merged away. */
  credentials?: string[];
  /** Which accounts have a LINE identity; default: the one that survives. */
  lineIdentities?: string[];
};

/**
 * In-memory stand-in for the two users, their memberships and the ticket row. There is deliberately
 * no `membershipRole` or `membershipBranchScope` delegate: those hang off membershipId, so a use
 * case that tried to rewrite them would throw here instead of quietly passing.
 */
function makeHarness(opts: HarnessOptions = {}) {
  const users: Record<string, UserRow> = {
    'new-1': { id: 'new-1', email: 'new@example.com', emailVerifiedAt: new Date('2026-08-30T00:00:00Z'), status: 'ACTIVE', displayName: 'บัญชีใหม่', username: 'somchai', ...opts.newUser },
    ...(opts.existingUser === null
      ? {}
      : { 'existing-1': { id: 'existing-1', email: null, emailVerifiedAt: null, status: 'ACTIVE', displayName: 'บัญชีเดิม', username: null, ...opts.existingUser } as UserRow }),
  };
  const memberships: MembershipRow[] = opts.memberships ?? [
    { id: 'm-new-a', companyId: 'co-a', userId: 'new-1', status: 'ACTIVE' },
  ];
  const profiles = opts.profiles ?? [];
  const tickets = [{
    id: 'ticket-1',
    tokenHash: hashToken(RAW_TICKET),
    newUserId: 'new-1',
    existingUserId: 'existing-1',
    lineProviderUserId: 'line-user-1',
    requestId: 'req-mint',
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null as Date | null,
    ...opts.ticket,
  }];
  const sessionRevocations: unknown[] = [];
  const issued: Array<{ userId: string; provider: string }> = [];
  const audits: any[] = [];

  const client: any = {
    accountMergeTicket: {
      findUnique: async ({ where }: any) => tickets.find((t) => t.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const match = tickets.filter((t) => t.id === where.id && t.consumedAt === where.consumedAt);
        if (opts.ticketAlreadyClaimed) return { count: 0 };
        match.forEach((t) => Object.assign(t, data));
        return { count: match.length };
      },
    },
    user: {
      // Copies, like Prisma: a row read before an update must not change under the reader.
      findUnique: async ({ where }: any) => (users[where.id] ? { ...users[where.id]! } : null),
      update: async ({ where, data }: any) => Object.assign(users[where.id]!, data),
    },
    companyMembership: {
      // Prisma returns exactly what is selected, so the relations the merge now reads (the role
      // keys and the shop name) are shaped here rather than handed back as raw fixture fields.
      findMany: async ({ where }: any) => memberships
        .filter((m) => m.userId === where.userId
          && (where.status ? m.status === where.status : true)
          && (where.companyId?.in ? where.companyId.in.includes(m.companyId) : true))
        .map((m) => ({
          ...m,
          roles: (m.roleKeys ?? []).map((key) => ({ role: { key } })),
          company: { name: m.companyName ?? m.companyId },
        })),
      update: async ({ where, data }: any) => Object.assign(memberships.find((m) => m.id === where.id)!, data),
    },
    userCredential: {
      findUnique: async ({ where }: any) => (opts.credentials ?? ['new-1']).includes(where.userId)
        ? { userId: where.userId, status: 'ACTIVE' }
        : null,
    },
    externalIdentity: {
      findFirst: async ({ where }: any) => ((opts.lineIdentities ?? ['existing-1']).includes(where.userId)
        ? { userId: where.userId }
        : null),
    },
    employeeAccessProfile: {
      updateMany: async ({ where, data }: any) => {
        const match = profiles.filter((p) => where.membershipId.in.includes(p.membershipId));
        match.forEach((p) => Object.assign(p, data));
        return { count: match.length };
      },
    },
    authSession: {
      updateMany: async (args: any) => { sessionRevocations.push(args); return { count: 1 }; },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };

  const issueToken = {
    execute: async (userId: string, provider: string) => {
      issued.push({ userId, provider });
      return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    },
  } as any;
  const audit = { log: async (entry: unknown) => { audits.push(entry); } } as any;

  const useCase = new AccountMergeUseCase({ client } as any, issueToken, audit);
  const run = (ticket = RAW_TICKET, userId = 'new-1') => useCase.execute({ userId, ticket, requestId: 'req-1' });
  const preview = (ticket = RAW_TICKET, userId = 'new-1') => useCase.preview({ userId, ticket });
  const mergeAudit = () => audits.find((entry) => entry.action === 'auth.account.merge');
  return { run, preview, users, memberships, profiles, tickets, sessionRevocations, issued, audits, mergeAudit };
}

describe('AccountMergeUseCase', () => {
  it('moves the memberships, the email and the session to the existing account, then disables the emptied one', async () => {
    const h = makeHarness({
      memberships: [
        { id: 'm-new-a', companyId: 'co-a', userId: 'new-1', status: 'ACTIVE' },
        { id: 'm-new-b', companyId: 'co-b', userId: 'new-1', status: 'ACTIVE' },
        // An already-inactive membership is not the user's working access and stays where it is.
        { id: 'm-new-old', companyId: 'co-old', userId: 'new-1', status: 'DISABLED' },
      ],
      profiles: [{ membershipId: 'm-new-a', userId: 'new-1' }],
    });

    const result = await h.run();

    assert.deepEqual(result, { merged: true, accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
    // The caller ends up signed in as the existing account, on the LINE credential they just proved.
    assert.deepEqual(h.issued, [{ userId: 'existing-1', provider: 'line' }]);

    // Memberships change owner in place, so MembershipRole/MembershipBranchScope (keyed by
    // membershipId) ride along untouched — the harness would throw if they were rewritten.
    assert.equal(h.memberships.find((m) => m.id === 'm-new-a')!.userId, 'existing-1');
    assert.equal(h.memberships.find((m) => m.id === 'm-new-b')!.userId, 'existing-1');
    assert.equal(h.memberships.find((m) => m.id === 'm-new-a')!.status, 'ACTIVE');
    assert.equal(h.memberships.find((m) => m.id === 'm-new-old')!.userId, 'new-1');
    // The profile's own userId column has to follow, or an ACTIVE membership points at a disabled user.
    assert.deepEqual(h.profiles, [{ membershipId: 'm-new-a', userId: 'existing-1' }]);

    assert.equal(h.users['existing-1']!.email, 'new@example.com');
    assert.deepEqual(h.users['existing-1']!.emailVerifiedAt, new Date('2026-08-30T00:00:00Z'));
    assert.equal(h.users['new-1']!.email, null);
    assert.equal(h.users['new-1']!.emailVerifiedAt, null);
    assert.equal(h.users['new-1']!.status, 'DISABLED');

    // The emptied account's sessions die with it; refresh only reads the session row.
    assert.deepEqual(h.sessionRevocations, [{
      where: { userId: 'new-1', status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: h.tickets[0]!.consumedAt },
    }]);

    assert.ok(h.tickets[0]!.consumedAt, 'the ticket is spent');
    const audited = h.mergeAudit();
    assert.equal(audited.riskLevel, 'HIGH');
    assert.equal(audited.actorUserId, 'new-1');
    assert.equal(audited.targetId, 'existing-1');
    assert.deepEqual(audited.metadataJson, {
      newUserId: 'new-1',
      existingUserId: 'existing-1',
      movedCompanyIds: ['co-a', 'co-b'],
      skippedCompanyIds: [],
      emailMoved: true,
      emailKeptExisting: false,
    });
  });

  it('keeps the existing address when the target already has one', async () => {
    const h = makeHarness({ existingUser: { email: 'owner@example.com' } });

    await h.run();

    assert.equal(h.users['existing-1']!.email, 'owner@example.com');
    assert.equal(h.users['new-1']!.email, 'new@example.com', 'a kept target address leaves the source untouched');
    assert.equal(h.mergeAudit().metadataJson.emailMoved, false);
    assert.equal(h.mergeAudit().metadataJson.emailKeptExisting, true);
  });

  it('records no email move when the emptied account has no address', async () => {
    const h = makeHarness({ newUser: { email: null, emailVerifiedAt: null } });

    await h.run();

    assert.equal(h.users['existing-1']!.email, null);
    assert.equal(h.mergeAudit().metadataJson.emailMoved, false);
  });

  it('deactivates rather than moves a membership in a company the target already belongs to', async () => {
    const h = makeHarness({
      memberships: [
        { id: 'm-new-a', companyId: 'co-a', userId: 'new-1', status: 'ACTIVE' },
        { id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE' },
        { id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: 'ACTIVE' },
      ],
    });

    await h.run();

    // @@unique([companyId, userId]) makes a move impossible here; the target's own row is the
    // one that keeps its roles, and the duplicate is disabled instead of deleted.
    const duplicate = h.memberships.find((m) => m.id === 'm-new-shared')!;
    assert.equal(duplicate.userId, 'new-1');
    assert.equal(duplicate.status, 'DISABLED');
    assert.equal(h.memberships.find((m) => m.id === 'm-old-shared')!.status, 'ACTIVE');
    assert.deepEqual(h.mergeAudit().metadataJson.movedCompanyIds, ['co-a']);
    assert.deepEqual(h.mergeAudit().metadataJson.skippedCompanyIds, ['co-shared']);
  });

  /**
   * Review R05. Both fixtures come from the report: the account being merged away is the SOLE
   * ACTIVE OWNER of a shop, and the account it would merge into already holds an employee
   * membership there. Disabling the owner row leaves the shop with no owner — in the second
   * fixture, with no active access at all.
   */
  describe('overlapping memberships fail closed', () => {
    const owningTheSameShop = (targetStatus: string) => ({
      memberships: [
        {
          id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE',
          roleKeys: ['OWNER'], companyName: 'ร้านมั่งมี',
        },
        {
          id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: targetStatus,
          roleKeys: ['STAFF'], companyName: 'ร้านมั่งมี',
        },
      ],
    });

    for (const targetStatus of ['ACTIVE', 'DISABLED']) {
      it(`refuses rather than close the sole owner out of a shop (target membership ${targetStatus})`, async () => {
        const h = makeHarness(owningTheSameShop(targetStatus));

        await assert.rejects(() => h.run(), (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.equal((error.getResponse() as { code?: string }).code, 'account_merge_role_conflict');
          return true;
        });

        // Nothing may have moved: this is a refusal, not a partial merge.
        const owner = h.memberships.find((m) => m.id === 'm-new-shared')!;
        assert.equal(owner.status, 'ACTIVE', 'the only active owner must survive the refusal');
        assert.equal(owner.userId, 'new-1');
        assert.equal(h.users['new-1']!.status, 'ACTIVE', 'a refused merge closes no account');
        assert.equal(h.tickets[0]!.consumedAt, null, 'a refused merge leaves the offer usable');
        assert.deepEqual(h.issued, [], 'and issues no session');
      });
    }

    it('still allows the overlap when the two memberships are the same thing', async () => {
      const h = makeHarness({
        memberships: [
          { id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE', roleKeys: ['OWNER'] },
          { id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: 'ACTIVE', roleKeys: ['OWNER'] },
        ],
      });

      await h.run();

      assert.equal(h.memberships.find((m) => m.id === 'm-new-shared')!.status, 'DISABLED');
      assert.equal(h.memberships.find((m) => m.id === 'm-old-shared')!.status, 'ACTIVE');
    });
  });

  describe('preview', () => {
    it('says per shop what will happen, and which way of signing in survives', async () => {
      const h = makeHarness({
        memberships: [
          { id: 'm-new-a', companyId: 'co-a', userId: 'new-1', status: 'ACTIVE', roleKeys: ['OWNER'], companyName: 'ร้านหนึ่ง' },
          { id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE', roleKeys: ['OWNER'], companyName: 'ร้านสอง' },
          { id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: 'ACTIVE', roleKeys: ['OWNER'], companyName: 'ร้านสอง' },
        ],
      });

      const plan = await h.preview();

      assert.equal(plan.canMerge, true);
      assert.deepEqual(plan.companies, [
        { companyName: 'ร้านหนึ่ง', outcome: 'move' },
        { companyName: 'ร้านสอง', outcome: 'close_duplicate' },
      ]);
      // The surviving account signs in with LINE; the username and password being merged away stop
      // working, and the dialog has to be able to say so before the button is pressed.
      assert.deepEqual(plan.keeps, { displayName: 'บัญชีเดิม', signInWith: ['line'] });
      assert.deepEqual(plan.closes, { displayName: 'บัญชีใหม่', username: 'somchai', signInWith: ['password'] });
    });

    it('names the shop that blocks the merge', async () => {
      const h = makeHarness({
        memberships: [
          { id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE', roleKeys: ['OWNER'], companyName: 'ร้านมั่งมี' },
          { id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: 'ACTIVE', roleKeys: ['STAFF'], companyName: 'ร้านมั่งมี' },
        ],
      });

      const plan = await h.preview();

      assert.equal(plan.canMerge, false);
      // The owner invariant is checked before the role rule, so the reason names the real problem:
      // this shop would be left without an owner, not merely with two disagreeing role sets.
      assert.deepEqual(plan.companies, [
        { companyName: 'ร้านมั่งมี', outcome: 'blocked', reason: 'last_active_owner' },
      ]);
    });

    it('reports a plain role disagreement as one, when no owner is at stake', async () => {
      const h = makeHarness({
        memberships: [
          { id: 'm-new-shared', companyId: 'co-shared', userId: 'new-1', status: 'ACTIVE', roleKeys: ['STAFF'], companyName: 'ร้านมั่งมี' },
          { id: 'm-old-shared', companyId: 'co-shared', userId: 'existing-1', status: 'ACTIVE', roleKeys: ['ACCOUNTANT'], companyName: 'ร้านมั่งมี' },
        ],
      });

      const plan = await h.preview();

      assert.equal(plan.canMerge, false);
      assert.deepEqual(plan.companies, [
        { companyName: 'ร้านมั่งมี', outcome: 'blocked', reason: 'role_conflict' },
      ]);
    });

    it('reads nothing and changes nothing for a ticket that is not the caller\'s', async () => {
      const h = makeHarness();
      await assert.rejects(() => h.preview(RAW_TICKET, 'someone-else'), ForbiddenException);
      assert.equal(h.tickets[0]!.consumedAt, null);
    });
  });

  it('rejects an unknown ticket', async () => {
    const h = makeHarness();
    await assert.rejects(() => h.run('not-a-real-ticket'), (err: unknown) => {
      assert.ok(err instanceof NotFoundException);
      assert.equal((err.getResponse() as any).code, 'merge_ticket_invalid');
      return true;
    });
    assert.equal(h.users['new-1']!.status, 'ACTIVE');
  });

  it('rejects an expired ticket without touching either account', async () => {
    const h = makeHarness({ ticket: { expiresAt: new Date(Date.now() - 1000) } });

    await assert.rejects(() => h.run(), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err.getResponse() as any).code, 'merge_ticket_expired');
      return true;
    });
    assert.equal(h.users['new-1']!.status, 'ACTIVE');
    assert.equal(h.memberships[0]!.userId, 'new-1');
    assert.equal(h.issued.length, 0);
  });

  it('replays a spent ticket as success for the same caller, without merging twice', async () => {
    const h = makeHarness({
      ticket: { consumedAt: new Date('2026-08-31T10:00:00Z') },
      // Post-merge shape: the memberships already moved on the first call.
      memberships: [{ id: 'm-new-a', companyId: 'co-a', userId: 'existing-1', status: 'ACTIVE' }],
    });

    const result = await h.run();

    assert.deepEqual(result, { merged: true, accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
    assert.deepEqual(h.issued, [{ userId: 'existing-1', provider: 'line' }]);
    assert.equal(h.mergeAudit(), undefined, 'a replay writes no second merge record');
    assert.equal(h.sessionRevocations.length, 0);
  });

  it('replays a spent ticket even after it expired — the merge already committed', async () => {
    const h = makeHarness({
      ticket: { consumedAt: new Date('2026-08-31T10:00:00Z'), expiresAt: new Date(Date.now() - 1000) },
    });

    assert.equal((await h.run()).merged, true);
  });

  it('refuses a spent ticket presented by a different session', async () => {
    const h = makeHarness({ ticket: { consumedAt: new Date('2026-08-31T10:00:00Z') } });

    await assert.rejects(() => h.run(RAW_TICKET, 'someone-else'), (err: unknown) => {
      assert.ok(err instanceof ForbiddenException);
      assert.equal((err.getResponse() as any).code, 'merge_ticket_not_yours');
      return true;
    });
    assert.equal(h.issued.length, 0, 'a stolen ticket must never mint a session');
  });

  it('refuses a live ticket presented by a different session', async () => {
    const h = makeHarness();

    await assert.rejects(() => h.run(RAW_TICKET, 'someone-else'), ForbiddenException);
    assert.equal(h.users['new-1']!.status, 'ACTIVE');
    assert.equal(h.issued.length, 0);
  });

  it('refuses to merge into an account that is not active', async () => {
    for (const status of ['DISABLED', 'SUSPENDED']) {
      const h = makeHarness({ existingUser: { status } });
      await assert.rejects(() => h.run(), (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.equal((err.getResponse() as any).code, 'merge_target_unavailable');
        return true;
      });
      assert.equal(h.users['new-1']!.status, 'ACTIVE');
      assert.equal(h.issued.length, 0);
    }
  });

  it('refuses to merge into an account that no longer exists', async () => {
    const h = makeHarness({ existingUser: null });

    await assert.rejects(() => h.run(), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err.getResponse() as any).code, 'merge_target_unavailable');
      return true;
    });
  });

  it('refuses a ticket whose two sides are the same account', async () => {
    const h = makeHarness({ ticket: { existingUserId: 'new-1' } });

    await assert.rejects(() => h.run(), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err.getResponse() as any).code, 'merge_not_needed');
      return true;
    });
  });

  it('loses the CAS to a concurrent confirm instead of merging twice (double-click race)', async () => {
    const h = makeHarness({ ticketAlreadyClaimed: true });

    await assert.rejects(() => h.run(), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err.getResponse() as any).code, 'merge_in_progress');
      return true;
    });
    // Nothing after the claim may have run: the loser must not move a membership or disable a user.
    assert.equal(h.memberships[0]!.userId, 'new-1');
    assert.equal(h.users['new-1']!.status, 'ACTIVE');
    assert.equal(h.issued.length, 0);
  });
});
