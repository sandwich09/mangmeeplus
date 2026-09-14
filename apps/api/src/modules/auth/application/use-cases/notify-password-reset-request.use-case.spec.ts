import { lineMessagingCredentialsFixture } from '../../../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotifyPasswordResetRequestUseCase } from './notify-password-reset-request.use-case';
import { hashLineRecoveryPassword } from '../../domain/logic/secure-token.logic';

const GENERIC_MESSAGE = 'If the account is eligible, a temporary password has been sent to its linked LINE.';
const ACTIVE_USER = { id: 'user-1', status: 'ACTIVE', credential: { status: 'ACTIVE', passwordHash: 'synthetic-credential-hash' } };
const TOKEN_CONFIG = { lineMessagingChannelId:'synthetic-messaging', lineMessagingChannelAccessToken: 'system-oa-token', passwordResetResponseMinMs: 0 } as any;

function makePrisma(options: {
  user?: Record<string, unknown> | null;
  users?: Array<Record<string, any>>;
  identities?: Record<string, string>;
  onIdentityQuery?: (args: any) => void;
  identityChannelId?:string;
  identityUnavailableAfter?:number;
  membership?: { companyId: string } | null;
  identity?: { providerUserId: string } | null;
  onUserQuery?: (args: any) => void;
}) {
  let identityQueries=0;
  const tokens: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date; status: string }> = [];
  const tx = {
    $queryRaw: async () => [{ id: 'credential-1' }],
    userCredential: { findUnique: async ({ where }: any) => options.users
      ? options.users.find((user) => user.id === where.userId)?.credential ?? null : ACTIVE_USER.credential },
    passwordResetToken: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const token of tokens) {
          if ((where.id === undefined || token.id === where.id)
            && (where.userId === undefined || token.userId === where.userId)
            && token.status === where.status) {
            token.status = data.status;
            count += 1;
          }
        }
        return { count };
      },
      create: async ({ data }: any) => {
        const token = { id: `reset-${tokens.length + 1}`, ...data, status: 'PENDING' };
        tokens.push(token);
        return { id: token.id };
      },
    },
  };
  const prisma = {
    client: {
      user: {
        findMany: async (args: any) => {
          options.onUserQuery?.(args);
          if (options.users) return options.users.filter((user) => args.where.OR.some((condition: any) =>
            Object.entries(condition).every(([key, value]) => user[key] === value))).slice(0, args.take);
          return options.user === null ? [] : [options.user ?? ACTIVE_USER];
        },
      },
      companyMembership: {
        findFirst: async () => options.membership === undefined ? { companyId: 'company-1' } : options.membership,
      },
      externalIdentity: {
        findFirst: async (args: any) => {
          options.onIdentityQuery?.(args);
          if(args.where.providerChannelId!==(options.identityChannelId??'synthetic-messaging')||++identityQueries>(options.identityUnavailableAfter??Infinity))return null;
          const identity=options.identities?(options.identities[args.where.userId]?{providerUserId:options.identities[args.where.userId]}:null):options.identity===undefined?{providerUserId:'line-user-1'}:options.identity;
          return identity&&(!args.where.providerUserId||args.where.providerUserId===identity.providerUserId)?identity:null;
        },
      },
      passwordResetToken: tx.passwordResetToken,
      $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
    },
  } as any;
  return { prisma, tokens };
}

function captureLinePush(ok = true) {
  const pushes: Array<{ to: string; clipboardText: string | undefined }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body as string);
    // The temp password now rides the flex card's copy button (never the altText).
    pushes.push({ to: body.to, clipboardText: body.messages[0]?.contents?.footer?.contents?.[0]?.action?.clipboardText });
    return { ok, status: ok ? 200 : 500 } as Response;
  }) as typeof fetch;
  return { pushes, restore: () => { globalThis.fetch = original; } };
}

