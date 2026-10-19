import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

const page = readFileSync(new URL('./DisbursementVoucherListPage.tsx', import.meta.url), 'utf8');
const card = page.slice(page.indexOf('export function DisbursementVoucherCard('), page.indexOf('export function DisbursementVoucherListPage('));
const styles = readFileSync(new URL('./disbursement-vouchers.module.css', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../../../app/(workspace)/companies/[companyId]/expenses/disbursement-vouchers/page.tsx', import.meta.url), 'utf8');

test('create needs open entry while closed entry still reads old vouchers before choosing an empty state', () => {
  assert.match(page, /const canPrepare = entryOpen && canPrepareDisbursementVoucher\(permissions\)/);
  // Creation stays in the header even for an empty list or search.
  assert.match(page, /actions=\{canPrepare \? create : undefined\}/);
  assert.match(page, /if \(!canRead\) return;[\s\S]*?listDisbursementVouchers\(/);
  assert.match(page, /if \(!entryOpen && !loading && !error && result && \(unfilteredCount \?\? allCount\) === 0\) return \([\s\S]*?<EmptyState title=\{t\('expenses\.disbursement\.hidden'/);
  assert.match(route, /entryOpen=\{canOpenDisbursementVoucherWeb\(session, companyId\)\}/);
  assert.doesNotMatch(route, /redirect\(|getDisbursementVoucher|listDisbursementVouchers/);
});

test('three empty cases and the hidden-menu card keep the fixed sentences in the title', () => {
  for (const [key, copy] of [
    ['empty_prepare', 'ยังไม่มีใบเตรียมจ่าย'], ['empty_start', 'เริ่มจากเลือกผู้รับเงิน แล้วเลือกรายจ่ายที่จะจ่าย'],
    ['empty_read', 'ยังไม่มีใบที่คุณดูได้'], ['empty_filter', 'ไม่มีใบในสถานะนี้'],
    ['hidden', 'หน้านี้ยังไม่ได้เปิดใช้สำหรับร้านของคุณ'], ['hidden_help', 'ติดต่อทีมมั่งมีพลัสหากต้องการใช้'],
  ] as const) assert.equal(workspaceDictionary.th[`expenses.disbursement.${key}`], copy);
  assert.match(page, /<EmptyState title=\{allCount > 0 \|\| filter !== 'all'[\s\S]*?empty_filter[\s\S]*?canPrepare \?[\s\S]*?empty_prepare[\s\S]*?empty_read/);
  assert.doesNotMatch(page, /action=\{.*create/);
});

test('every mobile card has one document link and a separate server-authorized delete action', () => {
  assert.equal([...card.matchAll(/<Link\s/g)].length, 1);
  assert.match(card, /<MangmeeCard[\s\S]*?<Link href=\{disbursementVoucherDocumentHref\(companyId, row\)\}/);
  assert.match(card, /<\/Link>[\s\S]*?row.canDelete &&[\s\S]*?onClick=\{onDelete\}/);
  assert.doesNotMatch(card, /cancelDisbursement|submitDisbursement|btnClass/);
  assert.match(card, /DisbursementVoucherStatusBadge status=\{row\.status\}/);
  assert.match(card, /DISBURSEMENT_VOUCHER_WORDS\.directPayment/);
  assert.match(page, /data-testid="disbursement-voucher-card-list"/);
  assert.match(styles, /\.badge[^}]*white-space: nowrap/);
  assert.match(styles, /\.action[^}]*width: 100%;[^}]*min-height: 44px/);
  assert.match(styles, /\.cardLink \{ display: block;/);
});

test('six counted filters are touch-sized, live in the URL and page with the shared pager', () => {
  assert.match(page, /DISBURSEMENT_VOUCHER_FILTERS\.map/);
  assert.match(page, /grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6/);
  assert.match(page, /className="mangmee-home-tab min-w-0 gap-2"/);
  assert.match(page, /aria-pressed=\{filter === value\}/);
  assert.match(page, /counts\[value\]/);
  assert.doesNotMatch(styles, /\.filters/);
  assert.match(styles, /@media \(min-width: 1280px\)/);
  assert.match(page, /params\.set\('status', nextFilter\)/);
  assert.match(page, /router\.push\(/);
  assert.match(page, /<Pagination[\s\S]*?navigate\(filter, next\)/);
});

test('search is debounced into q, resets paging, and offers another matching status tab', () => {
  assert.match(page, /placeholder="ค้นชื่อผู้รับเงินหรือเลขที่ใบ"/);
  assert.match(page, /setTimeout\(\(\) => \{[\s\S]*?params\.set\('q', value\)[\s\S]*?params\.delete\('page'\)[\s\S]*?router\.replace/);
  assert.match(page, /listDisbursementVouchers\(companyId, \{ status: filter === 'all' \? undefined : filter, q: q \|\| undefined/);
  assert.match(page, /result && result\.data\.length === 0 && q/);
  assert.match(page, /ไม่พบในแท็บนี้ · พบ \{counts\?\.\[otherFilter\]\} ใบใน/);
  assert.match(page, /onClick=\{\(\) => navigate\(otherFilter\)\}/);
  assert.match(page, /ไม่พบใบตามคำค้นนี้/);
  // An empty search has a way out.
  assert.match(page, /onClick=\{\(\) => setSearchText\(''\)\}>\{t\('expenses.disbursement.search_clear', 'th'\)\}/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.search_clear'], 'ล้างคำค้น');
  assert.equal(workspaceDictionary.th['expenses.disbursement.search_view'], 'ดู');
});

test('list reads have loading, retry and forbidden states without diagnostic identifiers', () => {
  for (const component of ['LoadingState', 'ErrorState', 'ForbiddenState']) assert.match(page, new RegExp(`<${component}`));
  assert.match(page, /onRetry=\{\(\) => setRetry/);
  assert.doesNotMatch(page + styles, /requestId=|h[-]screen|100v[h]/);
});


test('card and table show the in-effect amount including zero, with the same cancellation note as the document page', () => {
  assert.equal((page.match(/amountText\(row.amountInEffect \?\? row.totalAmount\)/g) || []).length, 2);
  assert.equal((page.match(/row.amountInEffect != null/g) || []).length, 2);
  assert.equal((page.match(/expenses.disbursement.cancelled_amount_note/g) || []).length, 2);
});
