import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { LineLinkOauthUseCase } from './application/use-cases/line-link-oauth.use-case';
import { hashToken } from './domain/logic/secure-token.logic';

type TokenCall = { code: string; codeVerifier: string; redirectUri: string };

function makeTokenClient(result: unknown = { idToken: 'idt' }) {
  const calls: TokenCall[] = [];
  const client = {
    exchangeAuthorizationCode: async (input: TokenCall) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
  } as any;
  return { client, calls };
}

function makeLink(result: unknown = { linked: true, providerUserId: 'U1' }) {
  const calls: unknown[] = [];
  const link = {
    execute: async (input: unknown) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
  } as any;
  return { link, calls };
}

/** Owner of the conflicting LINE identity, plus the ticket table the conflict path writes to. */
function makeMergeWorld(opts: { identity?: unknown; verifyThrows?: Error } = {}) {
  const tickets: any[] = [];
  const verifyCalls: unknown[] = [];
  const prisma = {
    client: {
      externalIdentity: {
        findFirst: async () =>
          opts.identity === undefined
            ? { userId: 'owner-1', user: { displayName: 'สมชาย', status: 'ACTIVE' } }
            : opts.identity,
      },
      companyMembership: {
        findMany: async () => [{ company: { name: 'ร้านเดิม' } }, { company: { name: 'ร้านที่สอง' } }],
      },
      accountMergeTicket: {
        create: async ({ data }: any) => { tickets.push(data); return { id: 'ticket-1', ...data }; },
      },
    },
  } as any;
  const lineVerifier = {
    verify: async (token: string, verifyOpts: unknown) => {
      verifyCalls.push({ token, verifyOpts });
      if (opts.verifyThrows) throw opts.verifyThrows;
      return { subject: 'line-user-1' };
    },
  } as any;
  return { prisma, lineVerifier, tickets, verifyCalls };
}

const localConfig = { webBaseUrl: 'https://app.example.com', isProduction: false } as any;

const input = {
  userId: 'user-1', code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'n1', requestId: 'req-1',
};

const linkedElsewhere = () =>
  new ConflictException({ code: 'line_linked_elsewhere', message: 'LINE account already linked to another user.' });

