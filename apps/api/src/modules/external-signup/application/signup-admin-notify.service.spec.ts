import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignupAdminNotifyService, shortLineIdHash } from './signup-admin-notify.service';

const TOKEN = 'channel-token';
const ASKER = 'Uasker-1';

function harness(options: { identities?: Array<{ providerUserId: string }>; token?: string | null } = {}) {
  const sent: Array<{ to: string; text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ to: body.to, text: body.messages[0].text });
    return { ok: true, status: 200, headers: { get: () => null } };
  }) as any;

  const prisma = {
    client: {
      externalIdentity: {
        findMany: async () => options.identities ?? [{ providerUserId: ASKER }, { providerUserId: 'Uadmin-2' }],
      },
    },
  } as any;
  const config = {
    lineMessagingChannelAccessToken: options.token === undefined ? TOKEN : options.token ?? undefined,
  } as any;
  const service = new SignupAdminNotifyService(prisma, {} as any, {} as any, config, {
    warn: () => {}, error: () => {},
  } as any);

  return { service, sent, restore: () => { globalThis.fetch = original; } };
}

describe('SignupAdminNotifyService.pushToLinkedAdmins', () => {
  it('sends one message per admin identity', async () => {
    const h = harness();
    await h.service.pushToLinkedAdmins(['admin-1', 'admin-2'], 'hello');
    h.restore();
    assert.deepEqual(h.sent.map((row) => row.to), [ASKER, 'Uadmin-2']);
  });

  it('collapses an admin who holds two identity rows into one message', async () => {
    const h = harness({ identities: [{ providerUserId: ASKER }, { providerUserId: ASKER }] });
    await h.service.pushToLinkedAdmins(['admin-1'], 'hello');
    h.restore();
    assert.equal(h.sent.length, 1);
  });

  /**
   * L-B follow-up (b). An operator who is ALSO the person asking for help would otherwise be told,
   * in the very chat they wrote the request in, that a customer wants to talk to them.
   */
  it('skips the chat the request came from, matched by fingerprint', async () => {
    const h = harness();
    await h.service.pushToLinkedAdmins(['admin-1', 'admin-2'], 'hello', {
      skipProviderUserIdHash: shortLineIdHash(ASKER),
    });
    h.restore();
    assert.deepEqual(h.sent.map((row) => row.to), ['Uadmin-2']);
  });

  it('skips nobody when the fingerprint matches no operator', async () => {
    const h = harness();
    await h.service.pushToLinkedAdmins(['admin-1'], 'hello', {
      skipProviderUserIdHash: shortLineIdHash('Usomebody-else'),
    });
    h.restore();
    assert.equal(h.sent.length, 2);
  });

  it('sends nothing at all without a channel token', async () => {
    const h = harness({ token: null });
    await h.service.pushToLinkedAdmins(['admin-1'], 'hello');
    h.restore();
    assert.deepEqual(h.sent, []);
  });
});
