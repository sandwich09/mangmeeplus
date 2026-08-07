import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmConversationSummaryAgent } from './crm-conversation-summary.agent';
import type { CrmConversationSummaryRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (over: Partial<CrmConversationSummaryRequest> = {}): CrmConversationSummaryRequest => ({
  requestId: 'req-summary',
  companyId: 'company-1',
  window: [{ role: 'CUSTOMER', text: 'อยากจองพรุ่งนี้ครับ', at: '2026-07-09T03:00:00.000Z' }],
  ...over,
});

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmConversationSummaryAgent (B5 gateway)', () => {
  it('returns ok + summaryText + confidence for a well-formed summary', async () => {
    const out = await new CrmConversationSummaryAgent().run(
      providerReturning(JSON.stringify({ summaryText: 'ลูกค้าต้องการจองคิวพรุ่งนี้ ยังไม่ได้ยืนยันเวลา', confidence: 0.8 })),
      req(),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-summary',
      summaryText: 'ลูกค้าต้องการจองคิวพรุ่งนี้ ยังไม่ได้ยืนยันเวลา',
      confidence: 0.8,
    });
  });

  it('extracts JSON from a code fence', async () => {
    const out = await new CrmConversationSummaryAgent().run(
      providerReturning('```json\n{"summaryText":"ลูกค้าถามเวลาทำการ","confidence":0.6}\n```'),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-summary', summaryText: 'ลูกค้าถามเวลาทำการ', confidence: 0.6 });
  });

  it('returns uncertain when the model output is not JSON', async () => {
    const out = await new CrmConversationSummaryAgent().run(providerReturning('not json'), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-summary' });
  });

  it('returns uncertain when summaryText is missing', async () => {
    const out = await new CrmConversationSummaryAgent().run(providerReturning(JSON.stringify({ confidence: 0.7 })), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-summary' });
  });

  it('passes a provider error through as typed unavailable', async () => {
    const provider = {
      generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_TIMEOUT', message: 'slow', retryable: true } }),
    } as any;
    const out = await new CrmConversationSummaryAgent().run(provider, req());
    assert.deepEqual(out, {
      status: 'unavailable',
      requestId: 'req-summary',
      error: { code: 'PROVIDER_TIMEOUT', message: 'slow', retryable: true },
    });
  });

  it('bounds the window to the last 20 turns before sending to the provider', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ summaryText: 'x', confidence: 0.5 }) };
      },
    } as any;
    await new CrmConversationSummaryAgent().run(
      provider,
      req({
        window: Array.from({ length: 25 }, (_, i) => ({ role: 'CUSTOMER' as const, text: `m${i}`, at: '2026-07-09T03:00:00.000Z' })),
      }),
    );
    const sent = JSON.parse(captured!.messages[0].text) as { locale?: string; window: Array<{ text: string }> };
    assert.equal(captured!.maxTokens, 1600);
    assert.equal(sent.locale, undefined);
    assert.equal(sent.window.length, 20);
    assert.equal(sent.window[0].text, 'm5');
    assert.equal(sent.window[19].text, 'm24');
  });

  it('clamps confidence and bounds an over-long summary', async () => {
    const long = '😀'.repeat(2500);
    const out = await new CrmConversationSummaryAgent().run(
      providerReturning(JSON.stringify({ summaryText: long, confidence: 5 })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-summary', summaryText: '😀'.repeat(2000), confidence: 1 });
  });

  it('clamps a negative confidence up to 0', async () => {
    const out = await new CrmConversationSummaryAgent().run(
      providerReturning(JSON.stringify({ summaryText: 'สรุป', confidence: -1 })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-summary', summaryText: 'สรุป', confidence: 0 });
  });
});
