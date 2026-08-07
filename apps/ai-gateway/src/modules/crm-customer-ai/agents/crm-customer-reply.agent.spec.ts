import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmCustomerReplyAgent } from './crm-customer-reply.agent';
import type { CrmReplyDraftRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (over: Partial<CrmReplyDraftRequest> = {}): CrmReplyDraftRequest => ({
  requestId: 'req-reply',
  companyId: 'company-1',
  mode: 'STAFF_ASSIST',
  window: [{ role: 'CUSTOMER', text: 'เปิดกี่โมงครับ', at: '2026-07-09T03:00:00.000Z' }],
  brand: { brandName: 'ร้านบอมบัม', channelDisplayName: 'Bombam OA' },
  templates: [{ title: 'เวลาทำการ', body: 'เปิดทุกวัน 9:00-18:00 ค่ะ' }],
  catalog: [{ id: 'svc-1', sku: 'SVC-1', name: 'นวดไทย', kind: 'SERVICE', unit: 'ครั้ง', salePrice: '500' }],
  ...over,
});

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmCustomerReplyAgent (B3 gateway)', () => {
  it('STAFF_ASSIST: returns ok + draftText + confidence for a well-formed draft', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: 'เปิด 9:00-18:00 ค่ะ', confidence: 0.8, needsHuman: false })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-reply', draftText: 'เปิด 9:00-18:00 ค่ะ', confidence: 0.8 });
  });

  it('extracts JSON from a code fence', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning('```json\n{"draftText":"สวัสดีค่ะ","confidence":0.6,"needsHuman":false}\n```'),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-reply', draftText: 'สวัสดีค่ะ', confidence: 0.6 });
  });

  it('AUTONOMOUS: exposes needsHuman as a policy signal even with no draft', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: '', confidence: 0.2, needsHuman: true })),
      req({ mode: 'AUTONOMOUS' }),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-reply',
      draftText: '',
      confidence: 0.2,
      needsHumanSignal: true,
    });
  });

  it('AUTONOMOUS: needsHuman stays a signal even when the model composed a draft', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: 'ราคา 500 บาทครับ', confidence: 0.7, needsHuman: true })),
      req({ mode: 'AUTONOMOUS' }),
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-reply',
      draftText: 'ราคา 500 บาทครับ',
      confidence: 0.7,
      needsHumanSignal: true,
    });
  });

  it('STAFF_ASSIST: needsHuman with no draft degrades to uncertain, not refused', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: '', confidence: 0.3, needsHuman: true })),
      req(),
    );
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-reply' });
  });

  it('STAFF_ASSIST: hands over the draft even when the model flagged needsHuman (a human reviews)', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: 'เดี๋ยวเช็คให้นะคะ', confidence: 0.5, needsHuman: true })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-reply', draftText: 'เดี๋ยวเช็คให้นะคะ', confidence: 0.5 });
  });

  it('returns uncertain when the model output is unusable (no draft, no needsHuman)', async () => {
    const out = await new CrmCustomerReplyAgent().run(providerReturning('not json'), req());
    assert.deepEqual(out, { status: 'uncertain', requestId: 'req-reply' });
  });

  it('passes a provider error through as typed unavailable', async () => {
    const provider = {
      generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_TIMEOUT', message: 'slow', retryable: true } }),
    } as any;
    const out = await new CrmCustomerReplyAgent().run(provider, req());
    assert.deepEqual(out, {
      status: 'unavailable',
      requestId: 'req-reply',
      error: { code: 'PROVIDER_TIMEOUT', message: 'slow', retryable: true },
    });
  });

  it('clamps confidence and bounds an over-long draft', async () => {
    const long = 'ก'.repeat(1500);
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: long, confidence: 9, needsHuman: false })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-reply', draftText: 'ก'.repeat(1000), confidence: 1 });
  });

  it('clamps a negative confidence up to 0', async () => {
    const out = await new CrmCustomerReplyAgent().run(
      providerReturning(JSON.stringify({ draftText: 'ตอบครับ', confidence: -1, needsHuman: false })),
      req(),
    );
    assert.deepEqual(out, { status: 'ok', requestId: 'req-reply', draftText: 'ตอบครับ', confidence: 0 });
  });

  it('bounds window (last 20) and templates (first 10) sent to the provider', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ draftText: 'x', confidence: 0.5, needsHuman: false }) };
      },
    } as any;
    await new CrmCustomerReplyAgent().run(
      provider,
      req({
        window: Array.from({ length: 25 }, (_, i) => ({ role: 'CUSTOMER' as const, text: `m${i}`, at: '2026-07-09T03:00:00.000Z' })),
        templates: Array.from({ length: 14 }, (_, i) => ({ title: `t${i}`, body: `b${i}` })),
      }),
    );
    const sent = JSON.parse(captured!.messages[0].text) as { window: unknown[]; templates: unknown[] };
    assert.equal(sent.window.length, 20);
    assert.equal(sent.templates.length, 10);
  });

  it('adds tone to the prompt only when present', async () => {
    const captures: string[] = [];
    const provider = {
      generateText: async (input: ProviderInput) => {
        captures.push(input.messages[0].text);
        return { ok: true as const, text: JSON.stringify({ draftText: 'x', confidence: 0.5, needsHuman: false }) };
      },
    } as any;
    await new CrmCustomerReplyAgent().run(provider, req());
    await new CrmCustomerReplyAgent().run(provider, req({ tone: 'สุภาพและอบอุ่น' }));

    assert.equal(captures[0].includes('Tone override:'), false);
    assert.equal(captures[1], `${captures[0]}\nTone override: สุภาพและอบอุ่น`);
  });

  it('bounds tone in the prompt defensively', async () => {
    let captured = '';
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input.messages[0].text;
        return { ok: true as const, text: JSON.stringify({ draftText: 'x', confidence: 0.5, needsHuman: false }) };
      },
    } as any;
    await new CrmCustomerReplyAgent().run(provider, req({ tone: 'x'.repeat(120) }));

    assert.equal(captured.endsWith(`\nTone override: ${'x'.repeat(100)}`), true);
  });
});
