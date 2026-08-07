import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { CrmCustomerAiInternalController } from './crm-customer-ai-internal.controller';
import type { CrmBookingExtractRequest, CrmReplyDraftRequest } from '@watchdog-bms/contracts';

const replyReq = (over: Partial<CrmReplyDraftRequest> = {}): CrmReplyDraftRequest => ({
  requestId: 'req-reply',
  companyId: 'company-1',
  mode: 'STAFF_ASSIST',
  window: [{ role: 'CUSTOMER', text: 'เปิดกี่โมงครับ', at: '2026-07-09T03:00:00.000Z' }],
  brand: { brandName: 'ร้านบอมบัม', channelDisplayName: 'Bombam OA' },
  templates: [{ title: 'เวลาทำการ', body: 'เปิดทุกวัน 9:00-18:00 ค่ะ' }],
  catalog: [],
  ...over,
});

const bookingExtractReq = (over: Partial<CrmBookingExtractRequest> = {}): CrmBookingExtractRequest => ({
  requestId: 'req-booking',
  companyId: 'company-1',
  window: [{ role: 'CUSTOMER', text: 'พรุ่งนี้บ่ายสองจองนวดไทย', at: '2026-07-10T03:00:00.000Z' }],
  consent: 'GRANTED',
  todayBangkok: '2026-07-10',
  catalog: [{ id: 'svc-1', sku: 'SVC-1', name: 'นวดไทย', kind: 'SERVICE', unit: 'ครั้ง' }],
  ...over,
});

function controller(): CrmCustomerAiInternalController {
  const fail = { execute: async () => { throw new Error('should not execute'); } };
  return new CrmCustomerAiInternalController(
    { aiGatewayInternalSecret: 'secret' } as any,
    fail as any,
    fail as any,
    fail as any,
    fail as any,
    fail as any,
    fail as any,
    fail as any,
    fail as any,
  );
}

// A real provider is built here on purpose: the model the factory picks is the behaviour
// under test, and OpenAiProvider construction is pure (no client, no network).
const providerConfig = {
  aiGatewayInternalSecret: 'secret',
  modelProvider: 'openai',
  openAiApiKey: 'test-key',
  openAiModel: 'platform-default',
  aiToolTimeoutMs: 1_000,
} as any;

function capturingController(seen: any[]): CrmCustomerAiInternalController {
  const capture = {
    execute: async (provider: unknown) => {
      seen.push(provider);
      return { requestId: 'req-policy', status: 'uncertain' as const };
    },
  };
  return new CrmCustomerAiInternalController(
    providerConfig,
    capture as any,
    capture as any,
    capture as any,
    capture as any,
    capture as any,
    capture as any,
    capture as any,
    capture as any,
  );
}

const policyWindow = [{ role: 'CUSTOMER' as const, text: 'สวัสดีค่ะ', at: '2026-07-28T03:00:00.000Z' }];
const crmRoutes: Array<{ name: string; run: (c: CrmCustomerAiInternalController, extra: object) => Promise<unknown> }> = [
  { name: 'crm-booking-extract', run: (c, extra) => c.crmBookingExtract('secret', { ...bookingExtractReq(), ...extra } as any) },
  { name: 'crm-intake', run: (c, extra) => c.crmIntake('secret', { requestId: 'req-policy', companyId: 'company-1', window: policyWindow, consent: 'GRANTED', ...extra } as any) },
  { name: 'crm-customer-profile-extract', run: (c, extra) => c.crmCustomerProfileExtract('secret', { requestId: 'req-policy', companyId: 'company-1', text: 'ลูกค้าชื่อสมชาย', ...extra } as any) },
  { name: 'crm-reply-draft', run: (c, extra) => c.crmReplyDraft('secret', { ...replyReq(), ...extra } as any) },
  { name: 'crm-trust-score', run: (c, extra) => c.crmTrustScore('secret', { requestId: 'req-policy', companyId: 'company-1', signals: { tenureDays: 3, inboundMessageCount: 2, bookingsCount: 0, noShowCount: 0 }, ...extra } as any) },
  { name: 'crm-summary', run: (c, extra) => c.crmSummary('secret', { requestId: 'req-policy', companyId: 'company-1', window: policyWindow, ...extra } as any) },
  { name: 'crm-insights', run: (c, extra) => c.crmInsights('secret', { requestId: 'req-policy', companyId: 'company-1', window: policyWindow, consent: 'GRANTED', ...extra } as any) },
  { name: 'crm-broadcast', run: (c, extra) => c.crmBroadcast('secret', { requestId: 'req-policy', companyId: 'company-1', topic: 'โปรโมชั่นเดือนนี้', tone: 'friendly', ...extra } as any) },
];

describe('CrmCustomerAiInternalController per-company model policy', () => {
  it('runs every CRM route on the model the API resolved for the company', async () => {
    for (const route of crmRoutes) {
      const seen: any[] = [];
      await route.run(capturingController(seen), { modelPolicy: { modelId: 'tenant-model-v1' } });
      assert.equal(seen.length, 1, route.name);
      assert.equal(seen[0].cfg.model, 'tenant-model-v1', route.name);
    }
  });

  it('falls back to the platform default model when the request carries no policy', async () => {
    for (const route of crmRoutes) {
      const seen: any[] = [];
      await route.run(capturingController(seen), {});
      assert.equal(seen[0].cfg.model, 'platform-default', route.name);
    }
  });
});

describe('CrmCustomerAiInternalController', () => {
  it('rejects reply draft tone longer than 100 chars', async () => {
    await assert.rejects(
      () => controller().crmReplyDraft('secret', replyReq({ tone: 'x'.repeat(101) })),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects reply draft mode outside the contract enum', async () => {
    await assert.rejects(
      () => controller().crmReplyDraft('secret', replyReq({ mode: 'SEND_NOW' as any })),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects booking extract payloads without a Bangkok yyyy-mm-dd today date', async () => {
    await assert.rejects(
      () => controller().crmBookingExtract('secret', bookingExtractReq({ todayBangkok: '10/07/2026' })),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects oversized customer profile extraction input before model execution', async () => {
    await assert.rejects(
      () => controller().crmCustomerProfileExtract('secret', { requestId: 'req-profile', companyId: 'company-1', text: 'x'.repeat(2_001) }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