describe('LineLinkOauthUseCase', () => {
  it('spends the code against the BFF callback redirect_uri and links the nonce-verified identity', async () => {
    const { client, calls } = makeTokenClient();
    const { link, calls: linkCalls } = makeLink();
    const { prisma, lineVerifier } = makeMergeWorld();

    const result = await new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute({ ...input, companyId: 'co-9' });

    assert.deepEqual(result, { linked: true, providerUserId: 'U1' });
    // LINE re-checks redirect_uri against the one the authorize request carried, so it must be
    // the BFF callback route on the public web origin — not the API origin.
    assert.deepEqual(calls[0], {
      code: 'auth-code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://app.example.com/api/auth/line-login/callback',
    });
    // The nonce travels through as expectedNonce: the ID token must prove it came from the
    // round trip this browser started, not from a replayed one.
    assert.deepEqual(linkCalls[0], {
      userId: 'user-1', idToken: 'idt', requestId: 'req-1', expectedNonce: 'n1', companyId: 'co-9',
    });
  });

  it('omits companyId entirely when the caller sent no company header', async () => {
    const { client } = makeTokenClient();
    const { link, calls: linkCalls } = makeLink();
    const { prisma, lineVerifier } = makeMergeWorld();

    await new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input);

    // An explicit `companyId: undefined` is not the same input: the use case resolves the
    // single active membership only when the key is absent.
    assert.equal(Object.hasOwn(linkCalls[0] as object, 'companyId'), false);
  });

  it('propagates a failed code exchange instead of linking anything', async () => {
    const { client } = makeTokenClient(new UnauthorizedException('LINE Login code exchange failed.'));
    const { link, calls: linkCalls } = makeLink();
    const { prisma, lineVerifier } = makeMergeWorld();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
    assert.equal(linkCalls.length, 0, 'no identity may be linked from a code LINE refused');
  });

  it('fails closed in production when the web base URL is missing, before spending the code', async () => {
    const { client, calls } = makeTokenClient();
    const { link } = makeLink();
    const { prisma, lineVerifier } = makeMergeWorld();
    const config = { webBaseUrl: undefined, isProduction: true } as any;

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, config, link, prisma, lineVerifier).execute(input),
      ServiceUnavailableException,
    );
    assert.equal(calls.length, 0, 'a guessed redirect_uri must never be sent to LINE in production');
  });

  it('propagates a conflict when the LINE account already belongs to another user', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(linkedElsewhere());
    const { prisma, lineVerifier } = makeMergeWorld();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        return true;
      },
    );
  });

  it('carries a merge ticket and the other account on the linked-elsewhere conflict (spec §4F)', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(linkedElsewhere());
    const { prisma, lineVerifier, tickets, verifyCalls } = makeMergeWorld();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        const body = err.getResponse() as any;
        assert.equal(body.code, 'line_linked_elsewhere');
        assert.equal(typeof body.mergeTicket, 'string');
        // Only what the caller already proved control of: a name and the shops it works with.
        assert.deepEqual(body.existingAccount, {
          displayName: 'สมชาย',
          companyNames: ['ร้านเดิม', 'ร้านที่สอง'],
        });
        assert.equal(Object.hasOwn(body.existingAccount, 'email'), false);
        // Hash-only at rest: the row must never carry the token the caller was handed.
        assert.equal(tickets.length, 1);
        assert.equal(tickets[0].tokenHash, hashToken(body.mergeTicket));
        assert.equal(Object.hasOwn(tickets[0], 'token'), false);
        assert.equal(tickets[0].newUserId, 'user-1');
        assert.equal(tickets[0].existingUserId, 'owner-1');
        assert.equal(tickets[0].lineProviderUserId, 'line-user-1');
        assert.ok(tickets[0].expiresAt > new Date());
        return true;
      },
    );
    // The ticket is minted from a *verified* subject, and the nonce still has to match.
    assert.deepEqual(verifyCalls, [{ token: 'idt', verifyOpts: { nonce: 'n1' } }]);
  });

  it('mints no ticket for a conflict that is not line_linked_elsewhere', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(new ConflictException('Some other conflict.'));
    const { prisma, lineVerifier, tickets } = makeMergeWorld();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      ConflictException,
    );
    assert.equal(tickets.length, 0);
  });

  it('mints no ticket for a non-conflict failure', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(new UnauthorizedException('LINE Login token verification failed.'));
    const { prisma, lineVerifier, tickets } = makeMergeWorld();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      UnauthorizedException,
    );
    assert.equal(tickets.length, 0);
  });

  it('leaves the plain conflict in place when the other account is gone or not active', async () => {
    for (const identity of [null, { userId: 'owner-1', user: { displayName: 'สมชาย', status: 'DISABLED' } }]) {
      const { client } = makeTokenClient();
      const { link } = makeLink(linkedElsewhere());
      const { prisma, lineVerifier, tickets } = makeMergeWorld({ identity });

      await assert.rejects(
        () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
        (err: unknown) => {
          assert.ok(err instanceof ConflictException);
          assert.equal(Object.hasOwn(err.getResponse() as object, 'mergeTicket'), false);
          return true;
        },
      );
      assert.equal(tickets.length, 0);
    }
  });

  it('still answers the original conflict when minting the offer fails', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(linkedElsewhere());
    const { prisma, lineVerifier, tickets } = makeMergeWorld({
      verifyThrows: new UnauthorizedException('LINE Login verification request failed.'),
    });

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link, prisma, lineVerifier).execute(input),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException, 'a failed offer must not become a 500');
        assert.equal(Object.hasOwn(err.getResponse() as object, 'mergeTicket'), false);
        return true;
      },
    );
    assert.equal(tickets.length, 0);
  });
});
