import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MintLineHandoffTokenUseCase } from './application/use-cases/mint-line-handoff-token.use-case';
import { ExchangeLineHandoffTokenUseCase } from './application/use-cases/exchange-line-handoff-token.use-case';
import { hashLineHandoffToken, LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN } from './domain/logic/line-handoff.logic';

const COMPANY = 'co-1';
const USER = 'user-1';
const LINE_USER = 'Uabc123';
const TARGET = `/companies/${COMPANY}/expenses/exp-1`;
const RAW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1);

type Row = {
  id: string;
  tokenHash: string;
  userId: string;
  companyId: string;
  lineUserId: string;
  targetPath: string;
  surface: string;
  status: 'PENDING' | 'USED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'handoff-1',
  tokenHash: hashLineHandoffToken(RAW_TOKEN),
  userId: USER,
  companyId: COMPANY,
  lineUserId: LINE_USER,
  targetPath: TARGET,
  surface: 'line_ai_reply',
  status: 'PENDING',
  expiresAt: future(),
  ...overrides,
});

function makeAudit() {
  const logged: any[] = [];
  return { logged, audit: { log: async (entry: unknown) => { logged.push(entry); } } as any };
}

const assertNoRawTokenAnywhere = (recorded: any[]) => {
  assert.ok(!JSON.stringify(recorded).includes(RAW_TOKEN), 'the raw token must never be recorded');
};

// ---- MintLineHandoffTokenUseCase ----

function makeMintPrisma() {
  const created: any[] = [];
  const prisma = {
    client: {
      lineWebHandoffToken: {
        create: async (args: any) => { created.push(args); return { id: 'handoff-1', ...args.data }; },
      },
    },
  } as any;
  return { prisma, created };
}

