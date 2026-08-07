import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCompanyAiModelPolicy } from './company-ai-model-policy';

describe('resolveCompanyAiModelPolicy', () => {
  it('returns the server-stored tenant model only when it is currently approved', async () => {
    const prisma = {
      client: { companyAiConfiguration: { findUnique: async () => ({ modelId: 'apac.model-v1' }) } },
    } as any;
    assert.deepEqual(await resolveCompanyAiModelPolicy(prisma, 'co-1', ['apac.model-v1']), {
      modelId: 'apac.model-v1',
    });
  });

  it('inherits the platform default when the row exists but modelId is null (spec §6.8)', async () => {
    // A budget-only row: null must behave exactly like an absent row, not like an unapproved
    // model — nothing is thrown and no policy is attached to the request.
    const withNull = {
      client: { companyAiConfiguration: { findUnique: async () => ({ modelId: null }) } },
    } as any;
    const withoutRow = {
      client: { companyAiConfiguration: { findUnique: async () => null } },
    } as any;

    assert.equal(await resolveCompanyAiModelPolicy(withNull, 'co-1', ['apac.model-v1']), undefined);
    assert.equal(await resolveCompanyAiModelPolicy(withoutRow, 'co-1', ['apac.model-v1']), undefined);
  });

  it('fails closed when an old tenant setting is no longer approved', async () => {
    const prisma = {
      client: { companyAiConfiguration: { findUnique: async () => ({ modelId: 'global.unapproved' }) } },
    } as any;
    await assert.rejects(
      () => resolveCompanyAiModelPolicy(prisma, 'co-1', ['apac.model-v1']),
      /TENANT_AI_MODEL_NOT_APPROVED/,
    );
  });
});
