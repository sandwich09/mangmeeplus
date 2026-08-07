import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmTrustScoreAgent } from './crm-trust-score.agent';
import type { CrmTrustScoreRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (over: Partial<CrmTrustScoreRequest> = {}): CrmTrustScoreRequest => ({
  requestId: 'req-trust',
  companyId: 'company-1',
  signals: { tenureDays: 120, inboundMessageCount: 40, bookingsCount: 5, noShowCount: 0 },
  ...over,
});

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmTrustScoreAgent (B4 gateway)', () => {
  it('returns ok + score + reasoning for a well-formed result', async () => {
    const out = await new CrmTrustScoreAgent().run(
      providerReturning(JSON.stringify({ score: 82, reasoning: 'long tenure, no no-shows' })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-trust', score: 82, reasoning: 'long tenure, no no-shows' });
  });

  it('clamps and rounds the score into 0..100', async () => {
    const high = await new CrmTrustScoreAgent().run(providerReturning(JSON.stringify({ score: 140.7 })), req());
    assert.deepEqual(high, { status: 'ok', requestId: 'req-trust', score: 100 });
    const low = await new CrmTrustScoreAgent().run(providerReturning(JSON.stringify({ score: -5 })), req());
    assert.deepEqual(low, { status: 'ok', requestId: 'req-trust', score: 0 });
    const rounded = await new CrmTrustScoreAgent().run(providerReturning(JSON.stringify({ score: 63.4 })), req());
    assert.deepEqual(rounded, { status: 'ok', requestId: 'req-trust', score: 63 });
  });

  it('returns uncertain when the score is missing or non-numeric', async () => {
    const out = await new CrmTrustScoreAgent().run(providerReturning(JSON.stringify({ reasoning: 'no score' })), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-trust' });
  });

  it('returns uncertain when the model output is not JSON', async () => {
    const out = await new CrmTrustScoreAgent().run(providerReturning('totally not json'), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-trust' });
  });

  it('bounds the reasoning length', async () => {
    const out = await new CrmTrustScoreAgent().run(
      providerReturning(JSON.stringify({ score: 50, reasoning: 'x'.repeat(500) })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-trust', score: 50, reasoning: 'x'.repeat(300) });
  });

  it('passes a provider error through as typed unavailable', async () => {
    const provider = {
      generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false } }),
    } as any;
    const out = await new CrmTrustScoreAgent().run(provider, req());
    assert.deepEqual(out, {
      status: 'unavailable',
      requestId: 'req-trust',
      error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false },
    });
  });

  it('includes priorScore in the provider payload when given', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ score: 70 }) };
      },
    } as any;
    await new CrmTrustScoreAgent().run(provider, req({ priorScore: 65 }));
    const sent = JSON.parse(captured!.messages[0].text) as { priorScore?: number };
    assert.equal(sent.priorScore, 65);
  });
});
