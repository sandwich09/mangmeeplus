import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupportRequestItemDto } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { SupportRowActions } = require('./SupportRequestsPage') as typeof import('./SupportRequestsPage');

function item(overrides: Partial<SupportRequestItemDto> = {}): SupportRequestItemDto {
  return {
    id: 'sr-1',
    status: 'OPEN',
    askerLabel: 'ร้านนิด',
    askerRef: 'edface',
    companyId: 'co-1',
    requestedAt: '2026-09-05T03:00:00.000Z',
    lineNotifiedCount: 0,
    emailSent: true,
    notifyState: 'notified',
    ...overrides,
  };
}

/** The real row component the inbox table renders, with inert handlers. */
function render(overrides: Partial<SupportRequestItemDto>, busy = false): string {
  return renderToStaticMarkup(
    React.createElement(SupportRowActions, {
      item: item(overrides),
      busy,
      onAnswered: () => {},
      onResume: () => {},
    }),
  );
}

/**
 * The gating here is exactly the kind a source assertion can agree with while the markup does
 * something else — `canMarkAnswered`/`canResumeAi` are unit-tested next door, but nothing proved
 * the row actually asks them. So the row is RENDERED, the same component every table row uses.
 */
describe('SupportRowActions — the inbox row, rendered', () => {
  it('offers both buttons and a route to the message box while a request is open', () => {
    const markup = render({ status: 'OPEN' });
    assert.match(markup, /ตอบแล้ว/);
    assert.match(markup, /ให้ AI ทำงานต่อ/);
    assert.match(markup, /href="\/system\/partners\/co-1"/);
    assert.match(markup, /เปิดหน้าร้าน/);
  });

  it('drops "ตอบแล้ว" once answered, but keeps the assistant resume', () => {
    const markup = render({ status: 'ANSWERED' });
    assert.doesNotMatch(markup, /ตอบแล้ว</, 'nothing left to mark');
    // Answering the shop does NOT lift the 24h pause, so this is still the only way back.
    assert.match(markup, /ให้ AI ทำงานต่อ/);
  });

  it('offers no action at all on a closed request', () => {
    const markup = render({ status: 'CLOSED', companyId: undefined });
    assert.doesNotMatch(markup, /ตอบแล้ว</);
    assert.doesNotMatch(markup, /ให้ AI ทำงานต่อ/);
    assert.match(markup, /—/, 'an empty cell says so rather than rendering nothing');
  });

  it('sends someone still in the funnel to the signup queue instead of a partner page', () => {
    const markup = render({ companyId: undefined, signupRequestId: 'sr-signup-1' });
    assert.match(markup, /href="\/system\/signup-requests"/);
    assert.match(markup, /เปิดคิวสมัคร/);
    assert.doesNotMatch(markup, /\/system\/partners\//);
  });

  it('disables both buttons while the row is busy, so one click is one action', () => {
    const markup = render({ status: 'OPEN' }, true);
    assert.match(markup, /กำลังทำรายการ/);
    assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
  });
});
