import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { CreateOnboardingDto, SystemOnboardingController } from './system-onboarding.controller';
import 'reflect-metadata';

// Review MEDIUM-2/LOW-5: this route persists the owner's handoff URL on the onboarding run, so it
// must not be built from headers the caller controls.
const REQ = {
  headers: { origin: 'https://evil.example.com', 'x-forwarded-host': 'evil.example.com' },
  protocol: 'https',
  get: () => 'evil.example.com',
  context: { userId: 'admin-1', requestId: 'req-1' },
} as any;

const DTO = { companyName: 'ร้านทดสอบ', ownerDisplayName: 'สมชาย', ownerUsername: 'somchai' } as any;

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

// Review A-04. The console's third owner shape: the customer lives on LINE, so there is no username
// to hand over and no temporary password to leak — the owner LINE-link QR is the whole handover.
describe('SystemOnboardingController — "ลูกค้าใช้ LINE เท่านั้น"', () => {
  it('asks for the line-link-later owner and sends no username', async () => {
    const h = harness();
    await h.controller.create(
      { companyName: 'ร้านนิด', ownerDisplayName: 'นิด', ownerLineOnly: true } as any,
      REQ,
    );
    assert.deepEqual(h.calls[0].ownerAuth, { kind: 'line-link-later' });
    assert.equal('ownerUsername' in h.calls[0], false, 'an absent username is not an empty one');
  });

  // The field became optional in the type so a LINE-only owner can omit it. Without ValidateIf a
  // caller that simply forgot it would slip past the pipe and get the use-case's 422 instead of the
  // 400 it has always had.
  it('still answers a forgotten username with a validation error, not a use-case one', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const metadata = { type: 'body' as const, metatype: CreateOnboardingDto };
    const { ownerUsername, ...withoutUsername } = DTO;

    await assert.rejects(
      () => pipe.transform(withoutUsername, metadata),
      (error: any) => error.status === 400,
    );
    // …and the LINE-only shape is accepted without one.
    await pipe.transform({ ...withoutUsername, ownerLineOnly: true }, metadata);
  });

  it('leaves the default password path byte-identical when the option is off', async () => {
    const h = harness();
    await h.controller.create(DTO, REQ);
    assert.equal('ownerAuth' in h.calls[0], false);
    assert.equal(h.calls[0].ownerUsername, 'somchai');
  });
});
