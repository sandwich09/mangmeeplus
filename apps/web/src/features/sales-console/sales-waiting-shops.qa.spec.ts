/**
 * What the sales report and the Owner's queue say for a company with one counted, one waiting and
 * one cut-out shop (sales spec §17.1.1, owner 2026-10-02: a shop waiting for review is no opened
 * shop until it is reviewed). Both pages are rendered as they are, with the state they load swapped
 * in, so the words asserted here are the words on the screen.
 */
import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { SalesAttributionFlagRow, SalesReportMonth, SalesReportRow } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
// This runner has no SVG loader, and a server render has no document.body for Modal to portal into.
require.extensions['.svg'] = (module) => { module.exports = () => null; };
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const SalesReportsPage = (require('./SalesReportsPage') as typeof import('./SalesReportsPage')).default;
const SalesTeamPage = (require('./SalesTeamPage') as typeof import('./SalesTeamPage')).default;
const reactRuntime = require('react') as typeof React;

/** What a person reads: the text nodes, in page order. */
const visible = (html: string) => html.replace(/<[^>]*>/gu, '\n').split('\n')
  .map((text) => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&amp;/gu, '&').trim()).filter(Boolean);

/**
 * Renders a page with what it loads swapped in. A page keeps what it loads in states that start as
 * `null`, and its own states come first in a render, so `loaded` is keyed by their order in the page.
 */
function renderLoaded(element: React.ReactElement, loaded: Record<number, unknown>): string[] {
  const realUseState = reactRuntime.useState;
  let nulls = 0;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    if (initial !== null) return [value, set];
    nulls += 1;
    return [nulls in loaded ? loaded[nulls] : value, set];
  });
  Object.assign(globalThis, { document: { body: {} } });
  try {
    return visible(renderToStaticMarkup(React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, element)));
  } finally {
    Reflect.set(reactRuntime, 'useState', realUseState);
    Reflect.deleteProperty(globalThis, 'document');
  }
}

// Three shops of เซลล์ สมชาย paid in September: a deal that counts (200 baht), a referral waiting for
// review (499 baht) and a referral the Owner cut out (399 baht). The API answers with the counted
// shop in the figures, the waiting shop as a count and a named line, and the cut-out shop nowhere.
const agentRow = (over: Partial<SalesReportRow> = {}): SalesReportRow => ({
  salesUserId: 'u1', displayName: 'สมชาย', teamLeadUserId: 'l1', teamLeadDisplayName: 'หัวหน้าเอ',
  dealActivations: 1, referralActivations: 0, amountSatang: 20_000, flaggedCount: 1, ...over,
});
const september = (rows: SalesReportRow[]): SalesReportMonth => ({
  monthKey: '2026-09', rows, deductions: [],
  waiting: [{ salesUserId: 'u1', source: 'REFERRAL', companyName: 'ร้านรอตรวจ', flags: ['repeat_owner'] }],
});
const queueRow = (over: Partial<SalesAttributionFlagRow>): SalesAttributionFlagRow => ({
  companyId: 'c-waiting', companyName: 'ร้านรอตรวจ', salesUserId: 'u1', salesDisplayName: 'สมชาย', source: 'REFERRAL',
  amountSatang: 49_900, refundedSatang: 0, paidAt: '2026-09-20T03:00:00.000Z', flags: ['repeat_owner'],
  flaggedAt: '2026-09-20T03:00:00.000Z', reviewedAt: null, reviewNote: null, ...over,
});
const QUEUE = [queueRow({}), queueRow({ companyId: 'c-cut', companyName: 'ร้านตัดออก', amountSatang: 39_900, flags: ['self_referral'],
  reviewedAt: '2026-09-25T03:00:00.000Z', reviewNote: 'เจ้าของร้านเป็นเซลล์เอง' })];

/** The lines from `from` up to, not including, `until`. */
const between = (lines: string[], from: string, until?: string) =>
  lines.slice(lines.indexOf(from), until ? lines.indexOf(until) : undefined);

