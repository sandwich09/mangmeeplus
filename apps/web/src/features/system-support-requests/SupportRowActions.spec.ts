import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupportRequestItemDto } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { SupportRowActions, SupportInboxBody } =
  require('./SupportRequestsPage') as typeof import('./SupportRequestsPage');

function item(overrides: Partial<SupportRequestItemDto> = {}): SupportRequestItemDto {
  return {
    id: 'sr-1',
    status: 'OPEN',
    askerLabel: 'ร้านนิด',
    askerRef: 'edface',
    companyId: 'co-1',
    requestedAt: '2026-09-05T03:00:00.000Z',
    // Equal to `requestedAt` until the customer writes again, which is what the API sends.
    lastMessageAt: '2026-09-05T03:00:00.000Z',
    reopenedCount: 0,
    lineNotifiedCount: 0,
    emailSent: true,
    notifyState: 'notified',
    assignedToMe: false,
    ...overrides,
  };
}

/** The real row component the inbox table renders, with inert handlers. */
function render(overrides: Partial<SupportRequestItemDto>, busy = false): string {
  return renderToStaticMarkup(
    React.createElement(SupportRowActions, {
      item: item(overrides),
      busy,
      onClaim: () => {},
      onRelease: () => {},
      onTakeover: () => {},
      onReply: () => {},
      onResolve: () => {},
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
  it('offers claim and a route to the message box while an unassigned request is open', () => {
    const markup = render({ status: 'OPEN' });
    assert.match(markup, /รับเคส/);
    // The link names the request, so the message box on the other end can answer the PERSON who
    // raised it rather than only the shop's owners (review 2026-09-06).
    assert.match(markup, /href="\/system\/partners\/co-1\?support=sr-1&amp;asker=edface"/);
    assert.match(markup, /เปิดหน้าร้าน/);
  });

  it('offers reply, resume, explicit resolution and release to the owner on a live case', () => {
    const markup = render({ status: 'ANSWERED', assignedToMe: true, assigneeDisplayName: 'พี่แอดมิน' });
    assert.match(markup, /ตอบใน LINE/);
    assert.match(markup, /ให้ AI ทำงานต่อ/);
    assert.match(markup, /แก้ไขสำเร็จและปิดเคส/);
    assert.match(markup, /ปล่อยเคส/);
  });

  it('offers an explicit takeover rather than leaving another operator\'s case stuck', () => {
    const markup = render({ assigneeDisplayName: 'ทีมเดิม', assignedAt: '2026-09-05T03:00:00.000Z' });
    assert.match(markup, /รับช่วงต่อ/);
    assert.doesNotMatch(markup, /ตอบใน LINE/);
  });

  it('offers takeover when a deleted assignee has no display-name row left', () => {
    const markup = render({ assigneeDisplayName: undefined, assignedAt: '2026-09-05T03:00:00.000Z' });
    assert.match(markup, /รับช่วงต่อ/);
    assert.doesNotMatch(markup, /รับเคส/);
  });

  it('offers no action at all on a closed request', () => {
    const markup = render({ status: 'CLOSED', companyId: undefined });
    assert.doesNotMatch(markup, /รับเคส/);
    assert.doesNotMatch(markup, /ให้ AI ทำงานต่อ/);
    assert.match(markup, /—/, 'an empty cell says so rather than rendering nothing');
  });

  it('sends someone still in the funnel to the signup queue instead of a partner page', () => {
    const markup = render({ companyId: undefined, signupRequestId: 'sr-signup-1' });
    assert.match(markup, /href="\/system\/signup-requests"/);
    assert.match(markup, /เปิดคิวสมัคร/);
    assert.doesNotMatch(markup, /\/system\/partners\//);
  });

  it('disables the owner controls while the row is busy, so one click is one action', () => {
    const markup = render({ status: 'OPEN', assignedToMe: true, assigneeDisplayName: 'พี่แอดมิน' }, true);
    assert.match(markup, /กำลังทำรายการ/);
    assert.ok((markup.match(/disabled=""/g) ?? []).length >= 4);
  });
});

/** The body decides between the error banner and the table, so both are rendered here. */
function renderBody(props: Partial<Parameters<typeof SupportInboxBody>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(SupportInboxBody, {
      error: null,
      loading: false,
      loadingMore: false,
      items: [],
      busyId: null,
      totalCount: 0,
      nextCursor: null,
      onRetry: () => {},
      onLoadMore: () => {},
      onClaim: () => {},
      onRelease: () => {},
      onTakeover: () => {},
      onReply: () => {},
      onResolve: () => {},
      onResume: () => {},
      ...props,
    }),
  );
}

describe('SupportInboxBody — error, empty and the message cell, rendered', () => {
  // The table used to render UNDER the banner, so a first-load 403 told an operator the queue was
  // empty — the one thing a permission error does not know.
  it('replaces the table with the error, rather than sitting above an empty one', () => {
    const markup = renderBody({ error: 'คุณไม่มีสิทธิ์ดูคำขอคุยกับเจ้าหน้าที่' });
    assert.match(markup, /คุณไม่มีสิทธิ์ดูคำขอคุยกับเจ้าหน้าที่/);
    assert.match(markup, /ลองใหม่/);
    assert.doesNotMatch(markup, /ไม่มีคำขอในกลุ่มนี้/, 'no "the queue is empty" under a 403');
    assert.doesNotMatch(markup, /<table/);
  });

  it('says an empty queue is empty when that is actually known', () => {
    const markup = renderBody({ items: [] });
    assert.match(markup, /ไม่มีคำขอในกลุ่มนี้/);
    assert.match(markup, /<table/);
  });

  it('shows skeletons rather than an empty verdict while loading', () => {
    const markup = renderBody({ loading: true });
    assert.doesNotMatch(markup, /ไม่มีคำขอในกลุ่มนี้/);
    assert.match(markup, /animate-pulse/);
  });

  /**
   * The clamp regression, rendered. `block` cancels `line-clamp-2` — Tailwind emits
   * `.block{display:block}` after it, overriding the `-webkit-box` the clamp needs — and the cell
   * grew to 352px at 390px wide, pushing the action column off the screen.
   */
  it('clamps a long message to two lines without a display that cancels the clamp', () => {
    const long = 'ก'.repeat(200);
    const markup = renderBody({ items: [item({ lastMessageText: long })] });
    const cell = /<p class="([^"]*)" title="ก+">/.exec(markup);

    assert.ok(cell, 'the message renders in a class-bearing span');
    const classes = cell![1]!.split(' ');
    assert.ok(classes.includes('md:line-clamp-2'), 'desktop keeps the two-line table clamp');
    assert.ok(classes.includes('break-words'));
    assert.equal(classes.includes('line-clamp-2'), false, 'mobile shows the full question without hover');
    assert.equal(classes.includes('block'), false, '`block` overrides the clamp and un-clamps it');
    assert.equal(classes.some((name) => /^(flex|grid|inline-block|table)$/.test(name)), false,
      'and so would any other display utility');
    assert.match(markup, /max-w-\[16rem\]/, 'the cell is bounded, so the clamp has a width to work in');
  });

  it('stacks a readable card on mobile and keeps its case actions at least 44px tall', () => {
    const markup = renderBody({ items: [item({ assignedToMe: true, assignedAt: '2026-09-05T03:00:00.000Z' })] });
    assert.match(markup, /block w-full text-left text-sm md:table/);
    assert.match(markup, /block p-4 align-top[^\"]*md:table-row/);
    assert.match(markup, /ข้อความลูกค้า/);
    assert.match(markup, /จัดการเคส/);
    assert.match(markup, /min-h-11/);
  });

  /**
   * UAT 2026-09-06: a reopened request is OPEN like any other, so on the รอตอบ tab it was
   * indistinguishable from a first ask — an operator would answer it as though the conversation
   * had not already happened twice.
   */
  it('marks a request the customer wrote back to, and still offers "ตอบแล้ว" on it', () => {
    const markup = renderBody({
      items: [item({
        status: 'OPEN',
        answeredAt: '2026-09-05T03:30:00.000Z',
        answeredByDisplayName: 'พี่แอดมิน',
        reopenedCount: 1,
        lastMessageAt: '2026-09-05T04:00:00.000Z',
        lastMessageText: 'ยังไม่ได้เลยค่ะ',
      })],
    });

    assert.match(markup, /ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ/);
    assert.match(markup, /ยังไม่ได้เลยค่ะ/, 'and the message they wrote back is the one shown');
    assert.match(markup, /รอมานาน/, 'the clock is running again, not "ใช้เวลา"');
    assert.match(markup, /ตอบโดย พี่แอดมิน/, 'the previous answer stays as history');
  });

  it('carries no reopen chip on a request nobody has answered yet', () => {
    assert.doesNotMatch(renderBody({ items: [item({ status: 'OPEN' })] }), /ลูกค้าตอบกลับ/);
  });

  /**
   * Review 2026-09-06 (F3). One column carried both the question and the newest message, so a nudge
   * or an unrelated receipt photo left the operator reading "มีอัปเดตไหมคะ" with no idea what was
   * being asked. Both, plainly labelled, and a photo as a marker beside them rather than instead.
   */
  it('shows the question the operator is answering as well as the newest message', () => {
    const markup = renderBody({
      items: [item({
        requestText: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ',
        lastMessageText: 'มีอัปเดตไหมคะ',
        lastMediaAt: '2026-09-06T05:00:00.000Z',
      })],
    });

    assert.match(markup, /ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ/, 'the question survives every follow-up');
    assert.match(markup, /ล่าสุด/);
    assert.match(markup, /มีอัปเดตไหมคะ/);
    assert.match(markup, /<\/p><p class="mt-1/, 'the latest message starts on its own readable line');
    assert.match(markup, /📷 ส่งรูปมา/, 'and a picture arrived, which is all §3 keeps of it');
  });

  it('does not print the same sentence twice on a request nobody has followed up', () => {
    const markup = renderBody({
      items: [item({ requestText: 'ช่วยด้วยค่ะ', lastMessageText: 'ช่วยด้วยค่ะ' })],
    });
    assert.equal((markup.match(/ช่วยด้วยค่ะ/g) ?? []).length, 2, 'once in the cell, once in its title');
    assert.doesNotMatch(markup, /ล่าสุด/);
    assert.doesNotMatch(markup, /ส่งรูปมา/, 'and no photo marker on a thread that has none');
  });

  it('still shows a follow-up from a request whose question was never captured', () => {
    const markup = renderBody({ items: [item({ lastMessageText: 'ยังไม่ได้เลยค่ะ' })] });
    assert.match(markup, /ยังไม่ได้เลยค่ะ/);
    assert.doesNotMatch(markup, /ล่าสุด/, 'there is nothing for it to be later than');
  });

  it('says "—" for a request that carries no words at all', () => {
    const markup = renderBody({ items: [item()] });
    assert.match(markup, /—/);
  });

  it('bounds the asker column too, since an applicant label carries a shop name of any length', () => {
    const markup = renderBody({ items: [item({ askerLabel: 'ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: ' + 'ร'.repeat(80) + ')' })] });
    assert.match(markup, /max-w-\[14rem\]/);
    assert.match(markup, /break-words font-medium/);
  });
});
