import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminSignupQueueItemDto } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { SignupRowActions } = require('./SignupQueuePage') as typeof import('./SignupQueuePage');

function item(overrides: Partial<AdminSignupQueueItemDto> = {}): AdminSignupQueueItemDto {
  return {
    requestId: 'req_1',
    version: 1,
    state: 'PENDING_REVIEW',
    companyName: 'ร้านทดสอบ',
    ownerDisplayName: 'สมชาย',
    source: 'line-oa',
    createdAt: '2026-09-05T03:00:00.000Z',
    emailMatchesExistingUser: false,
    emailDeliveryFailed: false,
    ...overrides,
  };
}

/** The real row component the queue table renders, with inert handlers. */
function render(overrides: Partial<AdminSignupQueueItemDto>): string {
  return renderToStaticMarkup(
    React.createElement(SignupRowActions, {
      item: item(overrides),
      busy: false,
      onApprove: () => {},
      onReject: () => {},
      onReissue: () => {},
      onRetryIntake: () => {},
      onSuspend: () => {},
    }),
  );
}

/**
 * B-2. The gating rule these rows carry is exactly the kind a source assertion can agree with while
 * the markup does something else, so it is RENDERED here — the same component the problem tab puts
 * in every row.
 */
describe('SignupRowActions — the problem tab, rendered', () => {
  const abandonedEmpty = { state: 'PROVISIONING', staleProvisioning: true } as const;

  it('offers ระงับ for an abandoned attempt that never built a shop', () => {
    const markup = render(abandonedEmpty);
    assert.match(markup, /ระงับ/);
    // The close-out is still the primary action on that row.
    assert.match(markup, /ปิดงาน/);
  });

  it('offers no ระงับ while the run is still live', () => {
    assert.doesNotMatch(render({ state: 'PROVISIONING' }), /ระงับ/);
    assert.doesNotMatch(render({ state: 'PROVISIONING', companyId: 'co-1' }), /ระงับ/);
  });

  // Abandoned, but the shop it built is standing: suspending would strand an ACTIVE company with
  // its application shut behind it, and free the LINE account to apply again.
  it('offers no ระงับ once an abandoned attempt has a shop behind it', () => {
    assert.doesNotMatch(render({ ...abandonedEmpty, companyId: 'co-1' }), /ระงับ/);
  });

  it('never offers ระงับ on a READY row', () => {
    const markup = render({ state: 'READY', companyId: 'co-1' });
    assert.doesNotMatch(markup, /ระงับ/);
    assert.match(markup, /ปิดงาน/, 'the close-out is what that row wants');
  });

  it('still offers ระงับ on the settled rows §3.7 is about', () => {
    assert.match(render({ state: 'COMPLETED', autoApproved: true }), /ระงับ/);
    assert.match(render({ state: 'PROVISIONING_FAILED' }), /ระงับ/);
  });

  it('offers the intake retry on saved pre-review states', () => {
    assert.match(render({ state: 'RECEIVED' }), /ทำขั้นตอนรับคำขอต่อ/);
    assert.match(render({ state: 'VALIDATED' }), /ทำขั้นตอนรับคำขอต่อ/);
    assert.doesNotMatch(render({ state: 'PENDING_REVIEW' }), /ทำขั้นตอนรับคำขอต่อ/);
  });

  it('offers nothing at all on a web-form row it cannot act on', () => {
    const markup = render({ state: 'COMPLETED', source: 'official-site' });
    assert.doesNotMatch(markup, /ระงับ/);
    assert.match(markup, /—/, 'an empty action cell says so rather than looking broken');
  });
});