describe('one counted, one waiting and one cut-out shop on the screens (owner 2026-10-02)', () => {
  it('the report counts one opened shop and names the waiting shop with its reason', () => {
    // 1 = the months the page loaded. One เซลล์ in the answer, so it reads as their own numbers.
    const lines = renderLoaded(React.createElement(SalesReportsPage), { 1: [september([agentRow()])] });
    assert.deepEqual(between(lines, 'ยอดเปิดบริษัทรวม'), [
      'ยอดเปิดบริษัทรวม', '฿200.00', 'ร้านที่เปิดจากดีลพิเศษ', '1 ร้าน', 'ร้านที่เปิดจากการแนะนำ', '0 ร้าน',
      'ก.ย. 2569', '฿200.00',
      // The phone card of the เซลล์.
      'สมชาย', '฿200.00', 'ดีลพิเศษ 1 ร้าน · แนะนำร้าน 0 ร้าน', 'รอตรวจ 1 ร้าน · ยังไม่นับในยอด',
      // The same figures as a table on a wide screen.
      'เซลล์', 'ดีลพิเศษ', 'แนะนำร้าน', 'รอตรวจ', 'ยอดเปิดบริษัท', 'สมชาย', '1', '0', '1', '฿200.00',
      'รวมทั้งเดือน', '1', '0', '1', '฿200.00',
      'ร้านที่รอตรวจ · ยังไม่นับในยอด', 'ร้านรอตรวจ', 'แนะนำร้าน · เจ้าของเดิมเปิดร้านเพิ่ม',
      'มี 1 ร้านรอตรวจ ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอด เมื่อผู้ดูแลระบบยืนยันว่าไม่ผิดปกติ จะนับในเดือนที่ร้านชำระเงิน',
    ]);
    assert.ok(lines.includes('ยอดของฉัน'), 'one เซลล์ in the answer reads as their own numbers');
    // The cut-out shop and its 399 baht are nowhere, and nothing is said in code words.
    assert.doesNotMatch(lines.join('\n'), /ร้านตัดออก|399|ถูกธง|ตั้งธง|[A-Za-z_]{3,}/);
  });

  it('a lead reading two เซลล์ sees whose shop is waiting', () => {
    const lines = renderLoaded(React.createElement(SalesReportsPage), { 1: [september([
      agentRow(), agentRow({ salesUserId: 'u2', displayName: 'สมหญิง', amountSatang: 49_900, flaggedCount: 0 })])] });
    assert.ok(lines.includes('รายงานยอดขาย'));
    assert.deepEqual(between(lines, 'ร้านที่รอตรวจ · ยังไม่นับในยอด', 'มี 1 ร้านรอตรวจ ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอด เมื่อผู้ดูแลระบบยืนยันว่าไม่ผิดปกติ จะนับในเดือนที่ร้านชำระเงิน'),
      ['ร้านที่รอตรวจ · ยังไม่นับในยอด', 'ร้านรอตรวจ', 'สมชาย · แนะนำร้าน · เจ้าของเดิมเปิดร้านเพิ่ม']);
  });

  it('the Owner\'s queue shows the waiting shop and the cut-out shop in the same words, and says what confirming does', () => {
    // 1 = the team list, 7 = the queue, 8 = the decision being confirmed (the waiting shop, "ยืนยันว่าไม่ผิดปกติ").
    const lines = renderLoaded(React.createElement(SalesTeamPage, { scope: 'admin' }), { 1: [], 7: QUEUE, 8: { row: QUEUE[0], keep: false } });
    assert.deepEqual(between(lines, 'รายการที่ถูกธง', 'ยืนยันว่าร้านนี้ไม่ผิดปกติ'), [
      'รายการที่ถูกธง',
      'ร้านที่ระบบสงสัยว่าผิดปกติ ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอดของเซลล์จนกว่าคุณจะตรวจ ร้านที่คุณตัดออกจะไม่นับให้เซลล์ และยังอยู่ในรายการนี้ให้ตรวจย้อนหลัง',
      'ร้านรอตรวจ', 'รอตรวจ · ยังไม่นับในยอด', 'แนะนำร้าน · สมชาย · ฿499.00 · ชำระ 20 ก.ย. 2569', 'เจ้าของเดิมเปิดร้านเพิ่ม',
      'ยืนยันว่าไม่ผิดปกติ', 'ตัดออกจากยอด',
      'ร้านตัดออก', 'ตัดออกจากยอดแล้ว · ไม่นับให้เซลล์', 'แนะนำร้าน · สมชาย · ฿399.00 · ชำระ 20 ก.ย. 2569', 'ผู้แนะนำและเจ้าของร้านเป็นคนเดียวกัน',
      'ตรวจเมื่อ 25 ก.ย. 2569 · เหตุผล: เจ้าของร้านเป็นเซลล์เอง', 'ยืนยันว่าไม่ผิดปกติ',
    ]);
    // Before the Owner confirms, the dialog names the month that will gain the shop.
    assert.deepEqual(between(lines, 'ยืนยันว่าร้านนี้ไม่ผิดปกติ').filter((line) => line !== '✕').slice(0, 3), [
      'ยืนยันว่าร้านนี้ไม่ผิดปกติ',
      'ร้านนี้จะนับเป็นร้านที่เปิด และยอดจะนับให้เซลล์ในเดือนที่ร้านชำระเงิน คือ ก.ย. 2569 ระบบบันทึกเหตุผลของคุณไว้',
      'ร้านรอตรวจ · สมชาย',
    ]);
  });
});