describe('MintLineHandoffTokenUseCase', () => {
  it('stores only the hash and returns the raw token to the caller', async () => {
    const { prisma, created } = makeMintPrisma();
    const { audit, logged } = makeAudit();
    const uc = new MintLineHandoffTokenUseCase(prisma, audit);

    const result = await uc.execute({
      userId: USER, companyId: COMPANY, lineUserId: LINE_USER, surface: 'line_ai_reply', targetPath: TARGET,
    });

    assert.match(result.rawToken, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(result.expiresAt.getTime() > Date.now());
    const data = created[0].data;
    assert.equal(data.tokenHash, hashLineHandoffToken(result.rawToken));
    assert.ok(!('rawToken' in data) && !('token' in data), 'the raw token must never be persisted');
    assert.ok(!JSON.stringify(created).includes(result.rawToken));
    assert.equal(data.userId, USER);
    assert.equal(data.companyId, COMPANY);
    assert.equal(data.lineUserId, LINE_USER);
    assert.equal(data.targetPath, TARGET);
    assert.equal(data.surface, 'line_ai_reply');

    assert.equal(logged[0].action, 'auth.line_handoff.issue');
    assert.equal(logged[0].result, 'SUCCESS');
    assert.equal(logged[0].riskLevel, 'MEDIUM');
    assert.equal(logged[0].actorUserId, USER);
    assert.deepEqual(logged[0].metadataJson, { surface: 'line_ai_reply', companyId: COMPANY, targetPath: TARGET });
    assert.ok(!JSON.stringify(logged).includes(result.rawToken), 'audit metadata must never carry the token');
  });

  it('throws on a path outside the company tenant root, and writes no row', async () => {
    const { prisma, created } = makeMintPrisma();
    const { audit, logged } = makeAudit();
    const uc = new MintLineHandoffTokenUseCase(prisma, audit);

    await assert.rejects(
      () => uc.execute({
        userId: USER, companyId: COMPANY, lineUserId: LINE_USER, surface: 'line_ai_reply',
        targetPath: '/companies/co-2/expenses/exp-1',
      }),
      BadRequestException,
    );
    assert.equal(created.length, 0, 'an unsafe path must not reach the database');
    assert.equal(logged.length, 0, 'a refused mint must not write an issue audit row');
  });

  it('throws on an off-origin destination rather than minting a link to it', async () => {
    const { prisma, created } = makeMintPrisma();
    const uc = new MintLineHandoffTokenUseCase(prisma);
    await assert.rejects(
      () => uc.execute({
        userId: USER, companyId: COMPANY, lineUserId: LINE_USER, surface: 'line_ai_reply',
        targetPath: '//evil.example/companies/co-1',
      }),
      BadRequestException,
    );
    assert.equal(created.length, 0);
  });
});

// ---- ExchangeLineHandoffTokenUseCase ----

function makeExchangePrisma(options: {
  row: Row | null;
  userStatus?: 'ACTIVE' | 'SUSPENDED' | null;
  mustChangePassword?: boolean;
  hasCredential?: boolean;
  membership?: { id: string } | null;
  companyStatus?: 'ACTIVE' | 'SUSPENDED' | null;
  updatedCount?: number;
  /** The LINE context write is best-effort: the web half must survive the LINE half failing. */
  contextUpsertThrows?: boolean;
  /** The ACTIVE LINE identity behind this chat. Omitted = still this user's; `null` = severed
   *  (UNLINKED or deleted); a different `userId` = the LINE account was re-pointed at somebody else. */
  identity?: { userId: string; providerUserId: string } | null;
}) {
  const finds: any[] = [];
  const updates: any[] = [];
  const contextUpserts: any[] = [];
  const identityFinds: any[] = [];
  // Applies the WHERE for real rather than recording the call: a guard that forgets `status`,
  // `providerUserId` or `userId` must fail, not pass on a query nobody inspected.
  const identityRow = options.identity === undefined ? { userId: USER, providerUserId: LINE_USER } : options.identity;
  const prisma = {
    client: {
      externalIdentity: {
        findFirst: async (args: any) => {
          identityFinds.push(args);
          const { where } = args;
          if (!identityRow) return null;
          const matches = where.provider === 'LINE'
            && where.status === 'ACTIVE'
            && where.providerUserId === identityRow.providerUserId
            && where.userId === identityRow.userId;
          return matches ? { id: 'ei-1' } : null;
        },
      },
      lineCompanyContext: {
        upsert: async (args: any) => {
          if (options.contextUpsertThrows) throw new Error('context write exploded');
          contextUpserts.push(args);
          return { id: 'ctx-1' };
        },
      },
      lineWebHandoffToken: {
        findUnique: async (args: unknown) => { finds.push(args); return options.row; },
        updateMany: async (args: unknown) => { updates.push(args); return { count: options.updatedCount ?? 1 }; },
      },
      user: {
        findUnique: async () => (options.userStatus
          ? {
            status: options.userStatus,
            credential: options.hasCredential === false
              ? null
              : { mustChangePassword: options.mustChangePassword ?? false },
          }
          : null),
      },
      companyMembership: {
        findFirst: async () => (options.membership === undefined ? { id: 'mem-1' } : options.membership),
      },
      company: {
        findUnique: async () => (options.companyStatus === null ? null : { status: options.companyStatus ?? 'ACTIVE' }),
      },
    },
  } as any;
  return { prisma, finds, updates, contextUpserts, identityFinds };
}

const issueToken = (calls: unknown[][]) => ({
  execute: async (...args: unknown[]) => {
    calls.push(args);
    return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
  },
}) as any;

const legalAcceptance = (required = false, calls: unknown[] = []) => ({
  getStatus: async (locator: unknown) => { calls.push(locator); return { required }; },
}) as any;

/** Runs an exchange expected to fail and returns the thrown ForbiddenException. */
async function refusal(uc: ExchangeLineHandoffTokenUseCase): Promise<ForbiddenException> {
  try {
    await uc.execute({ token: RAW_TOKEN });
  } catch (error) {
    assert.ok(error instanceof ForbiddenException, 'every refusal is a 403');
    return error;
  }
  throw new Error('expected the exchange to refuse');
}

describe('ExchangeLineHandoffTokenUseCase success', () => {
  it('issues a line-provider session and returns the row-stored destination', async () => {
    const calls: unknown[][] = [];
    const legalCalls: unknown[] = [];
    const { prisma, finds, updates } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE' });
    const { audit, logged } = makeAudit();
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false, legalCalls), audit);

    const result = await uc.execute({ token: RAW_TOKEN });

    assert.deepEqual(result, {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
      companyId: COMPANY,
      targetPath: TARGET,
      mustChangePassword: false,
      legalAcceptanceRequired: false,
    });
    // Q1 (owner decision 2026-08-29): the session carries the true origin, `'line'`.
    assert.deepEqual(calls, [[USER, 'line']]);
    // Looked up by hash only — the raw token never reaches the query.
    assert.equal((finds[0] as any).where.tokenHash, hashLineHandoffToken(RAW_TOKEN));
    assertNoRawTokenAnywhere(finds);
    // Claim before issue, conditional on PENDING.
    assert.deepEqual(updates[0].where, { id: 'handoff-1', status: 'PENDING' });
    assert.equal(updates[0].data.status, 'USED');
    assert.ok(updates[0].data.usedAt instanceof Date);
    // Legal acceptance is resolved for the membership the exchange just re-verified.
    assert.deepEqual(legalCalls, [{ userId: USER, companyId: COMPANY, membershipId: 'mem-1' }]);

    assert.equal(logged[0].action, 'auth.line_handoff.exchange');
    assert.equal(logged[0].result, 'SUCCESS');
    assert.equal(logged[0].riskLevel, 'MEDIUM');
    assert.deepEqual(logged[0].metadataJson, { surface: 'line_ai_reply' });
    assertNoRawTokenAnywhere(logged);
  });

  it('carries mustChangePassword and legalAcceptanceRequired through, as password login does', async () => {
    const { prisma } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE', mustChangePassword: true });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(true));
    const result = await uc.execute({ token: RAW_TOKEN });
    assert.equal(result.mustChangePassword, true);
    assert.equal(result.legalAcceptanceRequired, true);
  });

  it('reports mustChangePassword false for a LINE-only user with no credential row', async () => {
    const { prisma } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE', hasCredential: false });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    assert.equal((await uc.execute({ token: RAW_TOKEN })).mustChangePassword, false);
  });

  it('returns the company and path from the row, never from the request', async () => {
    const { prisma } = makeExchangePrisma({
      row: row({ companyId: 'co-9', targetPath: '/companies/co-9/reimbursements/r-2' }),
      userStatus: 'ACTIVE',
    });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    const result = await uc.execute({ token: RAW_TOKEN });
    assert.equal(result.companyId, 'co-9');
    assert.equal(result.targetPath, '/companies/co-9/reimbursements/r-2');
  });
});

