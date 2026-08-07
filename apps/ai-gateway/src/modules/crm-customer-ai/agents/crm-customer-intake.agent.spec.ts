import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmCustomerIntakeAgent } from './crm-customer-intake.agent';
import type { CrmCustomerIntakeRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (window: CrmCustomerIntakeRequest['window']): CrmCustomerIntakeRequest => ({
  requestId: 'req-intake',
  companyId: 'company-1',
  consent: 'GRANTED',
  window,
});

const oneTurn = req([{ role: 'CUSTOMER', text: 'เปิดกี่โมงครับ', at: '2026-07-09T03:00:00.000Z' }]);

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmCustomerIntakeAgent (B2)', () => {
  it('classifies a well-formed model result to ok + turnClass + confidence', async () => {
    const out = await new CrmCustomerIntakeAgent().run(
      providerReturning(JSON.stringify({ turnClass: 'QUESTION', confidence: 0.9 })),
      oneTurn,
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-intake', turnClass: 'QUESTION', confidence: 0.9 });
  });

  it('extracts JSON even when the model wraps it in a code fence', async () => {
    const out = await new CrmCustomerIntakeAgent().run(
      providerReturning('```json\n{"turnClass":"BOOKING_REQUEST","confidence":0.7}\n```'),
      oneTurn,
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-intake', turnClass: 'BOOKING_REQUEST', confidence: 0.7 });
  });

  it('returns uncertain when the class is not in the allowed set', async () => {
    const out = await new CrmCustomerIntakeAgent().run(
      providerReturning(JSON.stringify({ turnClass: 'ANGRY', confidence: 0.9 })),
      oneTurn,
    );
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-intake' });
  });

  it('returns uncertain when the model output is not JSON', async () => {
    const out = await new CrmCustomerIntakeAgent().run(providerReturning('no json here'), oneTurn);
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-intake' });
  });

  it('clamps an out-of-range confidence, defaults a missing one to 0', async () => {
    const high = await new CrmCustomerIntakeAgent().run(
      providerReturning(JSON.stringify({ turnClass: 'SPAM', confidence: 5 })),
      oneTurn,
    );
    assert.deepEqual(high, { status: 'ok', requestId: 'req-intake', turnClass: 'SPAM', confidence: 1 });
    const none = await new CrmCustomerIntakeAgent().run(
      providerReturning(JSON.stringify({ turnClass: 'COMPLAINT' })),
      oneTurn,
    );
    assert.deepEqual(none, { status: 'ok', requestId: 'req-intake', turnClass: 'COMPLAINT', confidence: 0 });
  });

  it('clamps a negative confidence up to 0', async () => {
    const out = await new CrmCustomerIntakeAgent().run(
      providerReturning(JSON.stringify({ turnClass: 'QUESTION', confidence: -0.5 })),
      oneTurn,
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-intake', turnClass: 'QUESTION', confidence: 0 });
  });

  it('passes a provider error through as typed unavailable', async () => {
    const provider = {
      generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false } }),
    } as any;
    const out = await new CrmCustomerIntakeAgent().run(provider, oneTurn);
    assert.deepEqual(out, {
      status: 'unavailable',
      requestId: 'req-intake',
      error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false },
    });
  });

  it('bounds the window to the last 20 turns before sending to the provider', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ turnClass: 'QUESTION', confidence: 0.5 }) };
      },
    } as any;
    const many = req(
      Array.from({ length: 25 }, (_, i) => ({ role: 'CUSTOMER' as const, text: `m${i}`, at: '2026-07-09T03:00:00.000Z' })),
    );
    await new CrmCustomerIntakeAgent().run(provider, many);
    const sent = JSON.parse(captured!.messages[0].text) as { window: Array<{ text: string }> };
    assert.equal(sent.window.length, 20);
    assert.equal(sent.window[0].text, 'm5'); // last 20 of m0..m24 → m5..m24
    assert.equal(sent.window[19].text, 'm24');
  });

  it('tells the semantic classifier that natural booking acceptance confirms an active proposal', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ turnClass: 'CONFIRMATION', confidence: 0.9 }) };
      },
    } as any;
    await new CrmCustomerIntakeAgent().run(provider, req([
      { role: 'AI', text: 'ต้องการจอง Court Pink เวลา 15:00 ใช่ไหมคะ', at: '2026-07-09T03:00:00.000Z' },
      { role: 'CUSTOMER', text: 'จองครับ', at: '2026-07-09T03:01:00.000Z' },
    ]));
    assert.match(captured!.systemPrompt ?? '', /จองครับ/);
    assert.match(captured!.systemPrompt ?? '', /CONFIRMATION, not a new BOOKING_REQUEST/);
  });
});
