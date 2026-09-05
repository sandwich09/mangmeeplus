import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { SystemOnboardingController } from './system-onboarding.controller';

// Review MEDIUM-2/LOW-5: this route persists the owner's handoff URL on the onboarding run, so it
// must not be built from headers the caller controls.
const REQ = {
  headers: { origin: 'https://evil.example.com', 'x-forwarded-host': 'evil.example.com' },
  protocol: 'https',
  get: () => 'evil.example.com',
  context: { userId: 'admin-1', requestId: 'req-1' },
} as any;

const DTO = { companyName: 'ร้านทดสอบ', businessCategory: 'RETAIL', ownerDisplayName: 'สมชาย', ownerUsername: 'somchai' } as any;

function harness(sesWebBaseUrl: string | null = 'https://app.mangmeeplus.com') {
  const calls: any[] = [];
  const createOnboarding = { execute: async (cmd: any) => { calls.push(cmd); return {} as any; } } as any;
  return {
    controller: new SystemOnboardingController(
      createOnboarding, {} as any, {} as any, {} as any,
      { sesWebBaseUrl: sesWebBaseUrl ?? undefined } as any,
    ),
    calls,
  };
}

describe('SystemOnboardingController — the handoff base it persists', () => {
  it('takes the web base from configuration, never from the caller headers', async () => {
    const h = harness();
    await h.controller.create(DTO, REQ);
    assert.equal(h.calls[0].webBaseUrl, 'https://app.mangmeeplus.com');
    assert.equal(h.calls[0].webBaseUrl.includes('evil.example.com'), false);
  });

  it('creates nothing when no web origin is configured', async () => {
    const h = harness(null);
    await assert.rejects(async () => h.controller.create(DTO, REQ), ServiceUnavailableException);
    assert.deepEqual(h.calls, []);
  });
});
