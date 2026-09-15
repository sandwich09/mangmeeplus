import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAccountSecurityStateUseCase } from './get-account-security-state.use-case';

function makeUseCase(lineIdentity: { linkedAt: Date } | null, emailProvider?: 'disabled' | 'local-console' | 'ses') {
  const identityQueries: any[] = [];
  const prisma = {
    client: {
      user: { findUnique: async () => ({ email: 'a@b.co', emailVerifiedAt: null, aiAssistantOptOutAt: null }) },
      emailVerificationToken: { findFirst: async () => null },
      externalIdentity: {
        findMany: async (args: any) => { identityQueries.push(args); return lineIdentity ? [lineIdentity] : []; },
      },
    },
  } as any;
  const config = emailProvider ? ({ emailProvider } as any) : null;
  return { useCase: new GetAccountSecurityStateUseCase(prisma, config), identityQueries };
}

describe('GetAccountSecurityStateUseCase LINE link state', () => {
  it('reports an ACTIVE LINE identity with its linked-at date', async () => {
    const linkedAt = new Date('2026-08-30T04:05:06.000Z');
    const { useCase, identityQueries } = makeUseCase({ linkedAt });

    const state = await useCase.execute('user-1');

    assert.equal(state.lineLinked, true);
    assert.equal(state.lineLinkedAt, '2026-08-30T04:05:06.000Z');
    // UNLINKED rows must not count, otherwise the sidebar badge would never return to
    // "ยังไม่ได้เชื่อม" after an unlink.
    assert.deepEqual(identityQueries[0].where, { userId: 'user-1', provider: 'LINE', status: 'ACTIVE' });
  });

  it('reports no LINE identity as unlinked', async () => {
    const { useCase } = makeUseCase(null);

    const state = await useCase.execute('user-1');

    assert.equal(state.lineLinked, false);
    assert.equal(state.lineLinkedAt, null);
  });
});

/**
 * UAT 2026-09-06 §15.4.1 C. Production runs `EMAIL_PROVIDER=disabled`, whose mailer adapter is a
 * silent no-op, so the profile page said "ส่งลิงก์ยืนยันไปที่อีเมลแล้วค่ะ" over a letter that was
 * never sent. The page cannot know that from anywhere else — this flag is what it reads.
 */
describe('GetAccountSecurityStateUseCase email delivery capability', () => {
  it('reports delivery disabled when the environment has no mailer', async () => {
    const { useCase } = makeUseCase(null, 'disabled');

    assert.equal((await useCase.execute('user-1')).emailDeliveryEnabled, false);
  });

  it('reports delivery enabled for every provider that actually sends', async () => {
    for (const provider of ['ses', 'local-console'] as const) {
      const { useCase } = makeUseCase(null, provider);
      assert.equal((await useCase.execute('user-1')).emailDeliveryEnabled, true, provider);
    }
  });

  // The injection is @Optional() so the hand-constructed fakes across the auth specs keep working;
  // with no config in the graph the page keeps its send button and the use-case gate stays the
  // backstop, rather than a missing provider silently disabling a working feature.
  it('treats an absent config as delivery enabled', async () => {
    const { useCase } = makeUseCase(null);

    assert.equal((await useCase.execute('user-1')).emailDeliveryEnabled, true);
  });
});

for (const channel of ['current', 'legacy']) it(`separates linked identity from ${channel} Messaging readiness`, async () => {
  const useCase = new GetAccountSecurityStateUseCase({ client: {
    user: { findUnique: async () => ({}) }, emailVerificationToken: { findFirst: async () => null },
    externalIdentity: { findMany: async () => [{ linkedAt: new Date(), providerChannelId: channel }] },
  } } as any, { lineMessagingChannelId: 'current' } as any);
  const state = await useCase.execute('user');
  assert.equal(state.lineLinked, true);
  assert.equal(state.lineMessagingReady, channel === 'current');
});
