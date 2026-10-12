import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(steps.steps.map(step => step.title), ['ทำคนเดียว: สร้างใบเตรียมจ่าย', 'ส่งและอนุมัติ', 'บันทึกว่าจ่ายแล้ว']);
  const table = section.blocks.find(block => block.kind === 'table');
  assert.ok(table?.kind === 'table');
  assert.equal(table.rows.length, 5);
  const text = JSON.stringify(section);
  for (const phrase of ['ทำสองคน', 'รอจ่ายหมายถึงอะไร', 'ออกใบสำคัญจ่าย', 'การกดซ้ำได้ใบเดิม', 'ออกใบใหม่', 'ขอบเขตของสิทธิ์']) assert.ok(text.includes(phrase), phrase);
});