/**
 * Owner 2026-09-06: the บริษัทของฉัน picker's second button must "สลับบริษัทและพาไปเว็บไซต์ตามบริษัทนั้น"
 * in ONE tap. LINE cannot tell the server a `uri` button was pressed, so the LINE-side switch has
 * to happen here — and ONLY for that surface, because every other handoff link (an alert, an
 * assistant reply) must never silently move the chat the customer is holding.
 */
describe('ExchangeLineHandoffTokenUseCase company-picker surface', () => {
  const pickerRow = () => row({ surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN, targetPath: `/companies/${COMPANY}/dashboard` });

  it('switches the LINE chat to the token’s company and audits it', async () => {
    const { prisma, contextUpserts } = makeExchangePrisma({ row: pickerRow(), userStatus: 'ACTIVE' });
    const { audit, logged } = makeAudit();
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false), audit);

    const result = await uc.execute({ token: RAW_TOKEN });

    assert.equal(result.targetPath, `/companies/${COMPANY}/dashboard`);
    assert.equal(contextUpserts.length, 1);
    assert.deepEqual(contextUpserts[0].where, { lineUserId: LINE_USER });
    assert.equal(contextUpserts[0].create.companyId, COMPANY);
    assert.equal(contextUpserts[0].update.companyId, COMPANY);
    // Same rule as the in-LINE switch: a support hold means a human has this thread, and opening
    // the web is not a request to hand it back.
    assert.equal('aiPausedUntil' in contextUpserts[0].update, false, 'the §8 hold is kept');

    const switchAudit = logged.find((entry) => entry.action === 'ai.line.company_context.switch');
    assert.ok(switchAudit, 'the context change is audited exactly as the in-LINE switch is');
    assert.equal(switchAudit.result, 'SUCCESS');
    assert.equal(switchAudit.actorUserId, USER);
    assert.equal(switchAudit.companyId, COMPANY);
    assert.equal(switchAudit.metadataJson.surface, LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN);
    assert.equal(switchAudit.metadataJson.lineUserId, '[REDACTED]');
    assertNoRawTokenAnywhere(logged);
  });

  it('switches only AFTER the single-use claim, so a spent link cannot move the chat', async () => {
    const order: string[] = [];
    const { prisma, contextUpserts } = makeExchangePrisma({ row: pickerRow(), userStatus: 'ACTIVE' });
    const claim = prisma.client.lineWebHandoffToken.updateMany;
    prisma.client.lineWebHandoffToken.updateMany = async (args: any) => { order.push('claim'); return claim(args); };
    const upsert = prisma.client.lineCompanyContext.upsert;
    prisma.client.lineCompanyContext.upsert = async (args: any) => { order.push('switch'); return upsert(args); };
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    await uc.execute({ token: RAW_TOKEN });
    assert.deepEqual(order, ['claim', 'switch']);
    assert.equal(contextUpserts.length, 1);

    // A second tap loses the claim and must change nothing at all.
    const spent = makeExchangePrisma({ row: pickerRow(), userStatus: 'ACTIVE', updatedCount: 0 });
    const spentUc = new ExchangeLineHandoffTokenUseCase(spent.prisma, issueToken([]), legalAcceptance(false));
    await refusal(spentUc);
    assert.deepEqual(spent.contextUpserts, []);
  });

  it('leaves every other surface’s chat exactly where it was', async () => {
    for (const surface of ['line_ai_reply', 'notification_push', 'company_picker_open', '']) {
      const { prisma, contextUpserts } = makeExchangePrisma({ row: row({ surface }), userStatus: 'ACTIVE' });
      const { audit, logged } = makeAudit();
      const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false), audit);
      await uc.execute({ token: RAW_TOKEN });
      assert.deepEqual(contextUpserts, [], `${surface || '(empty)'} must never move the chat`);
      assert.equal(logged.some((entry) => entry.action === 'ai.line.company_context.switch'), false);
    }
  });

  it('still issues the session when the context write fails — the web half must not die with it', async () => {
    const calls: unknown[][] = [];
    const warnings: unknown[] = [];
    const { prisma } = makeExchangePrisma({ row: pickerRow(), userStatus: 'ACTIVE', contextUpsertThrows: true });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false));
    (uc as any).logger = { warn: (entry: unknown) => warnings.push(entry) };

    const result = await uc.execute({ token: RAW_TOKEN });

    assert.equal(result.accessToken, 'access');
    assert.equal(calls.length, 1, 'the session is issued regardless');
    assert.equal((warnings[0] as any).msg, 'line_handoff_company_switch_failed');
    assertNoRawTokenAnywhere(warnings);
  });
});

