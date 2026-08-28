import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { LineLinkOauthUseCase } from './application/use-cases/line-link-oauth.use-case';

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

const localConfig = { webBaseUrl: 'https://app.example.com', isProduction: false } as any;

const input = {
  userId: 'user-1', code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'n1', requestId: 'req-1',
};

describe('LineLinkOauthUseCase', () => {
  it('spends the code against the BFF callback redirect_uri and links the nonce-verified identity', async () => {
    const { client, calls } = makeTokenClient();
    const { link, calls: linkCalls } = makeLink();

    const result = await new LineLinkOauthUseCase(client, localConfig, link).execute({ ...input, companyId: 'co-9' });

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

    await new LineLinkOauthUseCase(client, localConfig, link).execute(input);

    // An explicit `companyId: undefined` is not the same input: the use case resolves the
    // single active membership only when the key is absent.
    assert.equal(Object.hasOwn(linkCalls[0] as object, 'companyId'), false);
  });

  it('propagates a failed code exchange instead of linking anything', async () => {
    const { client } = makeTokenClient(new UnauthorizedException('LINE Login code exchange failed.'));
    const { link, calls: linkCalls } = makeLink();

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link).execute(input),
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
    const config = { webBaseUrl: undefined, isProduction: true } as any;

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, config, link).execute(input),
      ServiceUnavailableException,
    );
    assert.equal(calls.length, 0, 'a guessed redirect_uri must never be sent to LINE in production');
  });

  it('propagates a conflict when the LINE account already belongs to another user', async () => {
    const { client } = makeTokenClient();
    const { link } = makeLink(new ConflictException('LINE account already linked to another user.'));

    await assert.rejects(
      () => new LineLinkOauthUseCase(client, localConfig, link).execute(input),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        return true;
      },
    );
  });
});