function flushDetached(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

async function run(prisma: any, config: any = TOKEN_CONFIG, username = 'owner.one') {
  const audits: any[] = [];
  const audit = { log: async (entry: unknown) => { audits.push(entry); } } as any;
  const result = await new NotifyPasswordResetRequestUseCase(lineMessagingCredentialsFixture(config), prisma, config, audit)
    .execute({ username, requestId: 'req-1' });
  return { result, audits };
}

describe('NotifyPasswordResetRequestUseCase', () => {
  it('returns the same generic response and creates nothing for an unknown username', async () => {
    const line = captureLinePush();
    const { prisma, tokens } = makePrisma({ user: null });
    try {
      const { result, audits } = await run(prisma);
      await flushDetached();
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(tokens.length, 0);
      assert.equal(line.pushes.length, 0);
      assert.equal(audits[0].metadataJson.reason, 'unknown_username');
    } finally {
      line.restore();
    }
  });

  it('normalizes the username before lookup', async () => {
    let queried: any;
    const { prisma } = makePrisma({ user: null, onUserQuery: (args) => { queried = args; } });
    await run(prisma, TOKEN_CONFIG, '  Owner.One  ');
    assert.deepEqual(queried.where, { OR: [{ username: 'owner.one' }, { email: 'owner.one' }] });
    assert.equal(queried.take, 2);
  });

  it('sends nothing when one account username collides with another account email, regardless of row order', async () => {
    const email = 'owner@example.com';
    const byUsername = { ...ACTIVE_USER, id: 'username-account', username: email, email: 'different@example.com' };
    const byEmail = { ...ACTIVE_USER, id: 'email-account', username: null, email };
    for (const users of [[byUsername, byEmail], [byEmail, byUsername]]) {
      let identityQueried = false;
      const { prisma, tokens } = makePrisma({ users, identities: {
        'username-account': 'line-username-account', 'email-account': 'line-email-account',
      }, onIdentityQuery: () => { identityQueried = true; } });
      const line = captureLinePush();
      try {
        const { result, audits } = await run(prisma, TOKEN_CONFIG, ' Owner@Example.com ');
        await flushDetached();
        assert.equal(result.message, GENERIC_MESSAGE);
        assert.equal(tokens.length, 0);
        assert.equal(line.pushes.length, 0);
        assert.equal(identityQueried, false);
        assert.equal(audits[0].metadataJson.reason, 'ambiguous_identifier');
      } finally { line.restore(); }
    }
  });

  it('treats one account matching both username and email as one recipient', async () => {
    const email = 'owner@example.com';
    const user = { ...ACTIVE_USER, username: email, email };
    const { prisma, tokens } = makePrisma({ users: [user], identities: { 'user-1': 'line-same-account' } });
    const line = captureLinePush();
    try {
      assert.equal((await run(prisma, TOKEN_CONFIG, email)).result.message, GENERIC_MESSAGE);
      await flushDetached();
      assert.deepEqual(line.pushes.map((push) => push.to), ['line-same-account']);
      assert.deepEqual(tokens.map((token) => token.userId), [user.id]);
      assert.equal(tokens[0]!.tokenHash, hashLineRecoveryPassword(line.pushes[0]!.clipboardText!, user.credential.passwordHash));
    } finally { line.restore(); }
  });

  it('accepts a trimmed mixed-case account email without a username or verified mailbox', async () => {
    const email = `${'owner'.repeat(14)}@example.com`;
    assert.ok(email.length > 64, 'the login email may be longer than a username');
    const user = { ...ACTIVE_USER, username: null, email, emailVerifiedAt: null };
    let queried: any;
    let destinationQuery: any;
    const { prisma, tokens } = makePrisma({ users: [user], identities: { 'user-1': 'line-email-owner' },
      onUserQuery: (args) => { queried = args; }, onIdentityQuery: (args) => { destinationQuery = args; } });
    const line = captureLinePush();
    try {
      assert.equal((await run(prisma, TOKEN_CONFIG, `  ${email.toUpperCase()}  `)).result.message, GENERIC_MESSAGE);
      await flushDetached();
      assert.deepEqual(queried.where, { OR: [{ username: email }, { email }] });
      assert.deepEqual(destinationQuery.where, { userId: user.id, provider: 'LINE', providerChannelId:'synthetic-messaging',providerUserId:'line-email-owner',status: 'ACTIVE' });
      assert.equal(line.pushes.length, 1);
      assert.equal(line.pushes[0]!.to, 'line-email-owner');
      assert.equal(tokens[0]!.userId, user.id);
      assert.equal(tokens[0]!.tokenHash, hashLineRecoveryPassword(line.pushes[0]!.clipboardText!, user.credential.passwordHash));
      assert.equal(user.emailVerifiedAt, null, 'LINE recovery never proves a mailbox');
    } finally { line.restore(); }
  });

  it('resolves an email to that account only and sends nothing to an account sharing its shop contact', async () => {
    const requested = { ...ACTIVE_USER, id: 'email-account', username: null, email: 'owner@example.com', emailVerifiedAt: null,
      credential: { ...ACTIVE_USER.credential, passwordHash: 'email-account-credential' } };
    const other = { ...ACTIVE_USER, id: 'other-account', username: 'other.owner', email: 'different@example.com', companyContactEmail: requested.email };
    const { prisma, tokens } = makePrisma({ users: [other, requested], identities: {
      'email-account': 'line-email-account', 'other-account': 'line-other-account',
    } });
    const line = captureLinePush();
    try {
      assert.equal((await run(prisma, TOKEN_CONFIG, requested.email)).result.message, GENERIC_MESSAGE);
      await flushDetached();
      assert.deepEqual(line.pushes.map((push) => push.to), ['line-email-account']);
      assert.deepEqual(tokens.map((token) => token.userId), ['email-account']);
      assert.equal(tokens[0]!.tokenHash, hashLineRecoveryPassword(line.pushes[0]!.clipboardText!, requested.credential.passwordHash));

      const contactOnly = makePrisma({ users: [{ ...other, companyContactEmail: 'shop-contact@example.com' }], identities: { 'other-account': 'line-other-account' } });
      assert.equal((await run(contactOnly.prisma, TOKEN_CONFIG, 'shop-contact@example.com')).result.message, GENERIC_MESSAGE);
      await flushDetached();
      assert.equal(contactOnly.tokens.length, 0);
      assert.equal(line.pushes.length, 1, 'Company.email is never a recovery identity');
    } finally { line.restore(); }
  });

  it('does not give email-only signup a password or recovery token before it sets a credential, or without linked LINE', async () => {
    for (const hasCredential of [false, true]) {
      const user = { ...ACTIVE_USER, username: null, email: 'owner@example.com', emailVerifiedAt: null,
        credential: hasCredential ? ACTIVE_USER.credential : null };
      const { prisma, tokens } = makePrisma({ users: [user], identities: hasCredential ? {} : { 'user-1': 'line-user-1' } });
      const line = captureLinePush();
      try {
        assert.equal((await run(prisma, TOKEN_CONFIG, ' Owner@Example.com ')).result.message, GENERIC_MESSAGE);
        await flushDetached();
        assert.equal(tokens.length, 0);
        assert.equal(line.pushes.length, 0);
        assert.equal(user.credential, hasCredential ? ACTIVE_USER.credential : null);
      } finally { line.restore(); }
    }
  });

  it('preserves the generic response without changing credentials for every ineligible account', async () => {
    for (const options of [
      { user: { ...ACTIVE_USER, status: 'SUSPENDED' } },
      { user: { ...ACTIVE_USER, credential: null } },
      { user: { ...ACTIVE_USER, credential: { ...ACTIVE_USER.credential, status: 'DISABLED' } } },
      { membership: null },
      { identity: null },
    ]) {
      const line = captureLinePush();
      const { prisma, tokens } = makePrisma(options);
      try {
        assert.equal((await run(prisma)).result.message, GENERIC_MESSAGE);
        await flushDetached();
        assert.equal(tokens.length, 0);
        assert.equal(line.pushes.length, 0);
      } finally { line.restore(); }
    }
    const { prisma, tokens } = makePrisma({});
    const { result } = await run(prisma, { passwordResetResponseMinMs: 0 } as any);
    assert.equal(result.message, GENERIC_MESSAGE);
    assert.equal(tokens.length, 0, 'a missing LINE channel must not create an unusable recovery token');
  });

  it('sends one hash-backed recovery password to the exact linked user for owner or employee accounts', async () => {
    for (const username of ['owner.one', 'staff.one']) {
      const line = captureLinePush();
      const { prisma, tokens } = makePrisma({});
      try {
        const { result, audits } = await run(prisma, TOKEN_CONFIG, username);
        await flushDetached();

        assert.equal(result.message, GENERIC_MESSAGE);
        assert.equal(line.pushes.length, 1);
        assert.equal(line.pushes[0]!.to, 'line-user-1');
        const temporaryPassword = line.pushes[0]!.clipboardText;
        assert.ok(temporaryPassword);
        assert.equal(tokens.length, 1);
        assert.equal(tokens[0]!.tokenHash, hashLineRecoveryPassword(temporaryPassword, ACTIVE_USER.credential.passwordHash));
        assert.equal(tokens[0]!.status, 'PENDING');
        assert.equal(audits[0].result, 'SUCCESS');
        assert.deepEqual(audits[0].metadataJson, { channel: 'line', recipientCount: 1 });
      } finally {
        line.restore();
      }
    }
  });

  it('does not create a credential when the exact account has no linked LINE', async () => {
    const line = captureLinePush();
    const { prisma, tokens } = makePrisma({ identity: null });
    try {
      const { result, audits } = await run(prisma);
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(tokens.length, 0);
      assert.equal(line.pushes.length, 0);
      assert.equal(audits[0].metadataJson.reason, 'line_identity_unavailable');
    } finally {
      line.restore();
    }
  });

  it('revokes the newly created recovery token when LINE delivery fails', async () => {
    const line = captureLinePush(false);
    const { prisma, tokens } = makePrisma({});
    try {
      const { result, audits } = await run(prisma);
      assert.equal(result.message, GENERIC_MESSAGE);
      await flushDetached();
      assert.equal(tokens[0]!.status, 'REVOKED');
      assert.equal(audits[0].result, 'FAILED');
      assert.deepEqual(audits[0].metadataJson, { channel: 'line', recipientCount: 0 });
    } finally {
      line.restore();
    }
  });

  it('keeps LINE delivery detached and applies the same response-time floor', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      await gate;
      return { ok: true } as Response;
    }) as typeof fetch;
    const { prisma } = makePrisma({});
    const floorMs = 100;
    try {
      const startedAt = Date.now();
      const { result, audits } = await run(prisma, {
        ...TOKEN_CONFIG,
        passwordResetResponseMinMs: floorMs,
      } as any);
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.ok(Date.now() - startedAt >= floorMs - 5);
      assert.equal(audits.length, 0, 'response must not await LINE');
      release();
      await flushDetached();
      assert.equal(audits.length, 1);
    } finally {
      globalThis.fetch = original;
    }
  });
  it('refuses legacy recipients and revokes a token if its current binding disappears before push',async()=>{
    for(const options of [{identityChannelId:'legacy-login'},{identityUnavailableAfter:1}]){
      const line=captureLinePush(),{prisma,tokens}=makePrisma(options);
      try{assert.equal((await run(prisma)).result.message,GENERIC_MESSAGE);await flushDetached();assert.equal(line.pushes.length,0);
        if('identityChannelId' in options)assert.equal(tokens.length,0);else assert.equal(tokens[0]?.status,'REVOKED');
      }finally{line.restore();}
    }
  });

});