describe('ExchangeLineHandoffTokenUseCase refusals', () => {
  it('refuses an unknown token with no destination to leak', async () => {
    const calls: unknown[][] = [];
    const { prisma, updates } = makeExchangePrisma({ row: null });
    const { audit, logged } = makeAudit();
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false), audit);

    const error = await refusal(uc);
    const body = error.getResponse() as Record<string, unknown>;
    assert.equal(body['targetPath'], undefined, 'an unknown token must not echo a path back');
    assert.equal(logged[0].action, 'auth.line_handoff.exchange');
    assert.equal(logged[0].result, 'FAILED');
    assert.equal(logged[0].riskLevel, 'MEDIUM');
    assert.deepEqual(logged[0].metadataJson, { reason: 'token_not_found' });
    assert.equal(logged[0].actorUserId, undefined, 'an unknown token names no actor');
    assert.equal(calls.length, 0);
    assert.equal(updates.length, 0);
    assertNoRawTokenAnywhere(logged);
  });

  const foundRefusals: Array<[string, Parameters<typeof makeExchangePrisma>[0], string]> = [
    ['an expired token', { row: row({ expiresAt: past() }), userStatus: 'ACTIVE' }, 'token_expired'],
    ['an already-used token', { row: row({ status: 'USED' }), userStatus: 'ACTIVE' }, 'token_not_pending'],
    ['a revoked token', { row: row({ status: 'REVOKED' }), userStatus: 'ACTIVE' }, 'token_not_pending'],
    ['an inactive user', { row: row(), userStatus: 'SUSPENDED' }, 'user_inactive'],
    ['a deleted user', { row: row(), userStatus: null }, 'user_inactive'],
    ['a revoked membership', { row: row(), userStatus: 'ACTIVE', membership: null }, 'membership_inactive'],
    ['a suspended company', { row: row(), userStatus: 'ACTIVE', companyStatus: 'SUSPENDED' }, 'company_inactive'],
    ['a missing company', { row: row(), userStatus: 'ACTIVE', companyStatus: null }, 'company_inactive'],
    // Owner decision 2026-09-06, defence in depth: the revoke a sever performs is the primary
    // control, but it is one UPDATE that can fail. The exchange must not be the only thing standing
    // between a severed chat and a session, so it re-checks the identity itself.
    ['a severed LINE identity', { row: row(), userStatus: 'ACTIVE', identity: null }, 'line_identity_severed'],
    [
      'a LINE account re-pointed at another user',
      { row: row(), userStatus: 'ACTIVE', identity: { userId: 'user-2', providerUserId: LINE_USER } },
      'line_identity_severed',
    ],
  ];

  for (const [label, options, reason] of foundRefusals) {
    it(`refuses ${label} with reason ${reason}, keeping the destination for the login bounce`, async () => {
      const calls: unknown[][] = [];
      const { prisma } = makeExchangePrisma(options);
      const { audit, logged } = makeAudit();
      const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false), audit);

      const error = await refusal(uc);
      const body = error.getResponse() as Record<string, unknown>;
      // Spec §15 acceptance 3: the second tap lands on /login?next=<target>, never a blank error.
      assert.equal(body['targetPath'], TARGET);
      assert.equal(body['message'], 'This link is expired or has already been used.');
      assert.equal(body['reason'], undefined, 'the reason goes to audit, never to the caller');
      assert.equal(logged[0].result, 'FAILED');
      assert.deepEqual(logged[0].metadataJson, { reason, surface: 'line_ai_reply' });
      assert.equal(logged[0].actorUserId, USER);
      assert.equal(logged[0].companyId, COMPANY);
      assert.equal(calls.length, 0, 'a refusal must never issue a session');
    });
  }

  it('gives every refusal the identical caller-visible message and code', async () => {
    const bodies: string[] = [];
    for (const [, options] of foundRefusals) {
      const { prisma } = makeExchangePrisma(options);
      const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
      const body = (await refusal(uc)).getResponse() as Record<string, unknown>;
      bodies.push(JSON.stringify({ code: body['code'], message: body['message'] }));
    }
    assert.equal(new Set(bodies).size, 1, 'refusals must be indistinguishable to the caller');
  });

  it('refuses a token an unlink revoked without writing anything or issuing a session', async () => {
    // The other half of the 2026-09-06 unlink fix: severing a LINE link flips its unspent rows to
    // REVOKED, and the exchange must treat one exactly as it treats a spent one — same 403, same
    // body, refused at step 2. Deliberately a PICKER-surface row, the one surface that would move
    // the chat's selected company at step 4b: the refusal has to land before the claim, so a link
    // sent to a since-severed LINE account cannot re-create `LineCompanyContext` under a
    // `lineUserId` that may by now belong to somebody else.
    const calls: unknown[][] = [];
    const { prisma, updates, contextUpserts } = makeExchangePrisma({
      row: row({ status: 'REVOKED', surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN }),
      userStatus: 'ACTIVE',
    });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false));

    const body = (await refusal(uc)).getResponse() as Record<string, unknown>;
    assert.equal(body['code'], 'line_handoff_unavailable');
    assert.equal(updates.length, 0, 'a revoked row must not be claimed');
    assert.equal(calls.length, 0, 'a revoked row must not mint a session');
    assert.deepEqual(contextUpserts, [], 'a revoked row must not move the chat to a company');
  });

  it('refuses a severed or re-pointed LINE identity BEFORE the claim, writing nothing', async () => {
    // The token row's own status is the primary control (an unlink flips it to REVOKED), but that
    // revoke is a single UPDATE that can fail — see the employee sever. So the exchange re-checks
    // the identity too, and the check has to land where the REVOKED one does: before the claim, and
    // therefore before the picker surface's `LineCompanyContext` upsert and before any session.
    for (const identity of [null, { userId: 'user-2', providerUserId: LINE_USER }] as const) {
      const calls: unknown[][] = [];
      const { prisma, updates, contextUpserts } = makeExchangePrisma({
        row: row({ surface: LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN }),
        userStatus: 'ACTIVE',
        identity,
      });
      const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false));

      const body = (await refusal(uc)).getResponse() as Record<string, unknown>;
      assert.equal(body['code'], 'line_handoff_unavailable');
      assert.equal(body['message'], 'This link is expired or has already been used.');
      assert.equal(updates.length, 0, 'a severed identity must not claim the row');
      assert.equal(calls.length, 0, 'a severed identity must not mint a session');
      assert.deepEqual(contextUpserts, [], 'a severed identity must not move the chat to a company');
    }
  });

  it('matches the identity on provider + LINE userId + ACTIVE + the token’s own user', async () => {
    // Same keys `resolveLineIdentity` uses (channel-agnostic: the token row carries no channel),
    // plus the token's `userId` — without it a LINE account re-pointed at somebody else still opens
    // the previous holder's session.
    const { prisma, identityFinds } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE' });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    await uc.execute({ token: RAW_TOKEN });

    assert.equal(identityFinds.length, 1, 'exactly one identity lookup per exchange');
    assert.deepEqual(identityFinds[0].where, {
      userId: USER, provider: 'LINE', providerUserId: LINE_USER, status: 'ACTIVE',
    });
  });

  it('checks the token before the account, so a lookup miss cannot probe user state', async () => {
    let userReads = 0;
    const { prisma } = makeExchangePrisma({ row: null });
    prisma.client.user.findUnique = async () => { userReads += 1; return null; };
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    await refusal(uc);
    assert.equal(userReads, 0);
  });

  it('re-checks membership BEFORE claiming, so a refused token stays usable to nobody but stays PENDING', async () => {
    const { prisma, updates } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE', membership: null });
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken([]), legalAcceptance(false));
    await refusal(uc);
    assert.equal(updates.length, 0, 'an unauthorised tap must not burn the row');
  });

  it('loses the concurrent-claim race without issuing a second session', async () => {
    const calls: unknown[][] = [];
    const { prisma } = makeExchangePrisma({ row: row(), userStatus: 'ACTIVE', updatedCount: 0 });
    const { audit, logged } = makeAudit();
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false), audit);

    const error = await refusal(uc);
    assert.equal((error.getResponse() as Record<string, unknown>)['targetPath'], TARGET);
    assert.equal(calls.length, 0, 'the loser of the claim race must not be issued a session');
    assert.deepEqual(logged[0].metadataJson, { reason: 'token_not_pending', surface: 'line_ai_reply' });
  });

  it('gives exactly one session when two taps race on one PENDING row', async () => {
    // One shared row and a claim that succeeds once: the second updateMany matches zero rows,
    // which is what the conditional UPDATE guarantees in Postgres.
    const shared = row();
    let claims = 0;
    const prisma = {
      client: {
        lineWebHandoffToken: {
          findUnique: async () => shared,
          updateMany: async () => {
            claims += 1;
            return { count: claims === 1 ? 1 : 0 };
          },
        },
        externalIdentity: { findFirst: async () => ({ id: 'ei-1' }) },
        user: { findUnique: async () => ({ status: 'ACTIVE', credential: { mustChangePassword: false } }) },
        companyMembership: { findFirst: async () => ({ id: 'mem-1' }) },
        company: { findUnique: async () => ({ status: 'ACTIVE' }) },
      },
    } as any;
    const calls: unknown[][] = [];
    const uc = new ExchangeLineHandoffTokenUseCase(prisma, issueToken(calls), legalAcceptance(false));

    const results = await Promise.allSettled([
      uc.execute({ token: RAW_TOKEN }),
      uc.execute({ token: RAW_TOKEN }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(calls.length, 1, 'exactly one session for two concurrent taps');
    assert.equal(claims, 2, 'both taps attempted the claim; only one matched');
  });
});
