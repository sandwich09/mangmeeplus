import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmInsightsAgent } from './crm-insights.agent';
import type { CrmInsightsRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (over: Partial<CrmInsightsRequest> = {}): CrmInsightsRequest => ({
  requestId: 'req-insights',
  companyId: 'company-1',
  consent: 'GRANTED',
  window: [{ role: 'CUSTOMER', text: 'อยากจองพรุ่งนี้ครับ', at: '2026-07-09T03:00:00.000Z' }],
  ...over,
});

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmInsightsAgent (B5 gateway)', () => {
  it('returns ok insights for a well-formed result', async () => {
    const out = await new CrmInsightsAgent().run(
      providerReturning(
        JSON.stringify({
          intent: 'BOOKING_REQUEST',
          sentiment: 'POSITIVE',
          risk: 'LOW',
          leadScore: 82,
          nextBestAction: 'เสนอเวลาว่างและยืนยันคิว',
          confidence: 0.8,
        }),
      ),
      req(),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-insights',
      intent: 'BOOKING_REQUEST',
      sentiment: 'POSITIVE',
      risk: 'LOW',
      leadScore: 82,
      nextBestAction: 'เสนอเวลาว่างและยืนยันคิว',
      confidence: 0.8,
    });
  });

  it('extracts JSON from a code fence', async () => {
    const out = await new CrmInsightsAgent().run(
      providerReturning(
        '```json\n{"intent":"QUESTION","sentiment":"NEUTRAL","risk":"LOW","leadScore":40,"nextBestAction":"ตอบเวลาทำการ","confidence":0.6}\n```',
      ),
      req(),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-insights',
      intent: 'QUESTION',
      sentiment: 'NEUTRAL',
      risk: 'LOW',
      leadScore: 40,
      nextBestAction: 'ตอบเวลาทำการ',
      confidence: 0.6,
    });
  });

  it('returns uncertain when the model output is not JSON', async () => {
    const out = await new CrmInsightsAgent().run(providerReturning('not json'), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-insights' });
  });

  it('returns uncertain when an enum value is invalid', async () => {
    const out = await new CrmInsightsAgent().run(
      providerReturning(
        JSON.stringify({
          intent: 'ANGRY',
          sentiment: 'NEUTRAL',
          risk: 'LOW',
          leadScore: 40,
          nextBestAction: 'ให้พนักงานตอบ',
          confidence: 0.6,
        }),
      ),
      req(),
    );
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-insights' });
  });

  it('passes a provider error through as typed unavailable', async () => {
    const provider = {
      generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false } }),
    } as any;
    const out = await new CrmInsightsAgent().run(provider, req());
    assert.deepEqual(out, {
      status: 'unavailable',
      requestId: 'req-insights',
      error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false },
    });
  });

  it('bounds the window to the last 20 turns before sending to the provider', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return {
          ok: true as const,
          text: JSON.stringify({
            intent: 'QUESTION',
            sentiment: 'NEUTRAL',
            risk: 'LOW',
            leadScore: 40,
            nextBestAction: 'ตอบคำถาม',
            confidence: 0.5,
          }),
        };
      },
    } as any;
    await new CrmInsightsAgent().run(
      provider,
      req({
        window: Array.from({ length: 25 }, (_, i) => ({ role: 'CUSTOMER' as const, text: `m${i}`, at: '2026-07-09T03:00:00.000Z' })),
      }),
    );
    const sent = JSON.parse(captured!.messages[0].text) as { locale?: string; window: Array<{ text: string }> };
    assert.equal(captured!.maxTokens, 600);
    assert.equal(sent.locale, undefined);
    assert.equal(sent.window.length, 20);
    assert.equal(sent.window[0].text, 'm5');
    assert.equal(sent.window[19].text, 'm24');
  });

  it('clamps confidence, leadScore, and nextBestAction length', async () => {
    const long = '😀'.repeat(500);
    const out = await new CrmInsightsAgent().run(
      providerReturning(
        JSON.stringify({
          intent: 'COMPLAINT',
          sentiment: 'NEGATIVE',
          risk: 'HIGH',
          leadScore: 140.6,
          nextBestAction: long,
          confidence: 5,
        }),
      ),
      req(),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-insights',
      intent: 'COMPLAINT',
      sentiment: 'NEGATIVE',
      risk: 'HIGH',
      leadScore: 100,
      nextBestAction: '😀'.repeat(300),
      confidence: 1,
    });
  });

  it('clamps negative confidence and leadScore up to 0', async () => {
    const out = await new CrmInsightsAgent().run(
      providerReturning(
        JSON.stringify({
          intent: 'QUESTION',
          sentiment: 'NEUTRAL',
          risk: 'LOW',
          leadScore: -5,
          nextBestAction: 'ตอบคำถาม',
          confidence: -1,
        }),
      ),
      req(),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-insights',
      intent: 'QUESTION',
      sentiment: 'NEUTRAL',
      risk: 'LOW',
      leadScore: 0,
      nextBestAction: 'ตอบคำถาม',
      confidence: 0,
    });
  });
});
