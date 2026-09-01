import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAccountSecurityStateUseCase } from './get-account-security-state.use-case';

function makeUseCase(lineIdentity: { linkedAt: Date } | null) {
  const identityQueries: any[] = [];
  const prisma = {
    client: {
      user: { findUnique: async () => ({ email: 'a@b.co', emailVerifiedAt: null, aiAssistantOptOutAt: null }) },
      emailVerificationToken: { findFirst: async () => null },
      externalIdentity: {
        findFirst: async (args: any) => { identityQueries.push(args); return lineIdentity; },
      },
    },
  } as any;
  return { useCase: new GetAccountSecurityStateUseCase(prisma), identityQueries };
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
