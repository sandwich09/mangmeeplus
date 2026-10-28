import assert from 'node:assert/strict';
import test from 'node:test';
import { FREE_EXPENSE_CHAT_REPLY, freeExpenseMenuReply } from './free-expense-line.logic';

test('free refusal names the missing chat entitlement, never says credit depleted or shop unopened', () => {
  assert.match(FREE_EXPENSE_CHAT_REPLY, /ยังไม่รวมการถามตอบ/);
  assert.doesNotMatch(FREE_EXPENSE_CHAT_REPLY, /เครดิต|ครบ|เปิดร้าน|ซื้อ|เก็บแล้ว/);
});
test('deterministic free menu only offers actual read, upload and edit capabilities', () => {
  const none = freeExpenseMenuReply('https://app.test/', 'shop', []);
  assert.doesNotMatch(none, /เปิดดูรายการ|ส่งบิล|แก้ไขข้อมูล/);
  const own = freeExpenseMenuReply('https://app.test/', 'shop', ['expense.read_own', 'expense.receipt.upload', 'expense.update']);
  assert.match(own, /https:\/\/app.test\/companies\/shop\/expenses/);
  assert.match(own, /แก้ไขข้อมูลในเว็บ/);
  assert.doesNotMatch(own, /อนุมัติ|ลงบัญชี|ทดลองใช้ฟรี|แพ็กเกจ|3 ใบ/);
});
