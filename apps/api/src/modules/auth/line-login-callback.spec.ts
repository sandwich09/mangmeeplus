import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { LineLoginCallbackUseCase } from './application/use-cases/line-login-callback.use-case';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';

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

function makeExchange(result: unknown = { linked: true, accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) {
  const calls: Array<[string, string, unknown]> = [];
  const exchange = {
    execute: async (idToken: string, channel: string, opts?: unknown) => {
      calls.push([idToken, channel, opts]);
      return result;
    },
  } as any;
  return { exchange, calls };
}

// ---- LineLoginCallbackUseCase ----

describe('LineLoginCallbackUseCase', () => {
  it('exchanges the code against the BFF callback redirect_uri and threads the nonce into identity resolution', async () => {
    const { client, calls } = makeTokenClient();
    const { exchange, calls: exchangeCalls } = makeExchange();
    const config = { webBaseUrl: 'https://app.example.com', isProduction: false } as any;

    const result = await new LineLoginCallbackUseCase(client, config, exchange).execute({
      code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    });

    assert.deepEqual(result, { linked: true, accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    // LINE re-checks redirect_uri against the one the authorize request carried, so it must be
    // the BFF callback route on the public web origin — not the API origin.
    assert.deepEqual(calls[0], {
      code: 'auth-code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://app.example.com/api/auth/line-login/callback',
    });
    assert.deepEqual(exchangeCalls[0], ['idt', 'web-oauth', { expectedNonce: 'nonce-1' }]);
  });

  it('returns an unlinked LINE account as-is so the BFF can send the user to password login', async () => {
    const { client } = makeTokenClient();
    const { exchange } = makeExchange({ linked: false, message: 'm' });
    const config = { webBaseUrl: 'https://app.example.com', isProduction: false } as any;

    const result = await new LineLoginCallbackUseCase(client, config, exchange).execute({
      code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    });

    assert.deepEqual(result, { linked: false, message: 'm' });
  });

  it('propagates a failed code exchange instead of returning a session', async () => {
    const { client } = makeTokenClient(new UnauthorizedException('LINE Login code exchange failed.'));
    const { exchange, calls: exchangeCalls } = makeExchange();
    const config = { webBaseUrl: 'https://app.example.com', isProduction: false } as any;

    await assert.rejects(
      () => new LineLoginCallbackUseCase(client, config, exchange).execute({
        code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
      }),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
    assert.equal(exchangeCalls.length, 0, 'no identity may be resolved from a code LINE refused');
  });

  it('fails closed in production when the web base URL is missing, before spending the code', async () => {
    const { client, calls } = makeTokenClient();
    const { exchange } = makeExchange();
    const config = { webBaseUrl: undefined, isProduction: true } as any;

    await assert.rejects(
      () => new LineLoginCallbackUseCase(client, config, exchange).execute({
        code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
      }),
      ServiceUnavailableException,
    );
    assert.equal(calls.length, 0, 'a guessed redirect_uri must never be sent to LINE in production');
  });

  it('falls back to the local web origin outside production', async () => {
    const { client, calls } = makeTokenClient();
    const { exchange } = makeExchange();
    const config = { webBaseUrl: undefined, isProduction: false } as any;

    await new LineLoginCallbackUseCase(client, config, exchange).execute({
      code: 'auth-code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    });

    assert.equal(calls[0]!.redirectUri, 'http://localhost:3000/api/auth/line-login/callback');
  });
});

// ---- ExchangeLineTokenUseCase nonce threading ----

describe('ExchangeLineTokenUseCase nonce', () => {
  function makeExchangeUseCase() {
    const verifyCalls: unknown[][] = [];
    const lineVerifier = {
      verify: async (...args: unknown[]) => { verifyCalls.push(args); return { subject: 'line-user-1' }; },
    } as any;
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', user: { id: 'user-1', status: 'ACTIVE' } }),
        },
      },
    } as any;
    const config = { lineMessagingChannelId: 'msg-ch-1', isProduction: false } as any;
    const issueToken = { execute: async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) } as any;
    return { useCase: new ExchangeLineTokenUseCase(lineVerifier, prisma, config, issueToken), verifyCalls };
  }

  it('asks LINE to check the nonce claim when the web OAuth callback supplies one', async () => {
    const { useCase, verifyCalls } = makeExchangeUseCase();
    const result = await useCase.execute('t', 'c', { expectedNonce: 'n1' });

    assert.equal(result.linked, true);
    assert.deepEqual(verifyCalls[0], ['t', { nonce: 'n1' }]);
  });

  it('leaves the LIFF/link surfaces byte-exact: no nonce argument without one', async () => {
    const { useCase, verifyCalls } = makeExchangeUseCase();
    await useCase.execute('t', 'c');

    assert.deepEqual(verifyCalls[0], ['t', undefined]);
  });
});
