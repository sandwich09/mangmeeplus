import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WebSession } from '@/common/models/web-session.model';
import { buildExpensesGuide } from './expenses-guide.content';
import { withDisbursementVoucherGuide } from './disbursement-voucher-guide.content';
const session = { companyId: 'shop', permissions: ['expense.disbursement.read'], disbursementVoucherWebEntry: true } as WebSession;
test('the own-file guide section uses the session predicate and preserves the pinned source guide', () => {
  const guide = buildExpensesGuide('shop');
  const before = JSON.stringify(guide);
  for (const reader of [null, { ...session, disbursementVoucherWebEntry: false }, { ...session, disbursementVoucherWebEntry: undefined }, { ...session, permissions: [] }, { ...session, companyId: 'other' }]) {
    assert.equal(withDisbursementVoucherGuide(guide, 'shop', reader), guide);
  }
  const enabled = withDisbursementVoucherGuide(guide, 'shop', session);
  assert.deepEqual(enabled.sections.slice(0, -1), guide.sections);
  assert.equal(JSON.stringify(guide), before);
  assert.equal(enabled.sections.at(-1)?.id, 'disbursement-vouchers');
  const route = readFileSync('app/(workspace)/companies/[companyId]/user-guide/expenses/page.tsx', 'utf8');
  assert.match(route, /withDisbursementVoucherGuide\(manualExpenseWebEntryShown/);
});
test('the guide explains both journeys, direct payments, waiting to pay, cancellation and all five rights', () => {
  const section = withDisbursementVoucherGuide(buildExpensesGuide('shop'), 'shop', session).sections.at(-1)!;
  const steps = section.blocks.find(block => block.kind === 'steps');
  assert.ok(steps?.kind === 'steps');
  assert.deepEqual(steps.steps.map(step => step.title), ['ทำคนเดียว: สร้างใบเตรียมจ่าย', 'อนุมัติเอง', 'บันทึกว่าจ่ายแล้ว']);
  const table = section.blocks.find(block => block.kind === 'table');
  assert.ok(table?.kind === 'table');
  assert.equal(table.rows.length, 5);
  const text = JSON.stringify(section);
  assert.equal(section.summary, 'รวมรายการให้ตรวจและอนุมัติก่อนจ่าย');
  assert.equal((text.match(/หลักฐานว่าบันทึกจ่ายแล้ว/g) ?? []).length, 1);
  for (const phrase of ['ทำสองคน', 'รอจ่ายหมายถึงอะไร', 'ออกใบสำคัญจ่าย', 'การกดซ้ำได้ใบเดิม', 'ออกใบใหม่', 'ขอบเขตของสิทธิ์']) assert.ok(text.includes(phrase), phrase);
});

test('G2: guide names draft saving, numbered return dialogs and the payment review', () => {
  const section = withDisbursementVoucherGuide(buildExpensesGuide('shop'), 'shop', session).sections.at(-1)!;
  const text = JSON.stringify(section);
  for (const phrase of ['บันทึกร่าง', 'ส่งกลับให้แก้ใบเตรียมจ่าย', 'กลับไปแก้ใบเตรียมจ่าย', 'หลักฐานการจ่าย', 'เลขที่เดิม']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /ฉบับร่าง|ดำเนินการ|ชำระ|ลงนาม|กรุณา/u);
});

test('G2: every quoted payment-document label is on a current screen', () => {
  const feature = join(__dirname, '../expenses/disbursement-vouchers');
  const source = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const shown = [...readdirSync(feature).filter(name => /\.tsx?$/.test(name) && !name.includes('.spec.')).map(name => source(join(feature, name))),
    source(join(__dirname, '../../common/i18n/workspace-dictionary.ts')),
    source(join(__dirname, '../dashboard-notifications/NotificationBell.tsx'))].join('\n');
  const section = withDisbursementVoucherGuide(buildExpensesGuide('shop'), 'shop', session).sections.at(-1)!;
  const quotes = [...new Set([...JSON.stringify(section).matchAll(/“([^”]+)”/g)].map(match => match[1]!))];
  assert.ok(quotes.length >= 10);
  assert.deepEqual(quotes.filter(quote => !shown.includes(quote)), []);
});

test('the guide distinguishes each reader and covers draft deletion, entry, defaults and the waiting bell', () => {
  const section = withDisbursementVoucherGuide(buildExpensesGuide('shop'), 'shop', session).sections.at(-1)!;
  const text = JSON.stringify(section);
  for (const phrase of ['หัวใบเป็นชนิดและเลขที่', 'ใต้หัวเป็นผู้รับเงิน', 'ร่างและใบที่ถูกส่งกลับให้แก้ → รออนุมัติ → รอจ่าย',
    'วันที่จ่ายล่าสุดก่อน', 'เริ่มจากรายจ่ายเดียวจะเข้าขั้นรายละเอียดเลย', 'ผู้อนุมัติที่ไม่ได้จัดทำ', '“กลับไปแก้” ไม่ต้องให้เหตุผล',
    'ถ้าทั้งสองปิดใช้งาน เจ้าของกิจการทำแทนได้', '“ลบร่าง” ไม่ต้องให้เหตุผล', 'วิธีจ่ายเริ่มที่ “โอนเงิน”', 'หนึ่งใบที่รอมีหนึ่งแจ้งเตือน', 'ยังรออยู่']) assert.ok(text.includes(phrase), phrase);
  const visible = [section.title, section.summary ?? '', ...section.blocks.flatMap(block => block.kind === 'items'
    ? block.items.flatMap(item => [item.title, item.detail, item.link?.label ?? '']) : block.kind === 'steps'
      ? block.steps.flatMap(step => [step.title, step.detail]) : block.kind === 'table' ? [...block.headers, ...block.rows.flat()]
        : block.kind === 'note' ? [block.title, block.detail] : block.items.flatMap(item => [item.question, item.answer]))].join('');
  assert.ok(visible.length <= 1930, `guide grew from ${1930} to ${visible.length}`);
});
