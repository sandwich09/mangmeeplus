import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmBookingExtractAgent } from './crm-booking-extract.agent';
import type { CrmBookingExtractRequest } from '@watchdog-bms/contracts';
import type { ProviderInput } from '../../line-ai/infrastructure/provider/provider.port';

const req = (window: CrmBookingExtractRequest['window']): CrmBookingExtractRequest => ({
  requestId: 'req-booking-extract',
  companyId: 'company-1',
  consent: 'GRANTED',
  todayBangkok: '2026-07-10',
  catalog: [{ id: 'svc-1', sku: 'SVC-1', name: 'นวดไทย', kind: 'SERVICE', unit: 'ครั้ง', bookingDurationMinutes: 90 }],
  window,
});

const oneTurn = req([{ role: 'CUSTOMER', text: 'พรุ่งนี้บ่าย 2 จองนวดไทย 90 นาทีได้ไหม', at: '2026-07-10T03:00:00.000Z' }]);

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('CrmBookingExtractAgent (P4a)', () => {
  it('parses a well-formed model extraction to ok + normalized fields', async () => {
    const out = await new CrmBookingExtractAgent().run(
      providerReturning(
        JSON.stringify({
          status: 'ok',
          catalogItemId: 'svc-1',
          serviceName: 'นวดไทย',
          date: '2026-07-11',
          timeHHmm: '14:00',
          durationMinutes: 90,
          confidence: 0.88,
        }),
      ),
      oneTurn,
    );
    assert.deepEqual(out, {
      status: 'ok',
      requestId: 'req-booking-extract',
      catalogItemId: 'svc-1',
      serviceName: 'นวดไทย',
      date: '2026-07-11',
      timeHHmm: '14:00',
      durationMinutes: 90,
      confidence: 0.88,
    });
  });

  it('returns unclear when the model output is malformed or empty', async () => {
    const malformed = await new CrmBookingExtractAgent().run(providerReturning('no json here'), oneTurn);
    assert.deepEqual(malformed, { status: 'unclear', requestId: 'req-booking-extract', confidence: 0 });

    const empty = await new CrmBookingExtractAgent().run(providerReturning(''), oneTurn);
    assert.deepEqual(empty, { status: 'unclear', requestId: 'req-booking-extract', confidence: 0 });
  });

  it('passes todayBangkok and bounds the window to the last 20 turns', async () => {
    let captured: ProviderInput | undefined;
    const provider = {
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true as const, text: JSON.stringify({ status: 'unclear', confidence: 0.2 }) };
      },
    } as any;
    const many = req(
      Array.from({ length: 25 }, (_, i) => ({ role: 'CUSTOMER' as const, text: `m${i}`, at: '2026-07-10T03:00:00.000Z' })),
    );
    await new CrmBookingExtractAgent().run(provider, many);
    const sent = JSON.parse(captured!.messages[0].text) as { todayBangkok: string; catalog: Array<{ id: string }>; window: Array<{ text: string }> };
    assert.equal(sent.todayBangkok, '2026-07-10');
    assert.equal(sent.catalog[0]?.id, 'svc-1');
    assert.equal(sent.window.length, 20);
    assert.equal(sent.window[0].text, 'm5');
    assert.equal(sent.window[19].text, 'm24');
    assert.match(captured!.systemPrompt ?? '', /catalogItemId/);
  });
});
