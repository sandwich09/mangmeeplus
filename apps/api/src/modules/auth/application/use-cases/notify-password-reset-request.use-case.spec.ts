import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotifyPasswordResetRequestUseCase } from './notify-password-reset-request.use-case';
import { hashLineRecoveryPassword } from '../../domain/logic/secure-token.logic';

const GENERIC_MESSAGE = 'If the account is eligible, a temporary password has been sent to its linked LINE.';
const ACTIVE_USER = { id: 'user-1', status: 'ACTIVE', credential: { status: 'ACTIVE', passwordHash: 'synthetic-credential-hash' } };
const TOKEN_CONFIG = { lineMessagingChannelAccessToken: 'system-oa-token', passwordResetResponseMinMs: 0 } as any;

function makePrisma(options: {
  user?: Record<string, unknown> | null;
  membership?: { companyId: string } | null;
  identity?: { providerUserId: string } | null;
  onUserQuery?: (args: any) => void;
}) {
  const tokens: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date; status: string }> = [];
  const tx = {
    $queryRaw: async () => [{ id: 'credential-1' }],
    userCredential: { findUnique: async () => ACTIVE_USER.credential },
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
        findFirst: async (args: any) => {
          options.onUserQuery?.(args);
          return options.user === undefined ? ACTIVE_USER : options.user;
        },
      },
      companyMembership: {
        findFirst: async () => options.membership === undefined ? { companyId: 'company-1' } : options.membership,
      },
      externalIdentity: {
        findFirst: async () => options.identity === undefined ? { providerUserId: 'line-user-1' } : options.identity,
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
  const result = await new NotifyPasswordResetRequestUseCase(prisma, config, audit)
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
    assert.equal(queried.where.username, 'owner.one');
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
        lineMessagingChannelAccessToken: 'system-oa-token',
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
});
