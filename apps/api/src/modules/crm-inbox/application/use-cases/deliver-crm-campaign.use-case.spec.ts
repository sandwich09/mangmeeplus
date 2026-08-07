import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { DeliverCrmCampaignUseCase } from './deliver-crm-campaign.use-case';

/**
 * The campaign sweep is one of the two F1 shadow surfaces (plan §3 F1). It is an OUTBOUND send on a
 * path that never resolves permissions, so the only thing under test here is that measuring it
 * changed nothing: same sends, same results, whatever the shadow decision.
 */
function makeUseCase(wouldBlock: boolean) {
  const sent: string[] = [];
  const shadowRecords: any[] = [];
  const recipient = {
    id: 'rec-1',
    companyId: 'co-1',
    customerId: 'cust-1',
    providerUserId: 'U1',
    retryKey: 'retry-1',
    channelIdentity: { status: 'ACTIVE', unfollowedAt: null },
    campaign: { channelId: 'ch-1', messageText: 'hello' },
  };

  const campaigns = {
    due: async () => [{ id: 'rec-1', campaignId: 'camp-1' }],
    claim: async () => ({ count: 1 }),
    recipient: async () => recipient,
    currentConsent: async () => ({ consentStatus: 'GRANTED' }),
    deliveryResult: async (_id: string, ok: boolean) => { sent.push(`result:${ok}`); },
    reconcile: async () => {},
  } as any;
  const inbox = {
    getConsentPolicy: async () => ({ marketingRequiresExplicitConsent: true }),
    findChannelById: async () => ({ id: 'ch-1', status: 'ACTIVE' }),
  } as any;
  const secrets = { decrypt: () => ({ accessToken: 'token' }) } as any;
  const line = { pushTextMessage: async () => { sent.push('push'); return { ok: true }; } } as any;
  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey });
        return { wouldBlock, reason: wouldBlock ? ('feature_disabled' as const) : ('available' as const) };
      },
      flush: () => ({}),
    }),
  } as any;

  return { useCase: new DeliverCrmCampaignUseCase(campaigns, inbox, secrets, line, shadow), sent, shadowRecords };
}

describe('DeliverCrmCampaignUseCase — F1 shadow', () => {
  it('records the shadow decision per recipient and delivers regardless of it', async () => {
    const blocked = makeUseCase(true);
    const allowed = makeUseCase(false);

    const blockedResult = await blocked.useCase.execute();
    const allowedResult = await allowed.useCase.execute();

    assert.deepEqual(blockedResult, allowedResult, 'the shadow decision changed delivery');
    assert.deepEqual(blockedResult, { processed: 1, delivered: 1, failed: 0 });
    assert.deepEqual(blocked.sent, allowed.sent);
    assert.equal(blocked.sent.includes('push'), true, 'the LINE push still happened under would_block');
    assert.deepEqual(blocked.shadowRecords, [{ surface: 'crm.campaign.delivery', companyId: 'co-1', featureKey: 'crm' }]);
  });
});

/**
 * The real probe against a fake database, so the fold is exercised end to end rather than stubbed:
 * an observation buffered before a mid-sweep failure must still reach a durable bucket. Losing it
 * would leave no row AND no persist_failed warn, so later healthy sweeps would make the health view
 * look normal while a BLOCKING observation had vanished.
 */
function makeUseCaseThatThrowsMidSweep() {
  const upserts: any[] = [];
  const prisma = {
    client: {
      // CLOSED, so the observation this sweep buffers is a would_block — the evidence that matters.
      featureLaunchGate: { findMany: async () => [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'CLOSED', generation: 1 }] },
      companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'crm', enabled: true }] },
      featureLaunchObservationBucket: { upsert: async (args: any) => { upserts.push(args); return { id: 'bucket-1' }; } },
    },
  } as any;
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as any;

  const campaigns = {
    due: async () => [{ id: 'rec-1', campaignId: 'camp-1' }],
    claim: async () => ({ count: 1 }),
    recipient: async () => ({
      id: 'rec-1',
      companyId: 'co-1',
      customerId: 'cust-1',
      providerUserId: 'U1',
      retryKey: 'retry-1',
      channelIdentity: { status: 'ACTIVE', unfollowedAt: null },
      campaign: { channelId: 'ch-1', messageText: 'hello' },
    }),
    // The first step AFTER the observation is recorded. A repository failure here is the exact
    // window the defect lived in.
    currentConsent: async () => { throw new Error('CONSENT_READ_FAILED'); },
    deliveryResult: async () => {},
    reconcile: async () => {},
  } as any;
  const inbox = { getConsentPolicy: async () => ({ marketingRequiresExplicitConsent: true }), findChannelById: async () => null } as any;
  const secrets = { decrypt: () => ({ accessToken: 'token' }) } as any;
  const line = { pushTextMessage: async () => ({ ok: true }) } as any;

  return {
    useCase: new DeliverCrmCampaignUseCase(campaigns, inbox, secrets, line, new LaunchShadowProbe(prisma, logger)),
    upserts,
  };
}

describe('DeliverCrmCampaignUseCase — buffered evidence survives a mid-sweep failure', () => {
  it('persists the recorded would_block and still propagates the original error', async () => {
    const { useCase, upserts } = makeUseCaseThatThrowsMidSweep();

    await assert.rejects(() => useCase.execute(), /CONSENT_READ_FAILED/, 'the flush must not mask the real failure');

    assert.equal(upserts.length, 1, 'the observation buffered before the throw was lost');
    const key = upserts[0].where.bucketKey;
    assert.equal(key.gateKey, 'crm');
    assert.equal(key.surface, 'crm.campaign.delivery');
    assert.equal(key.reason, 'launch_gate_closed');
    assert.equal(key.wouldBlock, true);
    assert.equal(upserts[0].create.observedCount, 1);
  });
});
